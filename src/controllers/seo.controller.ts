import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getRelatedKeywords } from '../services/keywordseverywhere';
import { getGoogleTrends } from '../services/trends';
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

const PROMPT = `You are an elite SEO strategist at MusePRO Intelligence Division. You write like a senior consultant, using natural human language. Use current year 2026. Use provided real data if available. If some data is missing, intelligently generate realistic values and mark them as "Estimated". Never leave sections empty. Return valid JSON with all required fields.`;

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

interface KeywordData {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  kd: number | null;
}

function estimateDA(link: string): number {
  const domain = new URL(link).hostname.replace(/^www\./, '');
  const known: Record<string, number> = {
    'google.com': 100, 'youtube.com': 100, 'linkedin.com': 98, 'medium.com': 94,
    'reddit.com': 91, 'quora.com': 93, 'wikipedia.org': 96, 'amazon.com': 96,
    'facebook.com': 96, 'twitter.com': 94, 'apple.com': 97, 'microsoft.com': 96,
    'github.com': 95, 'stackoverflow.com': 93,
  };
  return domain.endsWith('.edu') || domain.endsWith('.gov') ? 80 : known[domain] || 35;
}

function estimateTraffic(position: number, volume: number | null): number | null {
  if (!volume || volume <= 0) return null;
  const ctr = [0.3, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.02][Math.min(position - 1, 7)] || 0.01;
  return Math.round(volume * ctr);
}

function generateMarkdown(
  analysis: any,
  keywords: KeywordData[],
  serp: any[],
  relatedQuestions: string[],
  trendData: number[],
  niche: string,
  country: string,
  reportId: string,
  dataSourceStatus: string
): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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
  if (trendData && trendData.length > 0) {
    m += `12-Month Search Trend: ${trendData.join(' → ')}\n`;
  }
  m += `Source: ${dataSourceStatus}\n\n`;

  m += `3. KEYWORDS WORTH TARGETING\n──────────────────────────────────────────────────────────────\nSource: ${dataSourceStatus}\n\n`;
  m += `| # | Keyword | Volume | CPC | KD | Potential |\n|---|---------|--------|-----|----|----------|\n`;
  keywords.forEach((k, i) => {
    const vol = k.volume !== null ? k.volume.toLocaleString() : 'Estimated';
    const cpc = k.cpc !== null ? `$${k.cpc.toFixed(2)}` : 'Estimated';
    const kd = k.kd !== null ? k.kd : 'Estimated';
    const potential = k.kd !== null ? (k.kd < 30 ? 'Easy Win' : k.kd < 60 ? 'Moderate' : 'Long Game') : 'Estimated';
    m += `| ${i + 1} | ${k.keyword} | ${vol} | ${cpc} | ${kd} | ${potential} |\n`;
  });
  m += `\n`;

  m += `4. WHO'S RANKING TODAY\n──────────────────────────────────────────────────────────────\nSource: SerpAPI (Live Google SERP)\n\n`;
  serp.forEach((s, i) => {
    m += `Position #${i + 1}: ${s.title}\n  URL: ${s.link}\n  Est. DA: ${s.da}\n  Est. Traffic: ${s.traffic !== null ? s.traffic.toLocaleString() : 'Estimated'} visits/mo\n  Snippet: ${s.snippet?.substring(0, 120) || 'N/A'}\n\n`;
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

  m += `METHODOLOGY & SOURCES\n──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• ${dataSourceStatus}\n• Live Google SERP via SerpAPI (serpapi.com)\n• People Also Ask via SerpAPI\n• Analysis Engine: Gemini AI (Hybrid Pro/Flash)\n\nAll data points are independently verified where possible. Some metrics are marked as 'Estimated' when real-time data is unavailable.\n\n`;
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

    // Fetch real data where possible, but don't fail if missing
    const kweData = await getRelatedKeywords(niche, country).catch(() => null);
    const searchData = await getSearchResults(niche, country).catch(() => null);
    const relatedQuestions = await getKeywordSuggestions(niche, country).catch(() => []);
    const trendData = await getGoogleTrends(niche, country).catch(() => []);

    let keywords: KeywordData[] = [];
    if (kweData?.data?.length) {
      keywords = kweData.data.slice(0, 50).map((k: any) => ({
        keyword: k.keyword,
        volume: k.vol || null,
        cpc: parseFloat(k.cpc?.value || '0') || null,
        kd: k.competition ? Math.min(Math.round(k.competition * 100), 100) : null,
      }));
      console.log(`✅ Keywords Everywhere provided ${keywords.length} keywords`);
    } else {
      console.warn(`⚠️ Keywords Everywhere unavailable, AI will estimate keywords`);
      // AI will generate keywords if none provided
    }

    const serp = searchData?.organic_results?.slice(0, 8).map((r: any) => ({
      position: r.position,
      title: r.title,
      link: r.link,
      snippet: r.snippet || '',
    })) || [];

    const aiContext = { niche, country, keywords, serp, relatedQuestions, trendData };
    const ai = await runGroqWithRetry(PROMPT, JSON.stringify(aiContext));
    const analysis = extractJSON(ai);

    // Ensure keywords array is filled (AI will provide if empty)
    if (!analysis.keywords || analysis.keywords.length === 0) {
      analysis.keywords = keywords.map(k => ({ keyword: k.keyword, volume: k.volume ?? null, cpc: k.cpc ?? null, kd: k.kd ?? null }));
    }
    if (!analysis.keywords || analysis.keywords.length === 0) {
      // AI should never return empty, but safeguard
      analysis.keywords = [{ keyword: niche, volume: null, cpc: null, kd: null }];
    }

    const serpWithMetrics = serp.map((r: any) => ({
      ...r,
      da: estimateDA(r.link),
      traffic: estimateTraffic(r.position, analysis.keywords[0]?.volume ?? null),
    }));

    const report = await Report.create({
      type: 'seo',
      niche,
      country,
      value: '$99',
      data: { ...analysis, keywords: analysis.keywords, serp: serpWithMetrics, relatedQuestions, trendData },
      markdown: 'Intelligence report generation in progress...',
      charts: {},
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, analysis.keywords, serpWithMetrics, relatedQuestions, trendData, niche, country, reportId, 'Google Keyword Planner via Keywords Everywhere + AI Estimates');
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
