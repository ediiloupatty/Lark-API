import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AUTH_COOKIE_MAX_AGE, csrfCookieOptions } from '../config/cookies';

/**
 * CSRF Protection — Double Submit Cookie Pattern.
 *
 * Cara kerja:
 * 1. Server set cookie `lark_csrf` (non-httpOnly, bisa dibaca JS)
 * 2. Frontend harus baca cookie ini dan kirim nilainya di header `X-CSRF-Token`
 * 3. Server verifikasi: cookie value === header value
 *
 * Kenapa aman:
 * - Attacker dari domain lain TIDAK bisa membaca cookie `lark_csrf` karena SameSite policy
 * - Attacker TIDAK bisa set custom header `X-CSRF-Token` dari form HTML biasa
 * - Hanya JS dari domain yang sama yang bisa baca cookie + set header
 *
 * Endpoint yang TIDAK butuh CSRF:
 * - GET requests (idempotent)
 * - /auth/login, /auth/register, /auth/google (belum punya session)
 * - Mobile App requests (dikirim via header x-app-platform: LarkMobile)
 */

/**
 * Middleware untuk SET csrf cookie pada setiap response.
 * Dipasang di level app, sebelum routes.
 */
export function setCsrfCookie(req: Request, res: Response, next: NextFunction) {
  // Jika cookie belum ada, buat baru
  if (!(req as any).cookies?.lark_csrf) {
    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('lark_csrf', csrfToken, {
      ...csrfCookieOptions,       // httpOnly: false — frontend perlu baca ini via JS
      maxAge: AUTH_COOKIE_MAX_AGE, // 7 hari (sama dengan auth cookie)
    });
  }
  next();
}

/**
 * Middleware untuk VERIFIKASI csrf token pada mutating requests (POST/PUT/DELETE).
 * Dipasang pada routes yang membutuhkan CSRF protection.
 */
export function verifyCsrf(req: Request, res: Response, next: NextFunction) {
  // Skip untuk GET/HEAD/OPTIONS (idempotent)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip untuk Mobile App & Web Frontend (keduanya mengirim custom header x-app-platform)
  // Custom header memicu CORS preflight, yang hanya diizinkan untuk origin terdaftar,
  // sehingga kebal dari serangan form POST CSRF biasa.
  const platform = req.headers['x-app-platform'];
  if (platform === 'LarkMobile' || platform === 'LarkWeb') {
    return next();
  }

  const cookieToken = (req as any).cookies?.lark_csrf;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      status: 'error',
      success: false,
      message: 'CSRF token tidak valid. Silakan refresh halaman dan coba lagi.',
    });
  }

  next();
}
