import SerpApi from 'serpapi';
import { env } from '../config/env';
import { cacheService } from './cache';
import pLimit from 'p-limit';

const client = new SerpApi.GoogleSearch(env.SERPAPI_KEY);
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

export const getShoppingResults = async (query: string, country: string = 'us') => {
  const cacheKey = `shopping_${query}_${country}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const data = await limit(() =>
    withRetry(() =>
      client.json({
        q: query,
        tbm: 'shop',
        gl: country,
        num: 10,
      })
    )
  );

  cacheService.set(cacheKey, data);
  return data;
};

export const getKeywordSuggestions = async (query: string, country: string = 'us') => {
  const cacheKey = `keywords_${query}_${country}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const data = await limit(() =>
    withRetry(() =>
      client.json({
        q: query,
        gl: country,
      })
    )
  );

  const suggestions = data.related_questions?.map((q: any) => q.question) ?? [];
  cacheService.set(cacheKey, suggestions);
  return suggestions;
};

export const getSearchResults = async (query: string, country: string = 'us') => {
  const cacheKey = `search_${query}_${country}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const data = await limit(() =>
    withRetry(() =>
      client.json({
        q: query,
        gl: country,
        num: 10,
      })
    )
  );
  cacheService.set(cacheKey, data);
  return data;
};
