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

const PROMPT = `You are a senior market analyst at a top consulting firm. Analyze the real shopping data, keyword metrics, exchange rates, and trends provided. Return ONLY valid JSON. Be specific, data‑driven, and avoid generic statements.

{
  "market_score": number (0-100),
  "opportunity_level": "High" | "Moderate" | "Limited",
  "executive_summary": "2-3 sentences with actual numbers from the data",
  "key_findings": [
    "Finding with specific numbers",
    "Finding with specific numbers",
    "Finding with specific numbers"
  ] (exactly 3, each must contain a real metric),
  "quick_wins": [
    "Immediate action item 1",
    "Immediate action item 2",
    "Immediate action item 3"
  ] (3 specific, niche‑related tasks that can be done today or this week),
  "pricing_engine": [
    {
      "title": "actual product name from data",
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
  ] (12 items, sorted by profit potential),
  "competitor_deep_dive": [
    {
      "name": "real brand",
      "market_position": "Market Leader/Challenger/Niche/New",
      "estimated_monthly_sales": number,
      "avg_price_point": number,
      "strengths": ["s1","s2"],
      "weaknesses": ["w1","w2"],
      "how_to_outcompete": "specific strategy"
    }
  ] (6 competitors),
  "market_gaps": [
    {
      "gap_title": "title",
      "description": "detailed with numbers",
      "revenue_potential": "$5k-10k/mo or $10k-25k/mo or $25k+/mo",
      "difficulty": "Easy/Moderate/Hard",
      "first_step": "concrete action"
    }
  ] (3 gaps),
  "customer_personas": [
    {
      "name": "name",
      "age_range": "25-34",
      "income_level": "$40k-60k",
      "core_problem": "pain point",
      "buying_trigger": "what makes them buy",
      "where_they_hang_out": ["p1","p2"],
      "marketing_message": "exact ad copy"
    }
  ] (3 personas),
  "launch_playbook": [
    {
      "week": 1-12,
      "theme": "Foundation/Sourcing/Branding/Launch/Scale",
      "tasks": ["t1","t2","t3"],
      "success_metric": "measurable outcome"
    }
  ] (12 weeks),
  "financial_projections": {
    "startup_cost_estimate": number,
    "monthly_fixed_costs": number,
    "avg_profit_per_unit": number,
    "units_to_breakeven": number,
    "estimated_months_to_profitability": number,
    "month6_profit_conservative": number,
    "month6_profit_optimistic": number
  },
  "risk_radar": [
    {
      "risk": "specific risk",
      "probability": "Low/Medium/High",
      "impact": "Low/Medium/High",
      "mitigation": "specific action"
    }
  ] (5 risks),
  "success_accelerators": [
    "Pro tip or tool recommendation",
    "Pro tip or tool recommendation",
    "Pro tip or tool recommendation",
    "Pro tip or tool recommendation",
    "Pro tip or tool recommendation"
  ] (5 actionable tips, can include well‑known tools, strategies, or shortcuts),
  "related_resources": [
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" },
    { "name": "resource name", "url": "full url" }
  ] (exactly 8 relevant, high‑quality external resources for this niche, e.g., supplier marketplaces, business tools, industry reports, e‑commerce platforms, etc.),
  "chart_data": {
    "demand_forecast_12m": [12 numbers],
    "competitor_market_share": [{"name":"x","share":number}]
  }
}`;

const currencySymbols: Record<string, string> = {
  us: '$', gb: '£', ca: 'CA$', au: 'AU$', de: '€', sg: 'S$',
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
  const sym = currencySymbols[country] || '$';
  const targetCurrency = country === 'us' ? 'USD' : country === 'gb' ? 'GBP' : country === 'ca' ? 'CAD' : country === 'au' ? 'AUD' : country === 'de' ? 'EUR' : country === 'sg' ? 'SGD' : country === 'sa' ? 'SAR' : country === 'ae' ? 'AED' : country === 'pk' ? 'PKR' : country === 'in' ? 'INR' : country === 'tr' ? 'TRY' : 'MYR';

  const localPrice = (usd: number) => {
    const converted = convertPrice(usd, targetCurrency, rates);
    return `${sym} ${converted.toLocaleString()}`;
  };

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  let m = '';

  // Professional Header
  m += `MARKETMUSE PRO\n`;
  m += `Real-Time Market Intelligence\n`;
  m += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  m += `Report ID: ${reportId}\n`;
  m += `Type: Product Research\n`;
  m += `Niche: ${niche}\n`;
  m += `Country: ${countryNames[country] || country}\n`;
  m += `Generated: ${today} at ${now}\n`;
  m += `Status: Confidential\n`;
  m += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // At a Glance
  m += `AT A GLANCE\n`;
  m += `────────────────────────────────────────────\n`;
  m += `Market Score: ${a.market_score}/100 ${scoreBar(a.market_score)}\n`;
  m += `Opportunity Level: ${a.opportunity_level || 'N/A'}\n`;
  if (a.financial_projections?.month6_profit_optimistic) {
    m += `Est. Monthly Profit Potential: ${localPrice(a.financial_projections.month6_profit_optimistic)}\n`;
  }
  m += `Time to Profitability: ${a.financial_projections?.estimated_months_to_profitability || 'N/A'} months\n\n`;

  // Key Findings
  if (a.key_findings?.length) {
    m += `KEY FINDINGS\n`;
    m += `────────────────────────────────────────────\n`;
    a.key_findings.forEach((f: string, i: number) => { m += `${i+1}. ${f}\n`; });
    m += `\n`;
  }

  // Quick Wins
  if (a.quick_wins?.length) {
    m += `QUICK WINS – Start Today\n`;
    m += `────────────────────────────────────────────\n`;
    a.quick_wins.forEach((w: string, i: number) => { m += `${i+1}. ${w}\n`; });
    m += `\n`;
  }

  // 1. Executive Summary
  m += `1. EXECUTIVE SUMMARY\n────────────────────────────────────────────\n${a.executive_summary}\n\n`;

  // 2. Product Pricing
  m += `2. PRODUCT PRICING ANALYSIS\n────────────────────────────────────────────\n`;
  m += `Source: Google Shopping (live data via SerpAPI) [1]\n\n`;
  m += `| # | Product | Price | Cost | Profit | Margin | Monthly Est. Revenue | Reviews |\n`;
  m += `|---|---------|-------|------|--------|--------|----------------------|--------|\n`;
  a.pricing_engine?.forEach((p: any, i: number) => {
    m += `| ${i+1} | ${p.title} | ${localPrice(p.selling_price_usd)} | ${localPrice(p.landed_cost_usd)} | ${localPrice(p.net_profit_usd)} | ${p.profit_margin_percent}% | ${localPrice(p.monthly_revenue_potential)} | ${p.reviews} |\n`;
  });
  m += `\n`;

  // 3. Competitors
  m += `3. COMPETITOR LANDSCAPE\n────────────────────────────────────────────\n`;
  a.competitor_deep_dive?.forEach((c: any) => {
    m += `${c.name} (${c.market_position})\n`;
    m += `  Est. Monthly Sales: ${localPrice(c.estimated_monthly_sales)}\n`;
    m += `  Avg Price Point: ${localPrice(c.avg_price_point)}\n`;
    m += `  Strengths: ${c.strengths?.join(', ')}\n`;
    m += `  Weaknesses: ${c.weaknesses?.join(', ')}\n`;
    m += `  Strategy: ${c.how_to_outcompete}\n\n`;
  });

  // 4. Market Gaps
  m += `4. MARKET OPPORTUNITIES\n────────────────────────────────────────────\n`;
  a.market_gaps?.forEach((g: any) => {
    m += `${g.gap_title}\n  ${g.description}\n  Revenue Potential: ${g.revenue_potential}\n  Difficulty: ${g.difficulty}\n  First Step: ${g.first_step}\n\n`;
  });

  // 5. Customer Personas
  m += `5. TARGET CUSTOMER PROFILES\n────────────────────────────────────────────\n`;
  a.customer_personas?.forEach((p: any) => {
    m += `${p.name} | ${p.age_range} | ${p.income_level}\n  Problem: ${p.core_problem}\n  Trigger: ${p.buying_trigger}\n  Channels: ${p.where_they_hang_out?.join(', ')}\n  Ad Copy: "${p.marketing_message}"\n\n`;
  });

  // 6. Success Accelerators
  if (a.success_accelerators?.length) {
    m += `6. SUCCESS ACCELERATORS\n────────────────────────────────────────────\n`;
    a.success_accelerators.forEach((tip: string, i: number) => { m += `${i+1}. ${tip}\n`; });
    m += `\n`;
  }

  // 7. Launch Playbook
  m += `7. 12-WEEK LAUNCH PLAYBOOK\n────────────────────────────────────────────\n`;
  a.launch_playbook?.forEach((w: any) => {
    m += `Week ${w.week}: ${w.theme}\n`;
    w.tasks?.forEach((t: string) => { m += `  - ${t}\n`; });
    m += `  Metric: ${w.success_metric}\n\n`;
  });

  // 8. Financials
  const fp = a.financial_projections;
  m += `8. FINANCIAL PROJECTIONS\n────────────────────────────────────────────\n`;
  m += `Startup Cost: ${localPrice(fp?.startup_cost_estimate)}\n`;
  m += `Monthly Fixed Costs: ${localPrice(fp?.monthly_fixed_costs)}\n`;
  m += `Avg Profit Per Unit: ${localPrice(fp?.avg_profit_per_unit)}\n`;
  m += `Units to Breakeven: ${fp?.units_to_breakeven}\n`;
  m += `Time to Profitability: ${fp?.estimated_months_to_profitability} months\n`;
  m += `Month 6 Profit (Conservative): ${localPrice(fp?.month6_profit_conservative)}\n`;
  m += `Month 6 Profit (Optimistic): ${localPrice(fp?.month6_profit_optimistic)}\n\n`;

  // 9. Risks
  m += `9. RISK ASSESSMENT\n────────────────────────────────────────────\n`;
  a.risk_radar?.forEach((r: any) => { m += `Risk: ${r.risk}\n  Probability: ${r.probability} | Impact: ${r.impact}\n  Mitigation: ${r.mitigation}\n\n`; });

  // Related Resources
  if (a.related_resources?.length) {
    m += `RELATED RESOURCES & LINKS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    a.related_resources.forEach((res: any, i: number) => { m += `${i+1}. ${res.name} – ${res.url}\n`; });
    m += `\n`;
  }

  // Data Verification Links
  m += `DATA VERIFICATION LINKS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  m += `[1] Google Shopping – https://shopping.google.com\n`;
  m += `[2] Google Keyword Planner – https://ads.google.com/keyword-planner\n`;
  m += `[3] Google Trends – https://trends.google.com\n`;
  m += `[4] Exchange Rates – https://exchangerate-api.com\n`;
  m += `[5] AI Model – GPT-4o by OpenAI (https://openai.com)\n\n`;

  // Final Word
  const oppLevel = a.opportunity_level || 'high';
  m += `FINAL WORD\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  if (oppLevel === 'High') m += `This market shows exceptional promise. The data indicates a clear path to profitability within months. Execute the playbook with precision and you can capture a significant share of this growing demand.\n`;
  else if (oppLevel === 'Moderate') m += `A solid opportunity with manageable competition. Focus on the gaps identified and differentiate your offer to build a sustainable business. Consistent effort will yield results.\n`;
  else m += `While the market is competitive, the strategies outlined above provide a clear path to enter and succeed. Focus on niche positioning and superior execution.\n`;
  m += `\n`;
  m += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  m += `MarketMuse PRO — Confidential Report\n`;
  m += `© All Rights Reserved\n`;

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

    if (!shoppingData) throw new Error('Failed to fetch shopping data.');

    const items = shoppingData.shopping_results?.slice(0, 8).map((p: any) => ({
      title: p.title, price: p.extracted_price || p.price, source: p.source,
      reviews: p.rating || 0, image: p.thumbnail || ''
    })) || [];

    const seedKw = keywordMetrics?.data?.[0];
    const marketData = {
      seedKeyword: seedKw ? { keyword: seedKw.keyword, volume: seedKw.vol, cpc: seedKw.cpc?.value } : null,
      trends: trendsArr || null,
    };

    const userMsg = `Niche: ${niche}\nCountry: ${country}\nExchange Rates: ${JSON.stringify(fx)}\nShopping Results: ${JSON.stringify(items)}\nMarket Data: ${JSON.stringify(marketData)}\nTrends: ${trendsArr ? JSON.stringify(trendsArr) : 'N/A'}\n\nProvide complete JSON with specific, data-backed insights, quick wins, related resources, and success accelerators.`;

    const ai = await runGroqWithRetry(PROMPT, userMsg);
    const analysis = extractJSON(ai);

    if (trendsArr && Array.isArray(trendsArr)) {
      analysis.chart_data = analysis.chart_data || {};
      analysis.chart_data.demand_forecast_12m = trendsArr;
    }

    const report = await Report.create({
      type: 'product', niche, country, value: '$99',
      data: analysis, markdown: '', charts: {}
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
