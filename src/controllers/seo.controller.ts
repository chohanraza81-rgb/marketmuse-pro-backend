import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getSearchResults, getKeywordSuggestions } from '../services/serpapi';
import { getTrends } from '../services/trends';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const extractJSON = (raw: string): any => {
  console.log('🔧 Raw Groq response length:', raw.length);
  
  let cleaned = raw
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .replace(/^[^{[]*/, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let startIdx = -1, endIdx = -1;

  if (firstBrace !== -1 && (firstBrace < firstBracket || firstBracket === -1)) {
    startIdx = firstBrace;
    let depth = 1;
    for (let i = startIdx + 1; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++;
      else if (cleaned[i] === '}') depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    let depth = 1;
    for (let i = startIdx + 1; i < cleaned.length; i++) {
      if (cleaned[i] === '[') depth++;
      else if (cleaned[i] === ']') depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }

  if (startIdx !== -1 && endIdx !== -1) {
    cleaned = cleaned.substring(startIdx, endIdx + 1);
  } else {
    // If JSON is truncated (no closing brace), try to fix common ending
    if (startIdx !== -1 && endIdx === -1) {
      cleaned = cleaned.substring(startIdx);
      console.warn('⚠️ JSON appears truncated. Attempting to salvage...');
      // Add missing closing braces (heuristic)
      const openBraces = (cleaned.match(/{/g) || []).length;
      const closeBraces = (cleaned.match(/}/g) || []).length;
      cleaned += '}'.repeat(openBraces - closeBraces);
      // Also close arrays if needed
      const openBrackets = (cleaned.match(/\[/g) || []).length;
      const closeBrackets = (cleaned.match(/\]/g) || []).length;
      cleaned += ']'.repeat(openBrackets - closeBrackets);
    }
  }

  console.log('📝 Extracted JSON candidate:', cleaned.substring(0, 200));

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('❌ JSON.parse failed. Full cleaned string:', cleaned);
    throw new Error('AI response is not valid JSON');
  }
};

// SHORTER system prompt to avoid token truncation
const SEO_SYSTEM_PROMPT = `You are an SEO strategist. Analyze SERP data and trends. Return ONLY valid JSON (no markdown) with this structure. Keep keyword volumes realistic and varied (not all same). Content titles must be unique.

{
  "trend_score": "Seasonal" or "Evergreen",
  "trend_insight": string,
  "keywords": [
    { "keyword": string, "volume": number, "kd": number, "cpc": number, "intent": string }
  ] (50, sorted by volume),
  "serp_analysis": [
    { "position": number, "title": string, "url": string, "da": number, "word_count": number, "backlinks": number }
  ] (10, from data),
  "content_calendar": [
    { "week": number, "title": string, "keyword": string, "content_type": string, "word_count_target": number }
  ] (24),
  "backlink_strategy": {
    "overview": string,
    "target_sites": [ { "site": string, "type": string } ] (5),
    "guest_post_ideas": [string] (3)
  },
  "onpage_checklist": [string] (10),
  "chart_data": {
    "trend_12m": number[] (12),
    "keyword_difficulty_distribution": { "easy": number, "medium": number, "hard": number }
  }
}`;

function generateSEOMarkdown(analysis: any, niche: string, country: string): string {
  const countryNames: Record<string, string> = {
    us: 'United States 🇺🇸',
    pk: 'Pakistan 🇵🇰',
    gb: 'United Kingdom 🇬🇧',
    ae: 'United Arab Emirates 🇦🇪',
    sa: 'Saudi Arabia 🇸🇦',
  };

  const difficultyLabel = (kd: number) => {
    if (kd <= 30) return '🟢 Easy';
    if (kd <= 60) return '🟡 Medium';
    return '🔴 Hard';
  };

  return `# 🔍 SEO Report: ${niche}
## Target Market: ${countryNames[country] || country.toUpperCase()}

---

## 📊 Trend Analysis: **${analysis.trend_score}**

${analysis.trend_insight || ''}

---

## 🏆 Top Keywords
${analysis.keywords?.slice(0, 30).map((k: any, i: number) => 
  `- **${k.keyword}** (Vol: ${k.volume}, KD: ${k.kd}, CPC: $${k.cpc}) [${k.intent}]`
).join('\n') || 'None'}

---

## 📈 SERP Analysis
${analysis.serp_analysis?.map((s: any) => 
  `### #${s.position} ${s.title}\n- URL: ${s.url}\n- DA: ${s.da}\n- Words: ${s.word_count}\n- Backlinks: ${s.backlinks}`
).join('\n\n') || 'None'}

---

## 📅 Content Calendar
${analysis.content_calendar?.map((c: any) => 
  `### Week ${c.week}: ${c.title}\n- Keyword: ${c.keyword}\n- Type: ${c.content_type}`
).join('\n') || 'None'}

---

## 🔗 Backlink Strategy
${analysis.backlink_strategy?.overview || ''}
${analysis.backlink_strategy?.target_sites?.map((s: any) => `- ${s.site} (${s.type})`).join('\n') || ''}

---

*Report by MarketMuse AI PRO MAX ULTRA*`;
}

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const countryUpper = country.toUpperCase();
    
    const cacheKey = `seo_report_${niche}_${country}`;
    const cached = cacheService.get(cacheKey);
    if (cached) {
      console.log('📦 Returning cached SEO report');
      return res.json(cached);
    }

    console.log(`🔍 Starting SEO research: "${niche}" in ${countryUpper}`);

    const [searchData, keywordSuggestions, trendsData] = await Promise.all([
      getSearchResults(niche, country),
      getKeywordSuggestions(niche, country),
      getTrends(niche, countryUpper),
    ]);

    const serpOrganic = (searchData as any).organic_results?.slice(0, 5).map((r: any) => ({
      position: r.position,
      title: r.title,
      url: r.link,
    })) || [];

    // Shorter user message
    const userMessage = `Niche: ${niche}\nCountry: ${country}\nSERP Top 5: ${JSON.stringify(serpOrganic)}\nTrends: ${JSON.stringify(trendsData.slice(0,6))}`;

    console.log('🤖 Requesting Groq SEO...');
    const groqResponse = await runGroqWithRetry(SEO_SYSTEM_PROMPT, userMessage);
    const analysis = extractJSON(groqResponse);

    if (!analysis.keywords || !analysis.serp_analysis) {
      throw new Error('AI response missing required SEO fields');
    }

    const markdown = generateSEOMarkdown(analysis, niche, country);

    const charts = {
      trends: trendsData,
      trendScore: analysis.trend_score,
      keywords: analysis.keywords || [],
    };

    const report = await Report.create({
      type: 'seo',
      niche,
      country,
      value: '$99',
      data: analysis,
      markdown,
      charts,
    });

    console.log('✅ SEO report generated:', report._id);

    const result = {
      id: report._id,
      type: report.type,
      niche: report.niche,
      country: report.country,
      value: report.value,
      data: analysis,
      markdown: report.markdown,
      charts: charts,
      createdAt: report.createdAt,
    };

    cacheService.set(cacheKey, result, 86400);
    return res.status(201).json(result);

  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    next(err);
  }
};

export const getSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (report.type !== 'seo') return res.status(400).json({ error: 'Not an SEO report' });
    res.json(report);
  } catch (err) {
    next(err);
  }
};
