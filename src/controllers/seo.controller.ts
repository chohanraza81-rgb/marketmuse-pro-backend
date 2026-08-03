import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getSearchResults, getKeywordSuggestions } from '../services/serpapi';
import { getTrends } from '../services/trends';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const extractJSON = (raw: string): any => {
  let c = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = c.indexOf('{');
  const e = c.lastIndexOf('}');
  if (s !== -1 && e !== -1 && e > s) c = c.substring(s, e + 1);
  try {
    return JSON.parse(c);
  } catch (err) {
    try {
      const fixed = c.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}').replace(/,(\s*[}\]])/g, '$1').replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
      return JSON.parse(fixed);
    } catch (e2) {
      try {
        let completed = c;
        let braceCount = (completed.match(/{/g) || []).length;
        let closeCount = (completed.match(/}/g) || []).length;
        while (closeCount < braceCount) { completed += '}'; closeCount++; }
        let bracketCount = (completed.match(/\[/g) || []).length;
        let closeBracketCount = (completed.match(/\]/g) || []).length;
        while (closeBracketCount < bracketCount) { completed += ']'; closeBracketCount++; }
        return JSON.parse(completed);
      } catch (e3) {
        console.error('❌ All JSON fixes failed. Last 500 chars:', c.substring(c.length - 500));
        throw new Error('AI response is not valid JSON');
      }
    }
  }
};

const PROMPT = `You are an elite SEO consultant. Analyze real SERP data, questions, and trends. Return ONLY valid JSON:

{
  "trend_score": "Seasonal" | "Evergreen",
  "trend_insight": "2 sentences explaining the trend and how to exploit it",
  "keywords": [
    {
      "keyword": "keyword",
      "volume": number,
      "kd": 0-100,
      "cpc": number,
      "intent": "informational"|"commercial"|"transactional",
      "serp_features": ["Featured Snippet","Video","PAA"],
      "ranking_opportunity": "Easy Win"|"Moderate"|"Long Game"
    }
  ] (50 items, varied realistic volumes),
  "serp_analysis": [
    {
      "position": 1-8,
      "title": "actual title from data",
      "url": "actual url",
      "da": number, "pa": number,
      "word_count": number,
      "backlinks": number,
      "estimated_monthly_traffic": number,
      "content_type": "Pillar/Blog/Product/Forum",
      "strengths": ["specific","specific"],
      "weaknesses": ["specific","specific"],
      "content_gap_opportunity": "what they miss that you can capture"
    }
  ] (8 items),
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
  ] (12 weeks),
  "backlink_strategy": {
    "overview": "detailed strategic paragraph",
    "target_sites": [
      {"site":"real url","type":"blog","da":number,"contact":"email","pitch":"exact pitch"}
    ] (8 sites),
    "guest_post_titles": ["title1","title2","title3","title4","title5"],
    "broken_link_opportunities": [
      {"site":"site","dead_page":"description","your_replacement":"your content"}
    ] (3),
    "haro_queries": ["query1","query2","query3"],
    "outreach_email": "complete personalized email with {{placeholders}}"
  },
  "onpage_checklist": ["specific"] (15 items),
  "chart_data": {
    "trend_12m": [12 numbers],
    "keyword_difficulty": {"easy":N,"medium":N,"hard":N},
    "traffic_growth_6m": [6 numbers]
  }
}`;

function md(a: any, niche: string, country: string): string {
  const f: any = { us:'🇺🇸', pk:'🇵🇰', gb:'🇬🇧', ae:'🇦🇪', sa:'🇸🇦' };
  const n: any = { us:'United States', pk:'Pakistan', gb:'United Kingdom', ae:'UAE', sa:'Saudi Arabia' };
  const dl = (kd: number) => kd <= 30 ? '🟢' : kd <= 60 ? '🟡' : '🔴';
  let m = `# 🔍 SEO Report: ${niche}\n## Target: ${f[country]} ${n[country]}\n\n`;
  m += `## 📊 Trend: ${a.trend_score}\n${a.trend_insight}\n\n`;
  m += `## 🏆 50 Keywords\n| # | Keyword | Vol | KD | CPC | Intent | Features | Oppty |\n|---|---------|-----|----|-----|--------|----------|-------|\n`;
  a.keywords?.forEach((k: any, i: number) => m += `| ${i+1} | ${k.keyword} | ${k.volume?.toLocaleString()} | ${k.kd}${dl(k.kd)} | $${k.cpc} | ${k.intent} | ${k.serp_features?.join(',')} | ${k.ranking_opportunity} |\n`);
  m += `\n## 📈 SERP Analysis\n`;
  a.serp_analysis?.forEach((s: any) => m += `### #${s.position} ${s.title}\n- URL: ${s.url}\n- DA:${s.da} PA:${s.pa} | Words:${s.word_count} | Backlinks:${s.backlinks} | Traffic:${s.estimated_monthly_traffic?.toLocaleString()}\n- ✅ ${s.strengths?.join(', ')}\n- ❌ ${s.weaknesses?.join(', ')}\n- 🎯 Gap: ${s.content_gap_opportunity}\n\n`);
  m += `## 📅 12-Week Content Calendar\n`;
  a.content_calendar?.forEach((c: any) => m += `### Week ${c.week}: ${c.title}\n- Keyword: ${c.primary_keyword} | Secondary: ${c.secondary_keywords?.join(', ')}\n- Type: ${c.content_type} | Words: ${c.word_count_target}\n- Outline: ${c.outline?.join(' → ')}\n- Internal Links: ${c.internal_linking_targets?.join(', ')}\n- Traffic Est: ${c.expected_traffic_3mo?.toLocaleString()}/mo\n\n`);
  const bs = a.backlink_strategy;
  if (bs) {
    m += `## 🔗 Backlink Strategy\n### Overview\n${bs.overview}\n\n### 8 Target Sites\n| # | Site | DA | Type | Contact | Pitch |\n|---|------|----|------|---------|-------|\n`;
    bs.target_sites?.forEach((s: any, i: number) => m += `| ${i+1} | ${s.site} | ${s.da} | ${s.type} | ${s.contact} | ${s.pitch} |\n`);
    m += `\n### Guest Post Titles\n${bs.guest_post_titles?.map((t:string,i:number)=>`${i+1}. ${t}`).join('\n')}\n`;
    m += `\n### Broken Link Opps\n${bs.broken_link_opportunities?.map((b:any)=>`- ${b.site}: ${b.dead_page} → ${b.your_replacement}`).join('\n')}\n`;
    m += `\n### HARO Queries\n${bs.haro_queries?.map((h:string)=>`- ${h}`).join('\n')}\n`;
    m += `\n### 📧 Outreach Email\n\`\`\`\n${bs.outreach_email}\n\`\`\`\n`;
  }
  m += `\n## ✅ On-Page Checklist\n${a.onpage_checklist?.map((item:string,i:number)=>`${i+1}. ${item}`).join('\n')}`;
  m += `\n\n## 📊 6-Mo Traffic Forecast\n${a.chart_data?.traffic_growth_6m?.map((v:number,i:number)=>`Mo${i+1}: ${v?.toLocaleString()}`).join(' → ')}`;
  m += `\n\n---\n*MarketMuse AI PRO MAX ULTRA – $99 Report*`;
  return m;
}

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const ck = `seo_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);
    console.log(`🔍 SEO: "${niche}" in ${country}`);
    const [search, questions, trends] = await Promise.all([getSearchResults(niche, country), getKeywordSuggestions(niche, country), getTrends(niche, country.toUpperCase())]);
    const serp = (search as any).organic_results?.slice(0, 8).map((r: any) => ({ position: r.position, title: r.title, url: r.link, snippet: r.snippet || '' })) || [];
    const ai = await runGroqWithRetry(PROMPT, `${niche}\n${country}\nSERP:${JSON.stringify(serp)}\nQuestions:${JSON.stringify(questions.slice(0,15))}\nTrends:${JSON.stringify(trends)}`);
    const analysis = extractJSON(ai);
    const markdown = md(analysis, niche, country);
    const report = await Report.create({ type:'seo', niche, country, value:'$99', data:analysis, markdown, charts:{trends} });
    const result = { id:report._id, ...report.toObject() };
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
