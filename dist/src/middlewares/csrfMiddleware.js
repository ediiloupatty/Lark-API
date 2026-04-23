"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setCsrfCookie = setCsrfCookie;
exports.verifyCsrf = verifyCsrf;
const crypto_1 = __importDefault(require("crypto"));
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
const IS_PROD = process.env.NODE_ENV === 'production';
/**
 * Middleware untuk SET csrf cookie pada setiap response.
 * Dipasang di level app, sebelum routes.
 */
function setCsrfCookie(req, res, next) {
    // Jika cookie belum ada, buat baru
    if (!req.cookies?.lark_csrf) {
        const csrfToken = crypto_1.default.randomBytes(32).toString('hex');
        res.cookie('lark_csrf', csrfToken, {
            httpOnly: false, // HARUS false — frontend perlu baca ini via JS
            secure: IS_PROD,
            sameSite: IS_PROD ? 'none' : 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 hari (sama dengan auth cookie)
            path: '/',
        });
    }
    next();
}
/**
 * Middleware untuk VERIFIKASI csrf token pada mutating requests (POST/PUT/DELETE).
 * Dipasang pada routes yang membutuhkan CSRF protection.
 */
function verifyCsrf(req, res, next) {
    // Skip untuk GET/HEAD/OPTIONS (idempotent)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    // Skip untuk Mobile App (menggunakan header x-app-platform, bukan cookie)
    const platform = req.headers['x-app-platform'];
    if (platform === 'LarkMobile') {
        return next();
    }
    const cookieToken = req.cookies?.lark_csrf;
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
