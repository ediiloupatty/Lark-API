import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';

export const getServices = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'owner';
    const outletId = req.user?.outlet_id || null;

    let query = `SELECT * FROM services WHERE tenant_id = $1 AND is_active = true`;
    const params: any[] = [tenantId];

    if (!isAdmin) {
      query += ` AND (outlet_id = $2 OR outlet_id IS NULL)`;
      params.push(outletId);
    }

    query += ` ORDER BY nama_layanan ASC`;

    const services = await db.$queryRawUnsafe<any[]>(query, ...params);

    const result = services.map(s => {
      const durationHours = Number(s.durasi_jam || (Number(s.durasi_hari || 1) * 24));
      return {
        id: Number(s.id),
        name: s.nama_layanan,
        price: Number(s.harga_per_kg || 0),
        price_formatted: "Rp " + Number(s.harga_per_kg || 0).toLocaleString('id-ID'),
        unit: s.satuan || 'kg',
        description: s.deskripsi || '',
        duration: durationHours,
        duration_label: durationHours + " Jam",
        outlet_id: s.outlet_id ? Number(s.outlet_id) : null,
        paket_id: s.paket_id ? Number(s.paket_id) : null,
      };
    });

    res.json({
      status: 'success',
      message: 'Services data retrieved.',
      data: result
    });
  } catch (err: any) {
    console.error('[GetServices Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil layanan.' });
  }
};

export const addService = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'owner';
    const staffOutletId = req.user?.outlet_id || null;

    const { name, price, unit, description, duration_jam, outlet_id, paket_id } = req.body;

    if (!name || Number(price) <= 0) {
      return res.status(400).json({ status: 'error', message: 'Nama layanan dan harga (diatas 0) wajib diisi.' });
    }

    let finalOutletId = outlet_id ? parseInt(outlet_id) : null;
    if (!isAdmin) {
      if (!staffOutletId) return res.status(400).json({ status: 'error', message: 'Karyawan belum terhubung ke outlet.' });
      finalOutletId = staffOutletId;
    } else if (finalOutletId) {
      // [SECURITY FIX] Cross-Tenant Outlet IDOR
      const verifyOutlet = await db.outlets.findFirst({ where: { id: finalOutletId, tenant_id: tenantId } });
      if (!verifyOutlet) return res.status(403).json({ status: 'error', message: 'Outlet tidak valid atau tidak dimiliki tenant ini.' });
    }

    const inserted = await db.$queryRawUnsafe<any[]>(
      `INSERT INTO services (tenant_id, nama_layanan, harga_per_kg, satuan, deskripsi, durasi_jam, outlet_id, paket_id, server_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT))
       RETURNING id`,
      tenantId, name, Number(price), unit || 'kg', description || '', Number(duration_jam || 48), finalOutletId, paket_id || null
    );

    res.status(201).json({
      status: 'success',
      message: 'Layanan baru berhasil ditambahkan.',
      data: { id: inserted[0]?.id }
    });
  } catch (err: any) {
    console.error('[AddService Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menyimpan layanan.' });
  }
};

export const updateService = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'owner';
    const staffOutletId = req.user?.outlet_id || null;

    const { id, name, price, unit, description, duration_jam, outlet_id, paket_id } = req.body;

    if (!id || !name || Number(price) <= 0) {
      return res.status(400).json({ status: 'error', message: 'Data tidak lengkap atau harga tidak valid.' });
    }

    let finalOutletId = outlet_id ? parseInt(outlet_id) : null;
    if (!isAdmin) {
      if (!staffOutletId) return res.status(400).json({ status: 'error', message: 'Karyawan belum terhubung ke outlet.' });
      finalOutletId = staffOutletId;
    } else if (finalOutletId) {
      // [SECURITY FIX] Cross-Tenant Outlet IDOR
      const verifyOutlet = await db.outlets.findFirst({ where: { id: finalOutletId, tenant_id: tenantId } });
      if (!verifyOutlet) return res.status(403).json({ status: 'error', message: 'Outlet tidak valid atau tidak dimiliki tenant ini.' });
    }

    let query = `
      UPDATE services 
      SET nama_layanan = $1, harga_per_kg = $2, satuan = $3, deskripsi = $4, durasi_jam = $5, outlet_id = $6, paket_id = $7, server_version = CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT)
      WHERE id = $8 AND tenant_id = $9
    `;
    const params: any[] = [name, Number(price), unit || 'kg', description || '', Number(duration_jam || 48), finalOutletId, paket_id || null, id, tenantId];

    if (!isAdmin) {
      query += ` AND outlet_id = $10`;
      params.push(staffOutletId);
    }

    query += ` RETURNING id`;

    const updated = await db.$queryRawUnsafe<any[]>(query, ...params);

    if (updated.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Layanan tidak ditemukan atau tidak memiliki izin.' });
    }

    res.json({
      status: 'success',
      message: 'Layanan diperbarui.'
    });
  } catch (err: any) {
    console.error('[UpdateService Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memperbarui layanan.' });
  }
};

export const deleteService = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'owner';
    const staffOutletId = req.user?.outlet_id || null;

    const id = req.query.id || req.body.id;
    if (!id) return res.status(400).json({ status: 'error', message: 'ID diperlukan.' });

    let query = `UPDATE services SET is_active = false, server_version = CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT) WHERE id = $1 AND tenant_id = $2`;
    const params: any[] = [parseInt(id as string), tenantId];

    if (!isAdmin) {
      if (!staffOutletId) return res.status(400).json({ status: 'error', message: 'Karyawan belum terhubung ke outlet.' });
      query += ` AND outlet_id = $3`;
      params.push(staffOutletId);
    }

    query += ` RETURNING id`;

    const deleted = await db.$queryRawUnsafe<any[]>(query, ...params);

    if (deleted.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Layanan tidak ditemukan.' });
    }

    res.json({
      status: 'success',
      message: 'Layanan berhasil dihapus.'
    });
  } catch (err: any) {
    console.error('[DeleteService Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus layanan.' });
  }
};
