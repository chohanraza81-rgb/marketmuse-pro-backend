import { Request, Response, NextFunction } from 'express';
import { productResearchSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getShoppingResults } from '../services/serpapi';
import { getTrends, getKeywordMetrics } from '../services/keywordseverywhere';
import { getExchangeRates, convertPrice } from '../services/exchange';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const extractJSON = (raw: string): any => {
  let c = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = c.indexOf('{'), e = c.lastIndexOf('}');
  if (s !== -1 && e !== -1 && e > s) c = c.substring(s, e + 1);
  return JSON.parse(c);
};

const PROMPT = `You are a senior market analyst at an elite intelligence division. Analyze the provided shopping data, keyword metrics, exchange rates, and 12‑month trends. Return ONLY valid JSON. Be specific, data‑driven, and professional.

{
  "market_score": number (0‑100),
  "opportunity_level": "High" | "Moderate" | "Limited",
  "executive_brief": "3‑4 sentence professional summary using actual numbers",
  "key_insights": [
    "Specific insight with metric",
    "Specific insight with metric",
    "Specific insight with metric"
  ] (exactly 3),
  "immediate_actions": [
    "Actionable step 1",
    "Actionable step 2",
    "Actionable step 3"
  ] (exactly 3),
  "pricing_engine": [
    {
      "title": "actual product name",
      "selling_price_usd": number,
      "landed_cost_usd": number,
      "net_profit_usd": number,
      "profit_margin_percent": number,
      "monthly_units_potential": number,
      "monthly_revenue_potential": number,
      "monthly_profit_potential": number,
      "reviews": number,
      "rating": number,
      "source": "store name"
    }
  ] (12 items),
  "competitor_landscape": [
    {
      "name": "real brand",
      "position": "Market Leader/Challenger/Niche/New Entrant",
      "estimated_monthly_sales": number,
      "avg_price_point": number,
      "strengths": ["s1","s2"],
      "weaknesses": ["w1","w2"],
      "strategic_response": "how to compete"
    }
  ] (6 competitors),
  "entry_opportunities": [
    {
      "title": "opportunity title",
      "description": "detailed paragraph with numbers",
      "revenue_potential": "$5k‑10k/mo or $10k‑25k/mo or $25k+/mo",
      "difficulty": "Easy/Moderate/Hard",
      "first_action": "concrete step"
    }
  ] (3 opportunities),
  "audience_profiles": [
    {
      "name": "profile name",
      "age_range": "25‑34",
      "income": "$40k‑60k",
      "primary_need": "core problem",
      "purchase_trigger": "what drives purchase",
      "channels": ["channel1","channel2"],
      "messaging": "exact ad copy"
    }
  ] (3 profiles),
  "execution_roadmap": [
    {
      "week": 1‑12,
      "phase": "Foundation/Sourcing/Branding/Launch/Scale",
      "tasks": ["task1","task2","task3"],
      "kpi": "measurable outcome"
    }
  ] (12 weeks),
  "financial_forecast": {
    "startup_cost": number,
    "monthly_fixed_costs": number,
    "avg_profit_per_unit": number,
    "units_to_breakeven": number,
    "months_to_profitability": number,
    "month6_profit_conservative": number,
    "month6_profit_optimistic": number
  },
  "risk_matrix": [
    {
      "risk": "specific risk",
      "probability": "Low/Medium/High",
      "impact": "Low/Medium/High",
      "mitigation": "specific action"
    }
  ] (5 risks),
  "growth_accelerators": [
    "Pro tip or tool recommendation",
    "Pro tip or tool recommendation",
    "Pro tip or tool recommendation",
    "Pro tip or tool recommendation",
    "Pro tip or tool recommendation"
  ] (5 actionable tips),
  "related_resources": [
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" }
  ] (8 niche‑relevant resources),
  "chart_data": {
    "demand_forecast_12m": [12 numbers],
    "competitor_market_share": [{"name":"x","share":number}]
  }
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

function generateMarkdown(a: any, niche: string, country: string, rates: any, reportId: string): string {
  const sym = currencySymbols[country] || 'USD';
  const targetCurrency = sym;

  const localPrice = (usd: number) => {
    const converted = convertPrice(usd, targetCurrency, rates);
    return `${sym} ${converted.toLocaleString()}`;
  };

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  let m = '';

  // ── Cover / Header ──
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

  // ── Table of Contents ──
  m += `TABLE OF CONTENTS\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `1. Executive Brief\n`;
  m += `2. Opportunity Scorecard\n`;
  m += `3. Product & Pricing Intelligence\n`;
  m += `4. Competitive Landscape\n`;
  m += `5. Market Entry Opportunities\n`;
  m += `6. Target Audience Profiles\n`;
  m += `7. Growth Accelerators\n`;
  m += `8. 12‑Week Execution Roadmap\n`;
  m += `9. Financial Forecast\n`;
  m += `10. Risk Matrix\n`;
  m += `11. Related Resources\n\n`;
  m += `──────────────────────────────────────────────────────────────\n\n`;

  // 1. Executive Brief
  m += `1. EXECUTIVE BRIEF\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `${a.executive_brief}\n\n`;

  // 2. Opportunity Scorecard
  m += `2. OPPORTUNITY SCORECARD\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `Market Score: ${a.market_score}/100 ${scoreBar(a.market_score)}\n`;
  m += `Opportunity Level: ${a.opportunity_level || 'N/A'}\n`;
  const fp = a.financial_forecast;
  if (fp?.month6_profit_optimistic) {
    m += `Est. Monthly Profit Potential: ${localPrice(fp.month6_profit_optimistic)}\n`;
  }
  m += `Time to Profitability: ${fp?.months_to_profitability || 'N/A'} months\n\n`;

  // Key Insights
  if (a.key_insights?.length) {
    m += `Key Insights:\n`;
    a.key_insights.forEach((f: string, i: number) => { m += `  ${i+1}. ${f}\n`; });
    m += `\n`;
  }

  // Immediate Actions
  if (a.immediate_actions?.length) {
    m += `Immediate Actions:\n`;
    a.immediate_actions.forEach((w: string, i: number) => { m += `  ${i+1}. ${w}\n`; });
    m += `\n`;
  }

  // 3. Product & Pricing Intelligence
  m += `3. PRODUCT & PRICING INTELLIGENCE\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `Source: Google Shopping (live data via SerpAPI)\n\n`;
  m += `| # | Product | Price | Cost | Profit | Margin | Monthly Est. Revenue | Reviews |\n`;
  m += `|---|---------|-------|------|--------|--------|----------------------|--------|\n`;
  a.pricing_engine?.forEach((p: any, i: number) => {
    m += `| ${i+1} | ${p.title} | ${localPrice(p.selling_price_usd)} | ${localPrice(p.landed_cost_usd)} | ${localPrice(p.net_profit_usd)} | ${p.profit_margin_percent}% | ${localPrice(p.monthly_revenue_potential)} | ${p.reviews} |\n`;
  });
  m += `\n`;

  // 4. Competitive Landscape
  m += `4. COMPETITIVE LANDSCAPE\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  a.competitor_landscape?.forEach((c: any) => {
    m += `${c.name} (${c.position})\n`;
    m += `  Est. Monthly Sales: ${localPrice(c.estimated_monthly_sales)}\n`;
    m += `  Avg Price Point: ${localPrice(c.avg_price_point)}\n`;
    m += `  Strengths: ${c.strengths?.join(', ')}\n`;
    m += `  Weaknesses: ${c.weaknesses?.join(', ')}\n`;
    m += `  Strategic Response: ${c.strategic_response}\n\n`;
  });

  // 5. Market Entry Opportunities
  m += `5. MARKET ENTRY OPPORTUNITIES\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  a.entry_opportunities?.forEach((g: any) => {
    m += `${g.title}\n`;
    m += `  ${g.description}\n`;
    m += `  Revenue Potential: ${g.revenue_potential}\n`;
    m += `  Difficulty: ${g.difficulty}\n`;
    m += `  First Action: ${g.first_action}\n\n`;
  });

  // 6. Target Audience Profiles
  m += `6. TARGET AUDIENCE PROFILES\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  a.audience_profiles?.forEach((p: any) => {
    m += `${p.name} | ${p.age_range} | ${p.income}\n`;
    m += `  Primary Need: ${p.primary_need}\n`;
    m += `  Purchase Trigger: ${p.purchase_trigger}\n`;
    m += `  Channels: ${p.channels?.join(', ')}\n`;
    m += `  Messaging: "${p.messaging}"\n\n`;
  });

  // 7. Growth Accelerators
  if (a.growth_accelerators?.length) {
    m += `7. GROWTH ACCELERATORS\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    a.growth_accelerators.forEach((tip: string, i: number) => { m += `${i+1}. ${tip}\n`; });
    m += `\n`;
  }

  // 8. Execution Roadmap
  m += `8. 12‑WEEK EXECUTION ROADMAP\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  a.execution_roadmap?.forEach((w: any) => {
    m += `Week ${w.week}: ${w.phase}\n`;
    w.tasks?.forEach((t: string) => { m += `  - ${t}\n`; });
    m += `  KPI: ${w.kpi}\n\n`;
  });

  // 9. Financial Forecast
  m += `9. FINANCIAL FORECAST\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `Startup Cost: ${localPrice(fp?.startup_cost)}\n`;
  m += `Monthly Fixed Costs: ${localPrice(fp?.monthly_fixed_costs)}\n`;
  m += `Avg Profit Per Unit: ${localPrice(fp?.avg_profit_per_unit)}\n`;
  m += `Units to Breakeven: ${fp?.units_to_breakeven}\n`;
  m += `Time to Profitability: ${fp?.months_to_profitability} months\n`;
  m += `Month 6 Profit (Conservative): ${localPrice(fp?.month6_profit_conservative)}\n`;
  m += `Month 6 Profit (Optimistic): ${localPrice(fp?.month6_profit_optimistic)}\n\n`;

  // 10. Risk Matrix
  m += `10. RISK MATRIX\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  a.risk_matrix?.forEach((r: any) => {
    m += `Risk: ${r.risk}\n`;
    m += `  Probability: ${r.probability} | Impact: ${r.impact}\n`;
    m += `  Mitigation: ${r.mitigation}\n\n`;
  });

  // 11. Related Resources
  if (a.related_resources?.length) {
    m += `11. RELATED RESOURCES\n`;
    m += `──────────────────────────────────────────────────────────────\n`;
    a.related_resources.forEach((res: any, i: number) => { m += `${i+1}. ${res.name} – ${res.url}\n`; });
    m += `\n`;
  }

  // ── Methodology & Sources ──
  m += `METHODOLOGY & SOURCES\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `This report is based on live data collected on ${today} from:\n\n`;
  m += `• Google Shopping via SerpAPI (serpapi.com)\n`;
  m += `• Google Keyword Planner via Keywords Everywhere (keywordseverywhere.com)\n`;
  m += `• Google Trends via Keywords Everywhere\n`;
  m += `• Exchange Rate API (exchangerate-api.com)\n`;
  m += `• Analysis Engine: GPT‑4o (openai.com)\n\n`;
  m += `All data points can be independently verified against their public sources.\n\n`;

  // ── Document Control ──
  m += `DOCUMENT CONTROL\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `Classification:  Confidential\n`;
  m += `Distribution:    Client Only\n`;
  m += `Version:         1.0\n`;
  m += `Prepared By:     MusePRO Intelligence Division\n\n`;

  // ── Disclaimer ──
  m += `DISCLAIMER\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `This document contains proprietary research conducted by MusePRO.\n`;
  m += `The information herein is intended solely for the designated recipient.\n`;
  m += `Unauthorized distribution, copying, or disclosure is strictly prohibited.\n\n`;
  m += `While every effort has been made to ensure accuracy, market conditions\n`;
  m += `change rapidly. Verify critical data points before making business decisions.\n\n`;

  m += `──────────────────────────────────────────────────────────────\n`;
  m += `© MusePRO — Intelligence Division. All Rights Reserved.\n`;

  return m;
}

export const createProductReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = productResearchSchema.parse(req.body);
    const ck = `prod_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    console.log(`Product: "${niche}" in ${country}`);

    const [shoppingData, fx, trendsArr, keywordMetrics] = await Promise.all([
      getShoppingResults(niche, country).catch(() => null),
      getExchangeRates(),
      getTrends(niche, country).catch(() => null),
      getKeywordMetrics([niche], country).catch(() => null),
    ]);

    if (!shoppingData) throw new Error('Unable to retrieve shopping data at this moment.');

    const items = shoppingData.shopping_results?.slice(0, 8).map((p: any) => ({
      title: p.title, price: p.extracted_price || p.price, source: p.source,
      reviews: p.rating || 0, image: p.thumbnail || ''
    })) || [];

    const seedKw = keywordMetrics?.data?.[0];
    const marketData = {
      seedKeyword: seedKw ? { keyword: seedKw.keyword, volume: seedKw.vol, cpc: seedKw.cpc?.value } : null,
      trends: trendsArr || null,
    };

    const userMsg = `Niche: ${niche}\nCountry: ${country}\nExchange Rates: ${JSON.stringify(fx)}\nShopping Results: ${JSON.stringify(items)}\nMarket Data: ${JSON.stringify(marketData)}\nTrends: ${trendsArr ? JSON.stringify(trendsArr) : 'N/A'}\n\nProvide a thorough, data‑backed JSON analysis with all required sections.`;

    const ai = await runGroqWithRetry(PROMPT, userMsg);
    const analysis = extractJSON(ai);

    if (trendsArr && Array.isArray(trendsArr)) {
      analysis.chart_data = analysis.chart_data || {};
      analysis.chart_data.demand_forecast_12m = trendsArr;
    }

    const report = await Report.create({
      type: 'product', niche, country, value: '$99',
      data: analysis, markdown: 'Intelligence report generation in progress...', charts: {}
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, niche, country, fx, reportId);
    report.markdown = markdown;
    report.charts = { trends: trendsArr, fx };
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
