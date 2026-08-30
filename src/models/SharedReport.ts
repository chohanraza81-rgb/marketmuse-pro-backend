// backend/src/models/SharedReport.ts
import mongoose from 'mongoose';

const SharedReportSchema = new mongoose.Schema({
  reportId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Report', 
    required: true 
  },
  token: { 
    type: String, 
    required: true, 
    unique: true 
  },
  expiresAt: { 
    type: Date, 
    required: true 
  },
  password: { 
    type: String, 
    default: null 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
});

export const SharedReport = mongoose.models.SharedReport || mongoose.model('SharedReport', SharedReportSchema);
