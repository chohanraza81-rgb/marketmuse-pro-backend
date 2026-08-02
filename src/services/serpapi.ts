import { getJson } from 'serpapi';
import { env } from '../config/env';
import { cacheService } from './cache';
import pLimit from 'p-limit';
import { countryToGL } from './countries';

const limit = pLimit(5);

const withRetry = async <T>(fn: () => Promise<T>, retries = 3): Promise<T> => {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === retries - 1) throw lastError;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastError;
};

export const getShoppingResults = async (query: string, country: string = 'us'): Promise<any> => {
  const cacheKey = `shopping_${query}_${country}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return cached;

  const gl = countryToGL[country] || 'us';  // convert to Google country code

  const data = await limit(() =>
    withRetry(() =>
      getJson({
        api_key: env.SERPAPI_KEY,
        q: query,
        tbm: 'shop',
        gl: gl,
        num: 10,
      })
    )
  );

  cacheService.set(cacheKey, data);
  return data;
};

export const getKeywordSuggestions = async (query: string, country: string = 'us'): Promise<string[]> => {
  const cacheKey = `keywords_${query}_${country}`;
  const cached = cacheService.get<string[]>(cacheKey);
  if (cached) return cached;

  const gl = countryToGL[country] || 'us';

  const data: any = await limit(() =>
    withRetry(() =>
      getJson({
        api_key: env.SERPAPI_KEY,
        q: query,
        gl: gl,
      })
    )
  );

  const suggestions = data.related_questions?.map((q: any) => q.question) ?? [];
  cacheService.set(cacheKey, suggestions);
  return suggestions;
};

export const getSearchResults = async (query: string, country: string = 'us'): Promise<any> => {
  const cacheKey = `search_${query}_${country}`;
  const cached = cacheService.get<any>(cacheKey);
  if (cached) return cached;

  const gl = countryToGL[country] || 'us';

  const data = await limit(() =>
    withRetry(() =>
      getJson({
        api_key: env.SERPAPI_KEY,
        q: query,
        gl: gl,
        num: 10,
      })
    )
  );
  cacheService.set(cacheKey, data);
  return data;
};
