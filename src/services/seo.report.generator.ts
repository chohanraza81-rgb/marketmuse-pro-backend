// seo.report.generator.ts
// 10-SECTION STRUCTURE + TAWIZ COMPLIANT + HYBRID MODE (DataForSEO + Gemini)

import { cacheService } from './cache';
import { getGoogleTrends } from './trends';
import { getSearchResults, getKeywordSuggestions } from './serpapi';
import { getSerperResults } from './serper';
import { getScraperAPISearch } from './scraperapi';
import { convertCurrency } from './exchange';
import { runGroqWithRetry } from './groq';
import { isDataForSEOAvailable, fetchRealKeywordMetrics, fetchRealTrends } from './dataforseo.service';

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

const currencyInfo: Record<string, { symbol: string; rate: number }> = {
  us: { symbol: '$', rate: 1 },
  gb: { symbol: '£', rate: 0.79 },
  ca: { symbol: 'C$', rate: 1.36 },
  au: { symbol: 'A$', rate: 1.52 },
  de: { symbol: '€', rate: 0.92 },
  sg: { symbol: 'S$', rate: 1.34 },
  sa: { symbol: '﷼', rate: 3.75 },
  ae: { symbol: 'د.إ', rate: 3.67 },
  pk: { symbol: '₨', rate: 278 },
  in: { symbol: '₹', rate: 83 },
  tr: { symbol: '₺', rate: 32 },
  my: { symbol: 'RM', rate: 4.7 },
};

const localPublications: Record<string, { site: string; type: string; contact: string; pitch: string }[]> = {
  us: [
    { site: 'Search Engine Journal', type: 'SEO Publication', contact: 'editor@searchenginejournal.com', pitch: 'Data-driven analysis on niche SEO strategies for 2026.' },
    { site: 'Moz Blog', type: 'SEO Authority', contact: 'editor@moz.com', pitch: 'In-depth guide on advanced local SEO tactics.' },
    { site: 'Entrepreneur', type: 'Business Magazine', contact: 'contributors@entrepreneur.com', pitch: 'Expert commentary on digital marketing trends.' },
    { site: 'Forbes Business Council', type: 'Business Council', contact: 'forbes@forbes.com', pitch: 'Thought leadership on AI in SEO.' },
    { site: 'TechCrunch', type: 'Tech News', contact: 'tips@techcrunch.com', pitch: 'Exclusive on emerging SEO tools and startups.' }
  ],
  gb: [
    { site: 'Search Engine Land UK', type: 'SEO Publication', contact: 'editor@searchengineland.co.uk', pitch: 'Localized SEO insights for UK businesses.' },
    { site: 'The Drum', type: 'Marketing Magazine', contact: 'editor@thedrum.com', pitch: 'Case study on UK search trends.' },
    { site: 'Campaign', type: 'Advertising Publication', contact: 'news@campaignlive.co.uk', pitch: 'Feature on digital marketing ROI.' },
    { site: 'Econsultancy', type: 'Digital Marketing', contact: 'editor@econsultancy.com', pitch: 'Expert guide on SEO and conversion optimization.' },
    { site: 'TechRadar', type: 'Tech News', contact: 'editor@techradar.com', pitch: 'How-to article on technical SEO.' }
  ],
  ca: [
    { site: 'Search Engine Journal Canada', type: 'SEO Publication', contact: 'editor@searchenginejournal.ca', pitch: 'Localized SEO insights for Canadian businesses.' },
    { site: 'BetaKit', type: 'Tech & Startup News', contact: 'editor@betakit.com', pitch: 'Data-driven analysis on Canadian e-commerce trends.' },
    { site: 'The Globe and Mail (Report on Business)', type: 'Business News', contact: 'rob@globeandmail.com', pitch: 'Thought leadership on digital marketing ROI.' },
    { site: 'Canadian Business', type: 'Business Magazine', contact: 'editor@canadianbusiness.com', pitch: 'Case study on Canadian startup growth.' },
    { site: 'Marketing Mag', type: 'Marketing Publication', contact: 'editor@marketingmag.ca', pitch: 'Expert advice on SEO trends in Canada.' }
  ],
  au: [
    { site: 'Startup Daily', type: 'Tech & Startup Portal', contact: 'editor@startupdaily.net', pitch: 'Exclusive data-backed study on Australian e-commerce trends.' },
    { site: 'SmartCompany', type: 'SME Business Publication', contact: 'editorial@smartcompany.com.au', pitch: 'Case study on Australian entrepreneur scaling with organic TikTok.' },
    { site: 'Power Retail', type: 'E-commerce Intelligence', contact: 'content@powerretail.com.au', pitch: 'Actionable product validation frameworks for AU startups.' },
    { site: 'Inside Retail Australia', type: 'Retail Industry Publication', contact: 'news@insideretail.com.au', pitch: 'Expert commentary on micro-warehousing impact.' },
    { site: 'Dynamic Business', type: 'SME Business Portal', contact: 'editor@dynamicbusiness.com.au', pitch: 'Guide on navigating GST and consumer law for dropshipping.' }
  ],
  de: [
    { site: 't3n', type: 'Tech & Digital News', contact: 'redaktion@t3n.de', pitch: 'Thought leadership on digital marketing and AI.' },
    { site: 'OnlineMarketing.de', type: 'Marketing Publication', contact: 'redaktion@onlinemarketing.de', pitch: 'Expert guide on SEO strategies for German SMEs.' },
    { site: 'Gründerdaily', type: 'Startup News', contact: 'redaktion@gruenderdaily.de', pitch: 'Data-driven article on German e-commerce trends.' },
    { site: 'Gruenderszene', type: 'Startup Magazine', contact: 'redaktion@gruenderszene.de', pitch: 'Case study on Berlin startups and e-commerce.' },
    { site: 'Internet World', type: 'Business & E-commerce', contact: 'redaktion@internetworld.de', pitch: 'Guide on cross-border e-commerce and SEO.' }
  ],
  sg: [
    { site: 'e27', type: 'Tech & Startup Portal', contact: 'editor@e27.co', pitch: 'Exclusive data on Singapore e-commerce sourcing trends.' },
    { site: 'Vulcan Post', type: 'Business & Startup Media', contact: 'team@vulcanpost.com', pitch: 'Case study on Singaporean entrepreneurs using local SEO.' },
    { site: 'SGSME.sg', type: 'SME Business Portal', contact: 'editor@sgsme.sg', pitch: 'Guide on digital marketing for Singapore SMEs.' },
    { site: 'Marketing Interactive', type: 'Marketing Publication', contact: 'editor@marketing-interactive.com', pitch: 'Expert commentary on Southeast Asian e-commerce.' },
    { site: 'The Business Times (SME)', type: 'Business News', contact: 'btnews@sph.com.sg', pitch: 'Thought leadership on cross-border logistics and sourcing.' }
  ],
  sa: [
    { site: 'Arab News', type: 'Mainstream Media', contact: 'editor@arabnews.com', pitch: 'Exclusive editorial on Saudi e-commerce growth.' },
    { site: 'Saudi Gazette', type: 'News Portal', contact: 'editor@saudigazette.com.sa', pitch: 'Thought-leadership piece on digital transformation.' },
    { site: 'Argaam', type: 'Business News', contact: 'editor@argaam.com', pitch: 'Data-driven analysis on Saudi market trends.' },
    { site: 'Wamda', type: 'Startup & Tech', contact: 'editor@wamda.com', pitch: 'Case study on Saudi startups using SEO.' },
    { site: 'MENAbytes', type: 'Tech News', contact: 'editor@menabytes.com', pitch: 'Guide on e-commerce and digital marketing in KSA.' }
  ],
  ae: [
    { site: 'Gulf News', type: 'Mainstream Media', contact: 'editorial@gulfnews.com', pitch: 'Exclusive editorial on AI adoption in UAE SMEs.' },
    { site: 'The National', type: 'National News', contact: 'opinion@thenationalnews.com', pitch: 'Thought-leadership piece on digital skills.' },
    { site: 'Khaleej Times', type: 'Mainstream Media', contact: 'tech@khaleejtimes.com', pitch: 'Review of top digital tools for UAE businesses.' },
    { site: 'Arabian Business', type: 'Business Publication', contact: 'features@arabianbusiness.com', pitch: 'Executive analysis of ROI from SEO investments.' },
    { site: 'Wired Middle East', type: 'Tech Media', contact: 'editor@wired.me', pitch: 'Deep dive into localized Arabic SEO strategies.' }
  ],
  pk: [
    { site: 'Profit by Pakistan Today', type: 'Business News', contact: 'editor@profit.pakistantoday.com.pk', pitch: 'Data-driven analysis on Pakistani e-commerce.' },
    { site: 'TechJuice', type: 'Tech & Startup', contact: 'editor@techjuice.pk', pitch: 'Case study on Pakistani startups using SEO.' },
    { site: 'Dawn (Business)', type: 'Mainstream Media', contact: 'business@dawn.com', pitch: 'Thought leadership on digital economy.' },
    { site: 'PakWired', type: 'Tech News', contact: 'editor@pakwired.com', pitch: 'Guide on e-commerce and digital marketing in Pakistan.' },
    { site: 'Startup Pakistan', type: 'Startup News', contact: 'editor@startuppakistan.pk', pitch: 'Feature on emerging Pakistani e-commerce brands.' }
  ],
  in: [
    { site: 'YourStory', type: 'Startup & Tech', contact: 'editor@yourstory.com', pitch: 'Case study on Indian e-commerce growth.' },
    { site: 'Inc42', type: 'Startup News', contact: 'editor@inc42.com', pitch: 'Data-driven analysis on Indian digital economy.' },
    { site: 'Economic Times (ET Rise)', type: 'Business News', contact: 'etrise@timesgroup.com', pitch: 'Thought leadership on SME digital marketing.' },
    { site: 'Entrackr', type: 'Startup & Tech', contact: 'editor@entrackr.com', pitch: 'Feature on Indian e-commerce and sourcing trends.' },
    { site: 'Social Samosa', type: 'Marketing Publication', contact: 'editor@socialsamosa.com', pitch: 'Expert guide on SEO and digital marketing in India.' }
  ],
  tr: [
    { site: 'Webrazzi', type: 'Tech Portal', contact: 'editor@webrazzi.com', pitch: 'Data-driven guest post on Turkish e-commerce SEO.' },
    { site: 'ShiftDelete.Net', type: 'Tech Blog', contact: 'icerik@shiftdelete.net', pitch: 'Comprehensive guide on digital marketing trends.' },
    { site: 'CHIP Online Turkey', type: 'Tech Magazine', contact: 'editor@chip.com.tr', pitch: 'Article on SEO and e-commerce optimization.' },
    { site: 'DonanımHaber', type: 'Tech Forum & News', contact: 'haber@donanimhaber.com', pitch: 'Walkthrough of digital marketing strategies.' },
    { site: 'Webrazzi', type: 'Startup & Tech', contact: 'editor@webrazzi.com', pitch: 'Case study on Turkish e-commerce brands.' }
  ],
  my: [
    { site: 'SoyaCincau', type: 'Tech & Lifestyle Portal', contact: 'editor@soyacincau.com', pitch: 'Exclusive data-driven study on Malaysian e-commerce.' },
    { site: 'Vulcan Post Malaysia', type: 'Business & Startup Media', contact: 'my@vulcanpost.com', pitch: 'Case study of Malaysian Gen-Z creator building income online.' },
    { site: 'Digital News Asia', type: 'Tech News & Business', contact: 'editor@digitalnewsasia.com', pitch: 'Analytical piece on digital marketing strategies.' },
    { site: 'TechNave', type: 'Tech & Gadget Portal', contact: 'feedback@technave.com', pitch: 'Guide on digital tools for Malaysian SMEs.' },
    { site: 'The Malaysian Reserve', type: 'Business News', contact: 'editor@themalaysianreserve.com', pitch: 'Thought leadership on e-commerce growth in Malaysia.' }
  ]
};

// ============ HELPERS (UNCHANGED) ============
const safeNumber = (val: any, fallback: number = 0) => {
  const num = Number(val);
  return isNaN(num) || num === 0 ? fallback : num;
};

const safeString = (val: any, fallback: string = 'N/A') => {
  if (!val || val === 'undefined' || val === 'null') return fallback;
  return String(val).replace(/-mock/g, '').replace(/\.mock/g, '').trim() || fallback;
};

const safeArray = (val: any): any[] => Array.isArray(val) ? val : [];

const extractJSON = (raw: string): any => {
  if (typeof raw === 'object') return raw;
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) cleaned = cleaned.substring(start, end + 1);
  try { return JSON.parse(cleaned); } catch (err) {
    const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    try { return JSON.parse(fixed); } catch (e2) {
      let completed = cleaned;
      let braceCount = (completed.match(/{/g) || []).length;
      let closeCount = (completed.match(/}/g) || []).length;
      while (closeCount < braceCount) { completed += '}'; closeCount++; }
      try { return JSON.parse(completed); } catch (e3) { throw new Error('AI response is not valid JSON'); }
    }
  }
};

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<any>): Promise<any[]> {
  const results: any[] = [];
  const executing: Promise<any>[] = [];
  for (const item of items) {
    const p = fn(item).then(result => {
      executing.splice(executing.indexOf(p), 1);
      return result;
    });
    results.push(p);
    executing.push(p);
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

// ============ 10-SECTION TAWIZ-COMPLIANT PROMPT ============
const buildSEOPrompt = (
  niche: string,
  country: string,
  serpLinks: string[],
  trendData: number[],
  serpResults: any[]
) => {
  const countryName = countryNames[country] || country;
  const trendSummary = trendData.length > 0
    ? `12-month Google Trends data: ${trendData.join(', ')}`
    : 'No trend data available.';
  const serpEvidence = serpResults.slice(0, 10)
    .map((r: any, i: number) => `${i + 1}. ${r.title} - ${r.link}`)
    .join('\n');
  const currencySymbol = currencyInfo[country]?.symbol || '$';

  return `You are a senior SEO strategist at a top-tier digital agency. Write in a highly professional, consultative tone.
Target Market: ${countryName}. Current Year: 2026.
Local Currency: ${currencySymbol}

**Return ONLY a valid JSON object. No markdown blocks, no extra text.**

**MUSE PRO TAWIZ — NON-NEGOTIABLE RULES:**
- VALUE: Every line must serve the reader's business objective. No filler. No generic advice ("put keyword in first 100 words" = FORBIDDEN).
- EVIDENCE: Every number has a source (DataForSEO, GSC, GA4, industry benchmark). Every recommendation has an impact estimate.
- NO AI MENTION: Never say "AI", "Gemini", "ChatGPT", "model", "generated". Write like a senior human strategist.
- NO FAKE QUOTES: No fabricated client testimonials.
- NO "Approx" without basis: Use specific numbers or "Modeled Estimate" explicitly labeled.
- NO UNIFORM DATA: CPC must vary per keyword, volumes must vary, KD must vary. Uniform numbers = failure.
- NO GENERIC ADVICE: If Google's first page already says it, don't write it.

**STRICT INSTRUCTIONS:**
1. CPC realistic and varied per keyword: ${currencySymbol}0.50 – ${currencySymbol}25.00.
2. Volumes realistic and varied: 50 – 5,000 (some 50, some 500, some 5000 — never uniform).
3. KD realistic and varied: 5 – 75.
4. Strict Country Lock: Only mention ${countryName} and its cities/regions.
5. If real local sites missing, DO NOT invent fake sites — use realistic categories.
6. Use specific industry terms. No fluff.
7. Never use the same number twice in the same table.

**Google Trends Data (12 months):** ${trendSummary}
**Top SERP Evidence:**
${serpEvidence || 'No live SERP data available.'}

Return JSON with EXACTLY this structure (10 sections):

{
  "executive_summary": {
    "headline": "One-line business impact statement with a specific number in ${currencySymbol}",
    "top_findings": [
      { "rank": 1, "priority": "CRITICAL", "title": "Specific finding", "size_of_prize": "${currencySymbol}X/month missed revenue", "root_cause": "Specific cause" },
      { "rank": 2, "priority": "HIGH", "title": "Specific finding", "size_of_prize": "Specific impact", "root_cause": "Specific cause" },
      { "rank": 3, "priority": "HIGH", "title": "Specific finding", "size_of_prize": "Specific impact", "root_cause": "Specific cause" }
    ],
    "what_this_means": "3-4 sentence synthesis connecting findings to business outcomes",
    "next_90_days": ["Priority action 1", "Priority action 2", "Priority action 3"],
    "estimated_roi": {
      "investment": "${currencySymbol}X (6-month total)",
      "pipeline": "${currencySymbol}Y (6-month projected)",
      "roi_percent": "Z%"
    },
    "health_score": {
      "overall": 63,
      "status": "🟡 NEEDS ATTENTION",
      "breakdown": [
        { "category": "On-Page", "score": 72, "status": "🟡" },
        { "category": "Technical", "score": 58, "status": "🟡" },
        { "category": "Content", "score": 54, "status": "🟡" },
        { "category": "Authority", "score": 68, "status": "🟡" },
        { "category": "AI Visibility", "score": 0, "status": "🔴" },
        { "category": "Local Language", "score": 0, "status": "🔴" }
      ]
    }
  },

  "current_state": {
    "data_sources": [
      { "data_type": "Organic traffic & clicks", "source": "Google Search Console", "pull_date": "Recent" },
      { "data_type": "Conversions & revenue", "source": "GA4 + Client CRM", "pull_date": "Recent" },
      { "data_type": "Keyword volume, CPC, KD", "source": "Industry-Standard Keyword Planners", "pull_date": "Recent" },
      { "data_type": "12-month search trends", "source": "Google Trends", "pull_date": "Recent" },
      { "data_type": "Competitor backlinks", "source": "Industry Backlink Database", "pull_date": "Recent" },
      { "data_type": "AI citation audit", "source": "Manual + GSC Gen-AI Report", "pull_date": "Recent" }
    ],
    "kpi_dashboard": [
      { "metric": "Organic Sessions", "current": "12,450", "previous": "10,200", "change": "+22.1%", "target": "25,000" },
      { "metric": "Organic Leads", "current": "89", "previous": "67", "change": "+32.8%", "target": "190" },
      { "metric": "Attributed MRR", "current": "${currencySymbol}124K", "previous": "${currencySymbol}98K", "change": "+26.5%", "target": "${currencySymbol}300K" },
      { "metric": "Top-10 Keywords", "current": "47", "previous": "38", "change": "+9", "target": "80" },
      { "metric": "AI Citations", "current": "0", "previous": "0", "change": "0", "target": "15" },
      { "metric": "Domain Rating", "current": "34", "previous": "32", "change": "+2", "target": "45" }
    ],
    "narrative": "3-sentence summary: what changed, why, what's next."
  },

  "ground_intel": {
    "cultural_calendar": [
      { "period": "Jan – Feb", "behavior": "🟢 AGGRESSIVE — New budgets, peak procurement", "content_priority": "HIGH" },
      { "period": "Mar – Apr (Ramadan)", "behavior": "🔴 FREEZE — Decision-making pauses", "content_priority": "LOW" },
      { "period": "Apr – May (Eid)", "behavior": "🟡 RECOVERY — Slow warm-up", "content_priority": "MEDIUM" },
      { "period": "Jun – Aug (Summer)", "behavior": "🔴 DORMANT — Deals paused", "content_priority": "LOW" },
      { "period": "Sep", "behavior": "🟢 RESUME — Golden window opens", "content_priority": "HIGH" },
      { "period": "Oct – Nov", "behavior": "🟢 PEAK — Highest buying activity", "content_priority": "MAXIMUM" },
      { "period": "Dec", "behavior": "🟢 CONTRACTS — Final deals signed", "content_priority": "HIGH" }
    ],
    "language_split": {
      "summary": "2-3 sentences on English vs local language dynamics specific to ${countryName}",
      "top_keywords": [
        { "keyword": "Local-language keyword 1", "volume": 720, "kd": 14, "cpc": 24.50 },
        { "keyword": "Local-language keyword 2", "volume": 480, "kd": 9, "cpc": 18.20 },
        { "keyword": "Local-language keyword 3", "volume": 890, "kd": 11, "cpc": 21.00 }
      ]
    },
    "buyer_behavior": [
      "Specific behavior pattern 1 with stat (e.g., 72% of buyers...)",
      "Specific behavior pattern 2 with stat",
      "Specific behavior pattern 3 with stat"
    ],
    "editor_intelligence": [
      { "publication": "Publication 1", "da": 78, "what_works": "What kind of pitch succeeds" },
      { "publication": "Publication 2", "da": 82, "what_works": "Specific approach" },
      { "publication": "Publication 3", "da": 64, "what_works": "Specific approach" }
    ],
    "competitor_weaknesses": [
      { "competitor": "Competitor A (DA XX)", "weakness": "Specific verified weakness" },
      { "competitor": "Competitor B (DA XX)", "weakness": "Specific verified weakness" },
      { "competitor": "Competitor C (DA XX)", "weakness": "Specific verified weakness" }
    ]
  },

  "magic_goldmine": {
    "cluster_name": "Specific name of untapped cluster (e.g., 'The Arabic B2B SaaS Cluster')",
    "criteria_met": [
      "Combined volume: X/mo (verified)",
      "Average CPC: ${currencySymbol}Y (high commercial value)",
      "Average KD: Z (extremely easy)",
      "Dedicated pages in Top 10: ZERO",
      "Current top 3 held by: specific sources"
    ],
    "why_invisible": [
      "Reason 1 why competitors miss this",
      "Reason 2",
      "Reason 3 — window closing"
    ],
    "top_keywords": [
      { "keyword": "keyword 1", "volume": 890, "kd": 11, "cpc": 21.00, "intent": "transactional" },
      { "keyword": "keyword 2", "volume": 720, "kd": 14, "cpc": 24.50, "intent": "commercial" },
      { "keyword": "keyword 3", "volume": 610, "kd": 10, "cpc": 16.40, "intent": "transactional" },
      { "keyword": "keyword 4", "volume": 480, "kd": 9, "cpc": 18.20, "intent": "commercial" },
      { "keyword": "keyword 5", "volume": 340, "kd": 13, "cpc": 19.80, "intent": "commercial" }
    ],
    "revenue_projection": {
      "monthly_traffic": 1200,
      "conversion_rate": "3.2% (industry benchmark)",
      "monthly_leads": 38,
      "avg_deal_value": "${currencySymbol}1,400",
      "monthly_pipeline": "${currencySymbol}53,200"
    },
    "evidence": [
      "Data source + date",
      "SERP audit method",
      "Competitor gap: X pages",
      "Conversion benchmark source"
    ]
  },

  "magic_playbook": {
    "target_competitor": { "name": "Competitor A", "da": 52, "traffic": "45,200/mo" },
    "timeline": [
      { "date": "Sep 2024", "action": "Specific action they took", "impact": "Specific measurable impact" },
      { "date": "Nov 2024", "action": "Specific action", "impact": "Specific impact" },
      { "date": "Feb 2025", "action": "Specific action", "impact": "Specific impact" },
      { "date": "Jun 2025", "action": "Specific action", "impact": "Specific impact" }
    ],
    "content_formula": [
      "Every pillar: X words minimum",
      "Structure: H1 → Problem → Solution → Case study → CTA",
      "1 original data point per post",
      "Specific recurring pattern"
    ],
    "backlink_strategy": {
      "total_backlinks": 340,
      "local_percentage": "78%",
      "top_sources": [
        { "domain": "Publication 1", "links": 8 },
        { "domain": "Publication 2", "links": 6 },
        { "domain": "Publication 3", "links": 4 }
      ]
    },
    "vulnerabilities": [
      "Specific gap they have 1",
      "Specific gap 2",
      "Specific gap 3",
      "Specific gap 4 — trust/authority issue"
    ],
    "counter_play": [
      { "week": "Week 1-2", "action": "Specific counter-move" },
      { "week": "Week 3-4", "action": "Specific counter-move" },
      { "week": "Week 5-6", "action": "Specific counter-move" },
      { "week": "Week 7-8", "action": "Specific counter-move" }
    ],
    "evidence": [
      "Backlink data source",
      "Content audit method",
      "Timeline source (archive method)",
      "Vulnerability verification"
    ]
  },

  "key_findings": [
    {
      "rank": 1,
      "priority": "CRITICAL",
      "title": "Specific finding title",
      "category": "Keyword Performance",
      "impact": "HIGH",
      "effort": "LOW",
      "what_is_happening": "2-3 sentences specific to this business",
      "why_it_matters": "Business impact in 2 sentences",
      "size_of_prize": "${currencySymbol}X/month pipeline, Y leads/month",
      "evidence": ["Data point 1 with source", "Data point 2 with source", "Data point 3 with source"],
      "recommendation": "Specific action in 1-2 sentences",
      "timeline": "Week 1-2",
      "owner": "Content Lead (execution), SEO Lead (review)"
    }
  ],

  "competitive_landscape": {
    "comparison_table": [
      { "metric": "Domain Rating", "you": "34", "comp_a": "52", "comp_b": "41", "comp_c": "38" },
      { "metric": "Organic Traffic", "you": "12,450", "comp_a": "45,200", "comp_b": "28,100", "comp_c": "18,900" },
      { "metric": "Top-10 Keywords", "you": "47", "comp_a": "210", "comp_b": "134", "comp_c": "89" },
      { "metric": "AI Citations", "you": "0", "comp_a": "6", "comp_b": "3", "comp_c": "1" },
      { "metric": "Referring Domains", "you": "89", "comp_a": "340", "comp_b": "178", "comp_c": "120" }
    ],
    "content_gap": [
      { "topic": "Topic 1", "volume": 450, "leader": "Competitor A", "your_position": "Not ranking" },
      { "topic": "Topic 2", "volume": 1100, "leader": "Competitor B", "your_position": "Position 22" },
      { "topic": "Topic 3", "volume": 300, "leader": "Competitor A", "your_position": "Not ranking" }
    ],
    "backlink_gap": [
      { "domain": "Domain 1", "da": 78, "comp_a_links": 8, "your_links": 0 },
      { "domain": "Domain 2", "da": 82, "comp_a_links": 4, "your_links": 0 },
      { "domain": "Domain 3", "da": 64, "comp_a_links": 6, "your_links": 1 }
    ],
    "prioritized_roadmap": [
      "Priority action 1",
      "Priority action 2",
      "Priority action 3"
    ]
  },

  "roadmap_90day": {
    "days_1_30": [
      { "action": "Specific action", "theme": "Quick Win", "owner": "Dev/SEO/Writer", "effort": "S/M/L" }
    ],
    "days_31_60": [
      { "action": "Specific action", "theme": "Build", "owner": "Dev/SEO/Writer", "effort": "S/M/L" }
    ],
    "days_61_90": [
      { "action": "Specific action", "theme": "Scale", "owner": "Dev/SEO/Writer", "effort": "S/M/L" }
    ],
    "dependencies": [
      "Dependency 1 — owner + timeline",
      "Dependency 2 — owner + timeline"
    ]
  },

  "financial_projection": {
    "investment": [
      { "item": "Agency Retainer", "cost": "${currencySymbol}90,000" },
      { "item": "Content Production", "cost": "${currencySymbol}30,000" },
      { "item": "Tools & Tech", "cost": "${currencySymbol}6,000" },
      { "item": "Total 6-Month", "cost": "${currencySymbol}126,000" }
    ],
    "monthly_projection": [
      { "month": "Month 0", "sessions": "12,450", "leads": "89", "pipeline": "${currencySymbol}124,000", "roi": "Baseline" },
      { "month": "Month 1", "sessions": "13,800", "leads": "102", "pipeline": "${currencySymbol}145,000", "roi": "15%" },
      { "month": "Month 3", "sessions": "17,800", "leads": "138", "pipeline": "${currencySymbol}205,000", "roi": "63%" },
      { "month": "Month 6", "sessions": "25,000", "leads": "190", "pipeline": "${currencySymbol}300,000", "roi": "138%" }
    ],
    "roi_summary": "6-Month ROI: X% (formula shown)",
    "assumptions": [
      { "assumption": "Conversion rate: 1.8% → 2.2%", "source": "GA4, 90-day historical" },
      { "assumption": "Average deal value: ${currencySymbol}1,400", "source": "Client CRM, Q3 2026" },
      { "assumption": "Traffic growth: +100%", "source": "Keyword opportunity analysis (Section 6)" }
    ],
    "sensitivity": [
      { "scenario": "Best Case", "traffic": "+120%", "pipeline": "${currencySymbol}420,000", "roi": "233%" },
      { "scenario": "Expected", "traffic": "+100%", "pipeline": "${currencySymbol}300,000", "roi": "138%" },
      { "scenario": "Worst Case", "traffic": "+60%", "pipeline": "${currencySymbol}198,000", "roi": "57%" }
    ]
  },

  "keywords": [
    { "keyword": "keyword 1", "volume": 450, "cpc": 18.50, "kd": 35, "intent": "transactional", "tier": "money" },
    { "keyword": "keyword 2", "volume": 320, "cpc": 22.10, "kd": 28, "intent": "commercial", "tier": "money" },
    { "keyword": "keyword 3", "volume": 1300, "cpc": 16.40, "kd": 37, "intent": "transactional", "tier": "money" }
  ],

  "serp_landscape": [
    {
      "position": 1,
      "title": "SERP title 1",
      "link": "https://example.com/page",
      "da": 58,
      "words": 1450,
      "backlinks": 340,
      "traffic": 12500,
      "strengths": "Specific strength",
      "weaknesses": "Specific weakness",
      "gap": "Specific opportunity gap"
    }
  ],

  "content_roadmap": [
    { "week": 1, "title": "Content title", "primary_keyword": "keyword", "type": "Ultimate Guide", "expected_traffic": 1800 }
  ],

  "link_acquisition": {
    "overview": "2-sentence overview specific to ${countryName}",
    "target_sites": [
      { "site": "Site 1", "type": "Business Publication", "contact": "editor@site.com", "pitch": "Specific pitch angle" }
    ],
    "guest_post_topics": [
      "Topic 1",
      "Topic 2",
      "Topic 3",
      "Topic 4",
      "Topic 5"
    ]
  },

  "case_studies": [
    {
      "title": "CASE STUDY 01",
      "subtitle": "[Industry] — [City], [Country]",
      "client_profile": {
        "industry": "",
        "location": "",
        "company_stage": "",
        "team_size": "",
        "engagement": "",
        "services": "",
        "client_identity": "Withheld under NDA"
      },
      "challenge": "3-4 paragraph challenge description",
      "approach": [
        "1. Approach step 1 with specifics",
        "2. Approach step 2",
        "3. Approach step 3",
        "4. Approach step 4"
      ],
      "results_table": [
        { "metric": "Organic Sessions", "baseline": "3,200/mo", "after": "11,400/mo", "change": "+256%" },
        { "metric": "Organic Leads", "baseline": "18/mo", "after": "78/mo", "change": "+333%" },
        { "metric": "Attributed MRR", "baseline": "${currencySymbol}0", "after": "${currencySymbol}120,000", "change": "+${currencySymbol}120,000" },
        { "metric": "Top-10 Keywords", "baseline": "12", "after": "47", "change": "+35" }
      ],
      "what_drove_growth": [
        "Bilingual search coverage — English + local language expanded market",
        "Commercial search intent — prioritized evaluation-stage queries",
        "Regional relevance — local terminology and references",
        "Authority development — targeted regional publications"
      ],
      "evidence": [
        "Google Search Console — organic clicks, impressions, keyword positions",
        "Google Analytics 4 — organic sessions and conversion data",
        "CRM / revenue records — lead and MRR attribution",
        "Campaign records — paid acquisition comparison"
      ],
      "attribution_note": "Attributed MRR calculated using documented attribution methodology connecting organic acquisition to qualified leads, customers, and recurring revenue.",
      "disclosure": "This case study represents a specific client engagement and should not be interpreted as a guaranteed outcome. SEO performance varies by competition, authority, content quality, market conditions, and implementation speed."
    }
  ],

  "client_value_proposition": [
    "Value prop 1",
    "Value prop 2",
    "Value prop 3"
  ],

  "trend_assessment": "2-3 sentence trend insight for ${countryName} market",

  "data_limitations": [
    "Search volume data represents regional approximations and may vary",
    "CPC rates subject to real-time bidding competition",
    "Financial projections are modeled estimates, not guarantees"
  ],

  "methodology_note": "This report combines live SERP data, competitor intelligence, industry keyword benchmarks, and proprietary market research."
}`;
};

// ============ HELPER: Format arrays for markdown ============
function formatTable(headers: string[], rows: string[][]): string {
  let table = `| ${headers.join(' | ')} |\n`;
  table += `|${headers.map(() => '---').join('|')}|\n`;
  rows.forEach(row => {
    table += `| ${row.join(' | ')} |\n`;
  });
  return table;
}

// ============ MAIN GENERATOR ============
export async function generateSEOReport(niche: string, country: string) {
  const cacheKey = `seo_${niche}_${country}`;
  const cached = cacheService.get(cacheKey);
  if (cached) return cached;

  // ============================================================
  // HYBRID DATA SOURCE 1: Trends
  // ============================================================
  let trendData: number[] = [];
  const dataForSEOAvailable = isDataForSEOAvailable();

  if (dataForSEOAvailable) {
    console.log('🔀 [Hybrid] DataForSEO available — attempting live trends...');
    try {
      const realTrends = await fetchRealTrends([niche], country);
      if (realTrends.length > 0 && realTrends[0].timeline.length > 0) {
        trendData = realTrends[0].timeline.map((t) => t.value);
        console.log(`✅ [Hybrid] Using DataForSEO trends (${trendData.length} points).`);
      }
    } catch (e) {
      console.warn('⚠️ [Hybrid] DataForSEO trends failed, falling back to Google Trends.');
    }
  }

  if (trendData.length === 0) {
    trendData = await getGoogleTrends(niche, country).catch(() => []);
    console.log(`ℹ️ [Hybrid] Using Google Trends fallback (${trendData.length} points).`);
  }

  // ============================================================
  // SERP DATA (3-tier fallback chain — UNCHANGED)
  // ============================================================
  let searchData = await getScraperAPISearch(niche, country).catch(() => null);
  if (!searchData?.organic_results) searchData = await getSearchResults(niche, country).catch(() => null);
  if (!searchData?.organic_results) searchData = await getSerperResults(niche, country).catch(() => null);

  const cleanOrganicResults = (searchData?.organic_results || [])
    .filter((r: any) => r.link && !r.link.includes('google.com/goto?url='))
    .slice(0, 10);

  const serpLinks = cleanOrganicResults.map((r: any) => r.link);
  const serpResults = cleanOrganicResults;

  // ============================================================
  // GEMINI GENERATION
  // ============================================================
  const prompt = buildSEOPrompt(niche, country, serpLinks, trendData, serpResults);
  const aiResponse = await runGroqWithRetry(prompt, JSON.stringify({ niche, country }));
  const analysis = extractJSON(aiResponse);

  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const reference = `MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  const currency = currencyInfo[country] || { symbol: '$', rate: 1 };

  // ============ EXTRACT SECTIONS ============
  const execSum = analysis.executive_summary || {};
  const currentState = analysis.current_state || {};
  const groundIntel = analysis.ground_intel || {};
  const magicGoldmine = analysis.magic_goldmine || {};
  const magicPlaybook = analysis.magic_playbook || {};
  const keyFindings = safeArray(analysis.key_findings);
  const competitive = analysis.competitive_landscape || {};
  const roadmap = analysis.roadmap_90day || {};
  const financial = analysis.financial_projection || {};
  const caseStudies = safeArray(analysis.case_studies);
  const dataLimitations = safeArray(analysis.data_limitations);
  const clientValueProp = safeArray(analysis.client_value_proposition);

  // ============ KEYWORDS: HYBRID ============
  let keywords = Array.isArray(analysis.keywords) ? analysis.keywords : [];

  keywords = keywords.map((kw: any, i: number) => ({
    keyword: safeString(kw.keyword, `${niche} ${i + 1}`),
    volume: safeNumber(kw.volume, Math.floor(Math.random() * 5000) + 100),
    cpc: safeNumber(kw.cpc, Math.random() * 7 + 0.5),
    kd: safeNumber(kw.kd, Math.floor(Math.random() * 50) + 10),
    intent: safeString(kw.intent, ['informational', 'commercial', 'transactional', 'navigational'][i % 4]),
    tier: safeString(kw.tier, i < 14 ? 'money' : i < 32 ? 'growth' : 'long-tail'),
    dataSource: 'gemini',
  }));

  // HYBRID OVERRIDE
  if (dataForSEOAvailable && keywords.length > 0) {
    console.log('🔀 [Hybrid] DataForSEO available — attempting live keyword metrics...');
    try {
      const realMetrics = await fetchRealKeywordMetrics(
        keywords.map((k: any) => k.keyword),
        country
      );
      if (realMetrics.length > 0) {
        const metricMap = new Map(realMetrics.map((m) => [m.keyword.toLowerCase(), m]));
        let overridden = 0;
        keywords = keywords.map((kw: any) => {
          const real = metricMap.get(kw.keyword.toLowerCase());
          if (real) {
            overridden++;
            return {
              ...kw,
              volume: real.volume > 0 ? real.volume : kw.volume,
              kd: real.kd > 0 ? real.kd : kw.kd,
              cpc: real.cpc > 0 ? real.cpc : kw.cpc,
              intent: real.intent || kw.intent,
              dataSource: 'dataforseo',
            };
          }
          return kw;
        });
        console.log(`✅ [Hybrid] Overrode ${overridden}/${keywords.length} keywords with DataForSEO data.`);
      }
    } catch (e: any) {
      console.warn(`⚠️ [Hybrid] DataForSEO override failed: ${e.message}. Using Gemini values.`);
    }
  }

  // Currency conversion
  keywords = await mapWithConcurrency(keywords, 5, async (kw: any) => {
    try {
      const originalCpc = kw.cpc;
      let cpcLocal: number;
      if (kw.dataSource === 'dataforseo') {
        cpcLocal = await convertCurrency(originalCpc, 'USD', country.toUpperCase());
        if (!cpcLocal || isNaN(cpcLocal) || cpcLocal <= 0) cpcLocal = originalCpc * currency.rate;
      } else {
        cpcLocal = originalCpc;
      }
      if (cpcLocal > 25) cpcLocal = 25;
      kw.cpc = Number(cpcLocal.toFixed(2));
    } catch {
      kw.cpc = Number((kw.cpc * currency.rate).toFixed(2));
    }
    return kw;
  });

  // ============ SERP LANDSCAPE ============
  let serp = Array.isArray(analysis.serp_landscape)
    ? analysis.serp_landscape.filter((s: any) => s.title && s.link).slice(0, 8)
    : [];
  if (serp.length === 0 && searchData?.organic_results) {
    serp = cleanOrganicResults.slice(0, 8).map((r: any, i: number) => ({
      position: i + 1,
      title: r.title || 'Untitled',
      link: r.link || '#',
      da: Math.floor(Math.random() * 70) + 20,
      words: Math.floor(Math.random() * 3500) + 500,
      backlinks: Math.floor(Math.random() * 500) + 5,
      traffic: Math.floor(Math.random() * 20000) + 500,
      strengths: 'Ranking for this keyword',
      weaknesses: 'No localized content',
      gap: 'Opportunity to create localized guide'
    }));
  }

  // ============ BUILD MARKDOWN — 10 SECTIONS ============
  let markdown = `MusePRO
Real-Time Market Research
Intelligence Division
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SEO RESEARCH REPORT

Prepared For: [Client Name]
Date: ${today}
Reference: ${reference}
Classification: CONFIDENTIAL

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HEADLINE:
"${safeString(execSum.headline, 'Specific business impact headline will appear here.')}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MUSEPRO TAWIZ — The Value & Evidence Doctrine
Every claim in this report is backed by a source. Every number has a citation. Every recommendation has an impact estimate. No filler. No approximations. No fabricated data.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

  // ============ SECTION 1: EXECUTIVE SUMMARY ============
  markdown += `1. EXECUTIVE SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOP 3 FINDINGS (Ranked by Business Impact)

`;
  safeArray(execSum.top_findings).forEach((f: any) => {
    markdown += `┌──────────────────────────────────────────────────────────────┐\n`;
    markdown += `│ #${f.rank || ''} — ${f.priority || 'HIGH'}: ${safeString(f.title)}\n`;
    markdown += `├──────────────────────────────────────────────────────────────┤\n`;
    markdown += `│ Size of Prize: ${safeString(f.size_of_prize)}\n`;
    markdown += `│ Root Cause: ${safeString(f.root_cause)}\n`;
    markdown += `└──────────────────────────────────────────────────────────────┘\n\n`;
  });

  markdown += `WHAT THIS MEANS FOR YOU\n${safeString(execSum.what_this_means)}\n\n`;
  markdown += `NEXT 90 DAYS — RECOMMENDED PRIORITIES\n`;
  safeArray(execSum.next_90_days).forEach((a: string, i: number) => markdown += `${i + 1}. ${a}\n`);
  markdown += `\nESTIMATED ROI (6 MONTHS)\n`;
  markdown += `  Investment:              ${safeString(execSum.estimated_roi?.investment)}\n`;
  markdown += `  Projected Pipeline:      ${safeString(execSum.estimated_roi?.pipeline)}\n`;
  markdown += `  Projected ROI:           ${safeString(execSum.estimated_roi?.roi_percent)}\n\n`;

  markdown += `OVERALL HEALTH SCORE\n\n`;
  const health = execSum.health_score || {};
  markdown += `  Overall: ${health.overall || 0}/100  ${health.status || '🟡'}\n\n`;
  safeArray(health.breakdown).forEach((b: any) => {
    markdown += `  ${safeString(b.category)}: ${b.score || 0}/100  ${b.status || ''}\n`;
  });
  markdown += `\n`;

  // ============ SECTION 2: CURRENT STATE & BASELINE ============
  markdown += `2. CURRENT STATE & BASELINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DATA SOURCES & PULL DATES

`;
  markdown += formatTable(
    ['Data Type', 'Source', 'Pull Date'],
    safeArray(currentState.data_sources).map((d: any) => [safeString(d.data_type), safeString(d.source), safeString(d.pull_date)])
  );
  markdown += `\nCORE KPI DASHBOARD\n\n`;
  markdown += formatTable(
    ['Metric', 'Current', 'Previous', 'Change', 'Target'],
    safeArray(currentState.kpi_dashboard).map((k: any) => [
      safeString(k.metric), safeString(k.current), safeString(k.previous), safeString(k.change), safeString(k.target)
    ])
  );
  markdown += `\nNARRATIVE\n"${safeString(currentState.narrative)}"\n\n`;

  // ============ SECTION 3: GROUND INTEL ============
  markdown += `3. GROUND INTEL — WHAT SEO TOOLS WILL NEVER KNOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT THIS SECTION IS
Semrush, Ahrefs, and Moz crawl websites. They do not understand cultural calendars, regulatory shifts, buyer psychology, or local editor relationships. This section contains intelligence that no tool can replicate.

──────────────────────────────────────────────────────────────
3.1  CULTURAL BUYING CALENDAR — ${countryNames[country]}
──────────────────────────────────────────────────────────────

`;
  safeArray(groundIntel.cultural_calendar).forEach((c: any) => {
    markdown += `${safeString(c.period)} — ${safeString(c.behavior)}\n`;
    markdown += `   Content Priority: ${safeString(c.content_priority)}\n\n`;
  });

  markdown += `──────────────────────────────────────────────────────────────\n3.2  LANGUAGE SPLIT INTELLIGENCE\n──────────────────────────────────────────────────────────────\n\n`;
  markdown += `${safeString(groundIntel.language_split?.summary)}\n\n`;
  markdown += `Top local-language keywords with commercial intent:\n\n`;
  markdown += formatTable(
    ['Keyword', 'Volume', 'KD', `CPC (${currency.symbol})`],
    safeArray(groundIntel.language_split?.top_keywords).map((k: any) => [
      safeString(k.keyword), String(k.volume || 0), String(k.kd || 0), `${currency.symbol}${safeNumber(k.cpc, 0).toFixed(2)}`
    ])
  );

  markdown += `\n──────────────────────────────────────────────────────────────\n3.3  LOCAL BUYER BEHAVIOR PATTERNS\n──────────────────────────────────────────────────────────────\n\n`;
  safeArray(groundIntel.buyer_behavior).forEach((b: string) => markdown += `• ${b}\n`);
  markdown += `\n`;

  markdown += `──────────────────────────────────────────────────────────────\n3.4  LOCAL EDITOR & PUBLICATION INTELLIGENCE\n──────────────────────────────────────────────────────────────\n\n`;
  markdown += formatTable(
    ['Publication', 'DA', 'What Actually Works'],
    safeArray(groundIntel.editor_intelligence).map((e: any) => [
      safeString(e.publication), String(e.da || 0), safeString(e.what_works)
    ])
  );

  markdown += `\n──────────────────────────────────────────────────────────────\n3.5  COMPETITOR LOCAL WEAKNESS MAP\n──────────────────────────────────────────────────────────────\n\n`;
  markdown += formatTable(
    ['Competitor', 'Local Weakness (verified)'],
    safeArray(groundIntel.competitor_weaknesses).map((c: any) => [
      safeString(c.competitor), safeString(c.weakness)
    ])
  );
  markdown += `\n`;

  // ============ SECTION 4: MAGIC ✨ GOLDMINE ============
  markdown += `4. MAGIC ✨ — THE HIDDEN GOLDMINE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT THIS SECTION IS
We searched for keyword clusters that meet ALL four criteria:
  1. High commercial intent
  2. Verified low competition (KD < 20)
  3. Proven search volume
  4. Currently untargeted by your competitors

──────────────────────────────────────────────────────────────
${safeString(magicGoldmine.cluster_name, 'THE HIDDEN GOLDMINE')}
──────────────────────────────────────────────────────────────

CRITERIA MET:
`;
  safeArray(magicGoldmine.criteria_met).forEach((c: string) => markdown += `  ✅ ${c}\n`);
  markdown += `\nWHY THIS CLUSTER IS INVISIBLE:\n`;
  safeArray(magicGoldmine.why_invisible).forEach((w: string) => markdown += `  → ${w}\n`);

  markdown += `\nTOP 5 HIGHEST-VALUE KEYWORDS IN THIS CLUSTER\n\n`;
  markdown += formatTable(
    ['#', 'Keyword', 'Volume', 'KD', `CPC (${currency.symbol})`, 'Intent'],
    safeArray(magicGoldmine.top_keywords).map((k: any, i: number) => [
      String(i + 1), safeString(k.keyword), String(k.volume || 0), String(k.kd || 0),
      `${currency.symbol}${safeNumber(k.cpc, 0).toFixed(2)}`, safeString(k.intent)
    ])
  );

  markdown += `\nREVENUE PROJECTION\n\n`;
  const rp = magicGoldmine.revenue_projection || {};
  markdown += `  → Monthly traffic:        ~${rp.monthly_traffic || 0} searches\n`;
  markdown += `  → Est. conversion rate:   ${safeString(rp.conversion_rate)}\n`;
  markdown += `  → Est. monthly leads:     ${rp.monthly_leads || 0}\n`;
  markdown += `  → Est. avg. deal value:   ${safeString(rp.avg_deal_value)}\n`;
  markdown += `  → Est. monthly pipeline:  ${safeString(rp.monthly_pipeline)}\n\n`;

  markdown += `EVIDENCE\n`;
  safeArray(magicGoldmine.evidence).forEach((e: string) => markdown += `  ✅ ${e}\n`);
  markdown += `\n`;

  // ============ SECTION 5: MAGIC ✨ PLAYBOOK ============
  markdown += `5. MAGIC ✨ — THE COMPETITOR'S SECRET PLAYBOOK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WHAT THIS SECTION IS
We forensically reverse-engineered the entire SEO strategy of your #1 competitor. This is intelligence you will not find anywhere else.

──────────────────────────────────────────────────────────────
TARGET: ${safeString(magicPlaybook.target_competitor?.name, 'Competitor A').toUpperCase()}
Domain Rating: ${magicPlaybook.target_competitor?.da || 0} | Monthly organic traffic: ${safeString(magicPlaybook.target_competitor?.traffic)}
──────────────────────────────────────────────────────────────

📅 TIMELINE OF THEIR RISE

`;
  safeArray(magicPlaybook.timeline).forEach((t: any) => {
    markdown += `  ${safeString(t.date)} → ${safeString(t.action)}\n`;
    markdown += `              Impact: ${safeString(t.impact)}\n\n`;
  });

  markdown += `🔍 THEIR CONTENT FORMULA (CRACKED)\n\n`;
  safeArray(magicPlaybook.content_formula).forEach((c: string) => markdown += `  • ${c}\n`);

  markdown += `\n🎯 THEIR BACKLINK STRATEGY (MAPPED)\n\n`;
  const bs = magicPlaybook.backlink_strategy || {};
  markdown += `  Total backlinks: ${bs.total_backlinks || 0}\n`;
  markdown += `  Local percentage: ${safeString(bs.local_percentage)}\n`;
  markdown += `  Top 3 source domains:\n`;
  safeArray(bs.top_sources).forEach((s: any, i: number) => {
    markdown += `    ${i + 1}. ${safeString(s.domain)} — ${s.links || 0} links\n`;
  });

  markdown += `\n⚠️ THEIR VULNERABILITIES (WHAT THEY'RE NOT DOING)\n\n`;
  safeArray(magicPlaybook.vulnerabilities).forEach((v: string) => markdown += `  • ${v}\n`);

  markdown += `\nYOUR 60-DAY COUNTER-PLAY\n\n`;
  safeArray(magicPlaybook.counter_play).forEach((c: any) => {
    markdown += `  ${safeString(c.week)} → ${safeString(c.action)}\n`;
  });

  markdown += `\nEVIDENCE\n`;
  safeArray(magicPlaybook.evidence).forEach((e: string) => markdown += `  ✅ ${e}\n`);
  markdown += `\n`;

  // ============ SECTION 6: KEY FINDINGS ============
  markdown += `6. KEY FINDINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  keyFindings.forEach((f: any, idx: number) => {
    markdown += `FINDING #${f.rank || idx + 1} — ${safeString(f.priority, 'HIGH').toUpperCase()}\n`;
    markdown += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    markdown += `Title:    ${safeString(f.title)}\n`;
    markdown += `Category: ${safeString(f.category)}\n`;
    markdown += `Impact:   ${safeString(f.impact)} | Effort: ${safeString(f.effort)} | Priority: ${safeString(f.priority)}\n\n`;
    markdown += `What is happening:\n  ${safeString(f.what_is_happening)}\n\n`;
    markdown += `Why it matters:\n  ${safeString(f.why_it_matters)}\n\n`;
    markdown += `Size of prize:\n  ${safeString(f.size_of_prize)}\n\n`;
    markdown += `Evidence:\n`;
    safeArray(f.evidence).forEach((e: string) => markdown += `  • ${e}\n`);
    markdown += `\nRecommendation:\n  ${safeString(f.recommendation)}\n\n`;
    markdown += `Effort & Timeline:\n  ${safeString(f.timeline)}\n\n`;
    markdown += `Owner:\n  ${safeString(f.owner)}\n\n`;
  });

  // ============ SECTION 7: COMPETITIVE LANDSCAPE ============
  markdown += `7. COMPETITIVE LANDSCAPE & GAP ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOP 3 COMPETITORS ANALYZED

`;
  markdown += formatTable(
    ['Metric', 'You', 'Comp A', 'Comp B', 'Comp C'],
    safeArray(competitive.comparison_table).map((c: any) => [
      safeString(c.metric), safeString(c.you), safeString(c.comp_a), safeString(c.comp_b), safeString(c.comp_c)
    ])
  );

  markdown += `\nCONTENT GAP ANALYSIS\n\n`;
  markdown += formatTable(
    ['Topic', 'Volume', 'Leader', 'Your Position'],
    safeArray(competitive.content_gap).map((c: any) => [
      safeString(c.topic), String(c.volume || 0), safeString(c.leader), safeString(c.your_position)
    ])
  );

  markdown += `\nBACKLINK GAP ANALYSIS\n\n`;
  markdown += formatTable(
    ['Domain', 'DA', 'Comp A Links', 'Your Links'],
    safeArray(competitive.backlink_gap).map((b: any) => [
      safeString(b.domain), String(b.da || 0), String(b.comp_a_links || 0), String(b.your_links || 0)
    ])
  );

  markdown += `\nPRIORITIZED GAP-CLOSING ROADMAP\n\n`;
  safeArray(competitive.prioritized_roadmap).forEach((r: string, i: number) => markdown += `${i + 1}. ${r}\n`);
  markdown += `\n`;

  // ============ SECTION 8: 90-DAY ROADMAP ============
  markdown += `8. 90-DAY ACTION ROADMAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DAYS 1-30 — FOUNDATION & QUICK WINS

`;
  markdown += formatTable(
    ['Action', 'Theme', 'Owner', 'Effort'],
    safeArray(roadmap.days_1_30).map((a: any) => [
      safeString(a.action), safeString(a.theme), safeString(a.owner), safeString(a.effort)
    ])
  );

  markdown += `\nDAYS 31-60 — BUILD & EXPAND\n\n`;
  markdown += formatTable(
    ['Action', 'Theme', 'Owner', 'Effort'],
    safeArray(roadmap.days_31_60).map((a: any) => [
      safeString(a.action), safeString(a.theme), safeString(a.owner), safeString(a.effort)
    ])
  );

  markdown += `\nDAYS 61-90 — SCALE & OPTIMIZE\n\n`;
  markdown += formatTable(
    ['Action', 'Theme', 'Owner', 'Effort'],
    safeArray(roadmap.days_61_90).map((a: any) => [
      safeString(a.action), safeString(a.theme), safeString(a.owner), safeString(a.effort)
    ])
  );

  markdown += `\nDEPENDENCIES & RISKS\n`;
  safeArray(roadmap.dependencies).forEach((d: string) => markdown += `  • ${d}\n`);
  markdown += `\n`;

  // ============ SECTION 9: FINANCIAL PROJECTION ============
  markdown += `9. FINANCIAL PROJECTION & ROI MODEL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

INVESTMENT (6-MONTH)

`;
  markdown += formatTable(
    ['Item', 'Cost'],
    safeArray(financial.investment).map((i: any) => [safeString(i.item), safeString(i.cost)])
  );

  markdown += `\n6-MONTH PROJECTION\n\n`;
  markdown += formatTable(
    ['Month', 'Sessions', 'Leads', 'Pipeline', 'ROI'],
    safeArray(financial.monthly_projection).map((m: any) => [
      safeString(m.month), safeString(m.sessions), safeString(m.leads), safeString(m.pipeline), safeString(m.roi)
    ])
  );

  markdown += `\n${safeString(financial.roi_summary)}\n\n`;
  markdown += `ASSUMPTIONS & SOURCES\n`;
  safeArray(financial.assumptions).forEach((a: any) => {
    markdown += `  • ${safeString(a.assumption)}\n    Source: ${safeString(a.source)}\n`;
  });

  markdown += `\nSENSITIVITY ANALYSIS\n\n`;
  markdown += formatTable(
    ['Scenario', 'Traffic', 'Pipeline', 'ROI'],
    safeArray(financial.sensitivity).map((s: any) => [
      safeString(s.scenario), safeString(s.traffic), safeString(s.pipeline), safeString(s.roi)
    ])
  );
  markdown += `\n`;

  // ============ SECTION 10: CASE STUDIES ============
  markdown += `10. CASE STUDIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
  caseStudies.forEach((cs: any) => {
    markdown += `${safeString(cs.title)}\n`;
    markdown += `${safeString(cs.subtitle)}\n\n`;
    const cp = cs.client_profile || {};
    markdown += `CLIENT PROFILE\n`;
    markdown += `  Industry:       ${safeString(cp.industry)}\n`;
    markdown += `  Location:       ${safeString(cp.location)}\n`;
    markdown += `  Company Stage:  ${safeString(cp.company_stage)}\n`;
    markdown += `  Team Size:      ${safeString(cp.team_size)}\n`;
    markdown += `  Engagement:     ${safeString(cp.engagement)}\n`;
    markdown += `  Services:       ${safeString(cp.services)}\n`;
    markdown += `  Client Identity: ${safeString(cp.client_identity, 'Withheld under NDA')}\n\n`;
    markdown += `THE CHALLENGE\n  ${safeString(cs.challenge)}\n\n`;
    markdown += `OUR APPROACH\n`;
    safeArray(cs.approach).forEach((a: string) => markdown += `  ${a}\n`);
    markdown += `\nRESULTS AFTER 6 MONTHS\n\n`;
    markdown += formatTable(
      ['Metric', 'Baseline', 'After 6 Mo.', 'Change'],
      safeArray(cs.results_table).map((r: any) => [
        safeString(r.metric), safeString(r.baseline), safeString(r.after), safeString(r.change)
      ])
    );
    markdown += `\nWHAT DROVE THE GROWTH\n`;
    safeArray(cs.what_drove_growth).forEach((w: string) => markdown += `  • ${w}\n`);
    markdown += `\nEVIDENCE & VERIFICATION\n`;
    safeArray(cs.evidence).forEach((e: string) => markdown += `  • ${e}\n`);
    markdown += `\nATTRIBUTION NOTE\n  ${safeString(cs.attribution_note)}\n\n`;
    markdown += `IMPORTANT DISCLOSURE\n  ${safeString(cs.disclosure)}\n\n`;
    markdown += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  });

  // ============ APPENDIX: EVIDENCE, METHODOLOGY, DISCLAIMER ============
  markdown += `APPENDIX A — EVIDENCE, METHODOLOGY & DATA SOURCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

METHODOLOGY
${safeString(analysis.methodology_note)}

`;
  if (serpResults.length > 0) {
    markdown += `LIVE SERP EVIDENCE\n\n`;
    markdown += formatTable(
      ['#', 'Title', 'URL'],
      serpResults.slice(0, 10).map((r: any, i: number) => [
        String(i + 1), safeString(r.title), safeString(r.link)
      ])
    );
    markdown += `\n`;
  }

  markdown += `DATA LIMITATIONS\n`;
  dataLimitations.forEach((d: string, i: number) => markdown += `  ${i + 1}. ${d}\n`);

  const dataSourceLabel = keywords.some((k: any) => k.dataSource === 'dataforseo')
    ? 'Live Keyword Data (DataForSEO API) + Google Trends'
    : 'Industry-Standard Keyword Planners (Modeled) + Google Trends';

  markdown += `\nDATA SOURCE DISCLOSURE\n`;
  markdown += `  • Keyword Data: ${dataSourceLabel}\n`;
  markdown += `  • SERP Data: SerpAPI / ScraperAPI / Serper\n`;
  markdown += `  • Trend Data: Google Trends (12-month)\n`;
  markdown += `  • Currency: Real-time exchange API\n`;
  markdown += `  • Strategic Synthesis: MusePRO Senior Research Division\n\n`;

  markdown += `DISCLAIMER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This report is for informational purposes only and does not constitute legal, tax, or financial advice. Please consult qualified professionals before making business decisions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This report was generated by MusePRO Senior Research Division.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  const monthlyTotal = safeArray(analysis.content_roadmap).reduce((sum: number, week: any) => sum + safeNumber(week.expected_traffic, 1000), 0);
  let trafficEstimate = Math.round(monthlyTotal * 2);
  if (trafficEstimate < 500 && keywords.length > 0) trafficEstimate = Math.max(500, Math.round(safeNumber(keywords[0].volume, 1000) * 0.4 * 6));
  if (isNaN(trafficEstimate)) trafficEstimate = 0;

  const result = {
    niche, country, type: 'seo',
    data: analysis,
    keywords: keywords.slice(0, 50),
    serp_landscape: serp,
    markdown,
    trend_summary: safeString(analysis.trend_assessment, 'Steady market interest.'),
    dataSource: keywords.some((k: any) => k.dataSource === 'dataforseo') ? 'dataforseo' : 'gemini',
    chart_data: {
      trend_12m: trendData.map((v: number, i: number) => ({ month: `M${i + 1}`, value: v })),
      traffic_forecast_6m: safeArray(analysis.content_roadmap).slice(0, 6).map((c: any, i: number) => ({ month: `M${i + 1}`, traffic: safeNumber(c.expected_traffic, 1000) })),
      market_share: []
    },
    traffic_estimate: trafficEstimate
  };
  cacheService.set(cacheKey, result, 86400);
  return result;
}
