// src/services/counterfeit-detector.service.ts - FIXED v2.0 - Evidence Safe
// AI-powered counterfeit risk scoring and analysis

import { runGroqWithRetry } from './groq';
import { OSINTFinding, KeywordAnalysis } from './osint.service';
import { getRiskScore, HIGH_RISK_CATEGORIES } from '../data/counterfeit-keywords';

export interface CounterfeitRiskProfile {
  threatLevel: 'Critical' | 'High' | 'Medium' | 'Low';
  riskScore: number; // 0-100 - CLAMPED, never >100
  counterfeitRate: number | null; // null = To be validated, not random
  estimatedAnnualLoss: number | null; // null = Not calculable without brand revenue
  estimatedAnnualLossDisplay: string; // Rounded display like "$4.8M (Modeled)"
  topTargetedProducts: Array<{ product: string; riskScore: number }>;
  priceUndercutRange: string;
  isModeled: boolean; // Must be shown in report
}

export interface CounterfeitNetworkNode {
  type: 'Account' | 'Platform' | 'Payment' | 'Shipping';
  name: string;
  platform: string;
  riskLevel: string;
  connections: string[];
}

// FIXED: Clamp helper - Prevents 104/100 bug
function clampScore(score: number, max: number = 100): number {
  if (isNaN(score)) return 0;
  if (score < 0) return 0;
  if (score > max) return max;
  return Math.round(score);
}

// FIXED: Round money to avoid fake precision like $4,809,255
function roundToNearest10K(amount: number): number {
  return Math.round(amount / 10000) * 10000;
}

function formatLossDisplay(amount: number | null): string {
  if (amount === null) return 'Not calculable - Brand revenue not supplied';
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M (Modeled Estimate)`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K (Modeled Estimate)`;
  return `$${amount} (Modeled Estimate)`;
}

// ✅ Generate Counterfeit Risk Profile - FIXED
export async function generateCounterfeitRiskProfile(
  brand: string,
  category: string,
  country: string,
  findings: OSINTFinding[],
  keywords: KeywordAnalysis[],
  brandAnnualRevenue?: number | null // NEW: Client must supply, else loss = null
): Promise<CounterfeitRiskProfile> {
  const baseRiskScore = getRiskScore(brand, category);
  const findingsBoost = Math.min(findings.length * 0.5, 15);
  const keywordBoost = keywords.length > 10 ? 5 : 0;

  // FIXED: Clamped to max 100 - never 104/100
  const riskScore = clampScore(baseRiskScore + findingsBoost + keywordBoost, 100);

  const threatLevel: CounterfeitRiskProfile['threatLevel'] =
    riskScore >= 85 ? 'Critical' : riskScore >= 70 ? 'High' : riskScore >= 50 ? 'Medium' : 'Low';

  // FIXED: NO Math.random() - Deterministic rate from category only
  const categoryData = HIGH_RISK_CATEGORIES.find(
    (c) => c.category.toLowerCase() === category.toLowerCase()
  );
  // Previously: (riskScore/10) + Math.random()*3 -> random every time, now fixed
  const counterfeitRate = categoryData ? Number((categoryData.riskScore / 10).toFixed(2)) : null;

  // FIXED: NO hardcoded $50M assumption
  // Previously: avgBrandRevenue = 50_000_000 invented, loss = $4,809,255 fake exact
  // Now: Only calculate if client supplied real revenue, else null
  let estimatedAnnualLoss: number | null = null;
  if (brandAnnualRevenue && brandAnnualRevenue > 0 && counterfeitRate !== null) {
    const rawLoss = brandAnnualRevenue * (counterfeitRate / 100);
    estimatedAnnualLoss = roundToNearest10K(rawLoss); // $4,810,000 not $4,809,255
  }

  // FIXED: NO fake product names like "Samsung Signature" / "Limited Edition"
  // Only use products actually found in OSINT titles, else empty
  const topTargetedProducts: Array<{ product: string; riskScore: number }> = [];
  // Extract real product mentions from findings titles if available
  const seenProducts = new Set<string>();
  for (const f of findings) {
    // Simple extraction: if title contains brand + model pattern, keep it
    // Otherwise skip - do NOT invent products
    if (f.title && f.title.toLowerCase().includes(brand.toLowerCase()) && seenProducts.size < 4) {
      const cleanTitle = f.title.slice(0, 80);
      if (!seenProducts.has(cleanTitle)) {
        seenProducts.add(cleanTitle);
        topTargetedProducts.push({
          product: cleanTitle,
          riskScore: riskScore,
        });
      }
    }
  }

  return {
    threatLevel,
    riskScore,
    counterfeitRate,
    estimatedAnnualLoss,
    estimatedAnnualLossDisplay: formatLossDisplay(estimatedAnnualLoss),
    topTargetedProducts,
    priceUndercutRange: '40-70% below retail (Modeled - to be validated via test purchase)',
    isModeled: true, // Always modeled unless verified by enforcement data
  };
}

// ✅ Generate Counterfeiter Network Map (AI-assisted) - FIXED
export async function generateNetworkMap(
  findings: OSINTFinding[]
): Promise<CounterfeitNetworkNode[]> {
  const nodes: CounterfeitNetworkNode[] = [];
  const seenPlatforms = new Set<string>();

  for (const finding of findings.slice(0, 10)) {
    // FIXED: Skip unknown / google.com platforms
    if (!finding.platform || finding.platform === 'unknown') continue;
    if (finding.url.includes('google.com/goto')) continue;

    if (!seenPlatforms.has(finding.platform)) {
      nodes.push({
        type: 'Platform',
        name: finding.platform,
        platform: finding.platform,
        riskLevel: finding.riskLevel,
        connections: [],
      });
      seenPlatforms.add(finding.platform);
    }
  }

  return nodes;
}

// ✅ Generate enforcement recommendations (AI-powered) - FIXED: No fake counts
export async function generateEnforcementRecommendations(
  brand: string,
  riskProfile: CounterfeitRiskProfile,
  findings: OSINTFinding[]
): Promise<{
  immediate: string[];
  shortTerm: string[];
  longTerm: string[];
}> {
  // FIXED: Only count real findings, don't invent Instagram counts if none exist
  const instagramCount = findings.filter((f) => f.platform === 'Instagram').length;
  const criticalCount = findings.filter((f) => f.riskLevel === 'Critical').length;

  const immediate: string[] = [];
  if (instagramCount > 0) {
    immediate.push(`File takedown notices for ${instagramCount} Instagram listings (verified in OSINT scan)`);
  }
  if (criticalCount > 0) {
    immediate.push(`Escalate ${criticalCount} critical findings to legal team`);
  }
  if (findings.length > 0) {
    immediate.push(`Document evidence with timestamps for ${findings.length} verified URLs`);
  } else {
    immediate.push(`No verified listings found in this scan - expand keyword coverage before enforcement`);
  }

  const shortTerm = [
    `Verify ${brand} trademark recordation status with CBP before filing seizures - do not assume active`,
    `Partner with customs to record IP for automated seizure (after legal review)`,
    `Deploy monitoring for keyword tracking - review weekly`,
  ];

  const longTerm = [
    `Build OSINT monitoring workflow for continuous surveillance`,
    `Establish customer education campaign (verify authenticity) - with approved messaging`,
    `Review platform accountability options with IP counsel in key markets`,
  ];

  return { immediate, shortTerm, longTerm };
}
