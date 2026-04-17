import { Request, Response } from 'express';
import { db } from '../config/db';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { clearFailedLogin, recordFailedLogin } from '../middlewares/rateLimiter';
import { writeAuditLog } from '../utils/auditHelper';
import {
  hashPassword,
  needsPasswordRehashUpgrade,
  normalizeAppRole,
  verifyModernPassword,
} from '../utils/authUtils';
import { sendPasswordResetEmail } from '../utils/mailer';

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
    
    // We only proceed if user exists and is not deleted
    if (user && user.deleted_at === null && (await verifyModernPassword(trimmedPassword, user.password))) {
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
        },
        jwtSecret,
        { expiresIn: '24h' }
      );

      return res.status(200).json({
        status: 'success',
        success: true,
        message: 'Login berhasil',
        data: {
          token,
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
        },
        jwtSecret,
        { expiresIn: '24h' }
      );

      return res.status(200).json({
        status: 'success',
        success: true,
        message: 'Login Berhasil!',
        data: {
          token,
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
    return res.status(500).json({ success: false, error: 'Pendaftaran gagal. ' + err.message });
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

    // Selalu kembalikan respons sukses agar email valid tidak bisa di-enumerate
    const GENERIC_OK = {
      status: 'success',
      message: 'Jika email terdaftar sebagai admin, link reset akan dikirim ke inbox Anda dalam beberapa menit.',
    };

    // Cari admin berdasarkan email — karyawan tidak bisa reset via web
    const user = await db.users.findFirst({
      where: {
        email: cleanEmail,
        deleted_at: null,
        is_active: true,
        role: { in: ['owner', 'admin', 'super_admin'] },
      },
    });

    if (!user) {
      await new Promise(r => setTimeout(r, 400 + Math.random() * 300));
      return res.json(GENERIC_OK);
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

    // Kirim email — jika gagal (mis. env belum dikonfigurasi), log saja tanpa expose error ke user
    try {
      await sendPasswordResetEmail(cleanEmail, resetUrl, user.nama || user.username);
    } catch (mailErr: any) {
      console.error('[ForgotPassword] Gagal kirim email:', mailErr.message);
      // Tetap kembalikan GENERIC_OK agar email valid tidak bisa di-enumerate
      // Tapi log di server agar admin tahu email tidak terkirim
    }

    return res.json(GENERIC_OK);
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
      },
    });

    return res.json({ status: 'success', message: 'Password berhasil diperbarui. Silakan login dengan password baru.' });
  } catch (err: any) {
    console.error('[ResetPassword Error]', err);
    return res.status(500).json({ status: 'error', message: 'Terjadi kesalahan pada server.' });
  }
};
