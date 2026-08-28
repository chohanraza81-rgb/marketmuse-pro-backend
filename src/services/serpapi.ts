import axios from 'axios';
import { env } from '../config/env';
import { cacheService } from './cache';

// ✅ FIX: All Country Codes are now Uppercase
const VALID_GL = ['US', 'GB', 'AE', 'SA', 'PK', 'CA', 'AU', 'DE', 'SG', 'IN', 'TR', 'MY'];

const normalizeCountry = (country: string): string => {
  const c = country.toUpperCase().trim(); // ✅ FIX: Uppercase
  return VALID_GL.includes(c) ? c : 'US'; // Default to US if invalid
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

  const data = await withRetry(() =>
    axios.get('https://serpapi.com/search.json', {
      params: { api_key: env.SERPAPI_KEY, q: query, tbm: 'shop', gl, num: 10 },
    }).then(res => res.data)
  );
  cacheService.set(cacheKey, data, 86400);
  return data;
};

export const getSearchResults = async (query: string, country: string = 'us'): Promise<any> => {
  const gl = normalizeCountry(country);
  const cacheKey = `search_${query}_${gl}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const data = await withRetry(() =>
    axios.get('https://serpapi.com/search.json', {
      params: { api_key: env.SERPAPI_KEY, q: query, gl, num: 10 },
    }).then(res => res.data)
  );
  cacheService.set(cacheKey, data, 86400);
  return data;
};

export const getKeywordSuggestions = async (query: string, country: string = 'us'): Promise<string[]> => {
  const gl = normalizeCountry(country);
  const cacheKey = `kw_${query}_${gl}`;
  const cached = cacheService.get<string[]>(cacheKey);
  if (cached) return cached;

  const data: any = await withRetry(() =>
    axios.get('https://serpapi.com/search.json', {
      params: { api_key: env.SERPAPI_KEY, q: query, gl },
    }).then(res => res.data)
  );
  const suggestions = data.related_questions?.map((q: any) => q.question) ?? [];
  cacheService.set(cacheKey, suggestions, 86400);
  return suggestions;
};
