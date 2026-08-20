import { Router } from 'express';
import { 
  getReports, 
  getReportStats, 
  getReportById, 
  deleteReport, 
  bulkExportZip,
  cleanupOldReports,
  bulkDeleteReports,
  searchReports
} from '../controllers/report.controller';

const router = Router();

// Report management routes
router.get('/', getReports);
router.get('/stats', getReportStats);
router.get('/search', searchReports); // Search by niche
router.get('/:id', getReportById);
router.delete('/:id', deleteReport);

// Bulk operations
router.post('/export-zip', bulkExportZip);
router.delete('/cleanup', cleanupOldReports);
router.delete('/bulk-delete', bulkDeleteReports);

export default router;
