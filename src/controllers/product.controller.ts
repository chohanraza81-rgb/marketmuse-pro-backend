import { Request, Response, NextFunction } from 'express';
import { productResearchSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getShoppingResults } from '../services/serpapi';
import { getTrends } from '../services/trends';
import { getExchangeRates } from '../services/exchange';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

// Bulletproof JSON extraction
const extractJSON = (raw: string): any => {
  let cleaned = raw.replace(/```json|```/g, '').trim();
  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    cleaned = cleaned.substring(startIdx, endIdx + 1);
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('❌ extractJSON failed. Cleaned string:', cleaned.substring(0, 300));
    throw new Error('AI response is not valid JSON');
  }
};

const PRODUCT_SYSTEM_PROMPT = `You are a senior e‑commerce product strategist at a top‑tier agency. 
Given a niche, country, real shopping results, and Google Trends data, produce a detailed, actionable JSON analysis.

Use the provided real data to extract genuine product titles, prices, and competitor names. **Do not invent vague names** – refer to actual stores/sources from the data.

Respond ONLY with a valid JSON object (no markdown, no code fences) exactly following this structure:

{
  "market_score": number (0–100, realistic, justified by demand vs competition),
  "market_summary": string (2-3 sentences summarizing opportunity, target audience, and key insight),
  "pricing_engine": [
    {
      "title": string (exact product name from the shopping data),
      "image": string (URL from the data, if available),
      "price": number (in USD),
      "estimated_cost": number (realistic landed cost, typically 30-60% of price),
      "estimated_profit": number (price - estimated_cost),
      "profit_margin_percent": number,
      "reviews": number,
      "rating": number (1-5),
      "source": string (store name, e.g., "Amazon", "Walmart")
    }
  ] (exactly 10 products, sorted by profit margin descending),
  "competitors": [
    {
      "name": string (actual competitor brand/store from data or known players),
      "market_share_estimate": string (e.g., "High", "Medium", "Low"),
      "strengths": [string, string],
      "weaknesses": [string, string],
      "pricing_strategy": string,
      "target_audience": string
    }
  ] (5-7 detailed competitors),
  "market_gaps": [
    {
      "insight": string (specific, actionable gap with a concrete suggestion),
      "icon": string (relevant emoji)
    }
  ] (exactly 3),
  "personas": [
    {
      "name": string,
      "avatar": string (emoji),
      "demographics": string (age, income, location),
      "goals": string,
      "pain_points": string,
      "buying_triggers": string,
      "preferred_channels": [string, string]
    }
  ] (exactly 3),
  "launch_plan": [
    {
      "day": number (1-30),
      "task": string (specific, niche‑related action, e.g., "Source 3 suppliers on Alibaba for bamboo toothbrushes"),
      "category": string (e.g., "Sourcing", "Marketing", "Content", "Operations")
    }
  ] (exactly 30 items, covering sourcing, branding, listing optimization, ads, influencer outreach, etc.),
  "profit_forecast": {
    "monthly_revenue_estimate": number,
    "monthly_profit_estimate": number,
    "break_even_months": number,
    "assumptions": string
  },
  "risks": [string] (3-5 specific risks with mitigation tips),
  "chart_data": {
    "demand_forecast": number[] (12 monthly trend values 0-100 based on Google Trends),
    "competitor_market_share": [
      { "name": string, "value": number }
    ] (sum to 100)
  }
}`;

function generateProductMarkdown(analysis: any, niche: string, country: string): string {
  const countryNames: Record<string, string> = {
    us: 'United States 🇺🇸',
    pk: 'Pakistan 🇵🇰',
    gb: 'United Kingdom 🇬🇧',
    ae: 'United Arab Emirates 🇦🇪',
    sa: 'Saudi Arabia 🇸🇦',
  };

  return `# 🚀 Product Research Report: ${niche}
## Target Market: ${countryNames[country] || country.toUpperCase()}

---

## 📊 Market Score: **${analysis.market_score}/100**

${analysis.market_score >= 80 ? '🔥 **HIGH POTENTIAL** - This niche shows strong signals for profitability.' : 
  analysis.market_score >= 60 ? '📈 **MODERATE POTENTIAL** - Good opportunity with manageable competition.' : 
  '⚠️ **CAUTIOUS** - High competition or low demand detected.'}

---

## 💰 Pricing Engine
${analysis.pricing_engine?.map((p: any, i: number) => 
  `### ${i + 1}. ${p.title}
- **Price:** $${p.price} | **Est. Cost:** $${p.estimated_cost} | **Est. Profit:** $${p.estimated_profit}
- **Reviews:** ${p.reviews} ⭐`
).join('\n\n') || 'No pricing data available'}

---

## 🏆 Top Competitors
${analysis.competitors?.map((c: any, i: number) => 
  `### ${i + 1}. ${c.name}
- **Strengths:** ${c.strengths?.join(', ')}
- **Weaknesses:** ${c.weaknesses?.join(', ')}`
).join('\n\n') || 'No competitor data available'}

---

## 🎯 Market Gaps (Opportunities)
${analysis.market_gap?.map((g: any, i: number) => 
  `### ${g.icon} Gap ${i + 1}
${g.insight}`
).join('\n\n') || 'No market gap data available'}

---

## 👥 Customer Personas
${analysis.personas?.map((p: any, i: number) => 
  `### ${p.avatar} Persona ${i + 1}: ${p.name}
- **Demographics:** ${p.demographics}
- **Goals:** ${p.goals}
- **Pain Points:** ${p.pain_points}
- **Buying Triggers:** ${p.buying_triggers}
- **Best Channels:** ${p.preferred_channels?.join(', ')}`
).join('\n\n') || 'No persona data available'}

---

## 📅 30-Day Launch Plan
${analysis.launch_plan?.map((d: any) => 
  `### Day ${d.day} (${d.category})
${d.task}`
).join('\n') || 'No launch plan available'}

---

## 💸 Profit Forecast
- **Monthly Revenue Estimate:** $${analysis.profit_forecast?.monthly_revenue_estimate || 0}
- **Monthly Profit Estimate:** $${analysis.profit_forecast?.monthly_profit_estimate || 0}
- **Break-Even:** ${analysis.profit_forecast?.break_even_months || 'N/A'} months
- **Assumptions:** ${analysis.profit_forecast?.assumptions || 'N/A'}

---

## ⚠️ Risks & Mitigations
${analysis.risks?.map((r: string) => `- ${r}`).join('\n') || 'No risks identified'}

---

*Report generated by MarketMuse AI PRO MAX ULTRA - $99/report*`;
}

export const createProductReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = productResearchSchema.parse(req.body);
    const countryUpper = country.toUpperCase();
    
    const cacheKey = `product_report_${niche}_${country}`;
    const cached = cacheService.get(cacheKey);
    if (cached) {
      console.log('📦 Returning cached product report');
      return res.json(cached);
    }

    console.log(`🔍 Starting product research: "${niche}" in ${countryUpper}`);

    const [shoppingData, trendsData, exchangeRates] = await Promise.all([
      getShoppingResults(niche, country),
      getTrends(niche, countryUpper),
      getExchangeRates(),
    ]);

    // Slim down the shopping data to avoid token limit (max 5 products, only essential fields)
    const products = (shoppingData as any).shopping_results?.slice(0, 5).map((p: any) => ({
      title: p.title || 'Unknown Product',
      price: p.extracted_price || p.price || 0,
      source: p.source || 'Unknown',
      reviews: p.rating || 0,
      image: p.thumbnail || '',
    })) || [];

    const userMessage = `Niche: ${niche}
Country: ${country} (${countryUpper})
Exchange Rates: ${JSON.stringify(exchangeRates)}

Real Shopping Data (top 5 products):
${JSON.stringify(products, null, 2)}

12-Month Google Trends (first 6 months):
${JSON.stringify(trendsData.slice(0, 6), null, 2)}

Please analyze and return a complete JSON with ALL required fields. Be specific, use real product titles from the data, and suggest a realistic 30-day launch plan with niche-specific tasks.`;

    console.log('🤖 Requesting Groq analysis...');
    const groqResponse = await runGroqWithRetry(PRODUCT_SYSTEM_PROMPT, userMessage);
    
    const analysis = extractJSON(groqResponse);

    if (!analysis.market_score || !analysis.pricing_engine || !analysis.competitors) {
      throw new Error('AI response missing required fields');
    }

    const markdown = generateProductMarkdown(analysis, niche, country);

    const charts = {
      trends: trendsData,
      marketScore: analysis.market_score,
      demandForecast: analysis.chart_data?.demand_forecast || [],
      competitorShare: analysis.chart_data?.competitor_market_share || [],
      pricing: analysis.pricing_engine || [],
    };

    const report = await Report.create({
      type: 'product',
      niche,
      country,
      value: '$99',
      data: analysis,
      markdown,
      charts,
    });

    console.log('✅ Product report generated:', report._id);

    const result = {
      id: report._id,
      type: report.type,
      niche: report.niche,
      country: report.country,
      value: report.value,
      data: analysis,
      markdown: report.markdown,
      charts: charts,
      createdAt: report.createdAt,
    };

    cacheService.set(cacheKey, result, 86400);
    return res.status(201).json(result);

  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
      });
    }
    next(err);
  }
};

export const getProductReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    if (report.type !== 'product') {
      return res.status(400).json({ error: 'This is not a product report' });
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
};
