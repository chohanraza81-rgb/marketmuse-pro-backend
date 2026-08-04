import { Request, Response, NextFunction } from 'express';
import { productResearchSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getShoppingResults } from '../services/serpapi';
import { getTrends } from '../services/trends';
import { getExchangeRates } from '../services/exchange';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const extractJSON = (raw: string): any => {
  let c = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const s = c.indexOf('{');
  const e = c.lastIndexOf('}');
  if (s !== -1 && e !== -1 && e > s) c = c.substring(s, e + 1);
  try {
    return JSON.parse(c);
  } catch (err) {
    try {
      const fixed = c.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}').replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(fixed);
    } catch (e2) {
      try {
        let completed = c;
        let braceCount = (completed.match(/{/g) || []).length;
        let closeCount = (completed.match(/}/g) || []).length;
        while (closeCount < braceCount) { completed += '}'; closeCount++; }
        let bracketCount = (completed.match(/\[/g) || []).length;
        let closeBracketCount = (completed.match(/\]/g) || []).length;
        while (closeBracketCount < bracketCount) { completed += ']'; closeBracketCount++; }
        return JSON.parse(completed);
      } catch (e3) {
        console.error('❌ All JSON fixes failed. Last 500 chars:', c.substring(c.length - 500));
        throw new Error('AI response truncated — please add more credits for full reports');
      }
    }
  }
};

// ✅ SLIMMER PROMPT — fits in 4000 tokens
const PROMPT = `You are an e-commerce strategist. Analyze real shopping data, trends, and exchange rates. Return ONLY valid JSON:

{
  "market_score": number,
  "market_verdict": "Hot Buy 🔥" | "Stable Earner 💰" | "Risky ⚠️",
  "executive_summary": "2-3 sentences",
  "pricing_engine": [
    {
      "title": "product name",
      "selling_price_usd": number,
      "landed_cost_usd": number,
      "net_profit_usd": number,
      "profit_margin_percent": number,
      "monthly_potential": number,
      "reviews": number,
      "source": "store name",
      "competitive_advantage": "why it wins"
    }
  ] (8 items, use real data),
  "competitors": [
    {
      "name": "brand",
      "market_position": "Leader/Challenger/Niche",
      "strengths": ["2 specific"],
      "weaknesses": ["2 specific"],
      "how_to_beat": "strategy"
    }
  ] (5 items),
  "market_gaps": [
    {
      "gap_title": "title",
      "description": "specific paragraph",
      "revenue_potential": "$5k-25k+/mo",
      "icon": "emoji"
    }
  ] (3 items),
  "personas": [
    {
      "name": "name",
      "avatar": "emoji",
      "demographics": "age, income",
      "problem": "pain point",
      "trigger": "buying trigger",
      "ad_copy": "exact ad text"
    }
  ] (3 items),
  "launch_playbook": [
    {
      "week": 1-8,
      "theme": "Foundation/Sourcing/Launch/Scale",
      "tasks": ["3 specific tasks"]
    }
  ] (8 weeks),
  "financials": {
    "startup_cost": number,
    "monthly_fixed": number,
    "profit_per_unit": number,
    "breakeven_units": number
  },
  "risks": [
    {
      "risk": "description",
      "mitigation": "action"
    }
  ] (5 items)
}`;

function md(a: any, niche: string, country: string): string {
  const f: any = { us:'🇺🇸', pk:'🇵🇰', gb:'🇬🇧', ae:'🇦🇪', sa:'🇸🇦' };
  const n: any = { us:'United States', pk:'Pakistan', gb:'United Kingdom', ae:'UAE', sa:'Saudi Arabia' };
  let m = `# 🚀 Product Research: ${niche}\n## Target: ${f[country]} ${n[country]}\n\n`;
  m += `## 📊 Market Score: **${a.market_score}/100** — ${a.market_verdict}\n\n${a.executive_summary}\n\n`;
  m += `## 💰 8-Product Pricing Engine\n| # | Product | Sell | Cost | Profit | Margin | Mo. Potential | Reviews | Edge |\n|---|---------|------|------|--------|--------|-------------|---------|------|\n`;
  a.pricing_engine?.forEach((p: any, i: number) => m += `| ${i+1} | ${p.title} | $${p.selling_price_usd} | $${p.landed_cost_usd} | $${p.net_profit_usd} | ${p.profit_margin_percent}% | $${p.monthly_potential?.toLocaleString()} | ${p.reviews}⭐ | ${p.competitive_advantage} |\n`);
  m += `\n## 🏆 5 Competitors\n`;
  a.competitors?.forEach((c: any) => m += `### ${c.name} (${c.market_position})\n- ✅ ${c.strengths?.join(', ')}\n- ❌ ${c.weaknesses?.join(', ')}\n- 🎯 Beat: ${c.how_to_beat}\n\n`);
  m += `## 🎯 Market Gaps\n`;
  a.market_gaps?.forEach((g: any) => m += `### ${g.icon} ${g.gap_title}\n${g.description}\n- 💵 ${g.revenue_potential}\n\n`);
  m += `## 👥 Personas\n`;
  a.personas?.forEach((p: any) => m += `### ${p.avatar} ${p.name}\n- ${p.demographics}\n- Problem: ${p.problem}\n- Trigger: ${p.trigger}\n- 📢 "${p.ad_copy}"\n\n`);
  m += `## 📅 8-Week Launch\n`;
  a.launch_playbook?.forEach((w: any) => m += `### Week ${w.week}: ${w.theme}\n${w.tasks?.map((t: string) => `- ${t}`).join('\n')}\n\n`);
  const fp = a.financials;
  m += `## 💸 Financials\n- Startup: $${fp?.startup_cost?.toLocaleString()} | Fixed: $${fp?.monthly_fixed}/mo | Profit/Unit: $${fp?.profit_per_unit} | Breakeven: ${fp?.breakeven_units} units\n\n`;
  m += `## ⚠️ Risks\n| Risk | Mitigation |\n|------|------------|\n`;
  a.risks?.forEach((r: any) => m += `| ${r.risk} | ${r.mitigation} |\n`);
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
    const [shop, trends, fx] = await Promise.all([getShoppingResults(niche, country), getTrends(niche, country.toUpperCase()), getExchangeRates()]);
    const items = (shop as any).shopping_results?.slice(0, 5).map((p: any) => ({ title: p.title, price: p.extracted_price || p.price, source: p.source, reviews: p.rating || 0 })) || [];
    const ai = await runGroqWithRetry(PROMPT, `${niche}\n${country}\nFX:${JSON.stringify(fx)}\nProducts:${JSON.stringify(items)}\nTrends:${JSON.stringify(trends.slice(0,4))}`);
    const analysis = extractJSON(ai);
    const markdown = md(analysis, niche, country);
    const report = await Report.create({ type:'product', niche, country, value:'$99', data:analysis, markdown, charts:{trends,fx} });
    const result = { id:report._id, ...report.toObject() };
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
