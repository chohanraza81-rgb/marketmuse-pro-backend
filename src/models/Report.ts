import mongoose, { Schema, Document } from 'mongoose';

export interface IReport extends Document {
  type: 'product' | 'seo';
  niche: string;
  country: string;
  value: string; // "$99"
  data: any; // full Groq output
  markdown: string;
  charts: any;
  createdAt: Date;
}

const ReportSchema = new Schema<IReport>({
  type: { type: String, enum: ['product', 'seo'], required: true },
  niche: { type: String, required: true, index: true },
  country: { type: String, required: true, index: true },
  value: { type: String, default: '$99' },
  data: { type: Schema.Types.Mixed, required: true },
  markdown: { type: String, required: true },
  charts: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now, index: true },
});

export const Report = mongoose.model<IReport>('Report', ReportSchema);
