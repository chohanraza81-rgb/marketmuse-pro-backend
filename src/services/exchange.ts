import axios from 'axios';
import { cacheService } from './cache';

interface ExchangeRates {
  [currency: string]: number;
}

const BASE_URL = 'https://api.exchangerate-api.com/v4/latest/USD';

export const getExchangeRates = async (): Promise<ExchangeRates> => {
  const cacheKey = 'exchange_rates';
  const cached = cacheService.get<ExchangeRates>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get(BASE_URL);
    const rates = data.rates as ExchangeRates;
    cacheService.set(cacheKey, rates, 86400); // 24h
    return rates;
  } catch (error) {
    console.error('Exchange rate fetch failed, using fallback');
    // Fallback rates (static approximations)
    return {
      USD: 1,
      PKR: 280,
      GBP: 0.79,
      AED: 3.67,
      SAR: 3.75,
    };
  }
};

export const convertPrice = (amountUSD: number, targetCurrency: string, rates: ExchangeRates): number => {
  const rate = rates[targetCurrency] || 1;
  return Math.round(amountUSD * rate * 100) / 100;
};
