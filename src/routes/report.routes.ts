// src/routes/report.routes.ts
import express from 'express';
import { Report } from '../models/Report';
import { SharedReport } from '../models/SharedReport';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { sendReportEmail } from '../services/email';
const router = express.Router();

// GET report by ID
router.get('/:id', async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Server error';
    res.status(500).json({ error: errorMessage });
  }
});

// POST generate shareable link
router.post('/:id/share', async (req, res) => {
  try {
    const { expiresInHours = 24, password = null } = req.body;
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    
    const shared = await SharedReport.create({
      reportId: req.params.id,
      token,
      expiresAt,
      password: password ? bcrypt.hashSync(password, 10) : null,
    });

    res.json({ link: `/share/${token}`, expiresAt });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to create share link';
    res.status(500).json({ error: errorMessage });
  }
});

// GET shared report via token
router.get('/share/:token', async (req, res) => {
  try {
    const shared = await SharedReport.findOne({ token: req.params.token });
    if (!shared) return res.status(404).json({ error: 'Invalid link' });
    if (shared.expiresAt < new Date()) return res.status(410).json({ error: 'Link expired' });
    
    if (shared.password) {
      const { password } = req.query;
      if (!password || !bcrypt.compareSync(password as string, shared.password)) {
        return res.status(401).json({ error: 'Password required' });
      }
    }

    const report = await Report.findById(shared.reportId);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Server error';
    res.status(500).json({ error: errorMessage });
  }
});

// POST send report email
router.post('/:id/email', async (req, res) => {
  try {
    const { to, subject, body, attachments } = req.body;
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const emailAttachments = attachments?.length ? attachments : [{
      name: 'report.md',
      content: Buffer.from(report.markdown || '').toString('base64'),
      contentType: 'text/markdown',
    }];

    const result = await sendReportEmail({
      to: Array.isArray(to) ? to : [to],
      subject,
      body,
      attachments: emailAttachments,
    });

    res.json({ success: true, result });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Email failed';
    res.status(500).json({ error: 'Email failed', details: errorMessage });
  }
});

export default router;
