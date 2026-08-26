import { Request, Response, NextFunction } from 'express';
import { Report } from '../models/Report';
import { reportQuerySchema } from '../validators/report';
import { ZodError } from 'zod';

// GET /api/reports - List reports with pagination & filters
export const getReports = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = reportQuerySchema.parse(req.query);
    const filter: any = { type: { $in: ['product', 'seo'] } };
    if (query.type) filter.type = query.type;
    if (query.country) filter.country = query.country.toLowerCase();
    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) filter.createdAt.$gte = new Date(query.startDate);
      if (query.endDate) filter.createdAt.$lte = new Date(query.endDate);
    }

    const total = await Report.countDocuments(filter);
    const reports = await Report.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .select('-data -markdown -charts -chart_data') // Minimal projection for list
      .lean();

    res.json({
      reports: reports.map((r: any) => ({
        _id: r._id,
        type: r.type,
        niche: r.niche,
        country: r.country,
        clientName: r.clientName || 'Client Name',
        value: r.type === 'product' ? '$149' : '$99',
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        remark: r.remark || ''
      })),
      pagination: { total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) },
    });
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid query', details: err.errors });
    next(err);
  }
};

// GET /api/reports/stats
export const getReportStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filter = { type: { $in: ['product', 'seo'] } };
    const [totalReports, productReports, seoReports] = await Promise.all([
      Report.countDocuments(filter),
      Report.countDocuments({ ...filter, type: 'product' }),
      Report.countDocuments({ ...filter, type: 'seo' }),
    ]);
    res.json({ totalReports, totalValue: `$${totalReports * 99}`, byType: { product: productReports, seo: seoReports } });
  } catch (err) { next(err); }
};

// GET /api/reports/:id
export const getReportById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const returnReport = {
      ...report.toObject(),
      remark: report.remark || '', // ✅ Include remark
      sixMonthTrafficEstimate: (report as any).traffic_estimate || (report as any).sixMonthTrafficEstimate || 0,
      trendSummary: (report as any).trend_summary || 'Steady trend detected.',
      chartData: (report as any).chart_data || {},
    };
    res.json(returnReport);
  } catch (err) { next(err); }
};

// PUT /api/reports/:id - Update report metadata and/or markdown (With Remark Support)
export const updateReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { clientName, markdown, remark } = req.body;
    const updateData: any = {};

    if (clientName) updateData.clientName = clientName;
    if (markdown) updateData.markdown = markdown;
    if (remark !== undefined) updateData.remark = remark; // ✅ Remark added

    const report = await Report.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (err) { next(err); }
};

// DELETE /api/reports/:id
export const deleteReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await Report.findByIdAndDelete(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json({ message: 'Report deleted', id: report._id });
  } catch (err) { next(err); }
};

// POST /api/reports/export-zip
export const bulkExportZip = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Provide array of report IDs' });
    if (ids.length > 50) return res.status(400).json({ error: 'Maximum 50 reports per export' });

    const reports = await Report.find({ _id: { $in: ids }, type: { $in: ['product', 'seo'] } }).lean();
    if (reports.length === 0) return res.status(404).json({ error: 'No valid reports found' });

    const JSZip = require('jszip');
    const zip = new JSZip();
    reports.forEach((report: any) => {
      const content = report.markdown || JSON.stringify(report.data, null, 2);
      zip.file(`report_${report.niche}_${report.country}_${report._id}.md`, content);
    });

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename=marketmuse_reports_${Date.now()}.zip` });
    res.send(zipBuffer);
  } catch (err) { next(err); }
};

// DELETE /api/reports/cleanup
export const cleanupOldReports = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await (Report as any).cleanupInvalid();
    res.json({ success: true, message: 'Database cleaned successfully', deletedCount: result.deletedCount || 0, timestamp: new Date().toISOString() });
  } catch (err) { next(err); }
};

// DELETE /api/reports/bulk-delete
export const bulkDeleteReports = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Provide array of report IDs' });
    if (ids.length > 100) return res.status(400).json({ error: 'Maximum 100 reports per bulk delete' });

    const result = await Report.deleteMany({ _id: { $in: ids }, type: { $in: ['product', 'seo'] } });
    res.json({ success: true, message: `${result.deletedCount} reports deleted successfully`, deletedCount: result.deletedCount });
  } catch (err) { next(err); }
};

// GET /api/reports/search
export const searchReports = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, limit = 20 } = req.query;
    if (!q || typeof q !== 'string' || q.length < 2) return res.status(400).json({ error: 'Search query must be at least 2 characters' });

    const reports = await Report.find({ niche: { $regex: q, $options: 'i' }, type: { $in: ['product', 'seo'] } })
      .sort({ createdAt: -1 }).limit(Number(limit)).select('-data -markdown -charts -chart_data').lean();

    res.json({
      query: q,
      results: reports.length,
      reports: reports.map((r: any) => ({ _id: r._id, type: r.type, niche: r.niche, country: r.country, value: r.type === 'product' ? '$149' : '$99', createdAt: r.createdAt, remark: r.remark || '' })),
    });
  } catch (err) { next(err); }
};
