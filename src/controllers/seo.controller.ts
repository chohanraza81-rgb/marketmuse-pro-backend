import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getSearchResults, getKeywordSuggestions } from '../services/serpapi';
import { getTrends } from '../services/trends';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const SEO_SYSTEM_PROMPT = `You are an expert SEO strategist with 10+ years of experience. Given a niche and country, analyze search data and trends to create a comprehensive SEO report.

Respond ONLY with a valid JSON object (no markdown, no code fences, no extra text) that exactly follows this structure:
{
  "keywords": [
    {
      "keyword": string,
      "volume": number,
      "kd": number (0-100),
      "cpc": number
    }
  ] (exactly 50 items, sorted by volume descending),
  "trend_score": string ("Seasonal" or "Evergreen"),
  "serp_analysis": [
    {
      "position": number (1-10),
      "title": string,
      "url": string,
      "da": number (0-100),
      "word_count": number,
      "backlinks": number
    }
  ] (exactly 10 items),
  "content_calendar": [
    {
      "title": string,
      "keyword": string
    }
  ] (exactly 24 items),
  "backlink_strategy": string (detailed strategy 200+ words),
  "onpage_checklist": [string] (at least 10 items),
  "chart_data": {
    "trend_12m": [number] (12 monthly values),
    "related_queries": [string] (10 related queries),
    "keyword_difficulty_distribution": {
      "easy": number (KD 0-30 count),
      "medium": number (KD 31-60 count),
      "hard": number (KD 61-100 count)
    },
    "volume_vs_kd": [
      {
        "keyword": string,
        "volume": number,
        "kd": number,
        "cpc": number
      }
    ] (top 20 keywords for bubble chart)
  }
}

IMPORTANT RULES:
- Keywords must be realistic and relevant to the niche
- KD (Keyword Difficulty) must be 0-100 scale
- Volume numbers must be realistic monthly searches
- CPC must be realistic (typically $0.50-$50)
- SERP analysis must have realistic DA scores (20-95)
- Content calendar titles must be unique and SEO-optimized
- Backlink strategy must be actionable and specific
- Onpage checklist must cover all major SEO factors
- chart_data.trend_12m must show realistic seasonal or growth patterns
- All arrays must have the exact number of items specified`;

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

This niche shows **${analysis.trend_score.toLowerCase()}** patterns. ${
    analysis.trend_score === 'Seasonal' 
      ? 'Plan content calendar around peak seasons for maximum traffic.' 
      : 'Consistent content publishing will yield steady traffic growth.'
  }

---

## 🏆 Top 50 Golden Keywords

| # | Keyword | Volume | KD | CPC | Difficulty |
|---|---------|--------|----|-----|------------|
${analysis.keywords?.slice(0, 50).map((k: any, i: number) => 
  `| ${i + 1} | ${k.keyword} | ${k.volume?.toLocaleString() || 0} | ${k.kd || 0} | $${k.cpc?.toFixed(2) || '0.00'} | ${difficultyLabel(k.kd || 0)} |`
).join('\n') || 'No keywords available'}

---

## 📈 SERP Analysis (Top 10 Competitors)

${analysis.serp_analysis?.map((s: any, i: number) => 
  `### #${s.position} - ${s.title || 'Unknown'}
- **URL:** ${s.url || 'N/A'}
- **Domain Authority:** ${s.da || 0}/100
- **Word Count:** ${s.word_count?.toLocaleString() || 0}
- **Backlinks:** ${s.backlinks?.toLocaleString() || 0}
- **Difficulty to Beat:** ${s.da > 70 ? '🔴 Very Hard' : s.da > 50 ? '🟡 Moderate' : '🟢 Achievable'}`
).join('\n\n') || 'No SERP data available'}

---

## 📅 24-Week Content Calendar

${analysis.content_calendar?.map((c: any, i: number) => 
  `### Week ${i + 1}
- **Title:** ${c.title || 'Untitled'}
- **Target Keyword:** ${c.keyword || 'N/A'}`
).join('\n') || 'No content calendar available'}

---

## 🔗 Backlink Strategy

${analysis.backlink_strategy || 'No strategy provided'}

---

## ✅ On-Page SEO Checklist

${analysis.onpage_checklist?.map((item: string, i: number) => 
  `${i + 1}. ${item}`
).join('\n') || 'No checklist available'}

---

## 📊 Keyword Difficulty Distribution

- 🟢 **Easy (KD 0-30):** ${analysis.chart_data?.keyword_difficulty_distribution?.easy || 0} keywords
- 🟡 **Medium (KD 31-60):** ${analysis.chart_data?.keyword_difficulty_distribution?.medium || 0} keywords
- 🔴 **Hard (KD 61-100):** ${analysis.chart_data?.keyword_difficulty_distribution?.hard || 0} keywords

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

// CREATE SEO Report
export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate input
    const { niche, country } = seoReportSchema.parse(req.body);
    const countryUpper = country.toUpperCase();
    
    // Check cache
    const cacheKey = `seo_report_${niche}_${country}`;
    const cached = cacheService.get(cacheKey);
    if (cached) {
      console.log('📦 Returning cached SEO report');
      return res.json(cached);
    }

    console.log(`🔍 Starting SEO research: "${niche}" in ${countryUpper}`);

    // Parallel data fetching
    const [searchData, keywordSuggestions, trendsData] = await Promise.all([
      getSearchResults(niche, country),
      getKeywordSuggestions(niche, country),
      getTrends(niche, countryUpper),
    ]);

    // Extract SERP organic results
    const serpOrganic = (searchData as any).organic_results?.slice(0, 10).map((r: any) => ({
      position: r.position,
      title: r.title,
      url: r.link,
      snippet: r.snippet || '',
    })) || [];

    // Build user message with real data
    const userMessage = `Niche: ${niche}
Country: ${country} (${countryUpper})

SERP Top 10 Results:
${JSON.stringify(serpOrganic, null, 2)}

Related Questions (from SERP):
${JSON.stringify(keywordSuggestions.slice(0, 15), null, 2)}

12-Month Google Trends Data:
${JSON.stringify(trendsData, null, 2)}

Please analyze this niche and provide a complete SEO report with all required fields.`;

    // Get AI analysis
    console.log('🤖 Requesting Groq SEO analysis...');
    const groqResponse = await runGroqWithRetry(SEO_SYSTEM_PROMPT, userMessage);
    
    // Parse JSON from Groq
    let analysis;
    try {
      const cleaned = groqResponse.replace(/```json|```/g, '').trim();
      analysis = JSON.parse(cleaned);
    } catch (parseError) {
      console.error('❌ Failed to parse Groq JSON for SEO:', groqResponse.substring(0, 200));
      throw new Error('AI response format invalid. Please try again.');
    }

    // Validate required fields
    if (!analysis.keywords || !analysis.serp_analysis || !analysis.content_calendar) {
      throw new Error('AI response missing required SEO fields');
    }

    // Ensure arrays have correct lengths
    if (analysis.keywords.length < 30) {
      console.warn('⚠️ Fewer keywords than expected, padding with related queries');
      const relatedKeywords = keywordSuggestions.map((q: string) => ({
        keyword: q,
        volume: Math.floor(Math.random() * 1000) + 100,
        kd: Math.floor(Math.random() * 40) + 10,
        cpc: parseFloat((Math.random() * 5 + 1).toFixed(2)),
      }));
      analysis.keywords = [...analysis.keywords, ...relatedKeywords].slice(0, 50);
    }

    // Generate markdown
    const markdown = generateSEOMarkdown(analysis, niche, country);

    // Build chart data for frontend
    const charts = {
      trends: trendsData,
      trendScore: analysis.trend_score,
      serp: analysis.serp_analysis || [],
      keywords: analysis.keywords || [],
      contentCalendar: analysis.content_calendar || [],
      keywordDistribution: analysis.chart_data?.keyword_difficulty_distribution || {},
      volumeVsKD: analysis.chart_data?.volume_vs_kd || [],
    };

    // Save to database
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

    // Cache for 24 hours
    cacheService.set(cacheKey, result, 86400);

    return res.status(201).json(result);

  } catch (err) {
    // Handle validation errors
    if (err instanceof ZodError) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
      });
    }
    
    // Pass other errors to error handler
    next(err);
  }
};

// GET SEO Report by ID
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

// DELETE SEO Report
export const deleteSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await Report.findOneAndDelete({ 
      _id: req.params.id, 
      type: 'seo' 
    });
    
    if (!report) {
      return res.status(404).json({ error: 'SEO report not found' });
    }

    res.json({ message: 'SEO report deleted successfully', id: report._id });
  } catch (err) {
    next(err);
  }
};

// GET SEO Reports List
export const getSEOReports = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { country, limit = 10, page = 1 } = req.query;
    const filter: any = { type: 'seo' };
    
    if (country) filter.country = country.toString().toLowerCase();

    const total = await Report.countDocuments(filter);
    const reports = await Report.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .select('-data -markdown')
      .lean();

    res.json({
      reports,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
};
