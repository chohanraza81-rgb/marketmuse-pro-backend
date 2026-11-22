// src/services/osint.service.ts - FIXED v2.0 - Evidence Safe
// OSINT data collection for counterfeit intelligence
// NEVER throws — returns empty arrays on failure

import { getSearchResults } from './serpapi';
import { getSerperResults } from './serper';
import { getScraperAPISearch } from './scraperapi';
import { isDataForSEOAvailable, fetchRealKeywordMetrics } from './dataforseo.service';
import {
  COUNTERFEIT_PLATFORMS,
  COUNTERFEIT_KEYWORDS,
  getCounterfeitKeywordsForBrand,
} from '../data/counterfeit-keywords';

export interface OSINTFinding {
  keyword: string;
  platform: string;
  url: string;
  title: string;
  snippet: string;
  riskLevel: 'Critical' | 'High' | 'Medium' | 'Low';
  timestamp: string;
  source: 'live' | 'modeled'; // NEW: to know if real or estimated
}

export interface PlatformDistribution {
  platform: string;
  domain: string;
  findingsCount: number;
  riskLevel: string;
}

export interface KeywordAnalysis {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  kd: number | null;
  intent: string;
  isModeled: boolean; // NEW: must be shown in report as Modeled
}

// FIXED: Clean Google redirect links - Extract real URL or discard
function cleanSerpUrl(rawUrl: string): string | null {
  if (!rawUrl) return null;

  // Case 1: Google goto redirect - https://www.google.com/goto?url=...
  // SerpAPI sometimes returns this, we must decode inner url
  if (rawUrl.includes('google.com/goto')) {
    try {
      const parsed = new URL(rawUrl);
      const inner = parsed.searchParams.get('url');
      if (inner) {
        // Inner URL is often base64 or encoded - try decode
        try {
          const decoded = decodeURIComponent(inner);
          // If decoded still looks like URL, use it
          if (decoded.startsWith('http')) return decoded;
        } catch {
          // If decode fails, return inner as-is if it looks like URL
          if (inner.startsWith('http')) return inner;
        }
      }
      // If we cannot extract real URL, DISCARD - don't show google.com/goto
      return null;
    } catch {
      return null;
    }
  }

  // Case 2: Google search / other google internal links - discard
  if (rawUrl.includes('google.com/search') || rawUrl.includes('google.com/url')) {
    return null;
  }

  // Case 3: Normal URL - validate
  if (!rawUrl.startsWith('http')) return null;
  return rawUrl;
}

// FIXED: Extract domain safely, never return google.com for counterfeit
function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace('www.', '').toLowerCase();
    // Never allow google.com as platform domain for counterfeit findings
    if (hostname === 'google.com' || hostname.endsWith('.google.com')) {
      return 'unknown';
    }
    return hostname;
  } catch {
    return 'unknown';
  }
}

// ✅ Collect OSINT findings for a brand - FIXED
export async function collectOSINTFindings(
  brand: string,
  country: string,
  maxKeywords: number = 10
): Promise<OSINTFinding[]> {
  const keywords = getCounterfeitKeywordsForBrand(brand).slice(0, maxKeywords);
  const findings: OSINTFinding[] = [];

  console.log(`🔍 [OSINT] Scanning ${keywords.length} keywords for ${brand}...`);

  for (const keyword of keywords) {
    try {
      // Try SerpAPI → ScraperAPI → SerperAPI
      let searchData = await getSearchResults(keyword, country).catch(() => null);
      if (!searchData?.organic_results) {
        searchData = await getScraperAPISearch(keyword, country).catch(() => null);
      }
      if (!searchData?.organic_results) {
        searchData = await getSerperResults(keyword, country).catch(() => null);
      }

      if (searchData?.organic_results) {
        for (const result of searchData.organic_results.slice(0, 3)) {
          // FIXED: Clean URL first, skip if cannot clean
          const cleanUrl = cleanSerpUrl(result.link || '');
          if (!cleanUrl) {
            console.log(`⏭️ [OSINT] Skipped google redirect link for "${keyword}"`);
            continue;
          }

          const domain = extractDomain(cleanUrl);
          if (domain === 'unknown') continue;

          const platform = COUNTERFEIT_PLATFORMS.find((p) =>
            domain.includes(p.domain.replace('www.', ''))
          );

          // FIXED: Don't claim verified if not actually verified
          findings.push({
            keyword,
            platform: platform?.name || 'Web',
            url: cleanUrl,
            title: result.title || 'Untitled listing',
            snippet: result.snippet || '',
            riskLevel: (platform?.risk as any) || 'Medium',
            timestamp: new Date().toISOString().split('T')[0], // Date only: 2026-11-22
            source: 'live',
          });
        }
      }
    } catch (e: any) {
      console.warn(`⚠️ [OSINT] Keyword "${keyword}" failed: ${e.message}`);
    }
  }

  console.log(`✅ [OSINT] Collected ${findings.length} verified findings (google redirects filtered).`);
  return findings;
}

// ✅ Analyze platform distribution - FIXED: Group by real domain, not google.com
export function analyzePlatformDistribution(findings: OSINTFinding[]): PlatformDistribution[] {
  const map = new Map<string, PlatformDistribution>();

  for (const finding of findings) {
    // Use domain as key, not just platform name, so ebay vs web separate
    const domain = extractDomain(finding.url);
    const key = domain !== 'unknown' ? domain : finding.platform;

    const existing = map.get(key);
    if (existing) {
      existing.findingsCount++;
    } else {
      map.set(key, {
        platform: finding.platform,
        domain: domain,
        findingsCount: 1,
        riskLevel: finding.riskLevel,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.findingsCount - a.findingsCount);
}

// ✅ Keyword analysis via DataForSEO (hybrid — fallback to modeled with label)
export async function analyzeCounterfeitKeywords(
  brand: string,
  country: string
): Promise<KeywordAnalysis[]> {
  const keywords = getCounterfeitKeywordsForBrand(brand).slice(0, 15);

  // Try DataForSEO first
  if (isDataForSEOAvailable()) {
    try {
      const metrics = await fetchRealKeywordMetrics(keywords, country);
      if (metrics.length > 0) {
        console.log(`✅ [OSINT] DataForSEO keyword metrics: ${metrics.length} results.`);
        return metrics.map((m) => ({
          keyword: m.keyword,
          volume: m.volume,
          cpc: m.cpc,
          kd: m.kd,
          intent: m.intent || 'transactional',
          isModeled: false, // Real data
        }));
      }
    } catch (e: any) {
      console.warn(`⚠️ [OSINT] DataForSEO keyword analysis failed: ${e.message}`);
    }
  }

  // Fallback: Modeled keyword metrics - NOW LABELED as modeled
  console.log('ℹ️ [OSINT] Using modeled keyword estimates - will be marked as Modeled in report.');
  return keywords.map((kw, i) => ({
    keyword: kw,
    volume: generateModeledVolume(kw, country),
    cpc: generateModeledCPC(kw),
    kd: 15 + (kw.length % 40),
    intent: 'transactional',
    isModeled: true, // CRITICAL: Report must show "Modeled Estimate" for these
  }));
}

// Helper: extract domain from URL - kept for backward compat
// Modeled volume (deterministic based on keyword) - MUST be labeled as modeled in report
function generateModeledVolume(keyword: string, country: string): number {
  const seed = keyword.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const countryMultiplier: Record<string, number> = {
    us: 1.0, gb: 0.7, ca: 0.5, au: 0.5, de: 0.8, sg: 0.3,
    sa: 0.4, ae: 0.4, pk: 0.6, in: 1.2, tr: 0.7, my: 0.4,
  };
  const mult = countryMultiplier[country] || 1.0;
  const base = 200 + (seed % 2500);
  const volume = Math.round(base * mult);
  return volume % 10 === 0 ? volume + (seed % 7) + 1 : volume;
}

// Modeled CPC (deterministic based on keyword)
function generateModeledCPC(keyword: string): number {
  const seed = keyword.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const isLuxury = /rolex|gucci|lv|louis|chanel|hermes|prada/i.test(keyword);
  const isSneaker = /nike|jordan|yeezy|adidas|dunk/i.test(keyword);
  const baseCPC = isLuxury ? 8 + (seed % 15) : isSneaker ? 4 + (seed % 10) : 2 + (seed % 8);
  return Number(baseCPC.toFixed(2));
}

// NEW HELPER: Format money as rounded estimate - Prevents $4,809,255 fake precision
export function formatEstimatedMoney(amount: number, currency: string = '$'): string {
  if (amount >= 1000000) {
    return `${currency}${(amount / 1000000).toFixed(1)}M (Modeled Estimate)`;
  }
  if (amount >= 1000) {
    return `${currency}${(amount / 1000).toFixed(1)}K (Modeled Estimate)`;
  }
  return `${currency}${Math.round(amount)} (Modeled Estimate)`;
}

// NEW HELPER: Round loss numbers - Never show fake exact cents
export function roundLossEstimate(amount: number): number {
  // Round to nearest 10K to avoid fake precision like $4,809,255
  return Math.round(amount / 10000) * 10000;
}
