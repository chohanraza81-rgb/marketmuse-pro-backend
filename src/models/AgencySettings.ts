import mongoose from 'mongoose';

const AgencySettingsSchema = new mongoose.Schema({
  agencyName: { type: String, default: 'Your Agency Name' },
  logoUrl: { type: String, default: '' },
  primaryColor: { type: String, default: '#6366F1' }, // Indigo
  secondaryColor: { type: String, default: '#10B981' }, // Emerald
  fontFamily: { type: String, default: 'Inter' }, // Inter, Serif, etc.
  pdfTheme: { type: String, default: 'dark' }, // dark, light
  footerText: { type: String, default: '© 2026 Your Agency. Confidential.' },
  supportEmail: { type: String, default: 'support@youragency.com' }
}, { timestamps: true });

export const AgencySettings = mongoose.model('AgencySettings', AgencySettingsSchema);
