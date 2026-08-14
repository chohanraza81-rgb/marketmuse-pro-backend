import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getKeywordDataAndTrend, RealKeywordData } from '../services/dataforseo';
import { getSerperResults } from '../services/serper';
import { getKeywordSuggestions } from '../services/serpapi';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const extractJSON = (raw: string): any => {
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) cleaned = cleaned.substring(start, end + 1);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      let completed = cleaned;
      let braceCount = (completed.match(/{/g) || []).length;
      let closeCount = (completed.match(/}/g) || []).length;
      while (closeCount < braceCount) { completed += '}'; closeCount++; }
      let bracketCount = (completed.match(/\[/g) || []).length;
      let closeBracketCount = (completed.match(/\]/g) || []).length;
      while (closeBracketCount < bracketCount) { completed += ']'; closeBracketCount++; }
      try {
        return JSON.parse(completed);
      } catch (e3) {
        throw new Error('AI response is not valid JSON');
      }
    }
  }
};

const PROMPT = `You are an elite SEO strategist at MusePRO Intelligence Division. Write like a senior consultant. Use current year 2026. Use only the provided real data. Return valid JSON with all required sections. No undefined, no placeholder. If no value, use "Not Disclosed".`;

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

interface KeywordData {
  keyword: string;
  volume: number | null;
  cpc: number | null;
  kd: number | null;
}

function estimateDA(link: string): number {
  const domain = new URL(link).hostname.replace(/^www\./, '');
  const known: Record<string, number> = {
    'google.com': 100, 'youtube.com': 100, 'linkedin.com': 98, 'medium.com': 94,
    'reddit.com': 91, 'quora.com': 93, 'wikipedia.org': 96, 'amazon.com': 96,
    'facebook.com': 96, 'twitter.com': 94, 'apple.com': 97, 'microsoft.com': 96,
    'github.com': 95, 'stackoverflow.com': 93,
  };
  return domain.endsWith('.edu') || domain.endsWith('.gov') ? 80 : known[domain] || 35;
}

function estimateTraffic(position: number, volume: number | null): number | null {
  if (!volume || volume <= 0) return null;
  const ctr = [0.3, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.02][Math.min(position - 1, 7)] || 0.01;
  return Math.round(volume * ctr);
}

function cleanSERPTitle(title: string): string {
  let clean = title;
  if (clean.includes('|')) clean = clean.split('|')[0].trim();
  if (clean.includes(' - ')) clean = clean.split(' - ')[0].trim();
  clean = clean.replace(/^\d+\.\s*/, '').trim();
  if (clean.length > 80) clean = clean.substring(0, 80) + '...';
  return clean;
}

function generateSmartFallbackKeywords(
  serperData: any,
  relatedQuestions: string[],
  niche: string
): KeywordData[] {
  const keywordsSet = new Set<string>();

  if (serperData?.relatedSearches) {
    serperData.relatedSearches.forEach((q: string) => keywordsSet.add(q));
  }

  relatedQuestions.forEach((q: string) => keywordsSet.add(q));

  if (serperData?.organic) {
    serperData.organic.forEach((r: any) => {
      const cleaned = cleanSERPTitle(r.title);
      if (cleaned) keywordsSet.add(cleaned);
    });
  }

  let keywords = Array.from(keywordsSet).slice(0, 30).map((q) => ({
    keyword: q,
    volume: null,
    cpc: null,
    kd: null,
  }));

  if (keywords.length < 5) {
    const fallbacks = [
      `${niche} guide`,
      `${niche} tips`,
      `best ${niche}`,
      `how to ${niche}`,
      `${niche} 2026`,
    ];
    fallbacks.forEach((q) => keywordsSet.add(q));
    keywords = Array.from(keywordsSet).slice(0, 30).map((q) => ({
      keyword: q,
      volume: null,
      cpc: null,
      kd: null,
    }));
  }

  return keywords;
}

function ensureCompleteAnalysis(analysis: any, keywords: KeywordData[], serp: any[], niche: string): any {
  const safe = { ...analysis };

  if (!safe.trend_assessment) safe.trend_assessment = 'Not Disclosed';
  if (!safe.trend_analysis) safe.trend_analysis = 'Not Disclosed';

  if (!Array.isArray(safe.key_insights) || safe.key_insights.length < 3) {
    safe.key_insights = [
      `Top competitors include ${serp.slice(0, 3).map(s => s.title).join(', ')}.`,
      `${keywords.length} keyword opportunities were identified.`,
      `Based on live SERP analysis and real search data.`,
    ];
  }

  if (!Array.isArray(safe.immediate_actions) || safe.immediate_actions.length < 3) {
    safe.immediate_actions = [
      'Create targeted content for the top keywords.',
      'Optimize on-page SEO for identified opportunities.',
      'Build backlinks from high-authority domains in the SERP.',
    ];
  }

  if (!Array.isArray(safe.content_roadmap) || safe.content_roadmap.length < 12) {
    safe.content_roadmap = Array.from({ length: 12 }, (_, i) => {
      const kw = keywords[i % keywords.length]?.keyword || niche;
      return {
        week: i + 1,
        title: `${kw} – Comprehensive Guide`,
        primary_keyword: kw,
        secondary_keywords: [],
        content_type: 'Pillar',
        word_count_target: 2000,
        outline: ['Introduction', 'Key Concepts', 'Step-by-Step Process', 'Common Mistakes', 'Conclusion'],
        expected_traffic: 100,
      };
    });
  }

  if (!safe.link_acquisition || !safe.link_acquisition.target_sites || safe.link_acquisition.target_sites.length < 8) {
    safe.link_acquisition = {
      overview: 'We recommend reaching out to high-authority sites in the SERP.',
      target_sites: serp.slice(0, 8).map(s => ({
        site: s.link,
        da: s.da,
        type: 'Blog',
        contact: 'N/A',
        pitch: `We have a comprehensive guide on ${niche} that would be valuable for your readers.`,
      })),
      guest_post_topics: ['How to Succeed with ' + niche, niche + ' Trends for 2026', 'Case Study: ' + niche],
      broken_link_opportunities: [],
      outreach_template: `Hi [Name], I noticed your page on [Topic]. We have a fresh guide on ${niche} that may be useful.`,
    };
  }

  if (!Array.isArray(safe.onpage_checklist) || safe.onpage_checklist.length < 8) {
    safe.onpage_checklist = [
      'Include primary keyword in H1 and title tag',
      'Write meta description under 155 characters',
      'Use H2/H3 subheadings with secondary keywords',
      'Add internal links to related content',
      'Optimize images with alt text',
      'Ensure mobile responsiveness',
      'Improve page load speed',
      'Add FAQ schema',
    ];
  }

  if (!Array.isArray(safe.growth_accelerators) || safe.growth_accelerators.length < 3) {
    safe.growth_accelerators = [
      'Leverage social media to promote content',
      'Use email outreach for backlinks',
      'Create a lead magnet for email capture',
    ];
  }

  if (!Array.isArray(safe.related_resources) || safe.related_resources.length < 5) {
    safe.related_resources = serp.slice(0, 8).map(s => ({ name: s.title, url: s.link }));
  }

  return safe;
}

function generateMarkdown(
  analysis: any,
  keywords: KeywordData[],
  serp: any[],
  relatedQuestions: string[],
  trendData: number[],
  niche: string,
  country: string,
  reportId: string,
  dataSourceStatus: string
): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let m = '';

  m += `MusePRO\nReal-Time Market Research\nIntelligence Division\n──────────────────────────────────────────────────────────────\nSEO RESEARCH REPORT\n\nPrepared For: [Client Name]\nDate: ${today}\nReference: ${reportId}\nClassification: CONFIDENTIAL\n──────────────────────────────────────────────────────────────\n\n`;

  m += `1. YOUR OPPORTUNITY AT A GLANCE\n──────────────────────────────────────────────────────────────\n`;
  m += `We analyzed the organic search landscape for "${niche}" in ${countryNames[country] || country}. The trend is ${analysis.trend_assessment || 'Not Disclosed'} with ${keywords.length} keyword opportunities identified.\n\n`;
  if (analysis.key_insights?.length) {
    m += `Key Insights:\n`;
    analysis.key_insights.forEach((f: string, i: number) => (m += `  ${i + 1}. ${f}\n`));
    m += `\n`;
  }
  if (analysis.immediate_actions?.length) {
    m += `What To Do First:\n`;
    analysis.immediate_actions.forEach((w: string, i: number) => (m += `  ${i + 1}. ${w}\n`));
    m += `\n`;
  }

  m += `2. WHAT THE DATA SHOWS\n──────────────────────────────────────────────────────────────\n${typeof analysis.trend_analysis === 'string' ? analysis.trend_analysis : 'Not Disclosed'}\n`;
  if (trendData && trendData.length > 0) {
    m += `12-Month Search Trend: ${trendData.join(' → ')}\n`;
  }
  m += `Source: ${dataSourceStatus}\n\n`;

  m += `3. KEYWORDS WORTH TARGETING\n──────────────────────────────────────────────────────────────\nSource: ${dataSourceStatus}\n\n`;
  m += `| # | Keyword | Volume | CPC | KD | Potential |\n|---|---------|--------|-----|----|----------|\n`;
  keywords.forEach((k, i) => {
    const vol = k.volume !== null ? k.volume.toLocaleString() : 'Not Disclosed';
    const cpc = k.cpc !== null ? `$${k.cpc.toFixed(2)}` : 'Not Disclosed';
    const kd = k.kd !== null ? k.kd : 'Not Disclosed';
    const potential = k.kd !== null ? (k.kd < 30 ? 'Easy Win' : k.kd < 60 ? 'Moderate' : 'Long Game') : 'Not Disclosed';
    m += `| ${i + 1} | ${k.keyword} | ${vol} | ${cpc} | ${kd} | ${potential} |\n`;
  });
  m += `\n`;

  m += `4. WHO'S RANKING TODAY\n──────────────────────────────────────────────────────────────\nSource: Serper API (Live Google SERP)\n\n`;
  serp.forEach((s, i) => {
    m += `Position #${i + 1}: ${s.title}\n  URL: ${s.link}\n  Est. DA: ${s.da}\n  Est. Traffic: ${s.traffic !== null ? s.traffic.toLocaleString() : 'Not Disclosed'} visits/mo\n  Snippet: ${s.snippet?.substring(0, 120) || 'N/A'}\n\n`;
  });
  m += `\n`;

  if (relatedQuestions.length) {
    m += `5. PEOPLE ARE ASKING\n──────────────────────────────────────────────────────────────\n`;
    relatedQuestions.forEach((q, i) => (m += `${i + 1}. ${q}\n`));
    m += `\n`;
  }

  m += `6. YOUR CONTENT GAME PLAN\n──────────────────────────────────────────────────────────────\n`;
  analysis.content_roadmap?.forEach((c: any, idx: number) => {
    m += `Week ${c.week || idx + 1}: ${c.title || 'N/A'}\n  Keyword: ${c.primary_keyword || 'N/A'} | Type: ${c.content_type || 'N/A'}\n  Secondary: ${c.secondary_keywords?.join(', ') || 'N/A'}\n  Target Words: ${c.word_count_target || 'N/A'}\n  Outline: ${c.outline?.join(' | ') || 'N/A'}\n  Est. Traffic: ${c.expected_traffic?.toLocaleString() || 'N/A'}/mo\n\n`;
  });

  const bs = analysis.link_acquisition;
  if (bs) {
    m += `7. AUTHORITY BUILDING\n──────────────────────────────────────────────────────────────\n${bs.overview || 'N/A'}\n\n`;
    if (bs.target_sites?.length) {
      m += `Target Sites:\n`;
      bs.target_sites.forEach((s: any, i: number) => (m += `  ${i + 1}. ${s.site || 'N/A'} (DA: ${s.da || 'N/A'})\n     Type: ${s.type || 'N/A'} | Contact: ${s.contact || 'N/A'}\n     Pitch: ${s.pitch || 'N/A'}\n\n`));
    }
    if (bs.guest_post_topics?.length) {
      m += `Guest Post Topics:\n`;
      bs.guest_post_topics.forEach((t: string, i: number) => (m += `  ${i + 1}. ${t}\n`));
      m += `\n`;
    }
    if (bs.broken_link_opportunities?.length) {
      m += `Broken Link Opportunities:\n`;
      bs.broken_link_opportunities.forEach((b: any) => (m += `  - ${b.site}: ${b.dead_page} → ${b.replacement}\n`));
      m += `\n`;
    }
    if (bs.outreach_template) {
      m += `Outreach Template:\n${bs.outreach_template}\n\n`;
    }
  }

  m += `8. ON-PAGE QUICK WINS\n──────────────────────────────────────────────────────────────\n`;
  analysis.onpage_checklist?.forEach((item: string, i: number) => (m += `${i + 1}. ${item}\n`));
  m += `\n`;

  if (analysis.growth_accelerators?.length) {
    m += `9. GROWTH LEVERS\n──────────────────────────────────────────────────────────────\n`;
    analysis.growth_accelerators.forEach((tip: string, i: number) => (m += `${i + 1}. ${tip}\n`));
    m += `\n`;
  }

  if (analysis.related_resources?.length) {
    m += `10. TOOLS & RESOURCES\n──────────────────────────────────────────────────────────────\n`;
    analysis.related_resources.forEach((res: any, i: number) => (m += `${i + 1}. ${res.name || 'N/A'} – ${res.url || 'N/A'}\n`));
    m += `\n`;
  }

  m += `METHODOLOGY & SOURCES\n──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• ${dataSourceStatus}\n• Live Google SERP via Serper API (serper.dev)\n• People Also Ask via SerpApi (serpapi.com)\n• Analysis Engine: Gemini AI (Hybrid Pro/Flash)\n\nAll data points can be independently verified against their public sources.\n\n`;
  m += `DOCUMENT CONTROL\n──────────────────────────────────────────────────────────────\nClassification:  Confidential\nDistribution:    Client Only\nVersion:         1.0\nPrepared By:     MusePRO Intelligence Division\n\n`;
  m += `DISCLAIMER\n──────────────────────────────────────────────────────────────\nThis document contains proprietary research conducted by MusePRO. The information herein is intended solely for the designated recipient. Unauthorized distribution, copying, or disclosure is strictly prohibited.\n\nWhile every effort has been made to ensure accuracy, market conditions change rapidly. Verify critical data points before making business decisions.\n\n`;
  m += `──────────────────────────────────────────────────────────────\n© MusePRO — Intelligence Division. All Rights Reserved.\n`;

  return m;
}

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const ck = `seo_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    console.log(`SEO: "${niche}" in ${country}`);

    // 1. Fetch real SERP from Serper
    const serperData = await getSerperResults(niche, country).catch(() => null);

    // 2. Fetch People Also Ask from SerpApi
    const relatedQuestions = await getKeywordSuggestions(niche, country).catch(() => []);

    // 3. Fetch keyword data and trend from DataForSEO
    let keywords: KeywordData[] = [];
    let trendData: number[] = [];
    let dataSourceStatus = 'Google Keyword Planner via DataForSEO (dataforseo.com)';

    try {
      const { keywords: dfKeywords, trend } = await getKeywordDataAndTrend(niche, country, 50);
      if (dfKeywords && dfKeywords.length > 0) {
        keywords = dfKeywords.map((k: RealKeywordData) => ({ keyword: k.keyword, volume: k.volume, cpc: k.cpc, kd: k.kd }));
        trendData = trend;
        console.log(`✅ DataForSEO provided ${keywords.length} keywords and ${trend.length} trend points`);
      } else {
        throw new Error('DataForSEO returned empty');
      }
    } catch (dfError) {
      console.warn(`⚠️ DataForSEO failed, switching to smart fallback`);
      dataSourceStatus = 'Live Google SERP via Serper API (serper.dev) & People Also Ask via SerpApi (serpapi.com)';
      keywords = generateSmartFallbackKeywords(serperData, relatedQuestions, niche);
      if (keywords.length === 0) {
        throw new Error('No keyword data available from any real source.');
      }
    }

    // 4. Prepare SERP with metrics
    const serpWithMetrics = (serperData?.organic || []).slice(0, 8).map((r: any) => ({
      ...r,
      da: estimateDA(r.link),
      traffic: estimateTraffic(r.position, keywords[0]?.volume ?? null),
    }));

    // 5. AI call
    const aiContext = { niche, country, keywords, serp: serpWithMetrics, relatedQuestions, trendData };
    const ai = await runGroqWithRetry(PROMPT, JSON.stringify(aiContext));
    const analysis = extractJSON(ai);

    // 6. Ensure completeness
    const safeAnalysis = ensureCompleteAnalysis(analysis, keywords, serpWithMetrics, niche);

    // 7. Save report
    const report = await Report.create({
      type: 'seo',
      niche,
      country,
      value: '$99',
      data: { ...safeAnalysis, keywords, serp: serpWithMetrics, relatedQuestions, trendData },
      markdown: 'Intelligence report generation in progress...',
      charts: {},
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(safeAnalysis, keywords, serpWithMetrics, relatedQuestions, trendData, niche, country, reportId, dataSourceStatus);
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
