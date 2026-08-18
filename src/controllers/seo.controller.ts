import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getRelatedKeywords } from '../services/keywordseverywhere';
import { getGoogleTrends } from '../services/trends';
import { getSearchResults, getKeywordSuggestions } from '../services/serpapi';
import { getSerperResults } from '../services/serper.service'; // ✅ Corrected Import
import { convertCurrency } from '../services/exchange.service'; // ✅ Corrected Import
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const extractJSON = (raw: string): any => {
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) cleaned = cleaned.substring(start, end + 1);
  try { return JSON.parse(cleaned); } 
  catch (err) {
    const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    try { return JSON.parse(fixed); } 
    catch (e2) {
      let completed = cleaned;
      let braceCount = (completed.match(/{/g) || []).length;
      let closeCount = (completed.match(/}/g) || []).length;
      while (closeCount < braceCount) { completed += '}'; closeCount++; }
      let bracketCount = (completed.match(/\[/g) || []).length;
      let closeBracketCount = (completed.match(/\]/g) || []).length;
      while (closeBracketCount < bracketCount) { completed += ']'; closeBracketCount++; }
      try { return JSON.parse(completed); } 
      catch (e3) { throw new Error('AI response is not valid JSON'); }
    }
  }
};

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

interface KeywordData { keyword: string; volume: number; cpc: number; kd: number; }

// ==========================================
// 🧠 SMART PROMPT FOR GEMINI FLASH (AI Simulator)
// ==========================================
const buildSmartPrompt = (niche: string, country: string, realKeywords: any[], serpData: any[], trendData: any[]) => {
  const countryName = countryNames[country] || country;
  return `You are an elite SEO strategist at MusePRO Intelligence Division.

  **Task**: Create a premium SEO research report for "${niche}" in "${countryName}".
  
  **Input Data**: 
  - Real Keywords: ${JSON.stringify(realKeywords.slice(0, 20))}
  - Real SERP URLs: ${JSON.stringify(serpData.map(s => s.link))}
  - Trend Data: ${JSON.stringify(trendData)}
  
  **If Real SERP Data is Empty or Missing**:
  - Imagine 8 realistic competitor websites for this specific niche and country.
  - For each imaginary website, generate: Title, URL, Est. DA, Snippet, Strengths, Weaknesses, and Content Gap.
  
  **Requirements (Return valid JSON only)**:
  1. **key_insights** (Array of 3 actionable insights).
  2. **immediate_actions** (Array of 3 priority actions).
  3. **trend_assessment** (String, realistic summary).
  4. **keywords** (Array of 50 unique, user-intent based keywords for this niche and country. NO "success framework" or "master in country" garbage. Realistic search terms).
  5. **serp_landscape** (Analyze the top 8 URLs using the provided or simulated data. Include fields: position, title, link, da, strengths, weaknesses, gap).
  6. **content_roadmap** (12 weeks. Each week must have: week, title, primary_keyword, secondary_keywords, word_count_target, outline, expected_traffic).
  7. **link_acquisition** (Overview, target_sites array, guest_post_topics array, outreach_template).
  8. **onpage_checklist** (15 actionable points).
  9. **growth_accelerators** (5 actionable growth tips).
  10. **related_resources** (5 helpful URLs).

  Use current year 2026. Never leave any field empty. Make it sound like a senior consultant.`;
};

// ==========================================
// 🚀 MAIN CONTROLLER
// ==========================================
export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const ck = `seo_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    // 1. Fetch Data from APIs
    const kweData = await getRelatedKeywords(niche, country).catch(() => null);
    let searchData = await getSearchResults(niche, country).catch(() => null);
    
    // 2. Emergency Backup: If SerpApi fails, use Serper API
    if (!searchData || !searchData.organic_results) {
      console.log('SerpApi failed. Trying Serper API as backup...');
      searchData = await getSerperResults(niche, country);
    }

    const relatedQuestions = await getKeywordSuggestions(niche, country).catch(() => []);
    const trendData = await getGoogleTrends(niche, country).catch(() => []);

    let realKeywords: KeywordData[] = [];
    if (kweData?.data?.length) {
      realKeywords = kweData.data.slice(0, 50).map((k: any) => ({
        keyword: k.keyword,
        volume: k.vol || 0,
        cpc: parseFloat(k.cpc?.value || '0'),
        kd: k.competition ? Math.min(Math.round(k.competition * 100), 100) : 0,
      }));
    }

    const serp = searchData?.organic_results?.slice(0, 8).map((r: any) => ({
      position: r.position,
      title: r.title,
      link: r.link,
      snippet: r.snippet || '',
    })) || [];

    // 3. Exchange API: Convert CPC to Local Currency
    const countryCurrencyMap: Record<string, string> = { us: 'USD', ca: 'CAD', au: 'AUD', sg: 'SGD', in: 'INR', gb: 'GBP', de: 'EUR' };
    const targetCurrency = countryCurrencyMap[country] || 'USD';
    for (let kw of realKeywords) {
      kw.cpc = await convertCurrency(kw.cpc, 'USD', targetCurrency);
    }

    // 4. Gemini Flash Smart Prompt
    const prompt = buildSmartPrompt(niche, country, realKeywords, serp, trendData);
    const aiResponse = await runGroqWithRetry(prompt, JSON.stringify({ niche, country }));
    const analysis = extractJSON(aiResponse);

    // 5. Use AI or Fallback keywords
    let keywords: KeywordData[] = analysis.keywords || realKeywords;
    if (!keywords || keywords.length === 0) {
      keywords = realKeywords.slice(0, 50);
    }

    const serpWithMetrics = serp.map((r: any, i: number) => ({
      ...r,
      da: r.da || Math.floor(Math.random() * 50) + 30, // Fallback DA if missing
      traffic: Math.round(([0.3, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.02][Math.min(i, 7)] || 0.01) * (keywords[0]?.volume || 1000))
    }));

    const report = await Report.create({
      type: 'seo', niche, country, value: '$99',
      data: { ...analysis, keywords, serp: serpWithMetrics, relatedQuestions, trendData },
      markdown: 'Intelligence report generation in progress...', charts: {},
    });

    // 6. Generate Markdown
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;

    let markdown = `MusePRO\nReal-Time Market Research\nIntelligence Division\n──────────────────────────────────────────────────────────────\nSEO RESEARCH REPORT\n\nPrepared For: [Client Name]\nDate: ${today}\nReference: ${reportId}\nClassification: CONFIDENTIAL\n──────────────────────────────────────────────────────────────\n\n`;
    markdown += `1. EXECUTIVE BRIEF\n──────────────────────────────────────────────────────────────\n`;
    (analysis.key_insights || ['No insights generated']).forEach((f: string, i: number) => markdown += `  ${i+1}. ${f}\n`);
    markdown += `\nPriority Actions:\n`; 
    (analysis.immediate_actions || []).forEach((w: string, i: number) => markdown += `  ${i+1}. ${w}\n`);
    markdown += `\n2. TREND ASSESSMENT\n──────────────────────────────────────────────────────────────\n${analysis.trend_assessment || 'Evergreen trend detected.'}\n\n`;
    
    markdown += `3. KEYWORD OPPORTUNITIES (TOP 50)\n──────────────────────────────────────────────────────────────\n| # | Keyword | Volume | CPC | KD | Potential |\n|---|---------|--------|-----|----|----------|\n`;
    keywords.forEach((k, i) => {
      const p = k.kd < 30 ? 'Easy Win' : k.kd < 60 ? 'Moderate' : 'Long Game';
      markdown += `| ${i+1} | ${k.keyword} | ${k.volume.toLocaleString()} | $${k.cpc.toFixed(2)} | ${k.kd} | ${p} |\n`;
    });
    
    markdown += `\n4. SERP LANDSCAPE\n──────────────────────────────────────────────────────────────\n`;
    (analysis.serp_landscape || serpWithMetrics || []).forEach((s: any, i: number) => {
      markdown += `Position #${i+1}: ${s.title}\n  URL: ${s.link}\n  Est. DA: ${s.da}\n  Strengths: ${s.strengths || 'N/A'}\n  Weaknesses: ${s.weaknesses || 'N/A'}\n  Gap: ${s.gap || 'N/A'}\n\n`;
    });

    markdown += `5. CONTENT ROADMAP (12 WEEKS)\n──────────────────────────────────────────────────────────────\n`;
    (analysis.content_roadmap || []).forEach((c: any) => markdown += `Week ${c.week}: ${c.title}\n  Keyword: ${c.primary_keyword} | Type: ${c.content_type}\n  Target Words: ${c.word_count_target}\n  Est. Traffic: ${c.expected_traffic?.toLocaleString()}/mo\n\n`);

    markdown += `6. LINK ACQUISITION STRATEGY\n──────────────────────────────────────────────────────────────\n${analysis.link_acquisition?.overview || ''}\n\n`;
    (analysis.link_acquisition?.target_sites || []).forEach((s: any, i: number) => markdown += `  ${i+1}. ${s.site}\n     Contact: ${s.contact}\n     Pitch: ${s.pitch}\n\n`);

    markdown += `7. ON-PAGE OPTIMIZATION CHECKLIST\n──────────────────────────────────────────────────────────────\n`;
    (analysis.onpage_checklist || []).forEach((item: string, i: number) => markdown += `${i+1}. ${item}\n`);

    report.markdown = markdown;
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
