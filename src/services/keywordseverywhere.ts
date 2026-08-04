import { env } from '../config/env';
import { cacheService } from './cache';

const BASE_URL = 'https://api.keywordseverywhere.com/v1';

interface KeywordData {
  keyword: string;
  vol: number;
  cpc: { currency: string; value: string };
  competition: number;
  trend: { month: string; value: number }[];
}

async function fetchFromKWE(endpoint: string, params: any): Promise<any> {
  const response = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.KEYWORDS_EVERYWHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`KWE error: ${response.status} ${JSON.stringify(err)}`);
  }
  return response.json();
}

export const getKeywordMetrics = async (keywords: string[], country: string = 'us'): Promise<any> => {
  const cacheKey = `kwe_metrics_${country}_${keywords.join(',')}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const data = await fetchFromKWE('get_keyword_data', {
    country,
    currency: 'USD',
    dataSource: 'gkp', // Google Keyword Planner
    kw: keywords,
  });

  cacheService.set(cacheKey, data, 86400);
  return data;
};

export const getRelatedKeywords = async (keyword: string, country: string = 'us'): Promise<any> => {
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

export const getTrends = async (keyword: string, country: string = 'us'): Promise<number[]> => {
  const cacheKey = `kwe_trend_${country}_${keyword}`;
  const cached = cacheService.get<number[]>(cacheKey);
  if (cached) return cached;

  const metrics = await getKeywordMetrics([keyword], country);
  const trendData = metrics.data?.[0]?.trend;
  if (!trendData || trendData.length === 0) {
    // Fallback: throw error so caller knows no data
    throw new Error('No trend data available from KWE');
  }

  const values = trendData.map((point: any) => point.value);
  cacheService.set(cacheKey, values, 86400);
  return values;
};
