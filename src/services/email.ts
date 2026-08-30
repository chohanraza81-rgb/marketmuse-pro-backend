// services/email.service.ts
import { env } from '../config/env';

export interface EmailAttachment {
  name: string;
  content: string; // base64
  contentType: string;
}

export interface SendEmailOptions {
  to: string[];
  subject: string;
  body?: string;
  attachments?: EmailAttachment[];
}

export async function sendReportEmail(options: SendEmailOptions) {
  const { to, subject, body, attachments = [] } = options;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: 'reports@musepro.com', name: 'MusePRO' },
      to: to.map(email => ({ email })),
      subject,
      htmlContent: body || '<p>Dear Client, please find your report attached.</p>',
      attachment: attachments,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Brevo error: ${JSON.stringify(err)}`);
  }

  return response.json();
}
