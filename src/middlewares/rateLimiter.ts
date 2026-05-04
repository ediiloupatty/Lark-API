/**
 * rateLimiter.ts — Rate limiting middleware untuk login & register.
 *
 * PERUBAHAN: Di NODE_ENV=test, semua rate limiter di-bypass otomatis
 * agar automated test tidak terhambat oleh throttling.
 *
 * KEAMANAN: Bypass HANYA terjadi jika NODE_ENV === 'test'.
 * Di production dan development, rate limiter tetap aktif penuh.
 */
import { Request, Response, NextFunction } from 'express';

const IS_TEST = process.env.NODE_ENV === 'test';

interface RateLimitRecord {
  attempts: number;
  lastAttempt: number; // Unix timestamp in ms
}

const memoryStore = new Map<string, RateLimitRecord>();

export const loginRateLimiter = (req: Request, res: Response, next: NextFunction) => {
  // Bypass rate limit di test environment
  if (IS_TEST) return next();

  const ip = req.ip || req.socket?.remoteAddress || '0.0.0.0';
  const record = memoryStore.get(ip);
  const now = Date.now();

  if (record && record.attempts >= 5) {
    const lockoutTimeMs = 15 * 60 * 1000; // 15 Min
    const timePassed = now - record.lastAttempt;

    if (timePassed < lockoutTimeMs) {
      const remainingMinutes = Math.ceil((lockoutTimeMs - timePassed) / 60000);
      return res.status(429).json({
        success: false,
        error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${remainingMinutes} menit.`,
      });
    } else {
      // Lockout expired
      memoryStore.delete(ip);
    }
  }

  next();
};

export const recordFailedLogin = (ip: string) => {
  const record = memoryStore.get(ip);
  if (record) {
    memoryStore.set(ip, {
      attempts: record.attempts + 1,
      lastAttempt: Date.now()
    });
  } else {
    memoryStore.set(ip, { attempts: 1, lastAttempt: Date.now() });
  }
};

export const clearFailedLogin = (ip: string) => {
  memoryStore.delete(ip);
};

// ── Register Rate Limiter ────────────────────────────────────────────────────
// Batasi registrasi: max 3 akun per IP per 1 jam.
// Mencegah spam pembuatan tenant/user yang menghabiskan resource DB.
const registerStore = new Map<string, RateLimitRecord>();

export const registerRateLimiter = (req: Request, res: Response, next: NextFunction) => {
  // Bypass rate limit di test environment
  if (IS_TEST) return next();

  const ip = req.ip || req.socket?.remoteAddress || '0.0.0.0';
  const record = registerStore.get(ip);
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 jam

  if (record) {
    const timePassed = now - record.lastAttempt;
    if (timePassed > windowMs) {
      // Window expired, reset
      registerStore.delete(ip);
    } else if (record.attempts >= 3) {
      const remainingMinutes = Math.ceil((windowMs - timePassed) / 60000);
      return res.status(429).json({
        success: false,
        error: `Terlalu banyak pendaftaran dari IP ini. Coba lagi dalam ${remainingMinutes} menit.`,
      });
    }
  }

  // SECURITY FIX: Increment counter hanya setelah registrasi berhasil (2xx response).
  // Sebelumnya counter naik SEBELUM handler jalan → user sah yang typo password
  // bisa ter-block selama 1 jam setelah 3 kali gagal validasi.
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const current = registerStore.get(ip);
      registerStore.set(ip, {
        attempts: (current?.attempts ?? 0) + 1,
        lastAttempt: Date.now(),
      });
    }
  });

  next();
};
