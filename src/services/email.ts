import nodemailer from 'nodemailer';

// Brevo SMTP Configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER, // Your Brevo login email
    pass: process.env.SMTP_PASS, // Your Brevo SMTP Key
  },
});

export const sendReportEmail = async (
  to: string,
  subject: string,
  content: string,
  text: string
): Promise<void> => {
  try {
    // Agar SMTP details set nahi hain, toh server crash nahi karega, sirf log karega
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log(`[Email Service] Email to ${to}: ${subject}`);
      return;
    }
    await transporter.sendMail({
      from: `"MusePRO" <${process.env.SMTP_USER}>`,
      to: to,
      subject: subject,
      text: text,
      html: content,
    });
    console.log(`Email sent successfully to ${to}`);
  } catch (error) {
    console.error('Error sending email:', error);
  }
};
