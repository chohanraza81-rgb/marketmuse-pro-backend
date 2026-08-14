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

export interface DataForSEOKeywordResult {
  keywords: RealKeywordData[];
  trend: number[];
}

const locationCodes: Record<string, number> = {
  us: 2840, gb: 2826, ca: 2124, au: 2036, de: 2276, sg: 2702,
  sa: 2682, ae: 2784, pk: 2586, in: 2356, tr: 2792, my: 2458,
};

async function fetchFromDataForSEO(keyword: string, country: string, limit: number): Promise<DataForSEOResponse> {
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

  return (await response.json()) as DataForSEOResponse;
}

export async function getKeywordDataAndTrend(keyword: string, country: string, limit = 50): Promise<DataForSEOKeywordResult> {
  const cacheKey = `dataforseo_trend_${country}_${keyword}`;
  const cached = cacheService.get<DataForSEOKeywordResult>(cacheKey);
  if (cached) return cached;

  const data = await fetchFromDataForSEO(keyword, country, limit);
  const keywordsRaw = data.tasks?.[0]?.result?.[0]?.keywords || [];

  const keywords: RealKeywordData[] = keywordsRaw.map((k: any) => ({
    keyword: k.keyword,
    volume: k.search_volume || 0,
    cpc: k.cpc || 0,
    kd: k.keyword_difficulty ?? Math.min(Math.round((k.competition || 0) * 100), 100),
    competition: k.competition || 0,
  }));

  const trend: number[] = keywordsRaw[0]?.monthly_searches?.map((m: any) => m.search_volume || 0) || [];

  const result: DataForSEOKeywordResult = { keywords, trend };
  cacheService.set(cacheKey, result, 86400);
  return result;
}
