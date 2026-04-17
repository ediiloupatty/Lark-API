import { Request, Response } from 'express';
import { db } from '../config/db';

/**
 * GET /api/v1/public/landing-stats
 * Public endpoint (tidak butuh token) untuk landing page.
 * Mengembalikan:
 *  - total_orders: total semua transaksi
 *  - total_tenants: jumlah tenant aktif
 *  - productivity_pct: % pesanan selesai
 *  - packages: daftar paket berlangganan aktif
 */
export const getLandingStats = async (req: Request, res: Response) => {
  try {
    // 1. Total transaksi
    const ordersResult = await db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM orders
    `;
    const totalOrders = Number(ordersResult[0]?.count ?? 0);

    // 2. Total tenant aktif
    const tenantsResult = await db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM tenants WHERE is_active = true
    `;
    const totalTenants = Number(tenantsResult[0]?.count ?? 0);

    // 3. Produktivitas: % pesanan berstatus 'selesai'
    const doneResult = await db.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM orders WHERE status = 'selesai'
    `;
    const totalDone = Number(doneResult[0]?.count ?? 0);

    let productivityPct = '100%';
    if (totalOrders > 0) {
      const pct = Math.round((totalDone / totalOrders) * 100);
      productivityPct = `${pct}%`;
    }

    // Format total orders: tampilkan 1K+, 15K+, dll
    let totalOrdersFmt: string;
    if (totalOrders >= 1000) {
      totalOrdersFmt = `${(totalOrders / 1000).toFixed(1).replace(/\.0$/, '')}K+`;
    } else {
      totalOrdersFmt = totalOrders > 0 ? `${totalOrders}+` : '0';
    }

    // 4. Paket berlangganan aktif
    const packages = await db.subscription_packages.findMany({
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
  } catch (err: any) {
    console.error('[LandingStats]', err);
    return res.status(500).json({ status: 'error', message: 'Gagal memuat data.' });
  }
};
