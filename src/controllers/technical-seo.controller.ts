// technical-seo.controller.ts
import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { z, ZodError } from 'zod';
import { Report } from '../models/Report';

const technicalSeoSchema = z.object({
  websiteUrl: z.string().url({ message: "Invalid URL" }),
  country: z.string().length(2),
});

interface AuditCheck {
  name: string;
  passed: boolean;
  measured: boolean;
  impactScore: number;
  effort: 'Low' | 'Medium' | 'High';
  evidence: string;
  recommendation: string;
}

export const createTechnicalSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { websiteUrl, country } = technicalSeoSchema.parse(req.body);

    const parsedUrl = new URL(websiteUrl);
    const startTime = Date.now();
    const auditTimestamp = new Date().toISOString();
    let status = 0;
    let responseTime = 0;
    let isBlocked = false;
    let html = '';
    let securityHeaders: Record<string, string> = {};

    // ============ PRIMARY FETCH ============
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
    } catch (error: any) {
      if (error.response) {
        status = error.response.status;
        responseTime = Date.now() - startTime;
        if ([403, 429, 503].includes(status)) isBlocked = true;
      } else {
        isBlocked = true;
        status = 0;
      }
    }

    // ============ FALLBACK: ScraperAPI ============
    if (isBlocked || status !== 200) {
      try {
        const scraperResponse = await axios.get('http://api.scraperapi.com/', {
          params: {
            api_key: process.env.SCRAPER_API_KEY,
            url: websiteUrl,
            render: false,
            premium: false,
          },
          timeout: 30000,
        });
        if (scraperResponse.status === 200 && typeof scraperResponse.data === 'string') {
          html = scraperResponse.data;
          status = 200;
          responseTime = Date.now() - startTime;
          isBlocked = false;
          securityHeaders = {
            'X-Frame-Options': '',
            'X-Content-Type-Options': '',
            'Strict-Transport-Security': '',
            'Content-Security-Policy': '',
            'X-Robots-Tag': '',
            'Permissions-Policy': '',
            'Referrer-Policy': ''
          };
        } else {
          isBlocked = true;
          status = scraperResponse.status || 0;
        }
      } catch (scraperError: any) {
        console.warn('ScraperAPI fallback failed:', scraperError.message);
      }
    }

    // ============ IF BLOCKED ============
    if (isBlocked) {
      const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const reference = `MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const markdown = `MusePRO\nReal-Time Market Research\nIntelligence Division\n════════════════════════════════════════════════════════════════════\nTECHNICAL SEO AUDIT REPORT\n════════════════════════════════════════════════════════════════════\n\n**Prepared For:** [Client Name]\n**Date:** ${today}\n**Audit Timestamp (UTC):** ${auditTimestamp}\n**Prepared By:** MusePRO SEO Team\n**Reference:** ${reference}\n**Classification:** CONFIDENTIAL\n════════════════════════════════════════════════════════════════════\n\nAUDIT INCOMPLETE – SITE BOT PROTECTION DETECTED\n────────────────────────────────────────────────────────────────────\n\nWe attempted to crawl ${websiteUrl} on ${auditTimestamp}, but the server returned HTTP ${status}.\n\n**What this means:**\nYour website is protected by a bot management system or firewall that blocks automated audit tools. This prevents us from accessing the HTML and resources needed for a complete technical SEO analysis.\n\n**Why this matters for SEO:**\nSearch engine crawlers like Googlebot may also be blocked, which can severely impact indexing and rankings.\n\n**Recommended Next Steps:**\n1. Whitelist our audit bot's IP address or user agent in your firewall/CDN settings.\n2. Temporarily disable bot protection during the audit window.\n3. Verify Googlebot is not blocked using Google Search Console's "Fetch as Google".\n4. Contact us at support@musepro.com with whitelisting details to re-run the audit.\n\n**What we could not check due to the block:**\n- On-page elements (title, meta, H1, images alt)\n- Technical foundation (robots.txt, sitemap, canonical, structured data)\n- Performance metrics (page speed, Core Web Vitals)\n- Security headers and mixed content\n- Internal linking structure\n\n════════════════════════════════════════════════════════════════════\nThis report is generated by MusePRO Senior Research Division.\n════════════════════════════════════════════════════════════════════`;

      const report = await Report.create({
        type: 'seo',
        niche: `Technical Audit: ${parsedUrl.hostname}`,
        country,
        value: '$299',
        data: {
          websiteUrl,
          status,
          isBlocked: true,
          auditTimestamp,
          note: 'Audit incomplete due to bot protection.'
        },
        markdown,
        charts: {},
        traffic_estimate: 0,
        trend_summary: 'Audit incomplete – site blocked automated crawler.'
      });

      return res.status(201).json({ id: report._id, ...report.toObject() });
    }

    // ============ FULL AUDIT ============
    let hasSSL = parsedUrl.protocol === 'https:';
    let hasRobots = false;
    let hasSitemap = false;

    let titleTag = 'MISSING';
    let metaDescription = 'MISSING';
    let h1Count = 0;
    let hasViewport = false;
    let hasJSONLD = false;
    let hasCanonical = false;
    let hasLang = false;
    let hasMixedContent = false;
    let pageSizeKb = 0;
    let missingAltCount = 0;
    let totalImages = 0;
    let internalLinks = 0;
    let externalLinks = 0;
    let textToHtmlRatio = 0;

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
      hasLang = /<html[^>]+lang=["'][^"']+["']/i.test(html);
      hasMixedContent = hasSSL && (/src=["']http:\/\//i.test(html) || /href=["']http:\/\//i.test(html));

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

    // robots.txt and sitemap.xml
    try {
      const robotsRes = await axios.get(new URL('/robots.txt', websiteUrl).toString(), { timeout: 5000 });
      if (robotsRes.status === 200) hasRobots = true;
    } catch {}
    try {
      const sitemapRes = await axios.get(new URL('/sitemap.xml', websiteUrl).toString(), { timeout: 5000 });
      if (sitemapRes.status === 200) hasSitemap = true;
    } catch {}

    // PageSpeed Insights
    let mobileScore: number | null = null;
    let desktopScore: number | null = null;
    let coreWebVitals: any = { mobile: {}, desktop: {} };
    let performanceMeasured = false;

    if (process.env.GOOGLE_API_KEY) {
      try {
        const apiUrl = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
        const mobileResponse = await axios.get(apiUrl, {
          params: { url: websiteUrl, key: process.env.GOOGLE_API_KEY, strategy: 'mobile' },
          timeout: 20000
        });
        mobileScore = Math.round((mobileResponse.data.lighthouseResult?.categories?.performance?.score || 0) * 100);
        const mobileAudits = mobileResponse.data.lighthouseResult?.audits || {};
        coreWebVitals.mobile = {
          lcp: mobileAudits['largest-contentful-paint']?.displayValue || 'N/A',
          fid: mobileAudits['max-potential-fid']?.displayValue || 'N/A',
          cls: mobileAudits['cumulative-layout-shift']?.displayValue || 'N/A',
          fcp: mobileAudits['first-contentful-paint']?.displayValue || 'N/A',
          tbt: mobileAudits['total-blocking-time']?.displayValue || 'N/A'
        };

        const desktopResponse = await axios.get(apiUrl, {
          params: { url: websiteUrl, key: process.env.GOOGLE_API_KEY, strategy: 'desktop' },
          timeout: 20000
        });
        desktopScore = Math.round((desktopResponse.data.lighthouseResult?.categories?.performance?.score || 0) * 100);
        const desktopAudits = desktopResponse.data.lighthouseResult?.audits || {};
        coreWebVitals.desktop = {
          lcp: desktopAudits['largest-contentful-paint']?.displayValue || 'N/A',
          fid: desktopAudits['max-potential-fid']?.displayValue || 'N/A',
          cls: desktopAudits['cumulative-layout-shift']?.displayValue || 'N/A',
          fcp: desktopAudits['first-contentful-paint']?.displayValue || 'N/A',
          tbt: desktopAudits['total-blocking-time']?.displayValue || 'N/A'
        };
        performanceMeasured = true;
      } catch (psError) {
        console.warn('PageSpeed API error:', psError instanceof Error ? psError.message : 'Unknown');
      }
    }

    // ============ BUILD CHECKS ============
    const checks: AuditCheck[] = [
      {
        name: 'Title Tag Present',
        passed: titleTag !== 'MISSING',
        measured: true,
        impactScore: 9,
        effort: 'Low',
        evidence: titleTag !== 'MISSING' ? `Current: "${titleTag}"` : 'Missing',
        recommendation: titleTag !== 'MISSING' ? 'Ensure title includes target keyword and is under 60 characters.' : 'Add a concise, keyword-rich title tag.'
      },
      {
        name: 'Meta Description Present',
        passed: metaDescription !== 'MISSING',
        measured: true,
        impactScore: 7,
        effort: 'Low',
        evidence: metaDescription !== 'MISSING' ? `Current: "${metaDescription.substring(0, 80)}..."` : 'Missing',
        recommendation: metaDescription !== 'MISSING' ? 'Optimize with compelling copy and CTA under 155 characters.' : 'Add meta description to improve CTR.'
      },
      {
        name: 'Single H1 Tag',
        passed: h1Count === 1,
        measured: true,
        impactScore: 6,
        effort: 'Low',
        evidence: `Found ${h1Count} H1 tags`,
        recommendation: h1Count === 0 ? 'Add exactly one H1 containing the primary keyword.' : h1Count > 1 ? 'Reduce to a single H1 for proper structure.' : 'H1 is present.'
      },
      {
        name: 'Viewport Meta Tag',
        passed: hasViewport,
        measured: true,
        impactScore: 8,
        effort: 'Low',
        evidence: hasViewport ? 'Present' : 'Missing',
        recommendation: hasViewport ? 'Good.' : 'Add viewport meta tag for mobile responsiveness.'
      },
      {
        name: 'Structured Data (JSON-LD)',
        passed: hasJSONLD,
        measured: true,
        impactScore: 8,
        effort: 'Medium',
        evidence: hasJSONLD ? 'Found' : 'Not found',
        recommendation: hasJSONLD ? 'Ensure schema type matches page content.' : 'Add appropriate JSON-LD schema for rich snippets.'
      },
      {
        name: 'Canonical Tag',
        passed: hasCanonical,
        measured: true,
        impactScore: 5,
        effort: 'Low',
        evidence: hasCanonical ? 'Present' : 'Missing',
        recommendation: hasCanonical ? 'Verify canonical URLs are correct.' : 'Add canonical tags to prevent duplicate content.'
      },
      {
        name: 'robots.txt Exists',
        passed: hasRobots,
        measured: true,
        impactScore: 4,
        effort: 'Low',
        evidence: hasRobots ? 'Found' : 'Missing',
        recommendation: hasRobots ? 'Review for accidental blocks.' : 'Create robots.txt and submit to Google Search Console.'
      },
      {
        name: 'sitemap.xml Exists',
        passed: hasSitemap,
        measured: true,
        impactScore: 5,
        effort: 'Low',
        evidence: hasSitemap ? 'Found' : 'Missing',
        recommendation: hasSitemap ? 'Ensure it is up-to-date.' : 'Create XML sitemap and submit.'
      },
      {
        name: 'HTTPS Enabled',
        passed: hasSSL,
        measured: true,
        impactScore: 10,
        effort: 'Low',
        evidence: hasSSL ? 'Yes' : 'No',
        recommendation: hasSSL ? 'Good.' : 'Install SSL and force HTTPS sitewide.'
      },
      {
        name: 'Mixed Content',
        passed: !hasMixedContent,
        measured: true,
        impactScore: 9,
        effort: 'Medium',
        evidence: hasMixedContent ? 'Detected' : 'None',
        recommendation: hasMixedContent ? 'Replace all HTTP resources with HTTPS.' : 'No action needed.'
      },
      {
        name: 'X-Frame-Options Header',
        passed: !!securityHeaders['X-Frame-Options'],
        measured: true,
        impactScore: 6,
        effort: 'Low',
        evidence: securityHeaders['X-Frame-Options'] || 'Missing',
        recommendation: 'Add X-Frame-Options header to prevent clickjacking.'
      },
      {
        name: 'X-Content-Type-Options Header',
        passed: !!securityHeaders['X-Content-Type-Options'],
        measured: true,
        impactScore: 5,
        effort: 'Low',
        evidence: securityHeaders['X-Content-Type-Options'] || 'Missing',
        recommendation: 'Add X-Content-Type-Options: nosniff.'
      },
      {
        name: 'HSTS Header',
        passed: !!securityHeaders['Strict-Transport-Security'],
        measured: true,
        impactScore: 7,
        effort: 'Low',
        evidence: securityHeaders['Strict-Transport-Security'] || 'Missing',
        recommendation: 'Add Strict-Transport-Security header.'
      },
      {
        name: 'Content-Security-Policy',
        passed: !!securityHeaders['Content-Security-Policy'],
        measured: true,
        impactScore: 6,
        effort: 'Medium',
        evidence: securityHeaders['Content-Security-Policy'] || 'Missing',
        recommendation: 'Implement Content-Security-Policy to prevent XSS attacks.'
      },
      {
        name: 'Performance Score (Mobile)',
        passed: mobileScore !== null && mobileScore >= 80,
        measured: mobileScore !== null,
        impactScore: 9,
        effort: 'High',
        evidence: mobileScore !== null ? `${mobileScore}/100` : 'Not measured',
        recommendation: mobileScore === null
          ? 'Performance data is not available in this audit cycle. We will provide complete speed analysis once the necessary data integration is in place.'
          : mobileScore < 80 ? 'Optimize images, minify CSS/JS, improve server response.' : 'Maintain current performance.'
      },
      {
        name: 'Performance Score (Desktop)',
        passed: desktopScore !== null && desktopScore >= 80,
        measured: desktopScore !== null,
        impactScore: 7,
        effort: 'Medium',
        evidence: desktopScore !== null ? `${desktopScore}/100` : 'Not measured',
        recommendation: desktopScore === null
          ? 'Performance data is not available in this audit cycle. We will provide complete speed analysis once the necessary data integration is in place.'
          : desktopScore < 80 ? 'Improve caching, reduce render-blocking resources.' : 'Good.'
      },
      {
        name: 'Image Alt Text',
        passed: missingAltCount === 0,
        measured: true,
        impactScore: 7,
        effort: 'Low',
        evidence: `${missingAltCount} images detected without ALT attributes`,
        recommendation: missingAltCount > 0 ? 'Add descriptive alt text to all images.' : 'All images have alt text.'
      },
      {
        name: 'Internal Links Present',
        passed: internalLinks > 0,
        measured: true,
        impactScore: 3,
        effort: 'Low',
        evidence: `${internalLinks} internal links found`,
        recommendation: internalLinks === 0 ? 'Add internal links to improve navigation and distribute link equity.' : 'Internal linking present.'
      },
      {
        name: 'Text-to-HTML Ratio',
        passed: textToHtmlRatio >= 10,
        measured: true,
        impactScore: 4,
        effort: 'Low',
        evidence: `${textToHtmlRatio}%`,
        recommendation: textToHtmlRatio < 10 ? 'Increase text content relative to HTML markup for better crawlability.' : 'Text-to-HTML ratio is healthy.'
      }
    ];

    // ============ CATEGORY MAP & WEIGHTS ============
    const categoryWeights: Record<string, number> = {
      'On-Page SEO': 0.25,
      'Technical Foundation': 0.20,
      'Performance & Core Web Vitals': 0.20,
      'Security & Trust': 0.15,
      'Mobile & User Experience': 0.10,
      'Structured Data & Rich Results': 0.10,
    };

    const finalCategoryMap: Record<string, AuditCheck[]> = {
      'On-Page SEO': [checks[0], checks[1], checks[2], checks[16]], // title, meta, H1, image alt
      'Mobile & User Experience': [checks[3]], // viewport
      'Structured Data & Rich Results': [checks[4]],
      'Technical Foundation': [checks[5], checks[6], checks[7], checks[17]], // canonical, robots, sitemap, internal links
      'Security & Trust': [checks[8], checks[9], checks[10], checks[11], checks[12], checks[13]],
      'Performance & Core Web Vitals': [checks[14], checks[15]],
    };

    // Compute category scores, only measured items
    const categoryScores: Record<string, number | null> = {};
    const categoryMeasuredCount: Record<string, number> = {};
    let totalWeight = 0;
    let weightedScoreSum = 0;

    for (const [cat, catChecks] of Object.entries(finalCategoryMap)) {
      const measuredChecks = catChecks.filter(c => c.measured);
      if (measuredChecks.length === 0) {
        categoryScores[cat] = null; // N/A
        categoryMeasuredCount[cat] = 0;
        continue;
      }
      const totalImpact = measuredChecks.reduce((sum, c) => sum + c.impactScore, 0);
      const achievedImpact = measuredChecks.filter(c => c.passed).reduce((sum, c) => sum + c.impactScore, 0);
      const catScore = totalImpact > 0 ? Math.round((achievedImpact / totalImpact) * 100) : 0;
      categoryScores[cat] = catScore;
      categoryMeasuredCount[cat] = measuredChecks.length;

      if (categoryWeights[cat]) {
        totalWeight += categoryWeights[cat];
        weightedScoreSum += catScore * categoryWeights[cat];
      }
    }

    const overallScore = totalWeight > 0 ? Math.round(weightedScoreSum / totalWeight) : 0;

    // ============ BUILD MARKDOWN ============
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const reference = `MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    let markdown = `MusePRO\nReal-Time Market Research\nIntelligence Division\n════════════════════════════════════════════════════════════════════\nTECHNICAL SEO AUDIT REPORT\nBusiness Impact Edition\n════════════════════════════════════════════════════════════════════\n\n**Prepared For:** [Client Name]\n**Date:** ${today}\n**Audit Timestamp (UTC):** ${auditTimestamp}\n**Prepared By:** MusePRO SEO Team\n**Reference:** ${reference}\n**Classification:** CONFIDENTIAL\n════════════════════════════════════════════════════════════════════\n\n`;

    markdown += `1. EXECUTIVE SUMMARY (BUSINESS IMPACT)\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `We performed a live technical audit of ${websiteUrl} on ${auditTimestamp}. The results below highlight critical issues impacting your search visibility and conversion potential.\n\n`;
    markdown += `**Overall Health Score:** ${overallScore}/100\n`;
    if (categoryScores['Performance & Core Web Vitals'] === null) {
      markdown += `*This score is calculated from the 80% of measurable categories. Performance data was unavailable and has been excluded.*\n\n`;
    }
    const criticalCount = checks.filter(c => c.measured && !c.passed && c.impactScore >= 7).length;
    const warningCount = checks.filter(c => c.measured && !c.passed && c.impactScore >= 4 && c.impactScore < 7).length;
    markdown += `**Critical Issues Found:** ${criticalCount} | **Warnings:** ${warningCount}\n\n`;
    markdown += `**Top Priority Fixes:**\n`;
    const topFixes = checks.filter(c => c.measured && !c.passed && c.impactScore >= 7);
    if (topFixes.length > 0) {
      topFixes.forEach((fix, i) => {
        markdown += ` ${i+1}. ${fix.name} — ${fix.recommendation} (Effort: ${fix.effort})\n`;
      });
    } else {
      markdown += ` No critical issues.\n`;
    }
    markdown += `\n`;

    markdown += `2. SCORE BREAKDOWN (IMPACT MATRIX)\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `| Category | Weight | Score | Measured Items |\n|---|---|---|---|\n`;
    for (const cat in finalCategoryMap) {
      const weight = categoryWeights[cat] ? Math.round(categoryWeights[cat] * 100) : 0;
      const measuredCount = categoryMeasuredCount[cat] || 0;
      const score = categoryScores[cat];
      const scoreDisplay = score === null ? 'N/A' : `${score}/100`;
      markdown += `| ${cat} | ${weight}% | ${scoreDisplay} | ${measuredCount} |\n`;
    }
    markdown += `\n**Overall Score:** ${overallScore}/100\n\n`;

    markdown += `3. DETAILED CHECKS & RECOMMENDATIONS\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `| Check | Status | Impact | Effort | Evidence | Recommendation |\n|---|---|---|---|---|---|\n`;
    checks.forEach(check => {
      let statusEmoji = check.measured ? (check.passed ? '✅ Pass' : check.impactScore >= 7 ? '🔴 Critical' : '⚠️ Warning') : '⚪ Not Measured';
      markdown += `| ${check.name} | ${statusEmoji} | ${check.measured ? check.impactScore : '-'} | ${check.effort} | ${check.evidence} | ${check.recommendation} |\n`;
    });
    markdown += `\n`;

    markdown += `4. PRIORITY ACTION PLAN (30/60/90 DAYS)\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `**Week 1 (Critical Fixes – Immediate ROI):**\n`;
    const criticalFixes = checks.filter(c => c.measured && !c.passed && c.impactScore >= 7);
    if (criticalFixes.length > 0) {
      criticalFixes.forEach(c => {
        markdown += `- ${c.name}: ${c.recommendation} (Effort: ${c.effort})\n`;
      });
    } else {
      markdown += `- No critical issues.\n`;
    }
    markdown += `\n**Weeks 2-4 (Technical Foundation):**\n`;
    const mediumFixes = checks.filter(c => c.measured && !c.passed && c.impactScore >= 4 && c.impactScore < 7);
    if (mediumFixes.length > 0) {
      mediumFixes.forEach(c => {
        markdown += `- ${c.name}: ${c.recommendation} (Effort: ${c.effort})\n`;
      });
    } else {
      markdown += `- No medium-impact issues.\n`;
    }
    markdown += `\n**Months 2-3 (Optimization & Scale):**\n`;
    const lowFixes = checks.filter(c => c.measured && !c.passed && c.impactScore < 4);
    if (lowFixes.length > 0) {
      lowFixes.forEach(c => {
        markdown += `- ${c.name}: ${c.recommendation} (Effort: ${c.effort})\n`;
      });
    } else {
      markdown += `- No low-impact issues.\n`;
    }
    markdown += `\n`;

    // Revenue impact with range
    const measuredHighImpactMissing = checks.filter(c => c.measured && !c.passed && c.impactScore >= 7).length;
    const measuredMediumImpactMissing = checks.filter(c => c.measured && !c.passed && c.impactScore >= 4 && c.impactScore < 7).length;
    const trafficLossLow = measuredHighImpactMissing * 300 + measuredMediumImpactMissing * 100;
    const trafficLossHigh = measuredHighImpactMissing * 800 + measuredMediumImpactMissing * 400;
    const revenueLow = Math.round(trafficLossLow * 0.02 * 100);
    const revenueHigh = Math.round(trafficLossHigh * 0.02 * 100);

    markdown += `5. REVENUE IMPACT ANALYSIS (ESTIMATED RANGE)\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `We estimate the following potential monthly revenue impact if the identified technical issues are resolved:\n\n`;
    markdown += `- High-impact issues: ${measuredHighImpactMissing}, estimated traffic impact: ${trafficLossLow}–${trafficLossHigh} visits/month.\n`;
    markdown += `- Medium-impact issues: ${measuredMediumImpactMissing}, estimated additional traffic impact: ${measuredMediumImpactMissing * 100}–${measuredMediumImpactMissing * 300} visits/month.\n`;
    markdown += `- Assuming a 2% conversion rate and average order value of $100, the potential monthly revenue impact ranges from **$${revenueLow.toLocaleString()} to $${revenueHigh.toLocaleString()}**.\n\n`;
    markdown += `*This is a modeled estimate based on typical industry benchmarks and may vary depending on your actual traffic, conversion metrics, and product pricing.*\n\n`;

    markdown += `6. EVIDENCE & METHODOLOGY\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `**Methodology:** We performed a live crawl of ${websiteUrl} on ${auditTimestamp}, analyzing raw HTML, HTTP headers, auxiliary files, and performance data.\n`;
    markdown += `**Evidence Summary:**\n`;
    markdown += `- Page Fetch: HTTP ${status} | ${responseTime}ms | ${pageSizeKb}KB downloaded.\n`;
    markdown += `- robots.txt: ${hasRobots ? 'Found' : 'Not Found'}\n`;
    markdown += `- sitemap.xml: ${hasSitemap ? 'Found' : 'Not Found'}\n`;

    // Precise security headers wording
    const missingSecurityHeaders = Object.keys(securityHeaders).filter(key => !securityHeaders[key]);
    const securityHeaderStatus = missingSecurityHeaders.length === 0 
      ? 'All recommended headers present' 
      : `Missing: ${missingSecurityHeaders.join(', ')}`;
    markdown += `- Security Headers: ${securityHeaderStatus}\n`;
    markdown += `- PageSpeed: Mobile ${mobileScore !== null ? mobileScore + '/100' : 'N/A'} | Desktop ${desktopScore !== null ? desktopScore + '/100' : 'N/A'}\n\n`;
    markdown += `**Scoring Model:** Weighted categories reflect business impact: On-Page (25%), Technical (20%), Performance (20%), Security (15%), Mobile/UX (10%), Structured Data (10%). Only measurable checks are included in the score; categories with missing data are excluded and shown as N/A.\n\n`;
    markdown += `**Disclaimer:** This is a static analysis and does not include JavaScript rendering. For a complete audit, a full site crawl is recommended.\n\n`;

    markdown += `════════════════════════════════════════════════════════════════════\nThis report is generated by MusePRO Senior Research Division.\n════════════════════════════════════════════════════════════════════`;

    // ============ SAVE REPORT ============
    const report = await Report.create({
      type: 'seo',
      niche: `Technical Audit: ${parsedUrl.hostname}`,
      country,
      value: '$299',
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
        isBlocked: false,
        subtype: 'technical-business',
        auditTimestamp,
        mobileScore,
        desktopScore,
        coreWebVitals,
        checks,
        estimatedRevenueLossMonthly: revenueLow,
        categoryScores,
      },
      markdown,
      charts: {},
      traffic_estimate: 0,
      trend_summary: `Business impact score: ${overallScore}/100`,
    });

    return res.status(201).json({ id: report._id, ...report.toObject() });
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
