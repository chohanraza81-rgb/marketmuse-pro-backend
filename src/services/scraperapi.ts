import axios from 'axios';

export const getScraperAPISearch = async (query: string, country: string): Promise<any> => {
  const API_KEY = process.env.SCRAPER_API_KEY;
  if (!API_KEY) {
    console.warn('SCRAPER_API_KEY is missing. Skipping ScraperAPI.');
    return null;
  }

  try {
    // ScraperAPI ko Google search URL bhej rahe hain
    const url = `https://api.scraperapi.com?api_key=${API_KEY}&url=https://www.google.com/search?q=${encodeURIComponent(query)}&gl=${country.toLowerCase()}&num=10`;
    const response = await axios.get(url);
    
    // ScraperAPI raw HTML return karta hai. Humein usko parse karke organic results nikaalne honge.
    // Lekin simple rakhne ke liye, hum seedha response ko return kar rahe hain, aur backend me parse karenge.
    return response.data; 
  } catch (error) {
    console.warn('ScraperAPI failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
};
