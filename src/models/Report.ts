import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IReport extends Document {
  type: 'product' | 'seo';
  niche: string;
  country: string;
  value: string;
  data: any;
  markdown: string;
  charts: any;
  createdAt: Date;
}

interface IReportModel extends Model<IReport> {
  cleanupInvalid(): Promise<{ deletedCount: number }>;
}

const ReportSchema = new Schema<IReport, IReportModel>(
  {
    type: {
      type: String,
      required: [true, 'Report type is required'],
      enum: {
        values: ['product', 'seo'],
        message: '{VALUE} is not a valid report type. Must be "product" or "seo"'
      },
      validate: {
        validator: function(v: string): boolean {
          return ['product', 'seo'].includes(v);
        },
        message: 'Type must be either "product" or "seo"'
      }
    },
    niche: {
      type: String,
      required: [true, 'Niche is required'],
      trim: true,
      minlength: [2, 'Niche must be at least 2 characters'],
      maxlength: [100, 'Niche must be less than 100 characters']
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      enum: {
        values: ['us', 'pk', 'gb', 'ae', 'sa'],
        message: '{VALUE} is not a supported country'
      },
      lowercase: true,
      trim: true
    },
    value: {
      type: String,
      default: '$99',
      enum: {
        values: ['$99'],
        message: 'Report value is fixed at $99'
      }
    },
    data: {
      type: Schema.Types.Mixed,
      required: [true, 'Report data is required'],
      validate: {
        validator: function(v: any): boolean {
          return v && typeof v === 'object' && Object.keys(v).length > 0;
        },
        message: 'Data must be a non-empty object'
      }
    },
    markdown: {
      type: String,
      required: [true, 'Markdown content is required'],
      validate: {
        validator: function(v: string): boolean {
          return v && v.length >= 50;
        },
        message: 'Markdown must be at least 50 characters'
      }
    },
    charts: {
      type: Schema.Types.Mixed,
      default: {}
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: function(doc, ret) {
        delete ret.__v;
        return ret;
      }
    },
    toObject: { virtuals: true }
  }
);

// Indexes for better query performance
ReportSchema.index({ type: 1, createdAt: -1 });
ReportSchema.index({ country: 1 });
ReportSchema.index({ niche: 1 });
ReportSchema.index({ type: 1, country: 1 });

// Pre-save hook to ensure data integrity
ReportSchema.pre('save', function(next) {
  const doc = this as IReport;
  
  // Validate type
  if (!['product', 'seo'].includes(doc.type)) {
    return next(new Error(`Invalid report type: ${doc.type}. Must be "product" or "seo"`));
  }

  // Validate country
  if (!['us', 'pk', 'gb', 'ae', 'sa'].includes(doc.country)) {
    return next(new Error(`Invalid country: ${doc.country}`));
  }

  // Ensure value is $99
  doc.value = '$99';

  next();
});

// Static method to cleanup invalid reports
ReportSchema.statics.cleanupInvalid = async function(): Promise<{ deletedCount: number }> {
  const result = await this.deleteMany({
    $or: [
      { type: { $nin: ['product', 'seo'] } },
      { niche: { $exists: false } },
      { data: { $exists: false } },
      { country: { $nin: ['us', 'pk', 'gb', 'ae', 'sa'] } },
      { markdown: { $exists: false } },
      { value: { $ne: '$99' } }
    ]
  });
  return { deletedCount: result.deletedCount };
};

export const Report = mongoose.model<IReport, IReportModel>('Report', ReportSchema);
