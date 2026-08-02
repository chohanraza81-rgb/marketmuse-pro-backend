import { Request, Response, NextFunction } from 'express';
import { productResearchSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getShoppingResults } from '../services/serpapi';
import { getTrends } from '../services/trends';
import { getExchangeRates } from '../services/exchange';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const PRODUCT_SYSTEM_PROMPT = `You are a world-class e-commerce market analyst. 
Given a niche and country, perform deep research using provided data (shopping results, trends). 
Respond ONLY with a valid JSON object (no markdown, no code fences) that exactly follows this structure:
{
  "market_score": number (0-100),
  "pricing_engine": [
    { "title": string, "image": string, "price": number, "currency": string, "estimated_cost": number, "estimated_profit": number, "reviews": number }
  ],
  "competitors": [ { "name": string, "strength": string, "weakness": string } ] (max 10),
  "market_gap": [ { "insight": string, "icon": string } ] (exactly 3),
  "personas": [ { "name": string, "avatar": string, "description": string, "ads_channel": string } ] (exactly 3),
  "launch_plan": [ { "day": number, "task": string } ] (30 days),
  "risks": [ string ],
  "chart_data": { "demand_forecast": number[], "competitor_market_share": { "name": string, "value": number }[] }
}`;

export const createProductReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = productResearchSchema.parse(req.body);
    const countryUpper = country.toUpperCase();
    const cacheKey = `product_report_${niche}_${country}`;
    const cached = cacheService.get(cacheKey);
    if (cached) return res.json(cached);

    // Parallel data fetching
    const [shoppingData, trendsData, exchangeRates] = await Promise.all([
      getShoppingResults(niche, country),
      getTrends(niche, countryUpper),
      getExchangeRates(),
    ]);

    // Extract relevant shopping items for Groq
    const products = shoppingData.shopping_results?.slice(0, 10).map((p: any) => ({
      title: p.title,
      price: p.extracted_price,
      source: p.source,
      reviews: p.rating || 0,
    })) || [];

    const userMessage = `Niche: ${niche}\nCountry: ${country}\nTop Shopping Results: ${JSON.stringify(products)}\n12-month Trends: ${JSON.stringify(trendsData.slice(0,6))}`;

    const groqResponse = await runGroqWithRetry(PRODUCT_SYSTEM_PROMPT, userMessage);
    let analysis;
    try {
      const cleaned = groqResponse.replace(/```json|```/g, '').trim();
      analysis = JSON.parse(cleaned);
    } catch (e) {
      throw new Error('Failed to parse Groq output as JSON');
    }

    // Generate markdown
    const markdown = generateProductMarkdown(analysis, niche, country);

    // Build chart data for frontend
    const charts = {
      trends: trendsData,
      marketScore: analysis.market_score,
      demandForecast: analysis.chart_data?.demand_forecast || [],
      competitorShare: analysis.chart_data?.competitor_market_share || [],
      pricing: analysis.pricing_engine || [],
    };

    // Save to DB
    const report = await Report.create({
      type: 'product',
      niche,
      country,
      data: analysis,
      markdown,
      charts,
    });

    const result = {
      id: report._id,
      ...report.toObject(),
    };

    cacheService.set(cacheKey, result, 86400);
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: err.errors });
    }
    next(err);
  }
};

function generateProductMarkdown(analysis: any, niche: string, country: string): string {
  return `# Product Research: ${niche} (${country.toUpperCase()})
  
## Market Score: ${analysis.market_score}/100

### Top Competitors
${analysis.competitors.map((c: any) => `- **${c.name}**: ${c.strength} | ${c.weakness}`).join('\n')}

### Market Gaps
${analysis.market_gap.map((g: any) => `- ${g.insight}`).join('\n')}

### Customer Personas
${analysis.personas.map((p: any) => `- **${p.name}** - ${p.description}`).join('\n')}

### 30-Day Launch Plan
${analysis.launch_plan.map((d: any) => `Day ${d.day}: ${d.task}`).join('\n')}

### Risks
${analysis.risks.map((r: string) => `- ${r}`).join('\n')}
`;
}
