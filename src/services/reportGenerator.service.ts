import { generateSEOReport } from './seo.report.generator';
import { generateProductReport } from './product.report.generator';

export async function generateReport(niche: string, country: string, type: 'seo' | 'product') {
  // Dispatch based on type
  if (type === 'product') {
    return generateProductReport(niche, country);
  }
  // Default to SEO
  return generateSEOReport(niche, country);
}
