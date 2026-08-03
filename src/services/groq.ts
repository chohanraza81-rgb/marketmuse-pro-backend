import { env } from '../config/env';

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
const TIMEOUT_MS = 50000;

export const runGroqPrompt = async (systemPrompt: string, userMessage: string): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 8192, topP: 0.95 }
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errData: any = await response.json().catch(() => ({}));
      throw new Error(`Gemini error ${response.status}: ${JSON.stringify(errData)}`);
    }

    const data: any = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response');
    return text;
  } catch (error: any) {
    if (error.name === 'AbortError') throw new Error('Request timed out');
    throw new Error(`Gemini: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
};

export const runGroqWithRetry = async (sys: string, msg: string, retries = 1): Promise<string> => {
  let last: any;
  for (let i = 0; i <= retries; i++) {
    try {
      console.log(`🔄 Gemini ${i + 1}/${retries + 1}`);
      const r = await runGroqPrompt(sys, msg);
      console.log('✅ Success');
      return r;
    } catch (e: any) {
      last = e;
      console.error(`❌ ${i + 1}:`, e.message);
      if (i === retries) throw last;
      await new Promise(r => setTimeout(r, 4000));
    }
  }
  throw last;
};
