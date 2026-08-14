import { env } from '../config/env';
import { cacheService } from './cache';

interface DataForSEOResponse {
  tasks?: {
    result?: {
      keywords?: any[];
    }[];
  }[];
}

export interface RealKeywordData {
  keyword: string;
  volume: number;
  cpc: number;
  kd: number;
  competition: number;
}

export async function getKeywordData(keyword: string, country: string, limit = 50): Promise<RealKeywordData[]> {
  const cacheKey = `dataforseo_${country}_${keyword}`;
  const cached = cacheService.get<RealKeywordData[]>(cacheKey);
  if (cached) return cached;

  const locationCode = country.toLowerCase() === 'us' ? 2840 : country.toLowerCase() === 'gb' ? 2826 : country.toLowerCase() === 'ca' ? 2124 : country.toLowerCase() === 'au' ? 2036 : country.toLowerCase() === 'de' ? 2276 : country.toLowerCase() === 'sg' ? 2702 : country.toLowerCase() === 'sa' ? 2682 : country.toLowerCase() === 'ae' ? 2784 : country.toLowerCase() === 'pk' ? 2586 : country.toLowerCase() === 'in' ? 2356 : country.toLowerCase() === 'tr' ? 2792 : country.toLowerCase() === 'my' ? 2458 : 2840;

  const response = await fetch('https://api.dataforseo.com/v3/keywords_data/google/keywords_for_keywords/live', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString('base64')}`,
    },
    body: JSON.stringify([
      {
        keyword,
        location_code: locationCode,
        language_code: 'en',
        limit,
        include_serp_info: false,
      },
    ]),
  });

  if (!response.ok) {
    throw new Error(`DataForSEO API error: ${response.status}`);
  }

  // ✅ Fix: Cast JSON response to expected interface
  const data = (await response.json()) as DataForSEOResponse;
  const keywordsRaw = data.tasks?.[0]?.result?.[0]?.keywords || [];

  const keywords: RealKeywordData[] = keywordsRaw.map((k: any) => ({
    keyword: k.keyword,
    volume: k.search_volume || 0,
    cpc: k.cpc || 0,
    kd: k.keyword_difficulty ?? Math.min(Math.round((k.competition || 0) * 100), 100),
    competition: k.competition || 0,
  }));

  cacheService.set(cacheKey, keywords, 86400);
  return keywords;
}
