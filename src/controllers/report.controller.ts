import { Request, Response, NextFunction } from 'express';
import { Report } from '../models/Report';
import { reportQuerySchema } from '../validators/report';
import { ZodError } from 'zod';

// GET /api/reports - List reports with pagination & filters
export const getReports = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = reportQuerySchema.parse(req.query);
    const filter: any = {};

    // Only fetch valid types
    filter.type = { $in: ['product', 'seo'] };

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
      .select('-data -markdown -charts')
      .lean();

    const result = {
      reports: reports.map((r: any) => ({
        _id: r._id,
        type: r.type,
        niche: r.niche,
        country: r.country,
        value: '$99',
        createdAt: r.createdAt,
      })),
      pagination: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.ceil(total / query.limit),
      },
    };

    res.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid query parameters', details: err.errors });
    }
    next(err);
  }
};

// GET /api/reports/stats - Get report statistics
export const getReportStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filter = { type: { $in: ['product', 'seo'] } };

    const [totalReports, productReports, seoReports, countryStats, recentReports] = await Promise.all([
      Report.countDocuments(filter),
      Report.countDocuments({ ...filter, type: 'product' }),
      Report.countDocuments({ ...filter, type: 'seo' }),
      Report.aggregate([
        { $match: filter },
        { $group: { _id: '$country', count: { $sum: 1 } } },
      ]),
      Report.find(filter).sort({ createdAt: -1 }).limit(5).select('niche type country createdAt').lean(),
    ]);

    res.json({
      totalReports,
      totalValue: `$${totalReports * 99}`,
      byType: { product: productReports, seo: seoReports },
      byCountry: countryStats.reduce((acc: any, curr: any) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {}),
      recentReports,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/:id - Get single report by ID
export const getReportById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await Report.findById(req.params.id);

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    // Validate report type
    if (!['product', 'seo'].includes(report.type)) {
      await Report.findByIdAndDelete(report._id);
      return res.status(404).json({ error: 'Invalid report found and removed' });
    }

    res.json(report);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/reports/:id - Delete single report
export const deleteReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await Report.findByIdAndDelete(req.params.id);

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json({ message: 'Report deleted successfully', id: report._id });
  } catch (err) {
    next(err);
  }
};

// POST /api/reports/export-zip - Bulk export as ZIP
export const bulkExportZip = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Provide array of report IDs' });
    }

    if (ids.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 reports per export' });
    }

    const reports = await Report.find({
      _id: { $in: ids },
      type: { $in: ['product', 'seo'] }
    }).lean();

    if (reports.length === 0) {
      return res.status(404).json({ error: 'No valid reports found' });
    }

    const JSZip = require('jszip');
    const zip = new JSZip();

    reports.forEach((report: any) => {
      const content = report.markdown || JSON.stringify(report.data, null, 2);
      zip.file(`report_${report.niche}_${report.country}_${report._id}.md`, content);
    });

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename=marketmuse_reports_${Date.now()}.zip`,
    });

    res.send(zipBuffer);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/reports/cleanup - Clean invalid/old reports
export const cleanupOldReports = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await (Report as any).cleanupInvalid();

    res.json({
      success: true,
      message: 'Database cleaned successfully',
      deletedCount: result.deletedCount || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/reports/bulk-delete - Delete multiple reports
export const bulkDeleteReports = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Provide array of report IDs' });
    }

    if (ids.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 reports per bulk delete' });
    }

    const result = await Report.deleteMany({
      _id: { $in: ids },
      type: { $in: ['product', 'seo'] }
    });

    res.json({
      success: true,
      message: `${result.deletedCount} reports deleted successfully`,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/search - Search reports by niche
export const searchReports = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { q, limit = 20 } = req.query;

    if (!q || typeof q !== 'string' || q.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const reports = await Report.find({
      niche: { $regex: q, $options: 'i' },
      type: { $in: ['product', 'seo'] }
    })
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .select('-data -markdown -charts')
      .lean();

    res.json({
      query: q,
      results: reports.length,
      reports: reports.map((r: any) => ({
        _id: r._id,
        type: r.type,
        niche: r.niche,
        country: r.country,
        value: '$99',
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
};
