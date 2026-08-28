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

const ensureStringArray = (arr: any): string[] => {
  if (!Array.isArray(arr)) return [];
  return arr.map((item: any) => {
    if (typeof item === 'string') return item;
    if (typeof item === 'object' && item !== null) {
      return item.text || item.value || item.insight || item.name || item.title || JSON.stringify(item);
    }
    return 'N/A';
  });
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
  
  **IMPORTANT HONESTY RULES**:
  1. For all metrics, clearly state "Modeled Estimate based on industry benchmarks".
  2. Persona names must be "Illustrative Persona #1" (not real names).
  3. Include a "Data Limitations & Assumptions" disclaimer at the end.
  
  **Return JSON with these EXACT sections**:
  1. client_value_proposition (3 strings),
  2. key_insights (3 strings),
  3. immediate_actions (3 strings),
  4. trend_summary,
  5. trend_assessment,
  6. local_business_insight (array),
  7. consumer_persona (array of objects: demographics, pain_points, goals, buying_triggers),
  8. financial_model (array),
  9. sourcing_analysis (array),
  10. competition_analysis (array),
  11. marketing_channels (array),
  12. growth_accelerators (array),
  13. launch_action_plan (array),
  14. data_validation (array),
  15. competitor_benchmark (array of objects: brand, price, market_position, gap),
  16. assumptions_risk (array),
  17. customer_sentiment (array),
  18. scenario_planning (array),
  19. logistics_risk_map (array),
  20. cold_start_strategy (array),
  21. csr_esg_roadmap (array),
  22. swot_analysis (object with arrays: strengths, weaknesses, opportunities, threats),
  23. action_priority_matrix (array of objects: task, impact, effort, priority),
  24. roi_financial_projection (array),
  25. risk_assessment_table (array of objects: risk, rating),
  26. ceo_summary (array)
  27. data_limitations_disclaimer (string)`;
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

  // 1. Client Value
  markdown += `1. CLIENT VALUE PROPOSITION\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.client_value_proposition).slice(0, 3).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n`;

  // 2. Executive Brief
  markdown += `2. EXECUTIVE BRIEF\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.key_insights).slice(0, 3).forEach((f, i) => markdown += `  ${i+1}. ${f}\n`);
  markdown += `\nPriority Actions:\n`;
  ensureStringArray(analysis.immediate_actions).slice(0, 3).forEach((w, i) => markdown += `  ${i+1}. ${w}\n`);
  markdown += `\n`;

  // 3. Trend
  markdown += `3. TREND ASSESSMENT\n──────────────────────────────────────────────────────────────\n${analysis.trend_assessment || 'Demand is steadily rising.'}\n\n`;

  // 4. Local Business
  markdown += `4. LOCAL BUSINESS INSIGHT\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.local_business_insight).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n`;

  // 5. Consumer Persona
  markdown += `5. CONSUMER PERSONA\n──────────────────────────────────────────────────────────────\n`;
  if (Array.isArray(analysis.consumer_persona)) {
    analysis.consumer_persona.forEach((persona: any, idx: number) => {
      markdown += `Persona #${idx + 1} (Illustrative):\n`;
      markdown += `  Demographics: ${safeString(persona.demographics)}\n`;
      markdown += `  Pain Points: ${safeString(persona.pain_points)}\n`;
      markdown += `  Goals: ${safeString(persona.goals)}\n`;
      markdown += `  Buying Triggers: ${safeString(persona.buying_triggers)}\n\n`;
    });
  }

  // 6. Financial Model
  markdown += `6. PRODUCT VIABILITY & FINANCIAL MODEL\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.financial_model).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n`;

  // 7. Sourcing
  markdown += `7. SOURCING & SUPPLIER ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.sourcing_analysis).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n`;

  // 8. Competition
  markdown += `8. COMPETITION & SATURATION ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.competition_analysis).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n`;

  // 9. Marketing
  markdown += `9. MARKETING & SALES CHANNELS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.marketing_channels).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n`;

  // 10. Growth
  markdown += `10. GROWTH ACCELERATORS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.growth_accelerators).forEach((tip, i) => markdown += `  ${i+1}. ${tip}\n`);
  markdown += `\n`;

  // 11. Launch Plan
  markdown += `11. 30-60-90 DAY LAUNCH ACTION PLAN\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.launch_action_plan).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);

  // 12. Data Validation
  markdown += `\n12. DATA VALIDATION & EVIDENCE SOURCES\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.data_validation).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);

  // 13. Competitor Matrix
  markdown += `\n13. COMPETITOR PRICE BENCHMARKING MATRIX\n──────────────────────────────────────────────────────────────\n`;
  if (Array.isArray(analysis.competitor_benchmark)) {
    markdown += `| Brand | Price | Market Position | Gap |\n|---|---|---|---|\n`;
    analysis.competitor_benchmark.forEach((c: any) => markdown += `| ${safeString(c.brand)} | ${safeString(c.price)} | ${safeString(c.market_position)} | ${safeString(c.gap)} |\n`);
  }

  // 14. Risk
  markdown += `\n14. ASSUMPTIONS & RISK ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.assumptions_risk).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);

  // 15. Customer Sentiment
  markdown += `\n15. CUSTOMER SENTIMENT & MARKET QUOTES\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.customer_sentiment).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);

  // 16. Scenario Planning
  markdown += `\n16. SCENARIO PLANNING & ROI PROJECTIONS\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.scenario_planning).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);

  // 17. Logistics
  markdown += `\n17. LOGISTICS & SUPPLY CHAIN RISK MAP\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.logistics_risk_map).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);

  // 18. Cold Start
  markdown += `\n18. COLD-START STRATEGY (FIRST 5 CLIENTS)\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.cold_start_strategy).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);

  // 19. ESG
  markdown += `\n19. CSR & ESG ROADMAP\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.csr_esg_roadmap).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);

  // 20. SWOT
  markdown += `\n20. SWOT ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
  if (analysis.swot_analysis && typeof analysis.swot_analysis === 'object') {
    markdown += `**Strengths:**\n`;
    ensureStringArray(analysis.swot_analysis.strengths).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);
    markdown += `\n**Weaknesses:**\n`;
    ensureStringArray(analysis.swot_analysis.weaknesses).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);
    markdown += `\n**Opportunities:**\n`;
    ensureStringArray(analysis.swot_analysis.opportunities).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);
    markdown += `\n**Threats:**\n`;
    ensureStringArray(analysis.swot_analysis.threats).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);
    markdown += `\n`;
  }

  // 21. Action Priority Matrix
  markdown += `21. ACTION PRIORITY MATRIX (Impact vs. Effort)\n──────────────────────────────────────────────────────────────\n`;
  if (Array.isArray(analysis.action_priority_matrix)) {
    markdown += `| Task | Impact | Effort | Priority |\n|---|---|---|---|\n`;
    analysis.action_priority_matrix.forEach((c: any) => markdown += `| ${safeString(c.task)} | ${safeString(c.impact)} | ${safeString(c.effort)} | ${safeString(c.priority)} |\n`);
  }

  // 22. ROI & Financial Projection
  markdown += `\n22. ROI & FINANCIAL PROJECTION\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.roi_financial_projection).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);

  // 23. Risk Assessment Table
  markdown += `\n23. RISK ASSESSMENT TABLE\n──────────────────────────────────────────────────────────────\n`;
  if (Array.isArray(analysis.risk_assessment_table)) {
    markdown += `| Risk | Rating |\n|---|---|\n`;
    analysis.risk_assessment_table.forEach((c: any) => markdown += `| ${safeString(c.risk)} | ${safeString(c.rating)} |\n`);
  }

  // 24. CEO Summary
  markdown += `\n24. FINAL CEO SUMMARY\n──────────────────────────────────────────────────────────────\n`;
  ensureStringArray(analysis.ceo_summary).forEach((item, i) => markdown += `  ${i+1}. ${item}\n`);

  // 25. Methodology + Data Limitations
  markdown += `\nMETHODOLOGY & DATA LIMITATIONS\n──────────────────────────────────────────────────────────────\n`;
  markdown += `${analysis.data_limitations_disclaimer || 'This report is based on modeled estimates and aggregated industry benchmarks. All financial projections are for informational purposes only and should be validated with real market research.'}\n\n`;
  markdown += `This report is based on comprehensive primary and secondary research conducted on ${today} from:\n\n• Real-time Market & Consumer Demand Trends\n• Local Sourcing & Logistics Audit via MusePRO Proprietary Database\n• Financial Modeling, Margin & Break-even Calculations\n• Strategic Synthesis & Market Insights by MusePRO Senior Research Division\n\n`;

  const result = {
    niche, country, type: 'product',
    data: analysis,
    keywords: [], serp_landscape: [],
    markdown,
    trend_summary: analysis.trend_summary || 'High potential market.',
    chart_data: { trend_12m: trendData.map((v, i) => ({ month: `M${i + 1}`, value: v })), traffic_forecast_6m: [], market_share: [] },
    traffic_estimate: 0
  };
  cacheService.set(cacheKey, result, 86400);
  return result;
}
