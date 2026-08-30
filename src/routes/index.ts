// src/routes/index.ts
import { Router } from 'express';
import mongoose from 'mongoose';
import { createProductReport, getProductReport } from '../controllers/product.controller';
import { createSEOReport, getSEOReport } from '../controllers/seo.controller';
import { createTechnicalSEOReport, getTechnicalSEOReport } from '../controllers/technical-seo.controller';
import {
  getReports,
  getReportStats,
  getReportById,
  deleteReport,
  updateReport,
  bulkExportZip,
  cleanupOldReports,
  bulkDeleteReports,
  searchReports
} from '../controllers/report.controller';
import { getAgencySettings, updateAgencySettings } from '../controllers/agency.controller';
import { sendReportEmail } from '../services/email';
import { Report } from '../models/Report';
import { SharedReport } from '../models/SharedReport';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const router = Router();

// ============ Health Check ============
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(), 
    service: 'MusePRO', 
    version: '1.0.0' 
  });
});

// ============ Product Research ============
router.post('/product-research', createProductReport);
router.get('/product-research/:id', getProductReport);

// ============ SEO Report ============
router.post('/seo-report', createSEOReport);
router.get('/seo-report/:id', getSEOReport);

// ============ Technical SEO Audit ============
router.post('/technical-seo', createTechnicalSEOReport);
router.get('/technical-seo/:id', getTechnicalSEOReport);

// ============ Reports (CRUD) ============
router.get('/reports/search', searchReports);
router.get('/reports/stats', getReportStats);
router.get('/reports', getReports);
router.get('/reports/:id', getReportById);
router.put('/reports/:id', updateReport);
router.delete('/reports/cleanup', cleanupOldReports);
router.delete('/reports/bulk-delete', bulkDeleteReports);
router.delete('/reports/:id', deleteReport);
router.post('/reports/export-zip', bulkExportZip);

// ============ Agency Settings ============
router.get('/agency-settings', getAgencySettings);
router.put('/agency-settings', updateAgencySettings);

// ============ Email Report ============
router.post('/send-report', async (req, res, next) => {
  try {
    const { email, reportId, subject, body, attachments } = req.body;
    
    if (!email || !reportId) {
      return res.status(400).json({ error: 'Email and reportId are required' });
    }
    if (!mongoose.Types.ObjectId.isValid(reportId)) {
      return res.status(400).json({ error: 'Invalid report ID' });
    }

    const report = await Report.findById(reportId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    const emailAttachments = attachments?.length ? attachments : [{
      name: `${report.niche.replace(/\s+/g, '_')}_report.md`,
      content: Buffer.from(report.markdown || '').toString('base64'),
      contentType: 'text/markdown',
    }];

    await sendReportEmail({
      to: Array.isArray(email) ? email : [email],
      subject: subject || `Your Market Research Report: ${report.niche}`,
      body: body || '<p>Dear Client, please find your report attached.</p>',
      attachments: emailAttachments,
    });

    res.json({ success: true, message: 'Report emailed successfully' });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Email failed';
    res.status(500).json({ error: 'Email failed', details: errorMessage });
  }
});

// ============ Share Report via Link ============
router.post('/reports/:id/share', async (req, res, next) => {
  try {
    const { expiresInHours = 24, password = null } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    
    const shared = await SharedReport.create({
      reportId: req.params.id,
      token,
      expiresAt,
      password: password ? bcrypt.hashSync(password, 10) : null,
    });

    res.json({ 
      link: `/api/reports/share/${token}`, 
      expiresAt 
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to create share link';
    res.status(500).json({ error: errorMessage });
  }
});

// ============ Get Shared Report ============
router.get('/reports/share/:token', async (req, res, next) => {
  try {
    const shared = await SharedReport.findOne({ token: req.params.token });
    if (!shared) return res.status(404).json({ error: 'Invalid link' });
    if (shared.expiresAt < new Date()) return res.status(410).json({ error: 'Link expired' });
    
    if (shared.password) {
      const { password } = req.query;
      if (!password || !bcrypt.compareSync(password as string, shared.password)) {
        return res.status(401).json({ error: 'Password required' });
      }
    }

    const report = await Report.findById(shared.reportId);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Server error';
    res.status(500).json({ error: errorMessage });
  }
});

export default router;
