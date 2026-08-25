import nodemailer from 'nodemailer';

// Check if SMTP credentials are provided in environment variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER, // Your email
    pass: process.env.SMTP_PASS, // Your email password or app password
  },
});

export const sendReportEmail = async (
  to: string,
  subject: string,
  content: string,
  text: string
): Promise<void> => {
  try {
    // If SMTP details are missing, just log to console so it doesn't crash in development
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log(`[Email Service] Email to ${to}: ${subject}`);
      console.log(`Content: ${content.substring(0, 200)}...`);
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
