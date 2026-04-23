"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../config/db");
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
 */
const authenticateToken = async (req, res, next) => {
    // 1. Coba baca dari httpOnly cookie (web browser)
    const cookieToken = req.cookies?.lark_token;
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
    // Verify JWT signature + expiry
    let decoded;
    try {
        decoded = jsonwebtoken_1.default.verify(token, jwtSecret);
    }
    catch {
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
            const user = await db_1.db.users.findUnique({
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
        }
        catch (dbErr) {
            // Jika DB tidak bisa dihubungi, biarkan request lewat (graceful degradation)
            // Server sudah return 503 jika DB benar-benar mati
            console.error('[AuthMiddleware] token_version check failed:', dbErr);
        }
    }
    req.user = decoded;
    next();
};
exports.authenticateToken = authenticateToken;
