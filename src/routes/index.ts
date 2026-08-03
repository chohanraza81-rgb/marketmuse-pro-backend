import { Router } from 'express';
import { createProductReport, getProductReport } from '../controllers/product.controller';
import { createSEOReport, getSEOReport } from '../controllers/seo.controller';
import {
  getReports,
  getReportById,
  deleteReport,
  bulkExportZip,
  cleanupOldReports,
  getReportStats,
  bulkDeleteReports,
  searchReports,
} from '../controllers/report.controller';

const router = Router();

// === Health Check ===
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'MarketMuse AI PRO MAX ULTRA',
    version: '1.0.0',
  });
});

// === Product Research ===
router.post('/product-research', createProductReport);
router.get('/product-research/:id', getProductReport);

// === SEO Report ===
router.post('/seo-report', createSEOReport);
router.get('/seo-report/:id', getSEOReport);

// === Reports CRUD ===
router.get('/reports/search', searchReports);
router.get('/reports/stats', getReportStats);
router.get('/reports', getReports);
router.get('/reports/:id', getReportById);
router.delete('/reports/cleanup', cleanupOldReports);
router.delete('/reports/bulk-delete', bulkDeleteReports);
router.delete('/reports/:id', deleteReport);
router.post('/reports/export-zip', bulkExportZip);

export default router;
