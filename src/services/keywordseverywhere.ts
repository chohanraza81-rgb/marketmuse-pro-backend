import { env } from '../config/env';
import { cacheService } from './cache';

const BASE_URL = 'https://api.keywordseverywhere.com/v1';

async function fetchFromKWE(endpoint: string, params: any): Promise<any> {
  const response = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.KEYWORDS_EVERYWHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error(`KWE error: ${response.status}`);
  return response.json();
}

export interface RealKeywordData {
  keyword: string;
  volume: number;
  cpc: number;
  kd: number;
}

export const getKeywordData = async (keyword: string, country: string): Promise<{ data?: RealKeywordData[] }> => {
  const cacheKey = `kwe_keyword_${country}_${keyword}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const data = await fetchFromKWE('get_keyword_data', {
    country,
    currency: 'USD',
    dataSource: 'gkp',
    kw: [keyword],
  });
  cacheService.set(cacheKey, data, 86400);
  return data;
};

export const getRelatedKeywords = async (keyword: string, country: string): Promise<{ data?: any[] }> => {
  const cacheKey = `kwe_related_${country}_${keyword}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const data = await fetchFromKWE('get_related_keywords', {
    country,
    currency: 'USD',
    dataSource: 'gkp',
    kw: [keyword],
  });
  cacheService.set(cacheKey, data, 86400);
  return data;
};

export const getTrends = async (keyword: string, country: string): Promise<any[]> => {
  const cacheKey = `kwe_trend_${country}_${keyword}`;
  const cached = cacheService.get<any[]>(cacheKey);
  if (cached) return cached;

  const metrics = await getKeywordData(keyword, country);
  const trendData = metrics?.data?.[0]?.trend;
  if (!trendData) return [];
  const values = trendData.map((point: any) => point.value);
  cacheService.set(cacheKey, values, 86400);
  return values;
};
