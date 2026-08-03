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
    console.error('❌ extractJSON failed. Cleaned string:', cleaned.substring(0, 300));
    throw new Error('AI response is not valid JSON');
  }
};

const SEO_SYSTEM_PROMPT = `You are an SEO director at a top‑tier digital agency. Given a niche, country, real SERP top 10, related questions, and 12‑month Google Trends, create a comprehensive, high‑value SEO strategy that a client would gladly pay $99 for.

Use the provided SERP data to extract real competitor URLs, titles, word counts, and backlink estimates. **Do not invent fake URLs** – reference the actual results.

Respond ONLY with a valid JSON object (no markdown, no code fences) exactly following this structure:

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
  ] (exactly 50, sorted by volume descending, with a realistic distribution: 5 high volume, 15 medium, 30 long‑tail low volume),
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
    "overview": string (a detailed, actionable paragraph describing the overall approach),
    "target_sites": [
      {
        "site": string (actual website name + URL),
        "type": string (e.g., "Blog", "Resource Page", "Directory", "Forum"),
        "contact_method": string (e.g., "Email editor@site.com", "Contact form", "Twitter DM"),
        "reason": string (why this site is a good target – relevance, authority, traffic)
      }
    ] (exactly 10 specific sites, derived from the niche. NOT generic. Include real potential targets like niche blogs, industry directories, resource pages, etc.),
    "guest_post_topics": [string] (5 specific, compelling guest post titles tailored to the niche),
    "broken_link_opportunities": [string] (3 realistic examples of broken links you could replace, described in detail),
    "resource_page_targets": [string] (5 URLs or descriptions of resource pages in the niche where you could get listed),
    "outreach_email_template": string (a complete, ready‑to‑use outreach email that the client can send immediately. Personalize with placeholders like {{FirstName}}, {{Website}}, etc.)
  },
  "onpage_checklist": [string] (15 actionable, specific items, not generic like "optimize title tags" – be precise, e.g., "Add FAQ schema to the main pillar page targeting 'how to learn ai'"),
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

  // Generate backlink section HTML/markdown with all details
  const backlinkSection = () => {
    const bs = analysis.backlink_strategy;
    if (!bs) return 'No backlink strategy provided.';

    let md = `### Overview\n${bs.overview || 'N/A'}\n\n`;

    if (bs.target_sites?.length) {
      md += `### 10 Specific Target Websites\n\n| # | Site | Type | Contact | Why |\n|---|------|------|---------|-----|\n`;
      bs.target_sites.forEach((s: any, i: number) => {
        md += `| ${i+1} | [${s.site}](${s.site.startsWith('http') ? s.site : 'https://'+s.site}) | ${s.type} | ${s.contact_method} | ${s.reason} |\n`;
      });
      md += '\n';
    }

    if (bs.guest_post_topics?.length) {
      md += `### Guest Post Topics\n${bs.guest_post_topics.map((t: string, i: number) => `${i+1}. ${t}`).join('\n')}\n\n`;
    }

    if (bs.broken_link_opportunities?.length) {
      md += `### Broken Link Opportunities\n${bs.broken_link_opportunities.map((b: string, i: number) => `- ${b}`).join('\n')}\n\n`;
    }

    if (bs.resource_page_targets?.length) {
      md += `### Resource Page Targets\n${bs.resource_page_targets.map((r: string) => `- ${r}`).join('\n')}\n\n`;
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

## 🔗 Backlink Strategy (Actionable)

${backlinkSection()}

---

## ✅ On‑Page SEO Checklist

${analysis.onpage_checklist?.map((item: string, i: number) => `${i+1}. ${item}`).join('\n') || 'No checklist available'}

---

## 📊 Keyword Difficulty Distribution

- 🟢 **Easy (KD 0‑30):** ${analysis.chart_data?.keyword_difficulty_distribution?.easy || 0}
- 🟡 **Medium (KD 31‑60):** ${analysis.chart_data?.keyword_difficulty_distribution?.medium || 0}
- 🔴 **Hard (KD 61‑100):** ${analysis.chart_data?.keyword_difficulty_distribution?.hard || 0}

---

## 🎯 Priority Actions

1. Target easy keywords first for quick wins
2. Create pillar content for medium difficulty keywords
3. Build backlinks gradually for hard keywords
4. Update content regularly based on trend patterns
5. Monitor SERP changes monthly

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

    const serpOrganic = (searchData as any).organic_results?.slice(0, 10).map((r: any) => ({
      position: r.position,
      title: r.title,
      url: r.link,
      snippet: r.snippet || '',
    })) || [];

    const userMessage = `Niche: ${niche}
Country: ${country} (${countryUpper})

Real SERP Top 10:
${JSON.stringify(serpOrganic, null, 2)}

Related Questions (from SERP):
${JSON.stringify(keywordSuggestions.slice(0, 15), null, 2)}

12-Month Google Trends:
${JSON.stringify(trendsData, null, 2)}

Please analyze and return a complete JSON with ALL required fields. For the backlink strategy, provide specific websites, an outreach email, and real opportunities. Ensure keywords have varied realistic volumes.`;

    console.log('🤖 Requesting Groq SEO analysis...');
    const groqResponse = await runGroqWithRetry(SEO_SYSTEM_PROMPT, userMessage);
    
    const analysis = extractJSON(groqResponse);

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
