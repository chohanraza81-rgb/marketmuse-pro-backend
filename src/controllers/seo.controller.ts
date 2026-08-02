import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getSearchResults, getKeywordSuggestions } from '../services/serpapi';
import { getTrends } from '../services/trends';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const SEO_SYSTEM_PROMPT = `You are an SEO director at a leading agency. Given a niche, country, real SERP top 10, related questions, and 12-month Google Trends, create a comprehensive SEO strategy.

Use the provided SERP data to extract real competitor URLs, titles, word counts, and backlink estimates. **Do not invent fake URLs** – reference the actual results.

Respond ONLY with a valid JSON object:

{
  "trend_score": "Seasonal" or "Evergreen",
  "trend_insight": string (one sentence explaining the trend pattern),
  "keywords": [
    {
      "keyword": string,
      "volume": number (realistic monthly searches, varying from high to low),
      "kd": number (0-100),
      "cpc": number,
      "intent": string ("informational", "commercial", "transactional")
    }
  ] (exactly 50, sorted by volume descending, with a realistic distribution: 5 high volume, 15 medium, 30 long-tail low volume),
  "serp_analysis": [
    {
      "position": number,
      "title": string (from SERP data),
      "url": string (from SERP data),
      "da": number (estimated domain authority),
      "pa": number (estimated page authority),
      "word_count": number,
      "backlinks": number,
      "ranking_keywords": number,
      "traffic_estimate": number,
      "strengths": string,
      "weaknesses": string
    }
  ] (exactly 10),
  "content_calendar": [
    {
      "week": number (1-24),
      "title": string (creative, click‑worthy blog post title),
      "keyword": string (primary target keyword),
      "content_type": string (e.g., "Pillar Page", "Listicle", "How‑to Guide", "Review"),
      "word_count_target": number,
      "outline": [string] (3-5 bullet points outlining the content)
    }
  ] (exactly 24 weeks),
  "backlink_strategy": {
    "overview": string,
    "target_sites": [
      { "site": string, "type": string, "contact_method": string }
    ] (5-10 specific sites/blogs to reach out to),
    "guest_post_ideas": [string] (3-5 topics),
    "resource_page_targets": [string],
    "broken_link_opportunities": [string]
  },
  "onpage_checklist": [string] (10-15 actionable points),
  "chart_data": {
    "trend_12m": number[] (12 values 0-100 from trends),
    "related_queries": [string] (from real data),
    "keyword_difficulty_distribution": { "easy": number, "medium": number, "hard": number },
    "volume_vs_kd": [
      { "keyword": string, "volume": number, "kd": number, "cpc": number }
    ] (top 20)
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

  return `# 🔍 SEO Report: ${niche}
## Target Market: ${countryNames[country] || country.toUpperCase()}

---

## 📊 Trend Analysis: **${analysis.trend_score}**

${analysis.trend_insight || ''}

This niche shows **${analysis.trend_score.toLowerCase()}** patterns. ${
    analysis.trend_score === 'Seasonal' 
      ? 'Plan content calendar around peak seasons for maximum traffic.' 
      : 'Consistent content publishing will yield steady traffic growth.'
  }

---

## 🏆 Top 50 Golden Keywords

| # | Keyword | Volume | KD | CPC | Intent | Difficulty |
|---|---------|--------|----|-----|--------|------------|
${analysis.keywords?.slice(0, 50).map((k: any, i: number) => 
  `| ${i + 1} | ${k.keyword} | ${k.volume?.toLocaleString() || 0} | ${k.kd || 0} | $${k.cpc?.toFixed(2) || '0.00'} | ${k.intent || 'informational'} | ${difficultyLabel(k.kd || 0)} |`
).join('\n') || 'No keywords available'}

---

## 📈 SERP Analysis (Top 10 Competitors)

${analysis.serp_analysis?.map((s: any, i: number) => 
  `### #${s.position} - ${s.title || 'Unknown'}
- **URL:** ${s.url || 'N/A'}
- **Domain Authority:** ${s.da || 0}/100
- **Page Authority:** ${s.pa || 0}/100
- **Word Count:** ${s.word_count?.toLocaleString() || 0}
- **Backlinks:** ${s.backlinks?.toLocaleString() || 0}
- **Ranking Keywords:** ${s.ranking_keywords?.toLocaleString() || 0}
- **Est. Traffic:** ${s.traffic_estimate?.toLocaleString() || 0}
- **Strengths:** ${s.strengths || 'N/A'}
- **Weaknesses:** ${s.weaknesses || 'N/A'}
- **Difficulty to Beat:** ${s.da > 70 ? '🔴 Very Hard' : s.da > 50 ? '🟡 Moderate' : '🟢 Achievable'}`
).join('\n\n') || 'No SERP data available'}

---

## 📅 24-Week Content Calendar

${analysis.content_calendar?.map((c: any, i: number) => 
  `### Week ${c.week || i+1} – ${c.title || 'Untitled'}
- **Type:** ${c.content_type || 'Blog Post'}
- **Target Keyword:** ${c.keyword || 'N/A'}
- **Word Count Target:** ${c.word_count_target || 1000}
- **Outline:** ${(c.outline || []).join(', ')}`
).join('\n') || 'No content calendar available'}

---

## 🔗 Backlink Strategy

### Overview
${analysis.backlink_strategy?.overview || 'N/A'}

### Target Sites
${analysis.backlink_strategy?.target_sites?.map((s: any) => 
  `- **${s.site}** (${s.type}) – Contact via ${s.contact_method}`
).join('\n') || 'None specified'}

### Guest Post Ideas
${analysis.backlink_strategy?.guest_post_ideas?.map((i: string) => `- ${i}`).join('\n') || 'None'}

### Resource Page Targets
${analysis.backlink_strategy?.resource_page_targets?.map((i: string) => `- ${i}`).join('\n') || 'None'}

### Broken Link Opportunities
${analysis.backlink_strategy?.broken_link_opportunities?.map((i: string) => `- ${i}`).join('\n') || 'None'}

---

## ✅ On-Page SEO Checklist

${analysis.onpage_checklist?.map((item: string, i: number) => `${i+1}. ${item}`).join('\n') || 'No checklist available'}

---

## 📊 Keyword Difficulty Distribution

- 🟢 **Easy (KD 0-30):** ${analysis.chart_data?.keyword_difficulty_distribution?.easy || 0}
- 🟡 **Medium (KD 31-60):** ${analysis.chart_data?.keyword_difficulty_distribution?.medium || 0}
- 🔴 **Hard (KD 61-100):** ${analysis.chart_data?.keyword_difficulty_distribution?.hard || 0}

---

## 🎯 Priority Actions

1. Target easy keywords first for quick wins
2. Create pillar content for medium difficulty keywords
3. Build backlinks gradually for hard keywords
4. Update content regularly based on trend patterns
5. Monitor SERP changes monthly

---

*Report generated by MarketMuse AI PRO MAX ULTRA - $99/report*`;
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

    // Slim down SERP data to essential fields only (top 10)
    const serpOrganic = (searchData as any).organic_results?.slice(0, 10).map((r: any) => ({
      position: r.position,
      title: r.title,
      url: r.link,
      snippet: r.snippet || '',
    })) || [];

    // Build user message with real data (trimmed)
    const userMessage = `Niche: ${niche}
Country: ${country} (${countryUpper})

Real SERP Top 10:
${JSON.stringify(serpOrganic, null, 2)}

Related Questions (from SERP):
${JSON.stringify(keywordSuggestions.slice(0, 15), null, 2)}

12-Month Google Trends:
${JSON.stringify(trendsData, null, 2)}

Please analyze and return a complete JSON. Ensure keywords have realistic volumes (not all the same), content calendar titles are original and engaging, and the backlink strategy lists actual websites where possible.`;

    console.log('🤖 Requesting Groq SEO analysis...');
    const groqResponse = await runGroqWithRetry(SEO_SYSTEM_PROMPT, userMessage);
    
    let analysis;
    try {
      const cleaned = groqResponse.replace(/```json|```/g, '').trim();
      analysis = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('❌ Failed to parse Groq JSON for SEO:', groqResponse.substring(0, 200));
      throw new Error('AI response format invalid. Please try again.');
    }

    if (!analysis.keywords || !analysis.serp_analysis || !analysis.content_calendar) {
      throw new Error('AI response missing required SEO fields');
    }

    const markdown = generateSEOMarkdown(analysis, niche, country);

    const charts = {
      trends: trendsData,
      trendScore: analysis.trend_score,
      serp: analysis.serp_analysis || [],
      keywords: analysis.keywords || [],
      contentCalendar: analysis.content_calendar || [],
      keywordDistribution: analysis.chart_data?.keyword_difficulty_distribution || {},
      volumeVsKD: analysis.chart_data?.volume_vs_kd || [],
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
