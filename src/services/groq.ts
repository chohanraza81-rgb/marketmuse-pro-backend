import Groq from 'groq-sdk';
import { env } from '../config/env';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

const TIMEOUT_MS = 25000;

// Current recommended model (fast & free on Groq)
const MODEL = 'llama-3.1-8b-instant';

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
        model: MODEL,
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
    if (error.name === 'AbortError') throw new Error('Groq request timed out after 25 seconds');
    if (error.status === 401) throw new Error('Invalid Groq API key');
    if (error.status === 429) throw new Error('Groq rate limit exceeded');
    if (error.status === 500) throw new Error('Groq server error');
    if (error.status === 400) {
      // Check for model decommissioned error and suggest a fix
      const msg = error.message || '';
      if (msg.includes('model_decommissioned')) {
        throw new Error(`Groq model decommissioned. Please update the model in src/services/groq.ts. Current: ${MODEL}`);
      }
    }
    throw new Error(`Groq API error: ${error.message || 'Unknown error'}`);
  } finally {
    clearTimeout(timeout);
  }
};

// Retry wrapper with exponential backoff
export const runGroqWithRetry = async (
  systemPrompt: string,
  userMessage: string,
  retries: number = 2
): Promise<string> => {
  let lastError: any;

  for (let i = 0; i <= retries; i++) {
    try {
      console.log(`🔄 Groq API attempt ${i + 1}/${retries + 1}`);
      const result = await runGroqPrompt(systemPrompt, userMessage);
      console.log('✅ Groq API success');
      return result;
    } catch (err: any) {
      lastError = err;
      console.error(`❌ Groq attempt ${i + 1} failed:`, err.message);

      if (i === retries) {
        console.error('❌ All Groq retries exhausted');
        throw lastError;
      }

      // Exponential backoff: 2s, 4s, 8s... max 10s
      const delay = Math.min(2000 * Math.pow(2, i), 10000);
      console.log(`⏳ Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError;
};

// Health check
export const checkGroqHealth = async (): Promise<boolean> => {
  try {
    const response = await runGroqPrompt(
      'Respond with only "OK"',
      'Health check'
    );
    return response.includes('OK');
  } catch {
    return false;
  }
};
