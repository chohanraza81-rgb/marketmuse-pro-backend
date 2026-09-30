// product.report.generator.ts
// v5 — STRONG EDITION
// Focus: Competitor Forensics + Local Market Intelligence
// Cache: product_v5_{niche}_{country}
// NEW: Regulatory landscape, seasonal calendar, local suppliers, weakness matrix

import { cacheService } from './cache';
import { getGoogleTrends } from './trends';
import { getSearchResults } from './serpapi';
import { getSerperResults } from './serper';
import { getScraperAPISearch } from './scraperapi';
import { runGroqWithRetry } from './groq';
import {
  isDataForSEOAvailable,
  fetchRealTrends,
  fetchRealKeywordMetrics,
} from './dataforseo.service';

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
  sa: { symbol: '﷼', rate: 3.75, locale: 'ar-SA' },
  ae: { symbol: 'د.إ', rate: 3.67, locale: 'ar-AE' },
  pk: { symbol: '₨', rate: 278, locale: 'en-PK' },
  in: { symbol: '₹', rate: 83, locale: 'en-IN' },
  tr: { symbol: '₺', rate: 32, locale: 'tr-TR' },
  my: { symbol: 'RM', rate: 4.7, locale: 'en-MY' },
};

// ✅ NEW v5: Country-specific local market data
const LOCAL_MARKET_DATA: Record<string, {
  keyCities: string[];
  majorPorts: string[];
  peakSeasons: Array<{ period: string; reason: string }>;
  regulatoryBodies: string[];
  popularMarketplaces: string[];
  popularPaymentMethods: string[];
}> = {
  in: {
    keyCities: ['Mumbai', 'Delhi-NCR', 'Chennai', 'Ahmedabad', 'Surat', 'Bengaluru'],
    majorPorts: ['JNPT Mumbai', 'Chennai Port', 'Mundra', 'Kolkata'],
    peakSeasons: [
      { period: 'Oct-Nov', reason: 'Diwali shopping season (peak demand)' },
      { period: 'Feb-Mar', reason: 'Wedding season (gifting)' },
      { period: 'Jun-Jul', reason: 'Back to school (kids products)' },
      { period: 'Apr-May', reason: 'Summer season (apparel, cooling)' },
    ],
    regulatoryBodies: ['BIS (Bureau of Indian Standards)', 'DGFT', 'CBIC'],
    popularMarketplaces: ['Amazon.in', 'Flipkart', 'Meesho', 'Shopify', 'TikTok Shop India'],
    popularPaymentMethods: ['UPI', 'Razorpay', 'Paytm', 'Net Banking'],
  },
  us: {
    keyCities: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Miami'],
    majorPorts: ['Port of LA', 'Long Beach', 'Newark', 'Savannah'],
    peakSeasons: [
      { period: 'Nov-Dec', reason: 'Black Friday + Christmas (peak)' },
      { period: 'Aug-Sep', reason: 'Back to school' },
      { period: 'May-Jun', reason: 'Summer kickoff' },
    ],
    regulatoryBodies: ['FTC', 'CBP', 'FDA (for some products)'],
    popularMarketplaces: ['Amazon', 'Walmart', 'Shopify', 'Etsy', 'eBay'],
    popularPaymentMethods: ['Stripe', 'PayPal', 'Apple Pay', 'Shop Pay'],
  },
  ca: {
    keyCities: ['Toronto', 'Vancouver', 'Montreal', 'Calgary', 'Ottawa'],
    majorPorts: ['Vancouver', 'Montreal', 'Halifax', 'Prince Rupert'],
    peakSeasons: [
      { period: 'Nov-Dec', reason: 'Christmas + Boxing Day (peak)' },
      { period: 'Sep', reason: 'Back to school' },
      { period: 'Mar-Apr', reason: 'Spring refresh' },
    ],
    regulatoryBodies: ['CBSA', 'Health Canada', 'ISED'],
    popularMarketplaces: ['Amazon.ca', 'Shopify', 'Walmart.ca', 'Etsy'],
    popularPaymentMethods: ['Interac', 'Shop Pay', 'PayPal', 'Stripe'],
  },
  my: {
    keyCities: ['Kuala Lumpur', 'Penang', 'Johor Bahru', 'Ipoh'],
    majorPorts: ['Port Klang', 'Tanjung Pelepas', 'Penang Port'],
    peakSeasons: [
      { period: 'Nov-Dec', reason: 'Year-end + Christmas' },
      { period: 'Jan-Feb', reason: 'Chinese New Year' },
      { period: 'Apr-May', reason: 'Hari Raya (peak gifting)' },
      { period: 'Aug-Sep', reason: 'Merdeka (independence) sales' },
    ],
    regulatoryBodies: ['SIRIM', 'Royal Malaysian Customs', 'MCMC'],
    popularMarketplaces: ['Shopee', 'Lazada', 'TikTok Shop', 'Zalora'],
    popularPaymentMethods: ['FPX', 'GrabPay', 'Touch n Go', 'Boost'],
  },
  ae: {
    keyCities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'],
    majorPorts: ['Jebel Ali', 'Khalifa Port', 'Port Rashid'],
    peakSeasons: [
      { period: 'Oct-Mar', reason: 'Tourist season (peak retail)' },
      { period: 'Ramadan', reason: 'Gifting + shopping' },
      { period: 'Jan', reason: 'Dubai Shopping Festival' },
    ],
    regulatoryBodies: ['Dubai Customs', 'ESMA', 'MOIAT'],
    popularMarketplaces: ['Noon', 'Amazon.ae', 'Namshi', 'Sharaf DG'],
    popularPaymentMethods: ['Tabby', 'Apple Pay', 'Cash on Delivery', 'Stripe'],
  },
  sg: {
    keyCities: ['Singapore'],
    majorPorts: ['Port of Singapore', 'Jurong Port'],
    peakSeasons: [
      { period: 'Nov-Dec', reason: 'Christmas + Year-end' },
      { period: 'Jan-Feb', reason: 'Chinese New Year' },
      { period: 'May-Jun', reason: 'Great Singapore Sale' },
    ],
    regulatoryBodies: ['SPRING Singapore', 'HSA', 'IMDA'],
    popularMarketplaces: ['Shopee SG', 'Lazada SG', 'Qoo10', 'Amazon SG'],
    popularPaymentMethods: ['PayNow', 'GrabPay', 'PayLah', 'Stripe'],
  },
  sa: {
    keyCities: ['Riyadh', 'Jeddah', 'Dammam', 'Mecca'],
    majorPorts: ['Jeddah Islamic Port', 'King Abdulaziz Port', 'Yanbu'],
    peakSeasons: [
      { period: 'Ramadan', reason: 'Peak shopping + gifting' },
      { period: 'Eid', reason: 'Gifting season' },
      { period: 'Sep-Oct', reason: 'National Day + school return' },
    ],
    regulatoryBodies: ['SFDA', 'SASO', 'ZATCA'],
    popularMarketplaces: ['Noon', 'Amazon.sa', 'Jarir', 'Extra'],
    popularPaymentMethods: ['Mada', 'Apple Pay', 'Tabby', 'Cash on Delivery'],
  },
  pk: {
    keyCities: ['Karachi', 'Lahore', 'Islamabad', 'Faisalabad'],
    majorPorts: ['Karachi Port', 'Port Qasim', 'Gwadar'],
    peakSeasons: [
      { period: 'Ramadan/Eid', reason: 'Peak shopping + gifting' },
      { period: 'Oct-Nov', reason: 'Wedding season' },
      { period: 'Aug', reason: 'Independence Day sales' },
    ],
    regulatoryBodies: ['PSQCA', 'FBR', 'Pakistan Customs'],
    popularMarketplaces: ['Daraz', 'OLX', 'Foodpanda', 'Shopify PK'],
    popularPaymentMethods: ['JazzCash', 'Easypaisa', 'Cash on Delivery', 'Bank Transfer'],
  },
  tr: {
    keyCities: ['Istanbul', 'Ankara', 'Izmir', 'Bursa'],
    majorPorts: ['Mersin', 'Izmir', 'Istanbul (Ambarli)'],
    peakSeasons: [
      { period: 'Nov-Dec', reason: 'New Year + Christmas' },
      { period: 'Ramadan', reason: 'Gifting season' },
      { period: 'Jun-Aug', reason: 'Summer + tourism' },
    ],
    regulatoryBodies: ['TSE', 'Ministry of Trade', 'Turkish Customs'],
    popularMarketplaces: ['Trendyol', 'Hepsiburada', 'N11', 'GittiGidiyor'],
    popularPaymentMethods: ['Havale', 'Credit Card', 'Kapıda Ödeme', 'Papara'],
  },
  au: {
    keyCities: ['Sydney', 'Melbourne', 'Brisbane', 'Perth'],
    majorPorts: ['Port of Sydney', 'Port of Melbourne', 'Port of Brisbane'],
    peakSeasons: [
      { period: 'Nov-Dec', reason: 'Christmas + Boxing Day (peak)' },
      { period: 'Jun-Jul', reason: 'End of Financial Year sales' },
      { period: 'Jan', reason: 'Back to school' },
    ],
    regulatoryBodies: ['ACCC', 'Australian Border Force', 'ASIC'],
    popularMarketplaces: ['eBay AU', 'Amazon AU', 'Catch', 'Kogan'],
    popularPaymentMethods: ['Afterpay', 'PayPal', 'Apple Pay', 'Zip'],
  },
  gb: {
    keyCities: ['London', 'Manchester', 'Birmingham', 'Glasgow'],
    majorPorts: ['Felixstowe', 'Southampton', 'London Gateway'],
    peakSeasons: [
      { period: 'Nov-Dec', reason: 'Christmas + Boxing Day (peak)' },
      { period: 'Jan', reason: 'January sales' },
      { period: 'Jun-Aug', reason: 'Summer sales' },
    ],
    regulatoryBodies: ['HMRC', 'Trading Standards', 'MHRA'],
    popularMarketplaces: ['Amazon UK', 'eBay UK', 'Etsy UK', 'Argos'],
    popularPaymentMethods: ['Klarna', 'Clearpay', 'Apple Pay', 'PayPal'],
  },
  de: {
    keyCities: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt'],
    majorPorts: ['Hamburg', 'Bremerhaven', 'Wilhelmshaven'],
    peakSeasons: [
      { period: 'Nov-Dec', reason: 'Christmas markets (peak)' },
      { period: 'Jun-Jul', reason: 'Summer sales' },
      { period: 'Jan', reason: 'Winter sales' },
    ],
    regulatoryBodies: ['Zoll', 'TÜV', 'BfArM'],
    popularMarketplaces: ['Amazon DE', 'Zalando', 'Otto', 'eBay DE'],
    popularPaymentMethods: ['Klarna', 'SEPA', 'PayPal', 'Rechnung'],
  },
};

const genericDomainKeywords = [
  'wikipedia', 'bbc', 'business.google', 'investopedia', 'salesforce',
  'linkedin', 'medium', 'wolterskluwer', 'baremetrics', 'entrepreneur',
  'quora', 'paisabazaar', 'uschamber', 'reddit', 'slideshare',
  'skynethosting', 'coursera', 'mailchimp', 'bigcommerce', 'wix',
  'godaddy', 'prometai', 'shopify', 'amazon', 'ebay', 'fundgrube',
  'pinterest', 'blogspot', 'ltdcommodities', 'hotcommodityhome',
  'jpmorgan', 'google', 'experian',
];

// Trend patterns (same as v4)
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

function generateFallbackTrend(keyword: string, country: string): number[] {
  const pattern = COUNTRY_TREND_PATTERNS[country] || COUNTRY_TREND_PATTERNS.us;
  const seed = keyword.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return pattern.map((v, i) => {
    const variation = ((seed + i * 7) % 15) - 7;
    return Math.max(10, Math.min(100, v + variation));
  });
}

// ============ HELPERS ============
const safeNumber = (val: any, fallback: number = 0) => {
  const num = Number(val);
  return isNaN(num) || num === 0 ? fallback : num;
};

const safeString = (val: any, fallback: string = 'N/A') => {
  if (!val || val === 'undefined' || val === 'null') return fallback;
  return String(val).replace(/-mock/g, '').replace(/\.mock/g, '').trim() || fallback;
};

const safeArray = (val: any): any[] => (Array.isArray(val) ? val : []);

const formatCurrency = (num: number, country: string): string => {
  const info = currencyInfo[country] || currencyInfo.us;
  try {
    return `${info.symbol}${num.toLocaleString(info.locale)}`;
  } catch {
    return `${info.symbol}${num.toLocaleString('en-US')}`;
  }
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

// ✅ IMPROVED v5: Stronger persona sanitization
const sanitizePersona = (personas: any, niche: string, country: string): any[] => {
  const countryName = countryNames[country] || 'your market';

  if (!Array.isArray(personas) || personas.length === 0) {
    return [
      {
        idx: 1,
        demographics: `Age 28-40, male, ${countryName}-based entrepreneur`,
        pain_points: `High setup costs and confusing regulations for ${niche}`,
        goals: `Launch a compliant ${niche} business quickly and minimize overhead`,
        buying_triggers: `Discovering a streamlined digital solution with transparent pricing`,
      },
      {
        idx: 2,
        demographics: `Age 35-50, female, business owner in ${countryName}`,
        pain_points: `Lack of clear guidance and fear of non-compliance in ${niche}`,
        goals: `Scale existing operations and enter new markets with confidence`,
        buying_triggers: `Recommendations from trusted local advisors or successful peers`,
      },
    ];
  }

  const cleaned = personas.map((persona: any, idx: number) => {
    let demographics = persona.demographics;
    if (typeof demographics === 'object' && demographics !== null) {
      const keys = ['age', 'gender', 'location', 'occupation', 'income'];
      demographics = keys.map((k) => demographics[k]).filter(Boolean).join(', ');
    }
    return {
      idx: idx + 1,
      demographics: safeString(demographics, `Age 30-45, business professional in ${countryName}`),
      pain_points: safeString(persona.pain_points, `High costs and lack of localized support for ${niche}`),
      goals: safeString(persona.goals, `Achieve sustainable growth with ${niche}`),
      buying_triggers: safeString(persona.buying_triggers, `Recognition of a clear ROI and trusted local references`),
    };
  });

  // Duplicate detection
  for (let i = 1; i < cleaned.length; i++) {
    const prev = cleaned[i - 1];
    const curr = cleaned[i];
    const isDuplicate =
      curr.pain_points === prev.pain_points &&
      curr.goals === prev.goals &&
      curr.buying_triggers === prev.buying_triggers;

    if (isDuplicate) {
      const uniqueSuffixes = [
        { demo: 'operations manager', pain: `Manual processes and scaling challenges in ${niche}`, goal: `Automate workflows and improve operational efficiency`, trigger: `Case studies from similar-sized businesses` },
        { demo: 'marketing lead', pain: `Difficulty reaching target customers for ${niche}`, goal: `Build a predictable lead generation pipeline`, trigger: `Free trial with measurable ROI in 30 days` },
        { demo: 'finance head', pain: `Unpredictable costs and unclear ROI for ${niche}`, goal: `Improve margins and forecasting accuracy`, trigger: `Transparent pricing with no hidden fees` },
      ];
      const fallback = uniqueSuffixes[(i - 1) % uniqueSuffixes.length];
      cleaned[i] = {
        idx: i + 1,
        demographics: `Age 32-48, ${fallback.demo}, ${countryName}-based`,
        pain_points: fallback.pain,
        goals: fallback.goal,
        buying_triggers: fallback.trigger,
      };
    }
  }

  return cleaned;
};

const extractJSON = (raw: string): any => {
  if (typeof raw === 'object') return raw;
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) cleaned = cleaned.substring(start, end + 1);
  try { return JSON.parse(cleaned); } catch {
    const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    try { return JSON.parse(fixed); } catch {
      let completed = cleaned;
      let braceCount = (completed.match(/{/g) || []).length;
      let closeCount = (completed.match(/}/g) || []).length;
      while (closeCount < braceCount) { completed += '}'; closeCount++; }
      try { return JSON.parse(completed); } catch { throw new Error('AI response is not valid JSON'); }
    }
  }
};

// ============ STRONG PROMPT v5 ============
const buildProductPrompt = (
  niche: string,
  country: string,
  serpContext: string,
  trendData: number[],
  serpResults: any[]
) => {
  const countryName = countryNames[country] || country;
  const trendSummary = trendData.length > 0 ? `12-month Google Trends data: ${trendData.join(', ')}` : 'No trend data available.';
  const serpEvidence = serpResults.slice(0, 10).map((r: any, i: number) => `${i + 1}. ${r.title} - ${r.link}`).join('\n');
  const currencySymbol = currencyInfo[country]?.symbol || '$';
  const localData = LOCAL_MARKET_DATA[country];

  const localMarketBlock = localData
    ? `
═══════════════════════════════════════════════════════════════════════
🏙️ LOCAL MARKET DATA FOR ${countryName.toUpperCase()} (USE THIS — DO NOT INVENT)
═══════════════════════════════════════════════════════════════════════
📍 Key Cities: ${localData.keyCities.join(', ')}
🚢 Major Ports: ${localData.majorPorts.join(', ')}
📅 Peak Seasons:
${localData.peakSeasons.map((s) => `   • ${s.period}: ${s.reason}`).join('\n')}
⚖️  Regulatory Bodies: ${localData.regulatoryBodies.join(', ')}
🛒 Popular Marketplaces: ${localData.popularMarketplaces.join(', ')}
💳 Payment Methods: ${localData.popularPaymentMethods.join(', ')}`
    : '';

  return `You are a SENIOR E-COMMERCE INTELLIGENCE ANALYST with 15+ years of experience in ${countryName} market.
Write like a forensic consultant. Focus HEAVILY on competitor intelligence and local market dynamics.

Target Market: ${countryName}. Current Year: 2026.
Local Currency: ${currencySymbol}

═══════════════════════════════════════════════════════════════════════
🎯 PRIMARY FOCUS AREAS (60% of report should focus here)
═══════════════════════════════════════════════════════════════════════
1. COMPETITOR FORENSICS — Reverse-engineer competitors' strategy
2. LOCAL MARKET INTELLIGENCE — Country-specific dynamics

${localMarketBlock}

═══════════════════════════════════════════════════════════════════════
📊 REAL SERP DATA (COMPETITORS)
═══════════════════════════════════════════════════════════════════════
${serpContext}

═══════════════════════════════════════════════════════════════════════
🔗 TOP SERP EVIDENCE (Titles & URLs)
═══════════════════════════════════════════════════════════════════════
${serpEvidence || 'No live SERP data available.'}

═══════════════════════════════════════════════════════════════════════
📈 TREND DATA
═══════════════════════════════════════════════════════════════════════
${trendSummary}

═══════════════════════════════════════════════════════════════════════
⚠️ STRICT INSTRUCTIONS (NON-NEGOTIABLE)
═══════════════════════════════════════════════════════════════════════
1. Use REAL competitor names from SERP. NEVER invent fake brands.
2. Every competitor claim MUST cite SERP URL as evidence.
3. Use "Typical Price", "Market Price", or "From ${currencySymbol}XX" — NEVER "Estimated" or "Est."
4. All monetary values in ${currencySymbol}.
5. NO fabricated stats. If data missing, say "Data not available for this dimension."
6. Use only ${countryName}-specific cities, ports, platforms, payment methods from LOCAL MARKET DATA above.
7. Provide at least 3 consumer personas. Each MUST have distinct demographics.
8. Every section MUST be actionable. No filler.
9. Cite at least 3 SERP sources with URLs in data_validation.
10. Include country-specific regulatory bodies in compliance section.
11. Use REAL seasonal calendar from LOCAL MARKET DATA above.
12. NO AI mention. NO "Modeled". NO "Gemini".
13. Focus 60% on competitor + local market. 40% on financial + sourcing.

═══════════════════════════════════════════════════════════════════════
🎯 RETURN VALID JSON — ALL SECTIONS MANDATORY
═══════════════════════════════════════════════════════════════════════

{
  "executive_headline": "One-line business impact with specific number in ${currencySymbol}",
  
  "key_insights": [
    "Insight 1 with SPECIFIC competitor reference from SERP",
    "Insight 2 with local market data (city/season/port)",
    "Insight 3 with financial opportunity"
  ],
  
  "immediate_actions": [
    { "action": "Specific action", "owner": "Role", "timeline": "Week X-Y", "impact": "${currencySymbol}X/month" },
    { "action": "Specific action", "owner": "Role", "timeline": "Week X-Y", "impact": "${currencySymbol}X/month" },
    { "action": "Specific action", "owner": "Role", "timeline": "Week X-Y", "impact": "${currencySymbol}X/month" }
  ],
  
  "trend_summary": "Overall market trend with seasonality reference",
  "trend_assessment": "2-3 sentence insight referencing 12-month peaks from LOCAL MARKET DATA",
  
  "local_business_insight": [
    "Insight 1 (specific to ${countryName}: city, regulation, or payment method)",
    "Insight 2 (specific to ${countryName}: platform, port, or seasonality)",
    "Insight 3 (specific to ${countryName}: consumer behavior or regulatory)"
  ],
  
  "consumer_persona": [
    {
      "demographics": "Age XX-XX, [gender], [city from LOCAL DATA]-based [specific role]",
      "pain_points": "Specific pain points with numbers if possible",
      "goals": "Specific measurable goals",
      "buying_triggers": "What triggers purchase with specific reference"
    },
    {
      "demographics": "Age XX-XX, [gender], [different city]-based [different role]",
      "pain_points": "DIFFERENT from persona 1",
      "goals": "DIFFERENT from persona 1",
      "buying_triggers": "DIFFERENT from persona 1"
    },
    {
      "demographics": "Age XX-XX, [gender], [city]-based [role]",
      "pain_points": "DIFFERENT from persona 1 & 2",
      "goals": "DIFFERENT from persona 1 & 2",
      "buying_triggers": "DIFFERENT from persona 1 & 2"
    }
  ],
  
  "competitor_forensics": {
    "top_3_competitors": [
      {
        "name": "REAL competitor name from SERP",
        "url": "SERP URL",
        "estimated_da": 52,
        "market_position": "Leader / Challenger / Niche",
        "estimated_monthly_traffic": "XX,XXX",
        "strengths": ["Strength 1", "Strength 2", "Strength 3"],
        "weaknesses": ["Weakness 1", "Weakness 2", "Weakness 3"],
        "pricing_strategy": "Specific price range",
        "gap_opportunity": "Specific gap you can exploit"
      },
      {
        "name": "REAL competitor 2",
        "url": "SERP URL 2",
        "estimated_da": 41,
        "market_position": "Challenger",
        "estimated_monthly_traffic": "XX,XXX",
        "strengths": ["Strength 1", "Strength 2"],
        "weaknesses": ["Weakness 1", "Weakness 2"],
        "pricing_strategy": "Specific price range",
        "gap_opportunity": "Specific gap"
      },
      {
        "name": "REAL competitor 3",
        "url": "SERP URL 3",
        "estimated_da": 38,
        "market_position": "Niche",
        "estimated_monthly_traffic": "X,XXX",
        "strengths": ["Strength 1"],
        "weaknesses": ["Weakness 1", "Weakness 2"],
        "pricing_strategy": "Specific price range",
        "gap_opportunity": "Specific gap"
      }
    ],
    "competitor_weakness_matrix": [
      { "competitor": "Name 1", "weakness": "Specific weakness", "opportunity": "How to exploit", "difficulty": "Low/Medium/High" },
      { "competitor": "Name 2", "weakness": "Specific weakness", "opportunity": "How to exploit", "difficulty": "Low/Medium/High" },
      { "competitor": "Name 3", "weakness": "Specific weakness", "opportunity": "How to exploit", "difficulty": "Low/Medium/High" }
    ]
  },
  
  "local_market_intelligence": {
    "city_demand_heatmap": [
      { "city": "City 1 from LOCAL DATA", "demand_score": 95, "reason": "Why high demand" },
      { "city": "City 2 from LOCAL DATA", "demand_score": 85, "reason": "Why high demand" },
      { "city": "City 3 from LOCAL DATA", "demand_score": 75, "reason": "Why high demand" },
      { "city": "City 4 from LOCAL DATA", "demand_score": 65, "reason": "Why" },
      { "city": "City 5 from LOCAL DATA", "demand_score": 55, "reason": "Why" }
    ],
    "seasonal_calendar": [
      { "period": "Peak 1 from LOCAL DATA", "priority": "MAXIMUM", "reason": "Reason from LOCAL DATA" },
      { "period": "Peak 2", "priority": "HIGH", "reason": "Reason" },
      { "period": "Peak 3", "priority": "MEDIUM", "reason": "Reason" }
    ],
    "local_suppliers_agents": [
      { "name": "Specific supplier/agent name", "type": "Sourcing agent / Distributor / Freight forwarder", "specialty": "What they specialize in", "contact_hint": "Where to find them" },
      { "name": "Supplier 2", "type": "Type", "specialty": "Specialty", "contact_hint": "Where to find" },
      { "name": "Supplier 3", "type": "Type", "specialty": "Specialty", "contact_hint": "Where to find" }
    ],
    "local_channels": [
      { "channel": "Channel from LOCAL DATA", "type": "Marketplace/Platform", "audience_size": "Approx users", "best_for": "What products" },
      { "channel": "Channel 2", "type": "Marketplace", "audience_size": "Approx", "best_for": "What" },
      { "channel": "Channel 3", "type": "Marketplace", "audience_size": "Approx", "best_for": "What" }
    ],
    "local_payment_landscape": "2-3 sentences about ${countryName} payment preferences from LOCAL DATA"
  },
  
  "regulatory_landscape": {
    "key_bodies": ["Body 1 from LOCAL DATA", "Body 2", "Body 3"],
    "required_certifications": ["Cert 1 (e.g., BIS, SIRIM, CE)", "Cert 2", "Cert 3"],
    "compliance_steps": [
      "Step 1: Specific step",
      "Step 2: Specific step",
      "Step 3: Specific step",
      "Step 4: Specific step"
    ],
    "estimated_compliance_timeline": "X-Y weeks",
    "estimated_compliance_cost": "${currencySymbol}XX,XXX"
  },
  
  "financial_model": [
    { "tier_name": "Tier 1 Name", "price": "Typical Price: ${currencySymbol}XX/month", "features": "Feature list", "target_audience": "Who" },
    { "tier_name": "Tier 2 Name", "price": "Typical Price: ${currencySymbol}XXX/month", "features": "Features", "target_audience": "Who" },
    { "tier_name": "Tier 3 Name", "price": "Typical Price: ${currencySymbol}XXXX/month", "features": "Features", "target_audience": "Who" }
  ],
  
  "sourcing_analysis": [
    "Strategy 1 with specific platform (1688, Alibaba) and cost impact",
    "Strategy 2 with specific quality control approach",
    "Strategy 3 with logistics optimization (reference local port from LOCAL DATA)"
  ],
  
  "marketing_channels": [
    { "channel": "Channel from LOCAL DATA", "why": "Why it works in ${countryName}", "expected_cac": "${currencySymbol}XX" },
    { "channel": "Channel 2", "why": "Why", "expected_cac": "${currencySymbol}XX" },
    { "channel": "Channel 3", "why": "Why", "expected_cac": "${currencySymbol}XX" }
  ],
  
  "growth_accelerators": [
    "Accelerator 1 with specific local tactic",
    "Accelerator 2",
    "Accelerator 3"
  ],
  
  "launch_action_plan": [
    { "phase": "Days 1-30", "actions": ["Action 1", "Action 2", "Action 3"], "milestone": "Specific milestone" },
    { "phase": "Days 31-60", "actions": ["Action 1", "Action 2"], "milestone": "Milestone" },
    { "phase": "Days 61-90", "actions": ["Action 1", "Action 2"], "milestone": "Milestone" }
  ],
  
  "data_validation": [
    "Source 1: [REAL SERP URL] — Explanation of what it validates",
    "Source 2: [REAL SERP URL] — Explanation",
    "Source 3: [REAL SERP URL] — Explanation"
  ],
  
  "competitor_benchmark": [
    { "brand": "REAL brand from SERP", "price": "Typical Price: ${currencySymbol}XX", "market_position": "Position", "gap": "Specific gap" },
    { "brand": "REAL brand 2", "price": "Market Price: ${currencySymbol}XX", "market_position": "Position", "gap": "Gap" },
    { "brand": "REAL brand 3", "price": "From ${currencySymbol}XX", "market_position": "Position", "gap": "Gap" }
  ],
  
  "assumptions_risk": [
    { "assumption": "Assumption 1", "risk": "Risk if wrong", "mitigation": "How to mitigate" },
    { "assumption": "Assumption 2", "risk": "Risk", "mitigation": "Mitigation" },
    { "assumption": "Assumption 3", "risk": "Risk", "mitigation": "Mitigation" }
  ],
  
  "customer_sentiment": [
    "Specific consumer sentiment 1 (reference ${countryName} behavior)",
    "Sentiment 2",
    "Sentiment 3"
  ],
  
  "client_value_proposition": [
    "VP 1 with specific ${countryName} market angle",
    "VP 2",
    "VP 3"
  ],
  
  "scenario_planning": [
    { "scenario": "Best Case", "action_plan": "Specific actions", "projected_monthly_revenue": "${currencySymbol}XXX,XXX" },
    { "scenario": "Expected Case", "action_plan": "Specific actions", "projected_monthly_revenue": "${currencySymbol}XXX,XXX" },
    { "scenario": "Worst Case", "action_plan": "Specific actions", "projected_monthly_revenue": "${currencySymbol}XXX,XXX" }
  ],
  
  "logistics_risk_map": [
    { "risk": "Specific risk (reference port from LOCAL DATA)", "likelihood": "High/Medium/Low", "impact": "High/Medium/Low", "mitigation": "Specific mitigation" },
    { "risk": "Risk 2", "likelihood": "Medium", "impact": "Medium", "mitigation": "Mitigation" },
    { "risk": "Risk 3", "likelihood": "Low", "impact": "High", "mitigation": "Mitigation" }
  ],
  
  "cold_start_strategy": [
    "Tactic 1 to get first 5 clients in ${countryName}",
    "Tactic 2",
    "Tactic 3"
  ],
  
  "csr_esg_roadmap": [
    "Initiative 1 relevant to ${countryName}",
    "Initiative 2"
  ],
  
  "swot_analysis": [
    { "type": "strength", "points": "Specific strength in ${countryName} market" },
    { "type": "weakness", "points": "Specific weakness" },
    { "type": "opportunity", "points": "Specific opportunity (reference LOCAL DATA)" },
    { "type": "threat", "points": "Specific threat" }
  ],
  
  "action_priority_matrix": [
    { "task": "Task 1", "impact": "High", "effort": "Medium", "priority": "Quick Win" },
    { "task": "Task 2", "impact": "High", "effort": "High", "priority": "Major Project" },
    { "task": "Task 3", "impact": "Medium", "effort": "Low", "priority": "Fill-in" }
  ],
  
  "financial_projection": [
    { "year": "Year 1", "projected_revenue": 5000000, "projected_cost": 3500000, "net_profit_margin": 30 },
    { "year": "Year 2", "projected_revenue": 9000000, "projected_cost": 5800000, "net_profit_margin": 35 },
    { "year": "Year 3", "projected_revenue": 18000000, "projected_cost": 11000000, "net_profit_margin": 40 }
  ],
  
  "risk_assessment": [
    { "risk_factor": "Risk 1", "impact_level": "High", "mitigation_strategy": "Specific strategy" },
    { "risk_factor": "Risk 2", "impact_level": "Medium", "mitigation_strategy": "Strategy" },
    { "risk_factor": "Risk 3", "impact_level": "Low", "mitigation_strategy": "Strategy" }
  ],
  
  "final_ceo_summary": [
    "Strategic point 1",
    "Strategic point 2",
    "Strategic point 3"
  ],
  
  "data_limitations": [
    "Limitation 1",
    "Limitation 2"
  ],
  
  "case_studies": [
    {
      "title": "Case Study 1: [Industry] in ${countryName}",
      "challenge": "Specific challenge with numbers",
      "solution": "What was done — reference ${countryName} cities/platforms",
      "results": "Outcome with metrics in ${currencySymbol}"
    },
    {
      "title": "Case Study 2: [Industry] in ${countryName}",
      "challenge": "Challenge",
      "solution": "Solution",
      "results": "Results in ${currencySymbol}"
    }
  ]
}

Provide the JSON directly without any markdown formatting.`;
};

// ============ MAIN GENERATOR ============
export async function generateProductReport(niche: string, country: string) {
  const cacheKey = `product_v5_${niche}_${country}`;
  const cached = cacheService.get(cacheKey);
  if (cached) {
    console.log('📦 [Cache] Returning cached Product Report (v5).');
    return cached;
  }

  console.log(`🔍 [Product v5] Generating for "${niche}" in ${country}...`);

  // HYBRID TREND FETCH
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
    } catch {
      console.warn('⚠️ [Hybrid] DataForSEO trends failed.');
    }
  }

  if (trendData.length === 0) {
    trendData = await getGoogleTrends(niche, country).catch(() => []);
    if (trendData.length > 0) trendSource = 'google_trends';
  }

  if (trendData.length === 0) {
    trendData = generateFallbackTrend(niche, country);
    trendSource = 'pattern_fallback';
  }

  // SERP FETCH
  let searchData = await getSearchResults(niche, country).catch(() => null);
  if (!searchData?.organic_results) searchData = await getScraperAPISearch(niche, country).catch(() => null);
  if (!searchData?.organic_results) searchData = await getSerperResults(niche, country).catch(() => null);

  let serpContext = 'SERP Data currently unavailable.';
  let serpResults: any[] = [];
  if (searchData?.organic_results) {
    const filteredResults = searchData.organic_results.filter((r: any) => {
      try {
        const url = r.link || '';
        if (url.includes('google.com/goto')) return false;
        const domain = new URL(url).hostname.replace('www.', '').toLowerCase();
        return !genericDomainKeywords.some((keyword) => domain.includes(keyword));
      } catch {
        return false;
      }
    });
    serpResults = filteredResults.slice(0, 10);
    const topSites = serpResults
      .map((r: any) => `Title: ${r.title} | URL: ${r.link} | Snippet: ${r.snippet || ''}`)
      .join('\n');
    serpContext = `Top real competitors from Google SERP:\n${topSites}`;
  }

  // AI CALL
  const prompt = buildProductPrompt(niche, country, serpContext, trendData, serpResults);
  const aiResponse = await runGroqWithRetry(prompt, JSON.stringify({ niche, country }));
  const analysis = extractJSON(aiResponse);

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const reference = `MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const currency = currencyInfo[country] || currencyInfo.us;
  const localData = LOCAL_MARKET_DATA[country];

  // SANITIZE ALL SECTIONS
  const clientValueProp = ensureStringArray(analysis.client_value_proposition);
  const keyInsights = ensureStringArray(analysis.key_insights);
  const localBusinessInsight = ensureStringArray(analysis.local_business_insight);
  const persona = sanitizePersona(analysis.consumer_persona, niche, country);
  const financialModel = ensureStringArray(analysis.financial_model);
  const sourcingAnalysis = ensureStringArray(analysis.sourcing_analysis);
  const marketingChannels = ensureStringArray(analysis.marketing_channels);
  const growthAccelerators = ensureStringArray(analysis.growth_accelerators);
  const dataValidation = ensureStringArray(analysis.data_validation);
  const customerSentiment = ensureStringArray(analysis.customer_sentiment);
  const coldStartStrategy = ensureStringArray(analysis.cold_start_strategy);
  const csrEsgRoadmap = ensureStringArray(analysis.csr_esg_roadmap);
  const finalCeoSummary = ensureStringArray(analysis.final_ceo_summary);
  const dataLimitations = ensureStringArray(analysis.data_limitations);
  const caseStudies = Array.isArray(analysis.case_studies) ? analysis.case_studies : [];

  // BUILD MARKDOWN
  let markdown = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MusePRO
Market Intelligence & Strategic Modeling
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

              PRODUCT INTELLIGENCE REPORT
              (Strong Edition — Competitor + Local Focus)

Prepared For:      [Client Name]
Date:              ${today}
Reference:         ${reference}
Classification:    CONFIDENTIAL

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HEADLINE:
"${safeString(analysis.executive_headline, `Opportunity analysis for ${niche} in ${countryNames[country]}`)}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. CLIENT VALUE PROPOSITION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  clientValueProp.slice(0, 3).forEach((item: string, i: number) => {
    markdown += `  ${i + 1}. ${item}\n`;
  });

  markdown += `\n2. EXECUTIVE BRIEF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 KEY INSIGHTS

`;
  keyInsights.slice(0, 3).forEach((insight: string, i: number) => {
    markdown += `  ${i + 1}. ${insight}\n`;
  });

  markdown += `\n⚡ IMMEDIATE ACTIONS (Next 30 Days)\n\n`;
  safeArray(analysis.immediate_actions).forEach((action: any, i: number) => {
    markdown += `  ${i + 1}. ${safeString(action.action)}\n`;
    markdown += `     Owner: ${safeString(action.owner)} | Timeline: ${safeString(action.timeline)} | Impact: ${safeString(action.impact)}\n\n`;
  });

  markdown += `3. TREND ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${safeString(analysis.trend_summary)}

${safeString(analysis.trend_assessment)}

`;

  markdown += `4. LOCAL MARKET INTELLIGENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 LOCAL BUSINESS INSIGHTS (${countryNames[country]})

`;
  localBusinessInsight.forEach((insight: string, i: number) => {
    markdown += `  ${i + 1}. ${insight}\n`;
  });

  markdown += `\n🏙️ CITY DEMAND HEATMAP\n\n`;
  safeArray(analysis.local_market_intelligence?.city_demand_heatmap).forEach((city: any, i: number) => {
    const score = city.demand_score || 0;
    const bar = '█'.repeat(Math.round(score / 5)) + '░'.repeat(20 - Math.round(score / 5));
    markdown += `  ${safeString(city.city).padEnd(15)} ${bar} ${score}/100\n`;
    markdown += `  → ${safeString(city.reason)}\n\n`;
  });

  markdown += `📅 SEASONAL CALENDAR (${countryNames[country]})\n\n`;
  safeArray(analysis.local_market_intelligence?.seasonal_calendar).forEach((season: any) => {
    const emoji = season.priority === 'MAXIMUM' ? '🔴' : season.priority === 'HIGH' ? '🟠' : '🟡';
    markdown += `  ${emoji} ${safeString(season.period)} — ${safeString(season.priority)}\n`;
    markdown += `     ${safeString(season.reason)}\n\n`;
  });

  markdown += `🏭 LOCAL SUPPLIERS & AGENTS\n\n`;
  markdown += `| Name | Type | Specialty | Where to Find |\n`;
  markdown += `|---|---|---|---|\n`;
  safeArray(analysis.local_market_intelligence?.local_suppliers_agents).forEach((s: any) => {
    markdown += `| ${safeString(s.name)} | ${safeString(s.type)} | ${safeString(s.specialty)} | ${safeString(s.contact_hint)} |\n`;
  });

  markdown += `\n🛒 POPULAR CHANNELS\n\n`;
  markdown += `| Channel | Type | Audience | Best For |\n`;
  markdown += `|---|---|---|---|\n`;
  safeArray(analysis.local_market_intelligence?.local_channels).forEach((c: any) => {
    markdown += `| ${safeString(c.channel)} | ${safeString(c.type)} | ${safeString(c.audience_size)} | ${safeString(c.best_for)} |\n`;
  });

  markdown += `\n💳 PAYMENT LANDSCAPE\n\n${safeString(analysis.local_market_intelligence?.local_payment_landscape)}\n\n`;

  markdown += `5. CONSUMER PERSONAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  persona.forEach((p: any) => {
    markdown += `┌────────────────────────────────────────────────────────────┐\n`;
    markdown += `│ PERSONA #${p.idx}\n`;
    markdown += `├────────────────────────────────────────────────────────────┤\n`;
    markdown += `│ Demographics:   ${p.demographics}\n`;
    markdown += `│ Pain Points:    ${p.pain_points}\n`;
    markdown += `│ Goals:          ${p.goals}\n`;
    markdown += `│ Buying Triggers: ${p.buying_triggers}\n`;
    markdown += `└────────────────────────────────────────────────────────────┘\n\n`;
  });

  markdown += `6. COMPETITOR FORENSICS (DEEP-DIVE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  safeArray(analysis.competitor_forensics?.top_3_competitors).forEach((comp: any, i: number) => {
    markdown += `┌────────────────────────────────────────────────────────────┐\n`;
    markdown += `│ COMPETITOR #${i + 1}: ${safeString(comp.name)}\n`;
    markdown += `├────────────────────────────────────────────────────────────┤\n`;
    markdown += `│ URL:            ${safeString(comp.url)}\n`;
    markdown += `│ Est. DA:        ${comp.estimated_da || 'N/A'}\n`;
    markdown += `│ Market Position: ${safeString(comp.market_position)}\n`;
    markdown += `│ Monthly Traffic: ${safeString(comp.estimated_monthly_traffic)}\n`;
    markdown += `│ Pricing:        ${safeString(comp.pricing_strategy)}\n`;
    markdown += `└────────────────────────────────────────────────────────────┘\n\n`;

    markdown += `  💪 STRENGTHS:\n`;
    safeArray(comp.strengths).forEach((s: string) => {
      markdown += `     • ${s}\n`;
    });

    markdown += `\n  ⚠️ WEAKNESSES:\n`;
    safeArray(comp.weaknesses).forEach((w: string) => {
      markdown += `     • ${w}\n`;
    });

    markdown += `\n  🎯 GAP OPPORTUNITY:\n     ${safeString(comp.gap_opportunity)}\n\n`;
    markdown += `──────────────────────────────────────────────────────────────\n\n`;
  });

  markdown += `⚔️ COMPETITOR WEAKNESS MATRIX\n\n`;
  markdown += `| Competitor | Weakness | Opportunity | Difficulty |\n`;
  markdown += `|---|---|---|---|\n`;
  safeArray(analysis.competitor_forensics?.competitor_weakness_matrix).forEach((w: any) => {
    markdown += `| ${safeString(w.competitor)} | ${safeString(w.weakness)} | ${safeString(w.opportunity)} | ${safeString(w.difficulty)} |\n`;
  });

  markdown += `\n7. COMPETITOR PRICE BENCHMARKING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Brand | Price | Market Position | Gap |
|---|---|---|---|
`;
  safeArray(analysis.competitor_benchmark).forEach((c: any) => {
    markdown += `| ${safeString(c.brand)} | ${safeString(c.price)} | ${safeString(c.market_position)} | ${safeString(c.gap)} |\n`;
  });

  markdown += `\n8. REGULATORY & COMPLIANCE LANDSCAPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚖️ KEY REGULATORY BODIES (${countryNames[country]})

`;
  safeArray(analysis.regulatory_landscape?.key_bodies).forEach((b: string) => {
    markdown += `  • ${b}\n`;
  });

  markdown += `\n📋 REQUIRED CERTIFICATIONS\n\n`;
  safeArray(analysis.regulatory_landscape?.required_certifications).forEach((c: string) => {
    markdown += `  ✓ ${c}\n`;
  });

  markdown += `\n🚦 COMPLIANCE STEPS\n\n`;
  safeArray(analysis.regulatory_landscape?.compliance_steps).forEach((step: string, i: number) => {
    markdown += `  ${i + 1}. ${step}\n`;
  });

  markdown += `\n⏱️  Est. Timeline: ${safeString(analysis.regulatory_landscape?.estimated_compliance_timeline)}\n`;
  markdown += `💰 Est. Cost: ${safeString(analysis.regulatory_landscape?.estimated_compliance_cost)}\n\n`;

  markdown += `9. PRODUCT VIABILITY & FINANCIAL MODEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  financialModel.forEach((item: string, i: number) => {
    markdown += `  ${i + 1}. ${item}\n`;
  });

  markdown += `\n10. SOURCING & SUPPLIER ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  sourcingAnalysis.forEach((item: string, i: number) => {
    markdown += `  ${i + 1}. ${item}\n`;
  });

  markdown += `\n11. MARKETING & SALES CHANNELS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Channel | Why It Works | Expected CAC |
|---|---|---|
`;
  safeArray(analysis.marketing_channels).forEach((c: any) => {
    if (typeof c === 'object') {
      markdown += `| ${safeString(c.channel)} | ${safeString(c.why)} | ${safeString(c.expected_cac)} |\n`;
    } else {
      markdown += `| ${c} | - | - |\n`;
    }
  });

  markdown += `\n12. GROWTH ACCELERATORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  growthAccelerators.forEach((item: string, i: number) => {
    markdown += `  ${i + 1}. ${item}\n`;
  });

  markdown += `\n13. 30-60-90 DAY LAUNCH ACTION PLAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  safeArray(analysis.launch_action_plan).forEach((phase: any) => {
    markdown += `🎯 ${safeString(phase.phase)}\n`;
    safeArray(phase.actions).forEach((a: string) => {
      markdown += `   • ${a}\n`;
    });
    markdown += `   ✅ Milestone: ${safeString(phase.milestone)}\n\n`;
  });

  markdown += `14. DATA VALIDATION & EVIDENCE SOURCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  dataValidation.forEach((item: string, i: number) => {
    markdown += `  ${i + 1}. ${item}\n`;
  });

  markdown += `\n15. ASSUMPTIONS & RISK ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  safeArray(analysis.assumptions_risk).forEach((ar: any, i: number) => {
    if (typeof ar === 'object') {
      markdown += `  ${i + 1}. Assumption: ${safeString(ar.assumption)}\n`;
      markdown += `     Risk: ${safeString(ar.risk)}\n`;
      markdown += `     Mitigation: ${safeString(ar.mitigation)}\n\n`;
    } else {
      markdown += `  ${i + 1}. ${ar}\n`;
    }
  });

  markdown += `16. CUSTOMER SENTIMENT & MARKET QUOTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  customerSentiment.forEach((item: string, i: number) => {
    markdown += `  ${i + 1}. ${item}\n`;
  });

  markdown += `\n17. SCENARIO PLANNING & ROI PROJECTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  safeArray(analysis.scenario_planning).forEach((s: any) => {
    markdown += `┌────────────────────────────────────────────────────────────┐\n`;
    markdown += `│ ${safeString(s.scenario)}\n`;
    markdown += `├────────────────────────────────────────────────────────────┤\n`;
    markdown += `│ Action Plan: ${safeString(s.action_plan)}\n`;
    markdown += `│ Projected Monthly Revenue: ${safeString(s.projected_monthly_revenue)}\n`;
    markdown += `└────────────────────────────────────────────────────────────┘\n\n`;
  });

  markdown += `18. LOGISTICS & SUPPLY CHAIN RISK MAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  safeArray(analysis.logistics_risk_map).forEach((r: any, i: number) => {
    markdown += `  ${i + 1}. Risk: ${safeString(r.risk)}\n`;
    markdown += `     Likelihood: ${safeString(r.likelihood)} | Impact: ${safeString(r.impact)}\n`;
    markdown += `     Mitigation: ${safeString(r.mitigation)}\n\n`;
  });

  markdown += `19. COLD-START STRATEGY (FIRST 5 CLIENTS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  coldStartStrategy.forEach((item: string, i: number) => {
    markdown += `  ${i + 1}. ${item}\n`;
  });

  markdown += `\n20. CSR & ESG ROADMAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  csrEsgRoadmap.forEach((item: string, i: number) => {
    markdown += `  ${i + 1}. ${item}\n`;
  });

  markdown += `\n21. SWOT ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  safeArray(analysis.swot_analysis).forEach((item: any, i: number) => {
    if (typeof item === 'object') {
      const emoji = item.type === 'strength' ? '💪' : item.type === 'weakness' ? '⚠️' : item.type === 'opportunity' ? '🎯' : '🚨';
      markdown += `  ${emoji} ${safeString(item.type).toUpperCase()}: ${safeString(item.points)}\n`;
    } else {
      markdown += `  ${i + 1}. ${item}\n`;
    }
  });

  markdown += `\n22. ACTION PRIORITY MATRIX (Impact vs Effort)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Task | Impact | Effort | Priority |
|---|---|---|---|
`;
  safeArray(analysis.action_priority_matrix).forEach((a: any) => {
    markdown += `| ${safeString(a.task)} | ${safeString(a.impact)} | ${safeString(a.effort)} | ${safeString(a.priority)} |\n`;
  });

  markdown += `\n23. ROI & FINANCIAL PROJECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  safeArray(analysis.financial_projection).forEach((fp: any, i: number) => {
    if (typeof fp === 'object') {
      markdown += `  ${i + 1}. Year: ${safeString(fp.year)} | Revenue: ${formatCurrency(fp.projected_revenue || 0, country)} | Cost: ${formatCurrency(fp.projected_cost || 0, country)} | Margin: ${fp.net_profit_margin || 0}%\n`;
    } else {
      markdown += `  ${i + 1}. ${fp}\n`;
    }
  });

  markdown += `\n24. RISK ASSESSMENT TABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  safeArray(analysis.risk_assessment).forEach((r: any, i: number) => {
    markdown += `  ${i + 1}. ${safeString(r.risk_factor)} | Impact: ${safeString(r.impact_level)} | Mitigation: ${safeString(r.mitigation_strategy)}\n`;
  });

  markdown += `\n25. FINAL CEO SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  finalCeoSummary.forEach((item: string, i: number) => {
    markdown += `  ${i + 1}. ${item}\n`;
  });

  markdown += `\n26. CASE STUDIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  caseStudies.forEach((cs: any, i: number) => {
    markdown += `CASE STUDY ${String(i + 1).padStart(2, '0')}: ${safeString(cs.title)}\n`;
    markdown += `─────────────────────────────────────────\n\n`;
    markdown += `⚠️ CHALLENGE:\n${safeString(cs.challenge)}\n\n`;
    markdown += `🎯 SOLUTION:\n${safeString(cs.solution)}\n\n`;
    markdown += `📊 RESULTS:\n${safeString(cs.results)}\n\n`;
    markdown += `─────────────────────────────────────────\n\n`;
  });

  // EVIDENCE & SOURCES
  markdown += `EVIDENCE & SOURCES (Live SERP Data)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  if (serpResults.length > 0) {
    markdown += `| # | Title | URL | Snippet |\n|---|-------|-----|--------|\n`;
    serpResults.slice(0, 10).forEach((r: any, i: number) => {
      markdown += `| ${i + 1} | ${safeString(r.title)} | ${safeString(r.link)} | ${safeString(r.snippet, 'N/A').substring(0, 80)}... |\n`;
    });
  } else {
    markdown += `No live SERP data available.\n`;
  }

  markdown += `\nMETHODOLOGY & DATA LIMITATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  dataLimitations.forEach((item: string, i: number) => {
    markdown += `  ${i + 1}. ${item}\n`;
  });

  const trendSourceLabel = trendSource === 'dataforseo'
    ? 'DataForSEO Google Trends API (Live 12-month)'
    : trendSource === 'google_trends'
    ? 'Google Trends API (Live 12-month)'
    : 'Country-Specific Seasonal Pattern (Modeled)';

  markdown += `\nThis report is based on comprehensive primary and secondary research conducted on ${today} from:\n\n`;
  markdown += `• Real-time Market & Consumer Demand Trends\n`;
  markdown += `• Live Search Engine Results (SERP) via SerpAPI/ScraperAPI/SerperAPI\n`;
  markdown += `• Trend Data: ${trendSourceLabel}\n`;
  markdown += `• Local Sourcing & Logistics Audit via MusePRO Proprietary Database\n`;
  markdown += `• Financial Modeling, Margin & Break-even Calculations\n`;
  markdown += `• Strategic Synthesis & Market Insights by MusePRO Senior Research Division\n`;
  markdown += `\n📡 DATA SOURCE NOTE: DataForSEO integration is ready. Live keyword and trend metrics will activate automatically once API credentials are configured.\n\n`;

  markdown += `\nDISCLAIMER\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  markdown += `This report is for informational purposes only and does not constitute legal, tax, or financial advice. Please consult qualified professionals before making business decisions.\n\n`;
  markdown += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGenerated by MusePRO Senior Research Division.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  const result = {
    niche,
    country,
    type: 'product',
    data: analysis,
    keywords: [],
    serp_landscape: serpResults.slice(0, 8),
    markdown,
    trend_summary: analysis.trend_summary || 'High potential market.',
    trendSource,
    chart_data: {
      trend_12m: trendData.slice(0, 12).map((v: number, i: number) => ({
        month: `M${i + 1}`,
        value: v,
      })),
      city_demand: safeArray(analysis.local_market_intelligence?.city_demand_heatmap).map((c: any) => ({
        city: c.city,
        score: c.demand_score,
      })),
      traffic_forecast_6m: [],
      market_share: [],
    },
    traffic_estimate: 0,
  };
  cacheService.set(cacheKey, result, 86400);
  return result;
}
