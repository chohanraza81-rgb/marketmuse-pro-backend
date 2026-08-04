import { env } from '../config/env';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o';
const TIMEOUT_MS = 50000;

export const runGroqPrompt = async (systemPrompt: string, userMessage: string): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': env.ALLOWED_ORIGIN || 'https://market-mus.netlify.app',
        'X-Title': 'MarketMuse PRO',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 8000,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errData: any = await response.json().catch(() => ({}));
      throw new Error(`OpenRouter error ${response.status}: ${JSON.stringify(errData)}`);
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response');
    return content;
  } catch (error: any) {
    if (error.name === 'AbortError') throw new Error('Request timed out');
    throw new Error(`AI error: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
};

export const runGroqWithRetry = async (sys: string, msg: string, retries = 1): Promise<string> => {
  let last: any;
  for (let i = 0; i <= retries; i++) {
    try {
      console.log(`🔄 Attempt ${i + 1}/${retries + 1} with ${MODEL}`);
      const result = await runGroqPrompt(sys, msg);
      console.log('✅ Success');
      return result;
    } catch (e: any) {
      last = e;
      console.error(`❌ Attempt ${i + 1}:`, e.message);
      if (i === retries) throw last;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw last;
};
