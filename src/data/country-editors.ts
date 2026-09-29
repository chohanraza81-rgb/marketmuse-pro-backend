// src/data/country-editors.ts
// Editor-level intelligence per country

export interface EditorInsight {
  site: string;
  type: string;
  da: number;
  contact: string;
  pitch: string;
  whatWorks: string;
}

export const COUNTRY_EDITORS: Record<string, EditorInsight[]> = {
  us: [
    { site: 'Search Engine Journal', type: 'SEO Publication', da: 89, contact: 'editor@searchenginejournal.com', pitch: 'Data-driven niche SEO analysis', whatWorks: 'Proprietary research with numbers, not opinion pieces' },
    { site: 'Moz Blog', type: 'SEO Authority', da: 91, contact: 'editor@moz.com', pitch: 'Advanced local SEO tactical guides', whatWorks: 'Technical depth with step-by-step frameworks' },
    { site: 'Entrepreneur', type: 'Business Magazine', da: 93, contact: 'contributors@entrepreneur.com', pitch: 'Expert commentary on digital transformation', whatWorks: 'Founder stories + actionable takeaways' },
    { site: 'Forbes Business Council', type: 'Business Council', da: 95, contact: 'forbes@forbes.com', pitch: 'Thought leadership on AI + business', whatWorks: 'Executive-level insight, no fluff' },
  ],
  gb: [
    { site: 'Search Engine Land UK', type: 'SEO Publication', da: 87, contact: 'editor@searchengineland.co.uk', pitch: 'UK-specific SEO insights', whatWorks: 'Local case studies with UK data' },
    { site: 'The Drum', type: 'Marketing Magazine', da: 82, contact: 'editor@thedrum.com', pitch: 'UK search trends analysis', whatWorks: 'Opinionated industry commentary' },
    { site: 'Econsultancy', type: 'Digital Marketing', da: 84, contact: 'editor@econsultancy.com', pitch: 'Conversion optimization guides', whatWorks: 'Deep tactical frameworks' },
    { site: 'TechRadar UK', type: 'Tech News', da: 91, contact: 'editor@techradar.com', pitch: 'Technical SEO how-tos', whatWorks: 'Practical tutorials with screenshots' },
  ],
  ca: [
    { site: 'BetaKit', type: 'Tech & Startup News', da: 72, contact: 'editor@betakit.com', pitch: 'Canadian tech ecosystem trends', whatWorks: 'Data-backed startup stories' },
    { site: 'The Globe and Mail (Report on Business)', type: 'Business News', da: 88, contact: 'rob@globeandmail.com', pitch: 'SME digital marketing ROI', whatWorks: 'Executive-level analysis, no jargon' },
    { site: 'Canadian Business', type: 'Business Magazine', da: 79, contact: 'editor@canadianbusiness.com', pitch: 'Canadian startup growth', whatWorks: 'Real founder stories' },
    { site: 'Marketing Mag', type: 'Marketing Publication', da: 74, contact: 'editor@marketingmag.ca', pitch: 'Canadian SEO trends', whatWorks: 'Bilingual (EN/FR) case studies' },
  ],
  au: [
    { site: 'Startup Daily', type: 'Tech & Startup Portal', da: 68, contact: 'editor@startupdaily.net', pitch: 'Australian e-commerce data study', whatWorks: 'Proprietary surveys with exclusive data' },
    { site: 'SmartCompany', type: 'SME Business Publication', da: 79, contact: 'editorial@smartcompany.com.au', pitch: 'AU entrepreneur scaling stories', whatWorks: 'Actionable SME guides' },
    { site: 'Power Retail', type: 'E-commerce Intelligence', da: 72, contact: 'content@powerretail.com.au', pitch: 'AU product validation frameworks', whatWorks: 'Industry data + case studies' },
    { site: 'Inside Retail Australia', type: 'Retail Industry Publication', da: 74, contact: 'news@insideretail.com.au', pitch: 'Micro-warehousing impact', whatWorks: 'Retail-specific insights' },
  ],
  de: [
    { site: 't3n', type: 'Tech & Digital News', da: 82, contact: 'redaktion@t3n.de', pitch: 'Digital marketing + AI thought leadership', whatWorks: 'Deep tech analysis in German' },
    { site: 'OnlineMarketing.de', type: 'Marketing Publication', da: 76, contact: 'redaktion@onlinemarketing.de', pitch: 'German SME SEO strategies', whatWorks: 'Practical German-language guides' },
    { site: 'Gründerdaily', type: 'Startup News', da: 72, contact: 'redaktion@gruenderdaily.de', pitch: 'German e-commerce trends', whatWorks: 'Data-driven startup stories' },
    { site: 'Internet World', type: 'Business & E-commerce', da: 78, contact: 'redaktion@internetworld.de', pitch: 'Cross-border e-commerce + SEO', whatWorks: 'B2B e-commerce insights' },
  ],
  sg: [
    { site: 'e27', type: 'Tech & Startup Portal', da: 74, contact: 'editor@e27.co', pitch: 'Singapore e-commerce sourcing trends', whatWorks: 'SEA-focused data + analysis' },
    { site: 'Vulcan Post', type: 'Business & Startup Media', da: 68, contact: 'team@vulcanpost.com', pitch: 'Singapore entrepreneur stories', whatWorks: 'Human-interest founder narratives' },
    { site: 'SGSME.sg', type: 'SME Business Portal', da: 62, contact: 'editor@sgsme.sg', pitch: 'Digital marketing for Singapore SMEs', whatWorks: 'Practical SME how-tos' },
    { site: 'Marketing Interactive', type: 'Marketing Publication', da: 76, contact: 'editor@marketing-interactive.com', pitch: 'Southeast Asian e-commerce', whatWorks: 'Regional marketing trends' },
  ],
  sa: [
    { site: 'Arab News', type: 'Mainstream Media', da: 82, contact: 'editor@arabnews.com', pitch: 'Saudi e-commerce + Vision 2030', whatWorks: 'Data-backed business news' },
    { site: 'Saudi Gazette', type: 'News Portal', da: 76, contact: 'editor@saudigazette.com.sa', pitch: 'Digital transformation thought leadership', whatWorks: 'Bilingual (AR/EN) coverage' },
    { site: 'Argaam', type: 'Business News', da: 71, contact: 'editor@argaam.com', pitch: 'Saudi market trend data', whatWorks: 'Financial + market analysis' },
    { site: 'Wamda', type: 'Startup & Tech', da: 73, contact: 'editor@wamda.com', pitch: 'Saudi startup case studies', whatWorks: 'MENA startup ecosystem focus' },
  ],
  ae: [
    { site: 'Gulf News', type: 'Mainstream Media', da: 88, contact: 'editorial@gulfnews.com', pitch: 'UAE employment + AI trends', whatWorks: 'Data-driven insights with real numbers' },
    { site: 'Khaleej Times', type: 'Mainstream Media', da: 87, contact: 'tech@khaleejtimes.com', pitch: 'Expat career transitions + human interest', whatWorks: 'Human stories + practical advice' },
    { site: 'Arabian Business', type: 'Business Publication', da: 81, contact: 'features@arabianbusiness.com', pitch: 'Executive career strategies + Emiratisation', whatWorks: 'High-level executive insights' },
    { site: 'Edarabia', type: 'Education & Careers', da: 74, contact: 'editor@edarabia.com', pitch: 'Graduate career guides + internships', whatWorks: 'Student + entry-level focus' },
    { site: 'Wired Middle East', type: 'Tech Media', da: 82, contact: 'editor@wired.me', pitch: 'Localized Arabic SEO + AI strategies', whatWorks: 'Deep tech + future-focused' },
  ],
  pk: [
    { site: 'Profit by Pakistan Today', type: 'Business News', da: 68, contact: 'editor@profit.pakistantoday.com.pk', pitch: 'Pakistani e-commerce analysis', whatWorks: 'Data-driven business stories' },
    { site: 'TechJuice', type: 'Tech & Startup', da: 72, contact: 'editor@techjuice.pk', pitch: 'Pakistani startup case studies', whatWorks: 'Local tech ecosystem insights' },
    { site: 'Dawn (Business)', type: 'Mainstream Media', da: 87, contact: 'business@dawn.com', pitch: 'Digital economy thought leadership', whatWorks: 'In-depth economic analysis' },
    { site: 'PakWired', type: 'Tech News', da: 58, contact: 'editor@pakwired.com', pitch: 'E-commerce + digital marketing guides', whatWorks: 'Practical how-tos for SMEs' },
  ],
  in: [
    { site: 'YourStory', type: 'Startup & Tech', da: 87, contact: 'editor@yourstory.com', pitch: 'Indian e-commerce growth stories', whatWorks: 'Founder case studies + data' },
    { site: 'Inc42', type: 'Startup News', da: 79, contact: 'editor@inc42.com', pitch: 'Indian digital economy data', whatWorks: 'Proprietary research + trends' },
    { site: 'Economic Times (ET Rise)', type: 'Business News', da: 91, contact: 'etrise@timesgroup.com', pitch: 'SME digital marketing', whatWorks: 'Executive-level commentary' },
    { site: 'Entrackr', type: 'Startup & Tech', da: 74, contact: 'editor@entrackr.com', pitch: 'Indian sourcing + e-commerce trends', whatWorks: 'Market analysis + funding news' },
  ],
  tr: [
    { site: 'Webrazzi', type: 'Tech Portal', da: 78, contact: 'editor@webrazzi.com', pitch: 'Turkish e-commerce SEO data', whatWorks: 'Turkish startup ecosystem data' },
    { site: 'ShiftDelete.Net', type: 'Tech Blog', da: 74, contact: 'icerik@shiftdelete.net', pitch: 'Digital marketing trends', whatWorks: 'Comprehensive Turkish guides' },
    { site: 'CHIP Online Turkey', type: 'Tech Magazine', da: 76, contact: 'editor@chip.com.tr', pitch: 'SEO + e-commerce optimization', whatWorks: 'Product + tech reviews' },
    { site: 'DonanımHaber', type: 'Tech Forum & News', da: 82, contact: 'haber@donanimhaber.com', pitch: 'Digital marketing strategies', whatWorks: 'Hardware + tech news' },
  ],
  my: [
    { site: 'SoyaCincau', type: 'Tech & Lifestyle Portal', da: 76, contact: 'editor@soyacincau.com', pitch: 'Malaysian e-commerce study', whatWorks: 'Data-driven local content' },
    { site: 'Vulcan Post Malaysia', type: 'Business & Startup Media', da: 68, contact: 'my@vulcanpost.com', pitch: 'Malaysian creator economy', whatWorks: 'Gen-Z + founder stories' },
    { site: 'Digital News Asia', type: 'Tech News & Business', da: 74, contact: 'editor@digitalnewsasia.com', pitch: 'Digital marketing strategies', whatWorks: 'Analytical SEA tech focus' },
    { site: 'TechNave', type: 'Tech & Gadget Portal', da: 66, contact: 'feedback@technave.com', pitch: 'Digital tools for Malaysian SMEs', whatWorks: 'Consumer tech reviews' },
  ],
};

export function getEditorsForCountry(country: string): EditorInsight[] {
  return COUNTRY_EDITORS[country?.toLowerCase()] || COUNTRY_EDITORS.us;
}
