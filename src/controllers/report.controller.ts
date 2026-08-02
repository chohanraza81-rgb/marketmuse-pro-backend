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
      .select('-data -markdown -charts') // Exclude heavy fields for listing
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

// GET /api/reports/:id - Get single report
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

// DELETE /api/reports/:id - Delete report
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

// GET /api/reports/stats - Get report statistics
export const getReportStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filter = { type: { $in: ['product', 'seo'] } };
    
    const [totalReports, productReports, seoReports, countryStats] = await Promise.all([
      Report.countDocuments(filter),
      Report.countDocuments({ ...filter, type: 'product' }),
      Report.countDocuments({ ...filter, type: 'seo' }),
      Report.aggregate([
        { $match: filter },
        { $group: { _id: '$country', count: { $sum: 1 } } },
      ]),
    ]);

    res.json({
      totalReports,
      totalValue: `$${totalReports * 99}`,
      byType: {
        product: productReports,
        seo: seoReports,
      },
      byCountry: countryStats.reduce((acc: any, curr: any) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {}),
    });
  } catch (err) {
    next(err);
  }
};
