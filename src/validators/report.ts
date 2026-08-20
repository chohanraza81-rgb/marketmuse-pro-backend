import { z } from 'zod';

export const seoReportSchema = z.object({
  niche: z.string().min(1, 'Niche is required'),
  country: z.string().min(2, 'Country code is required'),
});

export const productReportSchema = z.object({
  niche: z.string().min(1, 'Niche is required'),
  country: z.string().min(2, 'Country code is required'),
});

export const reportQuerySchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(20),
  type: z.enum(['seo', 'product']).optional(),
  country: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
