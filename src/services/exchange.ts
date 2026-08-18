import axios from 'axios';

export const convertCurrency = async (amount: number, from: string = 'USD', to: string = 'SGD'): Promise<number> => {
  try {
    if (from === to) return amount;
    const response = await axios.get(`https://api.exchangerate-api.com/v4/latest/${from}`);
    const rate = response.data.rates[to];
    if (!rate) return amount;
    return parseFloat((amount * rate).toFixed(2));
  } catch (error) {
    // Error type unknown ko handle kiya
    console.warn('Exchange API failed:', error instanceof Error ? error.message : String(error));
    return amount;
  }
};

// ✅ Product controller ke liye required exports
export const getExchangeRates = async (base: string = 'USD'): Promise<any> => {
  try {
    const response = await axios.get(`https://api.exchangerate-api.com/v4/latest/${base}`);
    return response.data.rates;
  } catch (error) {
    console.warn('Exchange API failed:', error instanceof Error ? error.message : String(error));
    return {};
  }
};

export const convertPrice = async (amount: number, from: string, to: string): Promise<number> => {
  return convertCurrency(amount, from, to);
};
