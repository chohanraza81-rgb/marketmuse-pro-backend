// exchange.ts
import axios from 'axios';
import { cacheService } from './cache';

const EXCHANGE_API_URL = 'https://api.exchangerate-api.com/v4/latest/USD';

interface ExchangeRates {
  [currency: string]: number;
}

export async function convertCurrency(
  amount: number,
  from: string,
  to: string
): Promise<number | null> {
  if (from === to) return amount;

  const cacheKey = `exchange_${from}_${to}`;
  const cachedRate = cacheService.get<number>(cacheKey);
  if (cachedRate) {
    return Number((amount * cachedRate).toFixed(2));
  }

  try {
    const response = await axios.get(EXCHANGE_API_URL, { timeout: 10000 });
    const rates: ExchangeRates = response.data?.rates;
    if (!rates || !rates[from] || !rates[to]) return null;

    const fromRate = rates[from];
    const toRate = rates[to];
    const rate = toRate / fromRate;

    cacheService.set(cacheKey, rate, 86400); // cache for 24 hours
    return Number((amount * rate).toFixed(2));
  } catch (error) {
    console.warn('Exchange rate API error:', error instanceof Error ? error.message : 'Unknown');
    return null;
  }
}
