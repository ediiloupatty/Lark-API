import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  attempts: number;
  lastAttempt: number; // Unix timestamp in ms
}

const memoryStore = new Map<string, RateLimitRecord>();

export const loginRateLimiter = (req: Request, res: Response, next: NextFunction) => {
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
