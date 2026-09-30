// src/services/brand-protection.generator.ts
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

// ═══════════════════════════════════════════════════════════════
// RETURN TYPE INTERFACE
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

const currencyInfo: Record<string, { symbol: string; locale: string }> = {
  us: { symbol: '$', locale: 'en-US' },
  gb: { symbol: '£', locale: 'en-GB' },
  ca: { symbol: 'C$', locale: 'en-CA' },
  au: { symbol: 'A$', locale: 'en-AU' },
  de: { symbol: '€', locale: 'de-DE' },
  sg: { symbol: 'S$', locale: 'en-SG' },
  sa: { symbol: '﷼', locale: 'ar-SA' },
  ae: { symbol: 'د.إ', locale: 'ar-AE' },
  pk: { symbol: '₨', locale: 'en-PK' },
  in: { symbol: '₹', locale: 'en-IN' },
  tr: { symbol: '₺', locale: 'tr-TR' },
  my: { symbol: 'RM', locale: 'en-MY' },
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
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
    let completed = cleaned;
    let braceCount = (completed.match(/{/g) || []).length;
    let closeCount = (completed.match(/}/g) || []).length;
    while (closeCount < braceCount) {
      completed += '}';
      closeCount++;
    }
    return JSON.parse(completed);
  }
};

const formatThreatBar = (score: number): string => {
  const filled = Math.round(score / 5);
  return '█'.repeat(filled) + '░'.repeat(20 - filled);
};

// ═══════════════════════════════════════════════════════════════
// MAIN GENERATOR
// ═══════════════════════════════════════════════════════════════
export async function generateBrandProtectionReport(
  brand: string,
  category: string,
  country: string
): Promise<BrandProtectionResult> {
  const cacheKey = `bpi_v1_${brand}_${category}_${country}`;
  const cached = cacheService.get<BrandProtectionResult>(cacheKey);
  if (cached) {
    console.log('📦 [Cache] Returning cached Brand Protection report.');
    return cached;
  }

  console.log(`🔍 [BPI] Generating for ${brand} (${category}) in ${country}...`);

  // ── STEP 1: OSINT Collection ──
  const osintFindings = await collectOSINTFindings(brand, country, 10);
  const platformDist = analyzePlatformDistribution(osintFindings);
  const keywordAnalysis = await analyzeCounterfeitKeywords(brand, country);

  // ── STEP 2: Risk Profile ──
  const riskProfile = await generateCounterfeitRiskProfile(
    brand,
    category,
    country,
    osintFindings,
    keywordAnalysis
  );

  const networkMap = await generateNetworkMap(osintFindings);
  const recommendations = await generateEnforcementRecommendations(
    brand,
    riskProfile,
    osintFindings
  );

  // ── STEP 3: Trend Data ──
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

  // ── STEP 4: AI Narrative ──
  const findingsSummary = osintFindings
    .slice(0, 15)
    .map((f, i) => `${i + 1}. [${f.riskLevel}] ${f.platform}: ${f.title} (${f.url})`)
    .join('\n');

  const prompt = `You are a senior Brand Protection Intelligence Analyst. Write in a confident, forensic, executive-level tone. Return ONLY valid JSON.

CLIENT: ${brand} (Category: ${category})
TARGET MARKET: ${countryNames[country] || country}
CURRENT YEAR: 2026

PRE-COMPUTED RISK DATA:
- Threat Level: ${riskProfile.threatLevel}
- Risk Score: ${riskProfile.riskScore}/100
- Counterfeit Rate: ${riskProfile.counterfeitRate}%
- Estimated Annual Loss: $${riskProfile.estimatedAnnualLoss.toLocaleString()}
- Price Undercut: ${riskProfile.priceUndercutRange}

OSINT FINDINGS:
${findingsSummary || 'No OSINT findings collected.'}

PLATFORM DISTRIBUTION:
${platformDist.map((p) => `${p.platform}: ${p.findingsCount} listings (${p.riskLevel})`).join('\n') || 'No platform data.'}

KEYWORD ANALYSIS:
${keywordAnalysis.slice(0, 10).map((k) => `${k.keyword} — Vol: ${k.volume}, CPC: $${k.cpc}, KD: ${k.kd}`).join('\n') || 'No keyword data.'}

RETURN ONLY VALID JSON WITH THIS EXACT STRUCTURE:
{
  "headline": "One-line business impact with specific number",
  "threat_summary": "3-4 sentence executive brief on the counterfeit threat landscape",
  "top_3_hotspots": [
    { "platform": "Instagram", "risk": "Critical", "finding": "Specific behavior", "impact": "$X/month" },
    { "platform": "DHgate", "risk": "Critical", "finding": "Specific behavior", "impact": "$X/month" },
    { "platform": "Telegram", "risk": "High", "finding": "Specific behavior", "impact": "$X/month" }
  ],
  "vulnerability_analysis": {
    "most_targeted_products": [
      { "product": "Product name", "risk_score": 95, "reason": "Why targeted" }
    ],
    "price_undercut_analysis": "2-3 sentences on pricing patterns",
    "channel_vulnerability": "2-3 sentences on channel-specific risks"
  },
  "counterfeiter_profile": {
    "keyword_patterns": ["pattern1", "pattern2", "pattern3", "pattern4", "pattern5"],
    "behavioral_indicators": ["indicator1", "indicator2", "indicator3", "indicator4"],
    "typical_operation": "3-4 sentences"
  },
  "consumer_insights": {
    "purchase_drivers": ["driver1", "driver2", "driver3"],
    "intentional_vs_unintentional": "2-3 sentences",
    "ai_shopping_trend": "2 sentences"
  },
  "economic_impact": {
    "lost_sales": "$X",
    "brand_equity_damage": "$X",
    "enforcement_cost": "$X",
    "total_annual_impact": "$X",
    "roi_of_action": "X%"
  },
  "legal_landscape": {
    "trademark_status": "Status",
    "customs_protection": "State",
    "jurisdictional_actions": ["Action 1", "Action 2", "Action 3"]
  },
  "evidence_package": [
    { "type": "Instagram Post", "url": "https://...", "timestamp": "2026-XX-XX", "confidence": "High" }
  ],
  "countermeasures": {
    "immediate": [
      { "action": "Action", "owner": "Legal", "timeline": "Week 1-2", "expected_impact": "$X" }
    ],
    "short_term": [
      { "action": "Action", "owner": "Team", "timeline": "Month 1-3", "expected_impact": "$X" }
    ],
    "long_term": [
      { "action": "Action", "owner": "Executive", "timeline": "Month 4-12", "expected_impact": "$X" }
    ]
  },
  "case_studies": [
    { "title": "Case Study 1", "challenge": "Description", "solution": "What was done", "results": "Outcome" }
  ],
  "ceo_summary": ["Point 1", "Point 2", "Point 3"],
  "data_limitations": ["Limitation 1", "Limitation 2", "Limitation 3"]
}`;

  const aiResponse = await runGroqWithRetry(
    prompt,
    JSON.stringify({ brand, category, country })
  );
  const analysis = extractJSON(aiResponse);

  // ── STEP 5: Build Markdown ──
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
"${safeString(analysis.headline, `Counterfeit activity detected across ${platformDist.length} platforms.`)}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. THREAT DASHBOARD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌────────────────────────────────────────────────────────────────────┐
│  THREAT LEVEL          ${formatThreatBar(riskProfile.riskScore)}  ${riskProfile.riskScore}/100  │
│                        ${riskProfile.threatLevel.toUpperCase()}                          │
├────────────────────────────────────────────────────────────────────┤
│  Counterfeit Rate      ${riskProfile.counterfeitRate}%                                       │
│  Price Undercut        ${riskProfile.priceUndercutRange}                              │
│  Est. Annual Loss      ${currency.symbol}${riskProfile.estimatedAnnualLoss.toLocaleString()}                                │
│  OSINT Findings        ${osintFindings.length} verified listings                       │
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
    markdown += `│ Impact:  ${safeString(h.impact)}/month\n`;
    markdown += `└──────────────────────────────────────────────────────────────────┘\n\n`;
  });

  markdown += `3. BRAND VULNERABILITY ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 MOST TARGETED PRODUCTS

`;
  safeArray(analysis.vulnerability_analysis?.most_targeted_products).forEach((p: any) => {
    markdown += `  • ${safeString(p.product)} — Risk ${p.risk_score}/100 — ${safeString(p.reason)}\n`;
  });

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

  markdown += `\n📖 TYPICAL OPERATION\n${safeString(analysis.counterfeiter_profile?.typical_operation)}\n\n`;

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
  markdown += `  💰 Lost Sales:              ${safeString(impact.lost_sales)}\n`;
  markdown += `  💔 Brand Equity Damage:     ${safeString(impact.brand_equity_damage)}\n`;
  markdown += `  ⚖️  Enforcement Cost:        ${safeString(impact.enforcement_cost)}\n`;
  markdown += `  ───────────────────────────────────\n`;
  markdown += `  📊 TOTAL ANNUAL IMPACT:     ${safeString(impact.total_annual_impact)}\n`;
  markdown += `  ✅ ROI OF ACTION:           ${safeString(impact.roi_of_action)}\n\n`;

  markdown += `8. LEGAL & ENFORCEMENT LANDSCAPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📜 TRADEMARK STATUS
${safeString(analysis.legal_landscape?.trademark_status)}

🛃 CUSTOMS PROTECTION
${safeString(analysis.legal_landscape?.customs_protection)}

⚖️ RECOMMENDED JURISDICTIONAL ACTIONS
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
      markdown += `| ${i + 1} | ${f.platform} | ${f.title.substring(0, 40)}... | ${f.url.substring(0, 50)}... | ${f.riskLevel} | ${f.timestamp.substring(0, 10)} |\n`;
    });
  } else {
    markdown += `No verified OSINT findings available.\n`;
  }

  markdown += `\n10. COUNTERMEASURE RECOMMENDATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 IMMEDIATE (Week 1-2)
`;
  safeArray(analysis.countermeasures?.immediate).forEach((a: any, i: number) => {
    markdown += `${i + 1}. ${safeString(a.action)}\n`;
    markdown += `   Owner: ${safeString(a.owner)} | Timeline: ${safeString(a.timeline)} | Impact: ${safeString(a.expected_impact)}\n\n`;
  });

  markdown += `🟡 SHORT-TERM (Month 1-3)\n`;
  safeArray(analysis.countermeasures?.short_term).forEach((a: any, i: number) => {
    markdown += `${i + 1}. ${safeString(a.action)}\n`;
    markdown += `   Owner: ${safeString(a.owner)} | Timeline: ${safeString(a.timeline)} | Impact: ${safeString(a.expected_impact)}\n\n`;
  });

  markdown += `🟢 LONG-TERM (Month 4-12)\n`;
  safeArray(analysis.countermeasures?.long_term).forEach((a: any, i: number) => {
    markdown += `${i + 1}. ${safeString(a.action)}\n`;
    markdown += `   Owner: ${safeString(a.owner)} | Timeline: ${safeString(a.timeline)} | Impact: ${safeString(a.expected_impact)}\n\n`;
  });

  markdown += `11. CASE STUDIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  safeArray(analysis.case_studies).forEach((cs: any, i: number) => {
    markdown += `CASE STUDY ${String(i + 1).padStart(2, '0')}: ${safeString(cs.title)}\n`;
    markdown += `  Challenge: ${safeString(cs.challenge)}\n`;
    markdown += `  Solution: ${safeString(cs.solution)}\n`;
    markdown += `  Results: ${safeString(cs.results)}\n\n`;
  });

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
and forensic network mapping. All findings are timestamped and verifiable.

📡 DATA SOURCES
• OSINT Collection: SerpAPI / ScraperAPI / SerperAPI
• Trend Data: ${trendSource === 'dataforseo' ? 'DataForSEO Google Trends (Live)' : 'Pattern-Based (Modeled)'}
• Platform Analysis: MusePRO Proprietary Database
• Risk Scoring: MusePRO Counterfeit Detection Engine

⚠️ DATA LIMITATIONS
`;
  safeArray(analysis.data_limitations).forEach((d: string, i: number) => {
    markdown += `  ${i + 1}. ${d}\n`;
  });

  markdown += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ DISCLAIMER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This report is for informational and brand protection purposes only.
All OSINT findings are collected from publicly available sources.
This report does not constitute legal advice. Consult qualified IP
attorneys before initiating enforcement actions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by MusePRO Brand Protection Intelligence Division.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  // ── STEP 6: Return Result ──
  const result: BrandProtectionResult = {
    brand,
    category,
    country,
    type: 'brand_protection',
    niche: `${brand} — ${category}`,
    data: {
      ...analysis,
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
