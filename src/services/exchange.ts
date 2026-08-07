import axios from 'axios';
import { cacheService } from './cache';

interface ExchangeRates {
  [currency: string]: number;
}

const BASE_URL = 'https://v6.exchangerate-api.com/v6';

// Free API key — get yours at https://app.exchangerate-api.com/sign-up
const API_KEY = process.env.EXCHANGE_API_KEY || 'YOUR_FREE_API_KEY';

export const getExchangeRates = async (): Promise<ExchangeRates> => {
  const cacheKey = 'exchange_rates';
  const cached = cacheService.get<ExchangeRates>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get(`${BASE_URL}/${API_KEY}/latest/USD`);
    const rates = data.conversion_rates as ExchangeRates;
    cacheService.set(cacheKey, rates, 86400); // 24h cache
    return rates;
  } catch (error) {
    console.error('Exchange rate fetch failed, using fallback rates');
    // Fallback static rates (updated 2026)
    return {
      USD: 1,
      PKR: 278,
      INR: 83,
      GBP: 0.79,
      EUR: 0.92,
      CAD: 1.36,
      AUD: 1.53,
      SGD: 1.34,
      SAR: 3.75,
      AED: 3.67,
      TRY: 32,
      MYR: 4.65,
    };
  }
};

export const convertPrice = (
  amountUSD: number,
  targetCurrency: string,
  rates: ExchangeRates
): number => {
  const rate = rates[targetCurrency] || 1;
  return Math.round(amountUSD * rate * 100) / 100;
};
