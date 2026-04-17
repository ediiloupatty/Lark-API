import nodemailer from 'nodemailer';

/**
 * Singleton transporter Nodemailer.
 * Konfigurasi via environment variables:
 *   MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM
 *
 * Default: Gmail SMTP. Untuk testing tanpa domain asli gunakan
 * Ethereal (https://ethereal.email) atau isi dengan akun Gmail
 * yang sudah mengaktifkan "App Password".
 */
const transporter = nodemailer.createTransport({
  host:   process.env.MAIL_HOST   || 'smtp.gmail.com',
  port:   parseInt(process.env.MAIL_PORT || '587'),
  secure: process.env.MAIL_SECURE === 'true', // true untuk port 465, false untuk 587
  auth: {
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
  },
});

/**
 * Kirim email reset password ke admin.
 * @param toEmail   - Alamat email tujuan
 * @param resetUrl  - URL reset password yang mengandung token
 * @param adminName - Nama admin untuk personalisasi email
 */
export const sendPasswordResetEmail = async (
  toEmail: string,
  resetUrl: string,
  adminName: string,
): Promise<void> => {
  const fromAddress = process.env.MAIL_FROM || process.env.MAIL_USER || 'no-reply@larklarundry.com';

  await transporter.sendMail({
    from:    `"LarkLaundry" <${fromAddress}>`,
    to:      toEmail,
    subject: 'Reset Password Akun Admin LarkLaundry',
    html: `
      <!DOCTYPE html>
      <html lang="id">
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reset Password</title></head>
      <body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
          <tr><td align="center">
            <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,.08);">
              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:28px 36px;text-align:center;">
                  <p style="margin:0;font-size:20px;font-weight:900;color:#fff;letter-spacing:-.02em;">🧺 LarkLaundry</p>
                  <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,.5);letter-spacing:.06em;text-transform:uppercase;">Admin Portal</p>
                </td>
              </tr>
              <!-- Body -->
              <tr>
                <td style="padding:36px 36px 28px;">
                  <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;">Reset Password</p>
                  <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
                    Halo <strong>${adminName}</strong>,<br>
                    Kami menerima permintaan reset password untuk akun admin Anda.
                    Klik tombol di bawah untuk membuat password baru.
                  </p>

                  <div style="text-align:center;margin:28px 0;">
                    <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;background:#0284c7;color:#fff;border-radius:10px;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:-.01em;">
                      Reset Password Saya
                    </a>
                  </div>

                  <p style="margin:20px 0 0;font-size:13px;color:#94a3b8;line-height:1.6;">
                    Link ini hanya berlaku selama <strong>1 jam</strong>.
                    Jika Anda tidak meminta reset password, abaikan email ini — akun Anda tetap aman.
                  </p>
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td style="padding:16px 36px;border-top:1px solid #e2e8f0;text-align:center;">
                  <p style="margin:0;font-size:11.5px;color:#cbd5e1;">
                    Email ini dikirim otomatis oleh sistem LarkLaundry. Harap tidak membalas email ini.
                  </p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `,
  });
};
