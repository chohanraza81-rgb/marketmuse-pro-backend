// src/controllers/brand-protection.controller.ts
import { Request, Response } from 'express';
import { generateBrandProtectionReport } from '../services/brand-protection.generator';
import { Report } from '../models/Report';

/**
 * POST /api/brand-protection
 * Generate a counterfeit intelligence report
 */
export const createBrandProtectionReport = async (req: Request, res: Response) => {
  try {
    const { brand, category, country, annualRevenue } = req.body;

    // ── Validation ──
    if (!brand || !category || !country) {
      return res.status(400).json({
        error: 'Missing required fields: brand, category, country',
      });
    }

    console.log(`🎯 [Brand Protection] Generating for ${brand} (${category}) in ${country}...`);

    // ── Generate Report ──
    const reportData = await generateBrandProtectionReport(brand, category, country);

    // ── Save to Database ──
    const savedReport = await Report.create({
      type: 'brand_protection',
      niche: reportData.niche || `${brand} — ${category}`,
      country,
      data: reportData.data,
      markdown: reportData.markdown,
      trend_summary: reportData.trend_summary,
      keywords: [],
      serp_landscape: [],
      chart_data: reportData.chart_data,
      clientName: null,
      remark: null,
    });

    console.log(`✅ [Brand Protection] Report saved: ${savedReport._id}`);

    // ── Return Response ──
    return res.status(201).json(savedReport);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to generate report';
    console.error('❌ [Brand Protection] Error:', errorMessage);
    return res.status(500).json({ error: errorMessage });
  }
};

/**
 * GET /api/brand-protection/:id
 * Fetch a brand protection report by ID
 */
export const getBrandProtectionReport = async (req: Request, res: Response) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    return res.json(report);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Server error';
    return res.status(500).json({ error: errorMessage });
  }
};
