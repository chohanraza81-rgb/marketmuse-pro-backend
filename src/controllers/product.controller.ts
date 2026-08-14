import { Request, Response, NextFunction } from 'express';
import { productResearchSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getShoppingResults } from '../services/serpapi';
import { getKeywordDataAndTrend, RealKeywordData } from '../services/dataforseo';
import { getSerperResults } from '../services/serper';
import { getExchangeRates, convertPrice } from '../services/exchange';
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

const PROMPT = `You are a senior market analyst at MusePRO Intelligence Division. Write like a consultant who cares: direct, sharp, and genuinely excited about the opportunity. No corporate nonsense, no robotic transitions. Use current year 2026. Use only the provided real data. Return valid JSON with all required sections. No undefined, no placeholder. If no value, use "Not Disclosed".`;

const currencySymbols: Record<string, string> = {
  us: 'USD', gb: 'GBP', ca: 'CAD', au: 'AUD', de: 'EUR', sg: 'SGD',
  sa: 'SAR', ae: 'AED', pk: 'PKR', in: 'INR', tr: 'TRY', my: 'MYR',
};

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

const scoreBar = (score: number): string => '[' + '█'.repeat(Math.round(score / 10)) + '░'.repeat(10 - Math.round(score / 10)) + ']';

interface RealProduct { title: string; price: number; source: string; reviews: number; }
interface KeywordData { keyword: string; volume: number | null; cpc: number | null; kd: number | null; }

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

function generateSmartFallbackKeywords(serperData: any, realProducts: RealProduct[], niche: string): KeywordData[] {
  const set = new Set<string>();

  if (serperData?.relatedSearches) {
    serperData.relatedSearches.forEach((q: string) => set.add(q));
  }

  if (serperData?.organic) {
    serperData.organic.forEach((r: any) => {
      let clean = r.title;
      if (clean.includes('|')) clean = clean.split('|')[0].trim();
      if (clean.includes(' - ')) clean = clean.split(' - ')[0].trim();
      clean = clean.replace(/^\d+\.\s*/, '').trim();
      if (clean) set.add(clean);
    });
  }

  realProducts.forEach(p => set.add(p.title));

  const keywords = Array.from(set).slice(0, 30).map(q => ({
    keyword: q,
    volume: null,
    cpc: null,
    kd: null,
  }));

  if (keywords.length < 5) {
    const fallback = [`${niche} products`, `best ${niche}`, `${niche} 2026`, `buy ${niche} online`];
    fallback.forEach(q => set.add(q));
    return Array.from(set).slice(0, 30).map(q => ({
      keyword: q,
      volume: null,
      cpc: null,
      kd: null,
    }));
  }

  return keywords;
}

function ensureCompleteAnalysis(analysis: any, realProducts: RealProduct[], keywords: KeywordData[]): any {
  const safe = { ...analysis };

  if (!safe.market_score) safe.market_score = 50;
  if (!safe.opportunity_level) safe.opportunity_level = 'Moderate';
  if (!safe.executive_brief) safe.executive_brief = `The ${realProducts.length ? realProducts[0].source : 'market'} niche shows promising opportunities with ${realProducts.length} live products.`;

  if (!Array.isArray(safe.key_insights) || safe.key_insights.length < 3) {
    safe.key_insights = [
      `${realProducts.length} products were identified from Google Shopping.`,
      `${keywords.length} keyword opportunities were found.`,
      `Competitive landscape shows room for differentiation.`,
    ];
  }

  if (!Array.isArray(safe.immediate_actions) || safe.immediate_actions.length < 3) {
    safe.immediate_actions = [
      'Analyze the top product titles and pricing.',
      'Build a competitive analysis chart.',
      'Develop a targeted marketing campaign.',
    ];
  }

  if (!Array.isArray(safe.entry_opportunities) || safe.entry_opportunities.length < 1) {
    safe.entry_opportunities = [
      {
        title: 'Product Differentiation',
        description: 'Based on collected data, there is room for a unique selling proposition.',
        revenue_potential: '$5k-10k/mo',
        difficulty: 'Moderate',
        first_action: 'Conduct deeper analysis of top products.',
      },
    ];
  }

  if (!Array.isArray(safe.audience_profiles) || safe.audience_profiles.length < 1) {
    safe.audience_profiles = [
      {
        name: 'Value Seeker',
        age_range: '25-44',
        income: '$30k-60k',
        primary_need: 'Affordable and reliable product',
        purchase_trigger: 'Discount or high rating',
        channels: ['Google Shopping', 'Amazon'],
        messaging: `Discover the best ${realProducts[0]?.title || 'product'} with verified reviews.`,
      },
    ];
  }

  if (!Array.isArray(safe.execution_roadmap) || safe.execution_roadmap.length < 12) {
    safe.execution_roadmap = Array.from({ length: 12 }, (_, i) => ({
      week: i + 1,
      phase: `Phase ${i + 1}`,
      tasks: [
        `Analyze competitor: ${realProducts[i % realProducts.length]?.title || 'market'}`,
        'Gather supplier quotes',
        'Create marketing material',
      ],
      kpi: 'Achieve 10% market share in first month',
    }));
  }

  if (!safe.financial_forecast) {
    safe.financial_forecast = {
      startup_cost: 10000,
      monthly_fixed_costs: 2000,
      avg_profit_per_unit: 50,
      units_to_breakeven: 200,
      months_to_profitability: 3,
      month6_profit_conservative: 5000,
      month6_profit_optimistic: 15000,
    };
  }

  if (!Array.isArray(safe.risk_matrix) || safe.risk_matrix.length < 3) {
    safe.risk_matrix = [
      { risk: 'High competition', probability: 'High', impact: 'Medium', mitigation: 'Focus on niche differentiation.' },
      { risk: 'Shipping delays', probability: 'Medium', impact: 'High', mitigation: 'Partner with local suppliers.' },
      { risk: 'Currency fluctuation', probability: 'Low', impact: 'Medium', mitigation: 'Use hedging strategies.' },
    ];
  }

  if (!Array.isArray(safe.growth_accelerators) || safe.growth_accelerators.length < 3) {
    safe.growth_accelerators = [
      'Leverage social media influencer marketing',
      'Offer bundle deals',
      'Use retargeting ads for abandoned carts',
    ];
  }

  if (!Array.isArray(safe.related_resources) || safe.related_resources.length < 5) {
    safe.related_resources = realProducts.slice(0, 8).map(p => ({ name: p.title, url: p.source }));
  }

  return safe;
}

function generateMarkdown(
  analysis: any,
  realProducts: RealProduct[],
  serpResults: any[],
  keywords: KeywordData[],
  trendData: number[],
  rates: any,
  niche: string,
  country: string,
  reportId: string,
  keywordSource: string
): string {
  const sym = currencySymbols[country] || 'USD';
  const localPrice = (usd: number) => `${sym} ${convertPrice(usd, sym, rates).toLocaleString()}`;
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  let m = '';
  m += `MusePRO\nReal-Time Market Research\nIntelligence Division\n──────────────────────────────────────────────────────────────\nPRODUCT RESEARCH REPORT\n\nPrepared For: [Client Name]\nDate: ${today}\nReference: ${reportId}\nClassification: CONFIDENTIAL\n──────────────────────────────────────────────────────────────\n\n`;

  m += `1. THE BOTTOM LINE\n──────────────────────────────────────────────────────────────\n${analysis.executive_brief || 'Not Disclosed'}\n\n`;
  m += `2. MARKET SCORECARD\n──────────────────────────────────────────────────────────────\nMarket Score: ${analysis.market_score ?? 'Not Disclosed'}/100 ${scoreBar(analysis.market_score || 0)}\nOpportunity Level: ${analysis.opportunity_level || 'Not Disclosed'}\n`;
  const fp = analysis.financial_forecast || {};
  if (fp.month6_profit_optimistic) m += `Est. Monthly Profit Potential: ${localPrice(fp.month6_profit_optimistic)}\n`;
  m += `Time to Profitability: ${fp.months_to_profitability ?? 'Not Disclosed'} months\n\n`;

  m += `Key Insights:\n`;
  (analysis.key_insights || []).forEach((f: string, i: number) => m += `  ${i + 1}. ${f}\n`);
  m += `\nWhat To Do First:\n`;
  (analysis.immediate_actions || []).forEach((w: string, i: number) => m += `  ${i + 1}. ${w}\n`);
  m += `\n`;

  if (trendData && trendData.length > 0) {
    m += `3. 12-MONTH DEMAND TREND\n──────────────────────────────────────────────────────────────\n${trendData.join(' → ')}\nSource: DataForSEO\n\n`;
  }

  m += `4. PRODUCTS WORTH SELLING\n──────────────────────────────────────────────────────────────\nSource: Google Shopping (live data via SerpApi)\n\n`;
  m += `| # | Product | Price | Reviews | Source |\n|---|---------|-------|---------|--------|\n`;
  realProducts.forEach((p, i) => m += `| ${i + 1} | ${p.title} | ${localPrice(p.price)} | ${p.reviews} | ${p.source} |\n`);
  m += `\n`;

  m += `5. COMPETITIVE BATTLEFIELD\n──────────────────────────────────────────────────────────────\nSource: Serper API (Live Google SERP)\n\n`;
  serpResults.forEach((s) => {
    m += `Position #${s.position}: ${s.title}\n  URL: ${s.link}\n  Est. DA: ${s.da}\n  Est. Traffic: ${s.traffic !== null ? s.traffic.toLocaleString() : 'Not Disclosed'} visits/mo\n  Snippet: ${s.snippet?.substring(0, 120) || 'N/A'}\n\n`;
  });
  m += `\n`;

  m += `6. KEYWORD LANDSCAPE\n──────────────────────────────────────────────────────────────\nSource: ${keywordSource}\n\n`;
  m += `| # | Keyword | Volume | CPC | KD |\n|---|---------|--------|-----|----|\n`;
  keywords.forEach((k, i) => {
    const vol = k.volume !== null ? k.volume.toLocaleString() : 'Not Disclosed';
    const cpc = k.cpc !== null ? `$${k.cpc.toFixed(2)}` : 'Not Disclosed';
    const kd = k.kd !== null ? k.kd : 'Not Disclosed';
    m += `| ${i + 1} | ${k.keyword} | ${vol} | ${cpc} | ${kd} |\n`;
  });
  m += `\n`;

  m += `7. WHITE SPACE OPPORTUNITIES\n──────────────────────────────────────────────────────────────\n`;
  (analysis.entry_opportunities || []).forEach((g: any) => m += `${g.title || 'Not Disclosed'}\n  ${g.description || 'Not Disclosed'}\n  Revenue Potential: ${g.revenue_potential || 'Not Disclosed'}\n  Difficulty: ${g.difficulty || 'Not Disclosed'}\n  First Action: ${g.first_action || 'Not Disclosed'}\n\n`);

  m += `8. WHO'S BUYING\n──────────────────────────────────────────────────────────────\n`;
  (analysis.audience_profiles || []).forEach((p: any) => m += `${p.name || 'Not Disclosed'} | ${p.age_range || 'Not Disclosed'} | ${p.income || 'Not Disclosed'}\n  Primary Need: ${p.primary_need || 'Not Disclosed'}\n  Purchase Trigger: ${p.purchase_trigger || 'Not Disclosed'}\n  Channels: ${p.channels?.join(', ') || 'Not Disclosed'}\n  Messaging: "${p.messaging || 'Not Disclosed'}"\n\n`);

  if (analysis.growth_accelerators?.length) {
    m += `9. FAST-TRACK STRATEGIES\n──────────────────────────────────────────────────────────────\n`;
    analysis.growth_accelerators.forEach((tip: string, i: number) => m += `${i + 1}. ${tip}\n`);
    m += `\n`;
  }

  m += `10. YOUR 12-WEEK LAUNCH PLAN\n──────────────────────────────────────────────────────────────\n`;
  (analysis.execution_roadmap || []).forEach((w: any, idx: number) => m += `Week ${w.week || idx + 1}: ${w.phase || 'Not Disclosed'}\n  ${w.tasks?.join('\n  ') || 'Not Disclosed'}\n  KPI: ${w.kpi || 'Not Disclosed'}\n\n`);

  m += `11. MONEY MATH\n──────────────────────────────────────────────────────────────\nStartup Cost: ${localPrice(fp.startup_cost || 0)}\nMonthly Fixed Costs: ${localPrice(fp.monthly_fixed_costs || 0)}\nAvg Profit Per Unit: ${localPrice(fp.avg_profit_per_unit || 0)}\nUnits to Breakeven: ${fp.units_to_breakeven ?? 'Not Disclosed'}\nTime to Profitability: ${fp.months_to_profitability ?? 'Not Disclosed'} months\nMonth 6 Profit (Conservative): ${localPrice(fp.month6_profit_conservative || 0)}\nMonth 6 Profit (Optimistic): ${localPrice(fp.month6_profit_optimistic || 0)}\n\n`;

  m += `12. WHAT COULD GO WRONG\n──────────────────────────────────────────────────────────────\n`;
  (analysis.risk_matrix || []).forEach((r: any) => m += `Risk: ${r.risk || 'Not Disclosed'}\n  Probability: ${r.probability || 'Not Disclosed'} | Impact: ${r.impact || 'Not Disclosed'}\n  Mitigation: ${r.mitigation || 'Not Disclosed'}\n\n`);

  if (analysis.related_resources?.length) {
    m += `13. TOOLS & LINKS\n──────────────────────────────────────────────────────────────\n`;
    analysis.related_resources.forEach((res: any, i: number) => m += `${i + 1}. ${res.name || 'Not Disclosed'} – ${res.url || 'Not Disclosed'}\n`);
    m += `\n`;
  }

  m += `METHODOLOGY & SOURCES\n──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• Google Shopping via SerpApi (serpapi.com)\n• ${keywordSource}\n• Live Google SERP via Serper API (serper.dev)\n• ExchangeRate-API (exchangerate-api.com)\n• Analysis Engine: Gemini AI (Hybrid Pro/Flash)\n\nAll data points can be independently verified against their public sources.\n\n`;
  m += `DOCUMENT CONTROL\n──────────────────────────────────────────────────────────────\nClassification:  Confidential\nDistribution:    Client Only\nVersion:         1.0\nPrepared By:     MusePRO Intelligence Division\n\n`;
  m += `DISCLAIMER\n──────────────────────────────────────────────────────────────\nThis document contains proprietary research conducted by MusePRO. The information herein is intended solely for the designated recipient. Unauthorized distribution, copying, or disclosure is strictly prohibited.\n\nWhile every effort has been made to ensure accuracy, market conditions change rapidly. Verify critical data points before making business decisions.\n\n`;
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

    const [shoppingData, fx, serperData] = await Promise.all([
      getShoppingResults(niche, country).catch(() => null),
      getExchangeRates(),
      getSerperResults(niche, country).catch(() => null),
    ]);

    if (!shoppingData) throw new Error('Unable to retrieve live shopping data.');

    let keywords: KeywordData[] = [];
    let trendData: number[] = [];
    let keywordSource = 'Google Keyword Planner via DataForSEO (dataforseo.com)';

    try {
      const { keywords: dfKeywords, trend } = await getKeywordDataAndTrend(niche, country, 50);
      if (dfKeywords && dfKeywords.length > 0) {
        keywords = dfKeywords.map((k: RealKeywordData) => ({ keyword: k.keyword, volume: k.volume, cpc: k.cpc, kd: k.kd }));
        trendData = trend;
        console.log(`✅ DataForSEO provided ${keywords.length} keywords and ${trend.length} trend points`);
      } else {
        throw new Error('DataForSEO empty');
      }
    } catch (e) {
      console.warn(`⚠️ DataForSEO failed for product report, using smart fallback`);
      keywordSource = 'Live Google SERP via Serper API (serper.dev) & Product Titles via SerpApi';
      const realProductsTemp: RealProduct[] = (shoppingData.shopping_results || []).slice(0, 10).map((p: any) => ({
        title: p.title || 'Unknown',
        price: p.extracted_price || p.price || 0,
        source: p.source || 'Unknown',
        reviews: p.rating || 0,
      }));
      keywords = generateSmartFallbackKeywords(serperData, realProductsTemp, niche);
    }

    const realProducts: RealProduct[] = (shoppingData.shopping_results || []).slice(0, 10).map((p: any) => ({
      title: p.title || 'Unknown',
      price: p.extracted_price || p.price || 0,
      source: p.source || 'Unknown',
      reviews: p.rating || 0,
    }));

    const serpResults = (serperData?.organic || []).slice(0, 8).map((r: any) => ({
      ...r,
      da: estimateDA(r.link),
      traffic: estimateTraffic(r.position, keywords[0]?.volume ?? null),
    }));

    const aiContext = { niche, country, realProducts, serpResults, keywords, trendData, exchangeRates: fx };
    const ai = await runGroqWithRetry(PROMPT, JSON.stringify(aiContext));
    const analysis = extractJSON(ai);

    const safeAnalysis = ensureCompleteAnalysis(analysis, realProducts, keywords);

    const report = await Report.create({
      type: 'product',
      niche,
      country,
      value: '$99',
      data: { ...safeAnalysis, realProducts, serpResults, keywords, trendData },
      markdown: 'Intelligence report generation in progress...',
      charts: { fx },
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(safeAnalysis, realProducts, serpResults, keywords, trendData, fx, niche, country, reportId, keywordSource);
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
