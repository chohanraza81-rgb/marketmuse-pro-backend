import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getSearchResults } from '../services/serpapi';
import { getRelatedKeywords, getTrends } from '../services/keywordseverywhere';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

// GPT‑4o with json_object mode always returns clean JSON – simple extraction
const extractJSON = (raw: string): any => {
  let c = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = c.indexOf('{'), e = c.lastIndexOf('}');
  if (s !== -1 && e !== -1 && e > s) c = c.substring(s, e + 1);
  return JSON.parse(c);
};

const PROMPT = `You are an elite SEO consultant. Analyze the REAL keyword data, SERP results, and trends provided. Return ONLY valid JSON:

{
  "trend_score": "Seasonal" | "Evergreen",
  "trend_insight": "2 sentences explaining the trend",
  "keywords": [
    {
      "keyword": "string",
      "volume": number,
      "kd": number (0-100, computed from competition level),
      "cpc": number,
      "intent": "informational"|"commercial"|"transactional",
      "serp_features": ["Featured Snippet","Video","PAA"],
      "ranking_opportunity": "Easy Win"|"Moderate"|"Long Game"
    }
  ] (exactly 50, based on real data provided, sorted by volume),
  "serp_analysis": [
    {
      "position": number,
      "title": "string",
      "url": "string",
      "da": number,
      "pa": number,
      "word_count": number,
      "backlinks": number,
      "estimated_monthly_traffic": number,
      "content_type": "Pillar/Blog/Product/Forum",
      "strengths": ["specific","specific"],
      "weaknesses": ["specific","specific"],
      "content_gap_opportunity": "string"
    }
  ] (exactly 8, based on real SERP data),
  "content_calendar": [
    {
      "week": 1-12,
      "title": "click-worthy unique headline",
      "primary_keyword": "string",
      "secondary_keywords": ["string","string"],
      "content_type": "string",
      "word_count_target": number,
      "outline": ["point","point","point","point","point"],
      "internal_linking_targets": ["string","string"],
      "expected_traffic_3mo": number
    }
  ] (exactly 12 weeks),
  "backlink_strategy": {
    "overview": "detailed paragraph",
    "target_sites": [
      {"site":"url","type":"string","da":number,"contact":"string","pitch":"string"}
    ] (8 sites),
    "guest_post_titles": ["string","string","string","string","string"],
    "broken_link_opportunities": [
      {"site":"string","dead_page":"string","your_replacement":"string"}
    ] (3),
    "haro_queries": ["string","string","string"],
    "outreach_email": "complete personalized email template"
  },
  "onpage_checklist": ["string"] (15 items),
  "chart_data": {
    "trend_12m": [12 numbers],
    "keyword_difficulty": {"easy":N,"medium":N,"hard":N},
    "traffic_growth_6m": [6 numbers]
  }
}`;

// Markdown generator – returns a string
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

  // Backlink section helper – always returns a string
  const backlinkSection = (): string => {
    const bs = a.backlink_strategy;
    if (!bs) return '';

    let md = `### Overview\n${bs.overview}\n\n`;

    if (bs.target_sites?.length) {
      md += `### 8 Target Sites\n| # | Site | DA | Type | Contact | Pitch |\n|---|------|----|------|---------|-------|\n`;
      bs.target_sites.forEach((s: any, i: number) => {
        md += `| ${i+1} | ${s.site} | ${s.da} | ${s.type} | ${s.contact} | ${s.pitch} |\n`;
      });
      md += '\n';
    }

    if (bs.guest_post_titles?.length) {
      md += `### Guest Post Titles\n${bs.guest_post_titles.map((t: string, i: number) => `${i+1}. ${t}`).join('\n')}\n\n`;
    }

    if (bs.broken_link_opportunities?.length) {
      md += `### Broken Link Opps\n${bs.broken_link_opportunities.map((b: any) => `- ${b.site}: ${b.dead_page} → ${b.your_replacement}`).join('\n')}\n\n`;
    }

    if (bs.haro_queries?.length) {
      md += `### HARO Queries\n${bs.haro_queries.map((h: string) => `- ${h}`).join('\n')}\n\n`;
    }

    if (bs.outreach_email) {
      md += `### 📧 Outreach Email\n\`\`\`\n${bs.outreach_email}\n\`\`\`\n\n`;
    }

    return md; // <-- always returns a string
  };

  let m = `# 🔍 SEO Report: ${niche}\n## Target: ${flags[country]} ${names[country]}\n\n`;
  m += `## 📊 Trend: ${a.trend_score}\n${a.trend_insight}\n\n`;

  m += `## 🏆 50 Keywords\n| # | Keyword | Vol | KD | CPC | Intent | Features | Oppty |\n|---|---------|-----|----|-----|--------|----------|-------|\n`;
  a.keywords?.forEach((k: any, i: number) => {
    m += `| ${i+1} | ${k.keyword} | ${k.volume?.toLocaleString()} | ${k.kd}${dl(k.kd)} | $${k.cpc} | ${k.intent} | ${k.serp_features?.join(',')} | ${k.ranking_opportunity} |\n`;
  });

  m += `\n## 📈 SERP Analysis\n`;
  a.serp_analysis?.forEach((s: any) => {
    m += `### #${s.position} ${s.title}\n- URL: ${s.url}\n- DA:${s.da} PA:${s.pa} | Words:${s.word_count} | Backlinks:${s.backlinks} | Traffic:${s.estimated_monthly_traffic?.toLocaleString()}\n- ✅ ${s.strengths?.join(', ')}\n- ❌ ${s.weaknesses?.join(', ')}\n- 🎯 Gap: ${s.content_gap_opportunity}\n\n`;
  });

  m += `## 📅 12-Week Content Calendar\n`;
  a.content_calendar?.forEach((c: any) => {
    m += `### Week ${c.week}: ${c.title}\n- Keyword: ${c.primary_keyword} | Secondary: ${c.secondary_keywords?.join(', ')}\n- Type: ${c.content_type} | Words: ${c.word_count_target}\n- Outline: ${c.outline?.join(' → ')}\n- Internal Links: ${c.internal_linking_targets?.join(', ')}\n- Traffic Est: ${c.expected_traffic_3mo?.toLocaleString()}/mo\n\n`;
  });

  m += `## 🔗 Backlink Strategy\n${backlinkSection()}`;

  m += `\n## ✅ On-Page Checklist\n${a.onpage_checklist?.map((item: string, i: number) => `${i+1}. ${item}`).join('\n')}`;
  m += `\n\n## 📊 6-Mo Traffic Forecast\n${a.chart_data?.traffic_growth_6m?.map((v: number, i: number) => `Mo${i+1}: ${v?.toLocaleString()}`).join(' → ')}`;
  m += `\n\n---\n*MarketMuse AI PRO MAX ULTRA – $99 Report*`;

  return m;  // <-- explicit return
}

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const ck = `seo_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    console.log(`🔍 SEO: "${niche}" in ${country}`);

    // Real data: SERP from SerpAPI, related keywords & trends from KWE
    const [serpData, relatedKwData, trendsArr] = await Promise.all([
      getSearchResults(niche, country),
      getRelatedKeywords(niche, country).catch(() => null),
      getTrends(niche, country).catch(() => null),
    ]);

    const serp = serpData.organic_results?.slice(0, 8).map((r: any) => ({
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

    const userMsg = `Niche: ${niche}\nCountry: ${country}\n\nReal SERP Top 8:\n${JSON.stringify(serp)}\n\nReal Keyword Data (volume, CPC, competition):\n${JSON.stringify(allKeywords)}\n\n12-Month Trend Values: ${trendsArr ? JSON.stringify(trendsArr) : 'Not available'}`;

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
