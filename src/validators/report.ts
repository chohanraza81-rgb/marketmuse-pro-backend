import { z } from 'zod';

export const productResearchSchema = z.object({
  niche: z.string().min(2).max(100),
  country: z.enum([
    'us', 'gb', 'ca', 'au', 'de', 'sg',  // Tier 1 – High Ticket
    'sa', 'ae', 'pk', 'in', 'tr', 'my'   // Tier 2 – Growth + Volume
  ]),
});

export const seoReportSchema = z.object({
  niche: z.string().min(2).max(100),
  country: z.enum([
    'us', 'gb', 'ca', 'au', 'de', 'sg',
    'sa', 'ae', 'pk', 'in', 'tr', 'my'
  ]),
});

export const reportQuerySchema = z.object({
  type: z.enum(['product', 'seo']).optional(),
  country: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.coerce.number().min(1).max(500).default(50),  // ✅ Increased to 500
  page: z.coerce.number().min(1).default(1),
});
