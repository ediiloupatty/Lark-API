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
    if (!userId) return res.status(401).json({ status: 'error', message: 'Token tidak valid' });

    const { nama, email, username, no_hp, alamat, password } = req.body;
    
    // Check if username exists
    const checkUser = await db.$queryRawUnsafe<any[]>(`SELECT id FROM users WHERE username = $1 AND id != $2`, username, userId);
    if (checkUser.length > 0) {
      return res.status(400).json({ status: 'error', message: 'Username sudah digunakan oleh akun lain.' });
    }

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.$queryRawUnsafe(`
        UPDATE users SET nama = $1, email = $2, username = $3, password = $4, no_hp = $5, alamat = $6 WHERE id = $7
      `, nama, email, username, hashedPassword, no_hp, alamat, userId);
    } else {
      await db.$queryRawUnsafe(`
        UPDATE users SET nama = $1, email = $2, username = $3, no_hp = $4, alamat = $5 WHERE id = $6
      `, nama, email, username, no_hp, alamat, userId);
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
    console.error('[UpdateProfile]', err);
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
    if ((new_password as string).length < 6) {
      return res.status(400).json({ status: 'error', message: 'Password baru minimal 6 karakter.' });
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
    await db.$queryRawUnsafe(`UPDATE users SET password = $1 WHERE id = $2`, hashed, userId);

    res.json({ status: 'success', message: 'Password berhasil diubah.' });
  } catch (err: any) {
    console.error('[ChangePassword Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengubah password.' });
  }
};

