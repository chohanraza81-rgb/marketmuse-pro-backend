// technical-seo.controller.ts
import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { z, ZodError } from 'zod';
import { Report } from '../models/Report';
import { getSearchResults } from '../services/serpapi'; // or wherever you import SERP
import { getSerperResults } from '../services/serper';
import { getScraperAPISearch } from '../services/scraperapi';
import { cacheService } from '../services/cache';
import { convertCurrency } from '../services/exchange';
import { runGroqWithRetry } from '../services/groq';

const technicalSeoSchema = z.object({
  websiteUrl: z.string().url({ message: "Invalid URL" }),
  country: z.string().length(2),
});

// Types
interface AuditCheck {
  name: string;
  passed: boolean;
  impactScore: number; // 0-10 (business impact)
  effort: 'Low' | 'Medium' | 'High';
  evidence: string;
  recommendation: string;
  revenueRiskMonthly?: number; // estimated monthly revenue loss/gain
}

interface CompetitorScore {
  domain: string;
  score: number;
  title: string;
  link: string;
  missingChecks: string[];
}

// We'll compute overall score from weighted categories
const CATEGORY_WEIGHTS = {
  'On-Page SEO': 0.25,
  'Technical Foundation': 0.20,
  'Performance & Core Web Vitals': 0.20,
  'Security & Trust': 0.15,
  'Mobile & User Experience': 0.10,
  'Structured Data & Rich Results': 0.10,
};

export const createTechnicalSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { websiteUrl, country } = technicalSeoSchema.parse(req.body);

    // Parse URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(websiteUrl);
    } catch (urlError) {
      return res.status(400).json({ error: 'Invalid URL format.' });
    }

    const startTime = Date.now();
    const auditTimestamp = new Date().toISOString();
    let responseTime = 0;
    let status = 0;
    let isBlocked = false;
    let html = '';

    // Infrastructure flags
    let hasSSL = parsedUrl.protocol === 'https:';
    let hasRobots = false;
    let hasSitemap = false;
    let robotsContent = '';
    let sitemapContent = '';
    let securityHeaders: Record<string, string> = {};

    // On-page flags
    let titleTag = 'MISSING';
    let metaDescription = 'MISSING';
    let h1Count = 0;
    let hasViewport = false;
    let hasJSONLD = false;
    let hasCanonical = false;
    let hasOpenGraph = false;
    let hasTwitterCard = false;
    let hasLang = false;
    let hasFavicon = false;
    let missingAltCount = 0;
    let totalImages = 0;
    let internalLinks = 0;
    let externalLinks = 0;
    let pageSizeKb = 0;
    let textToHtmlRatio = 0;
    let hasNoindexMeta = false;
    let hasMixedContent = false;
    let hasPermissionsPolicy = false;
    let hasReferrerPolicy = false;

    // Fetch page
    try {
      const response = await axios.get(websiteUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      status = response.status;
      responseTime = Date.now() - startTime;
      html = response.data;

      const headers = response.headers;
      securityHeaders = {
        'X-Frame-Options': headers['x-frame-options'] || '',
        'X-Content-Type-Options': headers['x-content-type-options'] || '',
        'Strict-Transport-Security': headers['strict-transport-security'] || '',
        'Content-Security-Policy': headers['content-security-policy'] || '',
        'X-Robots-Tag': headers['x-robots-tag'] || '',
        'Permissions-Policy': headers['permissions-policy'] || '',
        'Referrer-Policy': headers['referrer-policy'] || ''
      };
      hasPermissionsPolicy = !!securityHeaders['Permissions-Policy'];
      hasReferrerPolicy = !!securityHeaders['Referrer-Policy'];

      if (status === 200 && typeof html === 'string') {
        pageSizeKb = Math.round(Buffer.byteLength(html, 'utf8') / 1024);

        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (titleMatch && titleMatch[1].trim()) titleTag = titleMatch[1].trim();

        const metaMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || 
                          html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
        if (metaMatch && metaMatch[1].trim()) metaDescription = metaMatch[1].trim();

        h1Count = (html.match(/<h1[^>]*>/gi) || []).length;
        hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
        hasJSONLD = /application\/ld\+json/i.test(html);
        hasCanonical = /rel=["']canonical["']/i.test(html);
        hasOpenGraph = /property=["']og:title["']/i.test(html);
        hasTwitterCard = /name=["']twitter:card["']/i.test(html);
        hasLang = /<html[^>]+lang=["'][^"']+["']/i.test(html);
        hasFavicon = /<link[^>]+rel=["'](icon|shortcut icon)["']/i.test(html);

        // Mixed content detection (http resources on https page)
        if (hasSSL && /src=["']http:\/\//i.test(html) || /href=["']http:\/\//i.test(html)) {
          hasMixedContent = true;
        }

        // Noindex meta check
        hasNoindexMeta = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html);

        const imgTags = html.match(/<img[^>]*>/gi) || [];
        totalImages = imgTags.length;
        for (const img of imgTags) {
          if (!/alt=["']/i.test(img) || /alt=["'']/i.test(img)) missingAltCount++;
        }

        const linkTags = html.match(/<a[^>]+href=["']([^"']*)["']/gi) || [];
        for (const link of linkTags) {
          const hrefMatch = link.match(/href=["']([^"']*)["']/i);
          if (hrefMatch) {
            const href = hrefMatch[1];
            if (href.startsWith('http')) {
              if (new URL(href).hostname === parsedUrl.hostname) internalLinks++;
              else externalLinks++;
            } else {
              internalLinks++;
            }
          }
        }

        const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        textToHtmlRatio = Math.round((textContent.length / html.length) * 100);
      }
    } catch (error: any) {
      if (error.response) {
        status = error.response.status;
        responseTime = Date.now() - startTime;
        if (status === 403 || status === 429 || status === 503) {
          isBlocked = true;
        }
      } else {
        status = 0;
        isBlocked = true;
      }
    }

    // Check robots.txt and sitemap.xml
    try {
      const robotsRes = await axios.get(new URL('/robots.txt', websiteUrl).toString(), { timeout: 5000 });
      if (robotsRes.status === 200) {
        hasRobots = true;
        robotsContent = robotsRes.data.substring(0, 200);
      }
    } catch {}

    try {
      const sitemapRes = await axios.get(new URL('/sitemap.xml', websiteUrl).toString(), { timeout: 5000 });
      if (sitemapRes.status === 200) {
        hasSitemap = true;
        sitemapContent = sitemapRes.data.substring(0, 200);
      }
    } catch {}

    // PageSpeed API (if configured)
    let mobileScore: number | null = null;
    let desktopScore: number | null = null;
    let coreWebVitals: any = {
      mobile: { lcp: null, fid: null, cls: null, fcp: null, tbt: null },
      desktop: { lcp: null, fid: null, cls: null, fcp: null, tbt: null }
    };

    if (process.env.GOOGLE_API_KEY) {
      try {
        const apiUrl = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
        const params = {
          url: websiteUrl,
          key: process.env.GOOGLE_API_KEY,
          strategy: 'mobile',
          category: 'performance',
          locale: 'en_US'
        };
        const mobileResponse = await axios.get(apiUrl, { params, timeout: 20000 });
        const mobileData = mobileResponse.data;
        mobileScore = Math.round((mobileData.lighthouseResult?.categories?.performance?.score || 0) * 100);
        const mobileAudits = mobileData.lighthouseResult?.audits || {};
        coreWebVitals.mobile = {
          lcp: mobileAudits['largest-contentful-paint']?.displayValue || 'N/A',
          fid: mobileAudits['max-potential-fid']?.displayValue || 'N/A',
          cls: mobileAudits['cumulative-layout-shift']?.displayValue || 'N/A',
          fcp: mobileAudits['first-contentful-paint']?.displayValue || 'N/A',
          tbt: mobileAudits['total-blocking-time']?.displayValue || 'N/A'
        };

        const desktopParams = { ...params, strategy: 'desktop' };
        const desktopResponse = await axios.get(apiUrl, { params: desktopParams, timeout: 20000 });
        const desktopData = desktopResponse.data;
        desktopScore = Math.round((desktopData.lighthouseResult?.categories?.performance?.score || 0) * 100);
        const desktopAudits = desktopData.lighthouseResult?.audits || {};
        coreWebVitals.desktop = {
          lcp: desktopAudits['largest-contentful-paint']?.displayValue || 'N/A',
          fid: desktopAudits['max-potential-fid']?.displayValue || 'N/A',
          cls: desktopAudits['cumulative-layout-shift']?.displayValue || 'N/A',
          fcp: desktopAudits['first-contentful-paint']?.displayValue || 'N/A',
          tbt: desktopAudits['total-blocking-time']?.displayValue || 'N/A'
        };
      } catch (psError) {
        console.warn('PageSpeed Insights API error:', psError instanceof Error ? psError.message : 'Unknown');
      }
    }

    // ============ BUSINESS IMPACT CHECKS ============
    const checks: AuditCheck[] = [];

    // On-Page SEO
    checks.push({
      name: 'Title Tag Present & Optimized',
      passed: titleTag !== 'MISSING',
      impactScore: 9,
      effort: 'Low',
      evidence: titleTag !== 'MISSING' ? `Current Title: "${titleTag}"` : 'Title tag missing',
      recommendation: titleTag !== 'MISSING' ? 'Ensure title includes primary keyword and is under 60 characters.' : 'Add a compelling title tag under 60 characters.'
    });
    checks.push({
      name: 'Meta Description Present',
      passed: metaDescription !== 'MISSING',
      impactScore: 7,
      effort: 'Low',
      evidence: metaDescription !== 'MISSING' ? `Current Meta: "${metaDescription.substring(0, 80)}..."` : 'Meta description missing',
      recommendation: metaDescription !== 'MISSING' ? 'Optimize meta description with keyword and clear CTA.' : 'Add meta description under 155 characters.'
    });
    checks.push({
      name: 'Single H1 Tag',
      passed: h1Count === 1,
      impactScore: 6,
      effort: 'Low',
      evidence: `Found ${h1Count} H1 tags`,
      recommendation: h1Count === 0 ? 'Add one H1 tag containing the primary keyword.' : h1Count > 1 ? 'Reduce to a single H1 tag for proper content hierarchy.' : 'H1 is present.'
    });

    // Technical Foundation
    checks.push({
      name: 'robots.txt Exists',
      passed: hasRobots,
      impactScore: 4,
      effort: 'Low',
      evidence: hasRobots ? 'robots.txt found' : 'robots.txt missing',
      recommendation: hasRobots ? 'Review robots.txt for any accidental blocks.' : 'Create robots.txt and submit to Google Search Console.'
    });
    checks.push({
      name: 'sitemap.xml Exists',
      passed: hasSitemap,
      impactScore: 5,
      effort: 'Low',
      evidence: hasSitemap ? 'sitemap.xml found' : 'sitemap.xml missing',
      recommendation: hasSitemap ? 'Ensure sitemap is up-to-date and submitted.' : 'Create XML sitemap and submit to Google Search Console.'
    });
    checks.push({
      name: 'Canonical Tag',
      passed: hasCanonical,
      impactScore: 5,
      effort: 'Low',
      evidence: hasCanonical ? 'Canonical present' : 'Canonical missing',
      recommendation: hasCanonical ? 'Verify canonical URLs point to correct pages.' : 'Add canonical tags to prevent duplicate content issues.'
    });

    // Performance & Core Web Vitals
    checks.push({
      name: 'Mobile Performance Score',
      passed: mobileScore !== null && mobileScore >= 80,
      impactScore: 8,
      effort: 'High',
      evidence: mobileScore !== null ? `Mobile score: ${mobileScore}/100` : 'Mobile performance not measured',
      recommendation: mobileScore !== null && mobileScore < 80 ? 'Optimize images, reduce JS execution, and improve server response.' : 'Maintain current performance level.'
    });
    checks.push({
      name: 'Desktop Performance Score',
      passed: desktopScore !== null && desktopScore >= 80,
      impactScore: 6,
      effort: 'Medium',
      evidence: desktopScore !== null ? `Desktop score: ${desktopScore}/100` : 'Desktop performance not measured',
      recommendation: desktopScore !== null && desktopScore < 80 ? 'Improve caching and minify resources.' : 'Good.'
    });

    // Security & Trust
    checks.push({
      name: 'HTTPS Enabled',
      passed: hasSSL,
      impactScore: 9,
      effort: 'Low',
      evidence: hasSSL ? 'HTTPS active' : 'HTTPS missing',
      recommendation: hasSSL ? 'Ensure all pages redirect to HTTPS.' : 'Install SSL certificate and force HTTPS.'
    });
    checks.push({
      name: 'Mixed Content Detected',
      passed: !hasMixedContent,
      impactScore: 8,
      effort: 'Medium',
      evidence: hasMixedContent ? 'HTTP resources found on HTTPS page' : 'No mixed content',
      recommendation: hasMixedContent ? 'Replace all HTTP resources with HTTPS.' : 'No action needed.'
    });
    checks.push({
      name: 'Security Headers Present',
      passed: hasPermissionsPolicy && hasReferrerPolicy && !!securityHeaders['X-Frame-Options'] && !!securityHeaders['X-Content-Type-Options'] && !!securityHeaders['Strict-Transport-Security'],
      impactScore: 7,
      effort: 'Low',
      evidence: 'Header check results',
      recommendation: 'Add missing security headers: X-Frame-Options, X-Content-Type-Options, HSTS, Permissions-Policy, Referrer-Policy.'
    });

    // Mobile & User Experience
    checks.push({
      name: 'Viewport Meta Tag',
      passed: hasViewport,
      impactScore: 6,
      effort: 'Low',
      evidence: hasViewport ? 'Viewport present' : 'Viewport missing',
      recommendation: hasViewport ? 'Good' : 'Add viewport meta tag for mobile responsiveness.'
    });
    checks.push({
      name: 'Language Attribute',
      passed: hasLang,
      impactScore: 3,
      effort: 'Low',
      evidence: hasLang ? 'Lang attribute present' : 'Lang attribute missing',
      recommendation: hasLang ? 'Good' : 'Add lang attribute to <html> tag.'
    });

    // Structured Data & Rich Results
    checks.push({
      name: 'Structured Data (JSON-LD)',
      passed: hasJSONLD,
      impactScore: 8,
      effort: 'Medium',
      evidence: hasJSONLD ? 'JSON-LD found' : 'No structured data',
      recommendation: hasJSONLD ? 'Ensure schema type is relevant to content.' : 'Add appropriate JSON-LD schema (Organization, Product, Article, etc.) for rich snippets.'
    });

    // ============ COMPETITOR BENCHMARKING ============
    let competitors: CompetitorScore[] = [];
    try {
      // Use SerpAPI to get top organic results for the domain as a query
      const query = parsedUrl.hostname.replace('www.', '');
      let serpData = await getSearchResults(query, country).catch(() => null);
      if (!serpData?.organic_results) serpData = await getSerperResults(query, country).catch(() => null);
      if (!serpData?.organic_results) serpData = await getScraperAPISearch(query, country).catch(() => null);

      if (serpData?.organic_results) {
        const topResults = serpData.organic_results.slice(0, 5);
        for (const result of topResults) {
          if (result.link && !result.link.includes(parsedUrl.hostname)) {
            // We'll do a simplified check for competitors
            let compScore = 50; // base
            const missingChecks: string[] = [];
            try {
              const compRes = await axios.get(result.link, { timeout: 8000 });
              const compHtml = compRes.data;
              if (compHtml) {
                const compHasTitle = /<title[^>]*>/i.test(compHtml);
                const compHasH1 = /<h1[^>]*>/i.test(compHtml);
                const compHasSchema = /application\/ld\+json/i.test(compHtml);
                const compHasViewport = /<meta[^>]+name=["']viewport["']/i.test(compHtml);
                const compHasSSL = result.link.startsWith('https');
                if (!compHasTitle) { compScore -= 10; missingChecks.push('Missing title'); }
                if (!compHasH1) { compScore -= 10; missingChecks.push('Missing H1'); }
                if (!compHasSchema) { compScore -= 15; missingChecks.push('No structured data'); }
                if (!compHasViewport) { compScore -= 10; missingChecks.push('No viewport'); }
                if (!compHasSSL) { compScore -= 15; missingChecks.push('No HTTPS'); }
              }
            } catch (e) {
              // ignore, score stays base
            }
            competitors.push({
              domain: new URL(result.link).hostname,
              score: Math.max(0, Math.min(100, compScore)),
              title: result.title || 'Untitled',
              link: result.link,
              missingChecks: missingChecks.length > 0 ? missingChecks : ['N/A']
            });
          }
        }
      }
    } catch (e) {
      console.warn('Competitor benchmarking failed:', e);
    }

    // ============ OVERALL SCORE WITH IMPACT ============
    // Calculate category scores based on weighted impact of passed checks
    const categoryScores: Record<string, number> = {};
    const categoryWeights: Record<string, number> = {
      'On-Page SEO': 0.25,
      'Technical Foundation': 0.20,
      'Performance & Core Web Vitals': 0.20,
      'Security & Trust': 0.15,
      'Mobile & User Experience': 0.10,
      'Structured Data & Rich Results': 0.10,
    };

    // Group checks by category (we'll map manually)
    const onPageChecks = checks.filter(c => ['Title Tag Present & Optimized', 'Meta Description Present', 'Single H1 Tag'].includes(c.name));
    const technicalChecks = checks.filter(c => ['robots.txt Exists', 'sitemap.xml Exists', 'Canonical Tag'].includes(c.name));
    const performanceChecks = checks.filter(c => ['Mobile Performance Score', 'Desktop Performance Score'].includes(c.name));
    const securityChecks = checks.filter(c => ['HTTPS Enabled', 'Mixed Content Detected', 'Security Headers Present'].includes(c.name));
    const mobileChecks = checks.filter(c => ['Viewport Meta Tag', 'Language Attribute'].includes(c.name));
    const structuredChecks = checks.filter(c => ['Structured Data (JSON-LD)'].includes(c.name));

    function categoryScore(catChecks: AuditCheck[]): number {
      if (catChecks.length === 0) return 0;
      const totalImpact = catChecks.reduce((sum, c) => sum + c.impactScore, 0);
      const achievedImpact = catChecks.filter(c => c.passed).reduce((sum, c) => sum + c.impactScore, 0);
      return totalImpact > 0 ? Math.round((achievedImpact / totalImpact) * 100) : 0;
    }

    categoryScores['On-Page SEO'] = categoryScore(onPageChecks);
    categoryScores['Technical Foundation'] = categoryScore(technicalChecks);
    categoryScores['Performance & Core Web Vitals'] = categoryScore(performanceChecks);
    categoryScores['Security & Trust'] = categoryScore(securityChecks);
    categoryScores['Mobile & User Experience'] = categoryScore(mobileChecks);
    categoryScores['Structured Data & Rich Results'] = categoryScore(structuredChecks);

    let overallScore = 0;
    for (const cat in categoryScores) {
      overallScore += categoryScores[cat] * (categoryWeights[cat] || 0);
    }
    overallScore = Math.round(overallScore);

    // ============ REVENUE IMPACT ESTIMATES ============
    // Simple heuristic: assume average business loses $X per missing high-impact element per month.
    // We'll use a fixed base revenue impact per missed impact point, but better to use actual SERP traffic data from competitors.
    // Since we may not have client traffic, we'll estimate based on competitor traffic average and missing checks.
    const highImpactMissing = checks.filter(c => !c.passed && c.impactScore >= 7).length;
    const mediumImpactMissing = checks.filter(c => !c.passed && c.impactScore >= 4 && c.impactScore < 7).length;
    const estimatedMonthlyTrafficLoss = highImpactMissing * 500 + mediumImpactMissing * 200; // rough visits
    const avgOrderValue = 100; // assumption
    const conversionRate = 0.02; // 2% assumption
    const estimatedRevenueLossMonthly = Math.round(estimatedMonthlyTrafficLoss * conversionRate * avgOrderValue);

    // Build markdown report
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const reference = `MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    let markdown = `MusePRO\nReal-Time Market Research\nIntelligence Division\n════════════════════════════════════════════════════════════════════\nTECHNICAL SEO AUDIT REPORT\nBusiness Impact Edition\n════════════════════════════════════════════════════════════════════\n\n**Prepared For:** [Client Name]\n**Date:** ${today}\n**Audit Timestamp (UTC):** ${auditTimestamp}\n**Prepared By:** MusePRO SEO Team\n**Reference:** ${reference}\n**Classification:** CONFIDENTIAL\n════════════════════════════════════════════════════════════════════\n\n`;

    // Executive Summary
    markdown += `1. EXECUTIVE SUMMARY (BUSINESS IMPACT)\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `This audit goes beyond raw scores. We assess the financial impact of technical SEO issues and prioritize fixes that generate the highest return on investment.\n\n`;
    markdown += `**Current Health Score:** ${overallScore}/100\n`;
    markdown += `**Estimated Monthly Revenue Loss due to technical issues:** $${estimatedRevenueLossMonthly.toLocaleString()}\n`;
    markdown += `**High-Impact Issues Found:** ${highImpactMissing}\n`;
    markdown += `**Competitors in Better Technical Shape:** ${competitors.filter(c => c.score > overallScore).length} of ${competitors.length}\n\n`;
    markdown += `**Top 3 Fixes with Immediate ROI:**\n`;
    const criticalFixes = checks.filter(c => !c.passed && c.impactScore >= 7).slice(0, 3);
    criticalFixes.forEach((fix, i) => {
      markdown += ` ${i+1}. ${fix.name} — ${fix.recommendation} (Effort: ${fix.effort})\n`;
    });
    markdown += `\n`;

    // Score Breakdown with Impact
    markdown += `2. SCORE BREAKDOWN (IMPACT MATRIX)\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `| Category | Weight | Score | Impact of Issues |\n|---|---|---|---|\n`;
    for (const cat in categoryScores) {
      const weight = Math.round(categoryWeights[cat] * 100);
      markdown += `| ${cat} | ${weight}% | ${categoryScores[cat]}/100 | ${cat === 'On-Page SEO' ? 'Title, meta, H1 directly affect CTR' : cat === 'Technical Foundation' ? 'robots, sitemap, canonical affect indexing' : cat === 'Performance & Core Web Vitals' ? 'Speed affects UX and rankings' : cat === 'Security & Trust' ? 'SSL, mixed content affect trust' : cat === 'Mobile & User Experience' ? 'Mobile-friendliness essential' : 'Structured data for rich results'} |\n`;
    }
    markdown += `\n**Overall Score:** ${overallScore}/100\n\n`;

    // Detailed Checks with Business Impact
    markdown += `3. DETAILED AUDIT CHECKS WITH BUSINESS IMPACT\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `| Check | Status | Impact (1-10) | Effort | Evidence | Recommendation |\n|---|---|---|---|---|---|\n`;
    checks.forEach(check => {
      const statusEmoji = check.passed ? '✅ Pass' : check.impactScore >= 7 ? '🔴 Critical' : '⚠️ Warning';
      markdown += `| ${check.name} | ${statusEmoji} | ${check.impactScore} | ${check.effort} | ${check.evidence} | ${check.recommendation} |\n`;
    });
    markdown += `\n`;

    // Competitor Benchmarking
    if (competitors.length > 0) {
      markdown += `4. COMPETITOR BENCHMARKING\n────────────────────────────────────────────────────────────────────\n`;
      markdown += `We analyzed top competitors ranking for your brand queries.\n\n`;
      markdown += `| Competitor | Estimated Technical Score | Missing Checks |\n|---|---|---|\n`;
      competitors.forEach(comp => {
        markdown += `| [${comp.domain}](${comp.link}) | ${comp.score}/100 | ${comp.missingChecks.join(', ')} |\n`;
      });
      markdown += `\n`;
      markdown += `**Gap Analysis:** Your score is ${overallScore}, competitors average ${Math.round(competitors.reduce((sum, c) => sum + c.score, 0) / competitors.length)}. Focus on the missing elements listed above to close the gap.\n\n`;
    }

    // Priority Action Plan
    markdown += `5. PRIORITY ACTION PLAN (30/60/90 DAYS)\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `**Week 1 (Critical Fixes – Immediate ROI):**\n`;
    checks.filter(c => !c.passed && c.impactScore >= 7).forEach(c => {
      markdown += `- ${c.name}: ${c.recommendation} (Effort: ${c.effort})\n`;
    });
    markdown += `\n**Weeks 2-4 (Technical Foundation):**\n`;
    checks.filter(c => !c.passed && c.impactScore >= 4 && c.impactScore < 7).forEach(c => {
      markdown += `- ${c.name}: ${c.recommendation} (Effort: ${c.effort})\n`;
    });
    markdown += `\n**Months 2-3 (Optimization & Scale):**\n`;
    checks.filter(c => !c.passed && c.impactScore < 4).forEach(c => {
      markdown += `- ${c.name}: ${c.recommendation} (Effort: ${c.effort})\n`;
    });
    markdown += `\n`;

    // Revenue Impact Estimates
    markdown += `6. REVENUE IMPACT ESTIMATES\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `Our analysis indicates the following estimated monthly revenue impact due to unfixed technical issues:\n\n`;
    markdown += `- High-impact missing elements: ${highImpactMissing}, estimated traffic loss: ${highImpactMissing * 500} visits/month.\n`;
    markdown += `- Medium-impact missing elements: ${mediumImpactMissing}, estimated additional traffic loss: ${mediumImpactMissing * 200} visits/month.\n`;
    markdown += `- Assuming a conservative 2% conversion rate and average order value of $100, **estimated monthly revenue loss: $${estimatedRevenueLossMonthly.toLocaleString()}**.\n\n`;
    markdown += `*This is a modeled estimate based on typical industry benchmarks. Actual figures may vary.*\n\n`;

    // Evidence & Methodology
    markdown += `7. EVIDENCE & METHODOLOGY\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `**Methodology:** We performed a live crawl of ${websiteUrl} on ${auditTimestamp}, analyzing raw HTML, HTTP headers, auxiliary files, and performance data.\n`;
    markdown += `**Evidence Summary:**\n`;
    markdown += `- Page Fetch: HTTP ${status || 'Failed'} | ${responseTime}ms | ${pageSizeKb}KB downloaded.\n`;
    markdown += `- robots.txt: ${hasRobots ? 'Found' : 'Not Found'}\n`;
    markdown += `- sitemap.xml: ${hasSitemap ? 'Found' : 'Not Found'}\n`;
    markdown += `- Security Headers: ${Object.values(securityHeaders).every(v => v === '') ? 'None present' : 'Partial presence detected'}.\n`;
    markdown += `- PageSpeed: Mobile ${mobileScore !== null ? mobileScore + '/100' : 'N/A'} | Desktop ${desktopScore !== null ? desktopScore + '/100' : 'N/A'}\n\n`;

    markdown += `**Scoring Model:** Based on weighted business impact categories: On-Page (25%), Technical (20%), Performance (20%), Security (15%), Mobile/UX (10%), Structured Data (10%). Each check has an impact score (1-10) and effort level. Score reflects the percentage of critical impact items that are compliant.\n\n`;
    markdown += `**Disclaimer:** This is a static analysis and does not include JavaScript rendering or field data. For a complete audit, a full site crawl is recommended.\n\n`;

    markdown += `════════════════════════════════════════════════════════════════════\nThis report is generated by MusePRO Senior Research Division.\n════════════════════════════════════════════════════════════════════`;

    // Save report (type 'seo' with subtype 'technical-business')
    const report = await Report.create({
      type: 'seo',
      niche: `Technical Audit: ${parsedUrl.hostname}`,
      country,
      value: '$299', // increase price reflecting premium service
      data: {
        websiteUrl,
        score: overallScore,
        responseTime,
        status,
        hasSSL,
        hasRobots,
        hasSitemap,
        h1Count,
        titleTag,
        metaDescription,
        pageSizeKb,
        isBlocked,
        subtype: 'technical-business',
        auditTimestamp,
        mobileScore,
        desktopScore,
        coreWebVitals,
        checks,
        competitors,
        estimatedRevenueLossMonthly,
        categoryScores,
      },
      markdown,
      charts: {},
      traffic_estimate: 0,
      trend_summary: `Business impact score: ${overallScore}/100`,
    });

    res.status(201).json({ id: report._id, ...report.toObject() });

  } catch (err) {
    console.error('Technical SEO Audit Error:', err);
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    return res.status(500).json({ error: 'Failed to run technical audit', details: err instanceof Error ? err.message : 'Unknown error' });
  }
};

export const getTechnicalSEOReport = async (req: Request, res: Response) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Not found' });
    res.json(report);
  } catch (err) {
    console.error('Error fetching technical SEO report:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
