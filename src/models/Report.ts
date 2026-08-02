import mongoose, { Schema, Document } from 'mongoose';

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

const ReportSchema = new Schema<IReport>(
  {
    type: {
      type: String,
      enum: {
        values: ['product', 'seo'],
        message: '{VALUE} is not a valid report type. Must be "product" or "seo"'
      },
      required: [true, 'Report type is required'],
      validate: {
        validator: function(v: string) {
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
        validator: function(v: any) {
          return v && typeof v === 'object' && Object.keys(v).length > 0;
        },
        message: 'Data must be a non-empty object'
      }
    },
    markdown: {
      type: String,
      required: [true, 'Markdown content is required'],
      validate: {
        validator: function(v: string) {
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
  // Validate type
  if (!['product', 'seo'].includes(this.type)) {
    return next(new Error(`Invalid report type: ${this.type}. Must be "product" or "seo"`));
  }

  // Validate country
  if (!['us', 'pk', 'gb', 'ae', 'sa'].includes(this.country)) {
    return next(new Error(`Invalid country: ${this.country}`));
  }

  // Ensure value is $99
  this.value = '$99';

  next();
});

// Static method to cleanup old data
ReportSchema.statics.cleanupInvalid = async function() {
  const result = await this.deleteMany({
    $or: [
      { type: { $nin: ['product', 'seo'] } },
      { niche: { $exists: false } },
      { data: { $exists: false } },
      { country: { $nin: ['us', 'pk', 'gb', 'ae', 'sa'] } }
    ]
  });
  return result;
};

export const Report = mongoose.model<IReport>('Report', ReportSchema);
