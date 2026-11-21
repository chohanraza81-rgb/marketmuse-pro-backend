// seo.report.generator.ts
// ═══════════════════════════════════════════════════════════════════════════
// v13 — EVIDENCE-GATED + KEYWORD FALLBACK EDITION (12 COUNTRIES)
// ═══════════════════════════════════════════════════════════════════════════
// CHANGES FROM v12:
//   (20) magic_goldmine.top_keywords never empty if money keywords exist
//   (21) Regional/language table never empty (monolingual fallback)
//   (22) CPC never silently nulled; safe format with "No provider metric"
//   (23) Health score status text improved with explicit reasons
//   (24) Keyword metric status carries provenance per field
//   (25) 12-country currency locale safety (try/catch fallback)
// ═══════════════════════════════════════════════════════════════════════════

import { cacheService } from './cache';
import { getGoogleTrends } from './trends';
import { getSearchResults } from './serpapi';
import { getSerperResults } from './serper';
import { getScraperAPISearch } from './scraperapi';
import { convertCurrency } from './exchange';
import { runGroqWithRetry } from './groq';
import { isDataForSEOAvailable, fetchRealKeywordMetrics, fetchRealTrends, RealKeywordMetric } from './dataforseo.service';

import { getCalendarForCountry } from '../data/country-calendars';
import { getEditorsForCountry } from '../data/country-editors';
import { getRegulationsForCountry } from '../data/country-regulations';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG — 12 COUNTRIES
// ═══════════════════════════════════════════════════════════════════════════

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

const currencyInfo: Record<string, { symbol: string; code: string; locale: string }> = {
  us: { symbol: '$', code: 'USD', locale: 'en-US' },
  gb: { symbol: '£', code: 'GBP', locale: 'en-GB' },
  ca: { symbol: 'CA$', code: 'CAD', locale: 'en-CA' },
  au: { symbol: 'A$', code: 'AUD', locale: 'en-AU' },
  de: { symbol: '€', code: 'EUR', locale: 'de-DE' },
  sg: { symbol: 'S$', code: 'SGD', locale: 'en-SG' },
  sa: { symbol: 'SAR ', code: 'SAR', locale: 'en-SA' },
  ae: { symbol: 'AED ', code: 'AED', locale: 'en-AE' },
  pk: { symbol: 'PKR ', code: 'PKR', locale: 'en-PK' },
  in: { symbol: '₹', code: 'INR', locale: 'en-IN' },
  tr: { symbol: '₺', code: 'TRY', locale: 'tr-TR' },
  my: { symbol: 'RM ', code: 'MYR', locale: 'ms-MY' },
};

const isMultilingual: Record<string, boolean> = {
  us: false, gb: false, ca: true, au: false, de: false,
  sg: true, sa: true, ae: true, pk: true, in: true, tr: false, my: true,
};

const GENERIC_DOMAINS = [
  'wikipedia', 'reddit', 'quora', 'youtube', 'facebook', 'twitter', 'x.com',
  'linkedin', 'pinterest', 'medium', 'blogspot', 'wordpress.com', 'tumblr',
  'instagram', 'tiktok', 'slideshare', 'scribd',
  'amazon.com', 'ebay.com', 'alibaba.com', 'aliexpress.com', 'etsy.com',
  'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com',
  'forbes.com', 'businessinsider.com', 'investopedia.com', 'entrepreneur.com',
  'hubspot.com', 'shopify.com', 'wix.com', 'squarespace.com', 'godaddy.com',
  'coursera.org', 'udemy.com', 'skillshare.com', 'khanacademy.org',
  'printful.com', 'printify.com', 'teespring.com',
];

// ═══════════════════════════════════════════════════════════════════════════
// SAFE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const safeNumber = (val: any, fallback: number = 0): number => {
  if (val === 0 || val === '0') return 0;
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null' || trimmed === 'N/A') return fallback;
  }
  const num = Number(val);
  return Number.isFinite(num) ? num : fallback;
};

const safeString = (val: any, fallback: string = 'Evidence not supplied'): string => {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') {
    const cleaned = val.replace(/-mock/g, '').replace(/\.mock/g, '').trim();
    if (!cleaned || /^(undefined|null|n\/a|not available)$/i.test(cleaned)) return fallback;
    return cleaned;
  }
  return String(val);
};

const safeArray = (val: any): any[] => (Array.isArray(val) ? val : []);

const formatCurrency = (num: number, country: string): string => {
  const info = currencyInfo[country] || currencyInfo.us;
  try {
    return new Intl.NumberFormat(info.locale, { style: 'currency', currency: info.code, maximumFractionDigits: 2 }).format(num);
  } catch {
    return `${info.symbol}${num.toFixed(2)}`;
  }
};

const formatCpcSafe = (cpc: any, country: string): string => {
  const num = safeNumber(cpc, -1);
  if (num <= 0) return 'No provider metric';
  return formatCurrency(num, country);
};

const extractNumber = (val: any): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

const cleanMarkdown = (markdown: string): string => {
  return markdown
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\bEst\.\s*/g, 'Projected ')
    .replace(/\bEstimated\s+/gi, 'Projected ')
    .replace(/\(Modeled\)/g, '(Pattern-Based)')
    .replace(/\bModeled\s+/g, 'Pattern-Based ')
    .replace(/\s+\)/g, ')')
    .replace(/\s+,/g, ',')
    .replace(/([^\n])\s{2,}([^\n])/g, '$1 $2');
};

// ═══════════════════════════════════════════════════════════════════════════
// v13: KEYWORD FALLBACK BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

const buildTopGoldmineKeywords = (keywords: any[]): any[] => {
  const moneyKeywords = keywords.filter((k: any) => k.tier === 'money');
  if (moneyKeywords.length === 0) return [];
  const verified = moneyKeywords.filter(
    (k: any) => k.dataSource === 'dataforseo' && safeNumber(k.volume, 0) > 0 && safeNumber(k.cpc, 0) > 0
  );
  if (verified.length > 0) {
    return [...verified]
      .sort((a, b) => safeNumber(b.cpc, 0) - safeNumber(a.cpc, 0))
      .slice(0, 5)
      .map((k: any) => ({
        keyword: k.keyword,
        volume: k.volume,
        kd: k.kd,
        cpc: k.cpc,
        intent: k.intent,
        status: 'verified (DataForSEO)',
      }));
  }
  return moneyKeywords.slice(0, 5).map((k: any) => ({
    keyword: k.keyword,
    volume: null,
    kd: null,
    cpc: null,
    intent: k.intent,
    status: 'Metrics unverified — DataForSEO returned no volume/CPC/KD. Keyword retained as intent candidate.',
  }));
};

const buildRegionalKeywordTable = (keywords: any[], country: string): any[] => {
  if (isMultilingual[country]) {
    const languagePattern = country === 'my'
      ? /cara |dengan |untuk |jana |buat |daftar |teknologi/i
      : country === 'ae' || country === 'sa' || country === 'pk'
        ? /[\u0600-\u06FF]/
        : country === 'in'
          ? /[\u0900-\u097F]|[\u0A00-\u0A7F]|[\u0B00-\u0B7F]|[\u0C00-\u0C7F]|[\u0D00-\u0D7F]/
          : country === 'ca'
            ? /[àâçéèêëîïôûùüÿœæ]|\b(meilleur|prix|comment|logiciel|référencement)\b/i
            : /[\u0600-\u06FF]|[\u4E00-\u9FFF]|[\u0B80-\u0BFF]/;
    const local = keywords.filter((k: any) => languagePattern.test(String(k.keyword || ''))).slice(0, 5);
    if (local.length > 0) {
      return local.map((k: any) => ({ keyword: k.keyword, volume: k.volume, kd: k.kd, cpc: k.cpc, scope: 'local-language' }));
    }
  }
  return keywords.slice(0, 5).map((k: any) => ({
    keyword: k.keyword,
    volume: k.volume,
    kd: k.kd,
    cpc: k.cpc,
    scope: 'regional-intent candidate (no measured regional split)',
  }));
};

const buildHealthStatus = (overall: number | null, swotCount: number): string => {
  if (overall !== null) {
    if (overall >= 75) return '🟢 HEALTHY';
    if (overall >= 55) return '🟡 NEEDS ATTENTION';
    return '🔴 CRITICAL';
  }
  if (swotCount === 0) return 'NOT SCORED — site audit and SWOT evidence required (no crawl or provider export supplied)';
  return 'NOT SCORED — full site audit required to finalize score';
};

// ═══════════════════════════════════════════════════════════════════════════
// ECONOMICS
// ═══════════════════════════════════════════════════════════════════════════

const getEconomics = (country: string, analysis?: any) => {
  const input = analysis?.business_inputs || {};
  const AOV = safeNumber(input.aov, 0);
  const CAC = safeNumber(input.cac, 0);
  const LTV = safeNumber(input.lifetime_value, 0);
  const MONTHLY_REVENUE = safeNumber(input.monthly_contribution_per_customer, 0);
  const INVESTMENT = safeNumber(input.six_month_investment, 0);
  const PIPELINE_6MO = safeNumber(input.six_month_pipeline, 0);
  const GROSS_PROFIT_6MO = input.six_month_attributed_gross_profit === null || input.six_month_attributed_gross_profit === undefined || input.six_month_attributed_gross_profit === '' ? null : safeNumber(input.six_month_attributed_gross_profit, 0);
  const configured = AOV > 0 && INVESTMENT > 0;
  return {
    AOV, CAC, LTV, MONTHLY_REVENUE, INVESTMENT, PIPELINE_6MO, GROSS_PROFIT_6MO, configured,
    MONTHLY_FIXED_COST: safeNumber(input.monthly_fixed_cost, 0),
    VARIABLE_COST_PER_UNIT: safeNumber(input.variable_cost_per_customer, 0),
    LIFETIME_MONTHS: safeNumber(input.lifetime_months, 0),
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// RECONCILE ALL (v13)
// ═══════════════════════════════════════════════════════════════════════════

const reconcileAll = (analysis: any, keywords: any[], country: string): any => {
  const economics = getEconomics(country, analysis);
  const AOV = economics.AOV;
  const suppliedSwot = safeArray(analysis.competitor_teardown?.swot_scored);
  suppliedSwot.forEach((item: any) => { item.score = Math.min(10, Math.max(0, safeNumber(item.score, 0))); });

  if (!analysis.executive_summary) analysis.executive_summary = {};
  if (!analysis.magic_goldmine) analysis.magic_goldmine = {};
  if (!analysis.ground_intel) analysis.ground_intel = {};

  // Always populate top_keywords
  analysis.magic_goldmine.top_keywords = buildTopGoldmineKeywords(keywords);

  // Always populate regional table
  const regionalKeywords = buildRegionalKeywordTable(keywords, country);
  if (regionalKeywords.length > 0) {
    if (!analysis.ground_intel.language_split) analysis.ground_intel.language_split = {};
    if (!safeArray(analysis.ground_intel.language_split.top_keywords).length) {
      analysis.ground_intel.language_split.top_keywords = regionalKeywords.map((k: any) => ({
        keyword: k.keyword, volume: k.volume, kd: k.kd, cpc: k.cpc, scope: k.scope,
      }));
    }
    if (!analysis.ground_intel.language_split.summary) {
      analysis.ground_intel.language_split.summary = isMultilingual[country]
        ? `Local-language keyword candidates were detected for ${countryNames[country]}. This is a language-scope note, not a measured language-demand share.`
        : `${countryNames[country]} is a primarily monolingual search market. The keywords below are regional-intent candidates from the canonical keyword portfolio; no measured regional volume split is available from the connected providers.`;
    }
  }

  if (!economics.configured) {
    analysis.executive_summary.estimated_roi = { investment: 'Not supplied', pipeline: 'Not supplied', roi_percent: 'Not calculated — provide business_inputs', pipeline_to_investment_ratio: 'Not calculated' };
    safeArray(analysis.key_findings).forEach((f: any) => { f.size_of_prize = 'Not calculated — client conversion and value inputs required'; f.size_formula = 'Requires verified keyword volume, click capture rate, lead conversion rate and AOV'; });
    safeArray(analysis.executive_summary.top_findings).forEach((f: any) => { f.size_of_prize = 'Not calculated'; });
    if (analysis.current_state) { analysis.current_state.kpi_dashboard = []; }
    if (analysis.competitive_landscape) { analysis.competitive_landscape.comparison_table = []; analysis.competitive_landscape.backlink_gap = []; }
    if (analysis.competitor_teardown) { analysis.competitor_teardown.feature_matrix = []; analysis.competitor_teardown.swot_scored = []; analysis.competitor_teardown.pricing_deconstruction = []; }

    analysis.financial_projection = { investment: [], roi_summary: 'Not calculated — client investment and pipeline inputs are required', roi_formula: 'Requires business_inputs.six_month_pipeline and business_inputs.six_month_investment', monthly_projection: [] };
    analysis.unit_economics = { cac: { value: 'Not supplied' }, ltv: { value: 'Not supplied' }, ltv_cac_ratio: { value: 'Not calculated' }, payback_period: { months: 'Not calculated' }, gross_margin_per_tier: [] };
    analysis.break_even_analysis = { fixed_costs: 'Not supplied', revenue_per_unit: 'Not supplied', variable_cost_per_unit: 'Not supplied', contribution_margin: 'Not calculated', units_required: 'Not calculated', traffic_required: 'Not calculated', months_to_breakeven: 'Not calculated', formula: 'Requires client fixed costs, AOV and variable cost inputs' };
    analysis.sensitivity_analysis = { best_case: { scenario: 'Best Case', pipeline: 'Not modeled', roi: 'Not calculated', ltv_cac: 'Not calculated', breakeven_months: 'Not calculated' }, expected_case: { scenario: 'Expected', pipeline: 'Not modeled', roi: 'Not calculated', ltv_cac: 'Not calculated', breakeven_months: 'Not calculated' }, worst_case: { scenario: 'Worst Case', pipeline: 'Not modeled', roi: 'Not calculated', ltv_cac: 'Not calculated', breakeven_months: 'Not calculated' } };
    analysis.magic_goldmine.revenue_projection = { monthly_traffic: 'Not forecast', conversion_rate: 'Not supplied', monthly_leads: 'Not forecast', avg_deal_value: 'Not supplied', monthly_pipeline: 'Not calculated', formula: 'Requires validated keyword volume, capture rate, conversion rate and AOV' };
    if (analysis.magic_playbook?.backlink_strategy) { analysis.magic_playbook.backlink_strategy.total_backlinks = 'Not verified'; analysis.magic_playbook.backlink_strategy.local_percentage = 'Not verified'; analysis.magic_playbook.backlink_strategy.top_sources = []; }
    analysis.data_limitations = [...safeArray(analysis.data_limitations), 'Financial projections, unit economics and break-even outputs are withheld until client-specific commercial inputs are provided.'];
    analysis.executive_summary.health_score = { overall: null, status: buildHealthStatus(null, suppliedSwot.length), breakdown: [] };
    return analysis;
  }

  // Finance recompute
  const investment = economics.INVESTMENT;
  const pipeline6mo = economics.PIPELINE_6MO;
  const grossProfit6mo = economics.GROSS_PROFIT_6MO;
  const roiPercent = grossProfit6mo !== null ? Math.round(((grossProfit6mo - investment) / investment) * 100) : null;
  const pipelineCoverage = pipeline6mo > 0 ? (pipeline6mo / investment).toFixed(2) : null;

  analysis.executive_summary.estimated_roi = {
    investment: formatCurrency(investment, country),
    pipeline: pipeline6mo > 0 ? formatCurrency(pipeline6mo, country) : 'Not supplied',
    roi_percent: roiPercent === null ? 'Not calculated — pipeline is not realized gross profit' : `${roiPercent}%`,
    pipeline_to_investment_ratio: pipelineCoverage === null ? 'Not calculated' : `${pipelineCoverage}x`,
  };

  if (!analysis.financial_projection) analysis.financial_projection = {};
  analysis.financial_projection.investment = [{ item: 'Total 6-Month Investment (client supplied)', cost: formatCurrency(investment, country) }];
  analysis.financial_projection.roi_summary = roiPercent === null ? 'ROI is not calculated: realized six-month attributed gross profit was not supplied.' : `6-Month ROI on attributed gross profit: ${roiPercent}%`;
  analysis.financial_projection.roi_formula = grossProfit6mo === null ? 'ROI = (attributed gross profit − investment) ÷ investment × 100; attributed gross profit input is required.' : `(${formatCurrency(grossProfit6mo, country)} − ${formatCurrency(investment, country)}) ÷ ${formatCurrency(investment, country)} × 100 = ${roiPercent}%`;
  analysis.financial_projection.monthly_projection = [];

  // Unit economics
  const CAC = economics.CAC;
  const LTV = economics.LTV;
  const MONTHLY_REVENUE = economics.MONTHLY_REVENUE;
  const ltvCacRatio = LTV > 0 && CAC > 0 ? (LTV / CAC).toFixed(1) : 'N/A';
  const paybackMonths = CAC > 0 && MONTHLY_REVENUE > 0 ? Math.ceil(CAC / MONTHLY_REVENUE) : 0;

  analysis.unit_economics = {
    cac: { value: CAC > 0 ? formatCurrency(CAC, country) : 'Not supplied', calculation: 'Blended organic acquisition spend ÷ customers acquired', benchmark: 'Not supplied — no benchmark source attached' },
    ltv: { value: LTV > 0 ? formatCurrency(LTV, country) : 'Not supplied', calculation: LTV > 0 ? 'Client-supplied lifetime_value' : 'Cannot derive LTV from AOV and lifetime duration alone', benchmark: 'Not supplied' },
    ltv_cac_ratio: { value: ltvCacRatio === 'N/A' ? 'Not calculated' : `${ltvCacRatio}:1`, health: ltvCacRatio === 'N/A' ? 'Not calculated' : parseFloat(ltvCacRatio) >= 3 ? '🟢 Healthy' : parseFloat(ltvCacRatio) >= 1.5 ? '🟡 Moderate' : '🔴 Critical', benchmark: 'Interpret using gross margin, retention and payback context' },
    payback_period: { months: paybackMonths > 0 ? String(paybackMonths) : 'Not calculated', calculation: `${formatCurrency(CAC, country)} CAC ÷ ${formatCurrency(MONTHLY_REVENUE, country)} monthly contribution`, benchmark: 'Agree target with client finance team' },
    gross_margin_per_tier: [],
  };

  // Break-even
  const fixedCostsMonthly = economics.MONTHLY_FIXED_COST;
  const variableCostPerUnit = economics.VARIABLE_COST_PER_UNIT;
  const contributionMargin = AOV - variableCostPerUnit;
  const unitsRequired = fixedCostsMonthly > 0 && contributionMargin > 0 ? Math.ceil(fixedCostsMonthly / contributionMargin) : 0;
  analysis.break_even_analysis = {
    fixed_costs: fixedCostsMonthly > 0 ? formatCurrency(fixedCostsMonthly, country) : 'Not supplied',
    revenue_per_unit: formatCurrency(AOV, country),
    variable_cost_per_unit: variableCostPerUnit > 0 ? formatCurrency(variableCostPerUnit, country) : 'Not supplied',
    contribution_margin: contributionMargin > 0 ? formatCurrency(contributionMargin, country) : 'Not calculated',
    units_required: unitsRequired > 0 ? String(unitsRequired) : 'Not calculated',
    traffic_required: 'Not calculated — visitor-to-customer conversion rate required',
    months_to_breakeven: 'Not calculated',
    formula: 'Monthly fixed costs ÷ contribution margin; traffic requires a measured visitor-to-customer conversion rate',
  };

  analysis.sensitivity_analysis = {
    best_case: { scenario: 'Best Case', pipeline: 'Requires approved scenario inputs', roi: 'Not calculated', ltv_cac: 'Not calculated', breakeven_months: 'Not calculated' },
    expected_case: { scenario: 'Expected', pipeline: pipeline6mo > 0 ? formatCurrency(pipeline6mo, country) : 'Not supplied', roi: roiPercent === null ? 'Not calculated — gross profit required' : `${roiPercent}%`, ltv_cac: 'Calculated from supplied unit economics', breakeven_months: 'Not calculated without monthly fixed-cost and margin inputs' },
    worst_case: { scenario: 'Worst Case', pipeline: 'Requires approved scenario inputs', roi: 'Not calculated', ltv_cac: 'Not calculated', breakeven_months: 'Not calculated' },
  };

  // Health score
  const swot = safeArray(analysis.competitor_teardown?.swot_scored);
  const swotAvg = swot.length > 0
    ? Math.round((swot.reduce((s: number, x: any) => s + Math.min(10, Math.max(0, safeNumber(x.score, 0))), 0) / swot.length) * 10)
    : null;
  analysis.executive_summary.health_score = swotAvg === null
    ? { overall: null, status: buildHealthStatus(null, 0), breakdown: [] }
    : { overall: swotAvg, status: buildHealthStatus(swotAvg, swot.length), breakdown: [{ category: 'Evidence-backed SWOT average', score: swotAvg, status: swotAvg >= 70 ? '🟢' : swotAvg >= 50 ? '🟡' : '🔴' }] };

  // Magic goldmine revenue projection
  const verifiedTop = analysis.magic_goldmine.top_keywords.filter((k: any) => k.status === 'verified (DataForSEO)');
  const magicTotalVol = verifiedTop.length > 0 ? verifiedTop.reduce((max: number, k: any) => Math.max(max, safeNumber(k.volume, 0)), 0) : 0;
  const captureRateRaw = safeNumber(analysis.business_inputs?.organic_click_capture_rate, 0);
  const leadConversionRateRaw = safeNumber(analysis.business_inputs?.lead_conversion_rate, 0);
  const captureRate = captureRateRaw > 0 && captureRateRaw <= 1 ? captureRateRaw : 0;
  const leadConversionRate = leadConversionRateRaw > 0 && leadConversionRateRaw <= 1 ? leadConversionRateRaw : 0;
  const magicTraffic = captureRate > 0 && magicTotalVol > 0 ? Math.round(magicTotalVol * captureRate) : 0;
  const magicLeads = leadConversionRate > 0 && magicTraffic > 0 ? Math.round(magicTraffic * leadConversionRate) : 0;

  analysis.magic_goldmine.revenue_projection = {
    monthly_traffic: magicTraffic > 0 ? magicTraffic : (magicTotalVol === 0 ? 'Not calculated — no verified keyword volume available' : 'Not calculated — organic_click_capture_rate required'),
    conversion_rate: leadConversionRate > 0 ? `${(leadConversionRate * 100).toFixed(2)}%` : 'Not supplied',
    monthly_leads: magicLeads > 0 ? magicLeads : 'Not calculated',
    avg_deal_value: AOV > 0 ? formatCurrency(AOV, country) : 'Not supplied',
    monthly_pipeline: 'Not calculated — a qualified-lead-to-customer close rate and deal value are required',
    formula: 'Monthly traffic = highest single verified keyword volume × client-supplied organic_click_capture_rate; leads = traffic × client-supplied lead_conversion_rate.',
  };

  // Backlinks
  if (!analysis.magic_playbook) analysis.magic_playbook = {};
  if (!analysis.magic_playbook.backlink_strategy) analysis.magic_playbook.backlink_strategy = {};
  analysis.magic_playbook.backlink_strategy.total_backlinks = 'Not verified — backlink provider export required';
  analysis.magic_playbook.backlink_strategy.local_percentage = 'Not verified';
  analysis.magic_playbook.backlink_strategy.top_sources = [];
  if (!analysis.competitive_landscape) analysis.competitive_landscape = {};
  analysis.competitive_landscape.backlink_gap = [];
  analysis.magic_playbook.target_competitor = { name: 'Not identified — product competitor research required', da: null, traffic: null };

  if (analysis.executive_summary.top_findings) analysis.executive_summary.top_findings = analysis.executive_summary.top_findings.slice(0, 3);

  return analysis;
};

// ═══════════════════════════════════════════════════════════════════════════
// OTHER HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const dedupeCaseStudyTitles = (caseStudies: any[]): void => {
  caseStudies.forEach((cs: any) => {
    if (cs.title) cs.title = String(cs.title).replace(/^Case Study \d+:\s*/i, '').replace(/^CASE STUDY \d+:\s*/i, '').trim();
  });
};

const cleanInsightPrefixes = (analysis: any): void => {
  if (Array.isArray(analysis.key_insights)) {
    analysis.key_insights = analysis.key_insights.map((insight: string) => String(insight).replace(/^Insight \d+:\s*/i, '').trim());
  }
};

const getRelevanceKeywords = (niche: string): string[] => {
  const lower = niche.toLowerCase();
  const base = lower.split(/\s+/).filter((w) => w.length > 3);
  const nicheMap: Record<string, string[]> = {
    video: ['production', 'vlog', 'filming', 'editing', 'content', 'youtube'],
    backend: ['server', 'hosting', 'vps', 'cloud', 'infrastructure'],
    seo: ['keyword', 'ranking', 'search', 'content', 'traffic'],
    blog: ['blogging', 'content', 'writing', 'publishing'],
    hosting: ['server', 'cloud', 'vps', 'infrastructure'],
  };
  for (const [key, values] of Object.entries(nicheMap)) {
    if (lower.includes(key)) return [...base, ...values];
  }
  return base;
};

const scoreSerpRelevance = (result: any, niche: string, country: string): number => {
  const title = String(result.title || '').toLowerCase();
  const url = String(result.link || '').toLowerCase();
  let score = 0;
  getRelevanceKeywords(niche).forEach((kw) => {
    if (title.includes(kw.toLowerCase())) score += 10;
    if (url.includes(kw.toLowerCase())) score += 5;
  });
  const countryTLD: Record<string, string> = { us: '.com', gb: '.co.uk', ca: '.ca', au: '.com.au', de: '.de', sg: '.sg', sa: '.sa', ae: '.ae', pk: '.pk', in: '.in', tr: '.tr', my: '.my' };
  if (url.includes(countryTLD[country] || '.com')) score += 8;
  if (title.length < 20) score -= 5;
  return score;
};

const buildSerpQuery = (niche: string, country: string): string => {
  const countryName = countryNames[country] || country;
  return `${niche} ${countryName} ${new Date().getFullYear()}`;
};

const filterAndScoreSerp = (results: any[], niche: string, country: string): any[] => {
  if (!Array.isArray(results)) return [];
  return results
    .filter((r: any) => {
      if (!r.link || !r.title) return false;
      try {
        const domain = new URL(r.link).hostname.replace('www.', '').toLowerCase();
        if (GENERIC_DOMAINS.some((g) => domain.includes(g))) return false;
        return !r.link.includes('google.com/goto');
      } catch { return false; }
    })
    .map((r: any) => ({ ...r, _score: scoreSerpRelevance(r, niche, country) }))
    .filter((r: any) => r._score > 5)
    .sort((a: any, b: any) => b._score - a._score)
    .map(({ _score, ...rest }: any) => rest);
};

const classifyIntent = (keyword: string): 'informational' | 'commercial' | 'transactional' | 'navigational' => {
  const k = String(keyword || '').toLowerCase().trim();
  if (!k) return 'informational';
  if (/\b(login|log in|sign in|sign up|app|download|official|website|portal|account)\b/.test(k)) return 'navigational';
  if (/\b(buy|purchase|price|pricing|cost|cheap|discount|deal|order|book|hire|subscribe|register|registration|setup cost|fee|fees|quote)\b/.test(k)) return 'transactional';
  if (/\b(best|top|review|reviews|compare|comparison|vs|versus|alternatives|recommended|ranked|rated)\b/.test(k)) return 'commercial';
  if (/\b(how to|what is|what are|why|when|where|who|guide|tutorial|learn|tips|examples|explained|meaning|definition|step by step|beginner)\b/.test(k)) return 'informational';
  if (/\b(start|starting|begin|create|build|launch|make money|monetize|earn)\b/.test(k)) return 'commercial';
  return 'informational';
};

const VALID_INTENTS = ['informational', 'commercial', 'transactional', 'navigational'];
const resolveIntent = (kw: any): string => {
  const aiIntent = safeString(kw?.intent, '').toLowerCase();
  if (VALID_INTENTS.includes(aiIntent)) return aiIntent;
  return classifyIntent(kw?.keyword);
};

const extractJSON = (raw: string): any => {
  if (typeof raw === 'object') return raw;
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) cleaned = cleaned.substring(start, end + 1);
  try { return JSON.parse(cleaned); }
  catch {
    const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    try { return JSON.parse(fixed); }
    catch {
      let completed = cleaned;
      let braceCount = (completed.match(/{/g) || []).length;
      let closeCount = (completed.match(/}/g) || []).length;
      while (closeCount < braceCount) { completed += '}'; closeCount++; }
      try { return JSON.parse(completed); } catch { throw new Error('AI response is not valid JSON'); }
    }
  }
};

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<any>): Promise<any[]> {
  const results: any[] = [];
  const executing: Promise<any>[] = [];
  for (const item of items) {
    const p = fn(item).then((result) => { executing.splice(executing.indexOf(p), 1); return result; });
    results.push(p);
    executing.push(p);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

function formatTable(headers: string[], rows: string[][]): string {
  const escape = (v: any) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  let table = `| ${headers.map(escape).join(' | ')} |\n`;
  table += `|${headers.map(() => '---').join('|')}|\n`;
  const visibleRows = rows.length ? rows : [['No verified source evidence supplied for this section', ...headers.slice(1).map(() => 'Not measured / not supplied')]];
  visibleRows.forEach((row) => {
    table += `| ${headers.map((_, i) => escape(row[i] ?? 'Not measured / not supplied')).join(' | ')} |\n`;
  });
  return table;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════

const buildSEOPrompt = (niche: string, country: string, serpResults: any[], trendData: number[]): string => {
  const countryName = countryNames[country] || country;
  const currentYear = new Date().getFullYear();
  const trendSummary = trendData.length > 0
    ? `Provider-returned search trend observations (relative interest 0-100): ${trendData.join(', ')}`
    : 'No provider-backed trend observations returned. Do not infer seasonality or trend direction.';
  const currencySymbol = currencyInfo[country]?.symbol || '$';
  const multilingual = isMultilingual[country] ? 'YES' : 'NO';
  const regs = getRegulationsForCountry(country);
  const regsBlock = `- Data Privacy: ${regs.dataPrivacy}\n  - Tax Framework: ${regs.taxFramework}\n  - Key Compliance: ${regs.keyCompliance}\n  - Local Authority: ${regs.localAuthority}`;

  const serpBlock = serpResults.length > 0
    ? serpResults.slice(0, 10).map((r: any, i: number) => {
        try { return `${i + 1}. ${r.title} | ${new URL(r.link).hostname.replace('www.', '')} | ${r.link}`; }
        catch { return `${i + 1}. ${r.title} | ${r.link}`; }
      }).join('\n')
    : 'No live SERP data available.';

  return `You are a senior SEO strategist at a top-tier digital agency. Write like a human consultant.

Target Market: ${countryName}. Current Year: ${currentYear}.
Local Currency: ${currencySymbol}
Is ${countryName} multilingual? ${multilingual}

**Return ONLY valid JSON. No markdown blocks.**

═══════════════════════════════════════════════════════════════════════
📋 REPORT STANDARDS — NON-NEGOTIABLE
═══════════════════════════════════════════════════════════════════════
RULE #1 — VALUE: Every line earns its place. No filler.
RULE #1A — SCOPE: No target website is supplied unless passed by the caller. Never claim client rankings, traffic, technical defects, backlink metrics, conversion rates or site-specific findings without a crawl / first-party data source.
RULE #2 — EVIDENCE: Every quantitative claim must have a named source, timestamp and scope; otherwise return null / "Not verified".
RULE #3 — NO FABRICATED NUMBERS: Never invent volumes, CPC, KD, competitor metrics, conversion rates, financial inputs, case studies or market-share percentages.
RULE #4 — NO AI MENTION.
RULE #5 — NO FAKE QUOTES.
RULE #6 — NO UNIFORM DATA.
RULE #7 — Distinguish observed, provider-estimated, model-generated and client-supplied values.
RULE #8 — REAL COMPETITOR NAMES: Extract brand names from SERP.
RULE #9 — Do not create backlink metrics or backlink-domain lists.
RULE #10 — SIZE-OF-PRIZE: calculate only when verified keyword volumes and client-supplied conversion/AOV inputs exist; otherwise return "Not calculated".
RULE #11 — CURRENCY CONSISTENCY: Use the report currency only when source currency and conversion are documented.

═══════════════════════════════════════════════════════════════════════
🎯 REAL SERP COMPETITORS (USE THESE NAMES)
═══════════════════════════════════════════════════════════════════════
${serpBlock}

═══════════════════════════════════════════════════════════════════════
🌍 COUNTRY DATA
═══════════════════════════════════════════════════════════════════════
- ground_intel.cultural_calendar → []
- ground_intel.editor_intelligence → []

REGULATORY FRAMEWORK for ${countryName}:
  ${regsBlock}

═══════════════════════════════════════════════════════════════════════
⚠️ STRICT COUNTS
═══════════════════════════════════════════════════════════════════════
- keywords: EXACTLY 50 (14 money + 18 growth + 18 long-tail)
- magic_goldmine.top_keywords: up to 5; [] if no verified metrics
- key_findings: EXACTLY 5
- executive_summary.top_findings: EXACTLY 3
- competitor_teardown.feature_matrix: [] unless backed by verified provider/page evidence
- competitor_teardown.swot_scored: [] unless an actual site audit has been completed
- competitor_teardown.pricing_deconstruction: [] unless dated public pricing evidence is supplied
- competitor_teardown.content_gap_scored: up to 6, only when actual SERP evidence supports it
- competitor_teardown.action_plan: evidence-based actions; no invented uplift percentages

═══════════════════════════════════════════════════════════════════════
⚠️ MATH REFERENCE
═══════════════════════════════════════════════════════════════════════
BUSINESS ECONOMICS = NOT PROVIDED. Do not invent AOV, CAC, LTV, MRR, investment, pipeline, ROI or break-even values.
If client business_inputs are supplied, use only those values and preserve their currency. Otherwise return null / "Not supplied".

═══════════════════════════════════════════════════════════════════════
⚠️ SIZE-OF-PRIZE FORMULA
═══════════════════════════════════════════════════════════════════════
For EVERY key_finding:
  size_of_prize = N kw × V vol × C% CVR × ${currencySymbol}A AOV
  Show the arithmetic. The result MUST equal the product.
  NO division by 10. NO shortcuts.
If any required input is missing, return null / "Not calculated" and explain which input is missing.

═══════════════════════════════════════════════════════════════════════
⚠️ CASE STUDY RULES
═══════════════════════════════════════════════════════════════════════
- If multilingual: mention "English + [local language]"
- Include case studies ONLY when the user supplies a verifiable case-study source and permission to publish.
- If no verified case study is supplied, return an empty array.

**Google Trends Data:** ${trendSummary}

═══════════════════════════════════════════════════════════════════════
RETURN JSON (ALL FIELDS REQUIRED):
═══════════════════════════════════════════════════════════════════════

{
  "business_inputs": { "aov": null, "cac": null, "lifetime_value": null, "lifetime_months": null, "monthly_contribution_per_customer": null, "six_month_investment": null, "six_month_pipeline": null, "six_month_attributed_gross_profit": null, "monthly_fixed_cost": null, "variable_cost_per_customer": null, "organic_click_capture_rate": null, "lead_conversion_rate": null },
  "executive_summary": { "headline": "...", "top_findings": [{"rank": 1, "priority": "CRITICAL", "title": "...", "size_of_prize": "...", "root_cause": "..."}], "what_this_means": "...", "next_90_days": ["...", "...", "..."], "estimated_roi": { "investment": "Not supplied", "pipeline": "Not supplied", "roi_percent": "Not calculated" }, "health_score": { "overall": null, "status": "NOT SCORED — site audit evidence required", "breakdown": [] } },
  "current_state": { "data_sources": [], "kpi_dashboard": [], "narrative": "..." },
  "ground_intel": { "cultural_calendar": [], "language_split": { "summary": "...", "top_keywords": [] }, "buyer_behavior": ["...", "...", "...", "..."], "editor_intelligence": [], "competitor_weaknesses": [{"competitor": "...", "weakness": "..."}] },
  "magic_goldmine": { "cluster_name": "...", "criteria_met": ["...", "...", "...", "..."], "why_invisible": ["...", "...", "..."], "top_keywords": [{"keyword": "...", "volume": null, "kd": null, "cpc": null, "intent": "transactional"}], "revenue_projection": { "monthly_traffic": null, "conversion_rate": null, "monthly_leads": null, "avg_deal_value": null, "monthly_pipeline": null, "formula": "..." }, "evidence": ["...", "...", "...", "..."] },
  "magic_playbook": { "target_competitor": { "name": null, "da": null, "traffic": null }, "timeline": [{"date": "...", "action": "...", "impact": "..."}], "content_formula": ["...", "...", "...", "..."], "backlink_strategy": { "total_backlinks": null, "local_percentage": null, "top_sources": [] }, "vulnerabilities": ["...", "...", "...", "..."], "counter_play": [{"week": "...", "action": "..."}], "evidence": ["...", "...", "...", "..."] },
  "key_findings": [{"rank": 1, "priority": "CRITICAL", "title": "...", "category": "...", "impact": "HIGH", "effort": "LOW", "what_is_happening": "...", "why_it_matters": "...", "size_of_prize": "...", "size_formula": "...", "evidence": ["..."], "recommendation": "...", "timeline": "Week 1-2", "owner": "..."}],
  "competitive_landscape": { "comparison_table": [], "content_gap": [{"topic": "...", "volume": null, "leader": "[REAL BRAND ONLY IF OBSERVED]", "your_position": "..."}], "backlink_gap": [], "prioritized_roadmap": ["...", "...", "..."] },
  "competitor_teardown": { "feature_matrix": [], "swot_scored": [], "pricing_deconstruction": [], "ux_audit": { "design_score": null, "performance_score": null, "mobile_score": null, "accessibility_score": null, "strengths": [], "weaknesses": [] }, "content_gap_scored": [], "action_plan": [] },
  "roadmap_90day": { "days_1_30": [], "days_31_60": [], "days_61_90": [], "dependencies": ["...", "..."] },
  "financial_projection": { "investment": [], "monthly_projection": [], "roi_summary": "...", "roi_formula": "...", "assumptions": [], "sensitivity": [] },
  "unit_economics": { "cac": {}, "ltv": {}, "ltv_cac_ratio": {}, "payback_period": {}, "gross_margin_per_tier": [] },
  "break_even_analysis": {},
  "sensitivity_analysis": {},
  "keywords": [{"keyword": "...", "volume": null, "kd": null, "cpc": null, "intent": "commercial", "tier": "money", "data_source": null}],
  "serp_landscape": [],
  "content_roadmap": [],
  "link_acquisition": { "overview": "...", "target_sites": [], "guest_post_topics": ["..."] },
  "case_studies": [],
  "client_value_proposition": [],
  "trend_assessment": "...",
  "data_limitations": ["...", "...", "..."],
  "methodology_note": "..."
}`;
};

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATE + FILL
// ═══════════════════════════════════════════════════════════════════════════

const validateAndFillSections = (analysis: any, niche: string, country: string, keywords: any[], trendData: number[], serpResults: any[]): any => {
  const countryName = countryNames[country] || country;

  if (!analysis.executive_summary) analysis.executive_summary = {};
  if (!analysis.executive_summary.headline) analysis.executive_summary.headline = `Organic search opportunity assessment for ${niche} in ${countryName}`;
  if (!analysis.executive_summary.what_this_means) analysis.executive_summary.what_this_means = `This report evaluates available search-result evidence and keyword candidates for ${niche} in ${countryName}. Market demand, ranking gaps and commercial impact are stated only where a connected source provides evidence.`;
  if (!safeArray(analysis.executive_summary.next_90_days).length) {
    analysis.executive_summary.next_90_days = ['Deploy schema markup and optimize Core Web Vitals', 'Launch localized content targeting top keyword clusters', 'Execute targeted link-building campaign for regional authority'];
  }

  if (!analysis.current_state) analysis.current_state = {};
  if (!analysis.current_state.narrative) analysis.current_state.narrative = `No client website audit or first-party performance baseline was supplied. This run can assess public search results and provider-returned keyword data, but cannot establish client rankings, traffic, technical health or conversion performance.`;

  if (!analysis.ground_intel) analysis.ground_intel = {};
  if (!safeArray(analysis.ground_intel.buyer_behavior).length) analysis.ground_intel.buyer_behavior = [];
  analysis.ground_intel.competitor_weaknesses = [];

  if (!analysis.magic_goldmine) analysis.magic_goldmine = {};
  if (!analysis.magic_playbook) analysis.magic_playbook = {};
  if (!analysis.competitive_landscape) analysis.competitive_landscape = {};
  if (!analysis.roadmap_90day) analysis.roadmap_90day = {};
  if (!analysis.financial_projection) analysis.financial_projection = {};
  if (!analysis.unit_economics) analysis.unit_economics = {};
  if (!analysis.break_even_analysis) analysis.break_even_analysis = {};
  if (!analysis.sensitivity_analysis) analysis.sensitivity_analysis = {};

  if (!safeArray(analysis.key_findings).length) {
    analysis.key_findings = keywords.slice(0, 5).map((kw: any, i: number) => ({
      rank: i + 1,
      priority: i === 0 ? 'CRITICAL' : i <= 2 ? 'HIGH' : 'MEDIUM',
      title: `Opportunity in "${kw.keyword}"`,
      category: i === 0 ? 'Content Strategy' : i === 1 ? 'Technical SEO' : i === 2 ? 'Localization' : 'Off-Page SEO',
      impact: 'HIGH', effort: i === 0 ? 'LOW' : 'MEDIUM',
      what_is_happening: `The phrase "${kw.keyword}" is an unverified candidate keyword. Provider-backed volume, CPC and difficulty are shown only if returned by the keyword API.`,
      why_it_matters: `Validate local demand and search intent before prioritizing content or forecasting traffic.`,
      size_of_prize: 'Not calculated — client conversion and value inputs required',
      size_formula: 'Requires validated search volume, click-through rate, conversion rate and average order value',
      evidence: [],
      recommendation: `Create comprehensive content targeting "${kw.keyword}" with localized messaging.`,
      timeline: `Week ${(i + 1) * 2}-${(i + 1) * 2 + 1}`,
      owner: i === 0 ? 'Content Lead' : i === 1 ? 'Dev Lead' : 'SEO Lead',
    }));
  }

  if (!analysis.executive_summary.top_findings?.length) {
    analysis.executive_summary.top_findings = safeArray(analysis.key_findings).slice(0, 3).map((k: any) => ({ rank: k.rank, priority: k.priority, title: k.title, size_of_prize: k.size_of_prize, root_cause: k.what_is_happening }));
  }

  if (!safeArray(analysis.case_studies).length) analysis.case_studies = [];

  if (!safeArray(analysis.data_limitations).length) {
    analysis.data_limitations = [
      'Keyword metrics are shown only when returned by the connected provider; unreturned fields remain explicitly unverified.',
      'Competitor authority, traffic, backlink and pricing metrics require dedicated dated provider exports or source-page evidence.',
      'Client-specific health, traffic, rankings, conversion and ROI require website access, analytics and client-supplied commercial inputs.',
    ];
  }

  if (!analysis.methodology_note) analysis.methodology_note = 'The report combines live SERP results and provider-returned keyword/trend metrics when available. AI-generated strategic recommendations are hypotheses, not measured market facts. Client analytics, backlink exports, crawl results and financial inputs are not inferred.';

  if (!analysis.trend_assessment) {
    if (trendData.length) {
      const peakMonth = trendData.indexOf(Math.max(...trendData)) + 1;
      analysis.trend_assessment = `Provider-returned trend data peaks at observation ${peakMonth}; the source timeline and date range should be reviewed before assigning calendar seasonality.`;
    } else {
      analysis.trend_assessment = 'No provider-backed trend series was returned for this query and country; seasonality is not inferred.';
    }
  }

  if (!safeArray(analysis.roadmap_90day.days_1_30).length) {
    analysis.roadmap_90day = {
      days_1_30: [
        { action: 'Optimize Core Web Vitals', theme: 'Quick Win', owner: 'Dev Lead', effort: 'S' },
        { action: 'Publish 5 high-intent guides', theme: 'Quick Win', owner: 'Content Lead', effort: 'M' },
        { action: 'Implement schema markup', theme: 'Quick Win', owner: 'SEO Lead', effort: 'S' },
      ],
      days_31_60: [
        { action: "Expand validated keyword clusters in the market's primary search language(s)", theme: 'Build', owner: 'Content Lead', effort: 'L' },
        { action: 'Execute a country-relevant digital PR campaign after prospect validation', theme: 'Build', owner: 'PR Specialist', effort: 'L' },
        { action: 'Build relevant editorial and partner links after quality review', theme: 'Build', owner: 'Partnerships', effort: 'M' },
      ],
      days_61_90: [
        { action: 'Scale content production to 20+ pages', theme: 'Scale', owner: 'Content Team', effort: 'L' },
        { action: 'Optimize conversion funnels', theme: 'Scale', owner: 'Dev Lead', effort: 'M' },
        { action: 'Expand adjacent keyword clusters', theme: 'Scale', owner: 'SEO Lead', effort: 'M' },
      ],
      dependencies: ['Timely content delivery', 'Access to regional benchmark data'],
    };
  }

  if (!analysis.competitor_teardown) analysis.competitor_teardown = {};
  analysis.competitor_teardown.feature_matrix = [];
  analysis.competitor_teardown.swot_scored = [];
  analysis.competitor_teardown.pricing_deconstruction = [];
  analysis.competitor_teardown.content_gap_scored = [];
  if (!analysis.competitor_teardown.ux_audit) analysis.competitor_teardown.ux_audit = { design_score: null, performance_score: null, mobile_score: null, accessibility_score: null, strengths: [], weaknesses: [], status: 'Not audited — requires site crawl and field data' };
  if (!safeArray(analysis.competitor_teardown.action_plan).length) {
    const year = new Date().getFullYear();
    const nextQuarter = `Q${Math.ceil((new Date().getMonth() + 4) / 3)} ${year}`;
    analysis.competitor_teardown.action_plan = [
      { action: 'Confirm the target keyword set using a country-specific keyword data export', stakeholder: 'SEO Lead', timeline: nextQuarter, expected_impact: 'Baseline and target to be set after measurement' },
      { action: 'Audit Core Web Vitals using field data and representative mobile devices', stakeholder: 'Engineering Lead', timeline: nextQuarter, expected_impact: 'Set after baseline audit' },
      { action: 'Review localized landing-page coverage and translation quality', stakeholder: 'Content Director', timeline: nextQuarter, expected_impact: 'Set after content inventory' },
      { action: 'Run referring-domain gap analysis using a licensed backlink provider', stakeholder: 'Digital PR Lead', timeline: nextQuarter, expected_impact: 'Set after verified backlink export' },
    ];
  }

  return analysis;
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

export async function generateSEOReport(
  niche: string,
  country: string,
  options?: { clientName?: string; website?: string; productDescription?: string; targetIcp?: string; businessInputs?: Record<string, number>; baselineKpis?: any[]; }
) {
  country = String(country || '').trim().toLowerCase();
  if (!countryNames[country]) throw new Error(`Unsupported country code: ${country}. Supported: ${Object.keys(countryNames).join(', ')}`);
  niche = String(niche || '').trim();
  if (!niche) throw new Error('A non-empty niche is required to generate an SEO report.');

  const optionsKey = JSON.stringify({ clientName: options?.clientName || '', website: options?.website || '', productDescription: options?.productDescription || '', targetIcp: options?.targetIcp || '', businessInputs: options?.businessInputs || {}, baselineKpis: options?.baselineKpis || [] });
  const cacheKey = `seo_v13_${niche}_${country}_${optionsKey}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  console.log(`🔍 [SEO v13] Generating for "${niche}" in ${country}...`);

  // TRENDS
  let trendData: number[] = [];
  let trendSource: 'dataforseo' | 'google_trends' | 'none' = 'none';
  if (isDataForSEOAvailable()) {
    try {
      const realTrends = await fetchRealTrends([niche], country);
      if (realTrends.length > 0 && realTrends[0].timeline.length > 0) {
        trendData = realTrends[0].timeline.map((t: { value: number }) => t.value);
        trendSource = 'dataforseo';
      }
    } catch { /* fallback */ }
  }
  if (trendData.length === 0) {
    trendData = await getGoogleTrends(niche, country).catch(() => []);
    if (trendData.length > 0) trendSource = 'google_trends';
  }

  // SERP
  const serpQuery = buildSerpQuery(niche, country);
  let serpProvider = 'No SERP provider returned results';
  let searchData = await getScraperAPISearch(serpQuery, country).catch(() => null);
  if (searchData?.organic_results) serpProvider = 'ScraperAPI';
  if (!searchData?.organic_results) { searchData = await getSearchResults(serpQuery, country).catch(() => null); if (searchData?.organic_results) serpProvider = 'SerpAPI'; }
  if (!searchData?.organic_results) { searchData = await getSerperResults(serpQuery, country).catch(() => null); if (searchData?.organic_results) serpProvider = 'Serper'; }
  const serpResults = filterAndScoreSerp(searchData?.organic_results || [], niche, country).slice(0, 10);
  console.log(`✅ [SERP] ${serpResults.length} relevant results.`);

  // AI
  const prompt = `${buildSEOPrompt(niche, country, serpResults, trendData)}\n\nCALLER-SUPPLIED CLIENT CONTEXT:\nWebsite: ${options?.website || 'Not supplied'}\nProduct: ${options?.productDescription || 'Not supplied'}\nTarget ICP: ${options?.targetIcp || 'Not supplied'}\nCommercial inputs supplied in code; must not be guessed.`;
  const aiResponse = await runGroqWithRetry(prompt, JSON.stringify({ niche, country }));
  let analysis = extractJSON(aiResponse);

  analysis.business_inputs = options?.businessInputs ? { ...options.businessInputs } : {};
  if (!analysis.current_state) analysis.current_state = {};
  analysis.current_state.kpi_dashboard = Array.isArray(options?.baselineKpis) ? options.baselineKpis : [];
  if (!options?.website) analysis.current_state.narrative = 'Target website not supplied. Client-specific rankings, traffic, technical health, conversion performance and backlink baselines cannot be assessed in this run.';
  if (options?.clientName) analysis.client_name = options.clientName;
  if (options?.website) analysis.client_website = options.website;
  analysis.case_studies = [];
  if (!options?.productDescription) analysis.client_value_proposition = [];

  // KEYWORDS
  let keywords = Array.isArray(analysis.keywords) ? analysis.keywords : [];
  keywords = keywords.map((kw: any, i: number) => {
    const tier = safeString(kw.tier, i < 14 ? 'money' : i < 32 ? 'growth' : 'long-tail');
    return {
      keyword: safeString(kw.keyword, ''),
      volume: null, cpc: null, kd: null,
      intent: resolveIntent(kw),
      tier,
      dataSource: 'unverified_ai_candidate',
    };
  }).filter((kw: any) => kw.keyword);

  if (isDataForSEOAvailable() && keywords.length > 0) {
    try {
      const realMetrics = await fetchRealKeywordMetrics(keywords.map((k: any) => k.keyword), country);
      if (realMetrics.length > 0) {
        const metricMap = new Map<string, RealKeywordMetric>(realMetrics.map((m: RealKeywordMetric) => [m.keyword.toLowerCase(), m]));
        keywords = keywords.map((kw: any) => {
          const real = metricMap.get(kw.keyword.toLowerCase());
          if (real) {
            return {
              ...kw,
              volume: Number.isFinite(Number(real.volume)) && Number(real.volume) >= 0 ? Number(real.volume) : null,
              kd: Number.isFinite(Number(real.kd)) && Number(real.kd) >= 0 ? Number(real.kd) : null,
              cpc: Number.isFinite(Number(real.cpc)) && Number(real.cpc) >= 0 ? Number(real.cpc) : null,
              intent: resolveIntent(kw),
              dataSource: 'dataforseo',
            };
          }
          return kw;
        });
      }
    } catch (e: any) {
      console.warn(`⚠️ [DataForSEO] override failed: ${e.message}`);
    }
  }

  keywords = await mapWithConcurrency(keywords, 5, async (kw: any) => {
    try {
      if (kw.dataSource === 'dataforseo' && kw.cpc !== null && kw.cpc !== undefined && safeNumber(kw.cpc, -1) >= 0) {
        const converted = await convertCurrency(kw.cpc, 'USD', (currencyInfo[country] || currencyInfo.us).code);
        kw.cpc = (converted === null || isNaN(converted) || converted < 0) ? kw.cpc : Number(Number(converted).toFixed(2));
      }
    } catch { /* preserve original */ }
    return kw;
  });

  keywords = keywords.map((kw: any) => {
    const verified = kw.dataSource === 'dataforseo';
    const metricStatus = (value: any, label: string) => value !== null && value !== undefined
      ? `Provider-returned ${label}; DataForSEO`
      : verified
        ? `DataForSEO did not return ${label} for this keyword; no estimate substituted`
        : `Candidate keyword only; ${label} has not been measured`;
    return {
      ...kw,
      volumeStatus: metricStatus(kw.volume, 'search volume'),
      kdStatus: metricStatus(kw.kd, 'keyword difficulty'),
      cpcStatus: metricStatus(kw.cpc, 'CPC in target-market currency'),
      metricProvider: verified ? 'DataForSEO' : 'Unverified AI keyword candidate',
    };
  });

  // VALIDATE + FILL + RECONCILE
  analysis = validateAndFillSections(analysis, niche, country, keywords, trendData, serpResults);
  analysis = reconcileAll(analysis, keywords, country);

  if (!analysis.current_state) analysis.current_state = {};
  analysis.current_state.kpi_dashboard = Array.isArray(options?.baselineKpis) ? options.baselineKpis : [];
  const sourcePullDate = new Date().toISOString().slice(0, 10);
  const actualSources: any[] = [];
  if (keywords.some((k: any) => k.dataSource === 'dataforseo' && (safeNumber(k.volume, 0) > 0 || safeNumber(k.cpc, 0) > 0 || (k.kd !== null && k.kd !== undefined)))) actualSources.push({ data_type: 'Keyword metrics', source: 'DataForSEO', pull_date: sourcePullDate });
  if (trendSource === 'dataforseo') actualSources.push({ data_type: 'Search trends', source: 'DataForSEO Trends', pull_date: sourcePullDate });
  else if (trendSource === 'google_trends') actualSources.push({ data_type: 'Search trends', source: 'Google Trends', pull_date: sourcePullDate });
  else actualSources.push({ data_type: 'Search trends', source: 'No provider data returned; no trend values generated', pull_date: sourcePullDate });
  if (serpResults.length > 0) actualSources.push({ data_type: 'SERP results', source: serpProvider, pull_date: sourcePullDate });
  analysis.current_state.data_sources = actualSources;

  dedupeCaseStudyTitles(safeArray(analysis.case_studies));
  cleanInsightPrefixes(analysis);

  // Country overrides
  const preloadedCalendar = getCalendarForCountry(country);
  const preloadedEditors = getEditorsForCountry(country);
  if (!analysis.ground_intel) analysis.ground_intel = {};
  analysis.ground_intel.cultural_calendar = preloadedCalendar.map((c: any) => ({
    period: c.period,
    behavior: String(c.behavior || '').replace(/mid-Q1 review/gi, 'Q1 close / Q2 start').replace(/mid-Q4/gi, 'Q3 close / Q4 start'),
    content_priority: c.contentPriority,
  }));
  analysis.ground_intel.editor_intelligence = preloadedEditors.map((e: any) => ({ publication: e.site, da: null, what_works: e.whatWorks }));
  analysis.ground_intel.cultural_calendar_status = preloadedCalendar.length ? 'Country calendar loaded from project data module' : 'No country calendar configured';
  analysis.ground_intel.editor_intelligence_status = preloadedEditors.length ? 'Country editor dataset loaded; authority scores not inferred' : 'No editor entries configured';

  // BUILD MARKDOWN
  const today = new Date().toLocaleDateString((currencyInfo[country] || currencyInfo.us).locale, { year: 'numeric', month: 'long', day: 'numeric' });
  const reference = `MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const currency = currencyInfo[country] || currencyInfo.us;

  analysis.serp_landscape = serpResults.slice(0, 10).map((r: any, i: number) => ({
    position: i + 1, title: r.title || 'Untitled', link: r.link || null,
    da: null, words: null, backlinks: null, traffic: null,
    authority_status: 'Not measured: no authority provider export',
    content_status: 'Word count not measured: page crawler not connected',
    backlink_status: 'Not measured: no backlink provider export',
    traffic_status: 'Not measured: no analytics/provider traffic export',
  }));

  const execSum = analysis.executive_summary || {};
  const currentState = analysis.current_state || {};
  const groundIntel = analysis.ground_intel || {};
  const magicGoldmine = analysis.magic_goldmine || {};
  const magicPlaybook = analysis.magic_playbook || {};
  const keyFindings = safeArray(analysis.key_findings);
  const competitive = analysis.competitive_landscape || {};
  const competitorTeardown = analysis.competitor_teardown || {};
  const roadmap = analysis.roadmap_90day || {};
  const financial = analysis.financial_projection || {};
  const unitEconomics = analysis.unit_economics || {};
  const breakEven = analysis.break_even_analysis || {};
  const sensitivity = analysis.sensitivity_analysis || {};
  const dataLimitations = safeArray(analysis.data_limitations);

  const languageSplitHeading = isMultilingual[country] ? '3.2  🌍 LANGUAGE SPLIT INTELLIGENCE' : '3.2  🌍 REGIONAL SEARCH VARIATIONS';
  const languageSplitIntro = isMultilingual[country]
    ? 'This section analyzes bilingual (English + local language) search dynamics.'
    : `This section analyzes regional search variations across ${countryNames[country]}.`;

  let markdown = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Nexlor
Real-Time Market Research | Intelligence Division
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                    SEO RESEARCH REPORT

Prepared For:      ${safeString(options?.clientName || analysis.client_name, 'Client details pending')}
Website:            ${safeString(options?.website || analysis.client_website, 'Not supplied')}
Date:              ${today}
Reference:         ${reference}
Classification:    CONFIDENTIAL

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HEADLINE:
"${safeString(execSum.headline)}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 REPORT STANDARDS
Only source-backed metrics are presented as measured. Pattern-Based estimates are labeled.
Missing client, analytics, competitor-provider or commercial inputs are shown as
"Not supplied" / "Not verified" and are not converted into performance claims.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. EXECUTIVE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOP 3 FINDINGS (Ranked by Business Impact)

`;
  safeArray(execSum.top_findings).slice(0, 3).forEach((f: any) => {
    markdown += `┌──────────────────────────────────────────────────────────────────┐\n`;
    markdown += `│ #${f.rank || ''} — ${f.priority || 'HIGH'}: ${safeString(f.title)}\n`;
    markdown += `├──────────────────────────────────────────────────────────────────┤\n`;
    markdown += `│ 💰 Size of Prize: ${safeString(f.size_of_prize)}\n`;
    markdown += `│ 🎯 Root Cause: ${safeString(f.root_cause)}\n`;
    markdown += `└──────────────────────────────────────────────────────────────────┘\n\n`;
  });

  markdown += `📌 WHAT THIS MEANS FOR YOU\n${safeString(execSum.what_this_means)}\n\n`;
  markdown += `🚀 NEXT 90 DAYS — RECOMMENDED PRIORITIES\n`;
  safeArray(execSum.next_90_days).forEach((a: string, i: number) => markdown += `  ${i + 1}. ${a}\n`);
  markdown += `\n💵 PROJECTED ROI (6 MONTHS)\n`;
  markdown += `  Investment:           ${safeString(execSum.estimated_roi?.investment)}\n`;
  markdown += `  Projected Pipeline:   ${safeString(execSum.estimated_roi?.pipeline)}\n`;
  markdown += `  Projected ROI:        ${safeString(execSum.estimated_roi?.roi_percent)}\n`;
  markdown += `  Pipeline / Investment: ${safeString(execSum.estimated_roi?.pipeline_to_investment_ratio)}\n\n`;

  const health = execSum.health_score || {};
  markdown += `📊 OVERALL HEALTH SCORE\n\n`;
  markdown += `  Overall: ${health.overall === null || health.overall === undefined ? 'Not scored — audit evidence required' : `${health.overall}/100`}   ${health.status || ''}\n\n`;
  safeArray(health.breakdown).forEach((b: any) => {
    markdown += `  ${safeString(b.category).padEnd(20)} ${b.score === null || b.score === undefined ? 'Not scored' : `${b.score}/100`}  ${b.status || ''}\n`;
  });
  markdown += `\n`;

  markdown += `2. CURRENT STATE & BASELINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 DATA SOURCES & PULL DATES

`;
  markdown += formatTable(['Data Type', 'Source', 'Pull Date'], safeArray(currentState.data_sources).map((d: any) => [safeString(d.data_type), safeString(d.source), safeString(d.pull_date)]));
  markdown += `\n📊 CORE KPI DASHBOARD\n\n`;
  markdown += formatTable(['Metric', 'Current', 'Previous', 'Change', 'Target'], safeArray(currentState.kpi_dashboard).map((k: any) => [safeString(k.metric), safeString(k.current), safeString(k.previous), safeString(k.change), safeString(k.target)]));
  markdown += `\n📝 NARRATIVE\n"${safeString(currentState.narrative)}"\n\n`;

  markdown += `2.5 KEYWORD PORTFOLIO — 50 TIERED KEYWORDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 TIER BREAKDOWN

  Tier 1 (Money Keywords):      14
  Tier 2 (Growth Keywords):     18
  Tier 3 (Long-tail Keywords):  18
  ─────────────────────────────────
  TOTAL:                        50

📈 PRIORITIZATION LOGIC
  Tier 1 — Highest commercial intent, prioritize for immediate optimization.
  Tier 2 — Strategic value, builds topical authority over 3-6 months.
  Tier 3 — Quick wins + niche opportunities, opportunistic.

`;
  const moneyKw = keywords.filter((k: any) => k.tier === 'money').slice(0, 14);
  const growthKw = keywords.filter((k: any) => k.tier === 'growth').slice(0, 18);
  const longTailKw = keywords.filter((k: any) => k.tier === 'long-tail').slice(0, 18);

  if (moneyKw.length > 0) {
    markdown += `TIER 1 — MONEY KEYWORDS (Highest Commercial Intent)\n\n`;
    markdown += formatTable(
      ['#', 'Keyword', 'Volume', 'KD', `CPC (${currency.symbol.trim()})`, 'Intent'],
      moneyKw.map((k: any, i: number) => [String(i + 1), safeString(k.keyword), k.volume === null ? 'No provider metric' : String(k.volume), k.kd === null ? 'No provider metric' : String(k.kd), formatCpcSafe(k.cpc, country), safeString(k.intent)])
    );
    markdown += `\n`;
  }
  if (growthKw.length > 0) {
    markdown += `TIER 2 — GROWTH KEYWORDS (Strategic Value)\n\n`;
    markdown += formatTable(
      ['#', 'Keyword', 'Volume', 'KD', `CPC (${currency.symbol.trim()})`, 'Intent'],
      growthKw.map((k: any, i: number) => [String(i + 15), safeString(k.keyword), k.volume === null ? 'No provider metric' : String(k.volume), k.kd === null ? 'No provider metric' : String(k.kd), formatCpcSafe(k.cpc, country), safeString(k.intent)])
    );
    markdown += `\n`;
  }
  if (longTailKw.length > 0) {
    markdown += `TIER 3 — LONG-TAIL KEYWORDS (Quick Wins)\n\n`;
    markdown += formatTable(
      ['#', 'Keyword', 'Volume', 'KD', `CPC (${currency.symbol.trim()})`, 'Intent'],
      longTailKw.map((k: any, i: number) => [String(i + 33), safeString(k.keyword), k.volume === null ? 'No provider metric' : String(k.volume), k.kd === null ? 'No provider metric' : String(k.kd), formatCpcSafe(k.cpc, country), safeString(k.intent)])
    );
    markdown += `\n`;
  }

  markdown += `3. GROUND INTEL — WHAT SEO TOOLS WILL NEVER KNOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📖 WHAT THIS SECTION IS
Semrush, Ahrefs, and Moz crawl websites. They do not understand
cultural calendars, regulatory shifts, buyer psychology, or local
editor relationships.

──────────────────────────────────────────────────────────────
3.1  📅 CULTURAL BUYING CALENDAR — ${countryNames[country]}
──────────────────────────────────────────────────────────────

`;
  safeArray(groundIntel.cultural_calendar).forEach((c: any) => {
    markdown += `${safeString(c.period)}\n   ${safeString(c.behavior)}\n   → Content Priority: ${safeString(c.content_priority)}\n\n`;
  });

  markdown += `──────────────────────────────────────────────────────────────\n${languageSplitHeading}\n──────────────────────────────────────────────────────────────\n\n`;
  markdown += `${languageSplitIntro}\n\n${safeString(groundIntel.language_split?.summary)}\n\n`;
  markdown += `Top ${isMultilingual[country] ? 'local-language' : 'regional'} keywords with commercial intent:\n\n`;
  markdown += formatTable(
    ['Keyword', 'Volume', 'KD', `CPC (${currency.symbol.trim()})`, 'Scope'],
    safeArray(groundIntel.language_split?.top_keywords).map((k: any) => [safeString(k.keyword), k.volume === null ? 'No provider metric' : String(k.volume), k.kd === null ? 'No provider metric' : String(k.kd), formatCpcSafe(k.cpc, country), safeString(k.scope, 'regional-intent candidate')])
  );

  markdown += `\n──────────────────────────────────────────────────────────────\n3.3  🧠 LOCAL BUYER BEHAVIOR PATTERNS\n──────────────────────────────────────────────────────────────\n\n`;
  safeArray(groundIntel.buyer_behavior).forEach((b: string) => markdown += `  • ${b}\n`);

  markdown += `\n──────────────────────────────────────────────────────────────\n3.4  📰 LOCAL EDITOR & PUBLICATION INTELLIGENCE\n──────────────────────────────────────────────────────────────\n\n`;
  markdown += formatTable(['Publication', 'DA', 'What Actually Works'], safeArray(groundIntel.editor_intelligence).map((e: any) => [safeString(e.publication), safeString(e.da, 'Not measured'), safeString(e.what_works)]));

  markdown += `\n──────────────────────────────────────────────────────────────\n3.5  ⚔️ COMPETITOR LOCAL WEAKNESS MAP\n──────────────────────────────────────────────────────────────\n\n`;
  markdown += formatTable(['Competitor', 'Local Weakness (verified)'], safeArray(groundIntel.competitor_weaknesses).map((c: any) => [safeString(c.competitor), safeString(c.weakness)]));
  markdown += `\n`;

  markdown += `4. STRATEGIC OPPORTUNITY — UNTAPPED KEYWORD CLUSTER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💎 WHAT THIS SECTION IS
We searched for keyword clusters meeting ALL four criteria:
  1. High commercial intent
  2. Verified low competition (KD < 20)
  3. Proven search volume
  4. Currently untargeted by your competitors

──────────────────────────────────────────────────────────────
${safeString(magicGoldmine.cluster_name, 'Cluster analysis pending verified keyword data')}
──────────────────────────────────────────────────────────────

`;
  safeArray(magicGoldmine.criteria_met).forEach((c: string) => markdown += `✅ ${c}\n`);
  markdown += `\n🔍 WHY THIS CLUSTER IS INVISIBLE:\n`;
  safeArray(magicGoldmine.why_invisible).forEach((w: string) => markdown += `→ ${w}\n`);

  markdown += `\n💎 TOP 5 HIGHEST-VALUE KEYWORDS\n\n`;
  markdown += formatTable(
    ['#', 'Keyword', 'Volume', 'KD', `CPC (${currency.symbol.trim()})`, 'Intent', 'Status'],
    safeArray(magicGoldmine.top_keywords).map((k: any, i: number) => [
      String(i + 1),
      safeString(k.keyword),
      k.volume === null || k.volume === undefined ? 'No provider metric' : String(k.volume),
      k.kd === null || k.kd === undefined ? 'No provider metric' : String(k.kd),
      formatCpcSafe(k.cpc, country),
      safeString(k.intent),
      safeString(k.status, 'unverified'),
    ])
  );

  markdown += `\n💰 REVENUE PROJECTION\n\n`;
  markdown += `→ Monthly traffic: ${safeString(magicGoldmine.revenue_projection?.monthly_traffic)}\n`;
  markdown += `→ Conversion rate: ${safeString(magicGoldmine.revenue_projection?.conversion_rate)}\n`;
  markdown += `→ Monthly leads: ${safeString(magicGoldmine.revenue_projection?.monthly_leads)}\n`;
  markdown += `→ Avg. deal value: ${safeString(magicGoldmine.revenue_projection?.avg_deal_value)}\n`;
  markdown += `→ Monthly pipeline: ${safeString(magicGoldmine.revenue_projection?.monthly_pipeline)}\n`;
  markdown += `→ Formula: ${safeString(magicGoldmine.revenue_projection?.formula)}\n\n`;

  markdown += `✅ EVIDENCE\n`;
  safeArray(magicGoldmine.evidence).forEach((e: string) => markdown += `✅ ${e}\n`);
  markdown += `\n`;

  markdown += `5. COMPETITIVE EDGE — FORENSIC COMPETITOR ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🕵️ WHAT THIS SECTION IS
Competitor analysis is limited to the public SERP evidence and provider fields returned in this report.

──────────────────────────────────────────────────────────────
TARGET: ${safeString(magicPlaybook.target_competitor?.name, 'Not identified')}
Domain Rating: ${safeString(magicPlaybook.target_competitor?.da, 'Not measured')} | Monthly Organic Traffic: ${safeString(magicPlaybook.target_competitor?.traffic, 'Not measured')}
──────────────────────────────────────────────────────────────

📅 TIMELINE OF THEIR RISE

`;
  safeArray(magicPlaybook.timeline).forEach((t: any) => {
    markdown += `${safeString(t.date)} →  ${safeString(t.action)}\n   Impact: ${safeString(t.impact)}\n\n`;
  });

  markdown += `🔍 THEIR CONTENT FORMULA (CRACKED)\n`;
  safeArray(magicPlaybook.content_formula).forEach((c: string) => markdown += `• ${c}\n`);
  markdown += `\n🎯 THEIR BACKLINK STRATEGY (MAPPED)\n`;
  markdown += `Total backlinks: ${safeString(magicPlaybook.backlink_strategy?.total_backlinks)}\n`;
  markdown += `Local percentage: ${safeString(magicPlaybook.backlink_strategy?.local_percentage)}\n`;
  markdown += `Top 3 source domains: ${safeArray(magicPlaybook.backlink_strategy?.top_sources).length ? '' : 'Not verified'}\n\n`;
  safeArray(magicPlaybook.backlink_strategy?.top_sources).forEach((s: any) => markdown += `  • ${safeString(s)}\n`);

  markdown += `\n⚠️ THEIR VULNERABILITIES (WHAT THEY'RE NOT DOING)\n`;
  safeArray(magicPlaybook.vulnerabilities).forEach((v: string) => markdown += `• ${v}\n`);

  markdown += `\n🎯 YOUR 60-DAY COUNTER-PLAY\n`;
  safeArray(magicPlaybook.counter_play).forEach((c: any) => markdown += `${safeString(c.week)} →  ${safeString(c.action)}\n`);

  markdown += `\n✅ EVIDENCE\n`;
  safeArray(magicPlaybook.evidence).forEach((e: string) => markdown += `✅ ${e}\n`);
  markdown += `\n`;

  markdown += `6. KEY FINDINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  keyFindings.forEach((f: any) => {
    markdown += `┌──────────────────────────────────────────────────────────────────┐\n`;
    markdown += `│ FINDING #${f.rank} — ${safeString(f.priority)}\n`;
    markdown += `│ Title: ${safeString(f.title)}\n`;
    markdown += `├──────────────────────────────────────────────────────────────────┤\n`;
    markdown += `│ Category: ${safeString(f.category)}\n`;
    markdown += `│ Impact: ${safeString(f.impact)} |  Effort: ${safeString(f.effort)}\n`;
    markdown += `└──────────────────────────────────────────────────────────────────┘\n`;
    markdown += `💡 What is happening: ${safeString(f.what_is_happening)}\n`;
    markdown += `⚠️ Why it matters: ${safeString(f.why_it_matters)}\n`;
    markdown += `💰 Size of prize: ${safeString(f.size_of_prize)}\n`;
    markdown += `   Formula: ${safeString(f.size_formula)}\n`;
    markdown += `✅ Evidence:\n`;
    safeArray(f.evidence).forEach((e: string) => markdown += `  • ${e}\n`);
    if (!safeArray(f.evidence).length) markdown += `  • No verified evidence supplied for this finding.\n`;
    markdown += `🎯 Recommendation: ${safeString(f.recommendation)}\n`;
    markdown += `⏱️ Timeline: ${safeString(f.timeline)}\n`;
    markdown += `👤 Owner: ${safeString(f.owner)}\n`;
    markdown += `──────────────────────────────────────────────────────────────\n`;
  });

  markdown += `7. COMPETITIVE LANDSCAPE & GAP ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏆 TOP COMPETITORS ANALYZED

`;
  markdown += formatTable(
    ['Metric', 'You', 'Competitor 1', 'Competitor 2', 'Competitor 3'],
    safeArray(competitive.comparison_table).map((c: any) => [safeString(c.metric), safeString(c.you), safeString(c.comp_a), safeString(c.comp_b), safeString(c.comp_c)])
  );

  markdown += `\n📊 CONTENT GAP ANALYSIS\n\n`;
  markdown += formatTable(
    ['Topic', 'Volume', 'Leader', 'Your Position'],
    safeArray(competitive.content_gap).map((c: any) => [safeString(c.topic), c.volume === null ? 'No provider metric' : String(c.volume), safeString(c.leader), safeString(c.your_position)])
  );

  markdown += `\n🔗 BACKLINK GAP ANALYSIS\n\n`;
  markdown += formatTable(
    ['Domain', 'DA', 'Competitor Links', 'Your Links'],
    safeArray(competitive.backlink_gap).map((b: any) => [safeString(b.domain), safeString(b.da), safeString(b.competitor_links), safeString(b.your_links)])
  );

  markdown += `\n🎯 PRIORITIZED GAP-CLOSING ROADMAP\n\n`;
  safeArray(competitive.prioritized_roadmap).forEach((r: string, i: number) => markdown += `${i + 1}. ${r}\n`);
  markdown += `\n`;

  markdown += `7.5 COMPETITOR TEARDOWN — DEEP-DIVE ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🕵️ WHAT THIS SECTION IS
A structured review of competitor evidence available from public SERP results and connected provider data.

═══════════════════════════════════════════════════════════════════════
A. FEATURE COMPARISON MATRIX (10 Dimensions)
═══════════════════════════════════════════════════════════════════════

`;
  markdown += formatTable(
    ['Dimension', 'You', 'Competitor 1', 'Competitor 2', 'Competitor 3', 'Gap'],
    safeArray(competitorTeardown.feature_matrix).map((f: any) => [safeString(f.dimension), safeString(f.your_score), safeString(f.comp1), safeString(f.comp2), safeString(f.comp3), safeString(f.gap, '🟡 Medium')])
  );

  markdown += `\n═══════════════════════════════════════════════════════════════════════
B. SWOT SCORING RUBRIC (12 Dimensions)
═══════════════════════════════════════════════════════════════════════

`;
  markdown += formatTable(
    ['Dimension', 'Score', 'Reasoning'],
    safeArray(competitorTeardown.swot_scored).map((s: any) => [safeString(s.dimension), `${s.score}/10 ${s.score >= 7 ? '🟢' : s.score >= 5 ? '🟡' : '🔴'}`, safeString(s.reasoning)])
  );

  markdown += `\n═══════════════════════════════════════════════════════════════════════
C. PRICING DECONSTRUCTION (Tier-by-Tier)
═══════════════════════════════════════════════════════════════════════

`;
  markdown += formatTable(
    ['Tier', 'Your Price', 'Competitor 1', 'Competitor 2', 'Competitor 3', 'Insight'],
    safeArray(competitorTeardown.pricing_deconstruction).map((p: any) => [safeString(p.tier), safeString(p.your_price), safeString(p.comp1_price), safeString(p.comp2_price), safeString(p.comp3_price), safeString(p.insight)])
  );

  markdown += `\n═══════════════════════════════════════════════════════════════════════
D. UX AUDIT
═══════════════════════════════════════════════════════════════════════

`;
  const ux = competitorTeardown.ux_audit || {};
  markdown += `**Design Score:**         ${ux.design_score === null || ux.design_score === undefined ? 'Not audited' : ux.design_score}/100 ${ux.design_score >= 70 ? '🟢' : '🟡'}\n`;
  markdown += `**Performance Score:**    ${ux.performance_score === null || ux.performance_score === undefined ? 'Not audited' : ux.performance_score}/100 ${ux.performance_score >= 70 ? '🟢' : '🔴'}\n`;
  markdown += `**Mobile Score:**         ${ux.mobile_score === null || ux.mobile_score === undefined ? 'Not audited' : ux.mobile_score}/100 ${ux.mobile_score >= 70 ? '🟢' : '🟡'}\n`;
  markdown += `**Accessibility Score:**  ${ux.accessibility_score === null || ux.accessibility_score === undefined ? 'Not audited' : ux.accessibility_score}/100 ${ux.accessibility_score >= 70 ? '🟢' : '🟡'}\n\n`;
  markdown += `💪 STRENGTHS:\n`;
  safeArray(ux.strengths).forEach((s: string) => { markdown += `  • ${s}\n`; });
  markdown += `\n⚠️ WEAKNESSES:\n`;
  safeArray(ux.weaknesses).forEach((w: string) => { markdown += `  • ${w}\n`; });

  markdown += `\n═══════════════════════════════════════════════════════════════════════
E. CONTENT GAP ANALYSIS (Scored)
═══════════════════════════════════════════════════════════════════════

`;
  markdown += formatTable(
    ['Topic', 'Volume', 'Competitor Coverage', 'Your Coverage', 'Priority', 'Expected Traffic'],
    safeArray(competitorTeardown.content_gap_scored).map((c: any) => [safeString(c.topic), c.volume === null ? 'No provider metric' : String(c.volume), safeString(c.competitor_coverage), safeString(c.your_coverage), c.priority === 'Critical' ? '🔴 Critical' : c.priority === 'High' ? '🟠 High' : '🟡 Medium', c.expected_traffic === null ? 'Not forecast' : `${c.expected_traffic}/mo`])
  );

  markdown += `\n═══════════════════════════════════════════════════════════════════════
F. STRATEGIC ACTION PLAN (Stakeholder-Mapped)
═══════════════════════════════════════════════════════════════════════

`;
  markdown += formatTable(
    ['Action', 'Stakeholder', 'Timeline', 'Expected Impact'],
    safeArray(competitorTeardown.action_plan).map((a: any) => [safeString(a.action), safeString(a.stakeholder), safeString(a.timeline), safeString(a.expected_impact)])
  );

  markdown += `\n8. 90-DAY ACTION ROADMAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🟢 DAYS 1-30 — FOUNDATION & QUICK WINS

`;
  markdown += formatTable(['Action', 'Theme', 'Owner', 'Effort'], safeArray(roadmap.days_1_30).map((a: any) => [safeString(a.action), safeString(a.theme), safeString(a.owner), safeString(a.effort)]));

  markdown += `\n🟡 DAYS 31-60 — BUILD & EXPAND\n\n`;
  markdown += formatTable(['Action', 'Theme', 'Owner', 'Effort'], safeArray(roadmap.days_31_60).map((a: any) => [safeString(a.action), safeString(a.theme), safeString(a.owner), safeString(a.effort)]));

  markdown += `\n🔵 DAYS 61-90 — SCALE & OPTIMIZE\n\n`;
  markdown += formatTable(['Action', 'Theme', 'Owner', 'Effort'], safeArray(roadmap.days_61_90).map((a: any) => [safeString(a.action), safeString(a.theme), safeString(a.owner), safeString(a.effort)]));

  markdown += `\n⚠️ DEPENDENCIES & RISKS\n`;
  safeArray(roadmap.dependencies).forEach((d: string) => markdown += `• ${d}\n`);
  markdown += `\n`;

  markdown += `9. FINANCIAL PROJECTION & ROI MODEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💵 INVESTMENT (6-MONTH)

`;
  markdown += formatTable(['Item', 'Cost'], safeArray(financial.investment).map((i: any) => [safeString(i.item), safeString(i.cost)]));

  markdown += `\n📈 6-MONTH PROJECTION\n\n`;
  markdown += formatTable(['Month', 'Sessions', 'Leads', 'Pipeline', 'Pipeline / Investment'], safeArray(financial.monthly_projection).map((m: any) => [safeString(m.month), safeString(m.sessions), safeString(m.leads), safeString(m.pipeline), safeString(m.pipeline_to_investment)]));

  markdown += `\n💡 ${safeString(financial.roi_summary)}\n`;
  markdown += `Formula: ${safeString(financial.roi_formula)}\n\n`;

  markdown += `📐 ASSUMPTIONS & SOURCES\n\n`;
  markdown += formatTable(['Assumption', 'Source'], safeArray(financial.assumptions).map((a: any) => [safeString(a.assumption), safeString(a.source)]));

  markdown += `\n9.5 UNIT ECONOMICS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 KEY METRICS

`;
  markdown += `  • CAC (Customer Acquisition Cost):   ${safeString(unitEconomics.cac?.value)}\n`;
  markdown += `    └─ ${safeString(unitEconomics.cac?.calculation)}\n`;
  markdown += `    └─ Benchmark: ${safeString(unitEconomics.cac?.benchmark)}\n\n`;
  markdown += `  • LTV (Lifetime Value):             ${safeString(unitEconomics.ltv?.value)}\n`;
  markdown += `    └─ ${safeString(unitEconomics.ltv?.calculation)}\n`;
  markdown += `    └─ Benchmark: ${safeString(unitEconomics.ltv?.benchmark)}\n\n`;
  markdown += `  • LTV:CAC Ratio:                    ${safeString(unitEconomics.ltv_cac_ratio?.value)}\n`;
  markdown += `    └─ Health: ${safeString(unitEconomics.ltv_cac_ratio?.health)}\n`;
  markdown += `    └─ Benchmark: ${safeString(unitEconomics.ltv_cac_ratio?.benchmark)}\n\n`;
  markdown += `  • Payback Period:                   ${safeString(unitEconomics.payback_period?.months)} months\n`;
  markdown += `    └─ ${safeString(unitEconomics.payback_period?.calculation)}\n`;
  markdown += `    └─ Benchmark: ${safeString(unitEconomics.payback_period?.benchmark)}\n\n`;

  markdown += `📊 GROSS MARGIN PER TIER\n\n`;
  markdown += formatTable(['Tier', 'Revenue', 'Cost', 'Margin', 'Note'], safeArray(unitEconomics.gross_margin_per_tier).map((g: any) => [safeString(g.tier), safeString(g.revenue), safeString(g.cost), safeString(g.margin), safeString(g.note)]));

  markdown += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

9.6 BREAK-EVEN ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 BREAK-EVEN METRICS

`;
  markdown += `  • Fixed Costs (monthly):            ${safeString(breakEven.fixed_costs)}\n`;
  markdown += `  • Revenue per Unit:                 ${safeString(breakEven.revenue_per_unit)}\n`;
  markdown += `  • Variable Cost per Unit:           ${safeString(breakEven.variable_cost_per_unit)}\n`;
  markdown += `  • Contribution Margin:              ${safeString(breakEven.contribution_margin)}\n\n`;
  markdown += `  🎯 UNITS REQUIRED TO BREAK-EVEN:     ${safeString(breakEven.units_required)} customers\n`;
  markdown += `  🎯 TRAFFIC REQUIRED:                  ${safeString(breakEven.traffic_required)} visitors\n`;
  markdown += `  🎯 MONTHS TO BREAK-EVEN:             ${safeString(breakEven.months_to_breakeven)} months\n\n`;
  if (breakEven.formula) markdown += `  Formula: ${safeString(breakEven.formula)}\n\n`;

  markdown += `📊 SENSITIVITY ANALYSIS\n\n`;
  markdown += formatTable(
    ['Scenario', 'Traffic Growth', 'Pipeline', 'ROI', 'LTV:CAC', 'Break-even'],
    [
      ['🟢 Best Case', safeString(sensitivity.best_case?.traffic_growth), safeString(sensitivity.best_case?.pipeline), safeString(sensitivity.best_case?.roi), safeString(sensitivity.best_case?.ltv_cac), `${safeString(sensitivity.best_case?.breakeven_months)} mo`],
      ['🟡 Expected', safeString(sensitivity.expected_case?.traffic_growth), safeString(sensitivity.expected_case?.pipeline), safeString(sensitivity.expected_case?.roi), safeString(sensitivity.expected_case?.ltv_cac), `${safeString(sensitivity.expected_case?.breakeven_months)} mo`],
      ['🔴 Worst Case', safeString(sensitivity.worst_case?.traffic_growth), safeString(sensitivity.worst_case?.pipeline), safeString(sensitivity.worst_case?.roi), safeString(sensitivity.worst_case?.ltv_cac), `${safeString(sensitivity.worst_case?.breakeven_months)} mo`],
    ]
  );

  markdown += `\n10. CASE STUDIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  if (safeArray(analysis.case_studies).length === 0) {
    markdown += `No verified case-study source and publication permission were supplied; no client results are asserted.\n`;
  } else {
    safeArray(analysis.case_studies).forEach((cs: any, i: number) => {
      markdown += `CASE STUDY ${i + 1}: ${safeString(cs.title)}\n`;
      markdown += `${safeString(cs.summary)}\n\n`;
    });
  }

  markdown += `\nAPPENDIX A — EVIDENCE, METHODOLOGY & DATA SOURCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📖 METHODOLOGY
${safeString(analysis.methodology_note)}

📚 LIVE SERP EVIDENCE

`;
  markdown += formatTable(['#', 'Title', 'URL'], serpResults.slice(0, 10).map((r: any, i: number) => [String(i + 1), safeString(r.title), safeString(r.link)]));

  markdown += `\n⚠️ DATA LIMITATIONS\n`;
  dataLimitations.forEach((d: string, i: number) => markdown += `${i + 1}. ${d}\n`);

  markdown += `\n📡 DATA SOURCE DISCLOSURE\n`;
  markdown += `• Keyword Data: ${keywords.some((k: any) => k.dataSource === 'dataforseo') ? 'DataForSEO-verified where returned; unverified candidates labeled' : 'No verified keyword metrics returned; candidate phrases only'}\n`;
  markdown += `• SERP Data: ${serpProvider}\n`;
  markdown += `• Trend Data: ${trendSource === 'none' ? 'No provider trend series returned' : trendSource}\n`;
  markdown += `• Currency: ${currency.code} (${currency.symbol.trim()})\n`;
  markdown += `• Strategic Synthesis: Nexlor Senior Research Division\n`;

  markdown += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ DISCLAIMER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This report is for informational purposes only and does not constitute
legal, tax, or financial advice. Please consult qualified professionals
before making business decisions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by Nexlor Senior Research Division.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  const result = {
    markdown: cleanMarkdown(markdown),
    metadata: {
      niche, country, reference, date: today,
      generatedAt: new Date().toISOString(),
      version: 'v13',
      options: { clientName: options?.clientName, website: options?.website },
    },
  };

  cacheService.set(cacheKey, result);
  return result;
}
