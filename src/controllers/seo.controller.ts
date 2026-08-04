import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getSearchResults } from '../services/serpapi';
import { getRelatedKeywords, getTrends } from '../services/keywordseverywhere';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const extractJSON = (raw: string): any => {
  let c = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = c.indexOf('{'), e = c.lastIndexOf('}');
  if (s !== -1 && e !== -1 && e > s) c = c.substring(s, e + 1);
  return JSON.parse(c); // GPT‑4o with json_object always returns clean JSON
};

const PROMPT = `You are an elite SEO consultant. Analyze the REAL keyword data, SERP results, and trends provided. Return ONLY valid JSON:

{
  "trend_score": "Seasonal" | "Evergreen",
  "trend_insight": "2 sentences explaining the trend",
  "keywords": [
    {
      "keyword": "string",
      "volume": number,
      "kd": number (0-100, computed from competition level),
      "cpc": number,
      "intent": "informational"|"commercial"|"transactional",
      "serp_features": ["Featured Snippet","Video","PAA"],
      "ranking_opportunity": "Easy Win"|"Moderate"|"Long Game"
    }
  ] (exactly 50, based on real data provided, sorted by volume),
  "serp_analysis": [...same as before...],
  "content_calendar": [...same as before...],
  "backlink_strategy": [...same as before...],
  "onpage_checklist": [...same as before...],
  "chart_data": {
    "trend_12m": [12 numbers],
    "keyword_difficulty": {"easy":N,"medium":N,"hard":N},
    "traffic_growth_6m": [6 numbers]
  }
}`;

function md(a: any, niche: string, country: string): string {
  // ... same as current premium markdown generation ...
  // (omitted for brevity – keep your existing markdown function)
}

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const ck = `seo_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    console.log(`🔍 SEO: "${niche}" in ${country}`);

    // Parallel real data: SERP from SerpAPI, related keywords + trends from KWE
    const [serpData, relatedKwData, trendsArr] = await Promise.all([
      getSearchResults(niche, country),
      getRelatedKeywords(niche, country),
      getTrends(niche, country).catch(() => null),
    ]);

    const serp = serpData.organic_results?.slice(0, 8).map((r: any) => ({
      position: r.position, title: r.title, url: r.link, snippet: r.snippet || ''
    })) || [];

    // Prepare keyword list from KWE related keywords (or fallback to seed keyword metrics)
    const relatedList = relatedKwData?.data?.slice(0, 50).map((k: any) => ({
      keyword: k.keyword,
      volume: k.vol,
      cpc: parseFloat(k.cpc?.value || '0'),
      competition: k.competition,
    })) || [];

    // Combine with seed keyword
    const seedMetrics = await (async () => {
      try {
        const { getKeywordMetrics } = await import('../services/keywordseverywhere');
        const m = await getKeywordMetrics([niche], country);
        return m.data?.[0];
      } catch { return null; }
    })();

    const allKeywords = [
      ...(seedMetrics ? [{ keyword: seedMetrics.keyword, volume: seedMetrics.vol, cpc: parseFloat(seedMetrics.cpc?.value || '0'), competition: seedMetrics.competition }] : []),
      ...relatedList,
    ].slice(0, 55);

    const userMsg = `Niche: ${niche}\nCountry: ${country}\n\nReal SERP Top 8:\n${JSON.stringify(serp)}\n\nReal Keyword Data (volume, CPC, competition):\n${JSON.stringify(allKeywords)}\n\n12-Month Trend Values: ${trendsArr ? JSON.stringify(trendsArr) : 'Not available'}`;

    const ai = await runGroqWithRetry(PROMPT, userMsg);
    const analysis = extractJSON(ai);

    // Merge real trend data if available
    if (trendsArr && Array.isArray(trendsArr)) {
      analysis.chart_data = analysis.chart_data || {};
      analysis.chart_data.trend_12m = trendsArr;
    }

    const markdown = md(analysis, niche, country);
    const report = await Report.create({
      type: 'seo', niche, country, value: '$99',
      data: analysis, markdown, charts: { trends: trendsArr || analysis.chart_data?.trend_12m }
    });

    const result = { id: report._id, ...report.toObject() };
    cacheService.set(ck, result, 86400);
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
};

export const getSEOReport = async (req: Request, res: Response) => {
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  res.json(report);
};
