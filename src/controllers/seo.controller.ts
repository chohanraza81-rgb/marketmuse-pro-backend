import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getSearchResults, getKeywordSuggestions } from '../services/serpapi';
import { getTrends } from '../services/trends';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

// Bulletproof JSON extraction
const extractJSON = (raw: string): any => {
  let cleaned = raw.replace(/```json|```/g, '').trim();
  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    cleaned = cleaned.substring(startIdx, endIdx + 1);
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('❌ extractJSON failed. Cleaned string length:', cleaned.length);
    console.error('First 300 chars:', cleaned.substring(0, 300));
    console.error('Last 300 chars:', cleaned.substring(cleaned.length - 300));
    throw new Error('AI response is not valid JSON');
  }
};

const SEO_SYSTEM_PROMPT = `You are an expert SEO consultant. Given a niche, country, SERP data, and trends, create a specific, actionable SEO strategy.

Respond ONLY with valid JSON (no markdown). Keep responses concise to fit within token limits.

{
  "trend_score": "Seasonal" or "Evergreen",
  "trend_insight": string (one sentence about the trend),
  "keywords": [
    {
      "keyword": string,
      "volume": number,
      "kd": number,
      "cpc": number,
      "intent": string ("informational", "commercial", "transactional")
    }
  ] (exactly 30, sorted by volume descending, realistic numbers),
  "serp_analysis": [
    {
      "position": number,
      "title": string (from real SERP),
      "url": string (from real SERP),
      "da": number,
      "word_count": number,
      "backlinks": number,
      "strengths": string (one specific strength),
      "weaknesses": string (one specific weakness)
    }
  ] (exactly 5, from the real data),
  "content_calendar": [
    {
      "week": number (1-12),
      "title": string (creative, click-worthy title),
      "keyword": string,
      "content_type": string (e.g., "Pillar Page", "Listicle", "How-to Guide"),
      "outline": [string] (3 bullet points)
    }
  ] (exactly 12 weeks),
  "backlink_strategy": {
    "overview": string (one strategic paragraph),
    "target_sites": [
      {
        "site": string (real website URL),
        "type": string,
        "contact_method": string,
        "reason": string
      }
    ] (exactly 5 real sites),
    "guest_post_topics": [string] (3 topics),
    "broken_link_opportunities": [string] (2 realistic examples),
    "outreach_email_template": string (a complete, personalized email template)
  },
  "onpage_checklist": [string] (10 specific, actionable items),
  "chart_data": {
    "trend_12m": number[] (12 values),
    "keyword_difficulty_distribution": { "easy": number, "medium": number, "hard": number }
  }
}`;

function generateSEOMarkdown(analysis: any, niche: string, country: string): string {
  const countryNames: Record<string, string> = {
    us: 'United States 🇺🇸',
    pk: 'Pakistan 🇵🇰',
    gb: 'United Kingdom 🇬🇧',
    ae: 'United Arab Emirates 🇦🇪',
    sa: 'Saudi Arabia 🇸🇦',
  };

  const difficultyLabel = (kd: number) => {
    if (kd <= 30) return '🟢 Easy';
    if (kd <= 60) return '🟡 Medium';
    return '🔴 Hard';
  };

  const backlinkSection = () => {
    const bs = analysis.backlink_strategy;
    if (!bs) return '';

    let md = `### Overview\n${bs.overview}\n\n`;

    if (bs.target_sites?.length) {
      md += `### 5 Target Websites\n\n| # | Site | Type | Contact | Why |\n|---|------|------|---------|-----|\n`;
      bs.target_sites.forEach((s: any, i: number) => {
        md += `| ${i+1} | ${s.site} | ${s.type} | ${s.contact_method} | ${s.reason} |\n`;
      });
      md += '\n';
    }

    if (bs.guest_post_topics?.length) {
      md += `### Guest Post Topics\n${bs.guest_post_topics.map((t: string, i: number) => `${i+1}. ${t}`).join('\n')}\n\n`;
    }

    if (bs.broken_link_opportunities?.length) {
      md += `### Broken Link Opportunities\n${bs.broken_link_opportunities.map((b: string) => `- ${b}`).join('\n')}\n\n`;
    }

    if (bs.outreach_email_template) {
      md += `### 📧 Outreach Email Template\n\`\`\`\n${bs.outreach_email_template}\n\`\`\`\n\n`;
    }

    return md;
  };

  return `# 🔍 SEO Report: ${niche}
## Target Market: ${countryNames[country] || country.toUpperCase()}

---

## 📊 Trend Analysis: **${analysis.trend_score}**

${analysis.trend_insight || ''}

---

## 🏆 Top 30 Keywords

| # | Keyword | Volume | KD | CPC | Intent | Difficulty |
|---|---------|--------|----|-----|--------|------------|
${analysis.keywords?.slice(0, 30).map((k: any, i: number) => 
  `| ${i + 1} | ${k.keyword} | ${k.volume?.toLocaleString() || 0} | ${k.kd || 0} | $${k.cpc?.toFixed(2) || '0.00'} | ${k.intent || 'informational'} | ${difficultyLabel(k.kd || 0)} |`
).join('\n') || ''}

---

## 📈 SERP Analysis

${analysis.serp_analysis?.map((s: any) => 
  `### #${s.position} - ${s.title}
- **URL:** ${s.url}
- **DA:** ${s.da} | **Words:** ${s.word_count} | **Backlinks:** ${s.backlinks}
- **Strength:** ${s.strengths}
- **Weakness:** ${s.weaknesses}`
).join('\n\n') || ''}

---

## 📅 12-Week Content Calendar

${analysis.content_calendar?.map((c: any) => 
  `### Week ${c.week} – ${c.title}
- **Type:** ${c.content_type}
- **Keyword:** ${c.keyword}
- **Outline:** ${(c.outline || []).join(' | ')}`
).join('\n') || ''}

---

## 🔗 Backlink Strategy

${backlinkSection()}

---

## ✅ On-Page Checklist

${analysis.onpage_checklist?.map((item: string, i: number) => `${i+1}. ${item}`).join('\n') || ''}

---

## 📊 Keyword Difficulty

- 🟢 Easy (KD 0-30): ${analysis.chart_data?.keyword_difficulty_distribution?.easy || 0}
- 🟡 Medium (KD 31-60): ${analysis.chart_data?.keyword_difficulty_distribution?.medium || 0}
- 🔴 Hard (KD 61-100): ${analysis.chart_data?.keyword_difficulty_distribution?.hard || 0}

---

*Report generated by MarketMuse AI PRO MAX ULTRA – $99/report*`;
}

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const countryUpper = country.toUpperCase();
    
    const cacheKey = `seo_report_${niche}_${country}`;
    const cached = cacheService.get(cacheKey);
    if (cached) {
      console.log('📦 Returning cached SEO report');
      return res.json(cached);
    }

    console.log(`🔍 Starting SEO research: "${niche}" in ${countryUpper}`);

    const [searchData, keywordSuggestions, trendsData] = await Promise.all([
      getSearchResults(niche, country),
      getKeywordSuggestions(niche, country),
      getTrends(niche, countryUpper),
    ]);

    const serpOrganic = (searchData as any).organic_results?.slice(0, 5).map((r: any) => ({
      position: r.position,
      title: r.title,
      url: r.link,
      snippet: r.snippet || '',
    })) || [];

    const userMessage = `Niche: ${niche}
Country: ${country}

SERP Top 5:
${JSON.stringify(serpOrganic)}

Related Questions:
${JSON.stringify(keywordSuggestions.slice(0, 10))}

12-Month Trends:
${JSON.stringify(trendsData.slice(0, 6))}

Create a complete JSON response. Keep backlink sites realistic. Make the outreach email ready to send.`;

    console.log('🤖 Requesting Groq analysis...');
    const groqResponse = await runGroqWithRetry(SEO_SYSTEM_PROMPT, userMessage);
    
    const analysis = extractJSON(groqResponse);

    if (!analysis.keywords || !analysis.content_calendar) {
      throw new Error('AI response missing required fields');
    }

    const markdown = generateSEOMarkdown(analysis, niche, country);

    const charts = {
      trends: trendsData,
      trendScore: analysis.trend_score,
      serp: analysis.serp_analysis || [],
      keywords: analysis.keywords || [],
      contentCalendar: analysis.content_calendar || [],
      keywordDistribution: analysis.chart_data?.keyword_difficulty_distribution || {},
    };

    const report = await Report.create({
      type: 'seo',
      niche,
      country,
      value: '$99',
      data: analysis,
      markdown,
      charts,
    });

    console.log('✅ SEO report generated:', report._id);

    const result = {
      id: report._id,
      type: report.type,
      niche: report.niche,
      country: report.country,
      value: report.value,
      data: analysis,
      markdown: report.markdown,
      charts: charts,
      createdAt: report.createdAt,
    };

    cacheService.set(cacheKey, result, 86400);
    return res.status(201).json(result);

  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
      });
    }
    next(err);
  }
};

export const getSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    if (report.type !== 'seo') {
      return res.status(400).json({ error: 'This is not an SEO report' });
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
};
