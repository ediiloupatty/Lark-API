"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maintenanceMiddleware = maintenanceMiddleware;
/**
 * Maintenance Mode Middleware
 *
 * Cara aktifkan: set MAINTENANCE_MODE=true di backend-node/.env, lalu restart backend.
 * Cara nonaktifkan: set MAINTENANCE_MODE=false (atau hapus variabelnya), lalu restart.
 *
 * Endpoint yang dikecualikan (tetap aktif saat maintenance):
 *   - GET /api/v1/health  → monitoring & uptime check
 *   - GET /api/v1/public/ → landing page tetap bisa diakses
 */
const EXEMPT_PATHS = [
    '/api/v1/health',
    '/api/v1/public/',
];
function maintenanceMiddleware(req, res, next) {
    const isMaintenanceOn = process.env.MAINTENANCE_MODE === 'true';
    if (!isMaintenanceOn) {
        return next();
    }
    // Izinkan endpoint yang dikecualikan
    const isExempt = EXEMPT_PATHS.some(p => req.path.startsWith(p));
    if (isExempt) {
        return next();
    }
    const estimatedEnd = process.env.MAINTENANCE_UNTIL || null; // contoh: "2026-04-17 04:00 WIB"
    const message = process.env.MAINTENANCE_MSG
        || 'Sistem sedang dalam pemeliharaan terjadwal. Coba lagi beberapa saat.';
    res.status(503).json({
        status: 'maintenance',
        code: 'SERVICE_UNAVAILABLE',
        message,
        estimated_end: estimatedEnd,
        // Flag eksplisit agar Flutter & React bisa detect tanpa parse message string
        is_maintenance: true,
    });
}
