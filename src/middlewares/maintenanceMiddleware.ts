import { Request, Response, NextFunction } from 'express';
import { maintenanceState } from '../controllers/sysAdminController';

/**
 * Maintenance Mode Middleware
 *
 * Prioritas: runtime state (toggle via Super Admin) > env variable.
 * Cara aktifkan via env: set MAINTENANCE_MODE=true di backend-node/.env, lalu restart backend.
 * Cara aktifkan via panel: POST /api/v1/sys-admin/maintenance/toggle (tanpa restart)
 *
 * Endpoint yang dikecualikan (tetap aktif saat maintenance):
 *   - GET /api/v1/health     → monitoring & uptime check
 *   - GET /api/v1/public/    → landing page tetap bisa diakses
 *   - /api/v1/sys-admin/     → super admin panel tetap accessible
 */

const EXEMPT_PATHS = [
  '/api/v1/health',
  '/api/v1/public/',
  '/api/v1/sys-admin/',
];

export function maintenanceMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Cek runtime state dulu, fallback ke env variable
  const isMaintenanceOn = maintenanceState.enabled || process.env.MAINTENANCE_MODE === 'true';

  if (!isMaintenanceOn) {
    return next();
  }

  // Izinkan endpoint yang dikecualikan
  const isExempt = EXEMPT_PATHS.some(p => req.path.startsWith(p));
  if (isExempt) {
    return next();
  }

  const estimatedEnd = maintenanceState.estimatedEnd || process.env.MAINTENANCE_UNTIL || null;
  const message = maintenanceState.message
    || process.env.MAINTENANCE_MSG
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
