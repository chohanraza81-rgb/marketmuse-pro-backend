import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getKeywordData, RealKeywordData } from '../services/dataforseo';
import { getSerperResults } from '../services/serper';
import { getKeywordSuggestions } from '../services/serpapi';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

// Robust JSON extraction
const extractJSON = (raw: string): any => {
  let cleaned = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const fixed = cleaned
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']')
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      let completed = cleaned;
      let braceCount = (completed.match(/{/g) || []).length;
      let closeCount = (completed.match(/}/g) || []).length;
      while (closeCount < braceCount) {
        completed += '}';
        closeCount++;
      }
      let bracketCount = (completed.match(/\[/g) || []).length;
      let closeBracketCount = (completed.match(/\]/g) || []).length;
      while (closeBracketCount < bracketCount) {
        completed += ']';
        closeBracketCount++;
      }
      try {
        return JSON.parse(completed);
      } catch (e3) {
        console.error('❌ JSON extraction failed. Raw length:', raw.length);
        console.error('Last 500 chars:', cleaned.substring(cleaned.length - 500));
        throw new Error('AI response is not valid JSON');
      }
    }
  }
};

const PROMPT = `You are an elite SEO strategist at MusePRO Intelligence Division. You write like a senior consultant speaking directly to a client. Be specific, data-driven, and professional. Use the current year 2026 in any year-specific content.

CRITICAL WRITING INSTRUCTIONS:
- Write like a senior SEO veteran. Direct, bold, and full of insider wisdom.
- Vary sentence length. Mix short observations with detailed explanations.
- Use natural business language. No robotic transitions like "Furthermore", "Moreover", "Additionally".
- Use first-person plural: "We found...", "Our read on this...", "We'd prioritize..."
- Express genuine excitement about ranking opportunities and honest skepticism about overhyped keywords.
- Weave numbers directly into conversational sentences.
- Use hedging where it makes sense: "Could be...", "Looks like...", "Might signal..."
- Do not make specific statistical claims not supported by provided data. If you mention a percentage, derive it from the provided data.
- After each key insight, include the data source in parentheses.

You will be given REAL keyword data, REAL SERP results, and REAL related questions. Use these numbers, do not generate your own.

Return ONLY valid JSON with the following structure:

{
  "trend_assessment": "Seasonal" | "Evergreen",
  "trend_analysis": "2-3 sentences with actual numbers from the provided data",
  "key_insights": [
    "Insight with specific volume/KD numbers and source",
    "Insight with specific volume/KD numbers and source",
    "Insight with specific volume/KD numbers and source"
  ],
  "immediate_actions": [
    "Priority SEO action 1",
    "Priority SEO action 2",
    "Priority SEO action 3"
  ],
  "content_roadmap": [
    {
      "week": 1,
      "title": "string",
      "primary_keyword": "string (use a real keyword from provided list)",
      "secondary_keywords": ["string", "string"],
      "content_type": "Pillar|Listicle|How-to|Case Study",
      "word_count_target": 2000,
      "outline": ["string", "string", "string", "string", "string"],
      "expected_traffic": 100
    }
  ] (exactly 12 weeks),
  "link_acquisition": {
    "overview": "string",
    "target_sites": [
      {
        "site": "string",
        "da": 50,
        "type": "blog",
        "contact": "email",
        "pitch": "string"
      }
    ] (8 sites),
    "guest_post_topics": ["string", "string", "string", "string", "string"],
    "broken_link_opportunities": [
      {
        "site": "string",
        "dead_page": "string",
        "replacement": "string"
      }
    ] (3),
    "outreach_template": "string"
  },
  "onpage_checklist": ["string"] (15 items),
  "growth_accelerators": ["string"] (5 tips),
  "related_resources": [
    { "name": "string", "url": "string" }
  ] (8 resources)
}`;

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

function estimateDA(link: string): number {
  const domain = new URL(link).hostname.replace(/^www\./, '');
  const knownDA: Record<string, number> = {
    'google.com': 100, 'youtube.com': 100, 'linkedin.com': 98, 'medium.com': 94,
    'reddit.com': 91, 'quora.com': 93, 'wikipedia.org': 96, 'amazon.com': 96,
    'facebook.com': 96, 'twitter.com': 94, 'apple.com': 97, 'microsoft.com': 96,
    'github.com': 95, 'stackoverflow.com': 93, 'nytimes.com': 94, 'forbes.com': 92,
  };
  if (domain.endsWith('.edu') || domain.endsWith('.gov')) return 80;
  return knownDA[domain] || 35;
}

function estimateTraffic(position: number, volume: number): number {
  const ctrCurve = [0.30, 0.15, 0.10, 0.07, 0.05, 0.04, 0.03, 0.02];
  const ctr = ctrCurve[Math.min(position - 1, ctrCurve.length - 1)] || 0.01;
  return Math.round(volume * ctr);
}

function generateMarkdown(
  analysis: any,
  keywords: RealKeywordData[],
  serp: any[],
  relatedQuestions: string[],
  niche: string,
  country: string,
  reportId: string
): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  let m = '';

  m += `MusePRO\n`;
  m += `Real-Time Market Research\n`;
  m += `Intelligence Division\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `SEO RESEARCH REPORT\n\n`;
  m += `Prepared For: [Client Name]\n`;
  m += `Date: ${today}\n`;
  m += `Reference: ${reportId}\n`;
  m += `Classification: CONFIDENTIAL\n`;
  m += `──────────────────────────────────────────────────────────────\n\n`;

  m += `1. YOUR OPPORTUNITY AT A GLANCE\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `We analyzed the organic search landscape for "${niche}" in ${countryNames[country] || country}. The trend is ${analysis.trend_assessment || 'N/A'} with ${keywords.length} keyword opportunities identified.\n\n`;
  if (analysis.key_insights?.length) {
    m += `Key Insights:\n`;
    analysis.key_insights.forEach((f: string, i: number) => { m += `  ${i+1}. ${f}\n`; });
    m += `\n`;
  }
  if (analysis.immediate_actions?.length) {
    m += `What To Do First:\n`;
    analysis.immediate_actions.forEach((w: string, i: number) => { m += `  ${i+1}. ${w}\n`; });
    m += `\n`;
  }

  m += `2. WHAT THE DATA SHOWS\n`;
  m += `──────────────────────────────────────────────────────────────\n${analysis.trend_analysis || ''}\n`;
  m += `Source: DataForSEO Keyword Data\n\n`;

  m += `3. KEYWORDS WORTH TARGETING\n`;
  m += `──────────────────────────────────────────────────────────────\nSource: DataForSEO (Google Keyword Planner)\n\n`;
  m += `| # | Keyword | Volume | CPC | KD | Potential |\n`;
  m += `|---|---------|--------|-----|----|----------|\n`;
  keywords.forEach((k, i) => {
    const potential = k.kd < 30 ? 'Easy Win' : k.kd < 60 ? 'Moderate' : 'Long Game';
    m += `| ${i+1} | ${k.keyword} | ${k.volume.toLocaleString()} | $${k.cpc.toFixed(2)} | ${k.kd} | ${potential} |\n`;
  });
  m += `\n`;

  m += `4. WHO'S RANKING TODAY\n`;
  m += `──────────────────────────────────────────────────────────────\nSource: Serper API (Live Google SERP)\n\n`;
  serp.forEach((s, i) => {
    m += `Position #${s.position}: ${s.title}\n`;
    m += `  URL: ${s.link}\n`;
    m += `  Est. DA: ${s.da}\n`;
    m += `  Est. Traffic: ${s.traffic.toLocaleString()} visits/mo (based on keyword volume)\n`;
    m += `  Snippet: ${s.snippet?.substring(0, 120) || 'N/A'}\n\n`;
  });
  m += `\n`;

  if (relatedQuestions.length) {
    m += `5. PEOPLE ARE ASKING\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    relatedQuestions.forEach((q, i) => { m += `${i+1}. ${q}\n`; });
    m += `\n`;
  }

  m += `6. YOUR CONTENT GAME PLAN\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  analysis.content_roadmap?.forEach((c: any) => {
    m += `Week ${c.week}: ${c.title}\n`;
    m += `  Keyword: ${c.primary_keyword} | Type: ${c.content_type}\n`;
    m += `  Secondary: ${c.secondary_keywords?.join(', ')}\n`;
    m += `  Target Words: ${c.word_count_target}\n`;
    m += `  Outline: ${c.outline?.join(' | ')}\n`;
    m += `  Est. Traffic: ${c.expected_traffic?.toLocaleString()}/mo\n\n`;
  });

  const bs = analysis.link_acquisition;
  if (bs) {
    m += `7. AUTHORITY BUILDING\n`;
    m += `──────────────────────────────────────────────────────────────\n${bs.overview}\n\n`;
    if (bs.target_sites?.length) {
      m += `Target Sites:\n`;
      bs.target_sites.forEach((s: any, i: number) => {
        m += `  ${i+1}. ${s.site} (DA: ${s.da})\n     Type: ${s.type} | Contact: ${s.contact}\n     Pitch: ${s.pitch}\n\n`;
      });
    }
    if (bs.guest_post_topics?.length) {
      m += `Guest Post Topics:\n`;
      bs.guest_post_topics.forEach((t: string, i: number) => { m += `  ${i+1}. ${t}\n`; });
      m += `\n`;
    }
    if (bs.broken_link_opportunities?.length) {
      m += `Broken Link Opportunities:\n`;
      bs.broken_link_opportunities.forEach((b: any) => { m += `  - ${b.site}: ${b.dead_page} → ${b.replacement}\n`; });
      m += `\n`;
    }
    if (bs.outreach_template) {
      m += `Outreach Template:\n${bs.outreach_template}\n\n`;
    }
  }

  m += `8. ON-PAGE QUICK WINS\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  analysis.onpage_checklist?.forEach((item: string, i: number) => { m += `${i+1}. ${item}\n`; });
  m += `\n`;

  if (analysis.growth_accelerators?.length) {
    m += `9. GROWTH LEVERS\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    analysis.growth_accelerators.forEach((tip: string, i: number) => { m += `${i+1}. ${tip}\n`; });
    m += `\n`;
  }

  if (analysis.related_resources?.length) {
    m += `10. TOOLS & RESOURCES\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    analysis.related_resources.forEach((res: any, i: number) => { m += `${i+1}. ${res.name} – ${res.url}\n`; });
    m += `\n`;
  }

  // Corrected Methodology & Sources
  m += `METHODOLOGY & SOURCES\n`;
  m += `──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• Google Keyword Planner via DataForSEO (dataforseo.com)\n• Live Google SERP via Serper API (serper.dev)\n• People Also Ask via SerpApi (serpapi.com)\n• Analysis Engine: Gemini AI\n\nAll data points can be independently verified against their public sources.\n\n`;

  m += `DOCUMENT CONTROL\n`;
  m += `──────────────────────────────────────────────────────────────\nClassification:  Confidential\nDistribution:    Client Only\nVersion:         1.0\nPrepared By:     MusePRO Intelligence Division\n\n`;

  m += `DISCLAIMER\n`;
  m += `──────────────────────────────────────────────────────────────\nThis document contains proprietary research conducted by MusePRO. The information herein is intended solely for the designated recipient. Unauthorized distribution, copying, or disclosure is strictly prohibited.\n\nWhile every effort has been made to ensure accuracy, market conditions change rapidly. Verify critical data points before making business decisions.\n\n`;

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

    // 1. Fetch real keywords
    const keywords = await getKeywordData(niche, country, 50);

    // ✅ CRITICAL: Throw if keyword data is empty
    if (!keywords || keywords.length === 0) {
      throw new Error('No keyword data received from DataForSEO. Please check your DataForSEO API credentials, credits, or location code.');
    }

    // 2. Fetch real SERP results
    const serperData = await getSerperResults(niche, country);

    // 3. Fetch related questions (People Also Ask) from SerpApi
    const relatedQuestions = await getKeywordSuggestions(niche, country).catch(() => []);

    // 4. Prepare SERP data with DA and traffic estimates
    const serpWithMetrics = serperData.organic.map((r) => ({
      ...r,
      da: estimateDA(r.link),
      traffic: estimateTraffic(r.position, keywords[0]?.volume || 0),
    }));

    // 5. AI prompt with real data
    const aiContext = {
      niche,
      country,
      keywords,
      serp: serpWithMetrics,
      relatedQuestions,
    };

    const ai = await runGroqWithRetry(PROMPT, JSON.stringify(aiContext));
    const analysis = extractJSON(ai);

    // 6. Generate markdown
    const report = await Report.create({
      type: 'seo',
      niche,
      country,
      value: '$99',
      data: {
        ...analysis,
        keywords,
        serp: serpWithMetrics,
        relatedQuestions,
      },
      markdown: 'Intelligence report generation in progress...',
      charts: {},
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, keywords, serpWithMetrics, relatedQuestions, niche, country, reportId);
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
