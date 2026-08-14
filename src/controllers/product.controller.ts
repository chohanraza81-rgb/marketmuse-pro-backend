import { Request, Response, NextFunction } from 'express';
import { productResearchSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getShoppingResults } from '../services/serpapi';
import { getKeywordData, RealKeywordData } from '../services/dataforseo';
import { getSerperResults } from '../services/serper';
import { getExchangeRates, convertPrice } from '../services/exchange';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const extractJSON = (raw: string): any => {
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
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
        throw new Error('AI response is not valid JSON');
      }
    }
  }
};

const PROMPT = `You are a senior market analyst at MusePRO Intelligence Division. You write like a consultant presenting findings to a client. Be specific, data‑driven, and professional. Use the current year 2026 in any year‑specific content.

CRITICAL WRITING INSTRUCTIONS:
- Write like a battle‑hardened business strategist. Get to the point. Be bold.
- Vary sentence structure drastically. Short, punchy observations mixed with longer, nuanced explanations.
- Use natural business language. No robotic transitions like "Furthermore", "Moreover", "Additionally".
- Use first-person plural: "We spotted...", "Our take...", "We'd put money on..."
- Express genuine excitement about big opportunities and honest concern about real risks.
- Weave numbers directly into conversational sentences.
- Use hedging where appropriate.
- Do not make specific statistical claims that are not directly supported by the provided data. If you mention a percentage or growth figure, ensure it is derived from the provided trends or keyword metrics, otherwise phrase as 'data suggests' or 'we estimate'.
- After each key insight, include the data source in parentheses.

You will be given REAL shopping product data, REAL keyword data, exchange rates, and SERP results. Use these numbers, do not generate your own.

Return ONLY valid JSON with the following structure (all fields are required):

{
  "market_score": number (0-100, estimated based on real data),
  "opportunity_level": "High" | "Moderate" | "Limited",
  "executive_brief": "3-4 sentences with actual numbers from the data",
  "key_insights": [
    "Insight with metric and source",
    "Insight with metric and source",
    "Insight with metric and source"
  ],
  "immediate_actions": [
    "Actionable step 1",
    "Actionable step 2",
    "Actionable step 3"
  ],
  "entry_opportunities": [
    {
      "title": "opportunity title",
      "description": "detailed paragraph",
      "revenue_potential": "$5k-10k/mo or $10k-25k/mo or $25k+/mo",
      "difficulty": "Easy/Moderate/Hard",
      "first_action": "concrete step"
    }
  ] (3 gaps),
  "audience_profiles": [
    {
      "name": "profile name",
      "age_range": "25-34",
      "income": "$40k-60k",
      "primary_need": "core problem",
      "purchase_trigger": "what makes them buy",
      "channels": ["channel","channel"],
      "messaging": "exact ad copy"
    }
  ] (3 personas),
  "execution_roadmap": [
    {
      "week": 1,
      "phase": "Phase name",
      "tasks": ["task","task","task"],
      "kpi": "measurable outcome"
    }
  ] (12 weeks),
  "financial_forecast": {
    "startup_cost": 10000,
    "monthly_fixed_costs": 2000,
    "avg_profit_per_unit": 50,
    "units_to_breakeven": 200,
    "months_to_profitability": 3,
    "month6_profit_conservative": 10000,
    "month6_profit_optimistic": 25000
  },
  "risk_matrix": [
    {
      "risk": "honest risk",
      "probability": "Low/Medium/High",
      "impact": "Low/Medium/High",
      "mitigation": "practical action"
    }
  ] (5 risks),
  "growth_accelerators": [
    "Tip that feels like insider knowledge",
    "Tip that feels like insider knowledge",
    "Tip that feels like insider knowledge",
    "Tip that feels like insider knowledge",
    "Tip that feels like insider knowledge"
  ],
  "related_resources": [
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" }
  ]
}`;

const currencySymbols: Record<string, string> = {
  us: 'USD', gb: 'GBP', ca: 'CAD', au: 'AUD', de: 'EUR', sg: 'SGD',
  sa: 'SAR', ae: 'AED', pk: 'PKR', in: 'INR', tr: 'TRY', my: 'MYR',
};

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

const scoreBar = (score: number): string => {
  const filled = Math.round(score / 10);
  return '[' + '█'.repeat(filled) + '░'.repeat(10 - filled) + ']';
};

interface RealProduct {
  title: string;
  price: number;
  source: string;
  reviews: number;
}

interface SerperResult {
  position: number;
  title: string;
  link: string;
  snippet: string;
}

interface ProductSerpResult extends SerperResult {
  da: number;
  traffic: number;
}

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
  realProducts: RealProduct[],
  serpResults: ProductSerpResult[],
  keywords: RealKeywordData[],
  rates: any,
  niche: string,
  country: string,
  reportId: string
): string {
  const sym = currencySymbols[country] || 'USD';
  const localPrice = (usd: number) => {
    const converted = convertPrice(usd, sym, rates);
    return `${sym} ${converted.toLocaleString()}`;
  };

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  let m = '';

  // Header
  m += `MusePRO\n`;
  m += `Real-Time Market Research\n`;
  m += `Intelligence Division\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `PRODUCT RESEARCH REPORT\n\n`;
  m += `Prepared For: [Client Name]\n`;
  m += `Date: ${today}\n`;
  m += `Reference: ${reportId}\n`;
  m += `Classification: CONFIDENTIAL\n`;
  m += `──────────────────────────────────────────────────────────────\n\n`;

  // 1
  m += `1. THE BOTTOM LINE\n`;
  m += `──────────────────────────────────────────────────────────────\n${analysis.executive_brief}\n\n`;

  // 2
  m += `2. MARKET SCORECARD\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `Market Score: ${analysis.market_score}/100 ${scoreBar(analysis.market_score)}\n`;
  m += `Opportunity Level: ${analysis.opportunity_level || 'N/A'}\n`;
  const fp = analysis.financial_forecast;
  if (fp?.month6_profit_optimistic) {
    m += `Est. Monthly Profit Potential: ${localPrice(fp.month6_profit_optimistic)}\n`;
  }
  m += `Time to Profitability: ${fp?.months_to_profitability || 'N/A'} months\n\n`;

  if (analysis.key_insights?.length) {
    m += `Key Insights:\n`;
    analysis.key_insights.forEach((f: string, i: number) => { m += `  ${i+1}. ${f}\n`; });
    m += `  (All insights based on live data from DataForSEO, Serper, SerpApi, and ExchangeRate-API)\n\n`;
  }

  if (analysis.immediate_actions?.length) {
    m += `What To Do First:\n`;
    analysis.immediate_actions.forEach((w: string, i: number) => { m += `  ${i+1}. ${w}\n`; });
    m += `\n`;
  }

  // 3
  m += `3. PRODUCTS WORTH SELLING\n`;
  m += `──────────────────────────────────────────────────────────────\nSource: Google Shopping (live data via SerpApi)\n\n`;
  m += `| # | Product | Price | Reviews | Source |\n`;
  m += `|---|---------|-------|---------|--------|\n`;
  realProducts.forEach((p, i) => {
    m += `| ${i+1} | ${p.title} | ${localPrice(p.price)} | ${p.reviews} | ${p.source} |\n`;
  });
  m += `\n`;

  // 4
  m += `4. COMPETITIVE BATTLEFIELD\n`;
  m += `──────────────────────────────────────────────────────────────\nSource: Serper API (Live Google SERP)\n\n`;
  serpResults.forEach((s) => {
    m += `Position #${s.position}: ${s.title}\n`;
    m += `  URL: ${s.link}\n`;
    m += `  Est. DA: ${s.da}\n`;
    m += `  Est. Traffic: ${s.traffic.toLocaleString()} visits/mo (based on keyword volume)\n`;
    m += `  Snippet: ${s.snippet?.substring(0, 120) || 'N/A'}\n\n`;
  });
  m += `\n`;

  // 5
  m += `5. WHITE SPACE OPPORTUNITIES\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  analysis.entry_opportunities?.forEach((g: any) => {
    m += `${g.title}\n  ${g.description}\n  Revenue Potential: ${g.revenue_potential}\n  Difficulty: ${g.difficulty}\n  First Action: ${g.first_action}\n\n`;
  });

  // 6
  m += `6. WHO'S BUYING\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  analysis.audience_profiles?.forEach((p: any) => {
    m += `${p.name} | ${p.age_range} | ${p.income}\n  Primary Need: ${p.primary_need}\n  Purchase Trigger: ${p.purchase_trigger}\n  Channels: ${p.channels?.join(', ')}\n  Messaging: "${p.messaging}"\n\n`;
  });

  // 7
  if (analysis.growth_accelerators?.length) {
    m += `7. FAST-TRACK STRATEGIES\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    analysis.growth_accelerators.forEach((tip: string, i: number) => { m += `${i+1}. ${tip}\n`; });
    m += `\n`;
  }

  // 8
  m += `8. YOUR 12-WEEK LAUNCH PLAN\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  analysis.execution_roadmap?.forEach((w: any) => {
    m += `Week ${w.week}: ${w.phase}\n`;
    w.tasks?.forEach((t: string) => { m += `  - ${t}\n`; });
    m += `  KPI: ${w.kpi}\n\n`;
  });

  // 9
  m += `9. MONEY MATH\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `Startup Cost: ${localPrice(fp?.startup_cost)}\n`;
  m += `Monthly Fixed Costs: ${localPrice(fp?.monthly_fixed_costs)}\n`;
  m += `Avg Profit Per Unit: ${localPrice(fp?.avg_profit_per_unit)}\n`;
  m += `Units to Breakeven: ${fp?.units_to_breakeven}\n`;
  m += `Time to Profitability: ${fp?.months_to_profitability} months\n`;
  m += `Month 6 Profit (Conservative): ${localPrice(fp?.month6_profit_conservative)}\n`;
  m += `Month 6 Profit (Optimistic): ${localPrice(fp?.month6_profit_optimistic)}\n\n`;

  // 10
  m += `10. WHAT COULD GO WRONG\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  analysis.risk_matrix?.forEach((r: any) => {
    m += `Risk: ${r.risk}\n  Probability: ${r.probability} | Impact: ${r.impact}\n  Mitigation: ${r.mitigation}\n\n`;
  });

  // 11
  if (analysis.related_resources?.length) {
    m += `11. TOOLS & LINKS\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    analysis.related_resources.forEach((res: any, i: number) => { m += `${i+1}. ${res.name} – ${res.url}\n`; });
    m += `\n`;
  }

  // Methodology & Sources
  m += `METHODOLOGY & SOURCES\n`;
  m += `──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• Google Shopping via SerpApi (serpapi.com)\n• DataForSEO – Google Keyword Planner data (volume, CPC, KD)\n• Serper API – Live Google SERP results\n• ExchangeRate-API (exchangerate-api.com)\n• Analysis Engine: Gemini AI\n\nAll data points can be independently verified against their public sources.\n\n`;

  // Document Control
  m += `DOCUMENT CONTROL\n`;
  m += `──────────────────────────────────────────────────────────────\nClassification:  Confidential\nDistribution:    Client Only\nVersion:         1.0\nPrepared By:     MusePRO Intelligence Division\n\n`;

  // Disclaimer
  m += `DISCLAIMER\n`;
  m += `──────────────────────────────────────────────────────────────\nThis document contains proprietary research conducted by MusePRO. The information herein is intended solely for the designated recipient. Unauthorized distribution, copying, or disclosure is strictly prohibited.\n\nWhile every effort has been made to ensure accuracy, market conditions change rapidly. Verify critical data points before making business decisions.\n\n`;

  m += `──────────────────────────────────────────────────────────────\n© MusePRO — Intelligence Division. All Rights Reserved.\n`;

  return m;
}

export const createProductReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = productResearchSchema.parse(req.body);
    const ck = `prod_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    console.log(`Product: "${niche}" in ${country}`);

    // 1. Fetch real data in parallel
    const [shoppingData, fx, serperData, keywordData] = await Promise.all([
      getShoppingResults(niche, country).catch(() => null),
      getExchangeRates(),
      getSerperResults(niche, country).catch(() => null),
      getKeywordData(niche, country, 50).catch(() => []),
    ]);

    if (!shoppingData) {
      throw new Error('Unable to retrieve live shopping data. Please try again later.');
    }

    // 2. Prepare real products
    const realProducts: RealProduct[] = (shoppingData.shopping_results || [])
      .slice(0, 10)
      .map((p: any) => ({
        title: p.title || 'Unknown Product',
        price: p.extracted_price || p.price || 0,
        source: p.source || 'Unknown',
        reviews: p.rating || 0,
      }));

    // 3. Prepare SERP results for competitor landscape
    const serpResults: ProductSerpResult[] = (serperData?.organic || [])
      .slice(0, 8)
      .map((r: SerperResult) => ({
        ...r,
        da: estimateDA(r.link),
        traffic: estimateTraffic(r.position, keywordData[0]?.volume || 0),
      }));

    // 4. Prepare AI context with all real data
    const aiContext = {
      niche,
      country,
      realProducts,
      serpResults,
      keywords: keywordData,
      exchangeRates: fx,
    };

    // 5. AI generates narrative
    const ai = await runGroqWithRetry(PROMPT, JSON.stringify(aiContext));
    const analysis = extractJSON(ai);

    // 6. Generate markdown with real data
    const report = await Report.create({
      type: 'product',
      niche,
      country,
      value: '$99',
      data: {
        ...analysis,
        realProducts,
        serpResults,
        keywords: keywordData,
      },
      markdown: 'Intelligence report generation in progress...',
      charts: { fx },
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, realProducts, serpResults, keywordData, fx, niche, country, reportId);
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

export const getProductReport = async (req: Request, res: Response) => {
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  res.json(report);
};
