import axios from 'axios';

export const getScraperAPISearch = async (query: string, country: string): Promise<any> => {
  const API_KEY = process.env.SCRAPER_API_KEY;
  if (!API_KEY) {
    console.warn('SCRAPER_API_KEY is missing.');
    return null;
  }

  try {
    // Use structured endpoint to get JSON organic_results
    const url = `https://api.scraperapi.com/structured/google/search?api_key=${API_KEY}&q=${encodeURIComponent(query)}&gl=${country.toUpperCase()}&num=10`;
    
    const response = await axios.get(url, { timeout: 15000 });
    
    // If no organic results or error in response, return null
    if (response.data?.organic_results) {
      return response.data;
    }
    return null;
  } catch (error) {
    console.warn('ScraperAPI structured failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
};
