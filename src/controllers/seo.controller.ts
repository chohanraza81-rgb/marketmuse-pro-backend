import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getSearchResults } from '../services/serpapi';
import { getRelatedKeywords, getTrends } from '../services/keywordseverywhere';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

// Robust JSON extraction
const extractJSON = (raw: string): any => {
  let cleaned = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const fixed = cleaned
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']')
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      let completed = cleaned;
      let braceCount = (completed.match(/{/g) || []).length;
      let closeCount = (completed.match(/}/g) || []).length;
      while (closeCount < braceCount) {
        completed += '}';
        closeCount++;
      }
      let bracketCount = (completed.match(/\[/g) || []).length;
      let closeBracketCount = (completed.match(/\]/g) || []).length;
      while (closeBracketCount < bracketCount) {
        completed += ']';
        closeBracketCount++;
      }
      try {
        return JSON.parse(completed);
      } catch (e3) {
        console.error('❌ JSON extraction failed. Raw length:', raw.length);
        console.error('Last 500 chars:', cleaned.substring(cleaned.length - 500));
        throw new Error('AI response is not valid JSON');
      }
    }
  }
};

const PROMPT = `You are an elite SEO strategist at MusePRO Intelligence Division. You write like a senior consultant speaking directly to a client. Be specific, data‑driven, and professional. Use the current year 2026 in any year‑specific content.

CRITICAL WRITING INSTRUCTIONS:
- Write like a senior SEO veteran who has seen it all. Direct, bold, and full of insider wisdom.
- Vary your sentence length. Mix short observations with detailed explanations.
- Use natural business language. No robotic transitions like "Furthermore", "Moreover", "Additionally".
- Use first-person plural freely: "We found...", "Our read on this...", "We'd prioritize..."
- Express genuine excitement about ranking opportunities and honest skepticism about overhyped keywords.
- Weave numbers directly into conversational sentences.
- Use hedging where it makes sense: "Could be...", "Looks like...", "Might signal..."
- Do not make specific statistical claims that are not directly supported by the provided data. If you mention a percentage or growth figure, ensure it is derived from the provided trends or keyword metrics, otherwise phrase as 'data suggests' or 'we estimate'.
- After each key insight, include the data source in parentheses, e.g., "(Source: Google Keyword Planner)" or "(Source: Google Search Results)".

You will be given REAL keyword data, REAL SERP results, and REAL trend data. Use these numbers, do not generate your own.

Return ONLY valid JSON with the following structure (all fields are required):

{
  "trend_assessment": "Seasonal" | "Evergreen",
  "trend_analysis": "2-3 sentences with actual trend numbers from the provided data",
  "key_insights": [
    "Insight with specific volume/KD numbers from provided data and source at end",
    "Insight with specific volume/KD numbers from provided data and source at end",
    "Insight with specific volume/KD numbers from provided data and source at end"
  ],
  "immediate_actions": [
    "Priority SEO action 1",
    "Priority SEO action 2",
    "Priority SEO action 3"
  ],
  "content_roadmap": [
    {
      "week": 1,
      "title": "string",
      "primary_keyword": "string (use a real keyword from provided list)",
      "secondary_keywords": ["string", "string"],
      "content_type": "Pillar|Listicle|How-to|Case Study",
      "word_count_target": 2000,
      "outline": ["string", "string", "string", "string", "string"],
      "expected_traffic": 100
    }
  ] (exactly 12 weeks),
  "link_acquisition": {
    "overview": "string",
    "target_sites": [
      {
        "site": "string",
        "da": 50,
        "type": "blog",
        "contact": "email",
        "pitch": "string"
      }
    ] (8 sites),
    "guest_post_topics": ["string", "string", "string", "string", "string"],
    "broken_link_opportunities": [
      {
        "site": "string",
        "dead_page": "string",
        "replacement": "string"
      }
    ] (3),
    "outreach_template": "string"
  },
  "onpage_checklist": ["string"] (15 items),
  "growth_accelerators": ["string"] (5 tips),
  "related_resources": [
    { "name": "string", "url": "string" }
  ] (8 resources)
}`;

const countryNames: Record<string, string> = {
  us: 'United States',
  gb: 'United Kingdom',
  ca: 'Canada',
  au: 'Australia',
  de: 'Germany',
  sg: 'Singapore',
  sa: 'Saudi Arabia',
  ae: 'United Arab Emirates',
  pk: 'Pakistan',
  in: 'India',
  tr: 'Turkey',
  my: 'Malaysia',
};

interface RealKeyword {
  keyword: string;
  volume: number;
  cpc: number;
  competition: number; // 0-1, we'll convert to KD later if needed
  intent?: string;
  ranking_potential?: string;
}

function generateMarkdown(
  analysis: any,
  realKeywords: RealKeyword[],
  realSerp: any[],
  trendData: number[] | null,
  niche: string,
  country: string,
  reportId: string
): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  let m = '';

  // Header
  m += `MusePRO\n`;
  m += `Real-Time Market Research\n`;
  m += `Intelligence Division\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `SEO RESEARCH REPORT\n\n`;
  m += `Prepared For: [Client Name]\n`;
  m += `Date: ${today}\n`;
  m += `Reference: ${reportId}\n`;
  m += `Classification: CONFIDENTIAL\n`;
  m += `──────────────────────────────────────────────────────────────\n\n`;

  // 1
  m += `1. YOUR OPPORTUNITY AT A GLANCE\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `We analyzed the organic search landscape for "${niche}" in ${countryNames[country] || country}. The trend is ${analysis.trend_assessment || 'N/A'} with ${realKeywords.length} keyword opportunities identified.\n\n`;
  if (analysis.key_insights?.length) {
    m += `Key Insights:\n`;
    analysis.key_insights.forEach((f: string, i: number) => { m += `  ${i+1}. ${f}\n`; });
    m += `\n`;
  }
  if (analysis.immediate_actions?.length) {
    m += `What To Do First:\n`;
    analysis.immediate_actions.forEach((w: string, i: number) => { m += `  ${i+1}. ${w}\n`; });
    m += `\n`;
  }

  // 2
  m += `2. WHAT THE DATA SHOWS\n`;
  m += `──────────────────────────────────────────────────────────────\n${analysis.trend_analysis || ''}\n`;
  m += `Source: Google Trends via Keywords Everywhere\n\n`;

  // 3
  m += `3. KEYWORDS WORTH TARGETING\n`;
  m += `──────────────────────────────────────────────────────────────\nSource: Google Keyword Planner via Keywords Everywhere\n\n`;
  m += `| # | Keyword | Volume | CPC | Intent | Potential |\n`;
  m += `|---|---------|--------|-----|--------|----------|\n`;
  realKeywords.forEach((k, i) => {
    const intent = k.intent || 'informational';
    const potential = k.competition < 0.33 ? 'Easy Win' : k.competition < 0.66 ? 'Moderate' : 'Long Game';
    m += `| ${i+1} | ${k.keyword} | ${k.volume?.toLocaleString()} | $${k.cpc?.toFixed(2)} | ${intent} | ${potential} |\n`;
  });
  m += `\n`;

  // 4
  m += `4. WHO'S RANKING TODAY\n`;
  m += `──────────────────────────────────────────────────────────────\nSource: Google Search Results via SerpAPI\n\n`;
  realSerp.forEach((s, i) => {
    m += `Position #${i+1}: ${s.title}\n`;
    m += `  URL: ${s.url}\n`;
    m += `  Snippet: ${s.snippet?.substring(0, 120) || 'N/A'}\n\n`;
  });
  m += `\n`;

  // 5
  m += `5. YOUR CONTENT GAME PLAN\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  analysis.content_roadmap?.forEach((c: any) => {
    m += `Week ${c.week}: ${c.title}\n`;
    m += `  Keyword: ${c.primary_keyword} | Type: ${c.content_type}\n`;
    m += `  Secondary: ${c.secondary_keywords?.join(', ')}\n`;
    m += `  Target Words: ${c.word_count_target}\n`;
    m += `  Outline: ${c.outline?.join(' | ')}\n`;
    m += `  Est. Traffic: ${c.expected_traffic?.toLocaleString()}/mo\n\n`;
  });

  // 6
  const bs = analysis.link_acquisition;
  if (bs) {
    m += `6. AUTHORITY BUILDING\n`;
    m += `──────────────────────────────────────────────────────────────\n${bs.overview}\n\n`;
    if (bs.target_sites?.length) {
      m += `Target Sites:\n`;
      bs.target_sites.forEach((s: any, i: number) => {
        m += `  ${i+1}. ${s.site} (DA: ${s.da})\n     Type: ${s.type} | Contact: ${s.contact}\n     Pitch: ${s.pitch}\n\n`;
      });
    }
    if (bs.guest_post_topics?.length) {
      m += `Guest Post Topics:\n`;
      bs.guest_post_topics.forEach((t: string, i: number) => { m += `  ${i+1}. ${t}\n`; });
      m += `\n`;
    }
    if (bs.broken_link_opportunities?.length) {
      m += `Broken Link Opportunities:\n`;
      bs.broken_link_opportunities.forEach((b: any) => { m += `  - ${b.site}: ${b.dead_page} → ${b.replacement}\n`; });
      m += `\n`;
    }
    if (bs.outreach_template) {
      m += `Outreach Template:\n${bs.outreach_template}\n\n`;
    }
  }

  // 7
  m += `7. ON-PAGE QUICK WINS\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  analysis.onpage_checklist?.forEach((item: string, i: number) => { m += `${i+1}. ${item}\n`; });
  m += `\n`;

  // 8
  if (analysis.growth_accelerators?.length) {
    m += `8. GROWTH LEVERS\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    analysis.growth_accelerators.forEach((tip: string, i: number) => { m += `${i+1}. ${tip}\n`; });
    m += `\n`;
  }

  // 9
  if (analysis.related_resources?.length) {
    m += `9. TOOLS & RESOURCES\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    analysis.related_resources.forEach((res: any, i: number) => { m += `${i+1}. ${res.name} – ${res.url}\n`; });
    m += `\n`;
  }

  // Methodology & Sources
  m += `METHODOLOGY & SOURCES\n`;
  m += `──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• Google Search Results via SerpAPI (serpapi.com)\n• Google Keyword Planner via Keywords Everywhere (keywordseverywhere.com)\n• Google Trends via Keywords Everywhere\n• Analysis Engine: GPT‑4o (openai.com)\n\nAll data points can be independently verified against their public sources.\n\n`;

  // Document Control
  m += `DOCUMENT CONTROL\n`;
  m += `──────────────────────────────────────────────────────────────\nClassification:  Confidential\nDistribution:    Client Only\nVersion:         1.0\nPrepared By:     MusePRO Intelligence Division\n\n`;

  // Disclaimer
  m += `DISCLAIMER\n`;
  m += `──────────────────────────────────────────────────────────────\nThis document contains proprietary research conducted by MusePRO. The information herein is intended solely for the designated recipient. Unauthorized distribution, copying, or disclosure is strictly prohibited.\n\nWhile every effort has been made to ensure accuracy, market conditions change rapidly. Verify critical data points before making business decisions.\n\n`;

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

    // 1. Fetch REAL data
    const [searchData, relatedKwData, trendsArr] = await Promise.all([
      getSearchResults(niche, country),
      getRelatedKeywords(niche, country).catch(() => null),
      getTrends(niche, country).catch(() => null),
    ]);

    // 2. Build real keywords array
    const realKeywords: RealKeyword[] = [];
    if (relatedKwData?.data?.length) {
      relatedKwData.data.slice(0, 50).forEach((k: any) => {
        realKeywords.push({
          keyword: k.keyword,
          volume: k.vol || 0,
          cpc: parseFloat(k.cpc?.value || '0'),
          competition: k.competition || 0,
          intent: k.intent || 'informational',
          ranking_potential: k.competition < 0.33 ? 'Easy Win' : k.competition < 0.66 ? 'Moderate' : 'Long Game',
        });
      });
    }

    // If KWE failed, try seed keyword metrics as fallback
    if (realKeywords.length === 0) {
      try {
        const { getKeywordMetrics } = await import('../services/keywordseverywhere');
        const m = await getKeywordMetrics([niche], country);
        if (m?.data?.[0]) {
          const seed = m.data[0];
          realKeywords.push({
            keyword: seed.keyword,
            volume: seed.vol || 0,
            cpc: parseFloat(seed.cpc?.value || '0'),
            competition: seed.competition || 0,
            intent: 'informational',
            ranking_potential: seed.competition < 0.33 ? 'Easy Win' : seed.competition < 0.66 ? 'Moderate' : 'Long Game',
          });
        }
      } catch {}
    }

    // 3. Build real SERP data
    const realSerp = searchData.organic_results?.slice(0, 8).map((r: any) => ({
      position: r.position,
      title: r.title,
      url: r.link,
      snippet: r.snippet || '',
    })) || [];

    // 4. Prepare trend data
    const trendArray = trendsArr && Array.isArray(trendsArr) ? trendsArr : null;

    // 5. AI prompt with real data context
    const aiContext = {
      niche,
      country,
      realKeywords,
      realSerp,
      trendData: trendArray,
    };

    const ai = await runGroqWithRetry(PROMPT, JSON.stringify(aiContext));
    const analysis = extractJSON(ai);

    // 6. Generate markdown with real data
    const report = await Report.create({
      type: 'seo',
      niche,
      country,
      value: '$99',
      data: {
        ...analysis,
        realKeywords,
        realSerp,
        trendData: trendArray,
      },
      markdown: 'Intelligence report generation in progress...',
      charts: { trends: trendArray },
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, realKeywords, realSerp, trendArray, niche, country, reportId);
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
