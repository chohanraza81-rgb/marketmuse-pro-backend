// groq.ts
// ═══════════════════════════════════════════════════════════════════════════
// v2 — PRO MODE READY
// ═══════════════════════════════════════════════════════════════════════════
// NEW:
//   (1) Environment-based Pro-only mode (no Flash fallback in production)
//   (2) Configurable via GEMINI_TIER env variable
//   (3) Better error handling for rate limits
//   (4) Token usage tracking for cost monitoring
// ═══════════════════════════════════════════════════════════════════════════

import { env } from '../config/env';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

// Pro models (highest quality, 1M+ context)
const PRO_MODELS = [
  'gemini-2.5-pro',      // Primary: Best quality, coding/STEM benchmarks
  'gemini-1.5-pro',      // Fallback: Stable, proven
];

// Flash models (emergency fallback only)
const FLASH_MODELS = [
  'gemini-3.5-flash',
  'gemini-flash-latest',
];

// ✅ Determine mode based on environment
const ENV = process.env.NODE_ENV || 'development';
const GEMINI_TIER = process.env.GEMINI_TIER || 'auto';

// Logic:
// - If GEMINI_TIER='pro' → Pro only
// - If NODE_ENV='production' → Pro only
// - If GEMINI_TIER='flash' → Flash only (free/testing)
// - Otherwise → Pro + Flash fallback
const USE_PRO_ONLY =
  GEMINI_TIER === 'pro' ||
  ENV === 'production' ||
  (GEMINI_TIER === 'auto' && process.env.GEMINI_API_KEY?.startsWith('AIza'));

const USE_FLASH_ONLY = GEMINI_TIER === 'flash';

// Build model list based on mode
let ALL_MODELS: string[];
if (USE_FLASH_ONLY) {
  ALL_MODELS = FLASH_MODELS;
} else if (USE_PRO_ONLY) {
  ALL_MODELS = PRO_MODELS; // No Flash fallback
} else {
  ALL_MODELS = [...PRO_MODELS, ...FLASH_MODELS]; // Legacy: both
}

// Log mode on startup
console.log(
  `🔧 [Gemini] Mode: ${
    USE_FLASH_ONLY ? 'FLASH-ONLY (free tier)' :
    USE_PRO_ONLY ? 'PRO-ONLY (production quality)' :
    'PRO + FLASH (mixed)'
  }`
);
console.log(`🔧 [Gemini] Models: ${ALL_MODELS.join(' → ')}`);

const TIMEOUT_MS = 120000; // 2 minutes for complex reports

// ═══════════════════════════════════════════════════════════════════════════
// TOKEN USAGE TRACKING
// ═══════════════════════════════════════════════════════════════════════════

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface GeminiResult {
  text: string;
  usage: TokenUsage;
  model: string;
}

// Cost per 1M tokens (Gemini 2.5 Pro pricing, approximate)
const COST_PER_M_INPUT = 1.25;   // USD
const COST_PER_M_OUTPUT = 10.00; // USD

function calculateCost(usage: TokenUsage): number {
  const inputCost = (usage.inputTokens / 1_000_000) * COST_PER_M_INPUT;
  const outputCost = (usage.outputTokens / 1_000_000) * COST_PER_M_OUTPUT;
  return inputCost + outputCost;
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE API CALL
// ═══════════════════════════════════════════════════════════════════════════

async function callGemini(
  model: string,
  systemPrompt: string,
  userMessage: string
): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // For Pro models: use system_instruction (native support)
    // For Flash models: prepend system prompt to user message
    const isProModel = model.includes('pro');

    const requestBody: any = {
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 60000,
        topP: 0.95,
        responseMimeType: 'application/json',
      },
    };

    if (isProModel) {
      requestBody.system_instruction = { parts: [{ text: systemPrompt }] };
    } else {
      requestBody.contents[0].parts[0].text = `${systemPrompt}\n\n---\n\n${userMessage}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    // Handle specific errors
    if (response.status === 503) throw new Error('MODEL_OVERLOADED');
    if (response.status === 404) throw new Error('MODEL_NOT_FOUND');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    if (response.status === 400) {
      const errData: any = await response.json().catch(() => ({}));
      throw new Error(`BAD_REQUEST: ${JSON.stringify(errData)}`);
    }

    if (!response.ok) {
      const errData: any = await response.json().catch(() => ({}));
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(errData)}`);
    }

    const data: any = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini');

    // Extract token usage
    const usageMetadata = data.usageMetadata || {};
    const usage: TokenUsage = {
      inputTokens: usageMetadata.promptTokenCount || 0,
      outputTokens: usageMetadata.candidatesTokenCount || 0,
      totalTokens: usageMetadata.totalTokenCount || 0,
    };

    // Log usage
    const cost = calculateCost(usage);
    console.log(
      `📊 [Gemini] ${model}: ${usage.inputTokens} in / ${usage.outputTokens} out = $${cost.toFixed(4)}`
    );

    return { text, usage, model };
  } finally {
    clearTimeout(timeout);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PROMPT RUNNER
// ═══════════════════════════════════════════════════════════════════════════

export const runGroqPrompt = async (
  systemPrompt: string,
  userMessage: string
): Promise<string> => {
  for (let i = 0; i < ALL_MODELS.length; i++) {
    const model = ALL_MODELS[i];
    try {
      console.log(`🔄 [Attempt ${i + 1}/${ALL_MODELS.length}] ${model}`);

      const result = await callGemini(model, systemPrompt, userMessage);

      console.log(`✅ [Success] ${model}`);
      return result.text;
    } catch (error: any) {
      const msg = error.message || '';

      if (msg === 'MODEL_OVERLOADED' || msg === 'RATE_LIMITED') {
        console.warn(`⚠️ ${model} busy/limited, trying next...`);
        await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
      } else if (msg === 'MODEL_NOT_FOUND') {
        console.warn(`⚠️ ${model} not found, skipping`);
      } else {
        console.error(`❌ ${model} error: ${msg}`);
        // In Pro-only mode, don't throw — try next Pro model
        if (USE_PRO_ONLY && i < ALL_MODELS.length - 1) {
          console.log(`⏳ Trying next Pro model...`);
          continue;
        }
        throw error;
      }
    }
  }

  // Emergency fallback: only if NOT in Pro-only mode
  if (USE_PRO_ONLY && !USE_FLASH_ONLY) {
    console.warn(`🚨 All Pro models failed. Attempting emergency Flash fallback...`);
    for (const model of FLASH_MODELS) {
      try {
        console.log(`🔄 [Emergency] ${model}`);
        const result = await callGemini(model, systemPrompt, userMessage);
        console.log(`✅ [Emergency Success] ${model} — QUALITY MAY BE LOWER`);
        return result.text;
      } catch (e: any) {
        console.warn(`⚠️ Emergency fallback ${model} failed: ${e.message}`);
      }
    }
  }

  throw new Error('All Gemini models failed. Please try again later.');
};

// ═══════════════════════════════════════════════════════════════════════════
// RETRY WRAPPER
// ═══════════════════════════════════════════════════════════════════════════

export const runGroqWithRetry = async (
  systemPrompt: string,
  userMessage: string,
  retries = 2
): Promise<string> => {
  let lastError: any;

  for (let i = 0; i <= retries; i++) {
    try {
      console.log(`🚀 [Overall Retry ${i + 1}/${retries + 1}]`);
      return await runGroqPrompt(systemPrompt, userMessage);
    } catch (e: any) {
      lastError = e;
      console.error(`❌ [Overall Retry ${i + 1}] Failed: ${e.message}`);

      if (i === retries) throw lastError;

      const delay = 7000 * (i + 1); // 7s, 14s
      console.log(`⏳ Waiting ${delay / 1000}s before retry...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
};
