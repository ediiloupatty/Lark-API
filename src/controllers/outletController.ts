import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';

// GET /api/v1/sync/outlets
export const getOutlets = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'owner';
    const staffOutletId = req.user?.outlet_id || null;

    let query = `SELECT id, nama, alamat, phone, jam_buka, jam_tutup FROM outlets WHERE tenant_id = $1 AND (is_active = true OR is_active IS NULL)`;
    const params: any[] = [tenantId];

    if (!isAdmin && staffOutletId) {
      query += ` AND id = $2`;
      params.push(staffOutletId);
    }
    
    query += ` ORDER BY nama ASC`;

    const outletsRaw = await db.$queryRawUnsafe<any[]>(query, ...params);

    const formatTime = (timeObj: any) => {
      if (!timeObj) return '08:00';
      try {
        if (timeObj instanceof Date) {
          if (isNaN(timeObj.getTime())) return '08:00';
          return timeObj.toISOString().substring(11, 16); 
        }
        if (typeof timeObj === 'string') {
           const match = timeObj.match(/\d{2}:\d{2}/);
           if (match) return match[0];
        }
      } catch(e) {}
      return '08:00';
    };

    const outlets = outletsRaw.map(o => {
      return {
        ...o,
        jam_buka: formatTime(o.jam_buka),
        jam_tutup: formatTime(o.jam_tutup)
      };
    });

    res.json({
      status: 'success',
      data: outlets
    });
  } catch (err: any) {
    console.error('[GetOutlets Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil data outlet.' });
  }
};

// POST /api/v1/sync/add-outlet
export const addOutlet = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    if (role !== 'admin' && role !== 'super_admin' && role !== 'owner') {
      return res.status(403).json({ status: 'error', message: 'Hanya admin yang dapat menambah outlet.' });
    }

    const { nama, alamat, phone, jam_buka, jam_tutup } = req.body;

    if (!nama) return res.status(400).json({ status: 'error', message: 'Nama outlet wajib diisi.' });

    const inserted = await db.$queryRawUnsafe<any[]>(
      `INSERT INTO outlets (tenant_id, nama, alamat, phone, jam_buka, jam_tutup)
       VALUES ($1, $2, $3, $4, $5::time, $6::time) RETURNING id`,
      tenantId, nama, alamat || null, phone || null, jam_buka || '08:00', jam_tutup || '20:00'
    );

    res.status(201).json({
      status: 'success',
      message: 'Outlet berhasil ditambahkan.',
      data: { id: inserted[0].id }
    });
  } catch (err: any) {
    console.error('[AddOutlet Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menambah outlet.' });
  }
};

// PUT /api/v1/sync/update-outlet
export const updateOutlet = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    if (role !== 'admin' && role !== 'super_admin' && role !== 'owner') {
      return res.status(403).json({ status: 'error', message: 'Hanya admin yang dapat mengubah outlet.' });
    }

    const { id, nama, alamat, phone, jam_buka, jam_tutup } = req.body;

    if (!id || !nama) return res.status(400).json({ status: 'error', message: 'Data tidak lengkap.' });

    const updated = await db.$queryRawUnsafe<any[]>(
      `UPDATE outlets SET nama = $1, alamat = $2, phone = $3, jam_buka = $4::time, jam_tutup = $5::time
       WHERE id = $6 AND tenant_id = $7 RETURNING id`,
      nama, alamat || null, phone || null, jam_buka || '08:00', jam_tutup || '20:00', parseInt(id), tenantId
    );

    if (updated.length === 0) return res.status(404).json({ status: 'error', message: 'Outlet tidak ditemukan.' });

    res.json({
      status: 'success',
      message: 'Outlet berhasil diperbarui.'
    });
  } catch (err: any) {
    console.error('[UpdateOutlet Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memperbarui outlet.' });
  }
};

// DELETE /api/v1/sync/delete-outlet
export const deleteOutlet = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });
    
    // Check if admin
    const role = req.user?.role || '';
    if (role !== 'admin' && role !== 'super_admin' && role !== 'owner') {
      return res.status(403).json({ status: 'error', message: 'Akses ditolak.' });
    }

    const idParam = req.body.id || req.query.id;
    if (!idParam) return res.status(400).json({ status: 'error', message: 'ID Outlet diperlukan.' });

    const outletId = parseInt(idParam as string);

    // Check for active orders linked to this outlet
    const activeOrders = await db.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as count FROM orders WHERE outlet_id = $1 AND tenant_id = $2 AND status NOT IN ('selesai', 'dibatalkan')`,
      outletId, tenantId
    );
    if (Number(activeOrders[0]?.count || 0) > 0) {
      return res.status(400).json({
        status: 'error',
        message: `Outlet masih memiliki ${activeOrders[0].count} pesanan aktif. Selesaikan semua pesanan terlebih dahulu.`
      });
    }

    // BUG-15 FIX: Soft delete instead of hard delete to prevent broken foreign keys
    const updated = await db.$queryRawUnsafe<any[]>(
      `UPDATE outlets SET is_active = false WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      outletId, tenantId
    );

    if (updated.length === 0) return res.status(404).json({ status: 'error', message: 'Outlet tidak ditemukan.' });

    res.json({ status: 'success', message: 'Outlet berhasil dinonaktifkan.' });
  } catch (err: any) {
    console.error('[DeleteOutlet Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus outlet.' });
  }
};
