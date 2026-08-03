import { Request, Response, NextFunction } from 'express';
import { productResearchSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getShoppingResults } from '../services/serpapi';
import { getTrends } from '../services/trends';
import { getExchangeRates } from '../services/exchange';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const PRODUCT_PROMPT = `You are a top e-commerce product strategist. Analyze real shopping data, trends, and exchange rates. Return ONLY valid JSON.

{
  "market_score": number (0-100, based on demand vs competition),
  "market_verdict": string (one powerful sentence: "Hot Buy 🔥", "Stable Earner 💰", "Risky ⚠️", or "Avoid 🚫"),
  "executive_summary": string (3 sentences: opportunity size, target customer, key advantage),
  "pricing_engine": [
    {
      "title": string (actual product title from data),
      "image_url": string (from data if available),
      "selling_price_usd": number,
      "landed_cost_usd": number (30-60% of price),
      "net_profit_usd": number,
      "profit_margin_percent": number,
      "monthly_units_potential": number (realistic estimate),
      "monthly_revenue_potential": number,
      "monthly_profit_potential": number,
      "reviews": number,
      "rating": number (1-5),
      "source": string ("Amazon", "Walmart", "Etsy", etc.),
      "competitive_advantage": string (why this product can win)
    }
  ] (exactly 12 products, sorted by profit potential descending),
  "competitor_deep_dive": [
    {
      "name": string (actual brand/store from data or known player),
      "market_position": string ("Market Leader", "Challenger", "Niche Player", "New Entrant"),
      "estimated_monthly_sales": number,
      "avg_price_point": number,
      "strengths": [string, string, string],
      "weaknesses": [string, string, string],
      "their_best_seller": string,
      "customer_complaints": [string] (from reviews analysis),
      "how_to_outcompete": string (specific strategy)
    }
  ] (exactly 6 real competitors),
  "market_gaps": [
    {
      "gap_title": string,
      "description": string (specific, actionable),
      "potential_revenue_impact": string ("$5k-10k/mo", "$10k-25k/mo", "$25k+/mo"),
      "difficulty_to_capture": string ("Easy", "Moderate", "Hard"),
      "first_step": string (concrete action to capture this gap),
      "icon": string (emoji)
    }
  ] (exactly 3),
  "customer_personas": [
    {
      "name": string,
      "avatar": string (emoji),
      "age_range": string,
      "income_level": string,
      "location_hint": string,
      "core_problem": string,
      "buying_trigger": string,
      "where_they_hang_out": [string, string, string],
      "marketing_message": string (exact ad copy that would convert them)
    }
  ] (exactly 3),
  "launch_playbook": [
    {
      "week": number (1-12),
      "theme": string ("Foundation", "Sourcing", "Branding", "Launch Prep", "Go Live", "Optimization"),
      "tasks": [string, string, string] (3 specific, niche-related tasks per week),
      "success_metric": string (what defines success this week)
    }
  ] (exactly 12 weeks, each week has 3 concrete tasks),
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
      "risk": string,
      "probability": string ("Low", "Medium", "High"),
      "impact": string ("Low", "Medium", "High"),
      "mitigation": string
    }
  ] (5 risks),
  "chart_data": {
    "demand_forecast_12m": number[] (12 values based on trends),
    "competitor_market_share": [{"name":string,"share":number}] (sums to 100),
    "profit_margin_by_product": [{"name":string,"margin":number}] (top 8 products)
  }
}`;

function generateMarkdown(a: any, niche: string, country: string): string {
  const flags: Record<string, string> = { us: '🇺🇸', pk: '🇵🇰', gb: '🇬🇧', ae: '🇦🇪', sa: '🇸🇦' };
  const names: Record<string, string> = { us: 'United States', pk: 'Pakistan', gb: 'United Kingdom', ae: 'UAE', sa: 'Saudi Arabia' };
  
  let m = `# 🚀 Product Research: ${niche}\n## Target Market: ${flags[country]} ${names[country]}\n\n`;
  m += `## 📊 Market Score: **${a.market_score}/100** — ${a.market_verdict}\n\n${a.executive_summary}\n\n`;
  
  m += `## 💰 12-Product Pricing Engine\n| # | Product | Sell Price | Cost | Profit | Margin | Monthly Potential | Reviews |\n|---|---------|-----------|------|--------|--------|-------------------|--------|\n`;
  a.pricing_engine?.forEach((p: any, i: number) => {
    m += `| ${i+1} | ${p.title} | $${p.selling_price_usd} | $${p.landed_cost_usd} | $${p.net_profit_usd} | ${p.profit_margin_percent}% | $${p.monthly_revenue_potential?.toLocaleString()} | ${p.reviews}⭐ |\n`;
  });
  
  m += `\n## 🏆 6 Competitor Deep Dive\n`;
  a.competitor_deep_dive?.forEach((c: any) => {
    m += `### ${c.name} (${c.market_position})\n- Est. Monthly Sales: $${c.estimated_monthly_sales?.toLocaleString()}\n- Avg Price: $${c.avg_price_point}\n- ✅ Strengths: ${c.strengths?.join(', ')}\n- ❌ Weaknesses: ${c.weaknesses?.join(', ')}\n- 🏷️ Best Seller: ${c.their_best_seller}\n- 😤 Complaints: ${c.customer_complaints?.join(', ')}\n- 🎯 How to Beat: ${c.how_to_outcompete}\n\n`;
  });
  
  m += `## 🎯 3 Market Gaps\n`;
  a.market_gaps?.forEach((g: any) => {
    m += `### ${g.icon} ${g.gap_title}\n${g.description}\n- Revenue: ${g.potential_revenue_impact}\n- Difficulty: ${g.difficulty_to_capture}\n- First Step: ${g.first_step}\n\n`;
  });
  
  m += `## 👥 Customer Personas\n`;
  a.customer_personas?.forEach((p: any) => {
    m += `### ${p.avatar} ${p.name}\n- ${p.age_range} | ${p.income_level} | ${p.location_hint}\n- Problem: ${p.core_problem}\n- Trigger: ${p.buying_trigger}\n- Hangouts: ${p.where_they_hang_out?.join(', ')}\n- 📢 Ad Copy: "${p.marketing_message}"\n\n`;
  });
  
  m += `## 📅 12-Week Launch Playbook\n`;
  a.launch_playbook?.forEach((w: any) => {
    m += `### Week ${w.week}: ${w.theme}\n${w.tasks?.map((t: string, i: number) => `- Day ${i*2+1}: ${t}`).join('\n')}\n- 📏 Success Metric: ${w.success_metric}\n\n`;
  });
  
  m += `## 💸 Financial Projections\n- Startup Cost: $${a.financial_projections?.startup_cost_estimate?.toLocaleString()}\n- Monthly Fixed Costs: $${a.financial_projections?.monthly_fixed_costs?.toLocaleString()}\n- Avg Profit/Unit: $${a.financial_projections?.avg_profit_per_unit}\n- Units to Breakeven: ${a.financial_projections?.units_to_breakeven}\n- Time to Profit: ${a.financial_projections?.estimated_months_to_profitability} months\n- Month 6 Profit (Conservative): $${a.financial_projections?.conservative_monthly_profit_month6?.toLocaleString()}\n- Month 6 Profit (Optimistic): $${a.financial_projections?.optimistic_monthly_profit_month6?.toLocaleString()}\n\n`;
  
  m += `## ⚠️ Risk Radar\n| Risk | Probability | Impact | Mitigation |\n|------|------------|--------|------------|\n`;
  a.risk_radar?.forEach((r: any) => m += `| ${r.risk} | ${r.probability} | ${r.impact} | ${r.mitigation} |\n`);
  
  m += `\n---\n*MarketMuse AI PRO MAX ULTRA – $99 Report*`;
  return m;
}

export const createProductReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = productResearchSchema.parse(req.body);
    const cKey = `product_${niche}_${country}`;
    const cached = cacheService.get(cKey);
    if (cached) return res.json(cached);

    console.log(`🔍 Product: "${niche}" in ${country}`);
    const [shop, trends, fx] = await Promise.all([
      getShoppingResults(niche, country),
      getTrends(niche, country.toUpperCase()),
      getExchangeRates(),
    ]);

    const items = (shop as any).shopping_results?.slice(0, 8).map((p: any) => ({
      title: p.title, price: p.extracted_price || p.price, source: p.source,
      reviews: p.rating || 0, image: p.thumbnail || ''
    })) || [];

    const userMsg = `Niche: ${niche}\nCountry: ${country}\nExchange: ${JSON.stringify(fx)}\n\nProducts:\n${JSON.stringify(items)}\n\nTrends:\n${JSON.stringify(trends.slice(0,6))}`;

    const ai = await runGroqWithRetry(PRODUCT_PROMPT, userMsg);
    const analysis = JSON.parse(ai);
    const markdown = generateMarkdown(analysis, niche, country);

    const report = await Report.create({
      type: 'product', niche, country, value: '$99',
      data: analysis, markdown, charts: { trends, fx }
    });

    const result = { id: report._id, ...report.toObject() };
    cacheService.set(cKey, result, 86400);
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
};

export const getProductReport = async (req: Request, res: Response, next: NextFunction) => {
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  res.json(report);
};
