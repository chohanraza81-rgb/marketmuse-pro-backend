// groq.ts
import { env } from '../config/env';

// ============================================================
// MODEL CONFIGURATION (Updated — Sept 2026)
// Only currently valid Gemini models. Deprecated/non-existent
// models removed to prevent "not found" errors and speed up
// generation.
// ============================================================

// Pro models (quality first)
const PRO_MODELS = [
  'gemini-2.5-pro',        // Current flagship — best quality
];

// Flash models (fallback — faster, still capable)
const FLASH_MODELS = [
  'gemini-2.5-flash',      // Current stable
  'gemini-2.0-flash',      // Previous gen stable
  'gemini-2.0-flash-lite', // Fastest fallback
];

// Total 4 attempts (down from 6)
const ALL_MODELS = [...PRO_MODELS, ...FLASH_MODELS];

const TIMEOUT_MS = 90000;

// Helper to call Gemini API
async function callGemini(model: string, systemPrompt: string, userMessage: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 60000,
          topP: 0.95,
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });

    if (response.status === 503) throw new Error('MODEL_OVERLOADED');
    if (response.status === 404) throw new Error('MODEL_NOT_FOUND');
    if (response.status === 429) throw new Error('RATE_LIMITED');

    if (!response.ok) {
      const errData: any = await response.json().catch(() => ({}));
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(errData)}`);
    }

    const data: any = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

// Run prompt with model rotation
export const runGroqPrompt = async (systemPrompt: string, userMessage: string): Promise<string> => {
  for (let i = 0; i < ALL_MODELS.length; i++) {
    const model = ALL_MODELS[i];
    try {
      console.log(`🔄 Attempt ${i + 1}/${ALL_MODELS.length} with ${model}`);
      const result = await callGemini(model, systemPrompt, userMessage);
      console.log(`✅ Success with ${model}`);
      return result;
    } catch (error: any) {
      if (error.message === 'MODEL_OVERLOADED' || error.message === 'RATE_LIMITED') {
        console.warn(`⚠️ ${model} busy/limited, trying next...`);
        await new Promise(r => setTimeout(r, 5000));
      } else if (error.message === 'MODEL_NOT_FOUND') {
        console.warn(`⚠️ ${model} not found, skipping`);
      } else {
        console.error(`❌ ${model} error: ${error.message}`);
        throw error;
      }
    }
  }
  throw new Error('All Gemini models failed. Please try again later.');
};

// Retry wrapper
export const runGroqWithRetry = async (systemPrompt: string, userMessage: string, retries = 2): Promise<string> => {
  let last: any;
  for (let i = 0; i <= retries; i++) {
    try {
      console.log(`🚀 Overall retry ${i + 1}/${retries + 1}`);
      const r = await runGroqPrompt(systemPrompt, userMessage);
      return r;
    } catch (e: any) {
      last = e;
      console.error(`❌ Overall retry ${i + 1} failed: ${e.message}`);
      if (i === retries) throw last;
      const delay = 7000 * (i + 1);
      console.log(`⏳ Waiting ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw last;
};
