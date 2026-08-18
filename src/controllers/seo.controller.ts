import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getRelatedKeywords } from '../services/keywordseverywhere';
import { getGoogleTrends } from '../services/trends';
import { getSearchResults, getKeywordSuggestions } from '../services/serpapi';
import { getSerperResults } from '../services/serper';
import { convertCurrency } from '../services/exchange';
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
  
  **STRICT INSTRUCTION FOR LINK ACQUISITION**:
  - Generate 5 target sites. If you don't know exact local sites, generate 5 realistic fictional sites relevant to this niche and country.
  - For each site, provide: site, da, type, contact, and a professional pitch. **DO NOT use "N/A" under any circumstance**. Invent a realistic name and email.
  
  **Requirements (Return valid JSON only)**:
  1. **key_insights** (Array of 3 actionable insights).
  2. **immediate_actions** (Array of 3 priority actions).
  3. **trend_assessment** (String, realistic summary).
  4. **keywords** (Array of 50 unique keywords. FORMAT: \`[{"keyword": "...", "volume": 1234, "cpc": 1.23, "kd": 35}]\`).
  5. **serp_landscape** (Analyze the top 8 URLs. Include: position, title, link, da, strengths, weaknesses, gap).
  6. **content_roadmap** (12 weeks. Must have: week, title, primary_keyword, content_type, secondary_keywords, word_count_target, outline, expected_traffic).
  7. **link_acquisition** (Overview, target_sites array, guest_post_topics array, broken_link_opportunities array, outreach_template).
  8. **onpage_checklist** (15 actionable points).
  9. **growth_accelerators** (5 actionable growth tips).
  10. **related_resources** (5 helpful URLs).

  Use current year 2026. Never leave any field empty. Make it sound like a senior consultant.`;
};

// 🛡️ 100% CUSTOM FALLBACK (No hardcoded lists, generates fictional but real-looking data)
function generateFullReportFallback(niche: string, country: string, keywords: KeywordData[], serp: any[], relatedQuestions: string[], trendData: number[]) {
  const cn = countryNames[country] || country;
  let subject = niche.replace(/^(how to |learn |master |best |top |ultimate |complete |guide to |tips for |strategies for |find |rank |start )/gi, '').trim();
  
  const insights = [
    `The demand for '${niche}' in ${cn} is consistently rising, with top keywords reaching high search volumes.`,
    `Competitors in the SERP lack deep, localized insights specifically tailored to the ${cn} market.`,
    `Targeting long-tail, low-competition queries will allow for rapid organic growth in the first 3-6 months.`
  ];
  const actions = [
    `Publish a definitive 3,000+ word pillar guide targeting the top primary keyword.`,
    `Produce localized content (e.g., local supplier lists, pricing comparisons, or community forums) specifically for ${cn}.`,
    `Launch a targeted link-building campaign focusing on ${cn}-based business, tech, or lifestyle publications.`
  ];
  const trendAssessment = `We are tracking a sustained, year-over-year interest in "${subject}" across ${cn}. This is an evergreen topic with predictable seasonal peaks.`;

  const roadmap = [];
  const safeKeywords = (keywords && keywords.length > 0) ? keywords : [{keyword: niche, volume: 1000, cpc: 0, kd: 0}];
  for (let i = 0; i < 12; i++) {
    const kw = safeKeywords[i % safeKeywords.length];
    roadmap.push({
      week: i + 1,
      title: `Week ${i+1}: ${kw.keyword}`,
      primary_keyword: kw.keyword,
      content_type: i % 3 === 0 ? 'Pillar' : i % 3 === 1 ? 'How-to' : 'Listicle', 
      secondary_keywords: [safeKeywords[(i+1)%safeKeywords.length]?.keyword, safeKeywords[(i+2)%safeKeywords.length]?.keyword].filter(Boolean),
      word_count_target: i === 0 ? 3500 : 2200 + (i * 100),
      outline: [`Introduction`, `Core Strategies for ${subject}`, `Practical Examples`, `Expert Tips & Tools`, `Conclusion`],
      expected_traffic: Math.floor(kw.volume * 0.5) + 100
    });
  }

  // GENERIC CUSTOM FALLBACK FOR LINK ACQUISITION (Prevents N/A)
  const linkAcquisition = {
    overview: `We will secure high-authority backlinks from top ${cn} publications and business directories.`,
    target_sites: [{ site: `${cn} Business Insider`, da: 65, type: 'Blog', contact: 'editor@cnbusinessinsider.com', pitch: 'Pitching a deep-dive guide on mastering this niche.' }],
    guest_post_topics: [`The Ultimate Guide to ${subject} in ${cn}`],
    broken_link_opportunities: [{ site: `${cn} Business Hub`, dead_page: `/resources/old-guide`, replacement: `/blog/mastering-${subject}` }],
    outreach_template: `Subject: Guest Post Opportunity\n\nHi [Name],\n\nWe at MusePRO have compiled a comprehensive guide on ${subject}. I believe this would be highly valuable for your audience. Would you be open to a guest post collaboration?`
  };

  return { key_insights: insights, immediate_actions: actions, trend_analysis: trendAssessment, trend_assessment: 'Evergreen', content_roadmap: roadmap, link_acquisition: linkAcquisition, onpage_checklist: ['Optimize meta titles with primary keywords.', 'Implement Schema markup for FAQs.', 'Ensure mobile responsiveness.'], growth_accelerators: ['Repurpose content into YouTube Shorts.', 'Create a free downloadable checklist.'], related_resources: [{ name: 'Google Trends', url: 'https://trends.google.com' }] };
}

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const ck = `seo_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    const kweData = await getRelatedKeywords(niche, country).catch(() => null);
    let searchData = await getSearchResults(niche, country).catch(() => null);
    
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

    const organic = searchData?.organic_results;
    const serp = (Array.isArray(organic) ? organic.slice(0, 8) : []).map((r: any) => ({
      position: r.position,
      title: r.title,
      link: r.link,
      snippet: r.snippet || '',
    }));

    const countryCurrencyMap: Record<string, string> = {
        us: 'USD', gb: 'GBP', ca: 'CAD', au: 'AUD',
        de: 'EUR', sg: 'SGD', sa: 'SAR', ae: 'AED',
        pk: 'PKR', in: 'INR', tr: 'TRY', my: 'MYR'
    };
    const targetCurrency = countryCurrencyMap[country] || 'USD';
    for (let kw of realKeywords) {
      kw.cpc = await convertCurrency(kw.cpc, 'USD', targetCurrency);
    }

    const prompt = buildSmartPrompt(niche, country, realKeywords, serp, trendData);
    const aiResponse = await runGroqWithRetry(prompt, JSON.stringify({ niche, country }));
    
    const rawAnalysis = extractJSON(aiResponse);
    const analysis = (typeof rawAnalysis === 'object' && !Array.isArray(rawAnalysis) && rawAnalysis !== null) ? rawAnalysis : {};

    let keywords: KeywordData[] = Array.isArray(analysis.keywords) ? analysis.keywords : realKeywords;
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      keywords = (realKeywords && Array.isArray(realKeywords)) ? realKeywords.slice(0, 50) : [];
    }
    keywords = keywords.map((k: any) => {
        if (typeof k === 'string') {
            return { keyword: k, volume: Math.floor(Math.random() * 2000) + 200, cpc: parseFloat((Math.random() * 1.5 + 0.3).toFixed(2)), kd: Math.floor(Math.random() * 40) + 5 };
        }
        return { keyword: k?.keyword || 'Unknown', volume: k?.volume || 0, cpc: k?.cpc || 0, kd: k?.kd || 0 };
    }).slice(0, 50);

    const serpWithMetrics = serp.map((r: any, i: number) => ({
      ...r,
      da: r.da || Math.floor(Math.random() * 50) + 30,
      traffic: Math.round(([0.3, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.02][Math.min(i, 7)] || 0.01) * (keywords[0]?.volume || 1000))
    }));

    const report = await Report.create({
      type: 'seo', niche, country, value: '$99',
      data: { ...analysis, keywords, serp: serpWithMetrics, relatedQuestions, trendData },
      markdown: 'Intelligence report generation in progress...', charts: {},
    });

    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;

    // 13 August Style Markdown Generation
    let markdown = `MusePRO\nReal-Time Market Research\nIntelligence Division\n──────────────────────────────────────────────────────────────\nSEO RESEARCH REPORT\n\nPrepared For: [Client Name]\nDate: ${today}\nReference: ${reportId}\nClassification: CONFIDENTIAL\n──────────────────────────────────────────────────────────────\n\n`;
    markdown += `1. EXECUTIVE BRIEF\n──────────────────────────────────────────────────────────────\n`;
    (analysis.key_insights || ['No insights generated']).forEach((f: string, i: number) => markdown += `  ${i+1}. ${f}\n`);
    markdown += `\nPriority Actions:\n`; 
    (analysis.immediate_actions || []).forEach((w: string, i: number) => markdown += `  ${i+1}. ${w}\n`);
    markdown += `\n2. TREND ASSESSMENT\n──────────────────────────────────────────────────────────────\n${analysis.trend_assessment || 'Evergreen trend detected.'}\n\n`;
    
    markdown += `3. KEYWORD OPPORTUNITIES (TOP 50)\n──────────────────────────────────────────────────────────────\n`;
    markdown += `| # | Keyword | Volume | CPC | KD | Potential |\n|---|---------|--------|-----|----|----------|\n`;
    keywords.forEach((k, i) => {
      const p = k.kd < 30 ? 'Easy Win' : k.kd < 60 ? 'Moderate' : 'Long Game';
      markdown += `| ${i+1} | ${k.keyword} | ${k.volume.toLocaleString()} | $${k.cpc.toFixed(2)} | ${k.kd} | ${p} |\n`;
    });
    
    markdown += `\n4. SERP LANDSCAPE\n──────────────────────────────────────────────────────────────\n`;
    (analysis.serp_landscape || serpWithMetrics || []).forEach((s: any, i: number) => {
      markdown += `Position #${i+1}: ${s.title}\n  URL: ${s.link}\n  DA: ${s.da} | Words: ${s.words || 'N/A'} | Backlinks: ${s.backlinks || 'N/A'}\n  Est. Traffic: ${s.traffic?.toLocaleString() || 0}/mo\n  Strengths: ${s.strengths || 'N/A'}\n  Weaknesses: ${s.weaknesses || 'N/A'}\n  Gap: ${s.gap || 'N/A'}\n\n`;
    });

    markdown += `5. CONTENT ROADMAP (12 WEEKS)\n──────────────────────────────────────────────────────────────\n`;
    (analysis.content_roadmap || []).forEach((c: any) => {
      const contentType = c.content_type || c.type || 'Guide';
      const secondary = (c.secondary_keywords && c.secondary_keywords.length > 0) ? c.secondary_keywords.join(', ') : '';
      
      markdown += `Week ${c.week}: ${c.title}\n  Keyword: ${c.primary_keyword} | Type: ${contentType}\n`;
      if (secondary) markdown += `  Secondary: ${secondary}\n`;
      markdown += `  Target Words: ${c.word_count_target || 2000}\n`;
      if (c.outline && Array.isArray(c.outline)) markdown += `  Outline: ${c.outline.join(' | ')}\n`;
      else if (c.outline && typeof c.outline === 'string') markdown += `  Outline: ${c.outline}\n`;
      markdown += `  Est. Traffic: ${(c.expected_traffic || 0).toLocaleString()}/mo\n\n`;
    });

    markdown += `6. LINK ACQUISITION STRATEGY\n──────────────────────────────────────────────────────────────\n`;
    markdown += `${analysis.link_acquisition?.overview || 'N/A'}\n\n`;
    
    // 🛡️ CRITICAL FIX: Filter out any sites that returned "N/A" or undefined from AI
    const targetSites = analysis.link_acquisition?.target_sites || [];
    const validTargetSites = targetSites.filter((s: any) => s.site && s.site !== 'N/A' && s.site !== 'undefined');

    if (validTargetSites.length > 0) {
      markdown += `Target Sites:\n`;
      validTargetSites.forEach((s: any, i: number) => {
        markdown += `  ${i+1}. ${s.site} (DA: ${s.da || 'N/A'})\n     Type: ${s.type || 'N/A'} | Contact: ${s.contact || 'N/A'}\n     Pitch: ${s.pitch || 'N/A'}\n\n`;
      });
    } else {
      markdown += `Target Sites: No specific sites identified, will leverage high-authority local publications.\n\n`;
    }

    markdown += `Guest Post Topics:\n`;
    (analysis.link_acquisition?.guest_post_topics || []).forEach((t: string, i: number) => markdown += `  ${i+1}. ${t}\n`);
    markdown += `\nBroken Link Opportunities:\n`;
    (analysis.link_acquisition?.broken_link_opportunities || []).forEach((b: any) => markdown += `  - ${b.site || 'N/A'}: ${b.dead_page || 'N/A'} → ${b.replacement || 'N/A'}\n`);
    markdown += `\nOutreach Template:\n${analysis.link_acquisition?.outreach_template || 'N/A'}\n\n`;

    markdown += `7. ON-PAGE OPTIMIZATION CHECKLIST\n──────────────────────────────────────────────────────────────\n`;
    (analysis.onpage_checklist || []).forEach((item: string, i: number) => markdown += `${i+1}. ${item || 'N/A'}\n`);

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
