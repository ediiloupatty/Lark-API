import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    user_id: number;
    username: string;
    role: string;
    tenant_id: number;
    outlet_id: number | null;
    nama?: string;
  };
}

/**
 * Middleware autentikasi yang mendukung dual-mode:
 *   1. httpOnly Cookie  → Web browser (lebih aman, tidak accessible JS)
 *   2. Bearer Token     → Mobile App / legacy sessions (backward compatible)
 *
 * Priority: cookie > Authorization header
 */
export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  // 1. Coba baca dari httpOnly cookie (web browser)
  const cookieToken: string | undefined = (req as any).cookies?.lark_token;

  // 2. Fallback ke Authorization Bearer header (mobile / legacy)
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : undefined;

  const token = cookieToken || bearerToken;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Akses ditolak. Token tidak disediakan.' });
  }

  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) {
    return res.status(500).json({ success: false, error: 'Konfigurasi server tidak lengkap.' });
  }

  jwt.verify(token, jwtSecret, (err: any, decoded: any) => {
    if (err) {
      // Return 401 agar Flutter ApiClient memicu forceLogout()
      return res.status(401).json({ success: false, error: 'Token tidak valid atau kedaluwarsa.', message: 'Sesi anda telah habis, silahkan login kembali.' });
    }

    req.user = decoded;
    next();
  });
};
