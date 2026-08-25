import Groq from 'groq-sdk';

// ✅ Use process.env directly (no need to modify env.ts)
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MODELS = [
  'gemini-3.5-flash',
  'gemini-flash-latest'
];

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function runGroqWithRetry(prompt: string, context: string): Promise<string> {
  let lastError: any;

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // ✅ Strict 90 second timeout
        const completion: any = await Promise.race([
          groq.chat.completions.create({
            messages: [
              { role: 'system', content: prompt },
              { role: 'user', content: context }
            ],
            model,
            temperature: 0.7,
            max_tokens: 8000
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 90s')), 90000))
        ]);

        const content = completion?.choices?.[0]?.message?.content;
        if (content) {
          console.log(`✅ Success with ${model}`);
          return content;
        }
      } catch (error: any) {
        lastError = error;
        
        if (error.message?.includes('busy') || error.message?.includes('limited') || error.message?.includes('Timeout')) {
          console.warn(`⏳ ${model} busy/timeout, retrying in 15 seconds...`);
          await wait(15000);
        } else {
          console.warn(`⚠️ ${model} failed, trying next...`);
          break;
        }
      }
    }
  }

  throw lastError || new Error('All Gemini models failed');
}
