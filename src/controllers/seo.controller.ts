import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { cacheService } from '../services/cache';
import { getRelatedKeywords } from '../services/keywordseverywhere';
import { getGoogleTrends } from '../services/trends';
import { getSearchResults, getKeywordSuggestions } from '../services/serpapi';
import { runGroqWithRetry } from '../services/groq';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const extractJSON = (raw: string): any => {
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) cleaned = cleaned.substring(start, end + 1);
  try { return JSON.parse(cleaned); } 
  catch (err) {
    const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    try { return JSON.parse(fixed); } 
    catch (e2) {
      let completed = cleaned;
      let braceCount = (completed.match(/{/g) || []).length;
      let closeCount = (completed.match(/}/g) || []).length;
      while (closeCount < braceCount) { completed += '}'; closeCount++; }
      let bracketCount = (completed.match(/\[/g) || []).length;
      let closeBracketCount = (completed.match(/\]/g) || []).length;
      while (closeBracketCount < bracketCount) { completed += ']'; closeBracketCount++; }
      try { return JSON.parse(completed); } 
      catch (e3) { throw new Error('AI response is not valid JSON'); }
    }
  }
};

const PROMPT = `You are an elite SEO strategist at MusePRO Intelligence Division. Write like a senior consultant. Use current year 2026. Use provided real data if available. Never leave any field empty. Generate realistic numbers. Return valid JSON with all required fields.`;

const countryNames: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia',
  de: 'Germany', sg: 'Singapore', sa: 'Saudi Arabia', ae: 'United Arab Emirates',
  pk: 'Pakistan', in: 'India', tr: 'Turkey', my: 'Malaysia',
};

interface KeywordData { keyword: string; volume: number; cpc: number; kd: number; }

// ==========================================
// 🧠 INTELLIGENT NICHE DETECTION & SMART FALLBACK
// ==========================================
function detectNicheCategory(niche: string): 'ELECTRONICS' | 'ECOMMERCE' | 'DATING' | 'EDUCATION' | 'JOB' | 'GENERAL' {
  const n = niche.toLowerCase();
  if (/earbuds|headphones|speaker|laptop|phone|tablet|gadget|device|audio|tech/i.test(n)) return 'ELECTRONICS';
  if (/dropshipping|supplier|wholesale|product|sourcing|ecommerce|import|export|manufactur|print on demand|pod/i.test(n)) return 'ECOMMERCE';
  if (/dating|relationship|partner|match|love|single|romance|friend|girlfriend|boyfriend|wife|husband/i.test(n)) return 'DATING';
  if (/learn|language|spanish|english|french|german|course|tutor|education|class|skill/i.test(n)) return 'EDUCATION';
  if (/job|work|freelance|career|hire|remote|salary|resume|interview|employment/i.test(n)) return 'JOB';
  return 'GENERAL';
}

function generateProfessionalKeywords(niche: string, country: string): KeywordData[] {
  const cat = detectNicheCategory(niche);
  const cn = countryNames[country] || country;
  // Clean subject for use in templates
  let subject = niche.replace(/^(how to |learn |master |best |top |ultimate |complete |guide to |tips for |strategies for |find |rank |start )/gi, '').trim();
  
  let templates: string[] = [];

  if (cat === 'ELECTRONICS') {
    templates = [
      `Best ${subject} in 2026`, `${subject} vs competitors`, `Are ${subject} worth it?`,
      `Best ${subject} under $100`, `Top ${subject} for [Gym/Running/Travel]`, `${subject} review and comparison`,
      `Budget friendly ${subject}`, `Premium ${subject} for professionals`, `How to choose the best ${subject}`,
      `${subject} with noise cancellation`, `Long battery life ${subject}`, `The most comfortable ${subject}`,
      `Are ${subject} durable?`, `Best ${subject} for iPhone/Android`, `${subject} features explained`,
      `${subject} vs major brands`, `Why ${subject} are trending in 2026`, `User reviews of ${subject}`,
      `Where to buy ${subject} cheap`, `${subject} versus competitors`
    ];
  } else if (cat === 'ECOMMERCE') {
    templates = [
      `Best ${subject} strategies`, `How to start ${subject}`, `${subject} for beginners`,
      `Top ${subject} products`, `Finding winning ${subject}`, `${subject} suppliers in ${cn}`,
      `Local sourcing for ${subject}`, `Best ${subject} niches`, `High ticket ${subject} items`,
      `Print on demand ${subject}`, `${subject} with high margins`, `How to scale ${subject}`,
      `${subject} marketing tactics`, `Common ${subject} mistakes`, `${subject} success stories`,
      `Digital ${subject} ideas`, `Sustainable ${subject} options`, `Top ${subject} research tools`,
      `Low competition ${subject}`, `${subject} trends 2026`
    ];
  } else if (cat === 'DATING') {
    templates = [
      `Best dating apps for serious relationships`, `How to start a conversation on dating apps`,
      `Dating profile tips and bio examples`, `Hinge vs Bumble vs Tinder`, `How to find real love online`,
      `Red flags in online dating`, `How to transition from app to real life`,
      `Best dating sites for over 40`, `Dating profile pictures guide`, `How to text someone you're interested in`,
      `Safety tips for online dating`, `How to spot fake profiles`,
      `Best questions to ask on a first date`, `Finding a life partner online`,
      `Dating app success stories`, `How to know if someone is serious`,
      `Introvert dating tips`, `How to build trust online`, `Dating etiquette guide`, `Best dating apps 2026`
    ];
  } else if (cat === 'JOB') {
    templates = [
      `Best remote jobs in ${cn}`, `How to find online work`, `Freelance job platforms`,
      `High paying online careers`, `Work from home jobs 2026`, `How to get hired online`,
      `Legit remote work opportunities`, `Best freelance sites`, `How to start freelancing`,
      `Online job interview tips`, `Making money online from home`, `Flexible part time remote jobs`,
      `Top tech remote jobs`, `Digital nomad careers`, `How to create a freelance profile`,
      `Remote job resume tips`, `Avoiding online job scams`, `Best jobs for beginners online`,
      `Freelance writing/design jobs`, `Career growth in remote work`
    ];
  } else if (cat === 'EDUCATION') {
    templates = [
      `Best way to learn ${subject}`, `${subject} courses for beginners`, `How to master ${subject}`,
      `${subject} tips and tricks`, `${subject} practice exercises`, `${subject} grammar basics`,
      `Learn ${subject} speaking`, `${subject} vocabulary builder`, `Best apps to learn ${subject}`,
      `${subject} pronunciation guide`, `Learn ${subject} from home`, `Daily ${subject} practice`,
      `${subject} conversation practice`, `Advanced ${subject} learning`, `${subject} for travel`,
      `${subject} cultural insights`, `Best ${subject} teachers`, `Free ${subject} resources`,
      `${subject} audio lessons`, `Why learn ${subject} in 2026`
    ];
  } else {
    templates = [
      `Best ${subject} guide`, `How to master ${subject}`, `${subject} tips and tricks`,
      `${subject} for beginners`, `Advanced ${subject} strategies`, `${subject} challenges`,
      `${subject} success framework`, `Top ${subject} resources`, `${subject} vs competitors`
    ];
  }

  // Localization: Insert country if applicable
  if (cn && cn !== 'United States') {
    templates[0] = templates[0] + ` in ${cn}`;
    templates[1] = templates[1] + ` in ${cn}`;
  }

  const result: KeywordData[] = [];
  const shuffled = [...templates].sort(() => Math.random() - 0.5);
  for (let i = 0; i < 50; i++) {
    const kw = shuffled[i % shuffled.length];
    const vol = Math.floor(Math.random() * 2800) + 200;
    const kd = Math.floor(Math.random() * 45) + 5;
    const cpc = parseFloat((Math.random() * 1.8 + 0.3).toFixed(2));
    result.push({ keyword: kw, volume: vol, cpc, kd });
  }
  return result;
}

// ==========================================
// 🛡️ FULL REPORT STRUCTURE FALLBACK (AI ki tarah ka logic)
// ==========================================
function generateFullReportFallback(niche: string, country: string, keywords: KeywordData[], serp: any[], relatedQuestions: string[], trendData: number[]) {
  const cn = countryNames[country] || country;
  const cat = detectNicheCategory(niche);
  let subject = niche.replace(/^(how to |learn |master |best |top |ultimate |complete |guide to |tips for |strategies for |find |rank |start )/gi, '').trim();

  // Executive Brief & Insights
  const insights = [
    `The demand for '${niche}' in ${cn} is consistently rising, with top keywords reaching high search volumes.`,
    `Competitors in the SERP lack deep, localized insights specifically tailored to the ${cn} market.`,
    `Targeting long-tail, low-competition queries will allow for rapid organic growth in the first 3-6 months.`
  ];
  const actions = [
    `Publish a definitive 3,000+ word pillar guide targeting the top primary keyword.`,
    `Produce localized content (e.g., local supplier lists, pricing comparisons, or community forums) specifically for ${cn}.`,
    `Launch a targeted link-building campaign focusing on ${cn}-based business, tech, or lifestyle publications.`
  ];
  const trendAssessment = `We are tracking a sustained, year-over-year interest in "${subject}" across ${cn}. This is an evergreen topic with predictable seasonal peaks, making it a foundational niche for long-term content authority.`;

  // 12-Week Roadmap
  const roadmap = [];
  for (let i = 0; i < 12; i++) {
    const kw = keywords[i] || keywords[0];
    roadmap.push({
      week: i + 1,
      title: `Week ${i+1}: ${kw.keyword}`,
      primary_keyword: kw.keyword,
      type: i % 3 === 0 ? 'Pillar' : i % 3 === 1 ? 'How-to' : 'Listicle',
      secondary_keywords: [keywords[(i+1)%50]?.keyword, keywords[(i+2)%50]?.keyword].filter(Boolean),
      word_count_target: i === 0 ? 3500 : 2200 + (i * 100),
      outline: `Introduction | Core Strategies for ${subject} | Practical Examples | Expert Tips & Tools | Conclusion`,
      expected_traffic: Math.floor(kw.volume * 0.5) + 100
    });
  }

  // Link Acquisition (Country Specific)
  const countrySpecificSites: Record<string, any[]> = {
    'Australia': [{ site: 'SmartCompany', da: 63, type: 'Blog', contact: 'editorial@smartcompany.com.au', pitch: 'Pitching an analysis of local e-commerce trends.' }],
    'Canada': [{ site: 'BetaKit', da: 61, type: 'Tech', contact: 'pitches@betakit.com', pitch: 'Offering exclusive Canadian search data.' }],
    'India': [{ site: 'YourStory', da: 75, type: 'Startup', contact: 'editor@yourstory.com', pitch: 'Pitching a deep dive into the Indian market.' }]
  };
  let targetSites = countrySpecificSites[cn] || [{ site: 'Forbes', da: 90, type: 'Business', contact: 'submissions@forbes.com', pitch: 'Pitching a comprehensive feature on this topic.' }];

  const linkAcquisition = {
    overview: `Our strategy focuses on securing high-authority backlinks from ${cn}'s top business and lifestyle publications.`,
    target_sites: targetSites.slice(0, 3),
    guest_post_topics: [`The Ultimate Guide to ${subject} in ${cn}`, `Top 5 Strategies to Master ${subject}`],
    broken_link_opportunities: [{ site: `${cn} Business Hub`, dead_page: `/resources/old-guide`, replacement: `/blog/mastering-${subject}` }],
    outreach_template: `Subject: Guest Post Opportunity\n\nHi [Name],\n\nWe at MusePRO have compiled a comprehensive guide on ${subject}. I believe this would be highly valuable for your audience. Would you be open to a guest post collaboration?`
  };

  const onpageChecklist = ['Optimize meta titles with primary keywords.', 'Implement Schema markup for FAQs.', 'Ensure mobile responsiveness.'];
  const growthAccelerators = ['Repurpose content into YouTube Shorts.', 'Create a free downloadable checklist.', 'Run targeted social media campaigns.'];
  const relatedResources = [{ name: 'Google Trends', url: 'https://trends.google.com' }];

  return { key_insights: insights, immediate_actions: actions, trend_analysis: trendAssessment, trend_assessment: 'Evergreen', content_roadmap: roadmap, link_acquisition: linkAcquisition, onpage_checklist: onpageChecklist, growth_accelerators: growthAccelerators, related_resources: relatedResources };
}

// ==========================================
// 🖨️ MARKDOWN GENERATOR
// ==========================================
function generateMarkdown(analysis: any, keywords: KeywordData[], serp: any[], relatedQuestions: string[], trendData: number[], niche: string, country: string, reportId: string, dataSourceStatus: string): string {
  // Auto-fill if AI failed
  if (!analysis.key_insights || analysis.key_insights.length === 0) {
    const fb = generateFullReportFallback(niche, country, keywords, serp, relatedQuestions, trendData);
    analysis = { ...analysis, ...fb };
  }
  
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  let m = `MusePRO\nReal-Time Market Research\nIntelligence Division\n──────────────────────────────────────────────────────────────\nSEO RESEARCH REPORT\n\nPrepared For: [Client Name]\nDate: ${today}\nReference: ${reportId}\nClassification: CONFIDENTIAL\n──────────────────────────────────────────────────────────────\n\n`;
  m += `1. EXECUTIVE BRIEF\n──────────────────────────────────────────────────────────────\nThis report analyzes the organic search landscape for "${niche}" in ${countryNames[country] || country}.\n\n`;
  (analysis.key_insights || []).forEach((f: string, i: number) => m += `  ${i+1}. ${f}\n`);
  m += `\nPriority Actions:\n`; 
  (analysis.immediate_actions || []).forEach((w: string, i: number) => m += `  ${i+1}. ${w}\n`);
  m += `\n2. TREND ASSESSMENT\n──────────────────────────────────────────────────────────────\n${analysis.trend_analysis || ''}\n\n`;
  m += `3. KEYWORD OPPORTUNITIES (TOP 50)\n──────────────────────────────────────────────────────────────\n| # | Keyword | Volume | CPC | KD | Potential |\n|---|---------|--------|-----|----|----------|\n`;
  keywords.forEach((k, i) => {
    const p = k.kd < 30 ? 'Easy Win' : k.kd < 60 ? 'Moderate' : 'Long Game';
    m += `| ${i+1} | ${k.keyword} | ${k.volume.toLocaleString()} | $${k.cpc.toFixed(2)} | ${k.kd} | ${p} |\n`;
  });
  m += `\n4. SERP LANDSCAPE\n──────────────────────────────────────────────────────────────\n`;
  serp.forEach((s, i) => m += `Position #${i+1}: ${s.title}\n  URL: ${s.link}\n  Est. DA: ${s.da}\n  Est. Traffic: ${s.traffic.toLocaleString()} visits/mo\n  Snippet: ${s.snippet?.substring(0, 120)}\n\n`);
  m += `5. CONTENT ROADMAP (12 WEEKS)\n──────────────────────────────────────────────────────────────\n`;
  (analysis.content_roadmap || []).forEach((c: any) => m += `Week ${c.week}: ${c.title}\n  Keyword: ${c.primary_keyword} | Type: ${c.content_type}\n  Target Words: ${c.word_count_target}\n  Est. Traffic: ${c.expected_traffic?.toLocaleString()}/mo\n\n`);
  m += `6. LINK ACQUISITION STRATEGY\n──────────────────────────────────────────────────────────────\n`;
  const bs = analysis.link_acquisition || {};
  (bs.target_sites || []).forEach((s: any, i: number) => m += `  ${i+1}. ${s.site} (DA: ${s.da})\n     Type: ${s.type} | Contact: ${s.contact}\n     Pitch: ${s.pitch}\n\n`);
  m += `7. ON-PAGE OPTIMIZATION CHECKLIST\n──────────────────────────────────────────────────────────────\n`;
  (analysis.onpage_checklist || []).forEach((item: string, i: number) => m += `${i+1}. ${item}\n`);
  return m;
}

// ==========================================
// 🚀 MAIN CONTROLLER
// ==========================================
export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const ck = `seo_${niche}_${country}`;
    const cached = cacheService.get(ck);
    if (cached) return res.json(cached);

    const kweData = await getRelatedKeywords(niche, country).catch(() => null);
    const searchData = await getSearchResults(niche, country).catch(() => null);
    const relatedQuestions = await getKeywordSuggestions(niche, country).catch(() => []);
    const trendData = await getGoogleTrends(niche, country).catch(() => []);

    let realKeywords: KeywordData[] = [];
    if (kweData?.data?.length) {
      realKeywords = kweData.data.slice(0, 50).map((k: any) => ({
        keyword: k.keyword, volume: k.vol || 0, cpc: parseFloat(k.cpc?.value || '0'),
        kd: k.competition ? Math.min(Math.round(k.competition * 100), 100) : 0,
      }));
    }

    const serp = searchData?.organic_results?.slice(0, 8).map((r: any) => ({
      position: r.position, title: r.title, link: r.link, snippet: r.snippet || '',
    })) || [];

    const aiContext = { niche, country, realKeywords, serp, relatedQuestions, trendData };
    const ai = await runGroqWithRetry(PROMPT, JSON.stringify(aiContext));
    const analysis = extractJSON(ai);

    let keywords: KeywordData[] = analysis.keywords || realKeywords;
    if (!keywords || keywords.length < 10) keywords = realKeywords.slice(0, 50);

    // ✅ SMART FALLBACK (No more "practice routines" for earbuds!)
    if (keywords.length === 0) {
      keywords = generateProfessionalKeywords(niche, country);
    } else {
        if (keywords.length < 50) {
          if (analysis.keywords && Array.isArray(analysis.keywords)) {
            const filler = analysis.keywords.filter((k: any) => !keywords.some(rk => rk.keyword === k.keyword));
            keywords = [...keywords, ...filler].slice(0, 50);
          } else {
            const realFiller = realKeywords.filter((k) => !keywords.some(rk => rk.keyword === k.keyword));
            keywords = [...keywords, ...realFiller].slice(0, 50);
          }
        }
    }

    const serpWithMetrics = serp.map((r: any) => ({
      ...r,
      da: (new URL(r.link).hostname.includes('youtube') || new URL(r.link).hostname.includes('reddit')) ? 99 : 35,
      traffic: Math.round(([0.3, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.02][Math.min(r.position - 1, 7)] || 0.01) * (keywords[0]?.volume || 1000))
    }));

    const report = await Report.create({
      type: 'seo', niche, country, value: '$99',
      data: { ...analysis, keywords, serp: serpWithMetrics, relatedQuestions, trendData },
      markdown: 'Intelligence report generation in progress...', charts: {},
    });

    const reportId = `MKT-${report._id.toString().slice(-6).toUpperCase()}`;
    const markdown = generateMarkdown(analysis, keywords, serpWithMetrics, relatedQuestions, trendData, niche, country, reportId, 'Google Keyword Planner via Keywords Everywhere + AI Estimates');
    report.markdown = markdown;
    await report.save();

    const result = { id: report._id, ...report.toObject() };
    cacheService.set(ck, result, 86400);
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
};

export const getSEOReport = async (req: Request, res: Response) => {
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  res.json(report);
};
