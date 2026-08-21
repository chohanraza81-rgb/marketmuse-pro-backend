import { Router } from 'express';
import mongoose from 'mongoose';
import { createProductReport, getProductReport } from '../controllers/product.controller';
import { createSEOReport, getSEOReport } from '../controllers/seo.controller';
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

const router = Router();

// Health Check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'MusePRO', version: '1.0.0' });
});

// Product Research
router.post('/product-research', createProductReport);
router.get('/product-research/:id', getProductReport);

// SEO Report
router.post('/seo-report', createSEOReport);
router.get('/seo-report/:id', getSEOReport);

// Reports (CRUD + Update)
router.get('/reports/search', searchReports);
router.get('/reports/stats', getReportStats);
router.get('/reports', getReports);
router.get('/reports/:id', getReportById);
router.put('/reports/:id', updateReport);
router.delete('/reports/cleanup', cleanupOldReports);
router.delete('/reports/bulk-delete', bulkDeleteReports);
router.delete('/reports/:id', deleteReport);
router.post('/reports/export-zip', bulkExportZip);

// Agency Settings (White-Label)
router.get('/agency-settings', getAgencySettings);
router.put('/agency-settings', updateAgencySettings);

// Send Report via Email
router.post('/send-report', async (req, res, next) => {
  const { email, reportId } = req.body;
  if (!email || !reportId) return res.status(400).json({ error: 'Email and reportId are required' });
  if (!mongoose.Types.ObjectId.isValid(reportId)) return res.status(400).json({ error: 'Invalid report ID' });

  const report = await Report.findById(reportId);
  if (!report) return res.status(404).json({ error: 'Report not found' });

  await sendReportEmail(email, `Your Market Research Report: ${report.niche}`, report.markdown, `Report type: ${report.type}`);
  res.json({ success: true, message: 'Report emailed successfully' });
});

export default router;
