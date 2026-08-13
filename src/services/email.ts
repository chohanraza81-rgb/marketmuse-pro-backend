import { env } from '../config/env';

export async function sendReportEmail(to: string, subject: string, markdown: string, reportTitle: string) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: 'reports@musepro.com', name: 'MusePRO' },
      to: [{ email: to }],
      subject,
      htmlContent: `<p>Dear Client,</p><p>Please find your report attached.</p><p><strong>${reportTitle}</strong></p>`,
      attachment: [
        {
          name: `${reportTitle.replace(/\s+/g, '_')}.md`,
          content: Buffer.from(markdown).toString('base64'),
          contentType: 'text/markdown',
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(`Brevo error: ${JSON.stringify(err)}`);
  }

  return response.json();
}
