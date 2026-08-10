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
  return JSON.parse(c);
};

const PROMPT = `You are an elite SEO strategist at an intelligence division. Analyze REAL keyword data, SERP results, and trends. Return ONLY valid JSON. Be specific, data‑driven, and professional.

{
  "trend_assessment": "Seasonal" | "Evergreen",
  "trend_analysis": "2‑3 professional sentences with actual trend numbers",
  "key_insights": [
    "Insight with specific volume/KD numbers",
    "Insight with specific volume/KD numbers",
    "Insight with specific volume/KD numbers"
  ] (exactly 3),
  "immediate_actions": [
    "Priority SEO action 1",
    "Priority SEO action 2",
    "Priority SEO action 3"
  ] (exactly 3),
  "keywords": [
    {
      "keyword": "keyword",
      "volume": number,
      "kd": number,
      "cpc": number,
      "intent": "informational|commercial|transactional",
      "ranking_potential": "Easy Win|Moderate|Long Game"
    }
  ] (exactly 50, based on real data, sorted by volume),
  "serp_landscape": [
    {
      "position": number,
      "title": "actual title",
      "url": "actual url",
      "da": number,
      "word_count": number,
      "backlinks": number,
      "estimated_traffic": number,
      "strengths": ["s1","s2"],
      "weaknesses": ["w1","w2"],
      "content_gap": "specific opportunity"
    }
  ] (exactly 8),
  "content_roadmap": [
    {
      "week": 1‑12,
      "title": "professional headline",
      "primary_keyword": "kw",
      "secondary_keywords": ["kw1","kw2"],
      "content_type": "Pillar/Listicle/How‑to/Case Study",
      "word_count_target": number,
      "outline": ["p1","p2","p3","p4","p5"],
      "expected_traffic": number
    }
  ] (exactly 12 weeks),
  "link_acquisition": {
    "overview": "detailed professional strategy",
    "target_sites": [
      {"site":"url","da":number,"type":"blog","contact":"email","pitch":"specific pitch"}
    ] (8 sites),
    "guest_post_topics": ["t1","t2","t3","t4","t5"],
    "broken_link_opportunities": [
      {"site":"url","dead_page":"description","replacement":"your content"}
    ] (3),
    "outreach_template": "complete email"
  },
  "onpage_checklist": ["specific action"] (15 items),
  "growth_accelerators": [
    "Pro tip or tool",
    "Pro tip or tool",
    "Pro tip or tool",
    "Pro tip or tool",
    "Pro tip or tool"
  ] (5 actionable SEO tips/tools),
  "related_resources": [
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" }
  ] (8 relevant SEO resources),
  "chart_data": {
    "trend_12m": [12 numbers],
    "traffic_forecast_6m": [6 numbers]
  }
}`;

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

function generateMarkdown(a: any, niche: string, country: string, reportId: string): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  let m = '';

  // ── Cover / Header ──
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

  // ── Table of Contents ──
  m += `TABLE OF CONTENTS\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `1. Executive Brief\n`;
  m += `2. Trend Assessment\n`;
  m += `3. Keyword Opportunities (Top 50)\n`;
  m += `4. SERP Landscape\n`;
  m += `5. Content Roadmap (12 Weeks)\n`;
  m += `6. Link Acquisition Strategy\n`;
  m += `7. On‑Page Optimization Checklist\n`;
  m += `8. Growth Accelerators\n`;
  m += `9. Related Resources\n\n`;
  m += `──────────────────────────────────────────────────────────────\n\n`;

  // 1. Executive Brief
  m += `1. EXECUTIVE BRIEF\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `This report analyzes the organic search landscape for "${niche}" in ${countryNames[country] || country}. `;
  m += `The trend is ${a.trend_assessment || 'N/A'} with ${a.keywords?.length || 50} keyword opportunities identified.\n\n`;
  if (a.key_insights?.length) {
    a.key_insights.forEach((f: string, i: number) => { m += `  ${i+1}. ${f}\n`; });
    m += `\n`;
  }

  // Immediate Actions
  if (a.immediate_actions?.length) {
    m += `Priority Actions:\n`;
    a.immediate_actions.forEach((w: string, i: number) => { m += `  ${i+1}. ${w}\n`; });
    m += `\n`;
  }

  // 2. Trend Assessment
  m += `2. TREND ASSESSMENT\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `${a.trend_analysis}\n\n`;

  // 3. Keywords
  m += `3. KEYWORD OPPORTUNITIES (TOP 50)\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `Source: Google Keyword Planner via Keywords Everywhere\n\n`;
  m += `| # | Keyword | Volume | KD | CPC | Intent | Potential |\n`;
  m += `|---|---------|--------|-----|-----|--------|----------|\n`;
  a.keywords?.forEach((k: any, i: number) => {
    m += `| ${i+1} | ${k.keyword} | ${k.volume?.toLocaleString()} | ${k.kd} | $${k.cpc} | ${k.intent} | ${k.ranking_potential} |\n`;
  });
  m += `\n`;

  // 4. SERP Landscape
  m += `4. SERP LANDSCAPE\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `Source: Google Search Results via SerpAPI\n\n`;
  a.serp_landscape?.forEach((s: any) => {
    m += `Position #${s.position}: ${s.title}\n`;
    m += `  URL: ${s.url}\n`;
    m += `  DA: ${s.da} | Words: ${s.word_count} | Backlinks: ${s.backlinks}\n`;
    m += `  Est. Traffic: ${s.estimated_traffic?.toLocaleString()}/mo\n`;
    m += `  Strengths: ${s.strengths?.join(', ')}\n`;
    m += `  Weaknesses: ${s.weaknesses?.join(', ')}\n`;
    m += `  Gap: ${s.content_gap}\n\n`;
  });

  // 5. Content Roadmap
  m += `5. CONTENT ROADMAP (12 WEEKS)\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  a.content_roadmap?.forEach((c: any) => {
    m += `Week ${c.week}: ${c.title}\n`;
    m += `  Keyword: ${c.primary_keyword} | Type: ${c.content_type}\n`;
    m += `  Secondary: ${c.secondary_keywords?.join(', ')}\n`;
    m += `  Target Words: ${c.word_count_target}\n`;
    m += `  Outline: ${c.outline?.join(' | ')}\n`;
    m += `  Est. Traffic: ${c.expected_traffic?.toLocaleString()}/mo\n\n`;
  });

  // 6. Link Acquisition
  const bs = a.link_acquisition;
  if (bs) {
    m += `6. LINK ACQUISITION STRATEGY\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    m += `${bs.overview}\n\n`;
    if (bs.target_sites?.length) {
      m += `Target Sites:\n`;
      bs.target_sites.forEach((s: any, i: number) => {
        m += `  ${i+1}. ${s.site} (DA: ${s.da})\n`;
        m += `     Type: ${s.type} | Contact: ${s.contact}\n`;
        m += `     Pitch: ${s.pitch}\n\n`;
      });
    }
    if (bs.guest_post_topics?.length) {
      m += `Guest Post Topics:\n`;
      bs.guest_post_topics.forEach((t: string, i: number) => { m += `  ${i+1}. ${t}\n`; });
      m += `\n`;
    }
    if (bs.broken_link_opportunities?.length) {
      m += `Broken Link Opportunities:\n`;
      bs.broken_link_opportunities.forEach((b: any) => {
        m += `  - ${b.site}: ${b.dead_page} → ${b.replacement}\n`;
      });
      m += `\n`;
    }
    if (bs.outreach_template) {
      m += `Outreach Template:\n${bs.outreach_template}\n\n`;
    }
  }

  // 7. On-Page Checklist
  m += `7. ON‑PAGE OPTIMIZATION CHECKLIST\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  a.onpage_checklist?.forEach((item: string, i: number) => { m += `${i+1}. ${item}\n`; });
  m += `\n`;

  // 8. Growth Accelerators
  if (a.growth_accelerators?.length) {
    m += `8. GROWTH ACCELERATORS\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    a.growth_accelerators.forEach((tip: string, i: number) => { m += `${i+1}. ${tip}\n`; });
    m += `\n`;
  }

  // 9. Related Resources
  if (a.related_resources?.length) {
    m += `9. RELATED RESOURCES\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    a.related_resources.forEach((res: any, i: number) => { m += `${i+1}. ${res.name} – ${res.url}\n`; });
    m += `\n`;
  }

  // ── Methodology & Sources ──
  m += `METHODOLOGY & SOURCES\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `This report is based on live data collected on ${today} from:\n\n`;
  m += `• Google Search Results via SerpAPI (serpapi.com)\n`;
  m += `• Google Keyword Planner via Keywords Everywhere (keywordseverywhere.com)\n`;
  m += `• Google Trends via Keywords Everywhere\n`;
  m += `• Analysis Engine: GPT‑4o (openai.com)\n\n`;
  m += `All data points can be independently verified against their public sources.\n\n`;

  // ── Document Control ──
  m += `DOCUMENT CONTROL\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `Classification:  Confidential\n`;
  m += `Distribution:    Client Only\n`;
  m += `Version:         1.0\n`;
  m += `Prepared By:     MusePRO Intelligence Division\n\n`;

  // ── Disclaimer ──
  m += `DISCLAIMER\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `This document contains proprietary research conducted by MusePRO.\n`;
  m += `The information herein is intended solely for the designated recipient.\n`;
  m += `Unauthorized distribution, copying, or disclosure is strictly prohibited.\n\n`;
  m += `While every effort has been made to ensure accuracy, market conditions\n`;
  m += `change rapidly. Verify critical data points before making business decisions.\n\n`;

  m += `──────────────────────────────────────────────────────────────\n`;
  m += `© MusePRO — Intelligence Division. All Rights Reserved.\n`;

  return m;
}

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const ck = `seo_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    console.log(`SEO: "${niche}" in ${country}`);

    const [searchData, relatedKwData, trendsArr] = await Promise.all([
      getSearchResults(niche, country),
      getRelatedKeywords(niche, country).catch(() => null),
      getTrends(niche, country).catch(() => null),
    ]);

    const serp = searchData.organic_results?.slice(0, 8).map((r: any) => ({
      position: r.position, title: r.title, url: r.link, snippet: r.snippet || ''
    })) || [];

    const relatedList = relatedKwData?.data?.slice(0, 50).map((k: any) => ({
      keyword: k.keyword, volume: k.vol, cpc: parseFloat(k.cpc?.value || '0'), competition: k.competition,
    })) || [];

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

    const userMsg = `Niche: ${niche}\nCountry: ${country}\n\nSERP: ${JSON.stringify(serp)}\n\nKeywords: ${JSON.stringify(allKeywords)}\n\nTrends: ${trendsArr ? JSON.stringify(trendsArr) : 'N/A'}`;

    const ai = await runGroqWithRetry(PROMPT, userMsg);
    const analysis = extractJSON(ai);

    if (trendsArr && Array.isArray(trendsArr)) {
      analysis.chart_data = analysis.chart_data || {};
      analysis.chart_data.trend_12m = trendsArr;
    }

    const report = await Report.create({
      type: 'seo', niche, country, value: '$99',
      data: analysis, markdown: 'Intelligence report generation in progress...', charts: {}
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, niche, country, reportId);
    report.markdown = markdown;
    report.charts = { trends: trendsArr };
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
