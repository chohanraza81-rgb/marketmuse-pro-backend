import { env } from '../config/env';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o';
const TIMEOUT_MS = 35000;

interface OpenRouterResponse {
  choices: { message: { content: string } }[];
}

export const runGroqPrompt = async (systemPrompt: string, userMessage: string): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': env.ALLOWED_ORIGIN || 'https://market-mus.netlify.app',
        'X-Title': 'MarketMuse AI PRO MAX ULTRA',
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

    const data: OpenRouterResponse = await response.json() as OpenRouterResponse;
    const content = data.choices[0]?.message?.content;
    if (!content) throw new Error('Empty AI response');
    return content;
  } catch (error: any) {
    if (error.name === 'AbortError') throw new Error('AI request timed out after 35s');
    throw new Error(`AI error: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
};

export const runGroqWithRetry = async (
  systemPrompt: string,
  userMessage: string,
  retries: number = 1
): Promise<string> => {
  let lastError: any;
  for (let i = 0; i <= retries; i++) {
    try {
      console.log(`🔄 AI attempt ${i + 1}/${retries + 1}`);
      const result = await runGroqPrompt(systemPrompt, userMessage);
      console.log('✅ AI success');
      return result;
    } catch (err: any) {
      lastError = err;
      console.error(`❌ Attempt ${i + 1}:`, err.message);
      if (i === retries) throw lastError;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw lastError;
};
