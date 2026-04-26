"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRateLimiter = exports.clearFailedLogin = exports.recordFailedLogin = exports.loginRateLimiter = void 0;
const IS_TEST = process.env.NODE_ENV === 'test';
const memoryStore = new Map();
const loginRateLimiter = (req, res, next) => {
    // Bypass rate limit di test environment
    if (IS_TEST)
        return next();
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
        }
        else {
            // Lockout expired
            memoryStore.delete(ip);
        }
    }
    next();
};
exports.loginRateLimiter = loginRateLimiter;
const recordFailedLogin = (ip) => {
    const record = memoryStore.get(ip);
    if (record) {
        memoryStore.set(ip, {
            attempts: record.attempts + 1,
            lastAttempt: Date.now()
        });
    }
    else {
        memoryStore.set(ip, { attempts: 1, lastAttempt: Date.now() });
    }
};
exports.recordFailedLogin = recordFailedLogin;
const clearFailedLogin = (ip) => {
    memoryStore.delete(ip);
};
exports.clearFailedLogin = clearFailedLogin;
// ── Register Rate Limiter ────────────────────────────────────────────────────
// Batasi registrasi: max 3 akun per IP per 1 jam.
// Mencegah spam pembuatan tenant/user yang menghabiskan resource DB.
const registerStore = new Map();
const registerRateLimiter = (req, res, next) => {
    // Bypass rate limit di test environment
    if (IS_TEST)
        return next();
    const ip = req.ip || req.socket?.remoteAddress || '0.0.0.0';
    const record = registerStore.get(ip);
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 jam
    if (record) {
        const timePassed = now - record.lastAttempt;
        if (timePassed > windowMs) {
            // Window expired, reset
            registerStore.delete(ip);
        }
        else if (record.attempts >= 3) {
            const remainingMinutes = Math.ceil((windowMs - timePassed) / 60000);
            return res.status(429).json({
                success: false,
                error: `Terlalu banyak pendaftaran dari IP ini. Coba lagi dalam ${remainingMinutes} menit.`,
            });
        }
    }
    // Increment counter setelah request berhasil diproses
    const current = registerStore.get(ip);
    registerStore.set(ip, {
        attempts: (current?.attempts ?? 0) + 1,
        lastAttempt: now,
    });
    next();
};
exports.registerRateLimiter = registerRateLimiter;
