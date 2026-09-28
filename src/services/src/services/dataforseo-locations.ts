// src/services/dataforseo-locations.ts
export const DATAFORSEO_LOCATIONS: Record<string, { location_code: number; language_code: string; name: string }> = {
  us: { location_code: 2840, language_code: 'en', name: 'United States' },
  gb: { location_code: 2826, language_code: 'en', name: 'United Kingdom' },
  ca: { location_code: 2124, language_code: 'en', name: 'Canada' },
  au: { location_code: 2036, language_code: 'en', name: 'Australia' },
  de: { location_code: 2276, language_code: 'de', name: 'Germany' },
  sg: { location_code: 2702, language_code: 'en', name: 'Singapore' },
  sa: { location_code: 2682, language_code: 'ar', name: 'Saudi Arabia' },
  ae: { location_code: 2784, language_code: 'en', name: 'United Arab Emirates' },
  pk: { location_code: 2586, language_code: 'en', name: 'Pakistan' },
  in: { location_code: 2356, language_code: 'en', name: 'India' },
  tr: { location_code: 2792, language_code: 'tr', name: 'Turkey' },
  my: { location_code: 2458, language_code: 'en', name: 'Malaysia' },
};

export function getDataForSEOLocation(country: string): { location_code: number; language_code: string } {
  const loc = DATAFORSEO_LOCATIONS[country?.toLowerCase()];
  return loc
    ? { location_code: loc.location_code, language_code: loc.language_code }
    : { location_code: 2840, language_code: 'en' };
}
