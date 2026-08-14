import dotenv from 'dotenv';
dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/marketmuse',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  SERPER_API_KEY: process.env.SERPER_API_KEY || '',
  DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN || '',
  DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD || '',
  SERPAPI_KEY: process.env.SERPAPI_KEY || '',
  EXCHANGE_API_KEY: process.env.EXCHANGE_API_KEY || '',
  KEYWORDS_EVERYWHERE_API_KEY: process.env.KEYWORDS_EVERYWHERE_API_KEY || '', // kept for compatibility
  BREVO_API_KEY: process.env.BREVO_API_KEY || '',
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  NODE_ENV: process.env.NODE_ENV || 'development',
};
