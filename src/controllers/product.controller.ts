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
  if (start !== -1 && end !== -1 && end > start) cleaned = cleaned.substring(start, end + 1);
  try { return JSON.parse(cleaned); } catch (err) {
    const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    try { return JSON.parse(fixed); } catch (e2) {
      let completed = cleaned;
      let braceCount = (completed.match(/{/g) || []).length;
      let closeCount = (completed.match(/}/g) || []).length;
      while (closeCount < braceCount) { completed += '}'; closeCount++; }
      let bracketCount = (completed.match(/\[/g) || []).length;
      let closeBracketCount = (completed.match(/\]/g) || []).length;
      while (closeBracketCount < bracketCount) { completed += ']'; closeBracketCount++; }
      try { return JSON.parse(completed); } catch (e3) { throw new Error('AI response is not valid JSON'); }
    }
  }
};

const PROMPT = `You are a senior market analyst at MusePRO Intelligence Division. Write like a consultant presenting findings to a client. Be specific, data‑driven, and professional. Use the current year 2026.

CRITICAL WRITING INSTRUCTIONS:
- Write like a battle‑hardened business strategist. Get to the point. Be bold.
- Vary sentence structure. Use natural business language.
- Use first-person plural: "We spotted...", "Our take...", "We'd put money on..."
- Express genuine excitement about big opportunities and honest concern about real risks.
- Weave numbers directly into conversational sentences.
- Use hedging where appropriate.
- Do not make specific statistical claims not supported by provided data.
- After each key insight, include the data source in parentheses.

You will be given REAL shopping product data, REAL keyword data, exchange rates, and SERP results. Use these numbers, do not generate your own.

Return ONLY valid JSON with all required sections.`;

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
interface SerperResult { position: number; title: string; link: string; snippet: string; }
interface ProductSerpResult extends SerperResult { da: number; traffic: number | null; }
interface FlexibleKeyword { keyword: string; volume: number | null; cpc: number | null; kd: number | null; }

function estimateDA(link: string): number {
  const domain = new URL(link).hostname.replace(/^www\./, '');
  const known: Record<string, number> = { 'google.com':100,'youtube.com':100,'linkedin.com':98,'medium.com':94,'reddit.com':91,'quora.com':93,'wikipedia.org':96,'amazon.com':96,'facebook.com':96,'twitter.com':94,'apple.com':97,'microsoft.com':96,'github.com':95,'stackoverflow.com':93 };
  return domain.endsWith('.edu') || domain.endsWith('.gov') ? 80 : known[domain] || 35;
}

function estimateTraffic(position: number, volume: number | null): number | null {
  if (!volume || volume <= 0) return null;
  const ctr = [0.30,0.15,0.10,0.07,0.05,0.04,0.03,0.02][Math.min(position-1,7)] || 0.01;
  return Math.round(volume * ctr);
}

function generateMarkdown(
  analysis: any,
  realProducts: RealProduct[],
  serpResults: ProductSerpResult[],
  keywords: FlexibleKeyword[],
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

  m += `1. THE BOTTOM LINE\n──────────────────────────────────────────────────────────────\n${analysis.executive_brief}\n\n`;
  m += `2. MARKET SCORECARD\n──────────────────────────────────────────────────────────────\nMarket Score: ${analysis.market_score}/100 ${scoreBar(analysis.market_score)}\nOpportunity Level: ${analysis.opportunity_level || 'N/A'}\n`;
  const fp = analysis.financial_forecast;
  if (fp?.month6_profit_optimistic) m += `Est. Monthly Profit Potential: ${localPrice(fp.month6_profit_optimistic)}\n`;
  m += `Time to Profitability: ${fp?.months_to_profitability || 'N/A'} months\n\n`;

  if (analysis.key_insights?.length) { m += `Key Insights:\n`; analysis.key_insights.forEach((f:string,i:number)=>m+=`  ${i+1}. ${f}\n`); m += `\n`; }
  if (analysis.immediate_actions?.length) { m += `What To Do First:\n`; analysis.immediate_actions.forEach((w:string,i:number)=>m+=`  ${i+1}. ${w}\n`); m += `\n`; }

  m += `3. PRODUCTS WORTH SELLING\n──────────────────────────────────────────────────────────────\nSource: Google Shopping (live data via SerpApi)\n\n`;
  m += `| # | Product | Price | Reviews | Source |\n|---|---------|-------|---------|--------|\n`;
  realProducts.forEach((p,i)=>m+=`| ${i+1} | ${p.title} | ${localPrice(p.price)} | ${p.reviews} | ${p.source} |\n`);
  m += `\n`;

  m += `4. COMPETITIVE BATTLEFIELD\n──────────────────────────────────────────────────────────────\nSource: Serper API (Live Google SERP)\n\n`;
  serpResults.forEach((s)=>m+=`Position #${s.position}: ${s.title}\n  URL: ${s.link}\n  Est. DA: ${s.da}\n  Est. Traffic: ${s.traffic !== null ? s.traffic.toLocaleString() : 'Not Disclosed'} visits/mo\n  Snippet: ${s.snippet?.substring(0,120)||'N/A'}\n\n`);
  m += `\n`;

  m += `5. WHITE SPACE OPPORTUNITIES\n──────────────────────────────────────────────────────────────\n`;
  analysis.entry_opportunities?.forEach((g:any)=>m+=`${g.title}\n  ${g.description}\n  Revenue Potential: ${g.revenue_potential}\n  Difficulty: ${g.difficulty}\n  First Action: ${g.first_action}\n\n`);

  m += `6. WHO'S BUYING\n──────────────────────────────────────────────────────────────\n`;
  analysis.audience_profiles?.forEach((p:any)=>m+=`${p.name} | ${p.age_range} | ${p.income}\n  Primary Need: ${p.primary_need}\n  Purchase Trigger: ${p.purchase_trigger}\n  Channels: ${p.channels?.join(', ')}\n  Messaging: "${p.messaging}"\n\n`);

  if (analysis.growth_accelerators?.length) { m += `7. FAST-TRACK STRATEGIES\n──────────────────────────────────────────────────────────────\n`; analysis.growth_accelerators.forEach((tip:string,i:number)=>m+=`${i+1}. ${tip}\n`); m += `\n`; }

  m += `8. YOUR 12-WEEK LAUNCH PLAN\n──────────────────────────────────────────────────────────────\n`;
  analysis.execution_roadmap?.forEach((w:any)=>m+=`Week ${w.week}: ${w.phase}\n  ${w.tasks?.join('\n  ')}\n  KPI: ${w.kpi}\n\n`);

  m += `9. MONEY MATH\n──────────────────────────────────────────────────────────────\nStartup Cost: ${localPrice(fp?.startup_cost)}\nMonthly Fixed Costs: ${localPrice(fp?.monthly_fixed_costs)}\nAvg Profit Per Unit: ${localPrice(fp?.avg_profit_per_unit)}\nUnits to Breakeven: ${fp?.units_to_breakeven}\nTime to Profitability: ${fp?.months_to_profitability} months\nMonth 6 Profit (Conservative): ${localPrice(fp?.month6_profit_conservative)}\nMonth 6 Profit (Optimistic): ${localPrice(fp?.month6_profit_optimistic)}\n\n`;

  m += `10. WHAT COULD GO WRONG\n──────────────────────────────────────────────────────────────\n`;
  analysis.risk_matrix?.forEach((r:any)=>m+=`Risk: ${r.risk}\n  Probability: ${r.probability} | Impact: ${r.impact}\n  Mitigation: ${r.mitigation}\n\n`);

  if (analysis.related_resources?.length) { m += `11. TOOLS & LINKS\n──────────────────────────────────────────────────────────────\n`; analysis.related_resources.forEach((res:any,i:number)=>m+=`${i+1}. ${res.name} – ${res.url}\n`); m += `\n`; }

  m += `METHODOLOGY & SOURCES\n──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• Google Shopping via SerpApi (serpapi.com)\n• ${keywordSource}\n• Live Google SERP via Serper API (serper.dev)\n• ExchangeRate-API (exchangerate-api.com)\n• Analysis Engine: Gemini AI\n\nAll data points can be independently verified against their public sources.\n\n`;
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

    let keywords: FlexibleKeyword[] = [];
    let keywordSource = 'Google Keyword Planner via DataForSEO (dataforseo.com)';

    try {
      const dfKeywords: RealKeywordData[] = await getKeywordData(niche, country, 50);
      if (dfKeywords && dfKeywords.length > 0) {
        keywords = dfKeywords.map(k => ({ keyword: k.keyword, volume: k.volume, cpc: k.cpc, kd: k.kd }));
      } else throw new Error('empty');
    } catch (e) {
      console.warn(`⚠️ DataForSEO failed for product report, using real SERP queries`);
      keywordSource = 'Live Google SERP via Serper API (serper.dev)';
      keywords = (serperData?.relatedSearches || []).slice(0, 50).map(q => ({ keyword: q, volume: null, cpc: null, kd: null }));
    }

    const realProducts: RealProduct[] = (shoppingData.shopping_results || []).slice(0, 10).map((p: any) => ({ title: p.title || 'Unknown', price: p.extracted_price || p.price || 0, source: p.source || 'Unknown', reviews: p.rating || 0 }));

    const serpResults: ProductSerpResult[] = (serperData?.organic || []).slice(0, 8).map((r: SerperResult) => ({ ...r, da: estimateDA(r.link), traffic: estimateTraffic(r.position, keywords[0]?.volume ?? null) }));

    const aiContext = { niche, country, realProducts, serpResults, keywords, exchangeRates: fx };
    const ai = await runGroqWithRetry(PROMPT, JSON.stringify(aiContext));
    const analysis = extractJSON(ai);

    const report = await Report.create({
      type: 'product', niche, country, value: '$99',
      data: { ...analysis, realProducts, serpResults, keywords },
      markdown: 'Intelligence report generation in progress...',
      charts: { fx },
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, realProducts, serpResults, keywords, fx, niche, country, reportId, keywordSource);
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
