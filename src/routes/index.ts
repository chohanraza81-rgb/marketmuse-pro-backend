import { Router } from 'express';
import { createProductReport, getProductReport } from '../controllers/product.controller';
import { createSEOReport, getSEOReport } from '../controllers/seo.controller';
import { 
  getReports, 
  getReportById, 
  deleteReport, 
  bulkExportZip, 
  cleanupOldReports,
  getReportStats 
} from '../controllers/report.controller';

const router = Router();

// === Product Research Routes ===
router.post('/product-research', createProductReport);
router.get('/product-research/:id', getProductReport);

// === SEO Report Routes ===
router.post('/seo-report', createSEOReport);
router.get('/seo-report/:id', getSEOReport);

// === Reports CRUD ===
router.get('/reports', getReports);
router.get('/reports/stats', getReportStats);
router.delete('/reports/cleanup', cleanupOldReports);
router.get('/reports/:id', getReportById);
router.delete('/reports/:id', deleteReport);
router.post('/reports/export-zip', bulkExportZip);

// === Health Check ===
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'MarketMuse AI PRO MAX ULTRA',
    version: '1.0.0'
  });
});

export default router;
