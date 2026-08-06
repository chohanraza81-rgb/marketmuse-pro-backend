import { env } from '../config/env';

const MODELS = [
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
];

const TIMEOUT_MS = 90000; // ✅ 90 seconds

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
          maxOutputTokens: 15000, // ✅ reduced for faster response
          topP: 0.95,
        }
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

export const runGroqPrompt = async (systemPrompt: string, userMessage: string): Promise<string> => {
  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    try {
      console.log(`🔄 Trying: ${model}`);
      const result = await callGemini(model, systemPrompt, userMessage);
      console.log(`✅ Success: ${model}`);
      return result;
    } catch (error: any) {
      if (error.message === 'MODEL_OVERLOADED' || error.message === 'RATE_LIMITED') {
        console.warn(`⚠️ ${model} busy, waiting 8s...`);
        await new Promise(r => setTimeout(r, 8000));
      } else if (error.message === 'MODEL_NOT_FOUND') {
        console.warn(`⚠️ ${model} not found, skipping`);
      } else {
        throw error;
      }
    }
  }
  throw new Error('All models failed. Please try again in 2 minutes.');
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
      const delay = 10000 * (i + 1); // 10s, 20s
      console.log(`⏳ Waiting ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw last;
};
