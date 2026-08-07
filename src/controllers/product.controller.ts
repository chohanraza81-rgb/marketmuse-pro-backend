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

const PROMPT = `You are a world‑class e‑commerce product strategist. Analyze real shopping data, keyword metrics, exchange rates, and trends. Return ONLY valid JSON.

{
  "market_score": number (0-100),
  "market_verdict": "Hot Buy 🔥" | "Stable Earner 💰" | "Risky ⚠️" | "Avoid 🚫",
  "executive_summary": "3 detailed sentences",
  "pricing_engine": [
    {
      "title": "actual product name",
      "image_url": "from data",
      "selling_price_usd": number,
      "landed_cost_usd": number,
      "net_profit_usd": number,
      "profit_margin_percent": number,
      "monthly_units_potential": number,
      "monthly_revenue_potential": number,
      "monthly_profit_potential": number,
      "reviews": number,
      "rating": number (1-5),
      "source": "store name",
      "competitive_advantage": "why this wins"
    }
  ] (12 items, sorted by profit),
  "competitor_deep_dive": [
    {
      "name": "brand",
      "market_position": "Leader/Challenger/Niche/New",
      "estimated_monthly_sales": number,
      "avg_price_point": number,
      "strengths": ["s1","s2","s3"],
      "weaknesses": ["w1","w2","w3"],
      "their_best_seller": "product",
      "customer_complaints": ["c1","c2"],
      "how_to_outcompete": "strategy"
    }
  ] (6 competitors),
  "market_gaps": [
    {
      "gap_title": "title",
      "description": "detailed",
      "potential_revenue_impact": "$5k-10k/mo or $10k-25k/mo or $25k+/mo",
      "difficulty": "Easy/Moderate/Hard",
      "first_step": "action",
      "icon": "emoji"
    }
  ] (3 gaps),
  "customer_personas": [
    {
      "name": "name",
      "avatar": "emoji",
      "age_range": "25-34",
      "income_level": "$40k-60k",
      "location_hint": "urban",
      "core_problem": "pain",
      "buying_trigger": "trigger",
      "where_they_hang_out": ["p1","p2","p3"],
      "marketing_message": "ad copy"
    }
  ] (3 personas),
  "launch_playbook": [
    {
      "week": 1-12,
      "theme": "Foundation/Sourcing/Branding/Launch/Optimization/Scale",
      "tasks": ["t1","t2","t3"],
      "success_metric": "metric"
    }
  ] (12 weeks),
  "financial_projections": {
    "startup_cost_estimate": number,
    "monthly_fixed_costs": number,
    "avg_profit_per_unit": number,
    "units_to_breakeven": number,
    "estimated_months_to_profitability": number,
    "conservative_monthly_profit_month6": number,
    "optimistic_monthly_profit_month6": number
  },
  "risk_radar": [
    {
      "risk": "risk",
      "probability": "Low/Medium/High",
      "impact": "Low/Medium/High",
      "mitigation": "action"
    }
  ] (5 risks),
  "chart_data": {
    "demand_forecast_12m": [12 numbers],
    "competitor_market_share": [{"name":"x","share":number}],
    "profit_margin_by_product": [{"name":"x","margin":number}]
  }
}`;

// Currency symbols
const currencySymbols: Record<string, string> = {
  us: '$', gb: '£', ca: 'CA$', au: 'AU$', de: '€', sg: 'S$',
  sa: '﷼', ae: 'د.إ', pk: '₨', in: '₹', tr: '₺', my: 'RM',
};

function generateMarkdown(a: any, niche: string, country: string, rates: any): string {
  const flags: Record<string, string> = {
    us: '🇺🇸', gb: '🇬🇧', ca: '🇨🇦', au: '🇦🇺', de: '🇩🇪', sg: '🇸🇬',
    sa: '🇸🇦', ae: '🇦🇪', pk: '🇵🇰', in: '🇮🇳', tr: '🇹🇷', my: '🇲🇾',
  };
  const names: Record<string, string> = {
    us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
    de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'UAE',
    pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
  };
  const sym = currencySymbols[country] || '$';
  const targetCurrency = country === 'us' ? 'USD' : country === 'gb' ? 'GBP' : country === 'ca' ? 'CAD' : country === 'au' ? 'AUD' : country === 'de' ? 'EUR' : country === 'sg' ? 'SGD' : country === 'sa' ? 'SAR' : country === 'ae' ? 'AED' : country === 'pk' ? 'PKR' : country === 'in' ? 'INR' : country === 'tr' ? 'TRY' : 'MYR';

  const localPrice = (usd: number) => {
    const converted = convertPrice(usd, targetCurrency, rates);
    return `${sym}${converted.toLocaleString()}`;
  };

  let m = `# 🚀 Product Research: ${niche}\n## 📍 Target Market: ${flags[country]} ${names[country]}\n\n`;
  m += `> ${a.executive_summary}\n\n`;
  m += `## 📊 Market Score: **${a.market_score}/100** — ${a.market_verdict}\n\n`;

  // Pricing Engine with local currency
  m += `## 💰 Product Pricing Analysis\n\n`;
  m += `| # | Product | Price | Cost | Profit | Margin | Monthly Est. | Reviews |\n`;
  m += `|---|---------|-------|------|--------|--------|-------------|--------|\n`;
  a.pricing_engine?.forEach((p: any, i: number) => {
    m += `| ${i+1} | ${p.title} | ${localPrice(p.selling_price_usd)} | ${localPrice(p.landed_cost_usd)} | ${localPrice(p.net_profit_usd)} | ${p.profit_margin_percent}% | ${localPrice(p.monthly_revenue_potential)} | ${p.reviews}⭐ |\n`;
  });

  // Competitors
  m += `\n## 🏆 Competitor Deep Dive\n\n`;
  a.competitor_deep_dive?.forEach((c: any) => {
    m += `### ${c.name} (${c.market_position})\n`;
    m += `- **Est. Monthly Sales:** ${localPrice(c.estimated_monthly_sales)}\n`;
    m += `- **Avg Price Point:** ${localPrice(c.avg_price_point)}\n`;
    m += `- ✅ **Strengths:** ${c.strengths?.join(', ')}\n`;
    m += `- ❌ **Weaknesses:** ${c.weaknesses?.join(', ')}\n`;
    m += `- 🏷️ **Best Seller:** ${c.their_best_seller}\n`;
    m += `- 😤 **Complaints:** ${c.customer_complaints?.join(', ')}\n`;
    m += `- 🎯 **How to Beat:** ${c.how_to_outcompete}\n\n`;
  });

  // Market Gaps
  m += `## 🎯 Market Gaps & Opportunities\n\n`;
  a.market_gaps?.forEach((g: any) => {
    m += `### ${g.icon} ${g.gap_title}\n`;
    m += `${g.description}\n`;
    m += `- 💵 **Revenue Potential:** ${g.potential_revenue_impact}\n`;
    m += `- ⚡ **Difficulty:** ${g.difficulty}\n`;
    m += `- 🚀 **First Step:** ${g.first_step}\n\n`;
  });

  // Personas
  m += `## 👥 Target Customer Personas\n\n`;
  a.customer_personas?.forEach((p: any) => {
    m += `### ${p.avatar} ${p.name}\n`;
    m += `- ${p.age_range} | ${p.income_level} | ${p.location_hint}\n`;
    m += `- **Problem:** ${p.core_problem}\n`;
    m += `- **Trigger:** ${p.buying_trigger}\n`;
    m += `- **Channels:** ${p.where_they_hang_out?.join(', ')}\n`;
    m += `- 📢 **Ad Copy:** "${p.marketing_message}"\n\n`;
  });

  // Launch Playbook
  m += `## 📅 12-Week Launch Playbook\n\n`;
  a.launch_playbook?.forEach((w: any) => {
    m += `### Week ${w.week}: ${w.theme}\n`;
    w.tasks?.forEach((t: string) => { m += `- ${t}\n`; });
    m += `- 📏 **Success Metric:** ${w.success_metric}\n\n`;
  });

  // Financials with local currency
  const fp = a.financial_projections;
  m += `## 💸 Financial Projections\n\n`;
  m += `| Metric | Value |\n`;
  m += `|--------|-------|\n`;
  m += `| Startup Cost | ${localPrice(fp?.startup_cost_estimate)} |\n`;
  m += `| Monthly Fixed Costs | ${localPrice(fp?.monthly_fixed_costs)} |\n`;
  m += `| Avg Profit Per Unit | ${localPrice(fp?.avg_profit_per_unit)} |\n`;
  m += `| Units to Breakeven | ${fp?.units_to_breakeven} |\n`;
  m += `| Time to Profitability | ${fp?.estimated_months_to_profitability} months |\n`;
  m += `| Month 6 Profit (Conservative) | ${localPrice(fp?.conservative_monthly_profit_month6)} |\n`;
  m += `| Month 6 Profit (Optimistic) | ${localPrice(fp?.optimistic_monthly_profit_month6)} |\n\n`;

  // Risks
  m += `## ⚠️ Risk Assessment\n\n`;
  m += `| Risk | Probability | Impact | Mitigation |\n`;
  m += `|------|------------|--------|------------|\n`;
  a.risk_radar?.forEach((r: any) => {
    m += `| ${r.risk} | ${r.probability} | ${r.impact} | ${r.mitigation} |\n`;
  });

  m += `\n---\n*Powered by MarketMuse PRO — Real-time Market Intelligence*`;
  return m;
}

export const createProductReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = productResearchSchema.parse(req.body);
    const ck = `prod_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    console.log(`🔍 Product: "${niche}" in ${country}`);

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
      seedKeyword: seedKw ? { keyword: seedKw.keyword, volume: seedKw.vol, cpc: seedKw.cpc?.value, competition: seedKw.competition } : null,
      trends: trendsArr || null,
    };

    const userMsg = `Niche: ${niche}\nCountry: ${country}\nExchange Rates: ${JSON.stringify(fx)}\nShopping Results: ${JSON.stringify(items)}\nMarket Data: ${JSON.stringify(marketData)}\nTrends: ${trendsArr ? JSON.stringify(trendsArr) : 'N/A'}\n\nProvide complete JSON analysis.`;

    const ai = await runGroqWithRetry(PROMPT, userMsg);
    const analysis = extractJSON(ai);

    if (trendsArr && Array.isArray(trendsArr)) {
      analysis.chart_data = analysis.chart_data || {};
      analysis.chart_data.demand_forecast_12m = trendsArr;
    }

    const markdown = generateMarkdown(analysis, niche, country, fx);
    const report = await Report.create({
      type: 'product', niche, country, value: '$99',
      data: analysis, markdown, charts: { trends: trendsArr, fx }
    });

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
