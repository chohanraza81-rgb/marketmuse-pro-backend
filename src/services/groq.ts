import Groq from '@groq-sdk';
import { env } from '../config/env';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

const TIMEOUT_MS = 25000;

export const runGroqPrompt = async (systemPrompt: string, userMessage: string): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const chatCompletion = await groq.chat.completions.create(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        model: 'mixtral-8x7b-32768',
        temperature: 0.2,
        max_tokens: 4096,
        top_p: 1,
        stream: false,
      },
      { signal: controller.signal }
    );

    const content = chatCompletion.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response from Groq');
    return content;
  } catch (error: any) {
    if (error.name === 'AbortError') throw new Error('Groq request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

// Retry wrapper
export const runGroqWithRetry = async (systemPrompt: string, userMessage: string, retries = 2): Promise<string> => {
  let lastError: any;
  for (let i = 0; i <= retries; i++) {
    try {
      return await runGroqPrompt(systemPrompt, userMessage);
    } catch (err) {
      lastError = err;
      if (i === retries) throw lastError;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastError;
};
