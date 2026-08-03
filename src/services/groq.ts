import { env } from '../config/env';

// Primary + Fallback models
const MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-flash',
  'gemini-2.0-flash',
];

const TIMEOUT_MS = 45000;

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
          maxOutputTokens: 65536,
          topP: 0.95,
        }
      }),
      signal: controller.signal,
    });

    if (response.status === 503) {
      throw new Error('MODEL_OVERLOADED');
    }

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

export const runGroqPrompt = async (systemPrompt: string, userMessage: string): Promise<string> => {
  for (const model of MODELS) {
    try {
      console.log(`🔄 Trying model: ${model}`);
      const result = await callGemini(model, systemPrompt, userMessage);
      console.log(`✅ Success with ${model}`);
      return result;
    } catch (error: any) {
      if (error.message === 'MODEL_OVERLOADED') {
        console.warn(`⚠️ ${model} overloaded, trying next...`);
        continue;
      }
      if (error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED')) {
        console.warn(`⚠️ ${model} rate limited, trying next...`);
        continue;
      }
      throw error;
    }
  }
  throw new Error('All Gemini models failed — please try again in a few minutes.');
};

export const runGroqWithRetry = async (sys: string, msg: string, retries = 2): Promise<string> => {
  let last: any;
  for (let i = 0; i <= retries; i++) {
    try {
      console.log(`🔄 Attempt ${i + 1}/${retries + 1}`);
      const r = await runGroqPrompt(sys, msg);
      return r;
    } catch (e: any) {
      last = e;
      console.error(`❌ Attempt ${i + 1}:`, e.message);
      if (i === retries) throw last;
      const delay = 5000 * (i + 1);
      console.log(`⏳ Waiting ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw last;
};
