import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';

// GET /api/v1/sync/customers
export const getCustomers = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const search = req.query.search as string || '';
    
    let query = `
      SELECT id, client_id, server_version as version, nama, no_hp, alamat, email, created_at
      FROM customers
      WHERE tenant_id = $1 AND deleted_at IS NULL AND nama != 'Pelanggan Walk-in'
    `;
    const params: any[] = [tenantId];

    if (search.trim() !== '') {
      query += ` AND (nama ILIKE $2 OR no_hp ILIKE $3)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY nama ASC LIMIT 100`;

    const customers = await db.$queryRawUnsafe<any[]>(query, ...params);

    // Konversi BigInt properties ke String/Number agar bisa di-JSON-kan
    const formattedCustomers = customers.map((c: any) => ({
      ...c,
      version: c.version ? c.version.toString() : null
    }));

    res.json({
      status: 'success',
      data: formattedCustomers
    });
  } catch (err: any) {
    console.error('[GetCustomers Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil pelanggan.' });
  }
};

// POST /api/v1/sync/add-customer
export const addCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const { nama, no_hp, alamat, email, client_id } = req.body;

    if (!nama) return res.status(400).json({ status: 'error', message: 'Nama pelanggan wajib diisi.' });

    // Cek duplikasi no hp
    if (no_hp) {
      const existing = await db.$queryRawUnsafe<any[]>(
        `SELECT id FROM customers WHERE tenant_id = $1 AND no_hp = $2 AND deleted_at IS NULL`,
        tenantId, no_hp
      );
      if (existing.length > 0) {
        return res.status(400).json({ status: 'error', message: 'Nomor HP sudah terdaftar.' });
      }
    }

    const inserted = await db.$queryRawUnsafe<any[]>(
      `INSERT INTO customers (tenant_id, nama, no_hp, alamat, email, client_id, server_version)
       VALUES ($1, $2, $3, $4, $5, $6, CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT))
       RETURNING id, client_id, nama, no_hp, alamat, email, server_version`,
      tenantId, nama, no_hp || null, alamat || null, email || null, client_id || null
    );

    const dataResult = inserted[0];
    if (dataResult && dataResult.server_version) {
      dataResult.server_version = dataResult.server_version.toString();
    }

    res.status(201).json({
      status: 'success',
      message: 'Pelanggan berhasil ditambahkan.',
      data: dataResult
    });
  } catch (err: any) {
    console.error('[AddCustomer Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menambah pelanggan.' });
  }
};

// PUT /api/v1/sync/update-customer
export const updateCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const { id, nama, no_hp, alamat, email, client_id } = req.body;

    if (!id && !client_id) return res.status(400).json({ status: 'error', message: 'ID pelanggan diperlukan.' });

    // Pengecekan constraint unik untuk no_hp jika diubah
    if (no_hp) {
      const existing = await db.$queryRawUnsafe<any[]>(
        `SELECT id FROM customers WHERE tenant_id = $1 AND no_hp = $2 AND deleted_at IS NULL AND id != $3 AND (client_id != $4 OR client_id IS NULL)`,
        tenantId, no_hp, id || -1, client_id || 'UNKNOWN'
      );
      if (existing.length > 0) {
        return res.status(400).json({ status: 'error', message: 'Nomor HP sudah digunakan pelanggan lain.' });
      }
    }

    const updated = await db.$queryRawUnsafe<any[]>(
      `UPDATE customers SET 
        nama = COALESCE($1, nama), 
        no_hp = $2, 
        alamat = $3, 
        email = $4,
        server_version = CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT)
       WHERE tenant_id = $5 AND (id = $6 OR client_id = $7)
       RETURNING id, client_id, nama, no_hp, alamat, email, server_version`,
      nama, no_hp || null, alamat || null, email || null, tenantId, id || -1, client_id || 'UNKNOWN'
    );

    if (updated.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Pelanggan tidak ditemukan.' });
    }

    const dataResult = updated[0];
    if (dataResult && dataResult.server_version) {
      dataResult.server_version = dataResult.server_version.toString();
    }

    res.json({
      status: 'success',
      message: 'Data pelanggan diperbarui.',
      data: dataResult
    });
  } catch (err: any) {
    console.error('[UpdateCustomer Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengubah pelanggan.' });
  }
};

// POST /api/v1/sync/delete-customer
export const deleteCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    // H-1: Hanya admin/owner yang boleh hapus pelanggan.
    // Karyawan tidak boleh menghapus data pelanggan untuk mencegah penyalahgunaan.
    const role = req.user?.role || '';
    if (role !== 'admin' && role !== 'super_admin' && role !== 'owner') {
      return res.status(403).json({ status: 'error', message: 'Akses ditolak. Hanya admin yang bisa menghapus pelanggan.' });
    }

    const { id, client_id } = req.body;

    // Soft delete
    const deleted = await db.$queryRawUnsafe<any[]>(
      `UPDATE customers SET deleted_at = NOW(), server_version = CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT)
       WHERE tenant_id = $1 AND (id = $2 OR client_id = $3)
       RETURNING id`,
      tenantId, id || -1, client_id || 'UNKNOWN'
    );

    if (deleted.length === 0) {
       return res.status(404).json({ status: 'error', message: 'Pelanggan tidak ditemukan.' });
    }

    res.json({
      status: 'success',
      message: 'Pelanggan berhasil dihapus.'
    });
  } catch (err: any) {
    console.error('[DeleteCustomer Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus pelanggan.' });
  }
};
