"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLandingStats = void 0;
const db_1 = require("../config/db");
/**
 * GET /api/v1/public/landing-stats
 * Public endpoint (tidak butuh token) untuk landing page.
 * Mengembalikan:
 *  - total_orders: total semua transaksi
 *  - total_tenants: jumlah tenant aktif
 *  - productivity_pct: % pesanan selesai
 *  - packages: daftar paket berlangganan aktif
 */
const getLandingStats = async (req, res) => {
    try {
        // 1. Total transaksi
        const ordersResult = await db_1.db.$queryRaw `
      SELECT COUNT(*) as count FROM orders
    `;
        const totalOrders = Number(ordersResult[0]?.count ?? 0);
        // 2. Total tenant aktif
        const tenantsResult = await db_1.db.$queryRaw `
      SELECT COUNT(*) as count FROM tenants WHERE is_active = true
    `;
        const totalTenants = Number(tenantsResult[0]?.count ?? 0);
        // 3. Produktivitas: % pesanan berstatus 'selesai'
        const doneResult = await db_1.db.$queryRaw `
      SELECT COUNT(*) as count FROM orders WHERE status = 'selesai'
    `;
        const totalDone = Number(doneResult[0]?.count ?? 0);
        let productivityPct = '100%';
        if (totalOrders > 0) {
            const pct = Math.round((totalDone / totalOrders) * 100);
            productivityPct = `${pct}%`;
        }
        // Format total orders: tampilkan 1K+, 15K+, dll
        let totalOrdersFmt;
        if (totalOrders >= 1000) {
            totalOrdersFmt = `${(totalOrders / 1000).toFixed(1).replace(/\.0$/, '')}K+`;
        }
        else {
            totalOrdersFmt = totalOrders > 0 ? `${totalOrders}+` : '0';
        }
        // 4. Paket berlangganan aktif
        const packages = await db_1.db.subscription_packages.findMany({
            where: { is_active: true },
            orderBy: { harga: 'asc' },
            select: {
                id: true,
                plan_code: true,
                nama_paket: true,
                harga: true,
                badge_label: true,
                deskripsi_singkat: true,
                xendit_link: true,
                features: true,
            },
        });
        return res.json({
            status: 'success',
            data: {
                total_orders_fmt: totalOrdersFmt,
                total_tenants: totalTenants,
                productivity_pct: productivityPct,
                packages: packages.map(p => ({
                    ...p,
                    harga: Number(p.harga), // Decimal → number untuk JSON
                })),
            },
        });
    }
    catch (err) {
        console.error('[LandingStats]', err);
        return res.status(500).json({ status: 'error', message: 'Gagal memuat data.' });
    }
};
exports.getLandingStats = getLandingStats;
