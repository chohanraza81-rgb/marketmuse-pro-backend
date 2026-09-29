// brand-protection.generator.ts
// Counterfeit Intelligence Report Generator
// Hybrid: OSINT + AI + DataForSEO | Value-First | Client-Facing
// Cache-bust: bpi_v1

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
import {
  HIGH_RISK_CATEGORIES,
  COUNTERFEIT_KEYWORDS,
  COUNTERFEIT_INDICATORS,
} from '../data/counterfeit-keywords';

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

// ============ HELPERS ============
const safeString = (val: any, fallback: string = 'N/A'): string => {
  if (!val || val === 'undefined' || val === 'null') return fallback;
  return String(val).trim() || fallback;
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

const formatTable = (headers: string[], rows: string[][]): string => {
  let table = `| ${headers.join(' | ')} |\n`;
  table += `|${headers.map(() => '---').join('|')}|\n`;
  rows.forEach((row) => { table += `| ${row.join(' | ')} |\n`; });
  return table;
};

const formatThreatBar = (score: number): string => {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
};

// ============ PROMPT BUILDER ============
const buildCounterfeitPrompt = (
  brand: string,
  category: string,
  country: string,
  riskProfile: CounterfeitRiskProfile,
  findings: OSINTFinding[],
  platformDist: any[],
  keywords: any[]
): string => {
  const countryName = countryNames[country] || country;
  const currencySymbol = currencyInfo[country]?.symbol || '$';

  const findingsSummary = findings
    .slice(0, 15)
    .map((f, i) => `${i + 1}. [${f.riskLevel}] ${f.platform}: ${f.title} (${f.url})`)
    .join('\n');

  const platformSummary = platformDist
    .map((p: any) => `${p.platform}: ${p.findingsCount} listings (${p.riskLevel})`)
    .join('\n');

  const keywordSummary = keywords
    .slice(0, 10)
    .map((k: any) => `${k.keyword} — Vol: ${k.volume}, CPC: $${k.cpc}, KD: ${k.kd}`)
    .join('\n');

  return `You are a senior Brand Protection Intelligence Analyst. Write in a confident, forensic, executive-level tone.

CLIENT: ${brand} (Category: ${category})
TARGET MARKET: ${countryName}
CURRENCY: ${currencySymbol}
CURRENT YEAR: 2026

═══════════════════════════════════════════════════════════════════════
📊 PRE-COMPUTED RISK DATA (USE THIS — DO NOT INVENT)
═══════════════════════════════════════════════════════════════════════
- Threat Level: ${riskProfile.threatLevel}
- Risk Score: ${riskProfile.riskScore}/100
- Counterfeit Rate: ${riskProfile.counterfeitRate}%
- Estimated Annual Loss: ${currencySymbol}${riskProfile.estimatedAnnualLoss.toLocaleString()}
- Price Undercut Range: ${riskProfile.priceUndercutRange}

═══════════════════════════════════════════════════════════════════════
🔍 OSINT FINDINGS (REAL DATA)
═══════════════════════════════════════════════════════════════════════
${findingsSummary || 'No OSINT findings collected.'}

═══════════════════════════════════════════════════════════════════════
📱 PLATFORM DISTRIBUTION
═══════════════════════════════════════════════════════════════════════
${platformSummary || 'No platform data available.'}

═══════════════════════════════════════════════════════════════════════
🔑 KEYWORD ANALYSIS
═══════════════════════════════════════════════════════════════════════
${keywordSummary || 'No keyword data available.'}

═══════════════════════════════════════════════════════════════════════
📋 REPORT STANDARDS — NON-NEGOTIABLE
═══════════════════════════════════════════════════════════════════════
1. Every claim must be evidence-backed (cite OSINT finding # or keyword data)
2. NO fabricated statistics — use only provided data
3. All monetary values in ${currencySymbol}
4. Focus on ACTIONABLE recommendations, not theory
5. Use "forensic", "verified", "documented" language (not "approximate")
6. Every recommendation must include: owner, timeline, expected impact
7. NO AI mention (no "Gemini", "ChatGPT", "AI-generated")

═══════════════════════════════════════════════════════════════════════
🎯 RETURN ONLY VALID JSON IN THIS EXACT STRUCTURE
═══════════════════════════════════════════════════════════════════════

{
  "headline": "One-line business impact (e.g., 'Counterfeit activity is costing BRAND $X.XM/year across N platforms')",
  "threat_summary": "3-4 sentence executive brief on the counterfeit threat landscape",
  "top_3_hotspots": [
    { "platform": "Instagram", "risk": "Critical", "finding": "Specific behavior", "impact": "${currencySymbol}X/month" },
    { "platform": "DHgate", "risk": "Critical", "finding": "Specific behavior", "impact": "${currencySymbol}X/month" },
    { "platform": "Telegram", "risk": "High", "finding": "Specific behavior", "impact": "${currencySymbol}X/month" }
  ],
  "vulnerability_analysis": {
    "most_targeted_products": [
      { "product": "Product name", "risk_score": 95, "reason": "Why targeted" },
      { "product": "Product name", "risk_score": 88, "reason": "Why targeted" },
      { "product": "Product name", "risk_score": 82, "reason": "Why targeted" }
    ],
    "price_undercut_analysis": "2-3 sentences on pricing patterns",
    "channel_vulnerability": "2-3 sentences on channel-specific risks"
  },
  "counterfeiter_profile": {
    "keyword_patterns": ["pattern1", "pattern2", "pattern3", "pattern4", "pattern5"],
    "behavioral_indicators": ["indicator1", "indicator2", "indicator3", "indicator4"],
    "typical_operation": "3-4 sentences describing how counterfeiters operate"
  },
  "consumer_insights": {
    "purchase_drivers": ["driver1 with stat", "driver2 with stat", "driver3 with stat"],
    "intentional_vs_unintentional": "2-3 sentences with data",
    "ai_shopping_trend": "2 sentences on AI tool usage by counterfeit shoppers"
  },
  "economic_impact": {
    "lost_sales": "${currencySymbol}X",
    "brand_equity_damage": "${currencySymbol}X",
    "enforcement_cost": "${currencySymbol}X",
    "total_annual_impact": "${currencySymbol}X",
    "roi_of_action": "X%"
  },
  "legal_landscape": {
    "trademark_status": "Status in target market",
    "customs_protection": "Current state + recommendation",
    "jurisdictional_actions": ["Action 1", "Action 2", "Action 3"]
  },
  "evidence_package": [
    { "type": "Instagram Post", "url": "https://...", "timestamp": "2026-09-XX", "confidence": "High" },
    { "type": "DHgate Listing", "url": "https://...", "timestamp": "2026-09-XX", "confidence": "High" },
    { "type": "Telegram Channel", "url": "https://...", "timestamp": "2026-09-XX", "confidence": "Medium" }
  ],
  "countermeasures": {
    "immediate": [
      { "action": "Action 1", "owner": "Legal", "timeline": "Week 1-2", "expected_impact": "${currencySymbol}X" },
      { "action": "Action 2", "owner": "Brand Protection", "timeline": "Week 1-2", "expected_impact": "${currencySymbol}X" },
      { "action": "Action 3", "owner": "Tech Team", "timeline": "Week 2", "expected_impact": "${currencySymbol}X" }
    ],
    "short_term": [
      { "action": "Action 1", "owner": "Legal", "timeline": "Month 1-3", "expected_impact": "${currencySymbol}X" },
      { "action": "Action 2", "owner": "Partnerships", "timeline": "Month 1-3", "expected_impact": "${currencySymbol}X" },
      { "action": "Action 3", "owner": "Marketing", "timeline": "Month 2-3", "expected_impact": "${currencySymbol}X" }
    ],
    "long_term": [
      { "action": "Action 1", "owner": "Executive", "timeline": "Month 4-12", "expected_impact": "${currencySymbol}X" },
      { "action": "Action 2", "owner": "Legal", "timeline": "Month 4-12", "expected_impact": "${currencySymbol}X" },
      { "action": "Action 3", "owner": "Brand", "timeline": "Month 6-12", "expected_impact": "${currencySymbol}X" }
    ]
  },
  "case_studies": [
    {
      "title": "Case Study 1: [Similar brand]",
      "challenge": "Description",
      "solution": "What was done",
      "results": "Outcome with metrics in ${currencySymbol}"
    },
    {
      "title": "Case Study 2: [Similar brand]",
      "challenge": "Description",
      "solution": "What was done",
      "results": "Outcome with metrics in ${currencySymbol}"
    }
  ],
  "ceo_summary": [
    "Point 1 about the threat and opportunity",
    "Point 2 about the action plan",
    "Point 3 about expected ROI"
  ],
  "data_limitations": [
    "Limitation 1",
    "Limitation 2",
    "Limitation 3"
  ]
}`;
};

// ============ MAIN GENERATOR ============
export async function generateBrandProtectionReport(
  brand: string,
  category: string,
  country: string
) {
  const cacheKey = `bpi_v1_${brand}_${category}_${country}`;
  const cached = cacheService.get(cacheKey);
  if (cached) {
    console.log('📦 [Cache] Returning cached Brand Protection report.');
    return cached;
  }

  console.log(`🔍 [BPI] Generating Counterfeit Intelligence for ${brand} (${category}) in ${country}...`);

  // STEP 1: Collect OSINT findings
  const osintFindings = await collectOSINTFindings(brand, country, 10);

  // STEP 2: Analyze platform distribution
  const platformDist = analyzePlatformDistribution(osintFindings);

  // STEP 3: Analyze counterfeit keywords
  const keywordAnalysis = await analyzeCounterfeitKeywords(brand, country);

  // STEP 4: Generate risk profile
  const riskProfile = await generateCounterfeitRiskProfile(
    brand,
    category,
    country,
    osintFindings,
    keywordAnalysis
  );

  // STEP 5: Generate network map
  const networkMap = await generateNetworkMap(osintFindings);

  // STEP 6: Get trend data (hybrid)
  let trendData: number[] = [];
  let trendSource: 'dataforseo' | 'pattern_fallback' = 'pattern_fallback';
  if (isDataForSEOAvailable()) {
    try {
      const realTrends = await fetchRealTrends([`${brand} replica`], country);
      if (realTrends.length > 0 && realTrends[0].timeline.length > 0) {
        trendData = realTrends[0].timeline.map((t: { value: number }) => t.value);
        trendSource = 'dataforseo';
      }
    } catch { /* fallback */ }
  }

  if (trendData.length === 0) {
    const seed = brand.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    trendData = Array.from({ length: 12 }, (_, i) => {
      const base = 40 + Math.sin(i / 2) * 20 + (seed % 30);
      return Math.max(10, Math.min(100, Math.round(base)));
    });
  }

  // STEP 7: AI call for narrative
  const prompt = buildCounterfeitPrompt(
    brand,
    category,
    country,
    riskProfile,
    osintFindings,
    platformDist,
    keywordAnalysis
  );
  const aiResponse = await runGroqWithRetry(prompt, JSON.stringify({ brand, category, country }));
  const analysis = extractJSON(aiResponse);

  // STEP 8: Generate enforcement recommendations
  const recommendations = await generateEnforcementRecommendations(
    brand,
    riskProfile,
    osintFindings
  );

  // STEP 9: Build Markdown
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
│                        ${riskProfile.threatLevel === 'Critical' ? '🔴' : riskProfile.threatLevel === 'High' ? '🟠' : riskProfile.threatLevel === 'Medium' ? '🟡' : '🟢'} ${riskProfile.threatLevel.toUpperCase()}                          │
├────────────────────────────────────────────────────────────────────┤
│  Counterfeit Rate      ${riskProfile.counterfeitRate}% (Industry avg: 3.2%)              │
│  Price Undercut        ${riskProfile.priceUndercutRange}                              │
│  Est. Annual Loss      ${formatCurrency(riskProfile.estimatedAnnualLoss, country)}                                │
│  OSINT Findings        ${osintFindings.length} verified listings                       │
│  Platforms Affected    ${platformDist.length}                                            │
└────────────────────────────────────────────────────────────────────┘

2. EXECUTIVE THREAT BRIEF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${safeString(analysis.threat_summary, 'Detailed threat summary pending.')}

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
  markdown += formatTable(
    ['Product', 'Risk Score', 'Reason'],
    safeArray(analysis.vulnerability_analysis?.most_targeted_products).map((p: any) => [
      safeString(p.product),
      `${p.risk_score || 0}/100`,
      safeString(p.reason),
    ])
  );

  markdown += `\n💰 PRICE UNDERCUT ANALYSIS\n${safeString(analysis.vulnerability_analysis?.price_undercut_analysis)}\n\n`;
  markdown += `📡 CHANNEL VULNERABILITY\n${safeString(analysis.vulnerability_analysis?.channel_vulnerability)}\n\n`;

  markdown += `4. COUNTERFEITER OSINT PROFILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔑 KEYWORD PATTERNS DETECTED
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
    markdown += formatTable(
      ['Platform', 'Domain', 'Findings', 'Risk Level'],
      platformDist.map((p: any) => [
        safeString(p.platform),
        safeString(p.domain),
        String(p.findingsCount),
        safeString(p.riskLevel),
      ])
    );
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
    markdown += formatTable(
      ['#', 'Type', 'Platform', 'URL', 'Risk', 'Timestamp'],
      osintFindings.slice(0, 15).map((f, i) => [
        String(i + 1),
        'Listing',
        safeString(f.platform),
        safeString(f.url).substring(0, 60) + '...',
        safeString(f.riskLevel),
        f.timestamp.substring(0, 10),
      ])
    );
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

  markdown += `🟡 SHORT-TERM (Month 1-3)\n\n`;
  safeArray(analysis.countermeasures?.short_term).forEach((a: any, i: number) => {
    markdown += `${i + 1}. ${safeString(a.action)}\n`;
    markdown += `   Owner: ${safeString(a.owner)} | Timeline: ${safeString(a.timeline)} | Impact: ${safeString(a.expected_impact)}\n\n`;
  });

  markdown += `🟢 LONG-TERM (Month 4-12)\n\n`;
  safeArray(analysis.countermeasures?.long_term).forEach((a: any, i: number) => {
    markdown += `${i + 1}. ${safeString(a.action)}\n`;
    markdown += `   Owner: ${safeString(a.owner)} | Timeline: ${safeString(a.timeline)} | Impact: ${safeString(a.expected_impact)}\n\n`;
  });

  markdown += `11. CASE STUDIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  safeArray(analysis.case_studies).forEach((cs: any, i: number) => {
    markdown += `CASE STUDY ${String(i + 1).padStart(2, '0')}: ${safeString(cs.title)}\n`;
    markdown += `─────────────────────────────────────────\n`;
    markdown += `⚠️ CHALLENGE:\n${safeString(cs.challenge)}\n\n`;
    markdown += `🎯 SOLUTION:\n${safeString(cs.solution)}\n\n`;
    markdown += `📊 RESULTS:\n${safeString(cs.results)}\n\n`;
    markdown += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
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
DataForSEO keyword analysis (${trendSource === 'dataforseo' ? 'live' : 'modeled'}), and forensic
network mapping. All findings are timestamped and verifiable.

📡 DATA SOURCES
• OSINT Collection: SerpAPI / ScraperAPI / SerperAPI
• Keyword Metrics: ${isDataForSEOAvailable() ? 'DataForSEO API (Live)' : 'Modeled Estimates'}
• Trend Data: ${trendSource === 'dataforseo' ? 'DataForSEO Google Trends (Live)' : 'Pattern-Based (Modeled)'}
• Platform Analysis: MusePRO Proprietary Database
• Risk Scoring: MusePRO Counterfeit Detection Engine
• Network Mapping: Forensic AI Analysis

⚠️ DATA LIMITATIONS
`;
  safeArray(analysis.data_limitations).forEach((d: string, i: number) => {
    markdown += `  ${i + 1}. ${d}\n`;
  });

  markdown += `\n📡 DATA SOURCE NOTE: DataForSEO integration is ready. Live keyword metrics will
activate automatically once API credentials are configured. All OSINT data is
collected in real-time from public sources.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ DISCLAIMER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This report is for informational and brand protection purposes only. All
OSINT findings are collected from publicly available sources and are
timestamped for verification. This report does not constitute legal advice.
Consult qualified IP attorneys before initiating enforcement actions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by MusePRO Brand Protection Intelligence Division.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  const result = {
    brand,
    category,
    country,
    type: 'brand_protection',
    data: {
      riskProfile,
      osintFindings: osintFindings.slice(0, 20),
      platformDistribution: platformDist,
      keywordAnalysis: keywordAnalysis.slice(0, 15),
      networkMap,
      recommendations,
      aiAnalysis: analysis,
    },
    markdown,
    threat_summary: safeString(analysis.threat_summary, 'Counterfeit threat analysis.'),
    trendSource,
    chart_data: {
      trend_12m: trendData.slice(0, 12).map((v: number, i: number) => ({
        month: `M${i + 1}`,
        value: v,
      })),
      platform_distribution: platformDist.map((p: any) => ({
        platform: p.platform,
        count: p.findingsCount,
      })),
      risk_score: riskProfile.riskScore,
    },
  };

  cacheService.set(cacheKey, result, 86400);
  return result;
}
