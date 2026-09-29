// src/data/counterfeit-keywords.ts
// Counterfeit detection keywords + platform patterns

export const COUNTERFEIT_KEYWORDS = {
  // Tier 1 replica keywords (highest volume)
  tier1: [
    'replica', 'aaa replica', '1:1 replica', 'top tier replica',
    'ua', 'unauthorized authentic', 'unauthorized authentic sneakers',
    'pk god', 'pk kim', 'kickwho', 'coco sneakers', 'monica sneakers',
    'perfect quality', 'mirror quality', 'same as original',
  ],
  // Tier 2 keywords (mid-tier fakes)
  tier2: [
    'master copy', 'master quality', 'first copy', 'first copy shoes',
    'super clone', 'swiss clone', 'japanese movement', 'eta clone',
    'high quality replica', 'premium replica', 'best replica',
  ],
  // Tier 3 keywords (low-tier, generic)
  tier3: [
    'copy', 'fake', 'inspired by', 'style of', 'dupe', 'knockoff',
    'alternative to', 'similar to', 'budget version',
  ],
  // Luxury-specific (watches, bags)
  luxury: [
    'super clone watch', 'clone watch', 'fake rolex', 'replica watch',
    'fake louis vuitton', 'lv replica', 'gucci replica', 'chanel replica',
    'hermes replica', 'birkin replica', 'fake rolex for sale',
  ],
  // Sneaker-specific
  sneakers: [
    'yeezy replica', 'jordan replica', 'nike replica', 'adidas replica',
    'off white replica', 'travis scott replica', 'dunk replica',
    'fake yeezys', 'unauthorized jordans', 'ua yeezy',
  ],
  // Electronics-specific
  electronics: [
    'fake airpods', 'replica airpods', 'copy airpods', 'fake iphone',
    'replica apple watch', 'fake samsung', 'clone electronics',
  ],
};

export const COUNTERFEIT_PLATFORMS = [
  { name: 'Instagram', domain: 'instagram.com', risk: 'High' },
  { name: 'TikTok', domain: 'tiktok.com', risk: 'High' },
  { name: 'Telegram', domain: 't.me', risk: 'Critical' },
  { name: 'Discord', domain: 'discord.gg', risk: 'High' },
  { name: 'Reddit', domain: 'reddit.com', risk: 'Medium' },
  { name: 'DHgate', domain: 'dhgate.com', risk: 'Critical' },
  { name: 'AliExpress', domain: 'aliexpress.com', risk: 'High' },
  { name: 'Taobao', domain: 'taobao.com', risk: 'Critical' },
  { name: 'Weidian', domain: 'weidian.com', risk: 'Critical' },
  { name: '1688', domain: '1688.com', risk: 'Critical' },
  { name: 'Facebook Marketplace', domain: 'facebook.com', risk: 'Medium' },
  { name: 'Poshmark', domain: 'poshmark.com', risk: 'Medium' },
  { name: 'Mercari', domain: 'mercari.com', risk: 'Medium' },
  { name: 'Depop', domain: 'depop.com', risk: 'Medium' },
  { name: 'Etsy', domain: 'etsy.com', risk: 'Low' },
];

export const COUNTERFEIT_INDICATORS = {
  pricing: [
    'Price 40-70% below retail (sweet spot for replicas)',
    'Inconsistent pricing across listings',
    'Suspiciously round price points',
    'Heavy discount language ("80% off authentic")',
  ],
  language: [
    'Ambiguous descriptions ("authentic quality", "1:1")',
    'Private communication requests ("DM for details")',
    'Misspelled brand names (Nykee, Adiddas)',
    'Keyword stuffing with brand alternatives',
  ],
  visual: [
    'Stock photos instead of own images',
    'Watermarked or heavily edited product photos',
    'Inconsistent backgrounds across listings',
    'Low-resolution or compressed images',
  ],
  operational: [
    'Newly created accounts (< 6 months old)',
    'No return policy or "final sale" only',
    'Payment outside platform (Venmo, Zelle, crypto)',
    'Shipping from high-risk regions',
  ],
};

export const HIGH_RISK_CATEGORIES = [
  { category: 'Sneakers', riskScore: 95, brands: ['Nike', 'Adidas', 'Jordan', 'Yeezy', 'New Balance'] },
  { category: 'Luxury Bags', riskScore: 92, brands: ['Louis Vuitton', 'Gucci', 'Chanel', 'Hermès', 'Prada'] },
  { category: 'Luxury Watches', riskScore: 90, brands: ['Rolex', 'Omega', 'Cartier', 'Patek Philippe', 'Audemars Piguet'] },
  { category: 'Streetwear', riskScore: 88, brands: ['Supreme', 'BAPE', 'Off-White', 'Fear of God', 'Palace'] },
  { category: 'Electronics', riskScore: 85, brands: ['Apple', 'Samsung', 'Sony', 'Bose', 'Beats'] },
  { category: 'Cosmetics', riskScore: 78, brands: ['MAC', 'Charlotte Tilbury', 'Dior', 'YSL', 'NARS'] },
];

export function getCounterfeitKeywordsForBrand(brand: string): string[] {
  const brandLower = brand.toLowerCase();
  const keywords = new Set<string>();

  // Add brand-specific variants
  keywords.add(`${brandLower} replica`);
  keywords.add(`${brandLower} fake`);
  keywords.add(`${brandLower} 1:1`);
  keywords.add(`${brandLower} ua`);
  keywords.add(`fake ${brandLower}`);
  keywords.add(`replica ${brandLower}`);
  keywords.add(`${brandLower} first copy`);
  keywords.add(`${brandLower} super clone`);
  keywords.add(`buy ${brandLower} replica`);
  keywords.add(`${brandLower} top tier`);

  // Add generic counterfeit keywords
  [...COUNTERFEIT_KEYWORDS.tier1, ...COUNTERFEIT_KEYWORDS.tier2]
    .slice(0, 10)
    .forEach((kw) => keywords.add(`${kw} ${brandLower}`));

  return Array.from(keywords);
}

export function getRiskScore(brand: string, category: string): number {
  const cat = HIGH_RISK_CATEGORIES.find(
    (c) => c.category.toLowerCase() === category.toLowerCase()
  );
  if (!cat) return 60; // default medium

  const brandMatch = cat.brands.some((b) => b.toLowerCase() === brand.toLowerCase());
  return brandMatch ? cat.riskScore : Math.round(cat.riskScore * 0.7);
}
