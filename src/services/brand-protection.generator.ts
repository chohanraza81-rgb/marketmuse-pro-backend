// src/services/brand-protection.generator.ts - FIXED v2.0 - Evidence Safe
// Counterfeit Intelligence Report Generator
// Hybrid: OSINT + AI + DataForSEO

import { cacheService } from './cache';
import { runGroqWithRetry } from './groq';
import { isDataForSEOAvailable, fetchRealTrends } from './dataforseo.service';
import {
  collectOSINTFindings,
  analyzePlatformDistribution,
  analyzeCounterfeitKeywords,
  OSINTFinding,
} from './osint.service';
import {
  generateCounterfeitRiskProfile,
  generateNetworkMap,
  generateEnforcementRecommendations,
  CounterfeitRiskProfile,
} from './counterfeit-detector.service';

export interface BrandProtectionResult {
  brand: string;
  category: string;
  country: string;
  type: 'brand_protection';
  niche: string;
  data: {
    headline: string;
    threat_summary: string;
    top_3_hotspots: any[];
    vulnerability_analysis: any;
    counterfeiter_profile: any;
    consumer_insights: any;
    economic_impact: any;
    legal_landscape: any;
    evidence_package: any[];
    countermeasures: any;
    case_studies: any[];
    ceo_summary: string[];
    data_limitations: string[];
    riskProfile: CounterfeitRiskProfile;
    osintFindings: OSINTFinding[];
    platformDistribution: any[];
    keywordAnalysis: any[];
    networkMap: any[];
    recommendations: any;
  };
  markdown: string;
  trend_summary: string;
  trendSource: 'dataforseo' | 'pattern_fallback';
  chart_data: {
    trend_12m: Array<{ month: string; value: number }>;
    platform_distribution: Array<{ platform: string; count: number }>;
    risk_score: number;
  };
}

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

// FIXED: Saudi symbol SAR, not Iranian ﷼
const currencyInfo: Record<string, { symbol: string; locale: string }> = {
  us: { symbol: '$', locale: 'en-US' },
  gb: { symbol: '£', locale: 'en-GB' },
  ca: { symbol: 'C$', locale: 'en-CA' },
  au: { symbol: 'A$', locale: 'en-AU' },
  de: { symbol: '€', locale: 'de-DE' },
  sg: { symbol: 'S$', locale: 'en-SG' },
  sa: { symbol: 'SAR ', locale: 'ar-SA' },
  ae: { symbol: 'AED ', locale: 'ar-AE' },
  pk: { symbol: 'PKR ', locale: 'en-PK' },
  in: { symbol: '₹', locale: 'en-IN' },
  tr: { symbol: 'TRY ', locale: 'tr-TR' },
  my: { symbol: 'RM', locale: 'en-MY' },
};

const safeString = (val: any, fallback: string = 'N/A'): string => {
  if (!val || val === 'undefined' || val === 'null') return fallback;
  return String(val).trim() || fallback;
};

const safeArray = (val: any): any[] => (Array.isArray(val) ? val : []);

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
    try { return JSON.parse(fixed); } catch { throw new Error('AI response is not valid JSON'); }
  }
};

const formatThreatBar = (score: number): string => {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const filled = Math.round(clamped / 5);
  return '█'.repeat(filled) + '░'.repeat(20 - filled);
};

// FIXED: Prevent $180,000/month/month double suffix
function formatImpact(raw: string): string {
  if (!raw) return 'To be validated';
  const s = String(raw).trim();
  if (s.toLowerCase().includes('/month')) return s; // Already has /month, don't add again
  if (s.toLowerCase().includes('month')) return s;
  return `${s}/month`;
}

// FIXED: Format loss - never show fake exact $4,809,255
function formatLoss(riskProfile: CounterfeitRiskProfile, currencySymbol: string): string {
  if (riskProfile.estimatedAnnualLoss === null || riskProfile.estimatedAnnualLoss === undefined) {
    return 'Not calculable - Brand revenue not supplied';
  }
  // Use pre-formatted display from detector service
  return riskProfile.estimatedAnnualLossDisplay || `${currencySymbol}${riskProfile.estimatedAnnualLoss.toLocaleString()} (Modeled)`;
}

export async function generateBrandProtectionReport(
  brand: string,
  category: string,
  country: string,
  brandAnnualRevenue?: number | null
): Promise<BrandProtectionResult> {
  const cacheKey = `bpi_v1_${brand}_${category}_${country}`;
  const cached = cacheService.get<BrandProtectionResult>(cacheKey);
  if (cached) {
    console.log('📦 [Cache] Returning cached Brand Protection report.');
    return cached;
  }

  console.log(`🔍 [BPI] Generating for ${brand} (${category}) in ${country}...`);

  const osintFindings = await collectOSINTFindings(brand, country, 10);
  const platformDist = analyzePlatformDistribution(osintFindings);
  const keywordAnalysis = await analyzeCounterfeitKeywords(brand, country);

  const riskProfile = await generateCounterfeitRiskProfile(
    brand,
    category,
    country,
    osintFindings,
    keywordAnalysis,
    brandAnnualRevenue ?? null
  );

  const networkMap = await generateNetworkMap(osintFindings);
  const recommendations = await generateEnforcementRecommendations(
    brand,
    riskProfile,
    osintFindings
  );

  let trendData: number[] = [];
  let trendSource: 'dataforseo' | 'pattern_fallback' = 'pattern_fallback';

  if (isDataForSEOAvailable()) {
    try {
      const realTrends = await fetchRealTrends([`${brand} replica`], country);
      if (realTrends.length > 0 && realTrends[0].timeline.length > 0) {
        trendData = realTrends[0].timeline.map((t: { value: number }) => t.value);
        trendSource = 'dataforseo';
      }
    } catch {
      /* fallback */
    }
  }

  if (trendData.length === 0) {
    const seed = brand.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    trendData = Array.from({ length: 12 }, (_, i) => {
      const base = 40 + Math.sin(i / 2) * 20 + (seed % 30);
      return Math.max(10, Math.min(100, Math.round(base)));
    });
  }

  const findingsSummary = osintFindings
    .slice(0, 15)
    .map((f, i) => `${i + 1}. [${f.riskLevel}] ${f.platform}: ${f.title} (${f.url})`)
    .join('\n');

  // FIXED PROMPT - Evidence Safe, No fake case studies, No fake legal status, No fake ROI
  const prompt = `You are a senior Brand Protection Intelligence Analyst. Write in a confident, forensic, executive-level tone. Return ONLY valid JSON.

CLIENT: ${brand} (Category: ${category})
TARGET MARKET: ${countryNames[country] || country}
CURRENT YEAR: 2026

PRE-COMPUTED RISK DATA:
- Threat Level: ${riskProfile.threatLevel}
- Risk Score: ${riskProfile.riskScore}/100
- Counterfeit Rate: ${riskProfile.counterfeitRate !== null ? riskProfile.counterfeitRate + '%' : 'To be validated'}
- Estimated Annual Loss: ${formatLoss(riskProfile, '$')}
- Price Undercut: ${riskProfile.priceUndercutRange}

**STRICT EVIDENCE RULES - VIOLATION = REPORT REJECTED**:
1. DO NOT invent case studies. "case_studies" MUST be [] empty array. NEVER invent "Operation Glass House" or seizure numbers.
2. DO NOT claim trademark is "Active registered" unless you have USPTO evidence. Write: "To be verified via USPTO TESS search - Not verified in this scan"
3. DO NOT claim CBP recordation is "Active". Write: "To be verified - Not confirmed in this scan"
4. DO NOT invent exact loss numbers like $4,809,255. Use the pre-computed loss above only.
5. DO NOT invent ROI like 580%. For economic_impact.roi_of_action write: "Not calculable - enforcement cost and recovery data not supplied"
6. DO NOT invent brand equity damage or enforcement cost. Write "To be validated" if not supplied.
7. For top_3_hotspots impact: Write like "$180K/month (Modeled)" - DO NOT add "/month" twice. Just write the amount once.
8. For most_targeted_products: ONLY use products from OSINT findings titles. DO NOT invent "Signature" or "Limited Edition" products.
9. NEVER claim a listing is "verified counterfeit" - only "suspected listing found via OSINT" - test purchase needed for confirmation.

OSINT FINDINGS:
${findingsSummary || 'No OSINT findings collected.'}

PLATFORM DISTRIBUTION:
${platformDist.map((p) => `${p.platform}: ${p.findingsCount} listings (${p.riskLevel})`).join('\n') || 'No platform data.'}

KEYWORD ANALYSIS:
${keywordAnalysis.slice(0, 10).map((k) => `${k.keyword} — Vol: ${k.volume}, CPC: $${k.cpc}, KD: ${k.kd}`).join('\n') || 'No keyword data.'}

RETURN ONLY VALID JSON WITH THIS EXACT STRUCTURE:
{
  "headline": "One-line impact - use rounded modeled estimate, e.g. 'Suspected listings indicate ~$4.8M modeled exposure'",
  "threat_summary": "3-4 sentence executive brief - clearly label modeled vs verified",
  "top_3_hotspots": [
    { "platform": "Platform", "risk": "Critical", "finding": "Specific behavior from OSINT", "impact": "$X/month (Modeled)" }
  ],
  "vulnerability_analysis": {
    "most_targeted_products": [
      { "product": "Product name from OSINT only", "risk_score": 95, "reason": "Why targeted" }
    ],
    "price_undercut_analysis": "2-3 sentences - label as modeled",
    "channel_vulnerability": "2-3 sentences"
  },
  "counterfeiter_profile": {
    "keyword_patterns": ["pattern1", "pattern2", "pattern3", "pattern4", "pattern5"],
    "behavioral_indicators": ["indicator1", "indicator2", "indicator3", "indicator4"],
    "typical_operation": "3-4 sentences - label as suspected pattern, not confirmed"
  },
  "consumer_insights": {
    "purchase_drivers": ["driver1", "driver2", "driver3"],
    "intentional_vs_unintentional": "2-3 sentences - label as modeled estimate",
    "ai_shopping_trend": "2 sentences"
  },
  "economic_impact": {
    "lost_sales": "Use pre-computed loss or 'Not calculable'",
    "brand_equity_damage": "To be validated",
    "enforcement_cost": "To be validated",
    "total_annual_impact": "To be validated - do not sum invented numbers",
    "roi_of_action": "Not calculable - enforcement cost and recovery data not supplied"
  },
  "legal_landscape": {
    "trademark_status": "To be verified via USPTO TESS search - Not verified in this scan",
    "customs_protection": "To be verified - Not confirmed in this scan",
    "jurisdictional_actions": ["Action 1 - subject to legal review", "Action 2", "Action 3"]
  },
  "evidence_package": [],
  "countermeasures": {
    "immediate": [{ "action": "Action", "owner": "Legal", "timeline": "Week 1-2", "expected_impact": "To be validated" }],
    "short_term": [{ "action": "Action", "owner": "Team", "timeline": "Month 1-3", "expected_impact": "To be validated" }],
    "long_term": [{ "action": "Action", "owner": "Executive", "timeline": "Month 4-12", "expected_impact": "To be validated" }]
  },
  "case_studies": [],
  "ceo_summary": ["Point 1 - label modeled", "Point 2", "Point 3"],
  "data_limitations": ["Limitation 1", "Limitation 2", "Limitation 3 - test purchase needed to confirm counterfeit"]
}`;

  const aiResponse = await runGroqWithRetry(
    prompt,
    JSON.stringify({ brand, category, country })
  );
  const analysis = extractJSON(aiResponse);

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const reference = `BPI-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const currency = currencyInfo[country] || currencyInfo.us;

  let markdown = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MusePRO
Brand Protection Intelligence Division
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                COUNTERFEIT INTELLIGENCE REPORT

Prepared For:      ${brand}
Category:          ${category}
Date:              ${today}
Reference:         ${reference}
Classification:    CONFIDENTIAL

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HEADLINE:
"${safeString(analysis.headline, `Suspected counterfeit listings detected across ${platformDist.length} platforms - verification via test purchase required.`)}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. THREAT DASHBOARD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌────────────────────────────────────────────────────────────────────┐
│  THREAT LEVEL          ${formatThreatBar(riskProfile.riskScore)}  ${riskProfile.riskScore}/100  │
│                        ${riskProfile.threatLevel.toUpperCase()}                          │
├────────────────────────────────────────────────────────────────────┤
│  Counterfeit Rate      ${riskProfile.counterfeitRate !== null ? riskProfile.counterfeitRate + '%' : 'To be validated'}                                       │
│  Price Undercut        ${riskProfile.priceUndercutRange}                              │
│  Est. Annual Loss      ${formatLoss(riskProfile, currency.symbol)}                                │
│  OSINT Findings        ${osintFindings.length} suspected listings (not confirmed counterfeit)                       │
│  Platforms Affected    ${platformDist.length}                                            │
└────────────────────────────────────────────────────────────────────┘

2. EXECUTIVE THREAT BRIEF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${safeString(analysis.threat_summary)}

🎯 TOP 3 HOTSPOTS

`;

  safeArray(analysis.top_3_hotspots).forEach((h: any, i: number) => {
    markdown += `┌──────────────────────────────────────────────────────────────────┐\n`;
    markdown += `│ #${i + 1} — ${safeString(h.platform)} [${safeString(h.risk)}]\n`;
    markdown += `├──────────────────────────────────────────────────────────────────┤\n`;
    markdown += `│ Finding: ${safeString(h.finding)}\n`;
    // FIXED: No double /month
    markdown += `│ Impact:  ${formatImpact(safeString(h.impact))}\n`;
    markdown += `└──────────────────────────────────────────────────────────────────┘\n\n`;
  });

  markdown += `3. BRAND VULNERABILITY ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 MOST TARGETED PRODUCTS

`;
  const products = safeArray(analysis.vulnerability_analysis?.most_targeted_products);
  if (products.length === 0) {
    markdown += `  • No specific products confirmed - based on OSINT titles only, test purchase required.\n`;
  } else {
    products.forEach((p: any) => {
      markdown += `  • ${safeString(p.product)} — Risk ${p.risk_score}/100 — ${safeString(p.reason)}\n`;
    });
  }

  markdown += `\n💰 PRICE UNDERCUT ANALYSIS\n${safeString(analysis.vulnerability_analysis?.price_undercut_analysis)}\n\n`;
  markdown += `📡 CHANNEL VULNERABILITY\n${safeString(analysis.vulnerability_analysis?.channel_vulnerability)}\n\n`;

  markdown += `4. COUNTERFEITER OSINT PROFILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔑 KEYWORD PATTERNS
`;
  safeArray(analysis.counterfeiter_profile?.keyword_patterns).forEach((k: string) => {
    markdown += `  • ${k}\n`;
  });

  markdown += `\n🚩 BEHAVIORAL INDICATORS\n`;
  safeArray(analysis.counterfeiter_profile?.behavioral_indicators).forEach((b: string) => {
    markdown += `  • ${b}\n`;
  });

  markdown += `\n📖 TYPICAL OPERATION (Suspected Pattern)\n${safeString(analysis.counterfeiter_profile?.typical_operation)}\n\n`;

  markdown += `5. PLATFORM DISTRIBUTION MAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  if (platformDist.length > 0) {
    markdown += `| Platform | Domain | Findings | Risk Level |\n|---|---|---|---|\n`;
    platformDist.forEach((p: any) => {
      markdown += `| ${p.platform} | ${p.domain} | ${p.findingsCount} | ${p.riskLevel} |\n`;
    });
  } else {
    markdown += `No platform data collected.\n`;
  }

  markdown += `\n6. CONSUMER INSIGHTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🛒 PURCHASE DRIVERS
`;
  safeArray(analysis.consumer_insights?.purchase_drivers).forEach((d: string) => {
    markdown += `  • ${d}\n`;
  });

  markdown += `\n🧠 INTENTIONAL VS UNINTENTIONAL\n${safeString(analysis.consumer_insights?.intentional_vs_unintentional)}\n\n`;
  markdown += `🤖 AI SHOPPING TREND\n${safeString(analysis.consumer_insights?.ai_shopping_trend)}\n\n`;

  markdown += `7. ECONOMIC IMPACT QUANTIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  const impact = analysis.economic_impact || {};
  markdown += `  💰 Lost Sales:              ${safeString(impact.lost_sales, formatLoss(riskProfile, currency.symbol))}\n`;
  markdown += `  💔 Brand Equity Damage:     ${safeString(impact.brand_equity_damage, 'To be validated')}\n`;
  markdown += `  ⚖️  Enforcement Cost:        ${safeString(impact.enforcement_cost, 'To be validated')}\n`;
  markdown += `  ───────────────────────────────────\n`;
  markdown += `  📊 TOTAL ANNUAL IMPACT:     ${safeString(impact.total_annual_impact, 'To be validated - do not sum invented numbers')}\n`;
  markdown += `  ✅ ROI OF ACTION:           ${safeString(impact.roi_of_action, 'Not calculable - enforcement cost and recovery data not supplied')}\n\n`;

  markdown += `8. LEGAL & ENFORCEMENT LANDSCAPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📜 TRADEMARK STATUS
${safeString(analysis.legal_landscape?.trademark_status, 'To be verified via USPTO TESS search - Not verified in this scan')}

🛃 CUSTOMS PROTECTION
${safeString(analysis.legal_landscape?.customs_protection, 'To be verified - Not confirmed in this scan')}

⚖️ RECOMMENDED JURISDICTIONAL ACTIONS (Subject to Legal Review)
`;
  safeArray(analysis.legal_landscape?.jurisdictional_actions).forEach((a: string, i: number) => {
    markdown += `  ${i + 1}. ${a}\n`;
  });

  markdown += `\n9. OSINT EVIDENCE PACKAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  if (osintFindings.length > 0) {
    markdown += `| # | Platform | Title | URL | Risk | Timestamp |\n|---|---|---|---|---|---|\n`;
    osintFindings.slice(0, 15).forEach((f, i) => {
      // Show full URL, not truncated google goto - already cleaned in osint.service
      markdown += `| ${i + 1} | ${f.platform} | ${f.title.substring(0, 40)}... | ${f.url} | ${f.riskLevel} | ${f.timestamp.substring(0, 10)} |\n`;
    });
    markdown += `\nNote: Listings are SUSPECTED based on OSINT signals. Confirmation requires test purchase and forensic analysis.\n`;
  } else {
    markdown += `No verified OSINT findings available.\n`;
  }

  markdown += `\n10. COUNTERMEASURE RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 IMMEDIATE (Week 1-2)
`;
  safeArray(analysis.countermeasures?.immediate).forEach((a: any, i: number) => {
    markdown += `${i + 1}. ${safeString(a.action)}\n`;
    markdown += `   Owner: ${safeString(a.owner)} | Timeline: ${safeString(a.timeline)} | Impact: ${safeString(a.expected_impact, 'To be validated')}\n\n`;
  });

  markdown += `🟡 SHORT-TERM (Month 1-3)\n`;
  safeArray(analysis.countermeasures?.short_term).forEach((a: any, i: number) => {
    markdown += `${i + 1}. ${safeString(a.action)}\n`;
    markdown += `   Owner: ${safeString(a.owner)} | Timeline: ${safeString(a.timeline)} | Impact: ${safeString(a.expected_impact, 'To be validated')}\n\n`;
  });

  markdown += `🟢 LONG-TERM (Month 4-12)\n`;
  safeArray(analysis.countermeasures?.long_term).forEach((a: any, i: number) => {
    markdown += `${i + 1}. ${safeString(a.action)}\n`;
    markdown += `   Owner: ${safeString(a.owner)} | Timeline: ${safeString(a.timeline)} | Impact: ${safeString(a.expected_impact, 'To be validated')}\n\n`;
  });

  markdown += `11. CASE STUDIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  const caseStudies = safeArray(analysis.case_studies).filter((cs: any) => cs.title && cs.title !== 'N/A');
  if (caseStudies.length === 0) {
    markdown += `No verified enforcement case studies available. Case studies will be added only with permissioned client data, dated enforcement records, and legal approval.\n\n`;
  } else {
    caseStudies.forEach((cs: any, i: number) => {
      markdown += `CASE STUDY ${String(i + 1).padStart(2, '0')}: ${safeString(cs.title)}\n`;
      markdown += `  Challenge: ${safeString(cs.challenge)}\n`;
      markdown += `  Solution: ${safeString(cs.solution)}\n`;
      markdown += `  Results: ${safeString(cs.results)}\n\n`;
    });
  }

  markdown += `12. CEO SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  safeArray(analysis.ceo_summary).forEach((p: string, i: number) => {
    markdown += `  ${i + 1}. ${p}\n`;
  });

  markdown += `\n13. APPENDIX: METHODOLOGY & DATA LIMITATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📖 METHODOLOGY
This report combines OSINT (Open Source Intelligence) collection, AI-powered risk scoring,
${trendSource === 'dataforseo' ? 'DataForSEO keyword analysis (live)' : 'modeled keyword estimates'},
and forensic network mapping. Listings are SUSPECTED, not confirmed counterfeit, unless verified by test purchase.

📡 DATA SOURCES
• OSINT Collection: SerpAPI / ScraperAPI / SerperAPI (google redirect links filtered)
• Trend Data: ${trendSource === 'dataforseo' ? 'DataForSEO Google Trends (Live)' : 'Pattern-Based (Modeled) - To be validated'}
• Platform Analysis: MusePRO Proprietary Database
• Risk Scoring: MusePRO Counterfeit Detection Engine

⚠️ DATA LIMITATIONS
`;
  const limitations = safeArray(analysis.data_limitations);
  if (limitations.length > 0) {
    limitations.forEach((d: string, i: number) => {
      markdown += `  ${i + 1}. ${d}\n`;
    });
  } else {
    markdown += `  1. Private messaging channels (Telegram, encrypted chats) remain unquantified.\n`;
    markdown += `  2. Physical offline distribution excluded from digital telemetry.\n`;
    markdown += `  3. Confirmation of counterfeit status requires test purchase and forensic analysis.\n`;
  }

  markdown += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ DISCLAIMER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This report is for informational and brand protection purposes only.
Listings are SUSPECTED based on OSINT signals and are not confirmed counterfeit
unless verified by test purchase. All monetary values marked "Modeled" are
estimates, not verified losses. This report does not constitute legal advice.
Consult qualified IP attorneys before initiating enforcement actions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by MusePRO Brand Protection Intelligence Division.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  const result: BrandProtectionResult = {
    brand,
    category,
    country,
    type: 'brand_protection',
    niche: `${brand} — ${category}`,
    data: {
      ...analysis,
      case_studies: caseStudies,
      riskProfile,
      osintFindings: osintFindings.slice(0, 20),
      platformDistribution: platformDist,
      keywordAnalysis: keywordAnalysis.slice(0, 15),
      networkMap,
      recommendations,
    },
    markdown,
    trend_summary: safeString(analysis.threat_summary),
    trendSource,
    chart_data: {
      trend_12m: trendData.slice(0, 12).map((v, i) => ({ month: `M${i + 1}`, value: v })),
      platform_distribution: platformDist.map((p) => ({
        platform: p.platform,
        count: p.findingsCount,
      })),
      risk_score: riskProfile.riskScore,
    },
  };

  cacheService.set(cacheKey, result, 86400);
  return result;
}
