// dataforseo.service.ts
// Hybrid DataForSEO service — NEVER throws. Returns empty array on any failure.
// If credentials are missing, instantly returns empty (fallback to Gemini).

import axios from 'axios';
import { getDataForSEOLocation } from './dataforseo-locations';

const API_BASE = 'https://api.dataforseo.com/v3';
const TIMEOUT_MS = 45000;

export interface RealKeywordMetric {
  keyword: string;
  volume: number;
  cpc: number; // in USD
  competition: number; // 0-1
  kd: number; // 0-100
  intent?: string;
}

export interface RealTrendData {
  keyword: string;
  timeline: { date: string; value: number }[];
}

// Check if DataForSEO credentials exist
export function isDataForSEOAvailable(): boolean {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  return !!(login && password && login.trim() !== '' && password.trim() !== '');
}

// Get auth header
function getAuthHeader(): { Authorization: string; 'Content-Type': string } | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  const auth = Buffer.from(`${login}:${password}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
  };
}

// Fetch real keyword metrics (Volume, CPC, KD, competition)
// Returns [] on any failure — caller falls back to Gemini.
export async function fetchRealKeywordMetrics(
  keywords: string[],
  country: string
): Promise<RealKeywordMetric[]> {
  if (!isDataForSEOAvailable()) {
    console.log('ℹ️ [DataForSEO] Credentials not set. Skipping live fetch.');
    return [];
  }
  if (!Array.isArray(keywords) || keywords.length === 0) return [];

  const headers = getAuthHeader();
  if (!headers) return [];

  const { location_code, language_code } = getDataForSEOLocation(country);
  const cleanKeywords = keywords
    .map((k) => String(k || '').trim())
    .filter((k) => k.length > 0)
    .slice(0, 100);

  if (cleanKeywords.length === 0) return [];

  try {
    console.log(`📡 [DataForSEO] Fetching metrics for ${cleanKeywords.length} keywords (${country})...`);

    // Step 1: Search Volume + CPC + Competition from Google Ads
    const volumeRes = await axios.post(
      `${API_BASE}/keywords_data/google_ads/search_volume/live`,
      cleanKeywords.map((kw) => ({
        keyword: kw,
        location_code,
        language_code,
      })),
      { headers, timeout: TIMEOUT_MS }
    );

    const volumeTasks = volumeRes.data?.tasks || [];
    const volumeMap: Record<string, { volume: number; cpc: number; competition: number }> = {};

    for (const task of volumeTasks) {
      const result = task?.result?.[0];
      if (result && result.keyword) {
        volumeMap[result.keyword] = {
          volume: Number(result.search_volume) || 0,
          cpc: Number(result.cpc) || 0,
          competition: Number(result.competition) || 0,
        };
      }
    }

    // Step 2: KD from DataForSEO Labs (batches of 20)
    const kdMap: Record<string, number> = {};
    const kdBatches: string[][] = [];
    for (let i = 0; i < cleanKeywords.length; i += 20) {
      kdBatches.push(cleanKeywords.slice(i, i + 20));
    }

    for (const batch of kdBatches) {
      try {
        const kdRes = await axios.post(
          `${API_BASE}/dataforseo_labs/google/keyword_overview/live`,
          batch.map((kw) => ({
            keyword: kw,
            location_code,
            language_code,
          })),
          { headers, timeout: TIMEOUT_MS }
        );

        const kdTasks = kdRes.data?.tasks || [];
        for (const task of kdTasks) {
          const results = task?.result || [];
          for (const r of results) {
            if (r && r.keyword) {
              kdMap[r.keyword] = Number(r.keyword_difficulty) || 0;
            }
          }
        }
      } catch (kdErr: any) {
        console.warn(`⚠️ [DataForSEO] KD batch failed: ${kdErr.message}. Using competition fallback.`);
      }
    }

    // Step 3: Merge
    const metrics: RealKeywordMetric[] = [];
    for (const kw of cleanKeywords) {
      const v = volumeMap[kw];
      if (v) {
        metrics.push({
          keyword: kw,
          volume: v.volume,
          cpc: v.cpc,
          competition: v.competition,
          kd: kdMap[kw] !== undefined ? kdMap[kw] : Math.round(v.competition * 100),
          intent: inferIntent(kw),
        });
      }
    }

    console.log(`✅ [DataForSEO] Fetched real metrics for ${metrics.length}/${cleanKeywords.length} keywords.`);
    return metrics;
  } catch (error: any) {
    console.warn(`⚠️ [DataForSEO] Metrics fetch failed: ${error.message}. Falling back to Gemini.`);
    return [];
  }
}

// Fetch real Google Trends (12-month data)
// Returns [] on any failure — caller falls back to current method.
export async function fetchRealTrends(
  keywords: string[],
  country: string
): Promise<RealTrendData[]> {
  if (!isDataForSEOAvailable()) return [];
  if (!Array.isArray(keywords) || keywords.length === 0) return [];

  const headers = getAuthHeader();
  if (!headers) return [];

  const { location_code, language_code } = getDataForSEOLocation(country);
  const cleanKeywords = keywords
    .map((k) => String(k || '').trim())
    .filter((k) => k.length > 0)
    .slice(0, 5); // Max 5 per Trends API

  if (cleanKeywords.length === 0) return [];

  try {
    console.log(`📡 [DataForSEO] Fetching trends for ${cleanKeywords.length} keywords...`);

    const res = await axios.post(
      `${API_BASE}/keywords_data/google_trends/explore/live`,
      cleanKeywords.map((kw) => ({
        keywords: [kw],
        location_code,
        language_code,
        type: 'web',
        time_range: 'past_12_months',
      })),
      { headers, timeout: TIMEOUT_MS }
    );

    const tasks = res.data?.tasks || [];
    const results: RealTrendData[] = [];

    for (const task of tasks) {
      const result = task?.result?.[0];
      if (result && result.keywords?.[0]) {
        const keyword = result.keywords[0];
        const timeline = (result.interest_over_time || []).map((point: any) => ({
          date: point.date || '',
          value: Number(point.value) || 0,
        }));
        results.push({ keyword, timeline });
      }
    }

    console.log(`✅ [DataForSEO] Fetched trends for ${results.length} keywords.`);
    return results;
  } catch (error: any) {
    console.warn(`⚠️ [DataForSEO] Trends fetch failed: ${error.message}. Falling back.`);
    return [];
  }
}

// Simple heuristic intent classifier (fallback when DataForSEO doesn't return it)
function inferIntent(keyword: string): string {
  const lower = keyword.toLowerCase();
  if (lower.includes('how to') || lower.includes('guide') || lower.includes('what is') || lower.includes('vs')) {
    return 'informational';
  }
  if (lower.includes('buy') || lower.includes('price') || lower.includes('cost') || lower.includes('wholesale') || lower.includes('hire')) {
    return 'transactional';
  }
  if (lower.includes('best') || lower.includes('top') || lower.includes('review') || lower.includes('compare')) {
    return 'commercial';
  }
  if (lower.includes('login') || lower.includes('app') || lower.includes('website')) {
    return 'navigational';
  }
  return 'commercial';
}
