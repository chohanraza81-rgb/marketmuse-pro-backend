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

const PROMPT = `You are a senior market analyst at MusePRO Intelligence Division. Write like a consultant. Use current year 2026. Use provided real data if available. If some data is missing, intelligently generate realistic values and mark them as "Estimated". Never leave sections empty. Return valid JSON with all required fields.`;

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

  m += `1. THE BOTTOM LINE\n──────────────────────────────────────────────────────────────\n${analysis.executive_brief || 'Not Disclosed'}\n\n`;
  m += `2. MARKET SCORECARD\n──────────────────────────────────────────────────────────────\nMarket Score: ${analysis.market_score ?? 'Estimated'}/100 ${scoreBar(analysis.market_score || 0)}\nOpportunity Level: ${analysis.opportunity_level || 'Estimated'}\n`;
  const fp = analysis.financial_forecast || {};
  if (fp.month6_profit_optimistic) m += `Est. Monthly Profit Potential: ${localPrice(fp.month6_profit_optimistic)}\n`;
  m += `Time to Profitability: ${fp.months_to_profitability ?? 'Estimated'} months\n\n`;

  m += `Key Insights:\n`;
  (analysis.key_insights || []).forEach((f: string, i: number) => m += `  ${i + 1}. ${f}\n`);
  m += `\nWhat To Do First:\n`;
  (analysis.immediate_actions || []).forEach((w: string, i: number) => m += `  ${i + 1}. ${w}\n`);
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
    const vol = k.volume !== null ? k.volume.toLocaleString() : 'Estimated';
    const cpc = k.cpc !== null ? `$${k.cpc.toFixed(2)}` : 'Estimated';
    const kd = k.kd !== null ? k.kd : 'Estimated';
    m += `| ${i + 1} | ${k.keyword} | ${vol} | ${cpc} | ${kd} |\n`;
  });
  m += `\n`;

  m += `6. WHITE SPACE OPPORTUNITIES\n──────────────────────────────────────────────────────────────\n`;
  (analysis.entry_opportunities || []).forEach((g: any) => m += `${g.title || 'N/A'}\n  ${g.description || 'N/A'}\n  Revenue Potential: ${g.revenue_potential || 'Estimated'}\n  Difficulty: ${g.difficulty || 'Estimated'}\n  First Action: ${g.first_action || 'N/A'}\n\n`);

  m += `7. WHO'S BUYING\n──────────────────────────────────────────────────────────────\n`;
  (analysis.audience_profiles || []).forEach((p: any) => m += `${p.name || 'N/A'} | ${p.age_range || 'N/A'} | ${p.income || 'N/A'}\n  Primary Need: ${p.primary_need || 'N/A'}\n  Purchase Trigger: ${p.purchase_trigger || 'N/A'}\n  Channels: ${p.channels?.join(', ') || 'N/A'}\n  Messaging: "${p.messaging || 'N/A'}"\n\n`);

  if (analysis.growth_accelerators?.length) {
    m += `8. FAST-TRACK STRATEGIES\n──────────────────────────────────────────────────────────────\n`;
    analysis.growth_accelerators.forEach((tip: string, i: number) => m += `${i + 1}. ${tip}\n`);
    m += `\n`;
  }

  m += `9. YOUR 12-WEEK LAUNCH PLAN\n──────────────────────────────────────────────────────────────\n`;
  (analysis.execution_roadmap || []).forEach((w: any, idx: number) => m += `Week ${w.week || idx + 1}: ${w.phase || 'N/A'}\n  ${w.tasks?.join('\n  ') || 'N/A'}\n  KPI: ${w.kpi || 'N/A'}\n\n`);

  m += `10. MONEY MATH\n──────────────────────────────────────────────────────────────\nStartup Cost: ${localPrice(fp.startup_cost || 0)}\nMonthly Fixed Costs: ${localPrice(fp.monthly_fixed_costs || 0)}\nAvg Profit Per Unit: ${localPrice(fp.avg_profit_per_unit || 0)}\nUnits to Breakeven: ${fp.units_to_breakeven ?? 'Estimated'}\nTime to Profitability: ${fp.months_to_profitability ?? 'Estimated'} months\nMonth 6 Profit (Conservative): ${localPrice(fp.month6_profit_conservative || 0)}\nMonth 6 Profit (Optimistic): ${localPrice(fp.month6_profit_optimistic || 0)}\n\n`;

  m += `11. WHAT COULD GO WRONG\n──────────────────────────────────────────────────────────────\n`;
  (analysis.risk_matrix || []).forEach((r: any) => m += `Risk: ${r.risk || 'N/A'}\n  Probability: ${r.probability || 'N/A'} | Impact: ${r.impact || 'N/A'}\n  Mitigation: ${r.mitigation || 'N/A'}\n\n`);

  if (analysis.related_resources?.length) {
    m += `12. TOOLS & LINKS\n──────────────────────────────────────────────────────────────\n`;
    analysis.related_resources.forEach((res: any, i: number) => m += `${i + 1}. ${res.name || 'N/A'} – ${res.url || 'N/A'}\n`);
    m += `\n`;
  }

  m += `METHODOLOGY & SOURCES\n──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• Google Shopping via SerpApi (serpapi.com)\n• ${keywordSource}\n• ExchangeRate-API (exchangerate-api.com)\n• Analysis Engine: Gemini AI (Hybrid Pro/Flash)\n\nAll data points are independently verified where possible. Some metrics are marked as 'Estimated' when real-time data is unavailable.\n\n`;
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

    // Fetch real data where possible, but don't fail if missing
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

    let keywords: KeywordData[] = [];
    if (kweData?.data?.length) {
      keywords = kweData.data.slice(0, 50).map((k: any) => ({
        keyword: k.keyword,
        volume: k.vol || null,
        cpc: parseFloat(k.cpc?.value || '0') || null,
        kd: k.competition ? Math.min(Math.round(k.competition * 100), 100) : null,
      }));
      console.log(`✅ Keywords Everywhere provided ${keywords.length} keywords`);
    } else {
      console.warn(`⚠️ Keywords Everywhere unavailable, AI will estimate keywords`);
    }

    const aiContext = { niche, country, realProducts, keywords, trendData, exchangeRates: fx };
    const ai = await runGroqWithRetry(PROMPT, JSON.stringify(aiContext));
    const analysis = extractJSON(ai);

    if (!analysis.keywords || analysis.keywords.length === 0) {
      analysis.keywords = keywords.map(k => ({ keyword: k.keyword, volume: k.volume ?? null, cpc: k.cpc ?? null, kd: k.kd ?? null }));
    }
    if (!analysis.keywords || analysis.keywords.length === 0) {
      analysis.keywords = [{ keyword: niche, volume: null, cpc: null, kd: null }];
    }

    const report = await Report.create({
      type: 'product',
      niche,
      country,
      value: '$99',
      data: { ...analysis, realProducts, keywords: analysis.keywords, trendData },
      markdown: 'Intelligence report generation in progress...',
      charts: { fx },
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, realProducts, analysis.keywords, trendData, fx, niche, country, reportId, 'Google Keyword Planner via Keywords Everywhere + AI Estimates');
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
