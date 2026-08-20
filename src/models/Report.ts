import mongoose from 'mongoose';

const ReportSchema = new mongoose.Schema({
  type: { type: String, enum: ['seo', 'product'], required: true },
  niche: { type: String, required: true },
  country: { type: String, required: true },
  value: { type: String },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  keywords: { type: Array, default: [] },
  serp_landscape: { type: Array, default: [] },
  markdown: { type: String, default: 'Generating...' },
  charts: { type: mongoose.Schema.Types.Mixed, default: {} },
  trend_summary: { type: String, default: 'Steady trend.' },
  traffic_estimate: { type: Number, default: 0 },
  chart_data: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

export const Report = mongoose.model('Report', ReportSchema);
