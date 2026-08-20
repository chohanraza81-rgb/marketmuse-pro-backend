import { Request, Response, NextFunction } from 'express';
import { Report } from '../models/Report';
import { reportQuerySchema } from '../validators/report';
import { ZodError } from 'zod';

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
      .select('-data -markdown -charts') // minimal projection for list
      .lean();

    res.json({
      reports: reports.map((r: any) => ({
        _id: r._id,
        type: r.type,
        niche: r.niche,
        country: r.country,
        value: r.type === 'product' ? '$149' : '$99',
        createdAt: r.createdAt,
      })),
      pagination: { total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) },
    });
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid query', details: err.errors });
    next(err);
  }
};

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

export const getReportById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    // 🛡️ EXTRA SAFETY: Ensure frontend gets the exact computed fields
    const returnReport = {
      ...report.toObject(),
      sixMonthTrafficEstimate: (report as any).traffic_estimate || (report as any).sixMonthTrafficEstimate || 0,
      trendSummary: (report as any).trend_summary || 'Steady trend detected.',
      chartData: (report as any).chart_data || {},
    };
    res.json(returnReport);
  } catch (err) { next(err); }
};

export const deleteReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const report = await Report.findByIdAndDelete(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json({ message: 'Report deleted', id: report._id });
  } catch (err) { next(err); }
};
