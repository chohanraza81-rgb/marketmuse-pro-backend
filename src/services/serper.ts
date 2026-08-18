import axios from 'axios';

export const getSerperResults = async (query: string, country: string): Promise<any> => {
  const SERPER_API_KEY = process.env.SERPER_API_KEY; // Railway pe env set karna zaroori hai
  if (!SERPER_API_KEY) throw new Error('Serper API Key missing');

  try {
    const response = await axios.post(
      'https://google.serper.dev/search',
      {
        q: `${query} ${country}`,
        gl: country.toLowerCase(),
        num: 10
      },
      { headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' } }
    );
    return response.data;
  } catch (error) {
    // Error type unknown ko handle kiya
    console.warn('Serper API failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
};
