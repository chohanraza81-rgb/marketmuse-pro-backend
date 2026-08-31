// technical-seo.controller.ts
import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { z, ZodError } from 'zod';
import { Report } from '../models/Report';
import { env } from '../config/env';

const technicalSeoSchema = z.object({
  websiteUrl: z.string().url({ message: "Invalid URL" }),
  country: z.string().length(2),
});

interface AuditCheck {
  name: string;
  passed: boolean;
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

    // ============ PRIMARY FETCH (Normal axios) ============
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

      // Capture security headers from primary response
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

    // ============ FALLBACK: ScraperAPI if blocked or not 200 ============
    if (isBlocked || status !== 200) {
      console.log('⚠️ Normal fetch failed or blocked. Attempting ScraperAPI fallback...');
      try {
        const scraperResponse = await axios.get('http://api.scraperapi.com/', {
          params: {
            api_key: env.SCRAPER_API_KEY || process.env.SCRAPER_API_KEY,
            url: websiteUrl,
            render: false, // set to true if JavaScript rendering is required
            premium: false,
          },
          timeout: 30000,
        });
        if (scraperResponse.status === 200 && typeof scraperResponse.data === 'string') {
          html = scraperResponse.data;
          status = 200;
          responseTime = Date.now() - startTime;
          isBlocked = false;
          // Security headers from ScraperAPI are not available; set empty
          securityHeaders = {
            'X-Frame-Options': '',
            'X-Content-Type-Options': '',
            'Strict-Transport-Security': '',
            'Content-Security-Policy': '',
            'X-Robots-Tag': '',
            'Permissions-Policy': '',
            'Referrer-Policy': ''
          };
          console.log('✅ ScraperAPI fallback succeeded.');
        } else {
          // ScraperAPI also failed
          isBlocked = true;
          status = scraperResponse.status || 0;
        }
      } catch (scraperError: any) {
        console.warn('❌ ScraperAPI fallback failed:', scraperError.message);
        // Keep isBlocked true
      }
    }

    // ============ IF STILL BLOCKED – INCOMPLETE REPORT ============
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

      return res.status(201).json({ id: report._id, markdown, blocked: true });
    }

    // ============ FULL AUDIT (PAGE ACCESSIBLE) ============
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

    // PageSpeed Insights (optional)
    let mobileScore: number | null = null;
    let desktopScore: number | null = null;
    let coreWebVitals: any = { mobile: {}, desktop: {} };

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
      } catch (psError) {
        console.warn('PageSpeed API error:', psError instanceof Error ? psError.message : 'Unknown');
      }
    }

    // ============ BUILD CHECKS ============
    const checks: AuditCheck[] = [
      {
        name: 'Title Tag Present',
        passed: titleTag !== 'MISSING',
        impactScore: 9,
        effort: 'Low',
        evidence: titleTag !== 'MISSING' ? `Current: "${titleTag}"` : 'Missing',
        recommendation: titleTag !== 'MISSING' ? 'Ensure title includes target keyword and is under 60 characters.' : 'Add a concise, keyword-rich title tag.'
      },
      {
        name: 'Meta Description Present',
        passed: metaDescription !== 'MISSING',
        impactScore: 7,
        effort: 'Low',
        evidence: metaDescription !== 'MISSING' ? `Current: "${metaDescription.substring(0, 80)}..."` : 'Missing',
        recommendation: metaDescription !== 'MISSING' ? 'Optimize with compelling copy and CTA under 155 characters.' : 'Add meta description to improve CTR.'
      },
      {
        name: 'Single H1 Tag',
        passed: h1Count === 1,
        impactScore: 6,
        effort: 'Low',
        evidence: `Found ${h1Count} H1 tags`,
        recommendation: h1Count === 0 ? 'Add exactly one H1 containing the primary keyword.' : h1Count > 1 ? 'Reduce to a single H1 for proper structure.' : 'H1 is present.'
      },
      {
        name: 'Viewport Meta Tag',
        passed: hasViewport,
        impactScore: 8,
        effort: 'Low',
        evidence: hasViewport ? 'Present' : 'Missing',
        recommendation: hasViewport ? 'Good.' : 'Add viewport meta tag for mobile responsiveness.'
      },
      {
        name: 'Structured Data (JSON-LD)',
        passed: hasJSONLD,
        impactScore: 8,
        effort: 'Medium',
        evidence: hasJSONLD ? 'Found' : 'Not found',
        recommendation: hasJSONLD ? 'Ensure schema type matches page content.' : 'Add appropriate JSON-LD schema for rich snippets.'
      },
      {
        name: 'Canonical Tag',
        passed: hasCanonical,
        impactScore: 5,
        effort: 'Low',
        evidence: hasCanonical ? 'Present' : 'Missing',
        recommendation: hasCanonical ? 'Verify canonical URLs are correct.' : 'Add canonical tags to prevent duplicate content.'
      },
      {
        name: 'robots.txt Exists',
        passed: hasRobots,
        impactScore: 4,
        effort: 'Low',
        evidence: hasRobots ? 'Found' : 'Missing',
        recommendation: hasRobots ? 'Review for accidental blocks.' : 'Create robots.txt and submit to Google Search Console.'
      },
      {
        name: 'sitemap.xml Exists',
        passed: hasSitemap,
        impactScore: 5,
        effort: 'Low',
        evidence: hasSitemap ? 'Found' : 'Missing',
        recommendation: hasSitemap ? 'Ensure it is up-to-date.' : 'Create XML sitemap and submit.'
      },
      {
        name: 'HTTPS Enabled',
        passed: hasSSL,
        impactScore: 10,
        effort: 'Low',
        evidence: hasSSL ? 'Yes' : 'No',
        recommendation: hasSSL ? 'Good.' : 'Install SSL and force HTTPS sitewide.'
      },
      {
        name: 'Mixed Content',
        passed: !hasMixedContent,
        impactScore: 9,
        effort: 'Medium',
        evidence: hasMixedContent ? 'Detected' : 'None',
        recommendation: hasMixedContent ? 'Replace all HTTP resources with HTTPS.' : 'No action needed.'
      },
      {
        name: 'X-Frame-Options Header',
        passed: !!securityHeaders['X-Frame-Options'],
        impactScore: 6,
        effort: 'Low',
        evidence: securityHeaders['X-Frame-Options'] || 'Missing',
        recommendation: 'Add X-Frame-Options to prevent clickjacking.'
      },
      {
        name: 'X-Content-Type-Options Header',
        passed: !!securityHeaders['X-Content-Type-Options'],
        impactScore: 5,
        effort: 'Low',
        evidence: securityHeaders['X-Content-Type-Options'] || 'Missing',
        recommendation: 'Add X-Content-Type-Options: nosniff.'
      },
      {
        name: 'HSTS Header',
        passed: !!securityHeaders['Strict-Transport-Security'],
        impactScore: 7,
        effort: 'Low',
        evidence: securityHeaders['Strict-Transport-Security'] || 'Missing',
        recommendation: 'Add Strict-Transport-Security header.'
      },
      {
        name: 'Content-Security-Policy',
        passed: !!securityHeaders['Content-Security-Policy'],
        impactScore: 6,
        effort: 'Medium',
        evidence: securityHeaders['Content-Security-Policy'] || 'Missing',
        recommendation: 'Implement CSP to prevent XSS attacks.'
      },
      {
        name: 'Performance Score (Mobile)',
        passed: mobileScore !== null && mobileScore >= 80,
        impactScore: 9,
        effort: 'High',
        evidence: mobileScore !== null ? `${mobileScore}/100` : 'Not measured',
        recommendation: mobileScore !== null && mobileScore < 80 ? 'Optimize images, minify CSS/JS, improve server response.' : 'Maintain current performance.'
      },
      {
        name: 'Performance Score (Desktop)',
        passed: desktopScore !== null && desktopScore >= 80,
        impactScore: 7,
        effort: 'Medium',
        evidence: desktopScore !== null ? `${desktopScore}/100` : 'Not measured',
        recommendation: desktopScore !== null && desktopScore < 80 ? 'Improve caching, reduce render-blocking resources.' : 'Good.'
      }
    ];

    // ============ CATEGORY WEIGHTS & SCORING ============
    const categoryMap: Record<string, AuditCheck[]> = {
      'On-Page SEO': [checks[0], checks[1], checks[2]],
      'Mobile & User Experience': [checks[3]],
      'Structured Data & Rich Results': [checks[4]],
      'Technical Foundation': [checks[5], checks[6], checks[7]],
      'Security & Trust': [checks[8], checks[9], checks[10], checks[11], checks[12], checks[13]],
      'Performance & Core Web Vitals': [checks[14], checks[15]]
    };
    const categoryWeights: Record<string, number> = {
      'On-Page SEO': 0.25,
      'Technical Foundation': 0.20,
      'Performance & Core Web Vitals': 0.20,
      'Security & Trust': 0.15,
      'Mobile & User Experience': 0.10,
      'Structured Data & Rich Results': 0.10,
    };

    let overallScore = 0;
    const categoryScores: Record<string, number> = {};
    for (const [cat, catChecks] of Object.entries(categoryMap)) {
      const totalImpact = catChecks.reduce((sum, c) => sum + c.impactScore, 0);
      const achievedImpact = catChecks.filter(c => c.passed).reduce((sum, c) => sum + c.impactScore, 0);
      const catScore = totalImpact > 0 ? Math.round((achievedImpact / totalImpact) * 100) : 0;
      categoryScores[cat] = catScore;
      overallScore += catScore * categoryWeights[cat];
    }
    overallScore = Math.round(overallScore);

    // ============ BUILD MARKDOWN ============
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const reference = `MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    let markdown = `MusePRO\nReal-Time Market Research\nIntelligence Division\n════════════════════════════════════════════════════════════════════\nTECHNICAL SEO AUDIT REPORT\nBusiness Impact Edition\n════════════════════════════════════════════════════════════════════\n\n**Prepared For:** [Client Name]\n**Date:** ${today}\n**Audit Timestamp (UTC):** ${auditTimestamp}\n**Prepared By:** MusePRO SEO Team\n**Reference:** ${reference}\n**Classification:** CONFIDENTIAL\n════════════════════════════════════════════════════════════════════\n\n`;

    markdown += `1. EXECUTIVE SUMMARY (BUSINESS IMPACT)\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `We performed a live technical audit of ${websiteUrl} on ${auditTimestamp}. The results below highlight critical issues impacting your search visibility and conversion potential.\n\n`;
    markdown += `**Overall Health Score:** ${overallScore}/100\n`;
    const criticalCount = checks.filter(c => !c.passed && c.impactScore >= 7).length;
    const warningCount = checks.filter(c => !c.passed && c.impactScore >= 4 && c.impactScore < 7).length;
    markdown += `**Critical Issues Found:** ${criticalCount} | **Warnings:** ${warningCount}\n\n`;
    markdown += `**Top 3 Fixes with Immediate ROI:**\n`;
    checks.filter(c => !c.passed && c.impactScore >= 7).slice(0, 3).forEach((fix, i) => {
      markdown += ` ${i+1}. ${fix.name} — ${fix.recommendation} (Effort: ${fix.effort})\n`;
    });
    markdown += `\n`;

    markdown += `2. SCORE BREAKDOWN (IMPACT MATRIX)\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `| Category | Weight | Score |\n|---|---|---|\n`;
    for (const cat in categoryScores) {
      markdown += `| ${cat} | ${Math.round(categoryWeights[cat] * 100)}% | ${categoryScores[cat]}/100 |\n`;
    }
    markdown += `\n**Overall Score:** ${overallScore}/100\n\n`;

    markdown += `3. DETAILED CHECKS & RECOMMENDATIONS\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `| Check | Status | Impact | Effort | Evidence | Recommendation |\n|---|---|---|---|---|---|\n`;
    checks.forEach(check => {
      const statusEmoji = check.passed ? '✅ Pass' : check.impactScore >= 7 ? '🔴 Critical' : '⚠️ Warning';
      markdown += `| ${check.name} | ${statusEmoji} | ${check.impactScore} | ${check.effort} | ${check.evidence} | ${check.recommendation} |\n`;
    });
    markdown += `\n`;

    markdown += `4. PRIORITY ACTION PLAN (30/60/90 DAYS)\n────────────────────────────────────────────────────────────────────\n`;
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

    const highImpactMissing = checks.filter(c => !c.passed && c.impactScore >= 7).length;
    const mediumImpactMissing = checks.filter(c => !c.passed && c.impactScore >= 4 && c.impactScore < 7).length;
    const estimatedMonthlyTrafficLoss = highImpactMissing * 500 + mediumImpactMissing * 200;
    const estimatedRevenueLossMonthly = Math.round(estimatedMonthlyTrafficLoss * 0.02 * 100);
    markdown += `5. REVENUE IMPACT ESTIMATE (MODELED)\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `Based on typical industry benchmarks, we estimate the following monthly revenue loss due to unfixed technical issues:\n\n`;
    markdown += `- High-impact missing items: ${highImpactMissing} → est. ${highImpactMissing * 500} visits/month lost.\n`;
    markdown += `- Medium-impact missing items: ${mediumImpactMissing} → est. ${mediumImpactMissing * 200} visits/month lost.\n`;
    markdown += `- Assuming a 2% conversion rate and $100 average order value, **estimated monthly revenue loss: $${estimatedRevenueLossMonthly.toLocaleString()}**.\n\n`;
    markdown += `*This is a modeled estimate and may vary based on your actual traffic, conversion rates, and product pricing.*\n\n`;

    markdown += `6. EVIDENCE & METHODOLOGY\n────────────────────────────────────────────────────────────────────\n`;
    markdown += `**Methodology:** We performed a live crawl of ${websiteUrl} on ${auditTimestamp}, analyzing raw HTML, HTTP headers, auxiliary files, and performance data.\n`;
    markdown += `**Evidence Summary:**\n`;
    markdown += `- Page Fetch: HTTP ${status} | ${responseTime}ms | ${pageSizeKb}KB downloaded.\n`;
    markdown += `- robots.txt: ${hasRobots ? 'Found' : 'Not Found'}\n`;
    markdown += `- sitemap.xml: ${hasSitemap ? 'Found' : 'Not Found'}\n`;
    markdown += `- Security Headers: ${Object.values(securityHeaders).every(v => v === '') ? 'None present' : 'Partial presence detected'}.\n`;
    markdown += `- PageSpeed: Mobile ${mobileScore !== null ? mobileScore + '/100' : 'N/A'} | Desktop ${desktopScore !== null ? desktopScore + '/100' : 'N/A'}\n\n`;
    markdown += `**Scoring Model:** Weighted categories reflect business impact: On-Page (25%), Technical (20%), Performance (20%), Security (15%), Mobile/UX (10%), Structured Data (10%). Each check has an impact score (1-10) and effort level. Overall score indicates the percentage of critical impact items that are compliant.\n\n`;
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
        estimatedRevenueLossMonthly,
        categoryScores,
      },
      markdown,
      charts: {},
      traffic_estimate: 0,
      trend_summary: `Business impact score: ${overallScore}/100`,
    });

    return res.status(201).json({ id: report._id, markdown, score: overallScore });
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
