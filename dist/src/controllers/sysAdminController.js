"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTenantsList = exports.getGlobalStats = void 0;
const db_1 = require("../config/db");
const getGlobalStats = async (req, res) => {
    try {
        // Pastikan ini adalah global master admin (role super_admin dan tidak terikat tenant)
        if (req.user?.role !== 'super_admin' || req.user?.tenant_id !== null) {
            return res.status(403).json({ success: false, error: 'Akses ditolak. Khusus Master Admin.' });
        }
        const totalTenants = await db_1.db.tenants.count();
        // Aggregate total pesanan
        const totalOrders = await db_1.db.orders.count({ where: { deleted_at: null } });
        // Aggregate total pendapatan (orders selesai / lunas)
        const revenueAgg = await db_1.db.orders.aggregate({
            _sum: {
                total_harga: true,
            },
            where: {
                status: 'selesai',
                deleted_at: null
            }
        });
        return res.status(200).json({
            success: true,
            data: {
                total_tenants: totalTenants,
                total_orders: totalOrders,
                total_revenue: revenueAgg._sum.total_harga || 0
            }
        });
    }
    catch (error) {
        console.error('[SysAdminController] getGlobalStats error:', error);
        return res.status(500).json({ success: false, error: 'Gagal mengambil statistik global.' });
    }
};
exports.getGlobalStats = getGlobalStats;
const getTenantsList = async (req, res) => {
    try {
        if (req.user?.role !== 'super_admin' || req.user?.tenant_id !== null) {
            return res.status(403).json({ success: false, error: 'Akses ditolak. Khusus Master Admin.' });
        }
        const tenants = await db_1.db.tenants.findMany({
            select: {
                id: true,
                name: true,
                slug: true,
                email: true,
                phone: true,
                subscription_plan: true,
                is_active: true,
                created_at: true,
                _count: {
                    select: { orders: true, outlets: true }
                }
            },
            orderBy: { created_at: 'desc' }
        });
        return res.status(200).json({
            success: true,
            data: tenants
        });
    }
    catch (error) {
        console.error('[SysAdminController] getTenantsList error:', error);
        return res.status(500).json({ success: false, error: 'Gagal mengambil daftar tenant.' });
    }
};
exports.getTenantsList = getTenantsList;
