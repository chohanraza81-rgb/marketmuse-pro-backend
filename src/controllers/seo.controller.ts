import { Request, Response, NextFunction } from 'express';
import { seoReportSchema } from '../validators/report';
import { generateReport } from '../services/reportGenerator.service';
import { Report } from '../models/Report';
import { ZodError } from 'zod';

export const createSEOReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { niche, country } = seoReportSchema.parse(req.body);
    const reportData = await generateReport(niche, country, 'seo');
    const report = await Report.create({ ...reportData, value: '$99', type: 'seo' });
    return res.status(201).json(report);
  } catch (err) {
    if (err instanceof ZodError) return res.status(400).json({ error: err.errors });
    next(err);
  }
};

export const getSEOReport = async (req: Request, res: Response) => {
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  res.json(report);
};
