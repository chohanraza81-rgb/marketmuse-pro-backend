import { env } from '../config/env';
import { cacheService } from './cache';

interface SerperOrganicResult {
  position: number;
  title: string;
  link: string;
  snippet: string;
}

export interface SerperData {
  organic: SerperOrganicResult[];
  ads: any[];
  relatedSearches: string[];
  peopleAlsoAsk: string[];
}

export async function getSerperResults(query: string, country: string): Promise<SerperData> {
  const cacheKey = `serper_${country}_${query}`;
  const cached = cacheService.get<SerperData>(cacheKey);
  if (cached) return cached;

  const gl = country.toLowerCase();
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': env.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      gl,
      num: 10,
    }),
  });

  if (!response.ok) {
    throw new Error(`Serper API error: ${response.status}`);
  }

  const data = await response.json();

  const result: SerperData = {
    organic: (data.organic || []).map((r: any, idx: number) => ({
      position: idx + 1,
      title: r.title,
      link: r.link,
      snippet: r.snippet || '',
    })),
    ads: data.ads || [],
    relatedSearches: (data.relatedSearches || []).map((r: any) => r.query),
    peopleAlsoAsk: (data.peopleAlsoAsk || []).map((r: any) => r.question),
  };

  cacheService.set(cacheKey, result, 86400);
  return result;
}
