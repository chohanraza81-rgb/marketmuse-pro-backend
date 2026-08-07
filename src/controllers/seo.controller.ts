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

const PROMPT = `You are an elite SEO consultant. Analyze REAL keyword data, SERP results, and trends. Return ONLY valid JSON:

{
  "trend_score": "Seasonal" | "Evergreen",
  "trend_insight": "2 sentences explaining the trend and how to exploit it",
  "keywords": [
    {
      "keyword": "keyword",
      "volume": number,
      "kd": number (0-100),
      "cpc": number,
      "intent": "informational"|"commercial"|"transactional",
      "serp_features": ["Featured Snippet","Video","PAA"],
      "ranking_opportunity": "Easy Win"|"Moderate"|"Long Game"
    }
  ] (exactly 50, based on real data, sorted by volume),
  "serp_analysis": [
    {
      "position": number,
      "title": "actual title from data",
      "url": "actual url from data",
      "da": number, "pa": number,
      "word_count": number,
      "backlinks": number,
      "estimated_monthly_traffic": number,
      "content_type": "Pillar/Blog/Product/Forum",
      "strengths": ["specific","specific"],
      "weaknesses": ["specific","specific"],
      "content_gap_opportunity": "what they miss that you can capture"
    }
  ] (exactly 8, from real SERP data),
  "content_calendar": [
    {
      "week": 1-12,
      "title": "click-worthy unique headline",
      "primary_keyword": "keyword",
      "secondary_keywords": ["kw1","kw2"],
      "content_type": "Pillar/Listicle/How-to/Case Study",
      "word_count_target": number,
      "outline": ["point","point","point","point","point"],
      "internal_linking_targets": ["page1","page2"],
      "expected_traffic_3mo": number
    }
  ] (exactly 12 weeks),
  "backlink_strategy": {
    "overview": "detailed strategic paragraph",
    "target_sites": [
      {"site":"real url","type":"blog","da":number,"contact":"email","pitch":"exact pitch"}
    ] (8 real sites),
    "guest_post_titles": ["title1","title2","title3","title4","title5"],
    "broken_link_opportunities": [
      {"site":"site","dead_page":"description","your_replacement":"your content"}
    ] (3 realistic),
    "haro_queries": ["query1","query2","query3"],
    "outreach_email": "complete personalized email template with {{placeholders}}"
  },
  "onpage_checklist": ["specific item"] (15 specific, actionable items),
  "chart_data": {
    "trend_12m": [12 numbers from real trend data],
    "keyword_difficulty": {"easy":N,"medium":N,"hard":N},
    "traffic_growth_6m": [6 numbers]
  }
}`;

function generateMarkdown(a: any, niche: string, country: string): string {
  const flags: Record<string, string> = {
    us: '🇺🇸', gb: '🇬🇧', ca: '🇨🇦', au: '🇦🇺', de: '🇩🇪', sg: '🇸🇬',
    sa: '🇸🇦', ae: '🇦🇪', pk: '🇵🇰', in: '🇮🇳', tr: '🇹🇷', my: '🇲🇾'
  };
  const names: Record<string, string> = {
    us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
    de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'UAE',
    pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia'
  };
  const dl = (kd: number): string => kd <= 30 ? '🟢 Easy' : kd <= 60 ? '🟡 Medium' : '🔴 Hard';

  const backlinkSection = (): string => {
    const bs = a.backlink_strategy;
    if (!bs) return '';

    let md = `### 📋 Overview\n${bs.overview}\n\n`;

    if (bs.target_sites?.length) {
      md += `### 🎯 Target Websites (8)\n\n`;
      md += `| # | Site | DA | Type | Contact | Pitch |\n`;
      md += `|---|------|-----|------|---------|-------|\n`;
      bs.target_sites.forEach((s: any, i: number) => {
        md += `| ${i+1} | ${s.site} | ${s.da} | ${s.type} | ${s.contact} | ${s.pitch} |\n`;
      });
      md += '\n';
    }

    if (bs.guest_post_titles?.length) {
      md += `### ✍️ Guest Post Topics\n`;
      bs.guest_post_titles.forEach((t: string, i: number) => { md += `${i+1}. ${t}\n`; });
      md += '\n';
    }

    if (bs.broken_link_opportunities?.length) {
      md += `### 🔗 Broken Link Opportunities\n`;
      bs.broken_link_opportunities.forEach((b: any) => {
        md += `- **${b.site}**: ${b.dead_page} → *${b.your_replacement}*\n`;
      });
      md += '\n';
    }

    if (bs.haro_queries?.length) {
      md += `### 📡 HARO Queries to Monitor\n`;
      bs.haro_queries.forEach((h: string) => { md += `- ${h}\n`; });
      md += '\n';
    }

    if (bs.outreach_email) {
      md += `### 📧 Outreach Email Template\n\`\`\`\n${bs.outreach_email}\n\`\`\`\n\n`;
    }

    return md;
  };

  let m = `# 🔍 SEO Analysis: ${niche}\n`;
  m += `## 📍 Target Market: ${flags[country]} ${names[country]}\n\n`;
  m += `## 📊 Trend Analysis: **${a.trend_score}**\n\n`;
  m += `> ${a.trend_insight}\n\n`;

  // Keywords
  m += `## 🏆 Top 50 Keywords\n\n`;
  m += `| # | Keyword | Volume | KD | CPC | Intent | Features | Opportunity |\n`;
  m += `|---|---------|--------|-----|-----|--------|----------|-------------|\n`;
  a.keywords?.forEach((k: any, i: number) => {
    m += `| ${i+1} | ${k.keyword} | ${k.volume?.toLocaleString()} | ${k.kd} ${dl(k.kd)} | $${k.cpc} | ${k.intent} | ${k.serp_features?.join(', ')} | ${k.ranking_opportunity} |\n`;
  });

  // SERP Analysis
  m += `\n## 📈 SERP Competitor Analysis\n\n`;
  a.serp_analysis?.forEach((s: any) => {
    m += `### #${s.position} — ${s.title}\n`;
    m += `- **URL:** ${s.url}\n`;
    m += `- **DA:** ${s.da} | **PA:** ${s.pa}\n`;
    m += `- **Word Count:** ${s.word_count?.toLocaleString()} | **Backlinks:** ${s.backlinks?.toLocaleString()}\n`;
    m += `- **Est. Monthly Traffic:** ${s.estimated_monthly_traffic?.toLocaleString()}\n`;
    m += `- **Content Type:** ${s.content_type}\n`;
    m += `- ✅ **Strengths:** ${s.strengths?.join(', ')}\n`;
    m += `- ❌ **Weaknesses:** ${s.weaknesses?.join(', ')}\n`;
    m += `- 🎯 **Content Gap:** ${s.content_gap_opportunity}\n\n`;
  });

  // Content Calendar
  m += `## 📅 12-Week Content Calendar\n\n`;
  a.content_calendar?.forEach((c: any) => {
    m += `### Week ${c.week}: ${c.title}\n`;
    m += `- **Primary Keyword:** ${c.primary_keyword}\n`;
    m += `- **Secondary:** ${c.secondary_keywords?.join(', ')}\n`;
    m += `- **Type:** ${c.content_type} | **Target Words:** ${c.word_count_target}\n`;
    m += `- **Outline:** ${c.outline?.join(' → ')}\n`;
    m += `- **Internal Links:** ${c.internal_linking_targets?.join(', ')}\n`;
    m += `- **Expected 3-Month Traffic:** ${c.expected_traffic_3mo?.toLocaleString()}/mo\n\n`;
  });

  // Backlink Strategy
  m += `## 🔗 Backlink Acquisition Strategy\n\n`;
  m += backlinkSection();

  // On-Page Checklist
  m += `## ✅ On-Page SEO Checklist\n\n`;
  a.onpage_checklist?.forEach((item: string, i: number) => {
    m += `${i+1}. ${item}\n`;
  });

  // Traffic Forecast
  m += `\n## 📊 6-Month Traffic Forecast\n\n`;
  m += a.chart_data?.traffic_growth_6m?.map((v: number, i: number) => `**Month ${i+1}:** ${v?.toLocaleString()} visits`).join(' → ');

  m += `\n\n---\n*Powered by MarketMuse PRO — Real-time SEO Intelligence*`;
  return m;
}

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const ck = `seo_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    console.log(`🔍 SEO: "${niche}" in ${country}`);

    const [searchData, relatedKwData, trendsArr] = await Promise.all([
      getSearchResults(niche, country),
      getRelatedKeywords(niche, country).catch(() => null),
      getTrends(niche, country).catch(() => null),
    ]);

    const serp = searchData.organic_results?.slice(0, 8).map((r: any) => ({
      position: r.position, title: r.title, url: r.link, snippet: r.snippet || ''
    })) || [];

    const relatedList = relatedKwData?.data?.slice(0, 50).map((k: any) => ({
      keyword: k.keyword,
      volume: k.vol,
      cpc: parseFloat(k.cpc?.value || '0'),
      competition: k.competition,
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

    const userMsg = `Niche: ${niche}\nCountry: ${country}\n\nSERP Top 8:\n${JSON.stringify(serp)}\n\nKeyword Data:\n${JSON.stringify(allKeywords)}\n\n12-Month Trends: ${trendsArr ? JSON.stringify(trendsArr) : 'Not available'}`;

    const ai = await runGroqWithRetry(PROMPT, userMsg);
    const analysis = extractJSON(ai);

    if (trendsArr && Array.isArray(trendsArr)) {
      analysis.chart_data = analysis.chart_data || {};
      analysis.chart_data.trend_12m = trendsArr;
    }

    const markdown = generateMarkdown(analysis, niche, country);
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
