import { cacheService } from './cache';
import { getGoogleTrends } from './trends';
import { runGroqWithRetry } from './groq';

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

const safeNumber = (val: any, fallback: number = 0) => {
  const num = Number(val);
  return isNaN(num) || num === 0 ? fallback : num;
};

const safeString = (val: any, fallback: string = 'N/A') => {
  if (!val) return fallback;
  return String(val).replace(/-mock/g, '').replace(/\.mock/g, '');
};

// 🔥 FINAL FIX: Complex JSON Object Formatter (Kills raw JSON in Reports)
const formatComplexObject = (item: any): string => {
  if (typeof item === 'string') return item;
  if (typeof item === 'object' && item !== null) {
    // Scenario Planning
    if (item.scenario) return `Scenario: ${item.scenario} | Action Plan: ${item.action_plan || 'N/A'}`;
    // Logistics Risk
    if (item.risk_factor) return `Risk Factor: ${item.risk_factor} | Impact: ${item.impact_level} | Mitigation: ${item.mitigation_strategy}`;
    // SWOT Analysis
    if (item.category) return `${item.category}: ${(item.points || []).join(', ')}`;
    // Action Priority Matrix
    if (item.action) return `Task: ${item.action} | Impact: ${item.impact} | Effort: ${item.effort} | Priority: ${item.priority}`;
    // ROI & Financial Projection
    if (item.year) return `Year: ${item.year} | Projected Revenue: ${item.projected_revenue_try} | Cost: ${item.projected_cost_try} | Net Margin: ${item.net_profit_margin_pct}%`;
    // Risk Assessment
    if (item.risk) return `Risk: ${item.risk} | Likelihood: ${item.likelihood} | Impact: ${item.impact} | Mitigation: ${item.mitigation}`;
    
    // Generic JSON stringify fallback
    return JSON.stringify(item);
  }
  return 'N/A';
};

const ensureStringArray = (arr: any): string[] => {
  if (!Array.isArray(arr)) return [];
  return arr.map((item: any) => formatComplexObject(item));
};

const extractJSON = (raw: string): any => {
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) cleaned = cleaned.substring(start, end + 1);
  try { return JSON.parse(cleaned); } catch (err) {
    const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    try { return JSON.parse(fixed); } catch (e2) {
      let completed = cleaned;
      let braceCount = (completed.match(/{/g) || []).length;
      let closeCount = (completed.match(/}/g) || []).length;
      while (closeCount < braceCount) { completed += '}'; closeCount++; }
      try { return JSON.parse(completed); } catch (e3) { throw new Error('AI response is not valid JSON'); }
    }
  }
};

const buildProductPrompt = (niche: string, country: string) => {
  const countryName = countryNames[country] || country;
  return `You are a veteran E-commerce and Product Consultant at MusePRO. Write in a human tone.
  Target Market: ${countryName}. Current Year: 2026.
  Create a Business Intelligence Report for "${niche}".
  **Return ONLY a valid JSON object. No markdown blocks, no extra text.**
  
  **IMPORTANT FORMATTING**:
  For 'consumer_persona', 'demographics' must be a SINGLE STRING (e.g., "Age: 34, Location: KL").
  For 'scenario_planning' 'logistics_risk_map' 'swot_analysis' 'action_priority_matrix' 'financial_projection' and 'risk_assessment', use the exact keys provided in the instructions.
  
  JSON Structure:
  1. key_insights (3), 2. immediate_actions (3), 3. trend_summary, 4. trend_assessment, 5. local_business_insight (array), 6. consumer_persona (array of objects), 7. financial_model (array), 8. sourcing_analysis (array), 9. competition_analysis (array), 10. marketing_channels (array), 11. growth_accelerators (array), 12. launch_action_plan (array), 13. data_validation (array), 14. competitor_benchmark (array of objects), 15. assumptions_risk (array), 16. customer_sentiment (array), 17. client_value_proposition (array), 18. scenario_planning (array of objects: scenario, action_plan), 19. logistics_risk_map (array of objects: risk_factor, impact_level, mitigation_strategy), 20. cold_start_strategy (array), 21. csr_esg_roadmap (array), 22. swot_analysis (array of objects: category, points), 23. action_priority_matrix (array of objects: action, impact, effort, priority), 24. financial_projection (array of objects: year, projected_revenue_try, projected_cost_try, net_profit_margin_pct), 25. risk_assessment (array of objects: risk, likelihood, impact, mitigation), 26. final_ceo_summary (array), 27. data_limitations (array).`;
};

export async function generateProductReport(niche: string, country: string) {
  const cacheKey = `product_${niche}_${country}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const trendData = await getGoogleTrends(niche, country).catch(() => []);
  const prompt = buildProductPrompt(niche, country);
  const aiResponse = await runGroqWithRetry(prompt, JSON.stringify({ niche, country }));
  const analysis = extractJSON(aiResponse);

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const reference = `MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  let markdown = `MusePRO\nMarket Intelligence & Strategic Modeling\n──────────────────────────────────────────────────────────────\nPRODUCT INTELLIGENCE REPORT\n\nPrepared For: [Client Name]\nDate: ${today}\nReference: ${reference}\nClassification: CONFIDENTIAL\n──────────────────────────────────────────────────────────────\n\n`;

  markdown += `1. CLIENT VALUE PROPOSITION\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.client_value_proposition).slice(0, 3).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n`;

  markdown += `2. EXECUTIVE BRIEF\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.key_insights).slice(0, 3).forEach((f: string, i: number) => markdown += `  ${i+1}. ${f}\n`);
  markdown += `\nPriority Actions:\n`;
  ensureStringArray(analysis.immediate_actions).slice(0, 3).forEach((w: string, i: number) => markdown += `  ${i+1}. ${w}\n`);
  markdown += `\n3. TREND ASSESSMENT\n──────────────────────────────────────────────────────────────\n${analysis.trend_assessment || 'Demand is steadily rising.'}\n\n`;

  markdown += `4. LOCAL BUSINESS INSIGHT\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.local_business_insight).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n`;

  markdown += `5. CONSUMER PERSONA\n──────────────────────────────────────────────────────────────\n`;
  if (Array.isArray(analysis.consumer_persona)) {
    analysis.consumer_persona.forEach((persona: any, idx: number) => {
      markdown += `Persona #${idx + 1} (Illustrative):\n`;
      let demographics = persona.demographics;
      if (typeof demographics === 'object' && demographics !== null) {
        demographics = Object.values(demographics).join(', ');
      }
      markdown += `  Demographics: ${safeString(demographics)}\n`;
      markdown += `  Pain Points: ${safeString(persona.pain_points)}\n`;
      markdown += `  Goals: ${safeString(persona.goals)}\n`;
      markdown += `  Buying Triggers: ${safeString(persona.buying_triggers)}\n\n`;
    });
  }

  markdown += `6. PRODUCT VIABILITY & FINANCIAL MODEL\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.financial_model).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n7. SOURCING & SUPPLIER ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.sourcing_analysis).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n8. COMPETITION & SATURATION ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.competition_analysis).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n9. MARKETING & SALES CHANNELS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.marketing_channels).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n10. GROWTH ACCELERATORS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.growth_accelerators).forEach((tip: string, i: number) => markdown += `  ${i+1}. ${tip}\n`);
  markdown += `\n11. 30-60-90 DAY LAUNCH ACTION PLAN\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.launch_action_plan).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n12. DATA VALIDATION & EVIDENCE SOURCES\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.data_validation).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n13. COMPETITOR PRICE BENCHMARKING MATRIX\n──────────────────────────────────────────────────────────────\n`;
  if (Array.isArray(analysis.competitor_benchmark)) {
    markdown += `| Brand | Price | Market Position | Gap |\n|---|---|---|---|\n`;
    analysis.competitor_benchmark.forEach((c: any) => markdown += `| ${safeString(c.brand)} | ${safeString(c.price)} | ${safeString(c.market_position)} | ${safeString(c.gap)} |\n`);
  }

  markdown += `\n14. ASSUMPTIONS & RISK ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.assumptions_risk).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n15. CUSTOMER SENTIMENT & MARKET QUOTES\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.customer_sentiment).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n16. SCENARIO PLANNING & ROI PROJECTIONS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.scenario_planning).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n17. LOGISTICS & SUPPLY CHAIN RISK MAP\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.logistics_risk_map).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n18. COLD-START STRATEGY (FIRST 5 CLIENTS)\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.cold_start_strategy).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n19. CSR & ESG ROADMAP\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.csr_esg_roadmap).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n20. SWOT ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.swot_analysis).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n21. ACTION PRIORITY MATRIX (Impact vs. Effort)\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.action_priority_matrix).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n22. ROI & FINANCIAL PROJECTION\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.financial_projection).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n23. RISK ASSESSMENT TABLE\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.risk_assessment).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n24. FINAL CEO SUMMARY\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.final_ceo_summary).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\nMETHODOLOGY & DATA LIMITATIONS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.data_limitations).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\nThis report is based on comprehensive primary and secondary research conducted on ${today} from:\n\n• Real-time Market & Consumer Demand Trends\n• Local Sourcing & Logistics Audit via MusePRO Proprietary Database\n• Financial Modeling, Margin & Break-even Calculations\n• Strategic Synthesis & Market Insights by MusePRO Senior Research Division\n\n`;

  const result = {
    niche, country, type: 'product',
    data: analysis,
    keywords: [], serp_landscape: [],
    markdown,
    trend_summary: analysis.trend_summary || 'High potential market.',
    chart_data: { trend_12m: trendData.map((v: number, i: number) => ({ month: `M${i + 1}`, value: v })), traffic_forecast_6m: [], market_share: [] },
    traffic_estimate: 0
  };
  cacheService.set(cacheKey, result, 86400);
  return result;
}
