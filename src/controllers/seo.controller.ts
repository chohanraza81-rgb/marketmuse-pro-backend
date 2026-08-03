import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getSearchResults, getKeywordSuggestions } from '../services/serpapi';
import { getTrends } from '../services/trends';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const SEO_PROMPT = `You are an elite SEO strategist. Analyze real SERP data, questions, and trends. Return ONLY valid JSON.

{
  "trend_score": "Seasonal" or "Evergreen",
  "trend_insight": string (2 sentences: what the trend shows + how to exploit it),
  "keywords": [
    {
      "keyword": string,
      "volume": number (realistic),
      "kd": number (0-100),
      "cpc": number,
      "intent": string ("informational", "commercial", "transactional"),
      "serp_features": [string] (e.g., ["Featured Snippet", "Video Carousel", "People Also Ask"]),
      "ranking_opportunity": string ("Easy Win", "Moderate Effort", "Long Game")
    }
  ] (exactly 50, sorted by volume, varied realistic numbers),
  "serp_analysis": [
    {
      "position": number,
      "title": string (actual),
      "url": string (actual),
      "da": number,
      "pa": number,
      "word_count": number,
      "backlinks": number,
      "estimated_monthly_traffic": number,
      "content_type": string ("Pillar Page", "Blog Post", "Product Page", "Forum"),
      "strengths": [string, string],
      "weaknesses": [string, string],
      "content_gap_opportunity": string (what they're missing that you can provide)
    }
  ] (exactly 8, from real data),
  "content_calendar": [
    {
      "week": number (1-12),
      "title": string (click-worthy, unique headline),
      "primary_keyword": string,
      "secondary_keywords": [string, string],
      "content_type": string,
      "word_count_target": number,
      "outline": [string, string, string, string, string] (5 bullet points),
      "internal_linking_targets": [string, string],
      "expected_traffic_after_3_months": number
    }
  ] (exactly 12 weeks),
  "backlink_strategy": {
    "overview": string (detailed paragraph),
    "target_sites": [
      {
        "site": string (real URL),
        "type": string,
        "da": number,
        "contact_email_or_form": string,
        "pitch_angle": string (exactly why they'd link to you)
      }
    ] (exactly 8 real, reachable sites),
    "guest_post_titles": [string, string, string, string, string],
    "broken_link_opportunities": [
      {
        "site": string,
        "dead_page_description": string,
        "your_replacement_content": string
      }
    ] (3),
    "haro_queries_to_monitor": [string, string, string],
    "outreach_email": string (complete, professional, personalized template)
  },
  "onpage_checklist": [string] (15 specific items, no generics),
  "chart_data": {
    "trend_12m": [12 numbers],
    "keyword_difficulty_distribution": {"easy": number, "medium": number, "hard": number},
    "estimated_traffic_growth_6m": [6 numbers] (projected monthly traffic)
  }
}`;

function generateMarkdown(a: any, niche: string, country: string): string {
  const flags: Record<string, string> = { us: '🇺🇸', pk: '🇵🇰', gb: '🇬🇧', ae: '🇦🇪', sa: '🇸🇦' };
  const names: Record<string, string> = { us: 'United States', pk: 'Pakistan', gb: 'United Kingdom', ae: 'UAE', sa: 'Saudi Arabia' };
  const dl = (kd: number) => kd <= 30 ? '🟢' : kd <= 60 ? '🟡' : '🔴';

  let m = `# 🔍 SEO Report: ${niche}\n## Target: ${flags[country]} ${names[country]}\n\n`;
  m += `## 📊 Trend: ${a.trend_score}\n${a.trend_insight}\n\n`;

  m += `## 🏆 50 Keywords\n| # | Keyword | Volume | KD | CPC | Intent | SERP Features | Opportunity |\n|---|---------|--------|----|-----|--------|--------------|-------------|\n`;
  a.keywords?.forEach((k: any, i: number) => {
    m += `| ${i+1} | ${k.keyword} | ${k.volume?.toLocaleString()} | ${k.kd}${dl(k.kd)} | $${k.cpc} | ${k.intent} | ${k.serp_features?.join(', ')} | ${k.ranking_opportunity} |\n`;
  });

  m += `\n## 📈 SERP Analysis\n`;
  a.serp_analysis?.forEach((s: any) => {
    m += `### #${s.position} ${s.title}\n- URL: ${s.url}\n- DA:${s.da} PA:${s.pa} | Words:${s.word_count} | Backlinks:${s.backlinks} | Traffic:${s.estimated_monthly_traffic?.toLocaleString()}\n- Strengths: ${s.strengths?.join(', ')}\n- Weaknesses: ${s.weaknesses?.join(', ')}\n- 🎯 Gap Opportunity: ${s.content_gap_opportunity}\n\n`;
  });

  m += `## 📅 12-Week Content Calendar\n`;
  a.content_calendar?.forEach((c: any) => {
    m += `### Week ${c.week}: ${c.title}\n- Keyword: ${c.primary_keyword}\n- Secondary: ${c.secondary_keywords?.join(', ')}\n- Type: ${c.content_type} | Words: ${c.word_count_target}\n- Outline: ${c.outline?.join(' → ')}\n- Internal Links: ${c.internal_linking_targets?.join(', ')}\n- Est. 3-Month Traffic: ${c.expected_traffic_after_3_months?.toLocaleString()}\n\n`;
  });

  const bs = a.backlink_strategy;
  if (bs) {
    m += `## 🔗 Backlink Strategy\n### Overview\n${bs.overview}\n\n### 8 Target Sites\n| # | Site | DA | Type | Contact | Pitch |\n|---|------|----|------|---------|-------|\n`;
    bs.target_sites?.forEach((s: any, i: number) => m += `| ${i+1} | ${s.site} | ${s.da} | ${s.type} | ${s.contact_email_or_form} | ${s.pitch_angle} |\n`);
    m += `\n### Guest Post Titles\n${bs.guest_post_titles?.map((t: string, i: number) => `${i+1}. ${t}`).join('\n')}\n`;
    m += `\n### Broken Link Opportunities\n${bs.broken_link_opportunities?.map((b: any) => `- ${b.site}: ${b.dead_page_description} → ${b.your_replacement_content}`).join('\n')}\n`;
    m += `\n### HARO Queries to Monitor\n${bs.haro_queries_to_monitor?.map((h: string) => `- ${h}`).join('\n')}\n`;
    m += `\n### 📧 Outreach Email\n\`\`\`\n${bs.outreach_email}\n\`\`\`\n`;
  }

  m += `\n## ✅ On-Page Checklist\n${a.onpage_checklist?.map((item: string, i: number) => `${i+1}. ${item}`).join('\n')}`;
  m += `\n\n## 📊 Traffic Forecast (6 Months)\n- ${a.chart_data?.estimated_traffic_growth_6m?.map((v: number, i: number) => `Month ${i+1}: ${v?.toLocaleString()} visits`).join(' → ')}`;
  m += `\n\n---\n*MarketMuse AI PRO MAX ULTRA – $99 Report*`;
  return m;
}

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const cKey = `seo_${niche}_${country}`;
    const cached = cacheService.get(cKey);
    if (cached) return res.json(cached);

    console.log(`🔍 SEO: "${niche}" in ${country}`);
    const [search, questions, trends] = await Promise.all([
      getSearchResults(niche, country),
      getKeywordSuggestions(niche, country),
      getTrends(niche, country.toUpperCase()),
    ]);

    const serp = (search as any).organic_results?.slice(0, 8).map((r: any) => ({
      position: r.position, title: r.title, url: r.link, snippet: r.snippet || ''
    })) || [];

    const userMsg = `${niche}\n${country}\nSERP:${JSON.stringify(serp)}\nQuestions:${JSON.stringify(questions.slice(0,15))}\nTrends:${JSON.stringify(trends)}`;

    const ai = await runGroqWithRetry(SEO_PROMPT, userMsg);
    const analysis = JSON.parse(ai);
    const markdown = generateMarkdown(analysis, niche, country);

    const report = await Report.create({
      type: 'seo', niche, country, value: '$99',
      data: analysis, markdown, charts: { trends }
    });

    const result = { id: report._id, ...report.toObject() };
    cacheService.set(cKey, result, 86400);
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
};

export const getSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  res.json(report);
};
