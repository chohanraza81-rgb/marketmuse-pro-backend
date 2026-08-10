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

const PROMPT = `You are an elite SEO strategist at a top digital agency. Analyze REAL keyword data, SERP results, and trends. Return ONLY valid JSON. Be specific, data-driven, and avoid generic advice.

{
  "trend_score": "Seasonal" | "Evergreen",
  "trend_insight": "2 sentences with actual trend numbers",
  "key_findings": [
    "Finding with specific volume/KD numbers",
    "Finding with specific volume/KD numbers",
    "Finding with specific volume/KD numbers"
  ] (exactly 3),
  "quick_wins": [
    "Immediate SEO action 1",
    "Immediate SEO action 2",
    "Immediate SEO action 3"
  ] (3 things that can be done today),
  "keywords": [
    {
      "keyword": "keyword",
      "volume": number,
      "kd": number,
      "cpc": number,
      "intent": "informational|commercial|transactional",
      "ranking_opportunity": "Easy Win|Moderate|Long Game"
    }
  ] (exactly 50, based on real data, sorted by volume),
  "serp_analysis": [
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
  "content_calendar": [
    {
      "week": 1-12,
      "title": "compelling headline",
      "primary_keyword": "kw",
      "secondary_keywords": ["kw1","kw2"],
      "content_type": "Pillar/Listicle/How-to/Case Study",
      "word_count_target": number,
      "outline": ["p1","p2","p3","p4","p5"],
      "expected_traffic": number
    }
  ] (exactly 12 weeks),
  "backlink_strategy": {
    "overview": "detailed strategy",
    "target_sites": [
      {"site":"url","da":number,"type":"blog","contact":"email","pitch":"specific pitch"}
    ] (8 sites),
    "guest_post_topics": ["t1","t2","t3","t4","t5"],
    "broken_link_opportunities": [
      {"site":"url","dead_page":"description","replacement":"your content"}
    ] (3),
    "outreach_email": "complete email template"
  },
  "onpage_checklist": ["specific action"] (15 items),
  "success_accelerators": [
    "Pro tip or tool recommendation",
    "Pro tip or tool recommendation",
    "Pro tip or tool recommendation",
    "Pro tip or tool recommendation",
    "Pro tip or tool recommendation"
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
  ] (8 relevant SEO resources, e.g., Google Search Console, Ahrefs, Moz, SEMrush, Canva, Grammarly, etc.),
  "chart_data": {
    "trend_12m": [12 numbers],
    "traffic_growth_6m": [6 numbers]
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

  // Professional Header
  m += `MARKETMUSE PRO\nReal-Time Market Intelligence\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  m += `Report ID: ${reportId}\nType: SEO Analysis\nNiche: ${niche}\nCountry: ${countryNames[country] || country}\nGenerated: ${today} at ${now}\nStatus: Confidential\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // At a Glance
  m += `AT A GLANCE\n────────────────────────────────────────────\n`;
  m += `Trend: ${a.trend_score}\n`;
  m += `Total Keywords Analyzed: ${a.keywords?.length || 50}\n`;
  if (a.chart_data?.traffic_growth_6m?.length) {
    m += `6-Month Traffic Forecast: ${a.chart_data.traffic_growth_6m[0]?.toLocaleString()} to ${a.chart_data.traffic_growth_6m[5]?.toLocaleString()} visits\n`;
  }
  m += `\n`;

  // Key Findings
  if (a.key_findings?.length) {
    m += `KEY FINDINGS\n────────────────────────────────────────────\n`;
    a.key_findings.forEach((f: string, i: number) => { m += `${i+1}. ${f}\n`; });
    m += `\n`;
  }

  // Quick Wins
  if (a.quick_wins?.length) {
    m += `QUICK WINS – Start Today\n────────────────────────────────────────────\n`;
    a.quick_wins.forEach((w: string, i: number) => { m += `${i+1}. ${w}\n`; });
    m += `\n`;
  }

  // 1. Trend Analysis
  m += `1. TREND ANALYSIS\n────────────────────────────────────────────\n${a.trend_insight}\n\n`;

  // 2. Keywords
  m += `2. TOP 50 KEYWORD OPPORTUNITIES\n────────────────────────────────────────────\n`;
  m += `Source: Google Keyword Planner (via Keywords Everywhere) [1]\n\n`;
  m += `| # | Keyword | Volume | KD | CPC | Intent | Opportunity |\n`;
  m += `|---|---------|--------|-----|-----|--------|-------------|\n`;
  a.keywords?.forEach((k: any, i: number) => {
    m += `| ${i+1} | ${k.keyword} | ${k.volume?.toLocaleString()} | ${k.kd} | $${k.cpc} | ${k.intent} | ${k.ranking_opportunity} |\n`;
  });
  m += `\n`;

  // 3. SERP Analysis
  m += `3. SERP COMPETITOR ANALYSIS\n────────────────────────────────────────────\n`;
  m += `Source: Google Search Results (live via SerpAPI) [2]\n\n`;
  a.serp_analysis?.forEach((s: any) => {
    m += `Position #${s.position}: ${s.title}\n`;
    m += `  URL: ${s.url}\n`;
    m += `  DA: ${s.da} | Words: ${s.word_count} | Backlinks: ${s.backlinks}\n`;
    m += `  Est. Traffic: ${s.estimated_traffic?.toLocaleString()}/mo\n`;
    m += `  Strengths: ${s.strengths?.join(', ')}\n`;
    m += `  Weaknesses: ${s.weaknesses?.join(', ')}\n`;
    m += `  Gap: ${s.content_gap}\n\n`;
  });

  // 4. Content Calendar
  m += `4. 12-WEEK CONTENT CALENDAR\n────────────────────────────────────────────\n`;
  a.content_calendar?.forEach((c: any) => {
    m += `Week ${c.week}: ${c.title}\n`;
    m += `  Keyword: ${c.primary_keyword} | Type: ${c.content_type}\n`;
    m += `  Secondary: ${c.secondary_keywords?.join(', ')}\n`;
    m += `  Target Words: ${c.word_count_target}\n`;
    m += `  Outline: ${c.outline?.join(' | ')}\n`;
    m += `  Est. Traffic: ${c.expected_traffic?.toLocaleString()}/mo\n\n`;
  });

  // 5. Backlink Strategy
  const bs = a.backlink_strategy;
  if (bs) {
    m += `5. BACKLINK ACQUISITION STRATEGY\n────────────────────────────────────────────\n${bs.overview}\n\n`;
    if (bs.target_sites?.length) {
      m += `Target Websites:\n`;
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
      bs.broken_link_opportunities.forEach((b: any) => {
        m += `  - ${b.site}: ${b.dead_page} → ${b.replacement}\n`;
      });
      m += `\n`;
    }
    if (bs.outreach_email) {
      m += `Outreach Email Template:\n${bs.outreach_email}\n\n`;
    }
  }

  // 6. On-Page Checklist
  m += `6. ON-PAGE SEO CHECKLIST\n────────────────────────────────────────────\n`;
  a.onpage_checklist?.forEach((item: string, i: number) => { m += `${i+1}. ${item}\n`; });
  m += `\n`;

  // 7. Success Accelerators
  if (a.success_accelerators?.length) {
    m += `7. SUCCESS ACCELERATORS\n────────────────────────────────────────────\n`;
    a.success_accelerators.forEach((tip: string, i: number) => { m += `${i+1}. ${tip}\n`; });
    m += `\n`;
  }

  // Related Resources
  if (a.related_resources?.length) {
    m += `RELATED RESOURCES & LINKS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    a.related_resources.forEach((res: any, i: number) => { m += `${i+1}. ${res.name} – ${res.url}\n`; });
    m += `\n`;
  }

  // Data Verification Links
  m += `DATA VERIFICATION LINKS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  m += `[1] Google Keyword Planner – https://ads.google.com/keyword-planner\n`;
  m += `[2] Google Search (SERP) – https://www.google.com\n`;
  m += `[3] Google Trends – https://trends.google.com\n`;
  m += `[4] AI Model – GPT-4o by OpenAI (https://openai.com)\n\n`;

  // Final Word
  m += `FINAL WORD\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  m += `With this comprehensive SEO roadmap, you are equipped to systematically grow your organic presence. Prioritize the quick wins, execute the content calendar consistently, and build quality backlinks – the traffic forecast reflects what is achievable with dedicated effort.\n\n`;

  m += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  m += `MarketMuse PRO — Confidential Report\n© All Rights Reserved\n`;

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
      data: analysis, markdown: '', charts: {}
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
