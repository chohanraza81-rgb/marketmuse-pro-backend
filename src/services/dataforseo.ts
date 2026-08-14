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

const locationCodes: Record<string, number> = {
  us: 2840,
  gb: 2826,
  ca: 2124,
  au: 2036,
  de: 2276,
  sg: 2702,
  sa: 2682,
  ae: 2784,
  pk: 2586,
  in: 2356,
  tr: 2792,
  my: 2458,
};

export async function getKeywordData(keyword: string, country: string, limit = 50): Promise<RealKeywordData[]> {
  const cacheKey = `dataforseo_${country}_${keyword}`;
  const cached = cacheService.get<RealKeywordData[]>(cacheKey);
  if (cached) return cached;

  const locationCode = locationCodes[country.toLowerCase()] || 2840;
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
