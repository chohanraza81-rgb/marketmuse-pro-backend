import { Router } from 'express';
import { createProductReport } from '../controllers/product.controller';
import { createSEOReport } from '../controllers/seo.controller';
import { getReports, getReportById, deleteReport, bulkExportZip } from '../controllers/report.controller';

const router = Router();

// Product research
router.post('/product-research', createProductReport);
// SEO report
router.post('/seo-report', createSEOReport);
// Reports CRUD
router.get('/reports', getReports);
router.get('/reports/:id', getReportById);
router.delete('/reports/:id', deleteReport);
router.post('/reports/export-zip', bulkExportZip);

export default router;
