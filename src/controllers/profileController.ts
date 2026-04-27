import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';
import bcrypt from 'bcrypt';

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ status: 'error', message: 'Token tidak valid' });

    const profileRes = await db.$queryRawUnsafe<any[]>(`
      SELECT u.username, u.nama, u.email, u.role, u.no_hp, u.alamat,
             t.name as tenant_name, t.address as tenant_alamat, t.phone as tenant_no_hp
      FROM users u 
      LEFT JOIN tenants t ON u.tenant_id = t.id 
      WHERE u.id = $1
    `, userId);

    if (profileRes.length > 0) {
      const p = profileRes[0];
      const roleMap: any = { super_admin: 'Owner', admin: 'Admin', owner: 'Owner', karyawan: 'Staff' };
      const outRole = roleMap[p.role] || p.role;

      res.json({
        status: 'success',
        message: 'Profil berhasil diambil',
        data: {
          username: p.username,
          nama: p.nama,
          email: p.email,
          role: outRole,
          no_hp: p.no_hp,
          alamat: p.alamat,
          tenant: {
            nama: p.tenant_name || '',
            alamat: p.tenant_alamat || '',
            no_hp: p.tenant_no_hp || '',
          }
        }
      });
    } else {
      res.status(404).json({ status: 'error', message: 'Profil tidak ditemukan' });
    }
  } catch (err) {
    console.error('[GetProfile]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil profil' });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const tenantId = req.user?.tenant_id;
    if (!userId) return res.status(401).json({ status: 'error', message: 'Token tidak valid' });

    const { nama, email, username, no_hp, alamat, password } = req.body;

    // H-1: Validasi input wajib — cegah update dengan data kosong
    if (!nama || !username) {
      return res.status(400).json({ status: 'error', message: 'Nama dan username wajib diisi.' });
    }

    // H-2: Validasi password minimum jika diubah
    if (password && (password as string).length < 8) {
      return res.status(400).json({ status: 'error', message: 'Password minimal 8 karakter.' });
    }

    // [SECURITY FIX] P1: Scope username uniqueness ke tenant_id
    // Sebelumnya: global check → user Tenant A gagal pakai username milik Tenant B
    // Sesudah: hanya cek dalam tenant yang sama (username hanya unik per tenant)
    const checkUser = await db.$queryRawUnsafe<any[]>(
      `SELECT id FROM users WHERE username = $1 AND id != $2 AND tenant_id = $3`,
      username, userId, tenantId
    );
    if (checkUser.length > 0) {
      return res.status(400).json({ status: 'error', message: 'Username sudah digunakan oleh akun lain.' });
    }

    // [SECURITY FIX] Tambah tenant_id di WHERE clause untuk defense-in-depth
    // Mencegah user memodifikasi data jika JWT-nya di-tamper
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      // BUG-19 FIX: Bump token_version to invalidate old tokens when password changes
      await db.$queryRawUnsafe(`
        UPDATE users SET nama = $1, email = $2, username = $3, password = $4, no_hp = $5, alamat = $6,
               token_version = COALESCE(token_version, 0) + 1
        WHERE id = $7 AND tenant_id = $8
      `, nama, email, username, hashedPassword, no_hp || '', alamat || '', userId, tenantId);
    } else {
      await db.$queryRawUnsafe(`
        UPDATE users SET nama = $1, email = $2, username = $3, no_hp = $4, alamat = $5
        WHERE id = $6 AND tenant_id = $7
      `, nama, email, username, no_hp || '', alamat || '', userId, tenantId);
    }

    // ── Update tenant-level fields (nama_toko, alamat, no_hp) ──
    // Hanya admin/owner yang boleh ubah nama tenant — karyawan tidak akan sampai sini
    // karena frontend hanya mengirim nama_toko dari SettingsTab (admin-only page)
    const { nama_toko } = req.body;
    if (nama_toko && tenantId) {
      const role = req.user?.role || '';
      const isAdmin = ['admin', 'super_admin', 'owner'].includes(role);
      if (isAdmin) {
        await db.$queryRawUnsafe(`
          UPDATE tenants SET name = $1, phone = COALESCE(NULLIF($2, ''), phone), address = COALESCE(NULLIF($3, ''), address)
          WHERE id = $4
        `, nama_toko, no_hp || '', alamat || '', tenantId);
      }
    }

    // Return updated
    const profileRes = await db.$queryRawUnsafe<any[]>(`
      SELECT u.username, u.nama, u.email, u.role, u.no_hp, u.alamat,
             t.name as tenant_name, t.address as tenant_alamat, t.phone as tenant_no_hp
      FROM users u 
      LEFT JOIN tenants t ON u.tenant_id = t.id 
      WHERE u.id = $1
    `, userId);

    const p = profileRes[0];
    const roleMap: any = { super_admin: 'Owner', admin: 'Admin', owner: 'Owner', karyawan: 'Staff' };
    
    res.json({ 
      status: 'success', 
      message: 'Profil berhasil diperbarui',
      data: {
        username: p.username,
        nama: p.nama,
        email: p.email,
        role: roleMap[p.role] || p.role,
        no_hp: p.no_hp,
        alamat: p.alamat,
        tenant: {
          nama: p.tenant_name || '',
          alamat: p.tenant_alamat || '',
          no_hp: p.tenant_no_hp || '',
        }
      }
    });

  } catch (err) {
    // Log body tanpa field sensitif untuk memudahkan debugging 500 error
    const { password, ...safeBody } = req.body || {};
    console.error('[UpdateProfile]', err, '| body:', JSON.stringify(safeBody));
    res.status(500).json({ status: 'error', message: 'Gagal update profil' });
  }
};

// POST /api/v1/sync/change-password
export const changePassword = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ status: 'error', message: 'Token tidak valid.' });

    const { old_password, new_password } = req.body;

    if (!old_password || !new_password) {
      return res.status(400).json({ status: 'error', message: 'Password lama dan password baru wajib diisi.' });
    }
    // L-3: Standardized — minimal 8 karakter (konsisten dengan register dan reset password)
    if ((new_password as string).length < 8) {
      return res.status(400).json({ status: 'error', message: 'Password baru minimal 8 karakter.' });
    }

    // Fetch current hashed password
    const rows = await db.$queryRawUnsafe<any[]>(`SELECT password FROM users WHERE id = $1`, userId);
    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Pengguna tidak ditemukan.' });
    }

    const isMatch = await bcrypt.compare(old_password, rows[0].password);
    if (!isMatch) {
      return res.status(400).json({ status: 'error', message: 'Password lama tidak sesuai.' });
    }

    const hashed = await bcrypt.hash(new_password, 10);
    await db.$queryRawUnsafe(`UPDATE users SET password = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2`, hashed, userId);

    res.json({ status: 'success', message: 'Password berhasil diubah. Semua sesi aktif akan di-logout.' });
  } catch (err: any) {
    console.error('[ChangePassword Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengubah password.' });
  }
};

