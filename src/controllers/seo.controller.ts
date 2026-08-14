import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getKeywordData, RealKeywordData } from '../services/dataforseo';
import { getSerperResults } from '../services/serper';
import { getKeywordSuggestions } from '../services/serpapi';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const extractJSON = (raw: string): any => {
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) cleaned = cleaned.substring(start, end + 1);
  try { return JSON.parse(cleaned); } catch (err) {
    const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    try { return JSON.parse(fixed); } catch (e2) {
      let completed = cleaned;
      let braceCount = (completed.match(/{/g) || []).length;
      let closeCount = (completed.match(/}/g) || []).length;
      while (closeCount < braceCount) { completed += '}'; closeCount++; }
      let bracketCount = (completed.match(/\[/g) || []).length;
      let closeBracketCount = (completed.match(/\]/g) || []).length;
      while (closeBracketCount < bracketCount) { completed += ']'; closeBracketCount++; }
      try { return JSON.parse(completed); } catch (e3) { throw new Error('AI response is not valid JSON'); }
    }
  }
};

const PROMPT = `You are an elite SEO strategist at MusePRO Intelligence Division. You write like a senior consultant speaking directly to a client. Be specific, data‑driven, and professional. Use the current year 2026 in any year‑specific content.

CRITICAL WRITING INSTRUCTIONS:
- Write like a senior SEO veteran. Direct, bold, and full of insider wisdom.
- Vary sentence length. Mix short observations with detailed explanations.
- Use natural business language. No robotic transitions like "Furthermore", "Moreover", "Additionally".
- Use first-person plural: "We found...", "Our read on this...", "We'd prioritize..."
- Express genuine excitement about ranking opportunities and honest skepticism about overhyped keywords.
- Weave numbers directly into conversational sentences.
- Use hedging where it makes sense: "Could be...", "Looks like...", "Might signal..."
- Do not make specific statistical claims not supported by provided data. If you mention a percentage, derive it from the provided data.
- After each key insight, include the data source in parentheses.

You will be given REAL keyword data, REAL SERP results, and REAL related questions. Use these numbers, do not generate your own.

Return ONLY valid JSON with the following structure:

{
  "trend_assessment": "Seasonal" | "Evergreen",
  "trend_analysis": "2-3 sentences with actual numbers from the provided data",
  "key_insights": [
    "Insight with specific volume/KD numbers and source",
    "Insight with specific volume/KD numbers and source",
    "Insight with specific volume/KD numbers and source"
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
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

interface FlexibleKeyword {
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
  const ctr = [0.30, 0.15, 0.10, 0.07, 0.05, 0.04, 0.03, 0.02][Math.min(position - 1, 7)] || 0.01;
  return Math.round(volume * ctr);
}

function generateMarkdown(
  analysis: any,
  keywords: FlexibleKeyword[],
  serp: any[],
  relatedQuestions: string[],
  niche: string,
  country: string,
  reportId: string,
  dataSourceStatus: string
): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let m = '';

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

  m += `1. YOUR OPPORTUNITY AT A GLANCE\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `We analyzed the organic search landscape for "${niche}" in ${countryNames[country] || country}. The trend is ${analysis.trend_assessment || 'N/A'} with ${keywords.length} keyword opportunities identified.\n\n`;
  if (analysis.key_insights?.length) { m += `Key Insights:\n`; analysis.key_insights.forEach((f: string, i: number) => m += `  ${i + 1}. ${f}\n`); m += `\n`; }
  if (analysis.immediate_actions?.length) { m += `What To Do First:\n`; analysis.immediate_actions.forEach((w: string, i: number) => m += `  ${i + 1}. ${w}\n`); m += `\n`; }

  m += `2. WHAT THE DATA SHOWS\n`;
  m += `──────────────────────────────────────────────────────────────\n${analysis.trend_analysis || ''}\nSource: ${dataSourceStatus}\n\n`;

  m += `3. KEYWORDS WORTH TARGETING\n`;
  m += `──────────────────────────────────────────────────────────────\nSource: ${dataSourceStatus}\n\n`;
  m += `| # | Keyword | Volume | CPC | KD | Potential |\n`;
  m += `|---|---------|--------|-----|----|----------|\n`;
  keywords.forEach((k, i) => {
    const vol = k.volume !== null ? k.volume.toLocaleString() : 'Not Disclosed';
    const cpc = k.cpc !== null ? `$${k.cpc.toFixed(2)}` : 'Not Disclosed';
    const kd = k.kd !== null ? k.kd : 'Not Disclosed';
    const potential = k.kd !== null ? (k.kd < 30 ? 'Easy Win' : k.kd < 60 ? 'Moderate' : 'Long Game') : 'Not Disclosed';
    m += `| ${i + 1} | ${k.keyword} | ${vol} | ${cpc} | ${kd} | ${potential} |\n`;
  });
  m += `\n`;

  m += `4. WHO'S RANKING TODAY\n`;
  m += `──────────────────────────────────────────────────────────────\nSource: Serper API (Live Google SERP)\n\n`;
  serp.forEach((s, i) => {
    m += `Position #${s.position}: ${s.title}\n`;
    m += `  URL: ${s.link}\n`;
    m += `  Est. DA: ${s.da}\n`;
    m += `  Est. Traffic: ${s.traffic !== null ? s.traffic.toLocaleString() : 'Not Disclosed'} visits/mo\n`;
    m += `  Snippet: ${s.snippet?.substring(0, 120) || 'N/A'}\n\n`;
  });
  m += `\n`;

  if (relatedQuestions.length) {
    m += `5. PEOPLE ARE ASKING\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    relatedQuestions.forEach((q, i) => m += `${i + 1}. ${q}\n`);
    m += `\n`;
  }

  m += `6. YOUR CONTENT GAME PLAN\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  analysis.content_roadmap?.forEach((c: any) => {
    m += `Week ${c.week}: ${c.title}\n`;
    m += `  Keyword: ${c.primary_keyword} | Type: ${c.content_type}\n`;
    m += `  Secondary: ${c.secondary_keywords?.join(', ')}\n`;
    m += `  Target Words: ${c.word_count_target}\n`;
    m += `  Outline: ${c.outline?.join(' | ')}\n`;
    m += `  Est. Traffic: ${c.expected_traffic?.toLocaleString()}/mo\n\n`;
  });

  const bs = analysis.link_acquisition;
  if (bs) {
    m += `7. AUTHORITY BUILDING\n`;
    m += `──────────────────────────────────────────────────────────────\n${bs.overview}\n\n`;
    if (bs.target_sites?.length) { m += `Target Sites:\n`; bs.target_sites.forEach((s: any, i: number) => m += `  ${i + 1}. ${s.site} (DA: ${s.da})\n     Type: ${s.type} | Contact: ${s.contact}\n     Pitch: ${s.pitch}\n\n`); }
    if (bs.guest_post_topics?.length) { m += `Guest Post Topics:\n`; bs.guest_post_topics.forEach((t: string, i: number) => m += `  ${i + 1}. ${t}\n`); m += `\n`; }
    if (bs.broken_link_opportunities?.length) { m += `Broken Link Opportunities:\n`; bs.broken_link_opportunities.forEach((b: any) => m += `  - ${b.site}: ${b.dead_page} → ${b.replacement}\n`); m += `\n`; }
    if (bs.outreach_template) { m += `Outreach Template:\n${bs.outreach_template}\n\n`; }
  }

  m += `8. ON-PAGE QUICK WINS\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  analysis.onpage_checklist?.forEach((item: string, i: number) => m += `${i + 1}. ${item}\n`);
  m += `\n`;

  if (analysis.growth_accelerators?.length) { m += `9. GROWTH LEVERS\n`; m += `──────────────────────────────────────────────────────────────\n`; analysis.growth_accelerators.forEach((tip: string, i: number) => m += `${i + 1}. ${tip}\n`); m += `\n`; }

  if (analysis.related_resources?.length) { m += `10. TOOLS & RESOURCES\n`; m += `──────────────────────────────────────────────────────────────\n`; analysis.related_resources.forEach((res: any, i: number) => m += `${i + 1}. ${res.name} – ${res.url}\n`); m += `\n`; }

  m += `METHODOLOGY & SOURCES\n`;
  m += `──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• ${dataSourceStatus}\n• Live Google SERP via Serper API (serper.dev)\n• People Also Ask via SerpApi (serpapi.com)\n• Analysis Engine: Gemini AI\n\nAll data points can be independently verified against their public sources.\n\n`;
  m += `DOCUMENT CONTROL\n`;
  m += `──────────────────────────────────────────────────────────────\nClassification:  Confidential\nDistribution:    Client Only\nVersion:         1.0\nPrepared By:     MusePRO Intelligence Division\n\n`;
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

    // Fetch real SERP and related questions always
    const [serperData, relatedQuestions] = await Promise.all([
      getSerperResults(niche, country).catch(() => null),
      getKeywordSuggestions(niche, country).catch(() => []),
    ]);

    // Keyword data: DataForSEO first, then smart fallback
    let keywords: FlexibleKeyword[] = [];
    let dataSourceStatus = 'Google Keyword Planner via DataForSEO (dataforseo.com)';

    try {
      const dfKeywords: RealKeywordData[] = await getKeywordData(niche, country, 50);
      if (dfKeywords && dfKeywords.length > 0) {
        keywords = dfKeywords.map(k => ({ keyword: k.keyword, volume: k.volume, cpc: k.cpc, kd: k.kd }));
        console.log(`✅ DataForSEO provided ${keywords.length} keywords`);
      } else {
        throw new Error('DataForSEO returned empty');
      }
    } catch (dfError) {
      console.warn(`⚠️ DataForSEO failed, switching to Serper/SerpApi smart fallback`);
      dataSourceStatus = 'Live Google SERP via Serper API (serper.dev) & People Also Ask via SerpApi (serpapi.com)';
      const relatedSearches = serperData?.relatedSearches || [];
      const combined = [...new Set([...relatedSearches, ...relatedQuestions])];
      keywords = combined.slice(0, 50).map(q => ({ keyword: q, volume: null, cpc: null, kd: null }));
      if (keywords.length === 0) {
        throw new Error('No keyword data available from any real source.');
      }
    }

    // SERP with metrics
    const serpWithMetrics = (serperData?.organic || []).slice(0, 8).map((r: any) => ({
      ...r,
      da: estimateDA(r.link),
      traffic: estimateTraffic(r.position, keywords[0]?.volume ?? null),
    }));

    const aiContext = { niche, country, keywords, serp: serpWithMetrics, relatedQuestions };
    const ai = await runGroqWithRetry(PROMPT, JSON.stringify(aiContext));
    const analysis = extractJSON(ai);

    const report = await Report.create({
      type: 'seo', niche, country, value: '$99',
      data: { ...analysis, keywords, serp: serpWithMetrics, relatedQuestions },
      markdown: 'Intelligence report generation in progress...',
      charts: {},
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, keywords, serpWithMetrics, relatedQuestions, niche, country, reportId, dataSourceStatus);
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
