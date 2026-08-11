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

const PROMPT = `You are a senior market analyst at MusePRO Intelligence Division. You have 15 years of experience. You're writing a confidential report for a client who paid good money for your insights. You speak to them like a trusted advisor — professional, warm, direct, and genuinely excited about the opportunities you uncover.

CRITICAL TONE INSTRUCTIONS:
- You are NOT writing a textbook. You are NOT writing a corporate memo. You are telling a client what matters and why.
- Use first-person plural consistently: "We analyzed...", "Our take...", "We're seeing...", "Here's what jumped out at us..."
- Address the client directly: "Here's what this means for you." "You'll want to pay attention to this section."
- Be honest and opinionated. If something is impressive, say so. If something is risky, be direct about it.
- Mix sentence lengths freely. Some short and punchy. Others more detailed when explaining complex data.
- Use natural business language. Avoid "leverage", "utilize", "synergize", "robust" — these words are banned.
- Every data point must be followed by interpretation. Numbers alone are useless. Tell the client what the number means.
- Express genuine enthusiasm about strong opportunities and genuine concern about real risks. Your voice matters.
- Occasionally use sentence fragments for emphasis. "Solid margins." "Not worth the effort." "This one surprised us."
- Read every section aloud in your head. If it doesn't sound like something you'd say to a client over coffee, rewrite it.

Analyze the real shopping data, keyword metrics, exchange rates, and trends provided. Return ONLY valid JSON.

{
  "market_score": number (0‑100),
  "opportunity_level": "High" | "Moderate" | "Limited",
  "executive_brief": "3‑4 sentences. Lead with the most important finding. Use a confident, conversational tone. Include a specific number.",
  "key_insights": [
    "Insight written in your natural voice with a metric woven in. Sound like you just noticed something interesting.",
    "Insight written in your natural voice with a metric woven in.",
    "Insight written in your natural voice with a metric woven in."
  ] (exactly 3),
  "immediate_actions": [
    "Direct recommendation. 'Here's what we'd do first.'",
    "Direct recommendation.",
    "Direct recommendation."
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
      "strengths": ["specific strength","specific strength"],
      "weaknesses": ["specific weakness","specific weakness"],
      "strategic_response": "How to beat them. Write this like a coach giving advice — confident, specific, motivating."
    }
  ] (6 competitors),
  "entry_opportunities": [
    {
      "title": "opportunity title",
      "description": "Paragraph that makes the client feel like they've been handed a secret. Specific, excited, data-backed.",
      "revenue_potential": "$5k‑10k/mo or $10k‑25k/mo or $25k+/mo",
      "difficulty": "Easy/Moderate/Hard",
      "first_action": "Concrete first step, written as a suggestion from someone who's done this before."
    }
  ] (3 opportunities),
  "audience_profiles": [
    {
      "name": "profile name",
      "age_range": "25‑34",
      "income": "$40k‑60k",
      "primary_need": "What they actually want. Plain language.",
      "purchase_trigger": "What makes them buy now.",
      "channels": ["channel1","channel2"],
      "messaging": "Ad copy that would actually make this person stop and click. Real marketing language."
    }
  ] (3 profiles),
  "execution_roadmap": [
    {
      "week": 1‑12,
      "phase": "Phase name",
      "tasks": ["clear task","clear task","clear task"],
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
      "risk": "Honest risk. No sugar-coating.",
      "probability": "Low/Medium/High",
      "impact": "Low/Medium/High",
      "mitigation": "What we'd actually do. Practical, specific."
    }
  ] (5 risks),
  "growth_accelerators": [
    "Insider tip that feels like a shortcut. Valuable, specific.",
    "Insider tip that feels like a shortcut.",
    "Insider tip that feels like a shortcut.",
    "Insider tip that feels like a shortcut.",
    "Insider tip that feels like a shortcut."
  ] (5 tips),
  "related_resources": [
    { "name": "name", "url": "url" },
    { "name": "name", "url": "url" },
    { "name": "name", "url": "url" },
    { "name": "name", "url": "url" },
    { "name": "name", "url": "url" },
    { "name": "name", "url": "url" },
    { "name": "name", "url": "url" },
    { "name": "name", "url": "url" }
  ] (8 resources),
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

  m += `MusePRO\nReal-Time Market Research\nIntelligence Division\n`;
  m += `──────────────────────────────────────────────────────────────\n`;
  m += `PRODUCT RESEARCH REPORT\n\n`;
  m += `Prepared For: [Client Name]\nDate: ${today}\nReference: ${reportId}\nClassification: CONFIDENTIAL\n`;
  m += `──────────────────────────────────────────────────────────────\n\n`;
  m += `TABLE OF CONTENTS\n──────────────────────────────────────────────────────────────\n`;
  m += `1. Executive Brief\n2. Opportunity Scorecard\n3. Product & Pricing Intelligence\n4. Competitive Landscape\n5. Market Entry Opportunities\n6. Target Audience Profiles\n7. Growth Accelerators\n8. 12‑Week Execution Roadmap\n9. Financial Forecast\n10. Risk Matrix\n11. Related Resources\n\n`;
  m += `──────────────────────────────────────────────────────────────\n\n`;

  m += `1. EXECUTIVE BRIEF\n──────────────────────────────────────────────────────────────\n${a.executive_brief}\n\n`;

  m += `2. OPPORTUNITY SCORECARD\n──────────────────────────────────────────────────────────────\n`;
  m += `Market Score: ${a.market_score}/100 ${scoreBar(a.market_score)}\nOpportunity Level: ${a.opportunity_level || 'N/A'}\n`;
  const fp = a.financial_forecast;
  if (fp?.month6_profit_optimistic) m += `Est. Monthly Profit Potential: ${localPrice(fp.month6_profit_optimistic)}\n`;
  m += `Time to Profitability: ${fp?.months_to_profitability || 'N/A'} months\n\n`;
  if (a.key_insights?.length) { m += `Key Insights:\n`; a.key_insights.forEach((f: string, i: number) => { m += `  ${i+1}. ${f}\n`; }); m += `\n`; }
  if (a.immediate_actions?.length) { m += `Immediate Actions:\n`; a.immediate_actions.forEach((w: string, i: number) => { m += `  ${i+1}. ${w}\n`; }); m += `\n`; }

  m += `3. PRODUCT & PRICING INTELLIGENCE\n──────────────────────────────────────────────────────────────\nSource: Google Shopping (live data via SerpAPI)\n\n`;
  m += `| # | Product | Price | Cost | Profit | Margin | Monthly Est. Revenue | Reviews |\n|---|---------|-------|------|--------|--------|----------------------|--------|\n`;
  a.pricing_engine?.forEach((p: any, i: number) => { m += `| ${i+1} | ${p.title} | ${localPrice(p.selling_price_usd)} | ${localPrice(p.landed_cost_usd)} | ${localPrice(p.net_profit_usd)} | ${p.profit_margin_percent}% | ${localPrice(p.monthly_revenue_potential)} | ${p.reviews} |\n`; });
  m += `\n`;

  m += `4. COMPETITIVE LANDSCAPE\n──────────────────────────────────────────────────────────────\n`;
  a.competitor_landscape?.forEach((c: any) => { m += `${c.name} (${c.position})\n  Est. Monthly Sales: ${localPrice(c.estimated_monthly_sales)}\n  Avg Price Point: ${localPrice(c.avg_price_point)}\n  Strengths: ${c.strengths?.join(', ')}\n  Weaknesses: ${c.weaknesses?.join(', ')}\n  Strategic Response: ${c.strategic_response}\n\n`; });

  m += `5. MARKET ENTRY OPPORTUNITIES\n──────────────────────────────────────────────────────────────\n`;
  a.entry_opportunities?.forEach((g: any) => { m += `${g.title}\n  ${g.description}\n  Revenue Potential: ${g.revenue_potential}\n  Difficulty: ${g.difficulty}\n  First Action: ${g.first_action}\n\n`; });

  m += `6. TARGET AUDIENCE PROFILES\n──────────────────────────────────────────────────────────────\n`;
  a.audience_profiles?.forEach((p: any) => { m += `${p.name} | ${p.age_range} | ${p.income}\n  Primary Need: ${p.primary_need}\n  Purchase Trigger: ${p.purchase_trigger}\n  Channels: ${p.channels?.join(', ')}\n  Messaging: "${p.messaging}"\n\n`; });

  if (a.growth_accelerators?.length) { m += `7. GROWTH ACCELERATORS\n──────────────────────────────────────────────────────────────\n`; a.growth_accelerators.forEach((tip: string, i: number) => { m += `${i+1}. ${tip}\n`; }); m += `\n`; }

  m += `8. 12‑WEEK EXECUTION ROADMAP\n──────────────────────────────────────────────────────────────\n`;
  a.execution_roadmap?.forEach((w: any) => { m += `Week ${w.week}: ${w.phase}\n`; w.tasks?.forEach((t: string) => { m += `  - ${t}\n`; }); m += `  KPI: ${w.kpi}\n\n`; });

  m += `9. FINANCIAL FORECAST\n──────────────────────────────────────────────────────────────\n`;
  m += `Startup Cost: ${localPrice(fp?.startup_cost)}\nMonthly Fixed Costs: ${localPrice(fp?.monthly_fixed_costs)}\nAvg Profit Per Unit: ${localPrice(fp?.avg_profit_per_unit)}\nUnits to Breakeven: ${fp?.units_to_breakeven}\nTime to Profitability: ${fp?.months_to_profitability} months\nMonth 6 Profit (Conservative): ${localPrice(fp?.month6_profit_conservative)}\nMonth 6 Profit (Optimistic): ${localPrice(fp?.month6_profit_optimistic)}\n\n`;

  m += `10. RISK MATRIX\n──────────────────────────────────────────────────────────────\n`;
  a.risk_matrix?.forEach((r: any) => { m += `Risk: ${r.risk}\n  Probability: ${r.probability} | Impact: ${r.impact}\n  Mitigation: ${r.mitigation}\n\n`; });

  if (a.related_resources?.length) { m += `11. RELATED RESOURCES\n──────────────────────────────────────────────────────────────\n`; a.related_resources.forEach((res: any, i: number) => { m += `${i+1}. ${res.name} – ${res.url}\n`; }); m += `\n`; }

  m += `METHODOLOGY & SOURCES\n──────────────────────────────────────────────────────────────\nThis report is based on live data collected on ${today} from:\n\n• Google Shopping via SerpAPI (serpapi.com)\n• Google Keyword Planner via Keywords Everywhere (keywordseverywhere.com)\n• Google Trends via Keywords Everywhere\n• Exchange Rate API (exchangerate-api.com)\n• Analysis Engine: GPT‑4o (openai.com)\n\nAll data points can be independently verified against their public sources.\n\n`;
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
    const [shoppingData, fx, trendsArr, keywordMetrics] = await Promise.all([getShoppingResults(niche, country).catch(() => null), getExchangeRates(), getTrends(niche, country).catch(() => null), getKeywordMetrics([niche], country).catch(() => null)]);
    if (!shoppingData) throw new Error('Unable to retrieve shopping data.');
    const items = shoppingData.shopping_results?.slice(0, 8).map((p: any) => ({ title: p.title, price: p.extracted_price || p.price, source: p.source, reviews: p.rating || 0, image: p.thumbnail || '' })) || [];
    const seedKw = keywordMetrics?.data?.[0];
    const userMsg = `Niche: ${niche}\nCountry: ${country}\nExchange Rates: ${JSON.stringify(fx)}\nShopping Results: ${JSON.stringify(items)}\nMarket Data: ${JSON.stringify({ seedKeyword: seedKw ? { keyword: seedKw.keyword, volume: seedKw.vol, cpc: seedKw.cpc?.value } : null, trends: trendsArr || null })}\nTrends: ${trendsArr ? JSON.stringify(trendsArr) : 'N/A'}\n\nProvide complete JSON analysis.`;
    const ai = await runGroqWithRetry(PROMPT, userMsg);
    const analysis = extractJSON(ai);
    if (trendsArr && Array.isArray(trendsArr)) { analysis.chart_data = analysis.chart_data || {}; analysis.chart_data.demand_forecast_12m = trendsArr; }
    const report = await Report.create({ type: 'product', niche, country, value: '$99', data: analysis, markdown: 'Intelligence report generation in progress...', charts: {} });
    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, niche, country, fx, reportId);
    report.markdown = markdown; report.charts = { trends: trendsArr, fx }; await report.save();
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
