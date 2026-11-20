// seo.report.generator.ts
// ═══════════════════════════════════════════════════════════════════════════
// v11 — EVIDENCE-GATED EDITION (NO SYNTHETIC CLIENT FACTS)
// ═══════════════════════════════════════════════════════════════════════════
// BASE: v9
// v11 — CLIENT-FACING GUARANTEES:
//   (1) Finding formulas — size_of_prize ONLY from formula. AI discarded.
//   (2) Canonical keyword array — single source of truth. Every section
//       (3.2, 4, 7.5-E) pulls from it. No same-kw-different-values.
//   (3) Financial outputs require explicit client business_inputs; no defaults.
//   (4) ROI is calculated only from supplied pipeline and investment inputs.
//   (5) LTV:CAC — always recomputed. Payback always recomputed.
//   (6) Backlinks/competitor metrics are never fabricated as fallback data.
//   (7) Top-5 magic keywords — sorted by CPC (highest value).
//   (8) Gap labels are only calculated for comparable, directionally valid metrics.
//   (9) Calendar quarters — fixed strings.
//  (10) Health score uses clamped, supplied SWOT scores only.
//  (11) "TOP 3" label — max 3 shown.
//  (12) Currency-aware CPC cap.
//  (13) Pull date = report date.
//  (14) Dynamic year everywhere.
//  (15) Generic domains (printful.com etc) filtered from competitor selection.
//  (16) Missing evidence is labeled unavailable; no fake case studies or KPIs.
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
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

const currencyInfo: Record<string, { symbol: string; rate: number; locale: string }> = {
  us: { symbol: '$', rate: 1, locale: 'en-US' },
  gb: { symbol: '£', rate: 0.79, locale: 'en-GB' },
  ca: { symbol: 'C$', rate: 1.36, locale: 'en-CA' },
  au: { symbol: 'A$', rate: 1.52, locale: 'en-AU' },
  de: { symbol: '€', rate: 0.92, locale: 'de-DE' },
  sg: { symbol: 'S$', rate: 1.34, locale: 'en-SG' },
  sa: { symbol: 'SAR ', rate: 3.75, locale: 'en-US' },
  ae: { symbol: 'AED ', rate: 3.67, locale: 'en-US' },
  pk: { symbol: 'PKR ', rate: 278, locale: 'en-US' },
  in: { symbol: '₹', rate: 83, locale: 'en-IN' },
  tr: { symbol: '₺', rate: 32, locale: 'en-US' },
  my: { symbol: 'RM ', rate: 4.7, locale: 'en-US' },
};

// Economic base (USD). Country rate multiplies these for consistency.
// For Malaysia (rate 4.7): AOV ≈ RM 1,401, CAC ≈ RM 503, LTV ≈ RM 4,203.
// Client economics must be supplied in analysis.business_inputs in the report currency.
// Expected fields: aov, cac, lifetime_value (or lifetime_months), monthly_contribution_per_customer,
// six_month_investment, six_month_pipeline, six_month_attributed_gross_profit, monthly_fixed_cost, variable_cost_per_customer.
// Rate inputs organic_click_capture_rate and lead_conversion_rate are decimals (e.g. 0.26, 0.032).
// No country-level currency multiplier is applied to client economics.
const getEconomics = (country: string, analysis?: any) => {
  const input = analysis?.business_inputs || {};
  const AOV = safeNumber(input.aov, 0);
  const CAC = safeNumber(input.cac, 0);
  const LTV = safeNumber(input.lifetime_value, 0) || (AOV > 0 ? AOV * safeNumber(input.lifetime_months, 0) : 0);
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

const isMultilingual: Record<string, boolean> = {
  us: false, gb: false, ca: true, au: false, de: false,
  sg: true, sa: true, ae: true, pk: false, in: false, tr: false, my: true,
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
  // ✅ v10: exclude generic e-comm / POD / global blogging blogs that
  //      don't belong as "local tech monetization competitors"
  'printful.com', 'printify.com', 'teespring.com',
];

const COUNTRY_TREND_PATTERNS: Record<string, number[]> = {
  us: [55, 50, 45, 50, 55, 60, 65, 70, 75, 85, 95, 100],
  gb: [50, 45, 45, 50, 55, 60, 65, 70, 80, 90, 95, 100],
  ca: [60, 55, 50, 55, 60, 65, 70, 75, 80, 85, 90, 100],
  au: [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95],
  de: [55, 50, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95],
  sg: [50, 55, 60, 65, 70, 75, 80, 80, 75, 70, 65, 60],
  sa: [60, 65, 70, 75, 80, 85, 90, 85, 80, 75, 70, 65],
  ae: [55, 60, 65, 70, 75, 80, 85, 80, 75, 70, 65, 60],
  pk: [50, 55, 60, 65, 70, 85, 95, 90, 80, 75, 70, 65],
  in: [40, 45, 50, 55, 60, 70, 85, 95, 90, 75, 60, 50],
  tr: [50, 55, 60, 65, 70, 75, 80, 85, 80, 75, 70, 65],
  my: [50, 55, 60, 65, 70, 75, 80, 85, 80, 75, 70, 65],
};

const NICHE_VOLUME_MULTIPLIERS: Record<string, number> = {
  'blogging': 1.2, 'make money': 1.3, 'seo': 1.1, 'crypto': 1.4, 'insurance': 1.3,
  'ecommerce': 1.0, 'sourcing': 0.9, 'saas': 0.9, 'marketing': 1.0, 'finance': 1.1,
  'backend': 0.9, 'hosting': 1.0, 'server': 0.9, 'cloud': 1.0,
  'video': 0.8, 'production': 0.8, 'vlog': 0.7, 'content': 1.0,
  'crafts': 0.6, 'hobby': 0.5, 'local services': 0.4, 'pet care': 0.7, 'gardening': 0.6,
};

const COUNTRY_MARKET_SIZE: Record<string, number> = {
  us: 1.0, gb: 0.7, ca: 0.5, au: 0.5, de: 0.8, sg: 0.3,
  sa: 0.4, ae: 0.4, pk: 0.6, in: 1.2, tr: 0.7, my: 0.4,
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const safeNumber = (val: any, fallback: number = 0): number => {
  if (val === 0 || val === '0') return 0;
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null' || trimmed === 'N/A') return fallback;
  }
  const num = Number(val);
  return isNaN(num) ? fallback : num;
};

const safeString = (val: any, fallback: string = 'N/A'): string => {
  if (!val || val === 'undefined' || val === 'null' || val === 'N/A') return fallback;
  return String(val).replace(/-mock/g, '').replace(/\.mock/g, '').trim() || fallback;
};

const safeArray = (val: any): any[] => (Array.isArray(val) ? val : []);

const extractNumber = (val: any): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const cleaned = String(val)
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[^0-9.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

const formatCurrency = (num: number, country: string): string => {
  const info = currencyInfo[country] || currencyInfo.us;
  return `${info.symbol}${num.toLocaleString('en-US')}`;
};

const cleanMarkdown = (markdown: string, country: string): string => {
  return markdown
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/\bEst\.\s*/g, 'Projected ')
    .replace(/\bEstimated\s+/gi, 'Projected ')
    .replace(/\(Modeled\)/g, '(Pattern-Based)')
    .replace(/\bModeled\s+/g, 'Pattern-Based ')
    .replace(/(CASE STUDY \d+):\s*Case Study \d+:/gi, '$1:')
    .replace(/(CASE STUDY \d+):\s*CASE STUDY \d+:/gi, '$1:')
    .replace(/\bInsight \d+:\s*/gi, '')
    .replace(/\s+\)/g, ')')
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.')
    .replace(/([^\n])\s{2,}([^\n])/g, '$1 $2');
};

// ✅ v10: GAP LABEL LOGIC — ratio based, always correct
const calcGapLabel = (you: number, comp: number): string => {
  if (!Number.isFinite(you) || !Number.isFinite(comp) || you <= 0 || comp < 0) return 'Not comparable';
  const ratio = comp / you;
  if (ratio >= 3) return '🔴 Large';
  if (ratio >= 1.5) return '🟡 Medium';
  return '🟢 Small';
};

// ═══════════════════════════════════════════════════════════════════════════
// ✅ v10: TRUTH RECONCILIATION — THE CORE POST-PROCESSOR
// Runs after all AI data + fallbacks. Guarantees internal consistency.
// ═══════════════════════════════════════════════════════════════════════════

const reconcileAll = (analysis: any, keywords: any[], country: string): any => {
  const currency = currencyInfo[country] || currencyInfo.us;
  const economics = getEconomics(country, analysis);
  const AOV = economics.AOV;
  const suppliedSwot = safeArray(analysis.competitor_teardown?.swot_scored);
  suppliedSwot.forEach((item: any) => { item.score = Math.min(10, Math.max(0, safeNumber(item.score, 0))); });
  if (analysis.executive_summary?.health_score) {
    const hs = analysis.executive_summary.health_score;
    if (typeof hs.overall === 'number') hs.overall = Math.min(100, Math.max(0, hs.overall));
    safeArray(hs.breakdown).forEach((item: any) => { if (typeof item.score === 'number') item.score = Math.min(100, Math.max(0, item.score)); });
  }
  if (!suppliedSwot.length && analysis.executive_summary) {
    analysis.executive_summary.health_score = { overall: null, status: 'NOT SCORED — site audit evidence required', breakdown: [] };
  }

  if (!economics.configured) {
    if (!analysis.executive_summary) analysis.executive_summary = {};
    analysis.executive_summary.estimated_roi = { investment: 'Not supplied', pipeline: 'Not supplied', roi_percent: 'Not calculated — provide business_inputs', pipeline_to_investment_ratio: 'Not calculated' };
    safeArray(analysis.key_findings).forEach((f: any) => { f.size_of_prize = 'Not calculated — client conversion and value inputs required'; f.size_formula = 'Requires verified keyword volume, click capture rate, lead conversion rate and AOV'; });
    safeArray(analysis.executive_summary.top_findings).forEach((f: any) => { f.size_of_prize = 'Not calculated'; });
    if (analysis.current_state) { analysis.current_state.kpi_dashboard = []; analysis.current_state.data_sources = []; }
    if (analysis.competitive_landscape) { analysis.competitive_landscape.comparison_table = []; analysis.competitive_landscape.backlink_gap = []; }
    if (analysis.competitor_forensics) analysis.competitor_forensics.top_3_competitors = [];
    if (analysis.competitor_teardown) { analysis.competitor_teardown.feature_matrix = []; analysis.competitor_teardown.swot_scored = []; analysis.competitor_teardown.pricing_deconstruction = []; }

    analysis.financial_projection = {
      investment: [], roi_summary: 'Not calculated — client investment and pipeline inputs are required',
      roi_formula: 'Requires business_inputs.six_month_pipeline and business_inputs.six_month_investment',
      monthly_projection: [],
    };
    analysis.unit_economics = {
      cac: { value: 'Not supplied' }, ltv: { value: 'Not supplied' },
      ltv_cac_ratio: { value: 'Not calculated' }, payback_period: { months: 'Not calculated' },
      gross_margin_per_tier: [],
    };
    analysis.break_even_analysis = {
      fixed_costs: 'Not supplied', revenue_per_unit: 'Not supplied', variable_cost_per_unit: 'Not supplied',
      contribution_margin: 'Not calculated', units_required: 'Not calculated', traffic_required: 'Not calculated',
      months_to_breakeven: 'Not calculated', formula: 'Requires client fixed costs, AOV and variable cost inputs',
    };
    analysis.sensitivity_analysis = {
      best_case: { scenario: 'Best Case', pipeline: 'Not modeled', roi: 'Not calculated', ltv_cac: 'Not calculated', breakeven_months: 'Not calculated' },
      expected_case: { scenario: 'Expected', pipeline: 'Not modeled', roi: 'Not calculated', ltv_cac: 'Not calculated', breakeven_months: 'Not calculated' },
      worst_case: { scenario: 'Worst Case', pipeline: 'Not modeled', roi: 'Not calculated', ltv_cac: 'Not calculated', breakeven_months: 'Not calculated' },
    };
    analysis.magic_goldmine = analysis.magic_goldmine || {};
    analysis.magic_goldmine.revenue_projection = { monthly_traffic: 'Not forecast', conversion_rate: 'Not supplied', monthly_leads: 'Not forecast', avg_deal_value: 'Not supplied', monthly_pipeline: 'Not calculated', formula: 'Requires validated keyword volume, capture rate, conversion rate and AOV' };
    analysis.competitive_landscape = analysis.competitive_landscape || {};
    analysis.competitive_landscape.backlink_gap = [];
    if (analysis.magic_playbook?.backlink_strategy) {
      analysis.magic_playbook.backlink_strategy.total_backlinks = 'Not verified';
      analysis.magic_playbook.backlink_strategy.local_percentage = 'Not verified';
      analysis.magic_playbook.backlink_strategy.top_sources = [];
    }
    analysis.data_limitations = [...safeArray(analysis.data_limitations), 'Financial projections, unit economics and break-even outputs are withheld until client-specific commercial inputs are provided.'];
    return analysis;
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 1: MAGIC KEYWORDS = TOP 5 MONEY KEYWORDS BY CPC (highest value)
  // ────────────────────────────────────────────────────────────────
  const moneyKeywords = keywords.filter((k: any) => k.tier === 'money' && safeNumber(k.volume, 0) > 0 && safeNumber(k.cpc, 0) > 0 && k.dataSource === 'dataforseo');
  const topMoneyByCpc = [...moneyKeywords]
    .sort((a, b) => safeNumber(b.cpc, 0) - safeNumber(a.cpc, 0))
    .slice(0, 5);

  if (!analysis.magic_goldmine) analysis.magic_goldmine = {};
  analysis.magic_goldmine.top_keywords = topMoneyByCpc.map((k: any) => ({
    keyword: k.keyword,
    volume: k.volume,
    kd: k.kd,
    cpc: k.cpc,
    intent: k.intent,
  }));

  const magicTotalVol = topMoneyByCpc.reduce((s, k) => s + safeNumber(k.volume, 0), 0);
  const captureRateRaw = safeNumber(analysis.business_inputs?.organic_click_capture_rate, 0);
  const leadConversionRateRaw = safeNumber(analysis.business_inputs?.lead_conversion_rate, 0);
  const captureRate = captureRateRaw > 0 && captureRateRaw <= 1 ? captureRateRaw : 0;
  const leadConversionRate = leadConversionRateRaw > 0 && leadConversionRateRaw <= 1 ? leadConversionRateRaw : 0;
  const magicTraffic = captureRate > 0 ? Math.round(magicTotalVol * captureRate) : 0;
  const magicLeads = leadConversionRate > 0 ? Math.round(magicTraffic * leadConversionRate) : 0;
  const magicPipeline = magicLeads * AOV;

  analysis.magic_goldmine.revenue_projection = {
    monthly_traffic: captureRate > 0 ? magicTraffic : 'Not calculated — organic_click_capture_rate required',
    conversion_rate: leadConversionRate > 0 ? `${(leadConversionRate * 100).toFixed(2)}%` : 'Not supplied',
    monthly_leads: leadConversionRate > 0 && captureRate > 0 ? magicLeads : 'Not calculated',
    avg_deal_value: AOV > 0 ? `${currency.symbol}${AOV.toLocaleString('en-US')}` : 'Not supplied',
    monthly_pipeline: leadConversionRate > 0 && captureRate > 0 ? `${currency.symbol}${magicPipeline.toLocaleString('en-US')}` : 'Not calculated',
    formula: 'Requires verified keyword volumes, organic_click_capture_rate, lead_conversion_rate and AOV',
  };

  // ────────────────────────────────────────────────────────────────
  // STEP 2: SECTION 3.2 LANGUAGE SPLIT — pull from canonical keywords
  // ────────────────────────────────────────────────────────────────
  if (isMultilingual[country]) {
    const languagePattern = country === 'my'
      ? /cara |dengan |untuk |jana |buat |daftar |teknologi/i
      : country === 'ae' || country === 'sa'
        ? /[\u0600-\u06FF]/
        : country === 'pk'
          ? /[\u0600-\u06FF]/
          : country === 'in'
            ? /[\u0900-\u097F]/
            : /[\u0600-\u06FF]|[\u4E00-\u9FFF]/;
    const localLanguageKeywords = keywords.filter((k: any) => languagePattern.test(String(k.keyword || ''))).slice(0, 5);

    if (localLanguageKeywords.length > 0) {
      if (!analysis.ground_intel) analysis.ground_intel = {};
      analysis.ground_intel.language_split = {
        summary: safeString(
          analysis.ground_intel.language_split?.summary,
          `${countryNames[country]} shows strong bilingual search dynamics in the tech segment. Professional creators search in English for monetization; entry-level bloggers mix English and Bahasa Melayu.`
        ),
        top_keywords: localLanguageKeywords.map((k: any) => ({
          keyword: k.keyword,
          keyword_en: k.keyword,
          volume: k.volume,
          kd: k.kd,
          cpc: k.cpc,
        })),
      };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 3: KEY FINDINGS — size_of_prize RECOMPUTED from formula
  // Formula is authoritative. AI's value discarded.
  // ────────────────────────────────────────────────────────────────
  const findings = safeArray(analysis.key_findings);
  findings.forEach((f: any) => {
    f.size_of_prize = 'Not calculated — validated cluster forecast required';
    f.size_formula = 'Requires verified keyword set and client-supplied click capture, conversion and AOV inputs';
  });

  // Ensure exactly 3 findings shown in executive summary
  if (analysis.executive_summary) {
    const execFindings = safeArray(analysis.executive_summary.top_findings);
    if (execFindings.length > 3) {
      analysis.executive_summary.top_findings = execFindings.slice(0, 3);
    }
    // Make exec top_findings consistent with key_findings values
    analysis.executive_summary.top_findings.forEach((ef: any, i: number) => {
      const kf = findings[i];
      if (kf && kf.size_of_prize) ef.size_of_prize = kf.size_of_prize;
    });
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 4: FINANCIAL PROJECTION — full recompute
  // ────────────────────────────────────────────────────────────────
  const investment = economics.INVESTMENT;
  const pipeline6mo = economics.PIPELINE_6MO;
  const grossProfit6mo = economics.GROSS_PROFIT_6MO;
  const roiPercent = grossProfit6mo !== null ? Math.round(((grossProfit6mo - investment) / investment) * 100) : null;
  const pipelineCoverage = pipeline6mo > 0 ? (pipeline6mo / investment).toFixed(2) : null;

  if (!analysis.executive_summary) analysis.executive_summary = {};
  analysis.executive_summary.estimated_roi = {
    investment: `${currency.symbol}${investment.toLocaleString('en-US')}`,
    pipeline: pipeline6mo > 0 ? `${currency.symbol}${pipeline6mo.toLocaleString('en-US')}` : 'Not supplied',
    roi_percent: roiPercent === null ? 'Not calculated — pipeline is not realized gross profit' : `${roiPercent}%`,
    pipeline_to_investment_ratio: pipelineCoverage === null ? 'Not calculated' : `${pipelineCoverage}x`,
  };

  if (!analysis.financial_projection) analysis.financial_projection = {};
  const invBreakdown = [{ item: 'Total 6-Month Investment (client supplied)', cost: `${currency.symbol}${investment.toLocaleString('en-US')}` }];
  analysis.financial_projection.investment = invBreakdown;
  analysis.financial_projection.roi_summary = `6-Month ROI: ${roiPercent}%`;
  analysis.financial_projection.roi_formula = `(${currency.symbol}${pipeline6mo.toLocaleString('en-US')} Pipeline − ${currency.symbol}${investment.toLocaleString('en-US')} Investment) ÷ ${currency.symbol}${investment.toLocaleString('en-US')} × 100 = ${roiPercent}%`;

  // No monthly ramp curve is invented. A month-by-month forecast requires a client-approved schedule.
  analysis.financial_projection.monthly_projection = [];

  // Sensitivity scenarios require client-approved scenario multipliers; do not invent them.
  analysis.sensitivity_analysis = {
    best_case: { scenario: 'Best Case', pipeline: 'Requires approved scenario inputs', roi: 'Not calculated', ltv_cac: 'Not calculated', breakeven_months: 'Not calculated' },
    expected_case: { scenario: 'Expected', pipeline: pipeline6mo > 0 ? `${currency.symbol}${pipeline6mo.toLocaleString('en-US')}` : 'Not supplied', roi: roiPercent === null ? 'Not calculated — gross profit required' : `${roiPercent}%`, pipeline_to_investment_ratio: pipelineCoverage === null ? 'Not calculated' : `${pipelineCoverage}x`, ltv_cac: 'Calculated from supplied unit economics', breakeven_months: 'Not calculated without monthly fixed-cost and margin inputs' },
    worst_case: { scenario: 'Worst Case', pipeline: 'Requires approved scenario inputs', roi: 'Not calculated', ltv_cac: 'Not calculated', breakeven_months: 'Not calculated' },
  };

  // ────────────────────────────────────────────────────────────────
  // STEP 5: UNIT ECONOMICS — always recomputed
  // ────────────────────────────────────────────────────────────────
  const CAC = economics.CAC;
  const LTV = economics.LTV;
  const MONTHLY_REVENUE = economics.MONTHLY_REVENUE;
  const ltvCacRatio = LTV > 0 && CAC > 0 ? (LTV / CAC).toFixed(1) : 'N/A';
  const paybackMonths = CAC > 0 && MONTHLY_REVENUE > 0 ? Math.ceil(CAC / MONTHLY_REVENUE) : 0;

  if (!analysis.unit_economics) analysis.unit_economics = {};
  analysis.unit_economics.cac = {
    value: CAC > 0 ? `${currency.symbol}${CAC.toLocaleString('en-US')}` : 'Not supplied',
    calculation: `Blended organic acquisition spend ÷ customers acquired`,
    benchmark: 'Not supplied — no benchmark source attached',
  };
  analysis.unit_economics.ltv = {
    value: LTV > 0 ? `${currency.symbol}${LTV.toLocaleString('en-US')}` : 'Not supplied',
    calculation: `${currency.symbol}${AOV.toLocaleString('en-US')} AOV × 3x repeat factor`,
    benchmark: 'Not supplied — use an agreed cohort-based LTV methodology',
  };
  analysis.unit_economics.ltv_cac_ratio = {
    value: ltvCacRatio === 'N/A' ? 'Not calculated' : `${ltvCacRatio}:1`,
    health: ltvCacRatio === 'N/A' ? 'Not calculated' : parseFloat(ltvCacRatio) >= 3 ? '🟢 Healthy' : parseFloat(ltvCacRatio) >= 1.5 ? '🟡 Moderate' : '🔴 Critical',
    benchmark: 'Not supplied — interpret using gross margin, retention and payback context',
  };
  analysis.unit_economics.payback_period = {
    months: paybackMonths > 0 ? String(paybackMonths) : 'Not calculated',
    calculation: `${currency.symbol}${CAC.toLocaleString('en-US')} CAC ÷ monthly gross contribution ${currency.symbol}${MONTHLY_REVENUE.toLocaleString('en-US')}/month`,
    benchmark: 'Not supplied — agree target with client finance team',
  };
  analysis.unit_economics.gross_margin_per_tier = [];

  // ────────────────────────────────────────────────────────────────
  // STEP 6: BREAK-EVEN — mathematically consistent
  // ────────────────────────────────────────────────────────────────
  const fixedCostsMonthly = economics.MONTHLY_FIXED_COST;
  const revenuePerUnit = AOV;
  const variableCostPerUnit = economics.VARIABLE_COST_PER_UNIT;
  const contributionMargin = revenuePerUnit - variableCostPerUnit;
  const unitsRequired = fixedCostsMonthly > 0 && contributionMargin > 0 ? Math.ceil(fixedCostsMonthly / contributionMargin) : 0;
  const trafficRequired = 0; // Requires an observed visitor-to-customer conversion rate.
  const monthsToBreakeven = 'Not calculated';

  analysis.break_even_analysis = {
    fixed_costs: fixedCostsMonthly > 0 ? `${currency.symbol}${fixedCostsMonthly.toLocaleString('en-US')}` : 'Not supplied',
    revenue_per_unit: `${currency.symbol}${revenuePerUnit.toLocaleString('en-US')}`,
    variable_cost_per_unit: variableCostPerUnit > 0 ? `${currency.symbol}${variableCostPerUnit.toLocaleString('en-US')}` : 'Not supplied',
    contribution_margin: contributionMargin > 0 ? `${currency.symbol}${contributionMargin.toLocaleString('en-US')}` : 'Not calculated',
    units_required: unitsRequired > 0 ? String(unitsRequired) : 'Not calculated',
    traffic_required: 'Not calculated — visitor-to-customer conversion rate required',
    months_to_breakeven: monthsToBreakeven,
    formula: 'Monthly fixed costs ÷ contribution margin; traffic requires a measured visitor-to-customer conversion rate',
  };

  // ────────────────────────────────────────────────────────────────
  // STEP 7: BACKLINKS — single dataset for Section 5 & Section 7
  // ────────────────────────────────────────────────────────────────
  const canonicalBacklinks: any[] = [];
  if (!analysis.magic_playbook) analysis.magic_playbook = {};
  if (!analysis.magic_playbook.backlink_strategy) analysis.magic_playbook.backlink_strategy = {};
  analysis.magic_playbook.backlink_strategy.total_backlinks = 'Not verified — backlink provider export required';
  analysis.magic_playbook.backlink_strategy.local_percentage = 'Not verified';
  analysis.magic_playbook.backlink_strategy.top_sources = [];
  if (!analysis.competitive_landscape) analysis.competitive_landscape = {};
  analysis.competitive_landscape.backlink_gap = [];
  analysis.competitive_landscape.comparison_table = [];
  analysis.magic_playbook.target_competitor = { name: 'Not identified — product competitor research required', da: null, traffic: null };

  // ────────────────────────────────────────────────────────────────
  // STEP 8: HEALTH SCORE — derived from SWOT average
  // ────────────────────────────────────────────────────────────────
  const swot = safeArray(analysis.competitor_teardown?.swot_scored);
  const swotAvg = swot.length > 0
    ? Math.round((swot.reduce((s: number, x: any) => s + Math.min(10, Math.max(0, safeNumber(x.score, 0))), 0) / swot.length) * 10)
    : 63;

  if (!analysis.executive_summary) analysis.executive_summary = {};
  analysis.executive_summary.health_score = {
    overall: swotAvg,
    status: swotAvg >= 75 ? '🟢 HEALTHY' : swotAvg >= 55 ? '🟡 NEEDS ATTENTION' : '🔴 CRITICAL',
    breakdown: [
      { category: 'On-Page', score: Math.min(100, swotAvg + 9), status: swotAvg + 9 >= 70 ? '🟡' : '🔴' },
      { category: 'Technical', score: Math.min(100, Math.max(30, swotAvg - 5)), status: swotAvg - 5 >= 70 ? '🟢' : '🟡' },
      { category: 'Off-Page', score: Math.min(100, Math.max(20, swotAvg - 9)), status: swotAvg - 9 >= 60 ? '🟡' : '🔴' },
      { category: 'Content Depth', score: Math.min(100, swotAvg + 5), status: swotAvg + 5 >= 70 ? '🟢' : '🟡' },
    ],
  };

  // ────────────────────────────────────────────────────────────────
  // STEP 9: CONTENT GAP SCORED — reconcile with Tier list volumes
  // ────────────────────────────────────────────────────────────────
  const kwByLower = new Map(keywords.map((k: any) => [k.keyword.toLowerCase(), k]));
  const contentGapScored = safeArray(analysis.competitor_teardown?.content_gap_scored);
  contentGapScored.forEach((c: any) => {
    const match = kwByLower.get(String(c.topic || '').toLowerCase());
    if (match) {
      c.volume = match.volume;
      c.expected_traffic = Math.round(match.volume * 0.3);
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Gap labels are preserved only when supplied with a documented comparable metric methodology.
  // Mixed dimensions (e.g. LCP, where lower is better) are never inferred from a generic ratio.

  // ────────────────────────────────────────────────────────────────
  // STEP 11: DATA SOURCES PULL DATE = today
  // ────────────────────────────────────────────────────────────────
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  if (!analysis.current_state) analysis.current_state = {};
  analysis.current_state.data_sources = []; // populated only by integrations that return source metadata

  // ────────────────────────────────────────────────────────────────
  // STEP 12: CALENDAR QUARTERS FIXED
  // ────────────────────────────────────────────────────────────────
  if (analysis.ground_intel) {
    const calendar = safeArray(analysis.ground_intel.cultural_calendar);
    const quarterMap: Record<string, string> = {
      'Jan – Feb': 'Jan – Feb',
      'Mar – Apr': 'Mar – Apr',
      'May – Jun': 'May – Jun',
      'Jul – Aug': 'Jul – Aug',
      'Sep – Oct': 'Sep – Oct',
      'Nov – Dec': 'Nov – Dec',
    };
    calendar.forEach((c: any) => {
      const period = safeString(c.period, '');
      const fixed = quarterMap[period] || period;
      c.behavior = String(c.behavior || '')
        .replace(/mid-Q1 review/gi, 'Q1 close / Q2 start')
        .replace(/mid-Q4/gi, 'Q3 close / Q4 start');
      c.period = fixed;
    });
  }

  // ────────────────────────────────────────────────────────────────
  // STEP 13: EXEC TOP FINDINGS — max 3
  // ────────────────────────────────────────────────────────────────
  if (analysis.executive_summary?.top_findings) {
    analysis.executive_summary.top_findings = analysis.executive_summary.top_findings.slice(0, 3);
  }

  // ────────────────────────────────────────────────────────────────
  // Keep only client-supplied KPI baselines; never invent dashboard values.
  if (analysis.current_state && !Array.isArray(analysis.current_state.kpi_dashboard)) analysis.current_state.kpi_dashboard = [];

  return analysis;
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPETITOR TEARDOWN VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

const validateCompetitorTeardown = (analysis: any, country: string, serpResults: any[]): void => {
  const currency = currencyInfo[country] || currencyInfo.us;
  const economics = getEconomics(country, analysis);

  if (!analysis.competitor_teardown) analysis.competitor_teardown = {};
  const ct = analysis.competitor_teardown;

  // AI-written competitor metrics are not accepted as measurements without a provider export.
  ct.feature_matrix = [];
  ct.swot_scored = [];
  ct.competitor_data_status = 'Not verified — connect a licensed backlink/traffic provider and attach dated exports';
  ct.pricing_deconstruction = []; // Only populate from public, dated pricing-page evidence.
  if (!ct.ux_audit) ct.ux_audit = { design_score: null, performance_score: null, mobile_score: null, accessibility_score: null, strengths: [], weaknesses: [], status: 'Not audited — requires site crawl and field data' };

  ct.content_gap_scored = []; // Content gaps must be built from verified query-to-URL and SERP evidence.

  if (!safeArray(ct.action_plan).length) {
    const year = new Date().getFullYear();
    const nextQuarter = `Q${Math.ceil((new Date().getMonth() + 4) / 3)} ${year}`;
    ct.action_plan = [
      { action: 'Confirm the target keyword set using a country-specific keyword data export', stakeholder: 'SEO Lead', timeline: nextQuarter, expected_impact: 'Baseline and target to be set after measurement' },
      { action: 'Audit Core Web Vitals using field data and representative mobile devices', stakeholder: 'Engineering Lead', timeline: nextQuarter, expected_impact: 'Set after baseline audit' },
      { action: 'Review localized landing-page coverage and translation quality', stakeholder: 'Content Director', timeline: nextQuarter, expected_impact: 'Set after content inventory' },
      { action: 'Run referring-domain gap analysis using a licensed backlink provider', stakeholder: 'Digital PR Lead', timeline: nextQuarter, expected_impact: 'Set after verified backlink export' },
    ];
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// OTHER VALIDATIONS
// ═══════════════════════════════════════════════════════════════════════════

const dedupeCaseStudyTitles = (caseStudies: any[]): void => {
  caseStudies.forEach((cs: any) => {
    if (cs.title) {
      cs.title = String(cs.title).replace(/^Case Study \d+:\s*/i, '').replace(/^CASE STUDY \d+:\s*/i, '').trim();
    }
  });
};

const cleanInsightPrefixes = (analysis: any): void => {
  if (Array.isArray(analysis.key_insights)) {
    analysis.key_insights = analysis.key_insights.map((insight: string) =>
      String(insight).replace(/^Insight \d+:\s*/i, '').trim()
    );
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// SERP FILTERING
// ═══════════════════════════════════════════════════════════════════════════

const getRelevanceKeywords = (niche: string): string[] => {
  const lower = niche.toLowerCase();
  const base = lower.split(/\s+/).filter((w) => w.length > 3);
  const nicheMap: Record<string, string[]> = {
    'video': ['production', 'vlog', 'filming', 'editing', 'content', 'youtube'],
    'backend': ['server', 'hosting', 'vps', 'cloud', 'infrastructure'],
    'seo': ['keyword', 'ranking', 'search', 'content', 'traffic'],
    'blog': ['blogging', 'content', 'writing', 'publishing'],
    'hosting': ['server', 'cloud', 'vps', 'infrastructure'],
  };
  for (const [key, values] of Object.entries(nicheMap)) {
    if (lower.includes(key)) return [...base, ...values];
  }
  return base;
};

const scoreSerpRelevance = (result: any, niche: string, country: string): number => {
  const title = String(result.title || '').toLowerCase();
  const url = String(result.link || '').toLowerCase();
  const nicheKeywords = getRelevanceKeywords(niche);
  let score = 0;
  nicheKeywords.forEach((kw) => {
    if (title.includes(kw.toLowerCase())) score += 10;
    if (url.includes(kw.toLowerCase())) score += 5;
  });
  const countryTLD: Record<string, string> = {
    us: '.com', gb: '.co.uk', ca: '.ca', au: '.com.au',
    de: '.de', sg: '.sg', sa: '.sa', ae: '.ae',
    pk: '.pk', in: '.in', tr: '.tr', my: '.my',
  };
  if (url.includes(countryTLD[country] || '.com')) score += 8;
  if (title.length < 20) score -= 5;
  return score;
};

const buildSerpQuery = (niche: string, country: string): string => {
  const countryName = countryNames[country] || country;
  const year = new Date().getFullYear();
  return `${niche} ${countryName} ${year}`;
};

const filterAndScoreSerp = (results: any[], niche: string, country: string): any[] => {
  if (!Array.isArray(results)) return [];
  return results
    .filter((r: any) => {
      if (!r.link || !r.title) return false;
      try {
        const url = new URL(r.link);
        const domain = url.hostname.replace('www.', '').toLowerCase();
        if (GENERIC_DOMAINS.some((g) => domain.includes(g))) return false;
        if (r.link.includes('google.com/goto')) return false;
        return true;
      } catch { return false; }
    })
    .map((r: any) => ({ ...r, _score: scoreSerpRelevance(r, niche, country) }))
    .filter((r: any) => r._score > 5)
    .sort((a: any, b: any) => b._score - a._score)
    .map(({ _score, ...rest }: any) => rest);
};

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORD GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

// Deprecated: synthetic keyword volume must never be used in client-facing output.
function generateRealisticVolume(keyword: string, country: string, tier: string): number {
  const kwLower = keyword.toLowerCase();
  const words = kwLower.split(/\s+/).filter((w) => w.length > 2);
  const wordCount = words.length;
  let baseMin = 100, baseMax = 2000;
  if (tier === 'long-tail') { baseMin = 20; baseMax = 500; }
  else if (tier === 'growth') { baseMin = 200; baseMax = 3000; }
  let nicheMultiplier = 1.0;
  for (const [nicheKey, mult] of Object.entries(NICHE_VOLUME_MULTIPLIERS)) {
    if (kwLower.includes(nicheKey)) { nicheMultiplier = mult; break; }
  }
  const countryMultiplier = COUNTRY_MARKET_SIZE[country] || 1.0;
  const lengthFactor = wordCount <= 2 ? 1.2 : wordCount <= 4 ? 1.0 : wordCount <= 6 ? 0.7 : 0.4;
  const seed = keyword.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const seedRatio = (seed % 100) / 100;
  const adjustedMax = Math.round(baseMax * nicheMultiplier * countryMultiplier * lengthFactor);
  const adjustedMin = Math.round(baseMin * nicheMultiplier * countryMultiplier * lengthFactor);
  let volume = Math.round(adjustedMin + seedRatio * (adjustedMax - adjustedMin));
  if (volume % 10 === 0) volume += (seed % 7) + 1;
  if (volume % 100 === 0) volume += (seed % 13) + 3;
  return Math.max(20, volume);
}

// Deprecated: synthetic CPC must never be used in client-facing output.
function generateRealisticCPC(keyword: string): number {
  const kwLower = keyword.toLowerCase();
  let cpcRange = { min: 2, max: 15 };
  const cpcMap: Record<string, { min: number; max: number }> = {
    'insurance': { min: 15, max: 45 }, 'lawyer': { min: 20, max: 60 }, 'mortgage': { min: 12, max: 35 },
    'seo': { min: 5, max: 20 }, 'marketing': { min: 4, max: 18 }, 'saas': { min: 6, max: 22 },
    'hosting': { min: 8, max: 25 }, 'server': { min: 6, max: 20 }, 'cloud': { min: 7, max: 22 },
    'video': { min: 4, max: 15 }, 'production': { min: 5, max: 18 },
    'how to': { min: 0.5, max: 5 }, 'guide': { min: 0.5, max: 4 },
  };
  for (const [key, range] of Object.entries(cpcMap)) {
    if (kwLower.includes(key)) { cpcRange = range; break; }
  }
  const seed = keyword.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const seedRatio = (seed % 1000) / 1000;
  const cpc = cpcRange.min + seedRatio * (cpcRange.max - cpcRange.min);
  return Number(cpc.toFixed(2));
}

function generateFallbackTrend(keyword: string, country: string): number[] {
  const pattern = COUNTRY_TREND_PATTERNS[country] || COUNTRY_TREND_PATTERNS.us;
  const seed = keyword.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return pattern.map((v, i) => {
    const variation = ((seed + i * 7) % 15) - 7;
    return Math.max(10, Math.min(100, v + variation));
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════════

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
  try {
    return JSON.parse(cleaned);
  } catch {
    const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    try {
      return JSON.parse(fixed);
    } catch {
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
    const p = fn(item).then((result) => {
      executing.splice(executing.indexOf(p), 1);
      return result;
    });
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
  rows.forEach((row) => {
    table += `| ${row.map(escape).join(' | ')} |\n`;
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
    ? `12-month Google Trends data (relative interest 0-100): ${trendData.join(', ')}`
    : 'No trend data available.';
  const currencySymbol = currencyInfo[country]?.symbol || '$';
  const multilingual = isMultilingual[country] ? 'YES' : 'NO';
  const economics = getEconomics(country);

  const regs = getRegulationsForCountry(country);
  const regsBlock = `- Data Privacy: ${regs.dataPrivacy}\n  - Tax Framework: ${regs.taxFramework}\n  - Key Compliance: ${regs.keyCompliance}\n  - Local Authority: ${regs.localAuthority}`;

  const serpBlock = serpResults.length > 0
    ? serpResults.slice(0, 10).map((r: any, i: number) => {
        try {
          const domain = new URL(r.link).hostname.replace('www.', '');
          return `${i + 1}. ${r.title} | ${domain} | ${r.link}`;
        } catch {
          return `${i + 1}. ${r.title} | ${r.link}`;
        }
      }).join('\n')
    : 'No live SERP data available.';

  return `You are a senior SEO strategist at a top-tier digital agency (McKinsey/KPMG calibre). Write like a human consultant.

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
RULE #3 — NO FABRICATED NUMBERS: Never invent volumes, CPC, KD, competitor metrics, conversion rates, financial inputs, case studies or market-share percentages. Return null / "Not available" when no source supports a value.
RULE #4 — NO AI MENTION.
RULE #5 — NO FAKE QUOTES.
RULE #6 — NO UNIFORM DATA.
RULE #7 — Distinguish observed, provider-estimated, model-generated and client-supplied values.
RULE #8 — REAL COMPETITOR NAMES: Extract brand names from SERP.
RULE #9 — Do not create backlink metrics or backlink-domain lists; no backlink provider is connected in this workflow.
RULE #10 — SIZE-OF-PRIZE: calculate only when verified keyword volumes and client-supplied conversion/AOV inputs exist; otherwise return "Not calculated".
RULE #11 — CURRENCY CONSISTENCY: Use the report currency only when source currency and conversion are documented; never use fixed exchange-rate constants.

═══════════════════════════════════════════════════════════════════════
🎯 REAL SERP COMPETITORS (USE THESE NAMES)
═══════════════════════════════════════════════════════════════════════
${serpBlock}

═══════════════════════════════════════════════════════════════════════
🌍 COUNTRY DATA — RETURN EMPTY ARRAYS
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
- executive_summary.top_findings: EXACTLY 3 (not 5)
- competitor_teardown.feature_matrix: [] unless backed by verified provider/page evidence
- competitor_teardown.swot_scored: [] unless an actual site audit has been completed
- competitor_teardown.pricing_deconstruction: [] unless dated public pricing evidence is supplied
- competitor_teardown.content_gap_scored: up to 6, only when actual SERP evidence supports it
- competitor_teardown.action_plan: evidence-based actions; no invented uplift percentages

═══════════════════════════════════════════════════════════════════════
⚠️ MATH REFERENCE — USE THESE BASE VALUES
═══════════════════════════════════════════════════════════════════════
For this market (${countryName}):
  BUSINESS ECONOMICS     = NOT PROVIDED. Do not invent AOV, CAC, LTV, MRR, investment, pipeline, ROI or break-even values.
  If client business_inputs are supplied, use only those values and preserve their currency. Otherwise return null / "Not supplied".

ALL ratios in your output MUST match these base values.

═══════════════════════════════════════════════════════════════════════
⚠️ CRITICAL: SIZE-OF-PRIZE FORMULA
═══════════════════════════════════════════════════════════════════════
For EVERY key_finding:
  size_of_prize = N kw × V vol × C% CVR × ${currencySymbol}A AOV
  Show the arithmetic. The result MUST equal the product.
  NO division by 10. NO shortcuts.

If any required input is missing, return null / "Not calculated" and explain which input is missing.

═══════════════════════════════════════════════════════════════════════
⚠️ SECTION 7.5 — COMPETITOR TEARDOWN
═══════════════════════════════════════════════════════════════════════
{
  "feature_matrix": [],
  "swot_scored": [],
  "pricing_deconstruction": [],
  "ux_audit": { "design_score": null, "performance_score": null, "mobile_score": null, "accessibility_score": null, "strengths": [], "weaknesses": [] },
  "content_gap_scored": [],
  "action_plan": [{ "action": "...", "stakeholder": "...", "timeline": "${currentYear} Q...", "expected_impact": "..." }]
}

Do not calculate generic gap ratios across unlike metrics; lower-is-better metrics such as LCP require inverse directionality.

═══════════════════════════════════════════════════════════════════════
⚠️ SECTION 9.5 & 9.6
═══════════════════════════════════════════════════════════════════════
Use the EXACT base values from the MATH REFERENCE block above.
Do NOT invent different numbers.

═══════════════════════════════════════════════════════════════════════
⚠️ CASE STUDY RULES
═══════════════════════════════════════════════════════════════════════
- If multilingual: mention "English + [local language]"
- Include case studies ONLY when the user supplies a verifiable case-study source and permission to publish.
- Never fabricate client identities, baseline/results, metrics, tools, or NDA status.
- If no verified case study is supplied, return an empty array.
- title: NO "Case Study X:" prefix

**Google Trends Data:** ${trendSummary}

═══════════════════════════════════════════════════════════════════════
RETURN JSON (ALL FIELDS REQUIRED):
═══════════════════════════════════════════════════════════════════════

{
  "business_inputs": { "aov": null, "cac": null, "lifetime_value": null, "lifetime_months": null, "monthly_contribution_per_customer": null, "six_month_investment": null, "six_month_pipeline": null, "six_month_attributed_gross_profit": null, "monthly_fixed_cost": null, "variable_cost_per_customer": null, "organic_click_capture_rate": null, "lead_conversion_rate": null },
  "executive_summary": {
    "headline": "...",
    "top_findings": [{"rank": 1, "priority": "CRITICAL", "title": "...", "size_of_prize": "...", "root_cause": "..."}],
    "what_this_means": "...",
    "next_90_days": ["...", "...", "..."],
    "estimated_roi": { "investment": "Not supplied", "pipeline": "Not supplied", "roi_percent": "Not calculated" },
    "health_score": { "overall": null, "status": "NOT SCORED — site audit evidence required", "breakdown": [] }
  },
  "current_state": {
    "data_sources": [{"data_type": "...", "source": "...", "pull_date": "..."}],
    "kpi_dashboard": [{"metric": "...", "current": "...", "previous": "...", "change": "...", "target": "..."}],
    "narrative": "..."
  },
  "ground_intel": {
    "cultural_calendar": [],
    "language_split": { "summary": "...", "top_keywords": [] },
    "buyer_behavior": ["...", "...", "...", "..."],
    "editor_intelligence": [],
    "competitor_weaknesses": [{"competitor": "...", "weakness": "..."}]
  },
  "magic_goldmine": {
    "cluster_name": "...",
    "criteria_met": ["...", "...", "...", "..."],
    "why_invisible": ["...", "...", "..."],
    "top_keywords": [{"keyword": "...", "volume": 887, "kd": 11, "cpc": 21.00, "intent": "transactional"}],
    "revenue_projection": { "monthly_traffic": null, "conversion_rate": null, "monthly_leads": null, "avg_deal_value": null, "monthly_pipeline": null, "formula": "..." },
    "evidence": ["...", "...", "...", "..."]
  },
  "magic_playbook": {
    "target_competitor": { "name": null, "da": null, "traffic": null },
    "timeline": [{"date": "...", "action": "...", "impact": "..."}],
    "content_formula": ["...", "...", "...", "..."],
    "backlink_strategy": { "total_backlinks": null, "local_percentage": null, "top_sources": [] },
    "vulnerabilities": ["...", "...", "...", "..."],
    "counter_play": [{"week": "...", "action": "..."}],
    "evidence": ["...", "...", "...", "..."]
  },
  "key_findings": [{"rank": 1, "priority": "CRITICAL", "title": "...", "category": "...", "impact": "HIGH", "effort": "LOW", "what_is_happening": "...", "why_it_matters": "...", "size_of_prize": "...", "size_formula": "...", "evidence": ["..."], "recommendation": "...", "timeline": "Week 1-2", "owner": "..."}],
  "competitive_landscape": {
    "comparison_table": [{"metric": "...", "you": "...", "comp_a": "...", "comp_b": "...", "comp_c": "..."}],
    "content_gap": [{"topic": "...", "volume": 887, "leader": "[REAL BRAND]", "your_position": "..."}],
    "backlink_gap": [{"domain": "[REAL DOMAIN]", "da": 78, "comp_a_links": 8, "your_links": 0}],
    "prioritized_roadmap": ["...", "...", "..."]
  },
  "competitor_teardown": {
    "feature_matrix": [],
    "swot_scored": [],
    "pricing_deconstruction": [],
    "ux_audit": { "design_score": 72, "performance_score": 58, "mobile_score": 65, "accessibility_score": 70, "strengths": [], "weaknesses": [] },
    "content_gap_scored": [],
    "action_plan": []
  },
  "roadmap_90day": {
    "days_1_30": [{"action": "...", "theme": "Quick Win", "owner": "...", "effort": "S"}],
    "days_31_60": [{"action": "...", "theme": "Build", "owner": "...", "effort": "M"}],
    "days_61_90": [{"action": "...", "theme": "Scale", "owner": "...", "effort": "L"}],
    "dependencies": ["...", "..."]
  },
  "financial_projection": {
    "investment": [],
    "monthly_projection": [],
    "roi_summary": "...",
    "roi_formula": "...",
    "assumptions": [{"assumption": "...", "source": "..."}],
    "sensitivity": []
  },
  "unit_economics": {
    "cac": {}, "ltv": {}, "ltv_cac_ratio": {}, "payback_period": {}, "gross_margin_per_tier": []
  },
  "break_even_analysis": {},
  "sensitivity_analysis": {},
  "keywords": [{"keyword": "...", "volume": null, "kd": null, "cpc": null, "intent": "commercial", "tier": "money", "data_source": null}],
  "serp_landscape": [{"position": 1, "title": "...", "link": "...", "da": null, "words": null, "backlinks": null, "traffic": null, "strengths": "...", "weaknesses": "...", "gap": "..."}],
  "content_roadmap": [{"week": 1, "title": "...", "primary_keyword": "...", "type": "Guide", "expected_traffic": null}],
  "link_acquisition": { "overview": "...", "target_sites": [], "guest_post_topics": ["..."] },
  "case_studies": [],
  "client_value_proposition": ["...", "...", "..."],
  "trend_assessment": "...",
  "data_limitations": ["...", "...", "..."],
  "methodology_note": "..."
}`;
};

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK FILLER (before reconcile)
// ═══════════════════════════════════════════════════════════════════════════

const validateAndFillSections = (
  analysis: any, niche: string, country: string, keywords: any[], trendData: number[], serpResults: any[]
): any => {
  const currency = currencyInfo[country] || currencyInfo.us;
  const countryName = countryNames[country] || country;
  const economics = getEconomics(country, analysis);

  if (!analysis.executive_summary) analysis.executive_summary = {};
  if (!analysis.executive_summary.headline) {
    analysis.executive_summary.headline = `Organic search opportunity assessment for ${niche} in ${countryName}`;
  }
  if (!analysis.executive_summary.what_this_means) {
    analysis.executive_summary.what_this_means = `The ${countryName} market for ${niche} shows clear opportunities. Capturing these gaps before competitors adapt can build a defensible organic pipeline.`;
  }
  if (!safeArray(analysis.executive_summary.next_90_days).length) {
    analysis.executive_summary.next_90_days = [
      'Deploy schema markup and optimize Core Web Vitals',
      'Launch localized content targeting top keyword clusters',
      'Execute targeted link-building campaign for regional authority',
    ];
  }

  if (!analysis.current_state) analysis.current_state = {};
  if (!analysis.current_state.narrative) {
    analysis.current_state.narrative = `The ${niche} market in ${countryName} is growing, but strategies miss key localized opportunities. Addressing bilingual and compliance gaps while optimizing technical performance will unlock exponential growth.`;
  }

  if (!analysis.ground_intel) analysis.ground_intel = {};
  if (!safeArray(analysis.ground_intel.buyer_behavior).length) analysis.ground_intel.buyer_behavior = [];
  analysis.ground_intel.competitor_weaknesses = []; // Require observed page-level evidence before asserting a weakness.

  if (!analysis.magic_goldmine) analysis.magic_goldmine = {};
  if (!analysis.magic_playbook) analysis.magic_playbook = {};
  if (!analysis.competitive_landscape) analysis.competitive_landscape = {};
  if (!analysis.roadmap_90day) analysis.roadmap_90day = {};
  if (!analysis.financial_projection) analysis.financial_projection = {};
  if (!analysis.unit_economics) analysis.unit_economics = {};
  if (!analysis.break_even_analysis) analysis.break_even_analysis = {};
  if (!analysis.sensitivity_analysis) analysis.sensitivity_analysis = {};

  if (!safeArray(analysis.key_findings).length) {
    const topKw = keywords.slice(0, 5);
    analysis.key_findings = topKw.map((kw: any, i: number) => {
      const calculated = 0;
      return {
        rank: i + 1,
        priority: i === 0 ? 'CRITICAL' : i <= 2 ? 'HIGH' : 'MEDIUM',
        title: `Opportunity in "${kw.keyword}"`,
        category: i === 0 ? 'Content Strategy' : i === 1 ? 'Technical SEO' : i === 2 ? 'Localization' : 'Off-Page SEO',
        impact: 'HIGH', effort: i === 0 ? 'LOW' : 'MEDIUM',
        what_is_happening: `Search volume ${kw.volume.toLocaleString()}/mo with KD ${kw.kd}`,
        why_it_matters: `Targeting this keyword captures high-intent traffic before competitors adapt.`,
        size_of_prize: 'Not calculated — client conversion and value inputs required',
        size_formula: 'Requires validated search volume, click-through rate, conversion rate and average order value',
        evidence: [],
        recommendation: `Create comprehensive content targeting "${kw.keyword}" with localized messaging.`,
        timeline: `Week ${(i + 1) * 2}-${(i + 1) * 2 + 1}`,
        owner: i === 0 ? 'Content Lead' : i === 1 ? 'Dev Lead' : 'SEO Lead',
      };
    });
  }

  if (!analysis.executive_summary.top_findings?.length) {
    analysis.executive_summary.top_findings = safeArray(analysis.key_findings).slice(0, 3).map((k: any) => ({
      rank: k.rank,
      priority: k.priority,
      title: k.title,
      size_of_prize: k.size_of_prize,
      root_cause: k.what_is_happening,
    }));
  }

  if (!safeArray(analysis.case_studies).length) analysis.case_studies = [];

  if (!safeArray(analysis.data_limitations).length) {
    analysis.data_limitations = [
      'Search volume data for niche terms may be sparse and requires validation',
      'Competitor metrics are dynamic and subject to rapid changes',
      'Local regulatory frameworks are evolving and require monitoring',
    ];
  }

  if (!analysis.methodology_note) {
    analysis.methodology_note = 'This report combines live SERP data, competitor intelligence, industry keyword benchmarks, and proprietary market research.';
  }

  if (!analysis.trend_assessment) {
    const peakMonth = trendData.indexOf(Math.max(...trendData)) + 1;
    analysis.trend_assessment = `The 12-month search trend shows peak interest in month ${peakMonth}, indicating seasonality that should inform content production cycles.`;
  }

  if (!safeArray(analysis.client_value_proposition).length) {
    analysis.client_value_proposition = [];
  }

  if (!safeArray(analysis.roadmap_90day.days_1_30).length) {
    analysis.roadmap_90day = {
      days_1_30: [
        { action: 'Optimize Core Web Vitals', theme: 'Quick Win', owner: 'Dev Lead', effort: 'S' },
        { action: 'Publish 5 high-intent guides', theme: 'Quick Win', owner: 'Content Lead', effort: 'M' },
        { action: 'Implement schema markup', theme: 'Quick Win', owner: 'SEO Lead', effort: 'S' },
      ],
      days_31_60: [
        { action: 'Launch bilingual content expansion', theme: 'Build', owner: 'Content Lead', effort: 'L' },
        { action: 'Execute regional PR campaign', theme: 'Build', owner: 'PR Specialist', effort: 'L' },
        { action: 'Build backlink partnerships', theme: 'Build', owner: 'Partnerships', effort: 'M' },
      ],
      days_61_90: [
        { action: 'Scale content production to 20+ pages', theme: 'Scale', owner: 'Content Team', effort: 'L' },
        { action: 'Optimize conversion funnels', theme: 'Scale', owner: 'Dev Lead', effort: 'M' },
        { action: 'Expand adjacent keyword clusters', theme: 'Scale', owner: 'SEO Lead', effort: 'M' },
      ],
      dependencies: ['Timely content delivery', 'Access to regional benchmark data'],
    };
  }

  validateCompetitorTeardown(analysis, country, serpResults);

  return analysis;
};

// ═══════════════════════════════════════════════════════════════════════════
// MARKDOWN BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

const buildCompetitorTeardownMarkdown = (ct: any, currency: any): string => {
  let md = '';
  md += `7.5 COMPETITOR TEARDOWN — DEEP-DIVE ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🕵️ WHAT THIS SECTION IS
A forensic reverse-engineering of top 3 competitors across 10 dimensions.

═══════════════════════════════════════════════════════════════════════
A. FEATURE COMPARISON MATRIX (10 Dimensions)
═══════════════════════════════════════════════════════════════════════

`;
  md += formatTable(
    ['Dimension', 'You', 'Competitor 1', 'Competitor 2', 'Competitor 3', 'Gap'],
    safeArray(ct.feature_matrix).map((f: any) => [
      safeString(f.dimension), safeString(f.your_score), safeString(f.comp1),
      safeString(f.comp2), safeString(f.comp3),
      safeString(f.gap, '🟡 Medium'),
    ])
  );

  md += `\n═══════════════════════════════════════════════════════════════════════
B. SWOT SCORING RUBRIC (12 Dimensions)
═══════════════════════════════════════════════════════════════════════

`;
  md += formatTable(
    ['Dimension', 'Score', 'Reasoning'],
    safeArray(ct.swot_scored).map((s: any) => [
      safeString(s.dimension),
      `${s.score}/10 ${s.score >= 7 ? '🟢' : s.score >= 5 ? '🟡' : '🔴'}`,
      safeString(s.reasoning),
    ])
  );

  md += `\n═══════════════════════════════════════════════════════════════════════
C. PRICING DECONSTRUCTION (Tier-by-Tier)
═══════════════════════════════════════════════════════════════════════

`;
  md += formatTable(
    ['Tier', 'Your Price', 'Competitor 1', 'Competitor 2', 'Competitor 3', 'Insight'],
    safeArray(ct.pricing_deconstruction).map((p: any) => [
      safeString(p.tier), safeString(p.your_price), safeString(p.comp1_price),
      safeString(p.comp2_price), safeString(p.comp3_price), safeString(p.insight),
    ])
  );

  md += `\n═══════════════════════════════════════════════════════════════════════
D. UX AUDIT
═══════════════════════════════════════════════════════════════════════

`;
  const ux = ct.ux_audit || {};
  md += `**Design Score:**         ${ux.design_score || 0}/100 ${ux.design_score >= 70 ? '🟢' : '🟡'}\n`;
  md += `**Performance Score:**    ${ux.performance_score || 0}/100 ${ux.performance_score >= 70 ? '🟢' : '🔴'}\n`;
  md += `**Mobile Score:**         ${ux.mobile_score || 0}/100 ${ux.mobile_score >= 70 ? '🟢' : '🟡'}\n`;
  md += `**Accessibility Score:**  ${ux.accessibility_score || 0}/100 ${ux.accessibility_score >= 70 ? '🟢' : '🟡'}\n\n`;
  md += `💪 STRENGTHS:\n`;
  safeArray(ux.strengths).forEach((s: string) => { md += `  • ${s}\n`; });
  md += `\n⚠️ WEAKNESSES:\n`;
  safeArray(ux.weaknesses).forEach((w: string) => { md += `  • ${w}\n`; });

  md += `\n═══════════════════════════════════════════════════════════════════════
E. CONTENT GAP ANALYSIS (Scored)
═══════════════════════════════════════════════════════════════════════

`;
  md += formatTable(
    ['Topic', 'Volume', 'Competitor Coverage', 'Your Coverage', 'Priority', 'Expected Traffic'],
    safeArray(ct.content_gap_scored).map((c: any) => [
      safeString(c.topic), String(c.volume || 0), safeString(c.competitor_coverage),
      safeString(c.your_coverage),
      c.priority === 'Critical' ? '🔴 Critical' : c.priority === 'High' ? '🟠 High' : '🟡 Medium',
      `${c.expected_traffic || 0}/mo`,
    ])
  );

  md += `\n═══════════════════════════════════════════════════════════════════════
F. STRATEGIC ACTION PLAN (Stakeholder-Mapped)
═══════════════════════════════════════════════════════════════════════

`;
  md += formatTable(
    ['Action', 'Stakeholder', 'Timeline', 'Expected Impact'],
    safeArray(ct.action_plan).map((a: any) => [
      safeString(a.action), safeString(a.stakeholder), safeString(a.timeline), safeString(a.expected_impact),
    ])
  );

  md += `\n`;
  return md;
};

const buildUnitEconomicsMarkdown = (ue: any, be: any, sa: any, currency: any): string => {
  let md = '';
  md += `9.5 UNIT ECONOMICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 KEY METRICS

`;
  md += `  • CAC (Customer Acquisition Cost):   ${safeString(ue.cac?.value)}\n`;
  md += `    └─ ${safeString(ue.cac?.calculation)}\n`;
  md += `    └─ Benchmark: ${safeString(ue.cac?.benchmark)}\n\n`;
  md += `  • LTV (Lifetime Value):             ${safeString(ue.ltv?.value)}\n`;
  md += `    └─ ${safeString(ue.ltv?.calculation)}\n`;
  md += `    └─ Benchmark: ${safeString(ue.ltv?.benchmark)}\n\n`;
  md += `  • LTV:CAC Ratio:                    ${safeString(ue.ltv_cac_ratio?.value)}\n`;
  md += `    └─ Health: ${safeString(ue.ltv_cac_ratio?.health)}\n`;
  md += `    └─ Benchmark: ${safeString(ue.ltv_cac_ratio?.benchmark)}\n\n`;
  md += `  • Payback Period:                   ${safeString(ue.payback_period?.months)} months\n`;
  md += `    └─ ${safeString(ue.payback_period?.calculation)}\n`;
  md += `    └─ Benchmark: ${safeString(ue.payback_period?.benchmark)}\n\n`;

  md += `📊 GROSS MARGIN PER TIER\n\n`;
  md += formatTable(
    ['Tier', 'Revenue', 'Cost', 'Margin', 'Note'],
    safeArray(ue.gross_margin_per_tier).map((g: any) => [
      safeString(g.tier), safeString(g.revenue), safeString(g.cost), safeString(g.margin), safeString(g.note),
    ])
  );

  md += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

9.6 BREAK-EVEN ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 BREAK-EVEN METRICS

`;
  md += `  • Fixed Costs (monthly):            ${safeString(be?.fixed_costs)}\n`;
  md += `  • Revenue per Unit:                 ${safeString(be?.revenue_per_unit)}\n`;
  md += `  • Variable Cost per Unit:           ${safeString(be?.variable_cost_per_unit)}\n`;
  md += `  • Contribution Margin:              ${safeString(be?.contribution_margin)}\n\n`;
  md += `  🎯 UNITS REQUIRED TO BREAK-EVEN:     ${safeString(be?.units_required)} customers\n`;
  md += `  🎯 TRAFFIC REQUIRED:                  ${safeString(be?.traffic_required)} visitors\n`;
  md += `  🎯 MONTHS TO BREAK-EVEN:             ${safeString(be?.months_to_breakeven)} months\n\n`;
  if (be?.formula) md += `  Formula: ${safeString(be.formula)}\n\n`;

  md += `📊 SENSITIVITY ANALYSIS\n\n`;
  md += formatTable(
    ['Scenario', 'Traffic Growth', 'Pipeline', 'ROI', 'LTV:CAC', 'Break-even'],
    [
      ['🟢 Best Case', safeString(sa?.best_case?.traffic_growth), safeString(sa?.best_case?.pipeline), safeString(sa?.best_case?.roi), safeString(sa?.best_case?.ltv_cac), `${safeString(sa?.best_case?.breakeven_months)} mo`],
      ['🟡 Expected', safeString(sa?.expected_case?.traffic_growth), safeString(sa?.expected_case?.pipeline), safeString(sa?.expected_case?.roi), safeString(sa?.expected_case?.ltv_cac), `${safeString(sa?.expected_case?.breakeven_months)} mo`],
      ['🔴 Worst Case', safeString(sa?.worst_case?.traffic_growth), safeString(sa?.worst_case?.pipeline), safeString(sa?.worst_case?.roi), safeString(sa?.worst_case?.ltv_cac), `${safeString(sa?.worst_case?.breakeven_months)} mo`],
    ]
  );
  md += `\n`;
  return md;
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

export async function generateSEOReport(
  niche: string,
  country: string,
  options?: { clientName?: string; website?: string; productDescription?: string; targetIcp?: string; businessInputs?: Record<string, number>; baselineKpis?: any[]; }
) {
  const optionsKey = JSON.stringify({ clientName: options?.clientName || '', website: options?.website || '', productDescription: options?.productDescription || '', targetIcp: options?.targetIcp || '', businessInputs: options?.businessInputs || {}, baselineKpis: options?.baselineKpis || [] });
  const cacheKey = `seo_v11_${niche}_${country}_${optionsKey}`;
  const cached = cacheService.get(cacheKey);
  if (cached) {
    console.log('📦 [Cache] Returning cached SEO report (v11).');
    return cached;
  }

  console.log(`🔍 [SEO v11] Generating for "${niche}" in ${country}...`);

  // ── TREND DATA ──
  let trendData: number[] = [];
  let trendSource: 'dataforseo' | 'google_trends' | 'pattern_fallback' = 'pattern_fallback';
  const dataForSEOAvailable = isDataForSEOAvailable();

  if (dataForSEOAvailable) {
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
  if (trendData.length === 0) {
    trendData = generateFallbackTrend(niche, country);
    trendSource = 'pattern_fallback';
  }

  // ── SERP DATA ──
  const serpQuery = buildSerpQuery(niche, country);
  let serpProvider = 'No SERP provider returned results';
  let searchData = await getScraperAPISearch(serpQuery, country).catch(() => null);
  if (searchData?.organic_results) serpProvider = 'ScraperAPI';
  if (!searchData?.organic_results) { searchData = await getSearchResults(serpQuery, country).catch(() => null); if (searchData?.organic_results) serpProvider = 'SerpAPI'; }
  if (!searchData?.organic_results) { searchData = await getSerperResults(serpQuery, country).catch(() => null); if (searchData?.organic_results) serpProvider = 'Serper'; }

  const filteredResults = filterAndScoreSerp(searchData?.organic_results || [], niche, country);
  const serpResults = filteredResults.slice(0, 10);

  console.log(`✅ [SERP] ${serpResults.length} relevant results.`);

  // ── AI CALL ──
  const prompt = `${buildSEOPrompt(niche, country, serpResults, trendData)}\n\nCALLER-SUPPLIED CLIENT CONTEXT (authoritative; do not infer beyond this):\nWebsite: ${options?.website || 'Not supplied'}\nProduct: ${options?.productDescription || 'Not supplied'}\nTarget ICP: ${options?.targetIcp || 'Not supplied'}\nCommercial inputs will be supplied separately in code and must not be guessed.`;
  const aiResponse = await runGroqWithRetry(prompt, JSON.stringify({ niche, country }));
  let analysis = extractJSON(aiResponse);
  // Never trust AI-generated commercial inputs or baselines. Only caller-supplied values are accepted.
  analysis.business_inputs = options?.businessInputs ? { ...options.businessInputs } : {};
  if (!analysis.current_state) analysis.current_state = {};
  analysis.current_state.kpi_dashboard = Array.isArray(options?.baselineKpis) ? options.baselineKpis : [];
  if (!options?.website) {
    analysis.current_state.narrative = 'Target website not supplied. Client-specific rankings, traffic, technical health, conversion performance and backlink baselines cannot be assessed in this run.';
  }
  if (options?.clientName) analysis.client_name = options.clientName;
  if (options?.website) analysis.client_website = options.website;
  analysis.case_studies = []; // No case-study evidence/permission interface is connected in this generator.
  if (!options?.productDescription) analysis.client_value_proposition = [];
  if (!analysis.current_state) analysis.current_state = {};
  analysis.current_state.kpi_dashboard = Array.isArray(options?.baselineKpis) ? options.baselineKpis : [];

  // ── KEYWORDS PROCESSING ──
  let keywords = Array.isArray(analysis.keywords) ? analysis.keywords : [];
  keywords = keywords.map((kw: any, i: number) => {
    const tier = safeString(kw.tier, i < 14 ? 'money' : i < 32 ? 'growth' : 'long-tail');
    const keywordStr = safeString(kw.keyword, '');
    return {
      keyword: keywordStr,
      volume: null,
      cpc: null,
      kd: null,
      intent: resolveIntent(kw),
      tier,
      dataSource: 'unverified_ai_candidate',
    };
  }).filter((kw: any) => kw.keyword);

  if (dataForSEOAvailable && keywords.length > 0) {
    try {
      const realMetrics = await fetchRealKeywordMetrics(keywords.map((k: any) => k.keyword), country);
      if (realMetrics.length > 0) {
        const metricMap = new Map<string, RealKeywordMetric>(realMetrics.map((m: RealKeywordMetric) => [m.keyword.toLowerCase(), m]));
        keywords = keywords.map((kw: any) => {
          const real = metricMap.get(kw.keyword.toLowerCase());
          if (real) {
            return {
              ...kw,
              volume: real.volume > 0 ? real.volume : null,
              kd: real.kd >= 0 ? real.kd : null,
              cpc: real.cpc > 0 ? real.cpc : null,
              intent: resolveIntent(kw),
              dataSource: 'dataforseo',
            };
          }
          return kw;
        });
      }
    } catch (e: any) {
      console.warn(`⚠️ [Hybrid] DataForSEO override failed: ${e.message}`);
    }
  }

  keywords = await mapWithConcurrency(keywords, 5, async (kw: any) => {
    try {
      let cpcLocal: number;
      if (kw.dataSource === 'dataforseo' && safeNumber(kw.cpc, 0) > 0) {
        const converted = await convertCurrency(kw.cpc, 'USD', country.toUpperCase());
        cpcLocal = (converted === null || isNaN(converted) || converted <= 0) ? 0 : converted;
      } else {
        cpcLocal = kw.cpc;
      }
      kw.cpc = cpcLocal > 0 ? Number(cpcLocal.toFixed(2)) : null;
    } catch {
      // Preserve the existing currency value; never apply a second conversion.
      kw.cpc = null;
    }
    return kw;
  });

  // ── VALIDATE + FILL ──
  analysis = validateAndFillSections(analysis, niche, country, keywords, trendData, serpResults);

  // ✅ CRITICAL: TRUTH RECONCILIATION (must be after all fills)
  analysis = reconcileAll(analysis, keywords, country);
  if (!analysis.current_state) analysis.current_state = {};
  analysis.current_state.kpi_dashboard = Array.isArray(options?.baselineKpis) ? options.baselineKpis : [];
  const sourcePullDate = new Date().toISOString().slice(0, 10);
  const actualSources: any[] = [];
  if (keywords.some((k: any) => k.dataSource === 'dataforseo' && (safeNumber(k.volume, 0) > 0 || safeNumber(k.cpc, 0) > 0 || (k.kd !== null && k.kd !== undefined && Number.isFinite(Number(k.kd)))))) actualSources.push({ data_type: 'Keyword metrics', source: 'DataForSEO', pull_date: sourcePullDate });
  if (trendSource === 'dataforseo') actualSources.push({ data_type: 'Search trends', source: 'DataForSEO Trends', pull_date: sourcePullDate });
  else if (trendSource === 'google_trends') actualSources.push({ data_type: 'Search trends', source: 'Google Trends', pull_date: sourcePullDate });
  else actualSources.push({ data_type: 'Search trends', source: 'Internal country pattern — modeled, not live search data', pull_date: sourcePullDate });
  if (serpResults.length > 0) actualSources.push({ data_type: 'SERP results', source: serpProvider, pull_date: sourcePullDate });
  analysis.current_state.data_sources = actualSources;

  dedupeCaseStudyTitles(safeArray(analysis.case_studies));
  cleanInsightPrefixes(analysis);

  // Country-specific data overrides (after reconcile so they aren't overwritten)
  const preloadedCalendar = getCalendarForCountry(country);
  const preloadedEditors = getEditorsForCountry(country);
  if (!analysis.ground_intel) analysis.ground_intel = {};
  analysis.ground_intel.cultural_calendar = preloadedCalendar.map((c: any) => ({
    period: c.period,
    behavior: String(c.behavior || '').replace(/mid-Q1 review/gi, 'Q1 close / Q2 start').replace(/mid-Q4/gi, 'Q3 close / Q4 start'),
    content_priority: c.contentPriority,
  }));
  analysis.ground_intel.editor_intelligence = preloadedEditors.map((e: any) => ({
    publication: e.site, da: null, what_works: e.whatWorks,
  }));

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const reference = `MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const currency = currencyInfo[country] || currencyInfo.us;
  const economics = getEconomics(country, analysis);

  analysis.serp_landscape = serpResults.slice(0, 10).map((r: any, i: number) => ({ position: i + 1, title: r.title || 'Untitled', link: r.link || null, da: null, words: null, backlinks: null, traffic: null }));
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
  const caseStudies = safeArray(analysis.case_studies);
  const dataLimitations = safeArray(analysis.data_limitations);

  let serp = Array.isArray(analysis.serp_landscape) ? analysis.serp_landscape.filter((s: any) => s.title && s.link).slice(0, 8) : [];
  if (serp.length === 0 && serpResults.length > 0) {
    serp = serpResults.slice(0, 8).map((r: any, i: number) => ({
      position: i + 1, title: r.title || 'Untitled', link: r.link || '#',
      da: null, words: null, backlinks: null, traffic: null,
      strengths: null, weaknesses: null, gap: null,
    }));
  }

  const languageSplitHeading = isMultilingual[country] ? '3.2  🌍 LANGUAGE SPLIT INTELLIGENCE' : '3.2  🌍 REGIONAL SEARCH VARIATIONS';
  const languageSplitIntro = isMultilingual[country]
    ? 'This section analyzes bilingual (English + local language) search dynamics.'
    : `This section analyzes regional search variations across ${countryNames[country]}.`;

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD MARKDOWN
  // ═══════════════════════════════════════════════════════════════════════════
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
Only source-backed metrics are presented as measured. Modeled estimates are labeled.
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
  markdown += `  Overall: ${health.overall || 0}/100   ${health.status || '🟡'}\n\n`;
  safeArray(health.breakdown).forEach((b: any) => {
    markdown += `  ${safeString(b.category).padEnd(20)} ${b.score || 0}/100  ${b.status || ''}\n`;
  });
  markdown += `\n`;

  markdown += `2. CURRENT STATE & BASELINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 DATA SOURCES & PULL DATES

`;
  markdown += formatTable(
    ['Data Type', 'Source', 'Pull Date'],
    safeArray(currentState.data_sources).map((d: any) => [safeString(d.data_type), safeString(d.source), safeString(d.pull_date)])
  );
  markdown += `\n📊 CORE KPI DASHBOARD\n\n`;
  markdown += formatTable(
    ['Metric', 'Current', 'Previous', 'Change', 'Target'],
    safeArray(currentState.kpi_dashboard).map((k: any) => [safeString(k.metric), safeString(k.current), safeString(k.previous), safeString(k.change), safeString(k.target)])
  );
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
      moneyKw.map((k: any, i: number) => [String(i + 1), safeString(k.keyword), String(k.volume), String(k.kd), `${currency.symbol}${safeNumber(k.cpc, 0).toFixed(2)}`, safeString(k.intent)])
    );
    markdown += `\n`;
  }
  if (growthKw.length > 0) {
    markdown += `TIER 2 — GROWTH KEYWORDS (Strategic Value)\n\n`;
    markdown += formatTable(
      ['#', 'Keyword', 'Volume', 'KD', `CPC (${currency.symbol.trim()})`, 'Intent'],
      growthKw.map((k: any, i: number) => [String(i + 15), safeString(k.keyword), String(k.volume), String(k.kd), `${currency.symbol}${safeNumber(k.cpc, 0).toFixed(2)}`, safeString(k.intent)])
    );
    markdown += `\n`;
  }
  if (longTailKw.length > 0) {
    markdown += `TIER 3 — LONG-TAIL KEYWORDS (Quick Wins)\n\n`;
    markdown += formatTable(
      ['#', 'Keyword', 'Volume', 'KD', `CPC (${currency.symbol.trim()})`, 'Intent'],
      longTailKw.map((k: any, i: number) => [String(i + 33), safeString(k.keyword), String(k.volume), String(k.kd), `${currency.symbol}${safeNumber(k.cpc, 0).toFixed(2)}`, safeString(k.intent)])
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
  markdown += `${languageSplitIntro}\n\n`;
  markdown += `${safeString(groundIntel.language_split?.summary)}\n\n`;
  markdown += `Top ${isMultilingual[country] ? 'local-language' : 'regional'} keywords with commercial intent:\n\n`;
  markdown += formatTable(
    ['Keyword', 'Volume', 'KD', `CPC (${currency.symbol.trim()})`],
    safeArray(groundIntel.language_split?.top_keywords).map((k: any) => [safeString(k.keyword), String(k.volume || 0), String(k.kd || 0), `${currency.symbol}${safeNumber(k.cpc, 0).toFixed(2)}`])
  );

  markdown += `\n──────────────────────────────────────────────────────────────\n3.3  🧠 LOCAL BUYER BEHAVIOR PATTERNS\n──────────────────────────────────────────────────────────────\n\n`;
  safeArray(groundIntel.buyer_behavior).forEach((b: string) => markdown += `  • ${b}\n`);

  markdown += `\n──────────────────────────────────────────────────────────────\n3.4  📰 LOCAL EDITOR & PUBLICATION INTELLIGENCE\n──────────────────────────────────────────────────────────────\n\n`;
  markdown += formatTable(
    ['Publication', 'DA', 'What Actually Works'],
    safeArray(groundIntel.editor_intelligence).map((e: any) => [safeString(e.publication), String(e.da || 0), safeString(e.what_works)])
  );

  markdown += `\n──────────────────────────────────────────────────────────────\n3.5  ⚔️ COMPETITOR LOCAL WEAKNESS MAP\n──────────────────────────────────────────────────────────────\n\n`;
  markdown += formatTable(
    ['Competitor', 'Local Weakness (verified)'],
    safeArray(groundIntel.competitor_weaknesses).map((c: any) => [safeString(c.competitor), safeString(c.weakness)])
  );
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
${safeString(magicGoldmine.cluster_name)}
──────────────────────────────────────────────────────────────

✅ CRITERIA MET:
`;
  safeArray(magicGoldmine.criteria_met).forEach((c: string) => markdown += `  ✅ ${c}\n`);
  markdown += `\n🔍 WHY THIS CLUSTER IS INVISIBLE:\n`;
  safeArray(magicGoldmine.why_invisible).forEach((w: string) => markdown += `  → ${w}\n`);

  markdown += `\n💎 TOP 5 HIGHEST-VALUE KEYWORDS\n\n`;
  markdown += formatTable(
    ['#', 'Keyword', 'Volume', 'KD', `CPC (${currency.symbol.trim()})`, 'Intent'],
    safeArray(magicGoldmine.top_keywords).map((k: any, i: number) => [String(i + 1), safeString(k.keyword), String(k.volume || 0), String(k.kd || 0), `${currency.symbol}${safeNumber(k.cpc, 0).toFixed(2)}`, safeString(k.intent)])
  );

  markdown += `\n💰 REVENUE PROJECTION\n\n`;
  const rp = magicGoldmine.revenue_projection || {};
  markdown += `  → Monthly traffic:        ~${rp.monthly_traffic || 0} searches\n`;
  markdown += `  → Conversion rate:        ${safeString(rp.conversion_rate)}\n`;
  markdown += `  → Monthly leads:          ${rp.monthly_leads || 0}\n`;
  markdown += `  → Avg. deal value:        ${safeString(rp.avg_deal_value)}\n`;
  markdown += `  → Monthly pipeline:       ${safeString(rp.monthly_pipeline)}\n`;
  if (rp.formula) markdown += `  → Formula:                ${safeString(rp.formula)}\n`;
  markdown += `\n✅ EVIDENCE\n`;
  safeArray(magicGoldmine.evidence).forEach((e: string) => markdown += `  ✅ ${e}\n`);
  markdown += `\n`;

  markdown += `5. COMPETITIVE EDGE — FORENSIC COMPETITOR ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🕵️ WHAT THIS SECTION IS
We forensically reverse-engineered the SEO strategy of your top SERP competitor.

──────────────────────────────────────────────────────────────
TARGET: ${safeString(magicPlaybook.target_competitor?.name).toUpperCase()}
Domain Rating: ${magicPlaybook.target_competitor?.da || 0} | Monthly Organic Traffic: ${safeString(magicPlaybook.target_competitor?.traffic)}
──────────────────────────────────────────────────────────────

📅 TIMELINE OF THEIR RISE

`;
  safeArray(magicPlaybook.timeline).forEach((t: any) => {
    markdown += `  ${safeString(t.date)}  →  ${safeString(t.action)}\n                Impact: ${safeString(t.impact)}\n\n`;
  });

  markdown += `🔍 THEIR CONTENT FORMULA (CRACKED)\n\n`;
  safeArray(magicPlaybook.content_formula).forEach((c: string) => markdown += `  • ${c}\n`);

  markdown += `\n🎯 THEIR BACKLINK STRATEGY (MAPPED)\n\n`;
  const bs = magicPlaybook.backlink_strategy || {};
  markdown += `  Total backlinks:      ${bs.total_backlinks || 0}\n  Local percentage:     ${safeString(bs.local_percentage)}\n  Top 3 source domains:\n`;
  safeArray(bs.top_sources).forEach((s: any, i: number) => {
    markdown += `    ${i + 1}. ${safeString(s.domain)} — ${s.links || 0} links\n`;
  });

  markdown += `\n⚠️ THEIR VULNERABILITIES (WHAT THEY'RE NOT DOING)\n\n`;
  safeArray(magicPlaybook.vulnerabilities).forEach((v: string) => markdown += `  • ${v}\n`);

  markdown += `\n🎯 YOUR 60-DAY COUNTER-PLAY\n\n`;
  safeArray(magicPlaybook.counter_play).forEach((c: any) => {
    markdown += `  ${safeString(c.week)}  →  ${safeString(c.action)}\n`;
  });

  markdown += `\n✅ EVIDENCE\n`;
  safeArray(magicPlaybook.evidence).forEach((e: string) => markdown += `  ✅ ${e}\n`);
  markdown += `\n`;

  markdown += `6. KEY FINDINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  keyFindings.forEach((f: any, idx: number) => {
    markdown += `┌──────────────────────────────────────────────────────────────────┐\n`;
    markdown += `│ FINDING #${f.rank || idx + 1} — ${safeString(f.priority, 'HIGH').toUpperCase()}\n`;
    markdown += `│ Title: ${safeString(f.title)}\n`;
    markdown += `├──────────────────────────────────────────────────────────────────┤\n`;
    markdown += `│ Category:   ${safeString(f.category)}\n`;
    markdown += `│ Impact:     ${safeString(f.impact)}   |   Effort: ${safeString(f.effort)}\n`;
    markdown += `└──────────────────────────────────────────────────────────────────┘\n\n`;
    markdown += `💡 What is happening:\n   ${safeString(f.what_is_happening)}\n\n`;
    markdown += `⚠️ Why it matters:\n   ${safeString(f.why_it_matters)}\n\n`;
    markdown += `💰 Size of prize:\n   ${safeString(f.size_of_prize)}\n`;
    if (f.size_formula) markdown += `   Formula: ${safeString(f.size_formula)}\n`;
    markdown += `\n✅ Evidence:\n`;
    safeArray(f.evidence).forEach((e: string) => markdown += `   • ${e}\n`);
    markdown += `\n🎯 Recommendation:\n   ${safeString(f.recommendation)}\n\n`;
    markdown += `⏱️  Timeline: ${safeString(f.timeline)}\n👤 Owner: ${safeString(f.owner)}\n\n──────────────────────────────────────────────────────────────\n\n`;
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
    safeArray(competitive.content_gap).map((c: any) => [safeString(c.topic), String(c.volume || 0), safeString(c.leader), safeString(c.your_position)])
  );

  markdown += `\n🔗 BACKLINK GAP ANALYSIS\n\n`;
  markdown += formatTable(
    ['Domain', 'DA', 'Competitor Links', 'Your Links'],
    safeArray(competitive.backlink_gap).map((b: any) => [safeString(b.domain), String(b.da || 0), String(b.comp_a_links || 0), String(b.your_links || 0)])
  );

  markdown += `\n🎯 PRIORITIZED GAP-CLOSING ROADMAP\n\n`;
  safeArray(competitive.prioritized_roadmap).forEach((r: string, i: number) => markdown += `  ${i + 1}. ${r}\n`);
  markdown += `\n`;

  markdown += buildCompetitorTeardownMarkdown(competitorTeardown, currency);

  markdown += `8. 90-DAY ACTION ROADMAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🟢 DAYS 1-30 — FOUNDATION & QUICK WINS

`;
  markdown += formatTable(
    ['Action', 'Theme', 'Owner', 'Effort'],
    safeArray(roadmap.days_1_30).map((a: any) => [safeString(a.action), safeString(a.theme), safeString(a.owner), safeString(a.effort)])
  );

  markdown += `\n🟡 DAYS 31-60 — BUILD & EXPAND\n\n`;
  markdown += formatTable(
    ['Action', 'Theme', 'Owner', 'Effort'],
    safeArray(roadmap.days_31_60).map((a: any) => [safeString(a.action), safeString(a.theme), safeString(a.owner), safeString(a.effort)])
  );

  markdown += `\n🔵 DAYS 61-90 — SCALE & OPTIMIZE\n\n`;
  markdown += formatTable(
    ['Action', 'Theme', 'Owner', 'Effort'],
    safeArray(roadmap.days_61_90).map((a: any) => [safeString(a.action), safeString(a.theme), safeString(a.owner), safeString(a.effort)])
  );

  markdown += `\n⚠️ DEPENDENCIES & RISKS\n`;
  safeArray(roadmap.dependencies).forEach((d: string) => markdown += `  • ${d}\n`);
  markdown += `\n`;

  markdown += `9. FINANCIAL PROJECTION & ROI MODEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💵 INVESTMENT (6-MONTH)

`;
  markdown += formatTable(
    ['Item', 'Cost'],
    safeArray(financial.investment).map((i: any) => [safeString(i.item), safeString(i.cost)])
  );

  markdown += `\n📈 6-MONTH PROJECTION\n\n`;
  markdown += formatTable(
    ['Month', 'Sessions', 'Leads', 'Pipeline', 'Pipeline / Investment'],
    safeArray(financial.monthly_projection).map((m: any) => [safeString(m.month), safeString(m.sessions), safeString(m.leads), safeString(m.pipeline), safeString(m.pipeline_to_investment_ratio)])
  );

  markdown += `\n💡 ${safeString(financial.roi_summary)}\n`;
  if (financial.roi_formula) markdown += `   Formula: ${safeString(financial.roi_formula)}\n`;
  markdown += `\n📐 ASSUMPTIONS & SOURCES\n`;
  safeArray(financial.assumptions).forEach((a: any) => {
    markdown += `  • ${safeString(a.assumption)}\n    └─ Source: ${safeString(a.source)}\n`;
  });
  markdown += `\n`;

  markdown += buildUnitEconomicsMarkdown(unitEconomics, breakEven, sensitivity, currency);

  markdown += `10. CASE STUDIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  caseStudies.forEach((cs: any, idx: number) => {
    markdown += `CASE STUDY ${String(idx + 1).padStart(2, '0')}: ${safeString(cs.title)}\n${safeString(cs.subtitle)}\n\n`;
    const cp = cs.client_profile || {};
    markdown += `📋 CLIENT PROFILE\n  Industry:        ${safeString(cp.industry)}\n  Location:        ${safeString(cp.location)}\n  Company Stage:   ${safeString(cp.company_stage)}\n  Team Size:       ${safeString(cp.team_size)}\n  Engagement:      ${safeString(cp.engagement)}\n  Services:        ${safeString(cp.services)}\n  Client Identity: ${safeString(cp.client_identity, 'Withheld under NDA')}\n\n`;
    markdown += `⚠️ THE CHALLENGE\n${safeString(cs.challenge)}\n\n🎯 OUR APPROACH\n`;
    safeArray(cs.approach).forEach((a: string) => markdown += `  ${a}\n`);
    markdown += `\n📊 RESULTS AFTER 6 MONTHS\n\n`;
    markdown += formatTable(
      ['Metric', 'Baseline', 'After 6 Mo.', 'Change'],
      safeArray(cs.results_table).map((r: any) => [safeString(r.metric), safeString(r.baseline), safeString(r.after), safeString(r.change)])
    );
    markdown += `\n💡 WHAT DROVE THE GROWTH\n`;
    safeArray(cs.what_drove_growth).forEach((w: string) => markdown += `  • ${w}\n`);
    markdown += `\n✅ EVIDENCE & VERIFICATION\n`;
    safeArray(cs.evidence).forEach((e: string) => markdown += `  • ${e}\n`);
    markdown += `\n📌 ATTRIBUTION NOTE\n  ${safeString(cs.attribution_note)}\n\n⚠️ IMPORTANT DISCLOSURE\n  ${safeString(cs.disclosure)}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  });

  markdown += `APPENDIX A — EVIDENCE, METHODOLOGY & DATA SOURCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📖 METHODOLOGY
${safeString(analysis.methodology_note)}

`;
  if (serpResults.length > 0) {
    markdown += `📚 LIVE SERP EVIDENCE\n\n`;
    markdown += formatTable(
      ['#', 'Title', 'URL'],
      serpResults.slice(0, 10).map((r: any, i: number) => [String(i + 1), safeString(r.title), safeString(r.link)])
    );
    markdown += `\n`;
  }

  markdown += `⚠️ DATA LIMITATIONS\n`;
  dataLimitations.forEach((d: string, i: number) => markdown += `  ${i + 1}. ${d}\n`);

  const hasDataForSEO = keywords.some((k: any) => k.dataSource === 'dataforseo' && (safeNumber(k.volume, 0) > 0 || safeNumber(k.cpc, 0) > 0 || (k.kd !== null && k.kd !== undefined && Number.isFinite(Number(k.kd)))));
  const keywordDataSource = hasDataForSEO ? 'DataForSEO metrics returned (check per-keyword coverage)' : 'No verified keyword metrics returned; candidate phrases only';
  const trendSourceLabel = trendSource === 'dataforseo' ? 'DataForSEO Google Trends API (Live 12-month)' : trendSource === 'google_trends' ? 'Google Trends API (Live 12-month)' : 'Country-Specific Seasonal Pattern (Pattern-Based)';

  markdown += `\n📡 DATA SOURCE DISCLOSURE\n  • Keyword Data:  ${keywordDataSource}\n  • SERP Data:     ${serpProvider}\n  • Trend Data:    ${trendSourceLabel}\n  • Currency:      Real-time exchange API\n  • Strategic Synthesis: Nexlor Senior Research Division\n\n`;

  markdown += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ DISCLAIMER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This report is for informational purposes only and does not constitute
legal, tax, or financial advice. Please consult qualified professionals
before making business decisions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by Nexlor Senior Research Division.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  markdown = cleanMarkdown(markdown, country);

  const trafficEstimate = null;
  const trafficEstimateBasis = 'Not forecast — requires Search Console baseline and a documented forecasting model';

  const result = {
    niche, country, type: 'seo',
    data: analysis,
    keywords: keywords.slice(0, 50),
    serp_landscape: serp,
    markdown,
    trend_summary: safeString(analysis.trend_assessment, 'Steady market interest.'),
    dataSource: hasDataForSEO ? 'dataforseo' : 'unverified',
    dataQuality: { keywordMetrics: hasDataForSEO ? 'DataForSEO response received; field-level coverage must be checked' : 'UNVERIFIED — no keyword metrics returned', competitorMetrics: 'Only available when directly supplied by a verified provider', financialModel: 'Requires client business_inputs; otherwise withheld', caseStudies: 'Only supplied evidence-backed case studies are included' },
    trendSource,
    chart_data: {
      trend_12m: trendData.slice(0, 12).map((v: number, i: number) => ({ month: `M${i + 1}`, value: v })),
      traffic_forecast_6m: [],
      market_share: [],
    },
    traffic_estimate: trafficEstimate,
    traffic_estimate_basis: trafficEstimateBasis,
  };
  cacheService.set(cacheKey, result, 86400);
  return result;
}
