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

  const countryCode = country.toLowerCase(); // DataForSEO uses lower case like 'us', 'gb', 'ca', etc.

  const response = await fetch('https://api.dataforseo.com/v3/keywords_data/google/keywords_for_keywords/live', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString('base64')}`,
    },
    body: JSON.stringify([
      {
        keyword,
        location_code: countryCode === 'us' ? 2840 : countryCode === 'gb' ? 2826 : countryCode === 'ca' ? 2124 : countryCode === 'au' ? 2036 : countryCode === 'de' ? 2276 : countryCode === 'sg' ? 2702 : countryCode === 'sa' ? 2682 : countryCode === 'ae' ? 2784 : countryCode === 'pk' ? 2586 : countryCode === 'in' ? 2356 : countryCode === 'tr' ? 2792 : countryCode === 'my' ? 2458 : 2840,
        language_code: 'en',
        limit,
        include_serp_info: false,
      },
    ]),
  });

  if (!response.ok) {
    throw new Error(`DataForSEO API error: ${response.status}`);
  }

  const data: DataForSEOResponse = await response.json();
  const keywordsRaw = data.tasks?.[0]?.result?.[0]?.keywords || [];

  const keywords: RealKeywordData[] = keywordsRaw.map((k: any) => ({
    keyword: k.keyword,
    volume: k.search_volume || 0,
    cpc: k.cpc || 0,
    kd: k.keyword_difficulty || Math.min(Math.round((k.competition || 0) * 100), 100),
    competition: k.competition || 0,
  }));

  cacheService.set(cacheKey, keywords, 86400); // cache 24h
  return keywords;
}
