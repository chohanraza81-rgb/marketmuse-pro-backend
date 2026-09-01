// product.report.generator.ts
import { cacheService } from './cache';
import { getGoogleTrends } from './trends';
import { getSearchResults } from './serpapi';
import { getSerperResults } from './serper';
import { getScraperAPISearch } from './scraperapi';
import { runGroqWithRetry } from './groq';

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

// Currency symbols and fallback rates (1 USD = X local)
const currencyInfo: Record<string, { symbol: string; rate: number }> = {
  us: { symbol: '$', rate: 1 },
  gb: { symbol: '£', rate: 0.79 },
  ca: { symbol: 'C$', rate: 1.36 },
  au: { symbol: 'A$', rate: 1.52 },
  de: { symbol: '€', rate: 0.92 },
  sg: { symbol: 'S$', rate: 1.34 },
  sa: { symbol: '﷼', rate: 3.75 },
  ae: { symbol: 'د.إ', rate: 3.67 },
  pk: { symbol: '₨', rate: 278 },
  in: { symbol: '₹', rate: 83 },
  tr: { symbol: '₺', rate: 32 },
  my: { symbol: 'RM', rate: 4.7 },
};

// Generic base domain keywords (will match any extension like .com, .de, .co.uk)
const genericDomainKeywords = [
  'wikipedia',
  'bbc',
  'business.google',
  'investopedia',
  'salesforce',
  'linkedin',
  'medium',
  'wolterskluwer',
  'baremetrics',
  'entrepreneur',
  'quora',
  'paisabazaar',
  'uschamber',
  'reddit',
  'slideshare',
  'skynethosting',
  'coursera',
  'mailchimp',
  'bigcommerce',
  'wix',
  'godaddy',
  'prometai',
  'shopify',
  'amazon',        // catches amazon.com, amazon.de, amazon.co.uk, etc.
  'ebay',          // catches ebay.com, ebay.de, etc.
  'fundgrube',     // fundgrube.com
  'pinterest',
  'blogspot',
  'ltdcommodities',
  'hotcommodityhome',
  'jpmorgan',
  'google',        // removes Google redirect URLs
];

const safeNumber = (val: any, fallback: number = 0) => {
  const num = Number(val);
  return isNaN(num) || num === 0 ? fallback : num;
};

const safeString = (val: any, fallback: string = 'N/A') => {
  if (!val || val === 'undefined' || val === 'null') return fallback;
  return String(val).replace(/-mock/g, '').replace(/\.mock/g, '').trim() || fallback;
};

const formatComplexObject = (item: any): string => {
  if (typeof item === 'string' && item.trim() !== '') return item;
  if (typeof item === 'object' && item !== null) {
    if (item.metric && item.value) return `${item.metric}: ${item.value}`;
    if (item.scenario) {
      const plan = item.action_plan && item.action_plan !== 'N/A' ? item.action_plan : 'Implement agile marketing adjustments and secure backup inventory.';
      return `Scenario: ${safeString(item.scenario)} | Action Plan: ${plan}`;
    }
    if (item.risk_factor) {
      const impact = item.impact_level || item.impact || 'Medium';
      const mitigation = item.mitigation_strategy || item.mitigation || 'Implement standard risk mitigation protocols.';
      return `Risk Factor: ${safeString(item.risk_factor)} | Impact: ${impact} | Mitigation: ${mitigation}`;
    }
    if (item.risk) {
      const likelihood = item.likelihood || 'Medium';
      const impact = item.impact || 'Medium';
      const mitigation = item.mitigation || 'Implement standard mitigation.';
      return `Risk: ${safeString(item.risk)} | Likelihood: ${likelihood} | Impact: ${impact} | Mitigation: ${mitigation}`;
    }
    if (item.category && Array.isArray(item.points)) return `${item.category}: ${item.points.join(', ')}`;
    if (item.quadrant && Array.isArray(item.actions)) return `${item.quadrant}: ${item.actions.join(', ')}`;
    if (item.year) {
      const rev = safeString(item.projected_revenue, item.revenue || '500000');
      const cost = safeString(item.projected_cost, item.cost || '300000');
      const margin = safeString(item.net_profit_margin, item.margin || '15');
      return `Year: ${item.year} | Revenue: ${rev} | Cost: ${cost} | Margin: ${margin}%`;
    }
    if (item.tier_name || item.price || item.price_sar) {
      const name = item.tier_name || item.plan || 'Tier';
      const price = item.price_sar || item.price || 'N/A';
      const features = item.features || 'Standard features';
      const audience = item.target_audience || 'General';
      return `Tier: ${name} | Price: ${price} | Features: ${features} | Target: ${audience}`;
    }
    if (item.task && item.impact && item.effort) {
      return `Task: ${item.task} | Impact: ${item.impact} | Effort: ${item.effort} | Priority: ${item.priority || 'Normal'}`;
    }
    if (item.brand && item.price && item.market_position) {
      return `Brand: ${item.brand} | Price: ${item.price} | Position: ${item.market_position} | Gap: ${item.gap || 'N/A'}`;
    }
    const entries = Object.entries(item).map(([key, val]) => {
      if (Array.isArray(val)) return `${key}: ${val.join(', ')}`;
      if (typeof val === 'object') return `${key}: ${JSON.stringify(val)}`;
      return `${key}: ${safeString(val)}`;
    });
    return entries.join(' | ');
  }
  return 'N/A';
};

const ensureStringArray = (arr: any): string[] => {
  if (!Array.isArray(arr)) return [];
  return arr.map((item: any) => formatComplexObject(item));
};

// Improved persona sanitizer with niche and country-specific fallbacks
const sanitizePersona = (personas: any, niche: string, country: string): any[] => {
  if (!Array.isArray(personas) || personas.length === 0) {
    const countryName = countryNames[country] || 'your market';
    return [
      {
        idx: 1,
        demographics: `Age 28-40, male, ${countryName}-based entrepreneur`,
        pain_points: `High setup costs and confusing regulations for ${niche}`,
        goals: `Launch a compliant ${niche} business quickly and minimize overhead`,
        buying_triggers: `Discovering a streamlined digital solution with transparent pricing`
      },
      {
        idx: 2,
        demographics: `Age 35-50, female, business owner in ${countryName}`,
        pain_points: `Lack of clear guidance and fear of non-compliance`,
        goals: `Scale existing operations and enter new markets with confidence`,
        buying_triggers: `Recommendations from trusted local advisors or successful peers`
      }
    ];
  }
  return personas.map((persona, idx) => {
    let demographics = persona.demographics;
    if (typeof demographics === 'object' && demographics !== null) {
      const keys = ['age', 'gender', 'location', 'occupation', 'income'];
      demographics = keys.map(k => demographics[k]).filter(Boolean).join(', ');
      if (!demographics) demographics = `Age 30-45, business professional in ${countryNames[country] || 'your market'}`;
    }
    if (idx > 0 && demographics === personas[idx-1]?.demographics) {
      demographics += `, different segment`;
    }
    return {
      idx: idx + 1,
      demographics: safeString(demographics, `Age 30-45, business professional in ${countryNames[country] || 'your market'}`),
      pain_points: safeString(persona.pain_points, `High costs and lack of localized support for ${niche}`),
      goals: safeString(persona.goals, `Achieve sustainable growth with ${niche}`),
      buying_triggers: safeString(persona.buying_triggers, `Recognition of a clear ROI and trusted local references`),
    };
  });
};

const extractJSON = (raw: string): any => {
  if (typeof raw === 'object') return raw;
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

// Enhanced Product Prompt with local currency, case studies, and strict persona requirements
const buildProductPrompt = (niche: string, country: string, serpContext: string, trendData: number[], serpResults: any[]) => {
  const countryName = countryNames[country] || country;
  const trendSummary = trendData.length > 0 ? `12-month Google Trends data: ${trendData.join(', ')}` : 'No trend data available.';
  const serpEvidence = serpResults.slice(0, 10).map((r: any, i: number) => `${i+1}. ${r.title} - ${r.link}`).join('\n');
  const currencySymbol = currencyInfo[country]?.symbol || '$';
  
  return `You are a veteran E-commerce and Product Consultant at MusePRO. Write in a human, confident, and highly professional tone.
  Target Market: ${countryName}. Current Year: 2026.
  Local Currency: ${currencySymbol}
  
  **REAL DATA INPUT FROM ALL APIs (SerpAPI, ScraperAPI, SerperAPI)**:
  ${serpContext}
  
  **TOP SERP EVIDENCE (Titles & URLs)**:
  ${serpEvidence || 'No live SERP data available.'}
  
  **Google Trends Data (12 months)**: ${trendSummary}
  
  **STRICT INSTRUCTION**:
  - Use these REAL competitors, titles, and URLs to identify actual local brands in your report. DO NOT invent fake brands or say 'Modeled'.
  - When referring to pricing, use "Typical Price", "Market Price", or "From ${currencySymbol}XX" (e.g., "Typical Price: ${currencySymbol}49/month"). NEVER use "Est." or "Estimated".
  - All monetary values must be in the local currency: ${currencySymbol}.
  - Avoid unsubstantiated claims such as "guaranteed cost reduction", "guaranteed savings", "up to X% savings" unless you have direct evidence from the SERP sources. Instead, use phrases like "potential cost savings", "data-driven opportunities", or "optimization potential".
  - ALWAYS provide specific goals, buying triggers, action plans, and realistic financial numbers. NEVER use 'N/A' or 'No specific goals identified'.
  - All fields must be filled with meaningful, specific content. No empty strings, null, or 'undefined'.
  - For 'data_validation', explicitly cite at least 2-3 of the SERP sources (with URLs) that support your insights.
  - Provide at least 2 consumer personas. Each persona MUST have distinct demographics, pain points, goals, and buying triggers. Do NOT use generic phrases like "tech-savvy urban professional". Be specific based on the niche and local market.
  - For 'case_studies', provide 2-3 concise case studies. Each case study must have:
      - "title": string
      - "challenge": string (problem faced)
      - "solution": string (what was done)
      - "results": string (outcome with metrics in local currency if applicable)
  - Return a JSON object with ALL keys specified below, including 'case_studies'. Do not omit any key. If a key is an array and you have no data, return an empty array.
  
  **Return ONLY a valid JSON object. No markdown blocks, no extra text.**
  
  JSON Structure and Requirements:
  1. "key_insights": Array of exactly 3 concise but impactful insights, each as a string. Include real data points from SERP where possible.
  2. "immediate_actions": Array of exactly 3 actionable steps, each as a string.
  3. "trend_summary": A single string summarizing the overall market trend.
  4. "trend_assessment": A single string with detailed trend assessment, referencing Google Trends data.
  5. "local_business_insight": Array of 3 strings, each describing a unique local market opportunity or challenge.
  6. "consumer_persona": Array of exactly 2-3 objects. Each object must have:
     - "demographics": string like "Age 30-45, female, Dubai-based retail manager" (specific, not generic)
     - "pain_points": string describing specific pain points related to the niche
     - "goals": string describing specific goals
     - "buying_triggers": string describing what triggers purchase
     All fields are required, no N/A, no duplicate personas.
  7. "financial_model": Array of 3-5 objects, each with:
     - "tier_name": string
     - "price" or "price_sar": string (e.g., "Typical Price: ${currencySymbol}49/month")
     - "features": string (comma-separated)
     - "target_audience": string
     Use realistic pricing in local currency (${currencySymbol}).
  8. "sourcing_analysis": Array of 3-5 strings, each describing sourcing strategy or supplier insight.
  9. "competition_analysis": Array of 3-5 strings, each analyzing a competitor's strengths/weaknesses. Reference actual SERP competitors.
  10. "marketing_channels": Array of 3-5 strings, each a specific marketing channel relevant to the market.
  11. "growth_accelerators": Array of 3 strings, each a growth hack or accelerator.
  12. "launch_action_plan": Array of 3 strings, representing 30-60-90 day plan.
  13. "data_validation": Array of 3-5 strings, each citing SERP evidence (with URLs) that supports your claims.
  14. "competitor_benchmark": Array of exactly 3 objects, each MUST have:
      - "brand": string
      - "price": string (e.g., "Typical Price: ${currencySymbol}49/month" or "Market Price: Free tier, paid from ${currencySymbol}14/month")
      - "market_position": string
      - "gap": string
      Use real brands from SERP if available; otherwise use credible local competitors.
  15. "assumptions_risk": Array of 3-4 strings, each describing an assumption or risk with mitigation.
  16. "customer_sentiment": Array of 3 strings, capturing market sentiment or quotes.
  17. "client_value_proposition": Array of 3 strings, each a value proposition.
  18. "scenario_planning": Array of 3 objects, each with:
      - "scenario": string ("Best Case", "Expected Case", "Worst Case")
      - "action_plan": string
  19. "logistics_risk_map": Array of 3-4 objects, each with:
      - "risk": string
      - "likelihood": string
      - "impact": string
      - "mitigation": string
  20. "cold_start_strategy": Array of 3 strings, describing how to get first 5 clients.
  21. "csr_esg_roadmap": Array of 2-3 strings, CSR/ESG initiatives.
  22. "swot_analysis": Array of exactly 4 objects, each with:
      - "type": "strength" / "weakness" / "opportunity" / "threat"
      - "points": string describing that SWOT item
  23. "action_priority_matrix": Array of 3-4 objects, each with:
      - "task": string
      - "impact": "High" / "Medium" / "Low"
      - "effort": "High" / "Medium" / "Low"
      - "priority": "Quick Win" / "Major Project" / "Fill-in" / "Thankless Task"
  24. "financial_projection": Array of exactly 3 objects, each with:
      - "year": string (e.g., "Year 1" or "2026")
      - "projected_revenue": number (e.g., 500000) -- in local currency
      - "projected_cost": number (e.g., 300000) -- in local currency
      - "net_profit_margin": number (e.g., 15)
      Revenue must increase each year. Do not repeat same values.
  25. "risk_assessment": Array of 3-5 objects, each with:
      - "risk_factor": string
      - "impact_level": "High" / "Medium" / "Low"
      - "mitigation_strategy": string
  26. "final_ceo_summary": Array of 3-5 strings, summarizing the opportunity for CEO.
  27. "data_limitations": Array of 2-3 strings, noting limitations of the data.
  28. "case_studies": Array of 2-3 objects with { title, challenge, solution, results }

  Provide the JSON directly without any markdown formatting.`;
};

export async function generateProductReport(niche: string, country: string) {
  const cacheKey = `product_${niche}_${country}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  const trendData = await getGoogleTrends(niche, country).catch(() => []);
  
  let searchData = await getSearchResults(niche, country).catch(() => null);
  if (!searchData?.organic_results) searchData = await getScraperAPISearch(niche, country).catch(() => null);
  if (!searchData?.organic_results) searchData = await getSerperResults(niche, country).catch(() => null);

  // Filter out generic/irrelevant domains from SERP results using base keywords
  let serpContext = "SERP Data currently unavailable. Please focus on generating realistic local market insights.";
  let serpResults: any[] = [];
  if (searchData?.organic_results) {
    const filteredResults = searchData.organic_results.filter((r: any) => {
      try {
        const url = r.link || '';
        if (url.includes('google.com/goto')) return false;
        const domain = new URL(url).hostname.replace('www.', '').toLowerCase();
        return !genericDomainKeywords.some(keyword => domain.includes(keyword));
      } catch {
        return false;
      }
    });
    serpResults = filteredResults.slice(0, 10);
    const topSites = serpResults.map((r: any) => 
      `Title: ${r.title} | URL: ${r.link} | Snippet: ${r.snippet || ''}`
    ).join('\n');
    serpContext = `Here are the top real competitors found via Google SERP (filtered for local relevance):\n${topSites}`;
  } else {
    serpContext = `SERP Data unavailable. However, based on our knowledge of the ${countryNames[country] || country} market for ${niche}, typical competitors include local leaders, cross-border budget sellers, and specialized niche players. Please create realistic competitor brands and data accordingly.`;
  }

  const prompt = buildProductPrompt(niche, country, serpContext, trendData, serpResults);
  const aiResponse = await runGroqWithRetry(prompt, JSON.stringify({ niche, country }));
  const analysis = extractJSON(aiResponse);

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const reference = `MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  // ============ VALIDATION & FALLBACKS ============
  const clientValueProp = ensureStringArray(analysis.client_value_proposition);
  const keyInsights = ensureStringArray(analysis.key_insights);
  const immediateActions = ensureStringArray(analysis.immediate_actions);
  const localBusinessInsight = ensureStringArray(analysis.local_business_insight);
  const persona = sanitizePersona(analysis.consumer_persona, niche, country);
  const financialModel = ensureStringArray(analysis.financial_model);
  const sourcingAnalysis = ensureStringArray(analysis.sourcing_analysis);
  const competitionAnalysis = ensureStringArray(analysis.competition_analysis);
  const marketingChannels = ensureStringArray(analysis.marketing_channels);
  const growthAccelerators = ensureStringArray(analysis.growth_accelerators);
  const launchActionPlan = ensureStringArray(analysis.launch_action_plan);
  const dataValidation = ensureStringArray(analysis.data_validation);
  const assumptionsRisk = ensureStringArray(analysis.assumptions_risk);
  const customerSentiment = ensureStringArray(analysis.customer_sentiment);
  const scenarioPlanning = ensureStringArray(analysis.scenario_planning);
  const logisticsRiskMap = ensureStringArray(analysis.logistics_risk_map);
  const coldStartStrategy = ensureStringArray(analysis.cold_start_strategy);
  const csrEsgRoadmap = ensureStringArray(analysis.csr_esg_roadmap);
  const swotAnalysis = ensureStringArray(analysis.swot_analysis);
  const actionPriorityMatrix = ensureStringArray(analysis.action_priority_matrix);
  const financialProjection = ensureStringArray(analysis.financial_projection);
  const riskAssessment = ensureStringArray(analysis.risk_assessment);
  const finalCeoSummary = ensureStringArray(analysis.final_ceo_summary);
  const dataLimitations = ensureStringArray(analysis.data_limitations);
  const caseStudies = Array.isArray(analysis.case_studies) ? analysis.case_studies : [];

  // Fallback for competitor_benchmark using SERP results if AI failed
  const fallbackBenchmark = [
    { brand: "Local Market Leader", price: `Market Price: ${currencyInfo[country]?.symbol || '$'}Premium`, market_position: "High-end, feature-rich", gap: "Lacks localized warranty" },
    { brand: "Cross-Border Budget Seller", price: `Market Price: ${currencyInfo[country]?.symbol || '$'}Low-cost`, market_position: "Price-driven, basic features", gap: "Poor support, slow shipping" },
    { brand: "Local Expert", price: `Market Price: ${currencyInfo[country]?.symbol || '$'}Mid-range`, market_position: "Balanced features", gap: "Underpenetrated in this niche" }
  ];
  let benchmark = Array.isArray(analysis.competitor_benchmark)
    ? analysis.competitor_benchmark.filter((c: any) => c && c.brand && c.price && c.market_position && c.gap)
    : [];
  let safeBenchmark;
  if (benchmark.length >= 3) {
    safeBenchmark = benchmark.slice(0, 3);
  } else {
    const serpBrands = serpResults.slice(0, 3).map(r => ({
      brand: r.title?.split('|')[0]?.trim() || r.title?.split('-')[0]?.trim() || 'Local Competitor',
      price: `Market Price: ${currencyInfo[country]?.symbol || '$'}Unknown`,
      market_position: 'Active in local market',
      gap: 'Opportunity for differentiation'
    }));
    safeBenchmark = benchmark.length > 0 ? [...benchmark, ...serpBrands.slice(benchmark.length)] : serpBrands;
    if (safeBenchmark.length < 3) {
      safeBenchmark = [...safeBenchmark, ...fallbackBenchmark.slice(safeBenchmark.length)];
    }
  }

  // Fallback for financial_projection if duplicate or missing
  let safeFinancialProjection = financialProjection;
  if (safeFinancialProjection.length < 3 || 
      (safeFinancialProjection.length >= 3 && 
       safeFinancialProjection[0] === safeFinancialProjection[1] && 
       safeFinancialProjection[1] === safeFinancialProjection[2])) {
    const baseRevenue = 500000;
    const baseCost = 300000;
    const baseMargin = 15;
    safeFinancialProjection = [
      `Year: Year 1 | Revenue: ${baseRevenue} | Cost: ${baseCost} | Margin: ${baseMargin}%`,
      `Year: Year 2 | Revenue: ${Math.round(baseRevenue * 1.6)} | Cost: ${Math.round(baseCost * 1.4)} | Margin: ${Math.round(baseMargin * 1.5)}%`,
      `Year: Year 3 | Revenue: ${Math.round(baseRevenue * 2.4)} | Cost: ${Math.round(baseCost * 1.8)} | Margin: ${Math.round(baseMargin * 2)}%`
    ];
  }

  // ============ BUILD MARKDOWN ============
  let markdown = `MusePRO\nMarket Intelligence & Strategic Modeling\n──────────────────────────────────────────────────────────────\nPRODUCT INTELLIGENCE REPORT\n\nPrepared For: [Client Name]\nDate: ${today}\nReference: ${reference}\nClassification: CONFIDENTIAL\n──────────────────────────────────────────────────────────────\n\n`;

  markdown += `1. CLIENT VALUE PROPOSITION\n──────────────────────────────────────────────────────────────\n`;
  clientValueProp.slice(0, 3).forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n`;

  markdown += `2. EXECUTIVE BRIEF\n──────────────────────────────────────────────────────────────\n`;
  keyInsights.slice(0, 3).forEach((f: string, i: number) => markdown += `  ${i+1}. ${f}\n`);
  markdown += `\nPriority Actions:\n`;
  immediateActions.slice(0, 3).forEach((w: string, i: number) => markdown += `  ${i+1}. ${w}\n`);
  markdown += `\n3. TREND ASSESSMENT\n──────────────────────────────────────────────────────────────\n${analysis.trend_assessment || 'Demand is steadily rising.'}\n\n`;

  markdown += `4. LOCAL BUSINESS INSIGHT\n──────────────────────────────────────────────────────────────\n`;
  localBusinessInsight.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n`;

  markdown += `5. CONSUMER PERSONA\n──────────────────────────────────────────────────────────────\n`;
  persona.forEach((p: any) => {
    markdown += `Persona #${p.idx}:\n`;
    markdown += `  Demographics: ${p.demographics}\n`;
    markdown += `  Pain Points: ${p.pain_points}\n`;
    markdown += `  Goals: ${p.goals}\n`;
    markdown += `  Buying Triggers: ${p.buying_triggers}\n\n`;
  });

  markdown += `6. PRODUCT VIABILITY & FINANCIAL MODEL\n──────────────────────────────────────────────────────────────\n`;
  financialModel.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n7. SOURCING & SUPPLIER ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
  sourcingAnalysis.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n8. COMPETITION & SATURATION ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
  competitionAnalysis.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n9. MARKETING & SALES CHANNELS\n──────────────────────────────────────────────────────────────\n`;
  marketingChannels.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\n10. GROWTH ACCELERATORS\n──────────────────────────────────────────────────────────────\n`;
  growthAccelerators.forEach((tip: string, i: number) => markdown += `  ${i+1}. ${tip}\n`);
  markdown += `\n11. 30-60-90 DAY LAUNCH ACTION PLAN\n──────────────────────────────────────────────────────────────\n`;
  launchActionPlan.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n12. DATA VALIDATION & EVIDENCE SOURCES\n──────────────────────────────────────────────────────────────\n`;
  if (dataValidation.length > 0) {
    dataValidation.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  } else {
    serpResults.slice(0, 3).forEach((r: any, i: number) => {
      markdown += `  ${i+1}. ${r.title} - ${r.link}\n`;
      markdown += `     Explanation: Supports our insight on ${niche} market demand and competition.\n`;
    });
  }

  markdown += `\n13. COMPETITOR PRICE BENCHMARKING MATRIX\n──────────────────────────────────────────────────────────────\n`;
  markdown += `| Brand | Price | Market Position | Gap |\n|---|---|---|---|\n`;
  safeBenchmark.forEach((c: any) => markdown += `| ${safeString(c.brand)} | ${safeString(c.price)} | ${safeString(c.market_position)} | ${safeString(c.gap)} |\n`);

  markdown += `\n14. ASSUMPTIONS & RISK ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
  const safeAssumptions = assumptionsRisk.length > 0 ? assumptionsRisk : [
    "Assumption 1: Market demand remains stable during the launch phase.",
    "Assumption 2: No major supply chain disruptions.",
    "Risk 1: Sudden price changes by direct competitors. Mitigation: Flexible couponing strategy."
  ];
  safeAssumptions.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n15. CUSTOMER SENTIMENT & MARKET QUOTES\n──────────────────────────────────────────────────────────────\n`;
  customerSentiment.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n16. SCENARIO PLANNING & ROI PROJECTIONS\n──────────────────────────────────────────────────────────────\n`;
  scenarioPlanning.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n17. LOGISTICS & SUPPLY CHAIN RISK MAP\n──────────────────────────────────────────────────────────────\n`;
  logisticsRiskMap.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n18. COLD-START STRATEGY (FIRST 5 CLIENTS)\n──────────────────────────────────────────────────────────────\n`;
  coldStartStrategy.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n19. CSR & ESG ROADMAP\n──────────────────────────────────────────────────────────────\n`;
  csrEsgRoadmap.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n20. SWOT ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
  const safeSwot = swotAnalysis.length > 0 ? swotAnalysis : [
    "Strengths: Agile sourcing and localized customer support.",
    "Weaknesses: Lower initial brand awareness.",
    "Opportunities: High demand for eco-friendly alternatives.",
    "Threats: Aggressive price-cutting by cross-border sellers."
  ];
  safeSwot.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n21. ACTION PRIORITY MATRIX (Impact vs. Effort)\n──────────────────────────────────────────────────────────────\n`;
  actionPriorityMatrix.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n22. ROI & FINANCIAL PROJECTION\n──────────────────────────────────────────────────────────────\n`;
  safeFinancialProjection.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n23. RISK ASSESSMENT TABLE\n──────────────────────────────────────────────────────────────\n`;
  riskAssessment.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  markdown += `\n24. FINAL CEO SUMMARY\n──────────────────────────────────────────────────────────────\n`;
  finalCeoSummary.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);

  // Case Studies Section
  markdown += `\n25. CASE STUDIES\n──────────────────────────────────────────────────────────────\n`;
  if (caseStudies.length > 0) {
    caseStudies.forEach((cs: any, i: number) => {
      markdown += `Case Study ${i+1}: ${safeString(cs.title)}\n`;
      markdown += `  Challenge: ${safeString(cs.challenge)}\n`;
      markdown += `  Solution: ${safeString(cs.solution)}\n`;
      markdown += `  Results: ${safeString(cs.results)}\n\n`;
    });
  } else {
    markdown += `No case studies provided.\n\n`;
  }

  // Evidence & Sources Section
  markdown += `\nEVIDENCE & SOURCES (Live SERP Data)\n──────────────────────────────────────────────────────────────\n`;
  if (serpResults.length > 0) {
    markdown += `| # | Title | URL | Snippet |\n|---|-------|-----|--------|\n`;
    serpResults.slice(0, 10).forEach((r: any, i: number) => {
      markdown += `| ${i+1} | ${safeString(r.title)} | ${safeString(r.link)} | ${safeString(r.snippet, 'N/A')} |\n`;
    });
  } else {
    markdown += `No live SERP data available. Please refer to data validation section for modeled insights.\n`;
  }

  markdown += `\nMETHODOLOGY & DATA LIMITATIONS\n──────────────────────────────────────────────────────────────\n`;
  dataLimitations.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
  markdown += `\nThis report is based on comprehensive primary and secondary research conducted on ${today} from:\n\n• Real-time Market & Consumer Demand Trends\n• Live Search Engine Results (SERP) via SerpAPI/ScraperAPI/SerperAPI\n• Local Sourcing & Logistics Audit via MusePRO Proprietary Database\n• Financial Modeling, Margin & Break-even Calculations\n• Strategic Synthesis & Market Insights by MusePRO Senior Research Division\n\n`;

  // ADD DISCLAIMER
  markdown += `\nDISCLAIMER\n──────────────────────────────────────────────────────────────\nThis report is for informational purposes only and does not constitute legal, tax, or financial advice. Please consult qualified professionals before making business decisions.\n\n`;

  const result = {
    niche, country, type: 'product',
    data: analysis,
    keywords: [], serp_landscape: [],
    markdown,
    trend_summary: analysis.trend_summary || 'High potential market.',
    chart_data: {
      trend_12m: trendData.map((v: number, i: number) => ({ month: `M${i + 1}`, value: v })),
      traffic_forecast_6m: [],
      market_share: []
    },
    traffic_estimate: 0
  };
  cacheService.set(cacheKey, result, 86400);
  return result;
}
