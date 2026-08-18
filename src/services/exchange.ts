import axios from 'axios';

export const convertCurrency = async (amount: number, from: string = 'USD', to: string = 'SGD'): Promise<number> => {
  try {
    if (from === to) return amount;
    const response = await axios.get(`https://api.exchangerate-api.com/v4/latest/${from}`);
    const rate = response.data.rates[to];
    if (!rate) return amount;
    return parseFloat((amount * rate).toFixed(2));
  } catch (error) {
    console.warn('Exchange API failed, returning USD value:', error.message);
    return amount;
  }
};
