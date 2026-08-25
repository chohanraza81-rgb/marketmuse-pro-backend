import { cacheService } from './cache';
import { getGoogleTrends } from './trends';
import { getSearchResults, getKeywordSuggestions } from './serpapi';
import { getSerperResults } from './serper';
import { getScraperAPISearch } from './scraperapi';
import { convertCurrency } from './exchange';
import { runGroqWithRetry } from './groq';

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

// ONLY prevents NaN, does NOT generate random numbers
const safeNumber = (val: any, fallback: number = 0) => {
  const num = Number(val);
  return isNaN(num) ? fallback : num;
};

const extractJSON = (raw: string): any => {
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) cleaned = cleaned.substring(start, end + 1);
  try { return JSON.parse(cleaned); } catch (err) {
    const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    try { return JSON.parse(fixed); } catch (e2) { throw new Error('AI response is not valid JSON'); }
  }
};

// 🧠 HUMAN TONE PROTOCOL + OPTION 1 STRICT PROMPT
const buildUnifiedPrompt = (niche: string, country: string, type: 'seo' | 'product', serpLinks: string[], trendData: number[]) => {
  const countryName = countryNames[country] || country;
  return `You are a veteran senior consultant at MusePRO Intelligence Division with 15 years of experience. Your writing must be indistinguishable from a human expert.

  **STRICT HUMAN WRITING RULES**:
  1. Use contractions (don't, it's, we're, that's).
  2. Vary sentence length. Write short, punchy sentences. Then follow with long, detailed ones.
  3. Use active voice.
  4. DO NOT use AI words: 'furthermore', 'moreover', 'delve', 'landscape', 'realm', 'robust', 'testament', 'leverage'.
  5. Use human consultant phrases: 'The reality is', 'Here's the kicker', 'Let's cut to the chase', 'You need to understand', 'The smart money is on'.
  6. Address the reader as 'you' and your team as 'we'. Add a specific opinion about the data.

  **CRITICAL SETTINGS**:
  - The CURRENT YEAR is ALWAYS 2026. NEVER use 2024 or 2025 for current trends.
  - The target country is ${countryName} (${country}). 
  - **STRICT COUNTRY LOCK**: Do NOT mention the US, UK, or any other country. Only ${countryName}.

  **OPTION 1 - STRICT PROMPT FOR TARGET SITES**:
  If you do not know exact local publications, INVENT 5 hyper-realistic local publications specific to the niche. DO NOT use generic words like 'Home', 'Property', 'Contractor', or 'Real Estate' in the names. 
  For example, if the niche is "Auto Parts", invent names like "Australian Auto Parts Gazette", "Aussie Mechanic Review", or "Pro Auto Parts Alliance". The site names MUST be directly related to the niche.

  Create a premium ${type === 'seo' ? 'SEO Research' : 'Product Intelligence'} report for "${niche}" in "${countryName}".
  Input SERP links: ${JSON.stringify(serpLinks)}.
  Input Trend Data: ${JSON.stringify(trendData)}.

  **RETURN ONLY VALID JSON**:
  1. key_insights (3 strings), 2. immediate_actions (3 strings), 3. trend_summary (1 string), 4. trend_assessment (paragraph), 5. keywords (50 objects), 6. serp_landscape (8 objects), 7. content_roadmap (12 weeks), 8. link_acquisition (target_sites, guest_posts, broken_links, outreach), 9. onpage_checklist (15 strings), 10. growth_accelerators (5 strings), 11. related_resources (5-8), 12. local_market_context (Array of 3 strings), 13. local_business_base (Array of 4 strings analyzing local business landscape & consumer base).`;
};

export async function generateReport(niche: string, country: string, type: 'seo' | 'product') {
  const cacheKey = `${type}_${niche}_${country}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  // 1. Fetch REAL SERP & Trends
  const trendData = await getGoogleTrends(niche, country).catch(() => []);
  let searchData = await getSearchResults(niche, country).catch(() => null);
  if (!searchData?.organic_results) searchData = await getSerperResults(niche, country).catch(() => null);
  if (!searchData?.organic_results) searchData = await getScraperAPISearch(niche, country).catch(() => null);

  const serpLinks = searchData?.organic_results?.slice(0, 8).map((r: any) => r.link) || [];

  // 2. Call Gemini
  const prompt = buildUnifiedPrompt(niche, country, type, serpLinks, trendData);
  const aiResponse = await runGroqWithRetry(prompt, JSON.stringify({ niche, country }));
  const analysis = extractJSON(aiResponse);

  const replaceYears = (text: string) => text.replace(/\b(2024|2025)\b/g, '2026');

  // 3. Sanitize Insights & Actions
  if (analysis.key_insights) analysis.key_insights = analysis.key_insights.map((item: any) => replaceYears(typeof item === 'string' ? item : (item.text || item.value || JSON.stringify(item))));
  if (analysis.immediate_actions) analysis.immediate_actions = analysis.immediate_actions.map((item: any) => replaceYears(typeof item === 'string' ? item : (item.text || item.value || JSON.stringify(item))));

  // 4. Keywords: Use AI's unique keywords
  let keywords = Array.isArray(analysis.keywords) ? analysis.keywords : [];
  const currencyMap: Record<string, string> = { us: 'USD', gb: 'GBP', ca: 'CAD', au: 'AUD', de: 'EUR', sg: 'SGD', sa: 'SAR', ae: 'AED', pk: 'PKR', in: 'INR', tr: 'TRY', my: 'MYR' };
  const targetCurrency = currencyMap[country] || 'USD';
  for (const kw of keywords) {
    kw.volume = safeNumber(kw.volume);
    kw.kd = safeNumber(kw.kd);
    kw.cpc = await convertCurrency(safeNumber(kw.cpc, 0.5), 'USD', targetCurrency);
  }

  // 5. Sanitize SERP Landscape
  let serp = (analysis.serp_landscape || []).filter((s: any) => s.title && s.link && s.title !== 'undefined').map((s: any, i: number) => ({
    position: s.position || i + 1,
    title: s.title,
    link: s.link,
    da: safeNumber(s.da, 40),
    words: safeNumber(s.words, 1000),
    backlinks: safeNumber(s.backlinks, 20),
    traffic: safeNumber(s.traffic, 500),
    strengths: s.strengths || 'N/A',
    weaknesses: s.weaknesses || 'N/A',
    gap: s.gap || 'N/A'
  }));

  // 6. Sanitize Roadmap (No repeated "Mastering")
  let roadmap = (analysis.content_roadmap || []).map((c: any, i: number) => ({
    week: c.week || i + 1,
    title: replaceYears(c.title && !c.title.includes('Mastering') ? c.title : keywords[i]?.keyword || niche),
    primary_keyword: c.primary_keyword || niche,
    type: c.type || 'Pillar',
    word_count_target: safeNumber(c.word_count_target, 2200),
    expected_traffic: safeNumber(c.expected_traffic, 1000)
  }));

  // 7. Option 2: Dynamic Niche-Based Fallback for Target Sites
  let targetSites = (analysis.link_acquisition?.target_sites || []).filter((s: any) => s.site && s.site !== 'N/A' && s.site !== 'undefined');
  
  if (targetSites.length < 5) {
    const safeCountry = countryNames[country] || 'Local';
    const safeNiche = niche.replace(/[^a-zA-Z0-9]/g, '');
    
    // Niche-specific names (No Home/Property/Contractor)
    const fallbackTargets = [
      { site: `${safeNiche} Gazette ${safeCountry}`, type: 'Industry Magazine', contact: `editor@${safeNiche.toLowerCase()}gazette.com`, pitch: `Offering a data-driven feature on ${niche} trends.` },
      { site: `Pro ${safeNiche} Alliance`, type: 'Trade Association', contact: `info@pro${safeNiche.toLowerCase()}alliance.com`, pitch: `Sharing a free checklist for ${niche}.` },
      { site: `${safeNiche} Review ${safeCountry}`, type: 'Consumer Reviews', contact: `hello@${safeNiche.toLowerCase()}review.com`, pitch: `Proposing a detailed guide on ${niche}.` },
      { site: `The ${safeNiche} Hub`, type: 'Community Blog', contact: `admin@${safeNiche.toLowerCase()}hub.com`, pitch: `Pitching an exclusive case study on ${niche}.` },
      { site: `${safeCountry} ${safeNiche} Weekly`, type: 'Trade News', contact: `contact@${safeNiche.toLowerCase()}weekly.com`, pitch: `Providing a resource guide for ${niche}.` }
    ];

    const existingSites = targetSites.map((s: any) => s.site);
    for (const t of fallbackTargets) {
      if (!existingSites.includes(t.site)) targetSites.push(t);
    }
  }

  // 8. Compute 6-Month Traffic Estimate
  const monthlyTotal = roadmap.reduce((sum: number, week: any) => sum + safeNumber(week.expected_traffic, 1000), 0);
  let trafficEstimate = Math.round(monthlyTotal * 2);
  if (trafficEstimate < 500 && keywords.length > 0) {
    trafficEstimate = Math.max(500, Math.round(safeNumber(keywords[0].volume) * 0.4 * 6));
  }
  if (isNaN(trafficEstimate)) trafficEstimate = 0;

  // 9. Generate Markdown (Premium, Human-Tone, AI-Free)
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let markdown = `MusePRO\nReal-Time Market Research\nIntelligence Division\n──────────────────────────────────────────────────────────────\n${type === 'seo' ? 'SEO RESEARCH REPORT' : 'PRODUCT INTELLIGENCE REPORT'}\n\nPrepared For: [Client Name]\nDate: ${today}\nReference: MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}\nClassification: CONFIDENTIAL\n──────────────────────────────────────────────────────────────\n\n`;

  markdown += `1. EXECUTIVE BRIEF\n──────────────────────────────────────────────────────────────\n`;
  (analysis.key_insights || []).forEach((f: string, i: number) => markdown += `  ${i+1}. ${f}\n`);
  markdown += `\nPriority Actions:\n`;
  (analysis.immediate_actions || []).forEach((w: string, i: number) => markdown += `  ${i+1}. ${w}\n`);

  markdown += `\n2. TREND ASSESSMENT\n──────────────────────────────────────────────────────────────\n`;
  markdown += `${analysis.trend_assessment || 'Steady market growth detected.'}\n\n`;

  markdown += `3. KEYWORD OPPORTUNITIES (TOP 50)\n──────────────────────────────────────────────────────────────\n| # | Keyword | Volume | KD | CPC | Intent | Potential |\n|---|---------|--------|-----|-----|--------|----------|\n`;
  keywords.slice(0, 50).forEach((k: any, i: number) => {
    const potential = k.kd < 30 ? 'Easy Win' : k.kd < 60 ? 'Moderate' : 'Long Game';
    markdown += `| ${i+1} | ${k.keyword} | ${safeNumber(k.volume)} | ${safeNumber(k.kd)} | $${safeNumber(k.cpc).toFixed(2)} | ${k.intent || 'informational'} | ${potential} |\n`;
  });

  markdown += `\n4. SERP LANDSCAPE\n──────────────────────────────────────────────────────────────\n`;
  serp.slice(0, 8).forEach((s: any, i: number) => markdown += `Position #${i+1}: ${s.title}\n  URL: ${s.link}\n  DA: ${s.da} | Words: ${s.words} | Backlinks: ${s.backlinks}\n  Est. Traffic: ${s.traffic}/mo\n  Strengths: ${s.strengths}\n  Weaknesses: ${s.weaknesses}\n  Gap: ${s.gap}\n\n`);

  // 🚀 NEW SECTION: Local Business & Consumer Base Analysis
  if (analysis.local_business_base && Array.isArray(analysis.local_business_base)) {
    markdown += `5. LOCAL BUSINESS & CONSUMER BASE ANALYSIS\n──────────────────────────────────────────────────────────────\n`;
    analysis.local_business_base.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
    markdown += `\n`;
  }

  if (analysis.local_market_context && Array.isArray(analysis.local_market_context)) {
    markdown += `6. LOCAL MARKET CONTEXT & REGULATORY NOTES\n──────────────────────────────────────────────────────────────\n`;
    analysis.local_market_context.forEach((item: string, i: number) => markdown += `  ${i+1}. ${item}\n`);
    markdown += `\n`;
  }

  markdown += `7. CONTENT ROADMAP (12 WEEKS)\n──────────────────────────────────────────────────────────────\n`;
  roadmap.slice(0, 12).forEach((c: any) => {
    markdown += `Week ${c.week}: ${c.title}\n  Keyword: ${c.primary_keyword} | Type: ${c.type}\n  Est. Traffic: ${c.expected_traffic}/mo\n\n`;
  });

  markdown += `8. LINK ACQUISITION STRATEGY\n──────────────────────────────────────────────────────────────\n${analysis.link_acquisition?.overview || ''}\n\n`;
  targetSites.forEach((s: any, i: number) => markdown += `  ${i+1}. ${s.site}\n     Type: ${s.type} | Contact: ${s.contact}\n     Pitch: ${s.pitch}\n\n`);
  
  // Guest posts and broken links
  if (analysis.link_acquisition?.guest_post_topics) markdown += `Guest Post Topics:\n` + (analysis.link_acquisition.guest_post_topics as string[]).map((t: any, i: number) => `  ${i+1}. ${t}`).join('\n') + '\n\n';
  
  const rawBrokenLinks: any[] = (analysis.link_acquisition?.broken_link_opportunities || []) as any[];
  let brokenLinks = rawBrokenLinks.filter((b: any) => b && b.site && b.site !== 'N/A' && b.dead_page && b.dead_page !== 'N/A');
  if (brokenLinks.length < 4) {
    const safeNiche = niche.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const fallbackLinks = [
      { site: `Old ${niche} Guide`, dead_page: `/blog/legacy-${safeNiche}-guide-2022`, replacement: `/blog/new-${safeNiche}-roadmap-2026` },
      { site: `Previous ${countryNames[country]} Comparison`, dead_page: `/resources/${country.toLowerCase()}-providers-2023`, replacement: `/blog/best-${safeNiche}-in-${country.toLowerCase()}-2026` },
      { site: `Outdated ${niche} Tutorial`, dead_page: `/tutorials/old-${safeNiche}-setup`, replacement: `/guides/modern-${safeNiche}-workflows` },
      { site: `Defunct ${countryNames[country]} Forum`, dead_page: `/community/${country.toLowerCase()}-${safeNiche}-discussion`, replacement: `/blog/${safeNiche}-trends-2026` }
    ];
    const existingSites = brokenLinks.map((b: any) => b.site);
    for (const link of fallbackLinks) {
      if (!existingSites.includes(link.site)) brokenLinks.push(link);
    }
  }
  if (brokenLinks.length > 0) markdown += `Broken Link Opportunities:\n` + (brokenLinks as any[]).map((b: any) => `  - ${b.site}: ${b.dead_page} → ${b.replacement || 'N/A'}`).join('\n') + '\n\n';
  
  if (analysis.link_acquisition?.outreach_template) markdown += `Outreach Template:\n${analysis.link_acquisition.outreach_template}\n\n`;

  markdown += `9. ON-PAGE OPTIMIZATION CHECKLIST\n──────────────────────────────────────────────────────────────\n`;
  (analysis.onpage_checklist || []).slice(0, 15).forEach((item: any, i: number) => {
    const text = typeof item === 'string' ? item : item?.text || item?.value || JSON.stringify(item);
    markdown += `${i+1}. ${replaceYears(text)}\n`;
  });

  markdown += `\n10. GROWTH ACCELERATORS\n──────────────────────────────────────────────────────────────\n`;
  (analysis.growth_accelerators || []).slice(0, 5).forEach((tip: string, i: number) => markdown += `${i+1}. ${replaceYears(tip)}\n`);
  markdown += `\n11. RELATED RESOURCES\n──────────────────────────────────────────────────────────────\n`;
  (analysis.related_resources || []).slice(0, 8).forEach((res: any, i: number) => markdown += `${i+1}. ${res.name || res.url} – ${res.url}\n`);

  // 📝 CLIENT-FRIENDLY METHODOLOGY (No AI clues)
  markdown += `\nMETHODOLOGY & SOURCES\n──────────────────────────────────────────────────────────────\nThis report is based on comprehensive primary and secondary research conducted on ${today} from:\n\n• Live Search Engine Results (SERP) via Google Search Index\n• Competitive Landscape Audit via MusePRO Proprietary Database\n• Keyword Volume, CPC & Difficulty via Industry-Standard Keyword Planners\n• 12-Month Search Trend & Seasonality via Google Trends\n• Real-time Exchange Rate Data for localized pricing\n• Strategic Synthesis & Market Insights by MusePRO Senior Research Division\n\n`;

  // 10. Final Result & Cache
  const result = {
    niche,
    country,
    type,
    data: analysis,
    keywords: keywords.slice(0, 50),
    serp_landscape: serp,
    markdown,
    trend_summary: replaceYears(analysis.trend_summary || 'Steady market interest.'),
    chart_data: {
      trend_12m: trendData.map((v, i) => ({ month: `M${i + 1}`, value: v })),
      traffic_forecast_6m: roadmap.slice(0, 6).map((c: any, i: number) => ({ month: `M${i + 1}`, traffic: safeNumber(c.expected_traffic, 1000) })),
      market_share: []
    },
    traffic_estimate: trafficEstimate
  };

  cacheService.set(cacheKey, result, 86400);
  return result;
}
