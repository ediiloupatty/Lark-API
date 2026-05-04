import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/db';

export interface AuthRequest extends Request {
  user?: {
    user_id: number;
    username: string;
    role: string;
    tenant_id: number | null;
    outlet_id: number | null;
    nama?: string;
    token_version?: number;
  };
}

const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 hari
const JWT_EXPIRY = '7d';
// Sliding session: renew token jika sudah lewat 50% dari lifetime (3.5 hari)
const RENEWAL_THRESHOLD_SECONDS = 3.5 * 24 * 60 * 60; // 3.5 hari

/**
 * Middleware autentikasi yang mendukung dual-mode:
 *   1. httpOnly Cookie  → Web browser (lebih aman, tidak accessible JS)
 *   2. Bearer Token     → Mobile App / legacy sessions (backward compatible)
 *
 * Priority: cookie > Authorization header
 *
 * SECURITY: Setelah decode JWT, middleware juga memverifikasi `token_version`
 * terhadap database. Jika user sudah logout atau ubah password (version naik),
 * semua JWT lama langsung ditolak meskipun belum expired.
 *
 * SLIDING SESSION: Jika token sudah > 50% umurnya, otomatis issue token baru
 * dan set cookie baru. User aktif tidak pernah ter-logout selama rutin akses.
 */
export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // 1. Coba baca dari httpOnly cookie (web browser)
  const cookieToken: string | undefined = (req as any).cookies?.lark_token;

  // 2. Fallback ke Authorization Bearer header (mobile / legacy)
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : undefined;

  const token = cookieToken || bearerToken;
  const isFromCookie = !!cookieToken;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Akses ditolak. Token tidak disediakan.' });
  }

  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) {
    return res.status(500).json({ success: false, error: 'Konfigurasi server tidak lengkap.' });
  }

  // Verify JWT signature + expiry
  let decoded: any;
  try {
    decoded = jwt.verify(token, jwtSecret);
  } catch {
    return res.status(401).json({
      success: false,
      error: 'Token tidak valid atau kedaluwarsa.',
      message: 'Sesi anda telah habis, silahkan login kembali.',
    });
  }

  // H2: Token Revocation — verifikasi token_version terhadap database
  // Jika user sudah logout atau ubah password, token_version di DB akan lebih tinggi
  // daripada yang ada di JWT, sehingga JWT lama ditolak.
  if (decoded.user_id && typeof decoded.token_version === 'number') {
    try {
      const user = await db.users.findUnique({
        where: { id: decoded.user_id },
        select: { token_version: true, is_active: true, deleted_at: true },
      });

      if (!user || user.deleted_at !== null || !user.is_active) {
        return res.status(401).json({
          success: false,
          error: 'Akun tidak ditemukan atau sudah dinonaktifkan.',
          message: 'Sesi anda telah habis, silahkan login kembali.',
        });
      }

      const dbVersion = user.token_version ?? 0;
      if (decoded.token_version < dbVersion) {
        return res.status(401).json({
          success: false,
          error: 'Sesi tidak valid. Password mungkin telah diubah atau Anda telah logout dari perangkat lain.',
          message: 'Sesi anda telah habis, silahkan login kembali.',
        });
      }
    } catch (dbErr) {
      // Jika DB tidak bisa dihubungi, biarkan request lewat (graceful degradation)
      // Server sudah return 503 jika DB benar-benar mati
      console.error('[AuthMiddleware] token_version check failed:', dbErr);
    }
  }

  // SLIDING SESSION: Jika token berasal dari cookie (web browser) dan sudah
  // melewati 50% lifetime-nya, otomatis issue token baru + set cookie baru.
  // Ini memastikan user aktif tidak pernah ter-logout selama rutin mengakses web.
  // Mobile app menggunakan Bearer token — refresh dilakukan secara terpisah.
  if (isFromCookie && decoded.iat && decoded.exp) {
    const now = Math.floor(Date.now() / 1000);
    const tokenAge = now - decoded.iat;

    if (tokenAge > RENEWAL_THRESHOLD_SECONDS) {
      try {
        const freshToken = jwt.sign(
          {
            user_id: decoded.user_id,
            username: decoded.username,
            role: decoded.role,
            tenant_id: decoded.tenant_id,
            outlet_id: decoded.outlet_id,
            token_version: decoded.token_version,
          },
          jwtSecret,
          { expiresIn: JWT_EXPIRY }
        );

        res.cookie('lark_token', freshToken, {
          httpOnly: true,
          secure: IS_PROD,
          sameSite: IS_PROD ? 'none' : 'lax',
          maxAge: COOKIE_MAX_AGE,
          path: '/',
        });
      } catch {
        // Token renewal gagal — biarkan request lanjut dengan token lama
      }
    }
  }

  req.user = decoded;
  next();
};
