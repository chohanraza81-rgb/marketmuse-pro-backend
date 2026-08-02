// Map our app country codes to SerpAPI's gl parameter (Google Country)
export const countryToGL: Record<string, string> = {
  us: 'us',   // United States
  pk: 'pk',   // Pakistan (actually valid now in SerpAPI, but we'll keep mapping)
  gb: 'gb',   // United Kingdom
  ae: 'ae',   // United Arab Emirates
  sa: 'sa',   // Saudi Arabia
};

// Map our app country codes to Google Trends geo parameter
export const countryToGeo: Record<string, string> = {
  us: 'US',
  pk: 'PK',
  gb: 'GB',
  ae: 'AE',
  sa: 'SA',
};

// Map to currency code
export const countryToCurrency: Record<string, string> = {
  us: 'USD',
  pk: 'PKR',
  gb: 'GBP',
  ae: 'AED',
  sa: 'SAR',
};
