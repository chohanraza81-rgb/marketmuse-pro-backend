import { getJson } from 'serpapi';
import { env } from '../config/env';
import { cacheService } from './cache';
import pLimit from 'p-limit';

const limit = pLimit(5);

const VALID_GL = ['us', 'gb', 'ae', 'sa', 'pk'];

const normalizeCountry = (country: string): string => {
  const c = country.toLowerCase().trim();
  return VALID_GL.includes(c) ? c : 'us';
};

const withRetry = async <T>(fn: () => Promise<T>, retries = 1): Promise<T> => {
  let last: any;
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1500)); }
  }
  throw last;
};

export const getShoppingResults = async (query: string, country: string = 'us'): Promise<any> => {
  const gl = normalizeCountry(country);
  const cacheKey = `shop_${query}_${gl}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const data = await limit(() =>
    withRetry(() =>
      getJson({
        api_key: env.SERPAPI_KEY,
        q: query,
        tbm: 'shop',
        gl,
        num: 10,
      })
    )
  );
  cacheService.set(cacheKey, data, 86400);
  return data;
};

export const getSearchResults = async (query: string, country: string = 'us'): Promise<any> => {
  const gl = normalizeCountry(country);
  const cacheKey = `search_${query}_${gl}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const data = await limit(() =>
    withRetry(() =>
      getJson({
        api_key: env.SERPAPI_KEY,
        q: query,
        gl,
        num: 10,
      })
    )
  );
  cacheService.set(cacheKey, data, 86400);
  return data;
};

export const getKeywordSuggestions = async (query: string, country: string = 'us'): Promise<string[]> => {
  const gl = normalizeCountry(country);
  const cacheKey = `kw_${query}_${gl}`;
  const cached = cacheService.get<string[]>(cacheKey);
  if (cached) return cached;

  const data: any = await limit(() =>
    withRetry(() =>
      getJson({
        api_key: env.SERPAPI_KEY,
        q: query,
        gl,
      })
    )
  );
  const suggestions = data.related_questions?.map((q: any) => q.question) ?? [];
  cacheService.set(cacheKey, suggestions, 86400);
  return suggestions;
};
