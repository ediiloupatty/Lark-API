import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';

export const getPackages = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required' });

    const role = req.user?.role || '';
    const isAdmin = role === 'super_admin' || role === 'admin' || role === 'owner';
    const staffOutletId = req.user?.outlet_id || null;

    let query = `SELECT id, nama, durasi_jam, harga_tambahan, outlet_id, kapasitas_per_hari FROM paket_laundry WHERE tenant_id = $1 AND is_active = true`;
    const params: any[] = [tenantId];

    if (!isAdmin) {
      if (!staffOutletId) return res.status(400).json({ status: 'error', message: 'Karyawan belum terhubung ke outlet.' });
      query += ` AND (outlet_id = $2 OR outlet_id IS NULL)`;
      params.push(staffOutletId);
    }
    
    query += ` ORDER BY durasi_jam ASC`;
    const pakets = await db.$queryRawUnsafe<any[]>(query, ...params);

    const formatted = pakets.map(p => {
      const durasi = Number(p.durasi_jam);
      const hari = durasi / 24;
      let label = durasi < 24 ? durasi + ' Jam' : (hari % 1 === 0 ? hari + ' Hari' : hari.toFixed(1) + ' Hari');
      
      return {
        id: Number(p.id),
        nama: p.nama,
        nama_paket: p.nama, // Backward compatibility
        durasi_jam: durasi,
        durasi_label: label,
        price_tambahan: Number(p.harga_tambahan || 0),
        outlet_id: p.outlet_id ? Number(p.outlet_id) : null,
        kapasitas_per_hari: p.kapasitas_per_hari ? Number(p.kapasitas_per_hari) : null
      };
    });

    res.json({ status: 'success', message: 'Packages retrieved.', data: formatted });
  } catch (err: any) {
    console.error('[GetPackages Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memuat paket cucian' });
  }
};

export const addPackage = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required' });

    const role = req.user?.role || '';
    const isAdmin = role === 'super_admin' || role === 'admin' || role === 'owner';
    const staffOutletId = req.user?.outlet_id || null;

    const data = req.body;
    const nama = (data.nama || data.nama_paket || '').trim();
    const jam = parseInt(data.durasi_jam || 0);
    const harga = parseFloat(data.price_tambahan || data.harga_tambahan || 0);
    let outlet_id = data.outlet_id !== undefined && data.outlet_id !== null ? parseInt(data.outlet_id) : null;
    const kapasitas = data.kapasitas_per_hari !== undefined && data.kapasitas_per_hari !== null ? parseInt(data.kapasitas_per_hari) : null;

    if (!isAdmin) {
       if (!staffOutletId) return res.status(400).json({ status: 'error', message: 'Karyawan belum terhubung ke outlet.' });
       outlet_id = staffOutletId;
    } else if (outlet_id) {
       // [SECURITY FIX] Cross-Tenant Outlet IDOR
       const verifyOutlet = await db.outlets.findFirst({ where: { id: outlet_id, tenant_id: tenantId } });
       if (!verifyOutlet) return res.status(403).json({ status: 'error', message: 'Outlet tidak valid atau tidak dimiliki tenant ini.' });
    }

    if (!nama || jam <= 0) {
       return res.status(400).json({ status: 'error', message: 'Nama paket dan durasi wajib diisi.' });
    }

    const inserted = await db.$queryRawUnsafe<any[]>(
      `INSERT INTO paket_laundry (tenant_id, nama, durasi_jam, harga_tambahan, outlet_id, kapasitas_per_hari, is_active, server_version) 
       VALUES ($1, $2, $3, $4, $5, $6, true, CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT)) RETURNING id`,
      tenantId, nama, jam, harga, outlet_id, kapasitas
    );

    res.status(201).json({ status: 'success', message: 'Paket durasi baru berhasil ditambahkan.', data: { id: inserted[0]?.id } });
  } catch (err: any) {
    console.error('[AddPackage Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menambahkan paket' });
  }
};

export const updatePackage = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required' });

    const role = req.user?.role || '';
    const isAdmin = role === 'super_admin' || role === 'admin' || role === 'owner';
    const staffOutletId = req.user?.outlet_id || null;

    const data = req.body;
    const id = parseInt(data.id);
    const nama = (data.nama || data.nama_paket || '').trim();
    const jam = parseInt(data.durasi_jam || 0);
    const harga = parseFloat(data.price_tambahan || data.harga_tambahan || 0);
    let outlet_id = data.outlet_id !== undefined && data.outlet_id !== null ? parseInt(data.outlet_id) : null;
    const kapasitas = data.kapasitas_per_hari !== undefined && data.kapasitas_per_hari !== null ? parseInt(data.kapasitas_per_hari) : null;

    if (!isAdmin) {
       if (!staffOutletId) return res.status(400).json({ status: 'error', message: 'Karyawan belum terhubung ke outlet.' });
       outlet_id = staffOutletId;
    } else if (outlet_id) {
       // [SECURITY FIX] Cross-Tenant Outlet IDOR
       const verifyOutlet = await db.outlets.findFirst({ where: { id: outlet_id, tenant_id: tenantId } });
       if (!verifyOutlet) return res.status(403).json({ status: 'error', message: 'Outlet tidak valid atau tidak dimiliki tenant ini.' });
    }

    if (!id || !nama || jam <= 0) {
       return res.status(400).json({ status: 'error', message: 'ID, nama, dan durasi wajib diisi.' });
    }

    let query = `UPDATE paket_laundry SET nama = $1, durasi_jam = $2, harga_tambahan = $3, outlet_id = $4, kapasitas_per_hari = $5, server_version = CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT) WHERE id = $6 AND tenant_id = $7`;
    const params: any[] = [nama, jam, harga, outlet_id, kapasitas, id, tenantId];

    if (!isAdmin) {
      query += ` AND outlet_id = $8`;
      params.push(staffOutletId);
    }
    
    query += ` RETURNING id`;
    
    const updated = await db.$queryRawUnsafe<any[]>(query, ...params);
    if (updated.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Paket tidak ditemukan atau tidak ada akses.' });
    }

    res.json({ status: 'success', message: 'Paket durasi diperbarui.' });
  } catch (err: any) {
    console.error('[UpdatePackage Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memperbarui database.' });
  }
};

export const deletePackage = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required' });

    const role = req.user?.role || '';
    const isAdmin = role === 'super_admin' || role === 'admin' || role === 'owner';
    const staffOutletId = req.user?.outlet_id || null;

    // Support both GET ?id=X and POST { id: X }
    const idParam = req.query.id || req.body.id;
    const id = parseInt(idParam as string);

    if (!id) return res.status(400).json({ status: 'error', message: 'ID diperlukan.' });

    let query = `UPDATE paket_laundry SET is_active = false, server_version = CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT) WHERE id = $1 AND tenant_id = $2`;
    const params: any[] = [id, tenantId];

    if (!isAdmin) {
      if (!staffOutletId) return res.status(400).json({ status: 'error', message: 'Karyawan belum terhubung ke outlet.' });
      query += ` AND outlet_id = $3`;
      params.push(staffOutletId);
    }

    const result = await db.$executeRawUnsafe(query, ...params);
    if (result === 0) {
       return res.status(404).json({ status: 'error', message: 'Data tidak ditemukan.' });
    }

    res.json({ status: 'success', message: 'Paket berhasil dihapus.' });
  } catch (err: any) {
    console.error('[DeletePackage Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus paket' });
  }
};
