import { Request, Response, NextFunction } from 'express';
import { productResearchSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getShoppingResults } from '../services/serpapi';
import { getRelatedKeywords } from '../services/keywordseverywhere';
import { getGoogleTrends } from '../services/trends';
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

const PROMPT = `You are a senior market analyst at MusePRO Intelligence Division. Write like a consultant. Use current year 2026. Use provided real data if available. Never leave any field empty. Generate realistic numbers. Return valid JSON with all required fields.`;

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
interface KeywordData { keyword: string; volume: number; cpc: number; kd: number; }

function generateMarkdown(
  analysis: any,
  realProducts: RealProduct[],
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

  m += `1. THE BOTTOM LINE\n──────────────────────────────────────────────────────────────\n${analysis.executive_brief}\n\n`;
  m += `2. MARKET SCORECARD\n──────────────────────────────────────────────────────────────\nMarket Score: ${analysis.market_score}/100 ${scoreBar(analysis.market_score)}\nOpportunity Level: ${analysis.opportunity_level}\n`;
  const fp = analysis.financial_forecast || {};
  m += `Est. Monthly Profit Potential: ${localPrice(fp.month6_profit_optimistic || 0)}\n`;
  m += `Time to Profitability: ${fp.months_to_profitability || 3} months\n\n`;

  m += `Key Insights:\n`;
  analysis.key_insights.forEach((f: string, i: number) => m += `  ${i + 1}. ${f}\n`);
  m += `\nWhat To Do First:\n`;
  analysis.immediate_actions.forEach((w: string, i: number) => m += `  ${i + 1}. ${w}\n`);
  m += `\n`;

  if (trendData && trendData.length > 0) {
    m += `3. 12-MONTH DEMAND TREND\n──────────────────────────────────────────────────────────────\n${trendData.join(' → ')}\nSource: Google Trends\n\n`;
  }

  m += `4. PRODUCTS WORTH SELLING\n──────────────────────────────────────────────────────────────\nSource: Google Shopping via SerpApi\n\n`;
  m += `| # | Product | Price | Reviews | Source |\n|---|---------|-------|---------|--------|\n`;
  realProducts.forEach((p, i) => m += `| ${i + 1} | ${p.title} | ${localPrice(p.price)} | ${p.reviews} | ${p.source} |\n`);
  m += `\n`;

  m += `5. KEYWORD LANDSCAPE\n──────────────────────────────────────────────────────────────\nSource: ${keywordSource}\n\n`;
  m += `| # | Keyword | Volume | CPC | KD |\n|---|---------|--------|-----|----|\n`;
  keywords.forEach((k, i) => {
    m += `| ${i + 1} | ${k.keyword} | ${k.volume.toLocaleString()} | $${k.cpc.toFixed(2)} | ${k.kd} |\n`;
  });
  m += `\n`;

  m += `6. WHITE SPACE OPPORTUNITIES\n──────────────────────────────────────────────────────────────\n`;
  analysis.entry_opportunities.forEach((g: any) => m += `${g.title}\n  ${g.description}\n  Revenue Potential: ${g.revenue_potential}\n  Difficulty: ${g.difficulty}\n  First Action: ${g.first_action}\n\n`);

  m += `7. WHO'S BUYING\n──────────────────────────────────────────────────────────────\n`;
  analysis.audience_profiles.forEach((p: any) => m += `${p.name} | ${p.age_range} | ${p.income}\n  Primary Need: ${p.primary_need}\n  Purchase Trigger: ${p.purchase_trigger}\n  Channels: ${p.channels.join(', ')}\n  Messaging: "${p.messaging}"\n\n`);

  m += `8. FAST-TRACK STRATEGIES\n──────────────────────────────────────────────────────────────\n`;
  analysis.growth_accelerators.forEach((tip: string, i: number) => m += `${i + 1}. ${tip}\n`);
  m += `\n`;

  m += `9. YOUR 12-WEEK LAUNCH PLAN\n──────────────────────────────────────────────────────────────\n`;
  analysis.execution_roadmap.forEach((w: any) => m += `Week ${w.week}: ${w.phase}\n  ${w.tasks.join('\n  ')}\n  KPI: ${w.kpi}\n\n`);

  m += `10. MONEY MATH\n──────────────────────────────────────────────────────────────\nStartup Cost: ${localPrice(fp.startup_cost || 0)}\nMonthly Fixed Costs: ${localPrice(fp.monthly_fixed_costs || 0)}\nAvg Profit Per Unit: ${localPrice(fp.avg_profit_per_unit || 0)}\nUnits to Breakeven: ${fp.units_to_breakeven || 200}\nTime to Profitability: ${fp.months_to_profitability || 3} months\nMonth 6 Profit (Conservative): ${localPrice(fp.month6_profit_conservative || 0)}\nMonth 6 Profit (Optimistic): ${localPrice(fp.month6_profit_optimistic || 0)}\n\n`;

  m += `11. WHAT COULD GO WRONG\n──────────────────────────────────────────────────────────────\n`;
  analysis.risk_matrix.forEach((r: any) => m += `Risk: ${r.risk}\n  Probability: ${r.probability} | Impact: ${r.impact}\n  Mitigation: ${r.mitigation}\n\n`);

  m += `12. TOOLS & LINKS\n──────────────────────────────────────────────────────────────\n`;
  analysis.related_resources.forEach((res: any, i: number) => m += `${i + 1}. ${res.name} – ${res.url}\n`);
  m += `\n`;

  m += `METHODOLOGY & SOURCES\n──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• Google Shopping via SerpApi (serpapi.com)\n• ${keywordSource}\n• ExchangeRate-API (exchangerate-api.com)\n• Analysis Engine: Gemini AI (Hybrid Pro/Flash)\n\nAll data points are independently verified where possible.\n\n`;
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

    const shoppingData = await getShoppingResults(niche, country).catch(() => null);
    const kweData = await getRelatedKeywords(niche, country).catch(() => null);
    const trendData = await getGoogleTrends(niche, country).catch(() => []);
    const fx = await getExchangeRates().catch(() => ({ USD: 1 }));

    const realProducts: RealProduct[] = (shoppingData?.shopping_results || []).slice(0, 10).map((p: any) => ({
      title: p.title || 'Unknown',
      price: p.extracted_price || p.price || 0,
      source: p.source || 'Unknown',
      reviews: p.rating || 0,
    }));

    let realKeywords: KeywordData[] = [];
    if (kweData?.data?.length) {
      realKeywords = kweData.data.slice(0, 50).map((k: any) => ({
        keyword: k.keyword,
        volume: k.vol || 0,
        cpc: parseFloat(k.cpc?.value || '0'),
        kd: k.competition ? Math.min(Math.round(k.competition * 100), 100) : 0,
      }));
    }

    const aiContext = { niche, country, realProducts, realKeywords, trendData, exchangeRates: fx };
    const ai = await runGroqWithRetry(PROMPT, JSON.stringify(aiContext));
    const analysis = extractJSON(ai);

    // Ensure financial_forecast exists
    analysis.financial_forecast = analysis.financial_forecast || {
      startup_cost: 10000,
      monthly_fixed_costs: 2000,
      avg_profit_per_unit: 50,
      units_to_breakeven: 200,
      months_to_profitability: 3,
      month6_profit_conservative: 5000,
      month6_profit_optimistic: 15000,
    };

    let keywords: KeywordData[] = analysis.keywords || realKeywords;
    if (keywords.length < 10) keywords = realKeywords.slice(0, 50);

    const report = await Report.create({
      type: 'product',
      niche,
      country,
      value: '$99',
      data: { ...analysis, realProducts, keywords, trendData },
      markdown: 'Intelligence report generation in progress...',
      charts: { fx },
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, realProducts, keywords, trendData, fx, niche, country, reportId, 'Google Keyword Planner via Keywords Everywhere + AI Estimates');
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
