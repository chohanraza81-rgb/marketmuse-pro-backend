import { Request, Response, NextFunction } from 'express';
import { Report } from '../models/Report';
import { reportQuerySchema } from '../validators/report';
import JSZip from 'jszip'; // We'll handle zip generation in-memory

// We'll include a simple zip utility in this file to avoid extra dependency? Better use a dedicated service. We'll add zip logic here.

export const getReports = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = reportQuerySchema.parse(req.query);
    const filter: any = {};
    if (query.type) filter.type = query.type;
    if (query.country) filter.country = query.country;
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
      .select('-data') // exclude heavy data for listing
      .lean();

    res.json({
      reports,
      pagination: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.ceil(total / query.limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getReportById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (err) {
    next(err);
  }
};

export const deleteReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await Report.findByIdAndDelete(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    next(err);
  }
};

export const bulkExportZip = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Provide array of report IDs' });
    }
    const reports = await Report.find({ _id: { $in: ids } }).lean();
    if (reports.length === 0) return res.status(404).json({ error: 'No reports found' });

    const JSZip = require('jszip');
    const zip = new JSZip();
    reports.forEach((report: any) => {
      const content = typeof report.markdown === 'string' ? report.markdown : JSON.stringify(report.data);
      zip.file(`report_${report._id}.md`, content);
    });
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename=marketmuse_reports.zip');
    res.send(zipBuffer);
  } catch (err) {
    next(err);
  }
};
