import { Request, Response } from 'express';
import { db } from '../config/db';

import { AuthRequest } from '../middlewares/authMiddleware';
import { syncFetchOrderPayload, syncCurrentServerVersion, syncTableExists, syncTableHasColumn } from '../services/SyncService';

const formatTime = (timeObj: any) => {
  if (!timeObj) return '08:00';
  try {
    if (timeObj instanceof Date && !isNaN(timeObj.getTime())) return timeObj.toISOString().substring(11, 16);
    if (typeof timeObj === 'string') {
       const match = timeObj.match(/\d{2}:\d{2}/);
       if (match) return match[0];
    }
  } catch(e) {}
  return '08:00';
};

export const pullChanges = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ status: 'error', message: 'Super Admin tidak memiliki data sinkronisasi kasir.' });
    }

    const sinceVersion = parseInt(req.query.since_version as string) || 0;
    const outletId = req.user?.outlet_id || null;
    const isAdmin = req.user?.role === 'super_admin' || req.user?.role === 'admin';

    const data: any = {
      services: [],
      packages: [],
      customers: [],
      orders: [],
      outlets: [],  // [Bug #2 Fix] Sertakan outlet agar mobile selalu update
    };

    // ── Services ────────────────────────────────────────────────
    if (await syncTableHasColumn(db, 'services', 'server_version')) {
      let q = `
        SELECT id, nama_layanan as name, harga_per_kg as price, satuan as unit,
               deskripsi as description, durasi_jam as duration, outlet_id,
               paket_id, updated_at, server_version
        FROM services
        WHERE tenant_id = $1 AND is_active = true AND server_version > $2
      `;
      const params: any[] = [tenantId, sinceVersion];
      if (!isAdmin && outletId !== null) {
        q += ` AND (outlet_id = $3 OR outlet_id IS NULL)`;
        params.push(outletId);
      }
      q += ` ORDER BY server_version ASC`;
      const rawServices = await db.$queryRawUnsafe<any[]>(q, ...params);
      data.services = rawServices.map((s: any) => {
        const durasi = Number(s.duration || 24);
        return {
          ...s,
          price: Number(s.price || 0),
          price_formatted: "Rp " + Number(s.price || 0).toLocaleString('id-ID'),
          duration: durasi,
          duration_label: durasi + " Jam",
          outlet_id: s.outlet_id ? Number(s.outlet_id) : null,
          paket_id: s.paket_id ? Number(s.paket_id) : null,
          server_version: Number(s.server_version || 0),
        };
      });
    }

    // ── Packages ─────────────────────────────────────────────────
    // paket_laundry TIDAK punya server_version → selalu kirim semua paket aktif
    // Aman karena paket jumlahnya kecil (biasanya < 20 item)
    if (await syncTableExists(db, 'paket_laundry')) {
      let q = `
        SELECT pl.id, pl.nama, pl.durasi_jam, pl.harga_tambahan as price_tambahan,
               pl.kapasitas_per_hari, pl.outlet_id, pl.is_active,
               COALESCE(o.jam_tutup, '18:00') as jam_tutup_outlet,
               COALESCE(o.jam_buka, '08:00') as jam_buka_outlet,
               CONCAT(pl.durasi_jam, ' Jam') as durasi_label
        FROM paket_laundry pl
        LEFT JOIN outlets o ON pl.outlet_id = o.id
        WHERE pl.tenant_id = $1 AND pl.is_active = true
      `;
      const params: any[] = [tenantId];
      if (!isAdmin && outletId !== null) {
        q += ` AND (pl.outlet_id = $2 OR pl.outlet_id IS NULL)`;
        params.push(outletId);
      }
      q += ` ORDER BY pl.durasi_jam ASC`;
      const rawPkgs = await db.$queryRawUnsafe<any[]>(q, ...params);
      data.packages = rawPkgs.map((p: any) => ({
        id: Number(p.id),
        nama: p.nama,
        nama_paket: p.nama, // Backward compatibility with Flutter UI
        durasi_jam: Number(p.durasi_jam || 72),
        durasi_label: p.durasi_label,
        price_tambahan: Number(p.price_tambahan || 0),
        harga_tambahan: Number(p.price_tambahan || 0),
        kapasitas_per_hari: p.kapasitas_per_hari ? Number(p.kapasitas_per_hari) : null,
        outlet_id: p.outlet_id ? Number(p.outlet_id) : null,
        is_active: p.is_active ?? true,
        is_available: p.is_active ?? true,
        jam_tutup_outlet: formatTime(p.jam_tutup_outlet),
        jam_buka_outlet: formatTime(p.jam_buka_outlet),
        server_version: 1, // dummy agar CatalogDao bisa simpan (butuh numeric id)
      }));
    }


    // ── Customers ────────────────────────────────────────────────
    if (await syncTableHasColumn(db, 'customers', 'server_version')) {
      const q = `
        SELECT id, client_id, nama, no_hp, alamat, deleted_at, updated_at, server_version
        FROM customers
        WHERE tenant_id = $1 AND server_version > $2 AND nama != 'Pelanggan Walk-in'
        ORDER BY server_version ASC LIMIT 200
      `;
      data.customers = await db.$queryRawUnsafe<any[]>(q, tenantId, sinceVersion);
    }

    // ── Orders ───────────────────────────────────────────────────
    if (await syncTableHasColumn(db, 'orders', 'server_version')) {
      let q = `SELECT id FROM orders WHERE tenant_id = $1 AND server_version > $2`;
      const params: any[] = [tenantId, sinceVersion];
      if (!isAdmin && outletId !== null) {
        q += ` AND outlet_id = $3`;
        params.push(outletId);
      }
      q += ` ORDER BY server_version ASC LIMIT 100`;

      const orderRows = await db.$queryRawUnsafe<any[]>(q, ...params);
      for (const row of orderRows) {
        const payload = await syncFetchOrderPayload(db, tenantId, row.id);
        if (payload) data.orders.push(payload);
      }
    }

    // ── Outlets [Bug #2 Fix] ─────────────────────────────────────
    // Outlet kritis untuk create-order dan filter tapi tidak ada di pull sebelumnya.
    // Strategi: jika tabel punya server_version → incremental; jika tidak → kirim semua aktif.
    // Dibungkus try-catch agar jangan gagalkan seluruh pull hanya karena outlet.
    try {
      const outletHasSV = await syncTableHasColumn(db, 'outlets', 'server_version');
      if (outletHasSV && sinceVersion > 0) {
        // Incremental: hanya outlet yang berubah sejak sinceVersion
        const rows = await db.$queryRawUnsafe<any[]>(
          `SELECT id, nama, alamat, phone, jam_buka, jam_tutup, is_active, server_version
           FROM outlets WHERE tenant_id = $1 AND server_version > $2
           ORDER BY server_version ASC`,
          tenantId, sinceVersion
        );
        data.outlets = rows.map((o: any) => ({ ...o, server_version: Number(o.server_version || 0), jam_buka: formatTime(o.jam_buka), jam_tutup: formatTime(o.jam_tutup) }));
      } else {
        // Bootstrap atau tabel tanpa server_version: kirim semua outlet aktif
        const rows = await db.$queryRawUnsafe<any[]>(
          `SELECT id, nama, alamat, phone, jam_buka, jam_tutup, is_active
           FROM outlets WHERE tenant_id = $1 AND is_active = true
           ORDER BY nama ASC`,
          tenantId
        );
        data.outlets = rows.map((o: any) => ({ ...o, jam_buka: formatTime(o.jam_buka), jam_tutup: formatTime(o.jam_tutup) }));
      }
    } catch (outletErr: any) {
      console.warn('[Sync Pull] Gagal ambil outlets:', outletErr?.message);
      data.outlets = [];
    }

    // ── Metadata ─────────────────────────────────────────────────
    let hasMore = false;
    let maxFetchedVersion = 0;

    for (const key of ['services', 'packages', 'customers', 'orders']) {
      if (data[key].length > 0) {
        const lastItem = data[key][data[key].length - 1];
        const v = lastItem.server_version ? parseInt(lastItem.server_version) : 0;
        if (v > maxFetchedVersion) maxFetchedVersion = v;
      }
    }

    if (data.customers.length >= 200 || data.orders.length >= 100) {
      hasMore = true;
      data.server_version = maxFetchedVersion;
    } else {
      data.server_version = await syncCurrentServerVersion(db, tenantId);
    }

    data.has_more = hasMore;

    res.json({
      status: 'success',
      message: 'Sinkronisasi incremental berhasil.',
      data
    });

  } catch (err: any) {
    console.error('[Sync Pull]', err);
    res.status(500).json({ status: 'error', message: 'Terjadi kesalahan internal sinkronisasi.' });
  }
};
