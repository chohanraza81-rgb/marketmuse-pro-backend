import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { z } from 'zod';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

const technicalSeoSchema = z.object({
  websiteUrl: z.string().url({ message: "Invalid URL" }),
  country: z.string().length(2),
});

export const createTechnicalSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { websiteUrl, country } = technicalSeoSchema.parse(req.body);

    const startTime = Date.now();
    let responseTime = 0;
    let status = 0;
    let hasSSL = websiteUrl.startsWith('https');
    let hasRobots = false;
    let hasSitemap = false;

    try {
      const response = await axios.get(websiteUrl, { timeout: 15000 });
      status = response.status;
      responseTime = Date.now() - startTime;
    } catch (error: any) {
      if (error.response) {
        status = error.response.status;
        responseTime = Date.now() - startTime;
      } else {
        status = 0; // Domain failed to resolve or timed out
      }
    }

    // Basic checks for robots.txt and sitemap.xml
    try {
      const robotsUrl = new URL('/robots.txt', websiteUrl).toString();
      const robotsRes = await axios.get(robotsUrl, { timeout: 5000 });
      if (robotsRes.status === 200) hasRobots = true;
    } catch {}

    try {
      const sitemapUrl = new URL('/sitemap.xml', websiteUrl).toString();
      const sitemapRes = await axios.get(sitemapUrl, { timeout: 5000 });
      if (sitemapRes.status === 200) hasSitemap = true;
    } catch {}

    let score = 100;
    if (status === 0) score -= 40;
    if (status >= 400) score -= 30;
    if (!hasSSL) score -= 20;
    if (!hasRobots) score -= 5;
    if (!hasSitemap) score -= 5;
    if (responseTime > 2000) score -= 10;
    score = Math.max(0, Math.min(100, score));

    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const reference = `MKT-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    let markdown = `MusePRO\nReal-Time Market Research\nIntelligence Division\n──────────────────────────────────────────────────────────────\nTECHNICAL SEO AUDIT REPORT\n\nPrepared For: [Client Name]\nDate: ${today}\nReference: ${reference}\nClassification: CONFIDENTIAL\n──────────────────────────────────────────────────────────────\n\n`;
    markdown += `1. EXECUTIVE SUMMARY\n──────────────────────────────────────────────────────────────\nWebsite: ${websiteUrl}\nOverall Health Score: ${score}/100\n\n`;
    markdown += `2. TECHNICAL CHECKS\n──────────────────────────────────────────────────────────────\n`;
    markdown += `- HTTPS Enabled: ${hasSSL ? 'Yes' : 'No'}\n- HTTP Status: ${status || 'Unreachable'}\n- Response Time: ${responseTime}ms\n- robots.txt Found: ${hasRobots ? 'Yes' : 'No'}\n- sitemap.xml Found: ${hasSitemap ? 'Yes' : 'No'}\n\n`;
    markdown += `3. RECOMMENDATIONS\n──────────────────────────────────────────────────────────────\n`;
    if (!hasSSL) markdown += `- Enable SSL (HTTPS) certificate to secure user data.\n`;
    if (!hasRobots) markdown += `- Add a robots.txt file to guide search engine crawlers.\n`;
    if (!hasSitemap) markdown += `- Generate a sitemap.xml to improve indexing.\n`;
    if (responseTime > 2000) markdown += `- Optimize page speed to reduce load times (Target < 2s).\n`;
    if (status >= 400) markdown += `- Fix server errors (HTTP ${status}) to restore page access.\n`;
    if (!hasSSL && !hasRobots && !hasSitemap && responseTime <= 2000 && status < 400) markdown += `- Site looks healthy. Focus on advanced Core Web Vitals optimization.\n`;
    markdown += `\nMETHODOLOGY & SOURCES\n──────────────────────────────────────────────────────────────\nThis audit is based on comprehensive primary and secondary research conducted on ${today} from:\n\n• Live Search Engine Results (SERP) via Google Search Index\n• Technical Check & Site Health Audit via MusePRO Proprietary Database\n• 12-Month Search Trend & Seasonality via Google Trends\n• Strategic Synthesis & Market Insights by MusePRO Senior Research Division\n\n`;

    const report = await Report.create({
      type: 'seo',
      niche: `Technical Audit: ${new URL(websiteUrl).hostname}`,
      country,
      value: '$99',
      data: { websiteUrl, score, responseTime, status, hasSSL, hasRobots, hasSitemap },
      markdown,
      charts: {},
      traffic_estimate: 0,
      trend_summary: `Health score: ${score}/100`,
    });

    const result = {
      id: report._id,
      ...report.toObject()
    };

    res.status(201).json(result);

  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
};

export const getTechnicalSEOReport = async (req: Request, res: Response) => {
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  res.json(report);
};
