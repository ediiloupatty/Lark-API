import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';
import bcrypt from 'bcrypt';

// GET /api/v1/sync/staff
export const getStaff = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    if (role !== 'admin' && role !== 'super_admin' && role !== 'owner') {
      return res.status(403).json({ status: 'error', message: 'Akses ditolak.' });
    }

    const search = (req.query.search as string) || '';
    
    let query = `
      SELECT u.id, u.username, u.nama, u.role, u.is_active, u.created_at, u.outlet_id, ot.nama as outlet_nama,
             u.no_hp, u.alamat, u.permissions
      FROM users u
      LEFT JOIN outlets ot ON u.outlet_id = ot.id
      WHERE u.tenant_id = $1 AND u.role::text IN ('admin', 'karyawan')
        AND u.deleted_at IS NULL
    `;
    const params: any[] = [tenantId];

    if (search.trim() !== '') {
      query += ` AND (u.username ILIKE $2 OR u.nama ILIKE $3)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY u.created_at DESC`;
    const users = await db.$queryRawUnsafe<any[]>(query, ...params);

    const formatted = users.map(u => {
      let perms = {};
      try {
        perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions) : (u.permissions || {});
      } catch(e) {}
      
      return {
        ...u,
        is_active: Boolean(u.is_active),
        permissions: perms,
        staff_code: u.username // Alias for mobile app expecting staff_code
      };
    });

    res.json({ status: 'success', data: formatted });
  } catch (err: any) {
    console.error('[GetStaff Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil data karyawan.' });
  }
};

// POST /api/v1/sync/add-staff
export const addStaff = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const roleAdmin = req.user?.role || '';
    if (roleAdmin !== 'admin' && roleAdmin !== 'super_admin' && roleAdmin !== 'owner') {
      return res.status(403).json({ status: 'error', message: 'Akses ditolak.' });
    }

    const { staff_code, username, nama, no_hp, alamat, outlet_id } = req.body;
    
    // Support incoming username or staff_code
    const finalUsername = (staff_code || username || '').trim();

    if (!finalUsername || !nama) {
      return res.status(400).json({ status: 'error', message: 'ID Akses dan Nama Lengkap wajib diisi.' });
    }

    const exist = await db.$queryRawUnsafe<any[]>(
      // Fix B-4: Scope to tenant — username hanya unik per tenant
      `SELECT id FROM users WHERE username = $1 AND tenant_id = $2`, finalUsername, tenantId
    );
    if (exist.length > 0) return res.status(400).json({ status: 'error', message: `Gagal! ID Akses '${finalUsername}' sudah digunakan.` });

    // In PHP, password default is hash of staff_code
    let passwordPlain = req.body.password;
    if (!passwordPlain || passwordPlain.trim() === '') {
      passwordPlain = finalUsername;
    }
    const hashedPassword = await bcrypt.hash(passwordPlain, 10);
    
    let finalOutletId = outlet_id ? parseInt(outlet_id) : null;
    if (finalOutletId) {
      // [SECURITY FIX] Cross-Tenant Outlet IDOR
      const verifyOutlet = await db.outlets.findFirst({ where: { id: finalOutletId, tenant_id: tenantId } });
      if (!verifyOutlet) return res.status(403).json({ status: 'error', message: 'Outlet tidak valid atau tidak dimiliki tenant ini.' });
    }

    const inserted = await db.$queryRawUnsafe<any[]>(
      `INSERT INTO users (tenant_id, username, password, nama, no_hp, alamat, role, outlet_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true) RETURNING id`,
      tenantId, finalUsername, hashedPassword, nama, no_hp || '', alamat || '', 'karyawan', finalOutletId
    );

    res.status(201).json({ status: 'success', message: 'Berhasil mendaftarkan kasir baru.', data: { id: inserted[0].id } });
  } catch (err: any) {
    console.error('[AddStaff Error]', err);
    res.status(500).json({ status: 'error', message: 'Terjadi kesalahan saat menambah staf.' });
  }
};

// PUT /api/v1/sync/update-staff
export const updateStaff = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const roleAdmin = req.user?.role || '';
    if (roleAdmin !== 'admin' && roleAdmin !== 'super_admin' && roleAdmin !== 'owner') {
      return res.status(403).json({ status: 'error', message: 'Akses ditolak.' });
    }

    const { id, staff_code, username, nama, no_hp, alamat, outlet_id, password } = req.body;
    const finalUserId = parseInt(id || '0');
    const finalUsername = (staff_code || username || '').trim();

    if (finalUserId === 0 || !finalUsername || !nama) {
      return res.status(400).json({ status: 'error', message: 'ID Akses, Nama Lengkap, dan User ID wajib diisi.' });
    }

    // [SECURITY FIX] Scope uniqueness check to tenant
    const exist = await db.$queryRawUnsafe<any[]>(`SELECT id FROM users WHERE username = $1 AND id != $2 AND tenant_id = $3`, finalUsername, finalUserId, tenantId);
    if (exist.length > 0) return res.status(400).json({ status: 'error', message: `Gagal! ID Akses '${finalUsername}' sudah digunakan akun lain.` });

    let finalOutletId = outlet_id ? parseInt(outlet_id) : null;
    if (finalOutletId) {
      // [SECURITY FIX] Cross-Tenant Outlet IDOR
      const verifyOutlet = await db.outlets.findFirst({ where: { id: finalOutletId, tenant_id: tenantId } });
      if (!verifyOutlet) return res.status(403).json({ status: 'error', message: 'Outlet tidak valid atau tidak dimiliki tenant ini.' });
    }

    let query = `UPDATE users SET nama = $1, username = $2, no_hp = $3, alamat = $4, outlet_id = $5`;
    const params: any[] = [nama, finalUsername, no_hp || '', alamat || '', finalOutletId];
    let idx = 6;

    if (password && password.trim() !== '') {
       const hashedPassword = await bcrypt.hash(password.trim(), 10);
       query += `, password = $${idx++}`;
       params.push(hashedPassword);
    }

    query += ` WHERE id = $${idx++} AND tenant_id = $${idx}`;
    params.push(finalUserId, tenantId);

    const updated = await db.$executeRawUnsafe(query, ...params);
    
    // Allow update to succeed even if 0 rows visually changed if it existed
    res.json({ status: 'success', message: 'Berhasil memperbarui data kasir.' });
  } catch (err: any) {
    console.error('[UpdateStaff Error]', err);
    res.status(500).json({ status: 'error', message: 'Terjadi kesalahan saat memperbarui staf.' });
  }
};

// DELETE /api/v1/sync/delete-staff
export const deleteStaff = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    // Fix B-10: Hanya admin/owner yang boleh hapus staff
    const role = req.user?.role || '';
    if (role !== 'admin' && role !== 'super_admin' && role !== 'owner') {
      return res.status(403).json({ status: 'error', message: 'Akses ditolak. Hanya admin yang bisa menghapus karyawan.' });
    }

    // Handle both req.body.user_id and req.query.user_id
    const idParam = req.query.user_id || req.body.user_id || req.query.id || req.body.id;
    const finalUserId = parseInt(idParam as string);

    if (!finalUserId) return res.status(400).json({ status: 'error', message: 'ID diperlukan.' });

    // Soft delete if possible, but old node logic used hard delete. 
    // Old PHP used UPDATE users SET deleted_at = CURRENT_TIMESTAMP
    await db.$queryRawUnsafe(`UPDATE users SET deleted_at = CURRENT_TIMESTAMP, is_active = false WHERE id = $1 AND tenant_id = $2`, finalUserId, tenantId);
    
    res.json({ status: 'success', message: 'Kasir berhasil dinonaktifkan/dihapus.' });
  } catch(err: any) {
    console.error('[DeleteStaff Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus kasir.' });
  }
};

// POST /api/v1/sync/toggle-staff-status
export const toggleStaffStatus = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const { id, is_active } = req.body;
    if (!id) return res.status(400).json({ status: 'error', message: 'ID diperlukan.' });

    await db.$queryRawUnsafe(
      `UPDATE users SET is_active = $1 WHERE id = $2 AND tenant_id = $3`,
      is_active ? true : false, parseInt(id), tenantId
    );
    res.json({ status: 'success', message: 'Status karyawan berhasil diupdate.' });
  } catch(err: any) {
    res.status(500).json({ status: 'error', message: 'Gagal update status.' });
  }
};

// GET /api/v1/sync/global-permissions
export const getGlobalPermissions = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const rows = await db.$queryRawUnsafe<any[]>(
      `SELECT setting_value FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'global_staff_permissions'`,
      tenantId
    );

    let perms = { manage_orders: false, confirm_payments: false, view_reports: false, manage_expenses: false };
    if (rows.length > 0 && rows[0].setting_value) {
      try {
        const parsed = typeof rows[0].setting_value === 'string' ? JSON.parse(rows[0].setting_value) : rows[0].setting_value;
        perms = { ...perms, ...parsed };
      } catch (e) {}
    }

    res.json({ status: 'success', message: 'Data berhasil diambil.', data: { permissions: perms } });
  } catch (err: any) {
    console.error('[GetGlobalPermissions Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil hak akses global.' });
  }
};

// POST /api/v1/sync/global-permissions
export const updateGlobalPermissions = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    if (role !== 'admin' && role !== 'super_admin' && role !== 'owner') {
      return res.status(403).json({ status: 'error', message: 'Akses ditolak.' });
    }

    let perms = req.body.permissions;
    if (!perms) return res.status(400).json({ status: 'error', message: 'Permissions wajib diisi.' });

    const defaultPerms = { manage_orders: false, confirm_payments: false, view_reports: false, manage_expenses: false };
    perms = { ...defaultPerms, ...perms };

    // Update or Insert into tenant_settings
    const exist = await db.$queryRawUnsafe<any[]>(
      `SELECT id FROM tenant_settings WHERE tenant_id = $1 AND setting_key = 'global_staff_permissions'`,
      tenantId
    );

    if (exist.length > 0) {
      await db.$queryRawUnsafe(
        `UPDATE tenant_settings SET setting_value = $1, updated_at = NOW() WHERE id = $2`,
        JSON.stringify(perms), exist[0].id
      );
    } else {
      await db.$queryRawUnsafe(
        `INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, updated_at) VALUES ($1, 'global_staff_permissions', $2, NOW())`,
        tenantId, JSON.stringify(perms)
      );
    }

    // Attempt to update all users
    try {
      await db.$queryRawUnsafe(
        `UPDATE users SET permissions = $1 WHERE tenant_id = $2 AND role = 'karyawan'`,
        JSON.stringify(perms), tenantId
      );
    } catch(e) {}

    res.json({ status: 'success', message: 'Hak akses global berhasil diperbarui.', data: { permissions: perms } });
  } catch (err: any) {
    console.error('[UpdateGlobalPermissions Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memperbarui hak akses global.' });
  }
};

// PUT /api/v1/sync/update-permissions
export const updateStaffPermissions = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    if (role !== 'admin' && role !== 'super_admin' && role !== 'owner') {
      return res.status(403).json({ status: 'error', message: 'Akses ditolak.' });
    }

    const { staff_id, permissions } = req.body;
    if (!staff_id || !permissions) return res.status(400).json({ status: 'error', message: 'ID Staf dan permissions wajib diisi.' });

    const defaultPerms = { manage_orders: false, confirm_payments: false, view_reports: false, manage_expenses: false };
    const perms = { ...defaultPerms, ...permissions };

    await db.$queryRawUnsafe(
      `UPDATE users SET permissions = $1 WHERE id = $2 AND tenant_id = $3`,
      JSON.stringify(perms), parseInt(staff_id), tenantId
    );

    res.json({ status: 'success', message: 'Hak akses kasir berhasil diperbarui.', data: { permissions: perms } });
  } catch (err: any) {
    console.error('[UpdateStaffPermissions Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memperbarui hak akses kasir.' });
  }
};
