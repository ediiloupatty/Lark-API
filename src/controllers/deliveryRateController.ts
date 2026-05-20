import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';

const VALID_ZONES = ['dekat', 'sedang', 'jauh'] as const;

/**
 * GET /api/v1/sync/delivery-rates
 * Daftar tarif ongkir per outlet per zona.
 * Semua role boleh baca — karyawan butuh ini untuk hitung ongkir saat buat order.
 */
export const getDeliveryRates = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const rows = await db.$queryRawUnsafe<any[]>(
      `SELECT id, outlet_id, zone, fee
       FROM outlet_delivery_rates
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY outlet_id ASC, zone ASC`,
      tenantId
    );

    res.json({
      status: 'success',
      data: rows.map(r => ({
        id: r.id,
        outlet_id: r.outlet_id,
        zone: r.zone,
        fee: Number(r.fee),
      })),
    });
  } catch (err: any) {
    console.error('[GetDeliveryRates Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil tarif ongkir.' });
  }
};

/**
 * PUT /api/v1/sync/delivery-rates
 * Admin set tarif ongkir untuk satu outlet (3 zona sekaligus).
 * Body: { outlet_id, rates: { dekat: number, sedang: number, jauh: number } }
 */
export const updateDeliveryRates = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    if (role !== 'admin' && role !== 'super_admin' && role !== 'owner') {
      return res.status(403).json({ status: 'error', message: 'Hanya admin yang dapat mengatur tarif ongkir.' });
    }

    const { outlet_id, rates } = req.body;
    if (!outlet_id || !rates || typeof rates !== 'object') {
      return res.status(400).json({ status: 'error', message: 'Data tidak lengkap.' });
    }

    // Tenant boundary: pastikan outlet benar-benar milik tenant ini
    const outlet = await db.outlets.findFirst({
      where: { id: parseInt(outlet_id), tenant_id: tenantId },
    });
    if (!outlet) return res.status(404).json({ status: 'error', message: 'Outlet tidak ditemukan.' });

    const serverVersion = Date.now();
    for (const zone of VALID_ZONES) {
      const raw = rates[zone];
      if (raw === undefined || raw === null || raw === '') continue;
      const fee = Number(raw);
      if (isNaN(fee) || fee < 0) {
        return res.status(400).json({ status: 'error', message: `Tarif zona ${zone} tidak valid.` });
      }
      await db.$executeRawUnsafe(
        `INSERT INTO outlet_delivery_rates (tenant_id, outlet_id, zone, fee, server_version, updated_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
         ON CONFLICT (outlet_id, zone)
         DO UPDATE SET fee = EXCLUDED.fee, is_active = true,
                       server_version = EXCLUDED.server_version, updated_at = CURRENT_TIMESTAMP`,
        tenantId, outlet.id, zone, fee, serverVersion
      );
    }

    res.json({ status: 'success', message: 'Tarif ongkir berhasil disimpan.' });
  } catch (err: any) {
    console.error('[UpdateDeliveryRates Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menyimpan tarif ongkir.' });
  }
};
