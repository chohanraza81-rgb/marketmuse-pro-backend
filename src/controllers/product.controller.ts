import { Request, Response, NextFunction } from 'express';
import { productResearchSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getShoppingResults } from '../services/serpapi';
import { getTrends, getKeywordMetrics } from '../services/keywordseverywhere';
import { getExchangeRates } from '../services/exchange';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

// GPT‑4o with json_object mode always returns clean JSON – simple extraction
const extractJSON = (raw: string): any => {
  let c = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = c.indexOf('{'), e = c.lastIndexOf('}');
  if (s !== -1 && e !== -1 && e > s) c = c.substring(s, e + 1);
  return JSON.parse(c);
};

const PROMPT = `You are a world‑class e‑commerce product strategist. Analyze the provided real shopping data, keyword metrics (volume, CPC), exchange rates, and 12‑month trend values. Return ONLY valid JSON.

{
  "market_score": number (0-100, based on demand trends and competition),
  "market_verdict": "Hot Buy 🔥" | "Stable Earner 💰" | "Risky ⚠️" | "Avoid 🚫",
  "executive_summary": "3 detailed sentences covering opportunity size, target customer, and competitive edge",
  "pricing_engine": [
    {
      "title": "actual product from shopping data",
      "image_url": "from data if available",
      "selling_price_usd": number,
      "landed_cost_usd": number,
      "net_profit_usd": number,
      "profit_margin_percent": number,
      "monthly_units_potential": number,
      "monthly_revenue_potential": number,
      "monthly_profit_potential": number,
      "reviews": number,
      "rating": number (1-5),
      "source": "Amazon/Walmart/etc.",
      "competitive_advantage": "why this product wins"
    }
  ] (exactly 12 items, sorted by profit potential),
  "competitor_deep_dive": [
    {
      "name": "real brand/store",
      "market_position": "Market Leader/Challenger/Niche/New",
      "estimated_monthly_sales": number,
      "avg_price_point": number,
      "strengths": ["specific","specific","specific"],
      "weaknesses": ["specific","specific","specific"],
      "their_best_seller": "product name",
      "customer_complaints": ["complaint","complaint"],
      "how_to_outcompete": "specific strategy"
    }
  ] (6 real competitors),
  "market_gaps": [
    {
      "gap_title": "title",
      "description": "detailed paragraph",
      "potential_revenue_impact": "$5k-10k/mo or $10k-25k/mo or $25k+/mo",
      "difficulty": "Easy/Moderate/Hard",
      "first_step": "concrete action",
      "icon": "emoji"
    }
  ] (3 gaps),
  "customer_personas": [
    {
      "name": "name",
      "avatar": "emoji",
      "age_range": "25-34",
      "income_level": "$40k-60k",
      "location_hint": "urban US",
      "core_problem": "what keeps them up at night",
      "buying_trigger": "what makes them buy NOW",
      "where_they_hang_out": ["platform","platform","platform"],
      "marketing_message": "exact ad copy that converts them"
    }
  ] (3 personas),
  "launch_playbook": [
    {
      "week": 1-12,
      "theme": "Foundation/Sourcing/Branding/Launch/Optimization/Scale",
      "tasks": ["specific","specific","specific"],
      "success_metric": "what defines success this week"
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
      "risk": "specific risk",
      "probability": "Low/Medium/High",
      "impact": "Low/Medium/High",
      "mitigation": "specific action"
    }
  ] (5 risks),
  "chart_data": {
    "demand_forecast_12m": [12 numbers based on real trend data],
    "competitor_market_share": [{"name":"x","share":number}],
    "profit_margin_by_product": [{"name":"x","margin":number}]
  }
}`;

// Markdown generator – always returns a string
function generateMarkdown(a: any, niche: string, country: string): string {
  const flags: Record<string, string> = {
    us: '🇺🇸', gb: '🇬🇧', ca: '🇨🇦', au: '🇦🇺', de: '🇩🇪', sg: '🇸🇬',
    sa: '🇸🇦', ae: '🇦🇪', pk: '🇵🇰', in: '🇮🇳', tr: '🇹🇷', my: '🇲🇾'
  };
  const names: Record<string, string> = {
    us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
    de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'UAE',
    pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia'
  };

  let m = `# 🚀 Product Research: ${niche}\n## Target: ${flags[country]} ${names[country]}\n\n`;
  m += `## 📊 Market Score: **${a.market_score}/100** — ${a.market_verdict}\n\n${a.executive_summary}\n\n`;

  m += `## 💰 12-Product Pricing Engine\n| # | Product | Sell | Cost | Profit | Margin | Mo. Revenue | Reviews | Edge |\n|---|---------|------|------|--------|--------|------------|---------|------|\n`;
  a.pricing_engine?.forEach((p: any, i: number) => {
    m += `| ${i+1} | ${p.title} | $${p.selling_price_usd} | $${p.landed_cost_usd} | $${p.net_profit_usd} | ${p.profit_margin_percent}% | $${p.monthly_revenue_potential?.toLocaleString()} | ${p.reviews}⭐ | ${p.competitive_advantage} |\n`;
  });

  m += `\n## 🏆 6 Competitor Deep Dives\n`;
  a.competitor_deep_dive?.forEach((c: any) => {
    m += `### ${c.name} (${c.market_position})\n- Sales: $${c.estimated_monthly_sales?.toLocaleString()}/mo | Price: $${c.avg_price_point}\n- ✅ ${c.strengths?.join(', ')}\n- ❌ ${c.weaknesses?.join(', ')}\n- 🏷️ Best Seller: ${c.their_best_seller}\n- 😤 Complaints: ${c.customer_complaints?.join(', ')}\n- 🎯 Beat Them: ${c.how_to_outcompete}\n\n`;
  });

  m += `## 🎯 Market Gaps\n`;
  a.market_gaps?.forEach((g: any) => {
    m += `### ${g.icon} ${g.gap_title}\n${g.description}\n- 💵 Revenue: ${g.potential_revenue_impact} | Difficulty: ${g.difficulty}\n- ⚡ First Step: ${g.first_step}\n\n`;
  });

  m += `## 👥 Customer Personas\n`;
  a.customer_personas?.forEach((p: any) => {
    m += `### ${p.avatar} ${p.name}\n- ${p.age_range} | ${p.income_level} | ${p.location_hint}\n- Problem: ${p.core_problem}\n- Trigger: ${p.buying_trigger}\n- Hangouts: ${p.where_they_hang_out?.join(', ')}\n- 📢 Ad: "${p.marketing_message}"\n\n`;
  });

  m += `## 📅 12-Week Launch Playbook\n`;
  a.launch_playbook?.forEach((w: any) => {
    m += `### Week ${w.week}: ${w.theme}\n${w.tasks?.map((t: string) => `- ${t}`).join('\n')}\n- 📏 Success: ${w.success_metric}\n\n`;
  });

  const fp = a.financial_projections;
  m += `## 💸 Financials\n- Startup: $${fp?.startup_cost_estimate?.toLocaleString()} | Fixed: $${fp?.monthly_fixed_costs?.toLocaleString()}/mo\n- Profit/Unit: $${fp?.avg_profit_per_unit} | Breakeven: ${fp?.units_to_breakeven} units\n- Profitable in: ${fp?.estimated_months_to_profitability}mo\n- Month 6 Profit: $${fp?.conservative_monthly_profit_month6?.toLocaleString()} (conservative) | $${fp?.optimistic_monthly_profit_month6?.toLocaleString()} (optimistic)\n\n`;

  m += `## ⚠️ Risk Radar\n| Risk | Prob | Impact | Mitigation |\n|------|------|--------|------------|\n`;
  a.risk_radar?.forEach((r: any) => {
    m += `| ${r.risk} | ${r.probability} | ${r.impact} | ${r.mitigation} |\n`;
  });

  m += `\n---\n*MarketMuse AI PRO MAX ULTRA – $99 Report*`;
  return m;
}

export const createProductReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = productResearchSchema.parse(req.body);
    const ck = `prod_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    console.log(`🔍 Product: "${niche}" in ${country}`);

    // Real data: shopping, exchange, trends, keyword metrics
    const [shoppingData, fx, trendsArr, keywordMetrics] = await Promise.all([
      getShoppingResults(niche, country).catch(() => null),
      getExchangeRates(),
      getTrends(niche, country).catch(() => null),
      getKeywordMetrics([niche], country).catch(() => null),
    ]);

    if (!shoppingData) throw new Error('Failed to fetch shopping data. Please try again later.');

    const items = shoppingData.shopping_results?.slice(0, 8).map((p: any) => ({
      title: p.title, price: p.extracted_price || p.price, source: p.source,
      reviews: p.rating || 0, image: p.thumbnail || ''
    })) || [];

    const seedKw = keywordMetrics?.data?.[0];
    const marketData = {
      seedKeyword: seedKw ? { keyword: seedKw.keyword, volume: seedKw.vol, cpc: seedKw.cpc?.value, competition: seedKw.competition } : null,
      trends: trendsArr || null,
    };

    const userMsg = `Niche: ${niche}\nCountry: ${country}\nExchange Rates: ${JSON.stringify(fx)}\nReal Shopping Results: ${JSON.stringify(items)}\nMarket Keyword Data: ${JSON.stringify(marketData)}\n12-Month Trend: ${trendsArr ? JSON.stringify(trendsArr) : 'Not available'}\n\nProvide a complete, hyper‑detailed JSON analysis. Use real numbers and specific insights.`;

    const ai = await runGroqWithRetry(PROMPT, userMsg);
    const analysis = extractJSON(ai);

    if (trendsArr && Array.isArray(trendsArr)) {
      analysis.chart_data = analysis.chart_data || {};
      analysis.chart_data.demand_forecast_12m = trendsArr;
    }

    const markdown = generateMarkdown(analysis, niche, country);
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
