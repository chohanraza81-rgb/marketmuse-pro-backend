import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getSearchResults, getKeywordSuggestions } from '../services/serpapi';
import { getTrends } from '../services/trends';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const SEO_SYSTEM_PROMPT = `You are an expert SEO strategist. Given a niche and country, analyze search data and trends.
Respond ONLY with valid JSON:
{
  "keywords": [ { "keyword": string, "volume": number, "kd": number, "cpc": number } ] (50 items),
  "trend_score": "Seasonal" or "Evergreen",
  "serp_analysis": [ { "position": number, "title": string, "url": string, "da": number, "word_count": number, "backlinks": number } ],
  "content_calendar": [ { "title": string, "keyword": string } ] (24 items),
  "backlink_strategy": string,
  "chart_data": { "trend_12m": number[], "related_queries": string[] }
}`;

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const countryUpper = country.toUpperCase();
    const cacheKey = `seo_report_${niche}_${country}`;
    const cached = cacheService.get(cacheKey);
    if (cached) return res.json(cached);

    const [searchData, keywordSuggestions, trendsData] = await Promise.all([
      getSearchResults(niche, country),
      getKeywordSuggestions(niche, country),
      getTrends(niche, countryUpper),
    ]);

    const serpOrganic = searchData.organic_results?.slice(0, 10).map((r: any) => ({
      position: r.position,
      title: r.title,
      url: r.link,
    })) || [];

    const userMessage = `Niche: ${niche}\nCountry: ${country}\nSERP Top 10: ${JSON.stringify(serpOrganic)}\nRelated Questions: ${keywordSuggestions.slice(0,10)}\nTrends: ${JSON.stringify(trendsData.slice(0,6))}`;

    const groqResponse = await runGroqWithRetry(SEO_SYSTEM_PROMPT, userMessage);
    let analysis;
    try {
      const cleaned = groqResponse.replace(/```json|```/g, '').trim();
      analysis = JSON.parse(cleaned);
    } catch {
      throw new Error('Invalid Groq JSON');
    }

    const markdown = generateSEOMarkdown(analysis, niche, country);
    const charts = {
      trends: trendsData,
      trendScore: analysis.trend_score,
      serp: analysis.serp_analysis || [],
      keywords: analysis.keywords || [],
      contentCalendar: analysis.content_calendar || [],
    };

    const report = await Report.create({
      type: 'seo',
      niche,
      country,
      data: analysis,
      markdown,
      charts,
    });

    const result = { id: report._id, ...report.toObject() };
    cacheService.set(cacheKey, result, 86400);
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
};

function generateSEOMarkdown(analysis: any, niche: string, country: string): string {
  return `# SEO Report: ${niche} (${country.toUpperCase()})
  
## Trend: ${analysis.trend_score}
### Top Keywords
${analysis.keywords.slice(0, 20).map((k: any) => `- ${k.keyword} (Vol: ${k.volume}, KD: ${k.kd})`).join('\n')}

## SERP Analysis
${analysis.serp_analysis.map((s: any) => `- #${s.position} ${s.title} (DA:${s.da}, Words:${s.word_count})`).join('\n')}

## 24-Week Content Calendar
${analysis.content_calendar.map((c: any) => `- ${c.title} (${c.keyword})`).join('\n')}

## Backlink Strategy
${analysis.backlink_strategy}
`;
}
