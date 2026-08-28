import axios from 'axios';

export const getSerperResults = async (query: string, country: string): Promise<any> => {
  const SERPER_API_KEY = process.env.SERPER_API_KEY;
  if (!SERPER_API_KEY) throw new Error('Serper API Key missing');

  try {
    const response = await axios.post(
      'https://google.serper.dev/search',
      {
        q: `${query} ${country}`,
        gl: country.toUpperCase(), // ✅ FIX: Uppercase
        num: 10
      },
      { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' } }
    );
    return response.data;
  } catch (error) {
    console.warn('Serper API failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
};
