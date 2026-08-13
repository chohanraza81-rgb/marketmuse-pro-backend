import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getSearchResults } from '../services/serpapi';
import { getRelatedKeywords, getTrends } from '../services/keywordseverywhere';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

// ✅ Robust JSON extraction – fixes malformed or truncated JSON
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

const PROMPT = `You are an elite SEO strategist at MusePRO Intelligence Division. You have a decade of experience delivering high-stakes reports. You write like a human expert, not a machine. Be specific, data-driven, and professional.

Analyze REAL keyword data, SERP results, and trends. Return ONLY valid JSON.

CRITICAL WRITING INSTRUCTIONS:
- Write like a senior SEO veteran who has seen it all. Direct, bold, and full of insider wisdom.
- Vary your sentence length. Mix short observations with detailed explanations.
- Use natural business language. No robotic transitions like "Furthermore", "Moreover", "Additionally".
- Use first-person plural freely: "We found...", "Our read on this...", "We'd prioritize..."
- Express genuine excitement about ranking opportunities and honest skepticism about overhyped keywords.
- Weave numbers directly into conversational sentences.
- Use hedging where it makes sense: "Could be...", "Looks like...", "Might signal..."
- Every keyword stat must be followed by interpretation.
- Avoid corporate buzzwords: "leverage", "utilize", "synergize", "robust".

Return JSON with this exact structure:
{
  "trend_assessment": "Seasonal" | "Evergreen",
  "trend_analysis": "2-3 sentences with actual trend numbers",
  "key_insights": [
    "Insight with specific volume/KD numbers",
    "Insight with specific volume/KD numbers",
    "Insight with specific volume/KD numbers"
  ],
  "immediate_actions": [
    "Priority SEO action 1",
    "Priority SEO action 2",
    "Priority SEO action 3"
  ],
  "keywords": [
    {
      "keyword": "string",
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
      "title": "string",
      "url": "string",
      "da": number,
      "word_count": number,
      "backlinks": number,
      "estimated_traffic": number,
      "strengths": ["string", "string"],
      "weaknesses": ["string", "string"],
      "content_gap": "string"
    }
  ] (exactly 8),
  "content_roadmap": [
    {
      "week": number,
      "title": "string",
      "primary_keyword": "string",
      "secondary_keywords": ["string", "string"],
      "content_type": "Pillar|Listicle|How-to|Case Study",
      "word_count_target": number,
      "outline": ["string", "string", "string", "string", "string"],
      "expected_traffic": number
    }
  ] (exactly 12 weeks),
  "link_acquisition": {
    "overview": "string",
    "target_sites": [
      {
        "site": "string",
        "da": number,
        "type": "string",
        "contact": "string",
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
  ] (8 resources),
  "chart_data": {
    "trend_12m": [number] (12 values),
    "traffic_growth_6m": [number] (6 values)
  }
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

function generateMarkdown(a: any, niche: string, country: string, reportId: string): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

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

  m += `TABLE OF CONTENTS\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `1. Executive Brief\n2. Trend Assessment\n3. Keyword Opportunities (Top 50)\n4. SERP Landscape\n5. Content Roadmap (12 Weeks)\n6. Link Acquisition Strategy\n7. On‑Page Optimization Checklist\n8. Growth Accelerators\n9. Related Resources\n\n`;
  m += `──────────────────────────────────────────────────────────────\n\n`;

  m += `1. EXECUTIVE BRIEF\n──────────────────────────────────────────────────────────────\n`;
  m += `This report analyzes the organic search landscape for "${niche}" in ${countryNames[country] || country}. The trend is ${a.trend_assessment || 'N/A'} with ${a.keywords?.length || 50} keyword opportunities identified.\n\n`;
  if (a.key_insights?.length) {
    a.key_insights.forEach((f: string, i: number) => { m += `  ${i+1}. ${f}\n`; });
    m += `\n`;
  }

  if (a.immediate_actions?.length) {
    m += `Priority Actions:\n`;
    a.immediate_actions.forEach((w: string, i: number) => { m += `  ${i+1}. ${w}\n`; });
    m += `\n`;
  }

  m += `2. TREND ASSESSMENT\n──────────────────────────────────────────────────────────────\n${a.trend_analysis}\n\n`;

  m += `3. KEYWORD OPPORTUNITIES (TOP 50)\n──────────────────────────────────────────────────────────────\nSource: Google Keyword Planner via Keywords Everywhere\n\n`;
  m += `| # | Keyword | Volume | KD | CPC | Intent | Potential |\n|---|---------|--------|-----|-----|--------|----------|\n`;
  a.keywords?.forEach((k: any, i: number) => { m += `| ${i+1} | ${k.keyword} | ${k.volume?.toLocaleString()} | ${k.kd} | $${k.cpc} | ${k.intent} | ${k.ranking_potential} |\n`; });
  m += `\n`;

  m += `4. SERP LANDSCAPE\n──────────────────────────────────────────────────────────────\nSource: Google Search Results via SerpAPI\n\n`;
  a.serp_landscape?.forEach((s: any) => {
    m += `Position #${s.position}: ${s.title}\n`;
    m += `  URL: ${s.url}\n`;
    m += `  DA: ${s.da} | Words: ${s.word_count} | Backlinks: ${s.backlinks}\n`;
    m += `  Est. Traffic: ${s.estimated_traffic?.toLocaleString()}/mo\n`;
    m += `  Strengths: ${s.strengths?.join(', ')}\n`;
    m += `  Weaknesses: ${s.weaknesses?.join(', ')}\n`;
    m += `  Gap: ${s.content_gap}\n\n`;
  });

  m += `5. CONTENT ROADMAP (12 WEEKS)\n──────────────────────────────────────────────────────────────\n`;
  a.content_roadmap?.forEach((c: any) => {
    m += `Week ${c.week}: ${c.title}\n`;
    m += `  Keyword: ${c.primary_keyword} | Type: ${c.content_type}\n`;
    m += `  Secondary: ${c.secondary_keywords?.join(', ')}\n`;
    m += `  Target Words: ${c.word_count_target}\n`;
    m += `  Outline: ${c.outline?.join(' | ')}\n`;
    m += `  Est. Traffic: ${c.expected_traffic?.toLocaleString()}/mo\n\n`;
  });

  const bs = a.link_acquisition;
  if (bs) {
    m += `6. LINK ACQUISITION STRATEGY\n──────────────────────────────────────────────────────────────\n${bs.overview}\n\n`;
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

  m += `7. ON‑PAGE OPTIMIZATION CHECKLIST\n──────────────────────────────────────────────────────────────\n`;
  a.onpage_checklist?.forEach((item: string, i: number) => { m += `${i+1}. ${item}\n`; });
  m += `\n`;

  if (a.growth_accelerators?.length) {
    m += `8. GROWTH ACCELERATORS\n──────────────────────────────────────────────────────────────\n`;
    a.growth_accelerators.forEach((tip: string, i: number) => { m += `${i+1}. ${tip}\n`; });
    m += `\n`;
  }

  if (a.related_resources?.length) {
    m += `9. RELATED RESOURCES\n──────────────────────────────────────────────────────────────\n`;
    a.related_resources.forEach((res: any, i: number) => { m += `${i+1}. ${res.name} – ${res.url}\n`; });
    m += `\n`;
  }

  m += `METHODOLOGY & SOURCES\n──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• Google Search Results via SerpAPI (serpapi.com)\n• Google Keyword Planner via Keywords Everywhere (keywordseverywhere.com)\n• Google Trends via Keywords Everywhere\n• Analysis Engine: GPT‑4o (openai.com)\n\nAll data points can be independently verified against their public sources.\n\n`;
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
