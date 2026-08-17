import googleTrends from 'google-trends-api';
import { cacheService } from './cache';

export async function getGoogleTrends(keyword: string, country: string): Promise<number[]> {
  const cacheKey = `gt_${country}_${keyword}`;
  const cached = cacheService.get<number[]>(cacheKey);
  if (cached) return cached;

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  try {
    const results = await googleTrends.interestOverTime({
      keyword,
      startTime: twelveMonthsAgo,
      geo: country.toUpperCase(),
      hl: 'en-US',
    });
    const parsed = JSON.parse(results);
    const timeline = parsed.default?.timelineData || [];
    const values = timeline.map((point: any) => point.value?.[0] || 0);
    cacheService.set(cacheKey, values, 86400);
    return values;
  } catch (error) {
    console.warn(`⚠️ Google Trends failed: ${error}`);
    return []; // optional, will show Not Disclosed in report
  }
}
