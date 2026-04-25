import { Request, Response } from 'express';
import { db } from '../config/db';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { clearFailedLogin, recordFailedLogin } from '../middlewares/rateLimiter';
import { writeAuditLog } from '../utils/auditHelper';
import {
  hashPassword,
  needsPasswordRehashUpgrade,
  normalizeAppRole,
  verifyModernPassword,
} from '../utils/authUtils';
import { sendPasswordResetEmail } from '../utils/mailer';

// Inisialisasi Google OAuth2 Client — digunakan untuk verifikasi ID Token
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 hari

/**
 * Helper: set httpOnly cookie berisi JWT.
 * Web browser membaca token ini otomatis tanpa JS — aman dari XSS.
 * Mobile App tidak terpengaruh karena menggunakan Bearer token di header.
 */
function setAuthCookie(res: Response, token: string): void {
  res.cookie('lark_token', token, {
    httpOnly: true,                                      // Tidak accessible via JS
    secure: IS_PROD,                                     // HTTPS only di produksi
    sameSite: IS_PROD ? 'none' : 'lax',                 // Cross-origin untuk prod (Vercel ↔ VPS)
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

/**
 * Helper: deteksi apakah request dari Mobile App.
 * Mobile App mengirim header `X-App-Platform: LarkMobile`.
 * Web browser TIDAK mengirim header ini.
 *
 * SECURITY (H-3): Token hanya dikirim di response body untuk Mobile App.
 * Web browser mendapatkan token via httpOnly cookie saja — tidak pernah
 * menyentuh JavaScript, sehingga aman dari XSS/extension/DevTools capture.
 */
function isMobileApp(req: Request): boolean {
  return req.headers['x-app-platform'] === 'LarkMobile';
}

/**
 * Logout: hapus httpOnly cookie + invalidasi semua JWT aktif.
 * 
 * SECURITY (H2 Token Revocation):
 * - Increment token_version di DB sehingga semua JWT lama ditolak
 * - Ini berlaku untuk SEMUA perangkat (web + mobile) sekaligus
 * - Mobile App perlu login ulang setelah owner logout dari web
 */
export const logoutAdmin = async (req: Request, res: Response) => {
  // Increment token_version agar semua JWT lama invalid
  try {
    // Coba decode JWT dari cookie/header untuk mendapatkan user_id
    const cookieToken: string | undefined = (req as any).cookies?.lark_token;
    const authHeader = req.headers['authorization'];
    const bearerToken = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : undefined;
    const token = cookieToken || bearerToken;

    if (token) {
      const jwtSecret = process.env.JWT_SECRET || '';
      try {
        const decoded: any = jwt.verify(token, jwtSecret);
        if (decoded.user_id) {
          await db.users.update({
            where: { id: decoded.user_id },
            data: { token_version: { increment: 1 } },
          });
        }
      } catch {
        // Token mungkin sudah expired — tidak masalah, tetap clear cookie
      }
    }
  } catch (e) {
    // DB error — tetap lanjutkan clear cookie
    console.error('[Logout] token_version increment failed:', e);
  }

  res.clearCookie('lark_token', {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',
    path: '/',
  });
  // Juga hapus CSRF cookie
  res.clearCookie('lark_csrf', {
    httpOnly: false,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',
    path: '/',
  });
  return res.status(200).json({ success: true, message: 'Logout berhasil.' });
};


export const loginAdmin = async (req: Request, res: Response) => {
  const ipAddress = req.ip || req.socket?.remoteAddress || '0.0.0.0';
  const userAgent = req.headers['user-agent'] || 'unknown';

  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ status: 'error', success: false, error: 'Username dan password wajib diisi.', message: 'Username dan password wajib diisi.' });
    }

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    // Query User using Prisma
    const user = await db.users.findUnique({
      where: { username: trimmedUsername },
    });

    // Artificial delay to mitigate timing attacks for non-existent users
    if (!user || user.deleted_at !== null) {
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 200) + 100));
    }
    
    // We only proceed if user exists, is not deleted, HAS a password, and password matches
    if (user && user.deleted_at === null && user.password && (await verifyModernPassword(trimmedPassword, user.password))) {
      const role = normalizeAppRole(user.role);

      if (role === 'karyawan') {
        recordFailedLogin(ipAddress);
        return res.status(403).json({
          status: 'error',
          success: false,
          error: 'Akun karyawan tidak dapat login melalui web. Gunakan aplikasi mobile Lark.',
          message: 'Akun karyawan tidak dapat login melalui web. Gunakan aplikasi mobile Lark.',
        });
      }

      if (!user.is_active) {
        recordFailedLogin(ipAddress);
        return res.status(403).json({
          status: 'error',
          success: false,
          error: 'Akun Anda telah dinonaktifkan. Hubungi administrator.',
          message: 'Akun Anda telah dinonaktifkan. Hubungi administrator.',
        });
      }

      // Rehash if necessary
      if (needsPasswordRehashUpgrade(user.password)) {
        const newHash = await hashPassword(trimmedPassword);
        await db.users.update({
          where: { id: user.id },
          data: { password: newHash }
        });
      }

      // Success
      clearFailedLogin(ipAddress);

      await writeAuditLog(db, {
        tenant_id: user.tenant_id,
        outlet_id: user.outlet_id,
        actor_user_id: user.id,
        entity_type: 'user',
        entity_id: user.id,
        action: 'login_success_web_node',
        metadata: { ip: ipAddress, user_agent: userAgent },
      });

      // Issue JWT
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) throw new Error('JWT_SECRET environment variable is not configured!');
      const token = jwt.sign(
        {
          user_id: user.id,
          username: user.username,
          role: role,
          tenant_id: user.tenant_id,
          outlet_id: user.outlet_id,
          token_version: user.token_version ?? 0,
        },
        jwtSecret,
        { expiresIn: '24h' }
      );

      // Set httpOnly cookie untuk Web browser (lebih aman dari localStorage)
      // Mobile App tetap membaca token dari response body
      setAuthCookie(res, token);

      return res.status(200).json({
        status: 'success',
        success: true,
        message: 'Login berhasil',
        data: {
          // H-3: Token hanya dikirim ke Mobile App. Web mendapat token via httpOnly cookie.
          ...(isMobileApp(req) ? { token } : {}),
          user: {
            id: user.id,
            username: user.username,
            nama: user.nama || user.username,
            role: role,
            tenant_id: user.tenant_id,
            outlet_id: user.outlet_id,
            permissions: typeof user.permissions === 'string' ? JSON.parse(user.permissions) : (user.permissions || {})
          },
        },
      });
    } else {
      recordFailedLogin(ipAddress);

      await writeAuditLog(db, {
        entity_type: 'auth',
        action: 'login_failed_web_node',
        metadata: {
          attempted_username: trimmedUsername,
          ip: ipAddress,
          user_agent: userAgent,
          reason: 'invalid_credentials',
        },
      });

      return res.status(401).json({
        status: 'error',
        success: false,
        error: 'Username atau password salah. Periksa kembali dan coba lagi.',
        message: 'Username atau password salah. Periksa kembali dan coba lagi.'
      });
    }
  } catch (err: any) {
    console.error('[AuthController]', err);
    return res.status(500).json({ status: 'error', success: false, error: 'Terjadi kesalahan pada server.', message: 'Terjadi kesalahan pada server.' });
  }
};

export const loginStaff = async (req: Request, res: Response) => {
  const ipAddress = req.ip || req.socket?.remoteAddress || '0.0.0.0';
  const userAgent = req.headers['user-agent'] || 'unknown';

  try {
    const { staff_code } = req.body;

    if (!staff_code) {
      return res.status(400).json({ status: 'error', success: false, error: 'ID Akses Kasir wajib diisi.', message: 'Tolong masukkan ID Akses Kasir.' });
    }

    const trimmedStaffCode = staff_code.trim();

    const user = await db.users.findFirst({
      where: { 
        username: trimmedStaffCode,
        role: 'karyawan',
        deleted_at: null
      },
      include: { outlets: true }
    });

    if (user) {
      if (!user.is_active) {
        recordFailedLogin(ipAddress);
        return res.status(403).json({ status: 'error', success: false, error: 'Akun kasir Anda telah dinonaktifkan.', message: 'Akun kasir Anda telah dinonaktifkan.' });
      }

      clearFailedLogin(ipAddress);

      await writeAuditLog(db, {
        tenant_id: user.tenant_id,
        outlet_id: user.outlet_id,
        actor_user_id: user.id,
        entity_type: 'user',
        entity_id: user.id,
        action: 'login_staff_success_mobile_node',
        metadata: { ip: ipAddress, user_agent: userAgent },
      });

      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) throw new Error('JWT_SECRET environment variable is not configured!');
      const token = jwt.sign(
        {
          user_id: user.id,
          username: user.username,
          role: normalizeAppRole(user.role),
          tenant_id: user.tenant_id,
          outlet_id: user.outlet_id,
          token_version: user.token_version ?? 0,
        },
        jwtSecret,
        { expiresIn: '24h' }
      );
      // Set httpOnly cookie untuk Web browser
      setAuthCookie(res, token);

      return res.status(200).json({
        status: 'success',
        success: true,
        message: 'Login Berhasil!',
        data: {
          // H-3: Token hanya dikirim ke Mobile App.
          ...(isMobileApp(req) ? { token } : {}),
          user: {
            id: user.id,
            username: user.username,
            nama: user.nama || user.username,
            role: normalizeAppRole(user.role),
            tenant_id: user.tenant_id,
            outlet_id: user.outlet_id,
            outlet_nama: user.outlets?.nama || 'Pusat',
            permissions: typeof user.permissions === 'string' ? JSON.parse(user.permissions) : (user.permissions || {})
          },
        },
      });
    } else {
      recordFailedLogin(ipAddress);
      
      await writeAuditLog(db, {
        entity_type: 'auth',
        action: 'login_staff_failed_mobile_node',
        metadata: {
          attempted_staff_code: trimmedStaffCode,
          ip: ipAddress,
          user_agent: userAgent,
          reason: 'invalid_credentials',
        },
      });

      return res.status(401).json({
        status: 'error',
        success: false,
        error: 'ID Akses Kasir tidak ditemukan.',
        message: 'ID Akses Kasir tidak ditemukan.'
      });
    }
  } catch (err: any) {
    console.error('[AuthController loginStaff]', err);
    return res.status(500).json({ status: 'error', success: false, error: 'Terjadi kesalahan pada server.', message: 'Terjadi kesalahan pada server.' });
  }
};

export const registerAdmin = async (req: Request, res: Response) => {
  try {
    const { username, password, confirm_password, nama, no_hp, email, alamat } = req.body;
    
    if (!username || !password || !nama) {
      return res.status(400).json({ success: false, error: 'Username, password, dan nama harus diisi!' });
    }
    if (password !== confirm_password) {
      return res.status(400).json({ success: false, error: 'Password dan konfirmasi password tidak cocok!' });
    }
    // L-3: Standardized password policy — minimal 8 karakter di semua endpoint
    if ((password as string).trim().length < 8) {
      return res.status(400).json({ success: false, error: 'Password minimal 8 karakter.' });
    }
    
    const existingUser = await db.users.findUnique({
      where: { username: username.trim() }
    });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'Username sudah digunakan, coba username lain!' });
    }

    const hashedPw = await hashPassword(password.trim());
    const slug = (nama.trim() + ' Laundry').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    const role = 'owner'; // equivalent to tenant admin

    // Using Prisma transaction for multi-table inserts
    await db.$transaction(async (tx) => {
      // 1. Create Tenant
      const tenant = await tx.tenants.create({
        data: {
          name: nama.trim() + ' Laundry',
          slug: slug,
          address: alamat?.trim() || 'Belum diatur',
          phone: no_hp?.trim() || 'Belum diatur',
          subscription_plan: 'free',
          subscription_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days trial
        }
      });

      // 2. Insert Admin User
      await tx.users.create({
        data: {
          tenant_id: tenant.id,
          outlet_id: null,
          username: username.trim(),
          password: hashedPw,
          role: role,
          nama: nama.trim(),
          email: email?.trim() || null,
          no_hp: no_hp?.trim() || null,
          alamat: alamat?.trim() || null,
          is_active: true
        }
      });

      // 3. Seed Default Services
      await tx.services.createMany({
        data: [
          { tenant_id: tenant.id, nama_layanan: 'Cuci Biasa', harga_per_kg: 5000, deskripsi: 'Layanan cuci regular (2-3 hari)', durasi_hari: 3 },
          { tenant_id: tenant.id, nama_layanan: 'Cuci Setrika', harga_per_kg: 8000, deskripsi: 'Layanan cuci + setrika (2-3 hari)', durasi_hari: 3 },
          { tenant_id: tenant.id, nama_layanan: 'Setrika Saja', harga_per_kg: 3000, deskripsi: 'Layanan setrika saja (1 hari)', durasi_hari: 1 },
        ]
      });

      // 4. Seed Settings
      await tx.tenant_settings.create({
        data: {
          tenant_id: tenant.id,
          setting_key: 'toko_info',
          setting_value: {
            nama: nama.trim() + ' Laundry',
            alamat: alamat?.trim() || 'Belum diatur',
            telepon: no_hp?.trim() || 'Belum diatur',
            email: email?.trim() || 'Belum diatur'
          }
        }
      });
    });

    return res.status(201).json({ success: true, message: 'Pendaftaran admin laundry berhasil! Silakan login.' });
  } catch (err: any) {
    console.error('[RegisterAdmin]', err);
    // M-5: Jangan expose err.message ke client — bisa berisi detail internal DB
    return res.status(500).json({ success: false, error: 'Pendaftaran gagal. Silakan coba lagi atau hubungi admin.' });
  }
};


// ---------------------------------------------------------------------------
// POST /api/v1/auth/forgot-password
// Hanya untuk admin (owner / super_admin). Karyawan tidak bisa reset via web.
// ---------------------------------------------------------------------------
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ status: 'error', message: 'Email wajib diisi.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Validasi format email dasar
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ status: 'error', message: 'Format email tidak valid.' });
    }

    // Cari admin berdasarkan email — karyawan tidak bisa reset via web
    const user = await db.users.findFirst({
      where: {
        email: cleanEmail,
        deleted_at: null,
        is_active: true,
        role: { in: ['owner', 'admin', 'super_admin'] },
      },
    });

    // Jika email tidak terdaftar sebagai admin, kembalikan error eksplisit
    if (!user) {
      // Artificial delay agar response time tidak berbeda signifikan (mitigasi timing attack)
      await new Promise(r => setTimeout(r, 400 + Math.random() * 300));
      return res.status(404).json({
        status: 'error',
        message: 'Email tidak terdaftar dalam sistem. Pastikan email yang Anda masukkan benar.',
      });
    }

    // Buat token acak 32 byte; simpan SHA-256 hash-nya di DB
    const rawToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 jam

    await db.users.update({
      where: { id: user.id },
      data: {
        reset_token:         tokenHash,
        reset_token_expires: expiresAt,
      },
    });

    // URL reset mengarah ke halaman React
    const appUrl   = process.env.APP_URL || 'http://localhost:5173';
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(cleanEmail)}`;

    // Kirim email — jika gagal, return error agar user tahu pengiriman tidak berhasil
    try {
      await sendPasswordResetEmail(cleanEmail, resetUrl, user.nama || user.username);
    } catch (mailErr: any) {
      console.error('[ForgotPassword] Gagal kirim email:', mailErr.message);
      // Bersihkan token yang sudah disimpan agar tidak tergantung
      await db.users.update({
        where: { id: user.id },
        data: { reset_token: null, reset_token_expires: null },
      });
      return res.status(500).json({
        status: 'error',
        message: 'Gagal mengirim email. Silakan coba beberapa saat lagi.',
      });
    }

    return res.json({
      status: 'success',
      message: 'Link reset password sudah dikirim ke inbox Anda. Periksa juga folder spam.',
    });
  } catch (err: any) {
    console.error('[ForgotPassword Error]', err);
    return res.status(500).json({ status: 'error', message: 'Terjadi kesalahan pada server.' });
  }
};


// ---------------------------------------------------------------------------
// POST /api/v1/auth/reset-password
// Verifikasi token dari email lalu simpan password baru.
// ---------------------------------------------------------------------------
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, email, password, confirm_password } = req.body;

    if (!token || !email || !password) {
      return res.status(400).json({ status: 'error', message: 'Token, email, dan password baru wajib diisi.' });
    }
    if (password !== confirm_password) {
      return res.status(400).json({ status: 'error', message: 'Password dan konfirmasi password tidak cocok.' });
    }
    if ((password as string).length < 8) {
      return res.status(400).json({ status: 'error', message: 'Password minimal 8 karakter.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const tokenHash  = crypto.createHash('sha256').update((token as string).trim()).digest('hex');

    const user = await db.users.findFirst({
      where: {
        email: cleanEmail,
        reset_token: tokenHash,
        reset_token_expires: { gt: new Date() },
        deleted_at: null,
        role: { in: ['owner', 'admin', 'super_admin'] },
      },
    });

    if (!user) {
      return res.status(400).json({
        status: 'error',
        message: 'Link reset tidak valid atau sudah kadaluarsa. Silakan minta ulang.',
      });
    }

    const newHash = await hashPassword((password as string).trim());

    await db.users.update({
      where: { id: user.id },
      data: {
        password:            newHash,
        reset_token:         null,
        reset_token_expires: null,
        token_version:       { increment: 1 }, // H2: Invalidasi semua JWT aktif
      },
    });

    return res.json({ status: 'success', message: 'Password berhasil diperbarui. Silakan login dengan password baru.' });
  } catch (err: any) {
    console.error('[ResetPassword Error]', err);
    return res.status(500).json({ status: 'error', message: 'Terjadi kesalahan pada server.' });
  }
};


// ---------------------------------------------------------------------------
// POST /api/v1/auth/google
// Login atau Auto-Register menggunakan Google ID Token (One Tap / Sign-In).
// Tidak memerlukan Client Secret — hanya verifikasi ID Token dengan Client ID.
// ---------------------------------------------------------------------------
export const googleLogin = async (req: Request, res: Response) => {
  const ipAddress = req.ip || req.socket?.remoteAddress || '0.0.0.0';
  const userAgent = req.headers['user-agent'] || 'unknown';

  try {
    const { credential, access_token } = req.body;

    if (!credential && !access_token) {
      return res.status(400).json({
        status: 'error',
        success: false,
        error: 'Google credential token wajib disertakan.',
      });
    }

    if (!GOOGLE_CLIENT_ID) {
      console.error('[GoogleLogin] GOOGLE_CLIENT_ID belum dikonfigurasi di .env');
      return res.status(500).json({
        status: 'error',
        success: false,
        error: 'Konfigurasi Google OAuth belum lengkap di server.',
      });
    }

    // 1. Resolve payload dari credential (ID token) ATAU access_token
    let payload: { sub: string; email: string; name?: string; picture?: string } | null = null;

    if (credential) {
      // --- Path A: ID Token via verifyIdToken (GoogleLogin component) ---
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: GOOGLE_CLIENT_ID,
        });
        const raw = ticket.getPayload();
        if (raw && raw.sub && raw.email) {
          payload = { sub: raw.sub, email: raw.email, name: raw.name, picture: raw.picture };
        }
      } catch (verifyErr: any) {
        console.error('[GoogleLogin] ID token verification failed:', verifyErr.message);
        return res.status(401).json({
          status: 'error',
          success: false,
          error: 'Token Google tidak valid atau sudah kadaluarsa. Silakan coba lagi.',
        });
      }
    } else {
      // --- Path B: Access Token via Google userinfo endpoint (useGoogleLogin hook) ---
      try {
        const userInfoRes = await fetch(
          `https://www.googleapis.com/oauth2/v3/userinfo`,
          { headers: { Authorization: `Bearer ${access_token}` } }
        );
        if (!userInfoRes.ok) {
          throw new Error(`Google userinfo responded ${userInfoRes.status}`);
        }
        const info = await userInfoRes.json() as { sub: string; email: string; name?: string; picture?: string };
        if (info.sub && info.email) {
          payload = { sub: info.sub, email: info.email, name: info.name, picture: info.picture };
        }
      } catch (err: any) {
        console.error('[GoogleLogin] Access token userinfo failed:', err.message);
        return res.status(401).json({
          status: 'error',
          success: false,
          error: 'Akses Google tidak valid atau sudah kadaluarsa. Silakan coba lagi.',
        });
      }
    }

    if (!payload || !payload.sub || !payload.email) {
      return res.status(401).json({
        status: 'error',
        success: false,
        error: 'Data profil Google tidak lengkap.',
      });
    }

    const googleId = payload.sub;
    const googleEmail = payload.email.toLowerCase();
    const googleName = payload.name || googleEmail.split('@')[0];

    // 2. Cari user berdasarkan google_id terlebih dahulu (paling cepat & akurat)
    let user = await db.users.findFirst({
      where: { google_id: googleId, deleted_at: null },
    });

    // 3. Jika tidak ditemukan via google_id, coba cari berdasarkan email
    //    (untuk kasus user yang sudah register manual lalu ingin link ke Google)
    if (!user) {
      user = await db.users.findFirst({
        where: { email: googleEmail, deleted_at: null },
      });

      // Jika ditemukan via email, link google_id ke akun yang sudah ada
      if (user) {
        await db.users.update({
          where: { id: user.id },
          data: {
            google_id: googleId,
            auth_provider: user.auth_provider === 'local' ? 'local+google' : user.auth_provider,
          },
        });
      }
    }

    // 4. Jika user benar-benar baru → Auto-Register sebagai owner dengan tenant baru
    if (!user) {
      // Generate username unik dari email (menghilangkan karakter non-alfanumerik)
      let baseUsername = googleEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').substring(0, 30);
      let finalUsername = baseUsername;
      let counter = 1;

      // Pastikan username unik
      while (await db.users.findUnique({ where: { username: finalUsername } })) {
        finalUsername = `${baseUsername}${counter}`;
        counter++;
      }

      const slug = (googleName + ' Laundry').toLowerCase().replace(/[^a-z0-9-]+/g, '-');

      // Buat tenant + user dalam satu transaksi atomik
      const result = await db.$transaction(async (tx) => {
        const tenant = await tx.tenants.create({
          data: {
            name: googleName + ' Laundry',
            slug,
            address: 'Belum diatur',
            phone: 'Belum diatur',
            subscription_plan: 'free',
            subscription_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });

        const newUser = await tx.users.create({
          data: {
            tenant_id: tenant.id,
            outlet_id: null,
            username: finalUsername,
            password: null, // Google-only account — tidak ada password
            role: 'owner',
            nama: googleName,
            email: googleEmail,
            is_active: true,
            google_id: googleId,
            auth_provider: 'google',
          },
        });

        // Seed default services
        await tx.services.createMany({
          data: [
            { tenant_id: tenant.id, nama_layanan: 'Cuci Biasa', harga_per_kg: 5000, deskripsi: 'Layanan cuci regular (2-3 hari)', durasi_hari: 3 },
            { tenant_id: tenant.id, nama_layanan: 'Cuci Setrika', harga_per_kg: 8000, deskripsi: 'Layanan cuci + setrika (2-3 hari)', durasi_hari: 3 },
            { tenant_id: tenant.id, nama_layanan: 'Setrika Saja', harga_per_kg: 3000, deskripsi: 'Layanan setrika saja (1 hari)', durasi_hari: 1 },
          ],
        });

        // Seed settings
        await tx.tenant_settings.create({
          data: {
            tenant_id: tenant.id,
            setting_key: 'toko_info',
            setting_value: {
              nama: googleName + ' Laundry',
              alamat: 'Belum diatur',
              telepon: 'Belum diatur',
              email: googleEmail,
            },
          },
        });

        return newUser;
      });

      user = result;
    }

    // 5. Validasi akun — konsisten dengan loginAdmin
    const role = normalizeAppRole(user.role);

    if (role === 'karyawan') {
      return res.status(403).json({
        status: 'error',
        success: false,
        error: 'Akun karyawan tidak dapat login melalui web. Gunakan aplikasi mobile Lark.',
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        status: 'error',
        success: false,
        error: 'Akun Anda telah dinonaktifkan. Hubungi administrator.',
      });
    }

    // 6. Audit log
    await writeAuditLog(db, {
      tenant_id: user.tenant_id,
      outlet_id: user.outlet_id,
      actor_user_id: user.id,
      entity_type: 'user',
      entity_id: user.id,
      action: 'login_google_success_web',
      metadata: { ip: ipAddress, user_agent: userAgent, google_email: googleEmail },
    });

    // 7. Issue JWT — format respons identik dengan loginAdmin agar frontend tidak perlu diubah
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) throw new Error('JWT_SECRET environment variable is not configured!');

    const token = jwt.sign(
      {
        user_id: user.id,
        username: user.username,
        role,
        tenant_id: user.tenant_id,
        outlet_id: user.outlet_id,
        token_version: user.token_version ?? 0,
      },
      jwtSecret,
      { expiresIn: '24h' }
    );
    // Set httpOnly cookie untuk Web browser
    setAuthCookie(res, token);

    return res.status(200).json({
      status: 'success',
      success: true,
      message: 'Login dengan Google berhasil!',
      data: {
        // H-3: Token hanya dikirim ke Mobile App.
        ...(isMobileApp(req) ? { token } : {}),
        user: {
          id: user.id,
          username: user.username,
          nama: user.nama || user.username,
          role,
          tenant_id: user.tenant_id,
          outlet_id: user.outlet_id,
          permissions: typeof user.permissions === 'string' ? JSON.parse(user.permissions) : (user.permissions || {}),
        },
      },
    });
  } catch (err: any) {
    console.error('[GoogleLogin Error]', err);
    return res.status(500).json({
      status: 'error',
      success: false,
      error: 'Terjadi kesalahan pada server saat login dengan Google.',
    });
  }
};
