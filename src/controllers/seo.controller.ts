import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getRelatedKeywords, getTrends } from '../services/keywordseverywhere';
import { getSearchResults, getKeywordSuggestions } from '../services/serpapi';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const extractJSON = (raw: string): any => {
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) cleaned = cleaned.substring(start, end + 1);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      let completed = cleaned;
      let braceCount = (completed.match(/{/g) || []).length;
      let closeCount = (completed.match(/}/g) || []).length;
      while (closeCount < braceCount) { completed += '}'; closeCount++; }
      let bracketCount = (completed.match(/\[/g) || []).length;
      let closeBracketCount = (completed.match(/\]/g) || []).length;
      while (closeBracketCount < bracketCount) { completed += ']'; closeBracketCount++; }
      try {
        return JSON.parse(completed);
      } catch (e3) {
        throw new Error('AI response is not valid JSON');
      }
    }
  }
};

const PROMPT = `You are an elite SEO strategist at MusePRO Intelligence Division. Write like a senior consultant. Use current year 2026. Use provided real data only. Return valid JSON with all required sections. No undefined, no placeholder. If no value, use "Not Disclosed".`;

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

interface KeywordData {
  keyword: string;
  volume: number;
  cpc: number;
  kd: number;
}

function generateMarkdown(
  analysis: any,
  keywords: KeywordData[],
  serp: any[],
  relatedQuestions: string[],
  trendData: number[] | null,
  niche: string,
  country: string,
  reportId: string
): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const trendLine = trendData && trendData.length ? trendData : null;

  let m = '';

  m += `MusePRO\nReal-Time Market Research\nIntelligence Division\n──────────────────────────────────────────────────────────────\nSEO RESEARCH REPORT\n\nPrepared For: [Client Name]\nDate: ${today}\nReference: ${reportId}\nClassification: CONFIDENTIAL\n──────────────────────────────────────────────────────────────\n\n`;

  m += `1. YOUR OPPORTUNITY AT A GLANCE\n──────────────────────────────────────────────────────────────\n`;
  m += `We analyzed the organic search landscape for "${niche}" in ${countryNames[country] || country}. The trend is ${analysis.trend_assessment || 'Evergreen'} with ${keywords.length} keyword opportunities identified.\n\n`;
  if (analysis.key_insights?.length) {
    m += `Key Insights:\n`;
    analysis.key_insights.forEach((f: string, i: number) => (m += `  ${i + 1}. ${f}\n`));
    m += `\n`;
  }
  if (analysis.immediate_actions?.length) {
    m += `What To Do First:\n`;
    analysis.immediate_actions.forEach((w: string, i: number) => (m += `  ${i + 1}. ${w}\n`));
    m += `\n`;
  }

  m += `2. WHAT THE DATA SHOWS\n──────────────────────────────────────────────────────────────\n${typeof analysis.trend_analysis === 'string' ? analysis.trend_analysis : 'Not Disclosed'}\n`;
  if (trendLine) {
    m += `12-Month Trend Values: ${trendLine.join(', ')}\n`;
  }
  m += `Source: Google Keyword Planner via Keywords Everywhere (keywordseverywhere.com)\n\n`;

  m += `3. KEYWORDS WORTH TARGETING\n──────────────────────────────────────────────────────────────\nSource: Google Keyword Planner via Keywords Everywhere (keywordseverywhere.com)\n\n`;
  m += `| # | Keyword | Volume | CPC | KD | Potential |\n|---|---------|--------|-----|----|----------|\n`;
  keywords.forEach((k, i) => {
    const vol = k.volume ? k.volume.toLocaleString() : 'Not Disclosed';
    const cpc = k.cpc ? `$${k.cpc.toFixed(2)}` : 'Not Disclosed';
    const kd = k.kd ? k.kd : 'Not Disclosed';
    const potential = k.kd ? (k.kd < 30 ? 'Easy Win' : k.kd < 60 ? 'Moderate' : 'Long Game') : 'Not Disclosed';
    m += `| ${i + 1} | ${k.keyword} | ${vol} | ${cpc} | ${kd} | ${potential} |\n`;
  });
  m += `\n`;

  m += `4. WHO'S RANKING TODAY\n──────────────────────────────────────────────────────────────\nSource: SerpAPI (Live Google SERP)\n\n`;
  serp.forEach((s, i) => {
    m += `Position #${i + 1}: ${s.title}\n  URL: ${s.link}\n  Snippet: ${s.snippet?.substring(0, 120) || 'N/A'}\n\n`;
  });
  m += `\n`;

  if (relatedQuestions.length) {
    m += `5. PEOPLE ARE ASKING\n──────────────────────────────────────────────────────────────\n`;
    relatedQuestions.forEach((q, i) => (m += `${i + 1}. ${q}\n`));
    m += `\n`;
  }

  m += `6. YOUR CONTENT GAME PLAN\n──────────────────────────────────────────────────────────────\n`;
  analysis.content_roadmap?.forEach((c: any, idx: number) => {
    m += `Week ${c.week || idx + 1}: ${c.title || 'N/A'}\n  Keyword: ${c.primary_keyword || 'N/A'} | Type: ${c.content_type || 'N/A'}\n  Secondary: ${c.secondary_keywords?.join(', ') || 'N/A'}\n  Target Words: ${c.word_count_target || 'N/A'}\n  Outline: ${c.outline?.join(' | ') || 'N/A'}\n  Est. Traffic: ${c.expected_traffic?.toLocaleString() || 'N/A'}/mo\n\n`;
  });

  const bs = analysis.link_acquisition;
  if (bs) {
    m += `7. AUTHORITY BUILDING\n──────────────────────────────────────────────────────────────\n${bs.overview || 'N/A'}\n\n`;
    if (bs.target_sites?.length) {
      m += `Target Sites:\n`;
      bs.target_sites.forEach((s: any, i: number) => (m += `  ${i + 1}. ${s.site || 'N/A'} (DA: ${s.da || 'N/A'})\n     Type: ${s.type || 'N/A'} | Contact: ${s.contact || 'N/A'}\n     Pitch: ${s.pitch || 'N/A'}\n\n`));
    }
    if (bs.guest_post_topics?.length) {
      m += `Guest Post Topics:\n`;
      bs.guest_post_topics.forEach((t: string, i: number) => (m += `  ${i + 1}. ${t}\n`));
      m += `\n`;
    }
    if (bs.broken_link_opportunities?.length) {
      m += `Broken Link Opportunities:\n`;
      bs.broken_link_opportunities.forEach((b: any) => (m += `  - ${b.site}: ${b.dead_page} → ${b.replacement}\n`));
      m += `\n`;
    }
    if (bs.outreach_template) {
      m += `Outreach Template:\n${bs.outreach_template}\n\n`;
    }
  }

  m += `8. ON-PAGE QUICK WINS\n──────────────────────────────────────────────────────────────\n`;
  analysis.onpage_checklist?.forEach((item: string, i: number) => (m += `${i + 1}. ${item}\n`));
  m += `\n`;

  if (analysis.growth_accelerators?.length) {
    m += `9. GROWTH LEVERS\n──────────────────────────────────────────────────────────────\n`;
    analysis.growth_accelerators.forEach((tip: string, i: number) => (m += `${i + 1}. ${tip}\n`));
    m += `\n`;
  }

  if (analysis.related_resources?.length) {
    m += `10. TOOLS & RESOURCES\n──────────────────────────────────────────────────────────────\n`;
    analysis.related_resources.forEach((res: any, i: number) => (m += `${i + 1}. ${res.name || 'N/A'} – ${res.url || 'N/A'}\n`));
    m += `\n`;
  }

  m += `METHODOLOGY & SOURCES\n──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• Google Keyword Planner via Keywords Everywhere (keywordseverywhere.com)\n• Live Google SERP via SerpAPI (serpapi.com)\n• People Also Ask via SerpAPI\n• Analysis Engine: Gemini AI\n\nAll data points can be independently verified against their public sources.\n\n`;
  m += `DOCUMENT CONTROL\n──────────────────────────────────────────────────────────────\nClassification:  Confidential\nDistribution:    Client Only\nVersion:         1.0\nPrepared By:     MusePRO Intelligence Division\n\n`;
  m += `DISCLAIMER\n──────────────────────────────────────────────────────────────\nThis document contains proprietary research conducted by MusePRO. The information herein is intended solely for the designated recipient. Unauthorized distribution, copying, or disclosure is strictly prohibited.\n\nWhile every effort has been made to ensure accuracy, market conditions change rapidly. Verify critical data points before making business decisions.\n\n`;
  m += `──────────────────────────────────────────────────────────────\n© MusePRO — Intelligence Division. All Rights Reserved.\n`;

  return m;
}

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const ck = `seo_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    console.log(`SEO: "${niche}" in ${country}`);

    // Fetch real data
    const [serpData, relatedQuestions, kweData, trendArr] = await Promise.all([
      getSearchResults(niche, country),
      getKeywordSuggestions(niche, country).catch(() => []),
      getRelatedKeywords(niche, country).catch(() => null),
      getTrends(niche, country).catch(() => []),
    ]);

    // Build keyword list
    let keywords: KeywordData[] = [];
    if (kweData?.data?.length) {
      keywords = kweData.data.slice(0, 50).map((k: any) => ({
        keyword: k.keyword,
        volume: k.vol || 0,
        cpc: parseFloat(k.cpc?.value || '0'),
        kd: k.competition ? Math.min(Math.round(k.competition * 100), 100) : 0,
      }));
      console.log(`✅ Keywords Everywhere provided ${keywords.length} keywords`);
    } else {
      console.warn(`⚠️ Keywords Everywhere returned empty, using SERP titles as fallback`);
      keywords = serpData.organic_results?.slice(0, 30).map((r: any) => ({
        keyword: r.title,
        volume: 0,
        cpc: 0,
        kd: 0,
      })) || [];
    }

    if (keywords.length === 0) {
      throw new Error('No keyword data available. Please check Keywords Everywhere credits.');
    }

    const serp = serpData.organic_results?.slice(0, 8).map((r: any) => ({
      position: r.position,
      title: r.title,
      link: r.link,
      snippet: r.snippet || '',
    })) || [];

    const aiContext = { niche, country, keywords, serp, relatedQuestions, trendData: trendArr };
    const ai = await runGroqWithRetry(PROMPT, JSON.stringify(aiContext));
    const analysis = extractJSON(ai);

    const report = await Report.create({
      type: 'seo',
      niche,
      country,
      value: '$99',
      data: { ...analysis, keywords, serp, relatedQuestions, trendData: trendArr },
      markdown: 'Intelligence report generation in progress...',
      charts: {},
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, keywords, serp, relatedQuestions, trendArr, niche, country, reportId);
    report.markdown = markdown;
    await report.save();

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
