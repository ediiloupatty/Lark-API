"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeRole = authorizeRole;
/**
 * Role-based authorization middleware.
 * Harus diletakkan SETELAH authenticateToken.
 *
 * Contoh usage:
 *   router.delete('/delete-staff', authenticateToken, authorizeRole('admin', 'owner', 'super_admin'), deleteStaff);
 *
 * SECURITY:
 * - Mencegah karyawan mengakses endpoint admin-only (delete staff, settings, dll)
 * - Role diambil dari JWT payload (server-trusted), bukan dari client input
 */
function authorizeRole(...allowedRoles) {
    return (req, res, next) => {
        const userRole = req.user?.role;
        if (!userRole) {
            return res.status(403).json({
                status: 'error',
                success: false,
                message: 'Akses ditolak. Role tidak terdeteksi.',
            });
        }
        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({
                status: 'error',
                success: false,
                message: 'Akses ditolak. Anda tidak memiliki izin untuk tindakan ini.',
            });
        }
        next();
    };
}
