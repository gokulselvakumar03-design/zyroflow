const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config();

/**
 * Creates and returns a Nodemailer transporter using environment variables.
 */
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) {
    console.warn('[EMAIL] SMTP configuration is incomplete in .env (SMTP_HOST, SMTP_USER, SMTP_PASSWORD).');
  }

  return nodemailer.createTransport({
    host: host || 'smtp.gmail.com',
    port: port,
    secure: port === 465,
    auth: {
      user: user || '',
      pass: pass || ''
    }
  });
}

/**
 * Sends password reset email to the user's recovery email address.
 * 
 * @param {string} recoveryEmail - The recipient recovery email address.
 * @param {string} resetToken - The cryptographically secure raw reset token.
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function sendPasswordResetEmail(recoveryEmail, resetToken) {
  try {
    const transporter = createTransporter();
    const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
    const cleanBaseUrl = appBaseUrl.replace(/\/+$/, '');
    const resetUrl = `${cleanBaseUrl}/reset-password.html?token=${encodeURIComponent(resetToken)}`;

    const mailFrom = process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@zyroflow.com';

    const textContent = `Hello,

We received a request to reset your ZyroFlow password.

Click the link below to create a new password:

${resetUrl}

This link will expire after 30 minutes and can only be used once.

If you did not request this password reset, you can safely ignore this email.

Regards,
ZyroFlow`;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }
    .card { max-width: 520px; margin: 20px auto; background: #ffffff; border-radius: 14px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .brand { font-size: 22px; font-weight: 800; color: #0284c7; margin-bottom: 20px; }
    .title { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
    .text { font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
    .btn-container { text-align: center; margin: 28px 0; }
    .btn { display: inline-block; background-color: #0284c7; color: #ffffff !important; text-decoration: none; padding: 12px 28px; font-size: 15px; font-weight: 600; border-radius: 8px; box-shadow: 0 2px 8px rgba(2,132,199,0.25); }
    .footer { font-size: 13px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 16px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">ZyroFlow</div>
    <div class="title">ZyroFlow Password Reset</div>
    <p class="text">Hello,</p>
    <p class="text">We received a request to reset your ZyroFlow password. Click the button below to create a new password:</p>
    <div class="btn-container">
      <a href="${resetUrl}" class="btn" target="_blank">RESET PASSWORD</a>
    </div>
    <p class="text" style="font-size: 13px; color: #64748b;">This link will expire after 30 minutes and can only be used once.</p>
    <p class="text" style="font-size: 13px; color: #64748b;">If you did not request this password reset, you can safely ignore this email.</p>
    <div class="footer">
      Regards,<br>
      <strong>ZyroFlow Team</strong>
    </div>
  </div>
</body>
</html>`;

    console.log(`[EMAIL] Attempting to send password reset email to: ${recoveryEmail}`);

    const info = await transporter.sendMail({
      from: mailFrom,
      to: recoveryEmail,
      subject: 'ZyroFlow Password Reset',
      text: textContent,
      html: htmlContent
    });

    console.log(`[EMAIL] Password reset email sent successfully. Message ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('[EMAIL] Failed to send password reset email:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendPasswordResetEmail
};
