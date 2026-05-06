import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';
import bcrypt from 'bcrypt';

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    if (!userId) return res.status(401).json({ status: 'error', message: 'Token tidak valid' });

    const profileRes = await db.$queryRawUnsafe<any[]>(`
      SELECT u.username, u.nama, u.email, u.role, u.no_hp, u.alamat, u.tenant_id,
             t.name as tenant_name, t.address as tenant_alamat, t.phone as tenant_no_hp
      FROM users u 
      LEFT JOIN tenants t ON u.tenant_id = t.id 
      WHERE u.id = $1
    `, userId);

    if (profileRes.length > 0) {
      const p = profileRes[0];
      const roleMap: any = { super_admin: 'Owner', admin: 'Admin', owner: 'Owner', karyawan: 'Staff' };
      const outRole = roleMap[p.role] || p.role;

      let needs_setup = false;
      if (p.tenant_id && outRole !== 'Staff') {
        const outletCount = await db.outlets.count({ where: { tenant_id: p.tenant_id } });
        needs_setup = outletCount === 0;
      }

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
          needs_setup,
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

        // Sinkronkan nama ke tenant_settings.toko_info agar nota/struk konsisten
        const existing = await db.tenant_settings.findFirst({
          where: { tenant_id: tenantId, setting_key: 'toko_info' }
        });
        if (existing) {
          const val = (existing.setting_value as any) || {};
          await db.tenant_settings.update({
            where: { id: existing.id },
            data: { setting_value: { ...val, nama: nama_toko } }
          });
        }
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

// POST /api/v1/sync/complete-setup
// Setup awal tenant (nama toko, alamat, telepon) + buat outlet pertama.
// Dipanggil dari welcome wizard mobile setelah Google sign-in atau register.
export const completeSetup = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const tenantId = req.user?.tenant_id;
    const role = req.user?.role || '';
    if (!userId || !tenantId) {
      return res.status(401).json({ status: 'error', message: 'Token tidak valid.' });
    }

    // Hanya admin/owner yang boleh setup tenant
    if (!['admin', 'owner', 'super_admin'].includes(role)) {
      return res.status(403).json({ status: 'error', message: 'Akses ditolak.' });
    }

    const { nama_toko, alamat_toko, telepon_toko, user_phone, user_alamat, outlet_nama, outlet_alamat, outlet_phone, outlet_jam_buka, outlet_jam_tutup } = req.body;

    // ── Validasi tenant ──
    if (!nama_toko || (nama_toko as string).trim().length < 2) {
      return res.status(400).json({ status: 'error', message: 'Nama toko wajib diisi (minimal 2 karakter).' });
    }
    if ((nama_toko as string).trim().length > 50) {
      return res.status(400).json({ status: 'error', message: 'Nama toko maksimal 50 karakter.' });
    }

    // ── Validasi outlet ──
    const outletName = (outlet_nama as string | undefined)?.trim();
    if (!outletName || outletName.length < 2) {
      return res.status(400).json({ status: 'error', message: 'Nama outlet/cabang wajib diisi (minimal 2 karakter).' });
    }

    const trimmedName = (nama_toko as string).trim();
    const trimmedAddress = alamat_toko?.trim() || 'Belum diatur';
    const trimmedPhone = telepon_toko?.trim() || 'Belum diatur';

    // Jalankan semua operasi dalam satu transaksi agar atomik
    const outletId = await db.$transaction(async (tx) => {
      // 1. Update tenants table
      await tx.tenants.update({
        where: { id: tenantId },
        data: {
          name: trimmedName,
          address: trimmedAddress,
          phone: trimmedPhone,
        }
      });

      // 2. Sinkronkan ke tenant_settings.toko_info
      await tx.tenant_settings.upsert({
        where: { tenant_id_setting_key: { tenant_id: tenantId, setting_key: 'toko_info' } },
        update: {
          setting_value: {
            nama: trimmedName,
            alamat: trimmedAddress,
            telepon: trimmedPhone,
            email: (req.user as any)?.email || 'Belum diatur',
          },
          updated_at: new Date(),
        },
        create: {
          tenant_id: tenantId,
          setting_key: 'toko_info',
          setting_value: {
            nama: trimmedName,
            alamat: trimmedAddress,
            telepon: trimmedPhone,
            email: (req.user as any)?.email || 'Belum diatur',
          },
        }
      });

      // 3. Buat outlet pertama (hanya jika belum ada outlet)
      const existingOutletCount = await tx.outlets.count({ where: { tenant_id: tenantId } });
      let newOutletId: number | null = null;

      if (existingOutletCount === 0) {
        const inserted = await tx.$queryRawUnsafe<any[]>(
          `INSERT INTO outlets (tenant_id, nama, alamat, phone, jam_buka, jam_tutup)
           VALUES ($1, $2, $3, $4, $5::time, $6::time) RETURNING id`,
          tenantId,
          outletName,
          outlet_alamat?.trim() || trimmedAddress,
          outlet_phone?.trim() || trimmedPhone,
          outlet_jam_buka || '08:00',
          outlet_jam_tutup || '20:00'
        );
        newOutletId = inserted[0]?.id ?? null;

        // 4. Assign owner ke outlet baru + update profil pribadi
        if (newOutletId) {
          await tx.users.update({
            where: { id: userId },
            data: {
              outlet_id: newOutletId,
              no_hp: user_phone?.trim() || undefined,
              alamat: user_alamat?.trim() || undefined,
            }
          });
        }
      } else {
        // Outlet sudah ada, tetap update profil pribadi user
        await tx.users.update({
          where: { id: userId },
          data: {
            no_hp: user_phone?.trim() || undefined,
            alamat: user_alamat?.trim() || undefined,
          }
        });
      }

      return newOutletId;
    });

    res.json({
      status: 'success',
      message: 'Setup toko dan outlet berhasil! Selamat datang di Lark.',
      data: {
        nama_toko: trimmedName,
        outlet_id: outletId,
        // Flag agar mobile app tahu perlu re-login untuk refresh JWT dengan outlet_id baru
        needs_relogin: outletId != null,
      }
    });
  } catch (err: any) {
    console.error('[CompleteSetup Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menyimpan data toko.' });
  }
};

// ── Template Definitions ──────────────────────────────────────────
// Hardcoded preset templates for wizard Step 2. Each template defines
// services (per-kg pricing) and packages (duration-based surcharge).
const TEMPLATES: Record<string, {
  label: string;
  services: { nama_layanan: string; harga_per_kg: number; deskripsi: string; durasi_hari: number }[];
  packages: { nama: string; durasi_jam: number; harga_tambahan: number }[];
}> = {
  standar: {
    label: 'Laundry Standar',
    services: [
      { nama_layanan: 'Cuci Biasa', harga_per_kg: 5000, deskripsi: 'Layanan cuci regular', durasi_hari: 3 },
      { nama_layanan: 'Cuci Setrika', harga_per_kg: 7000, deskripsi: 'Layanan cuci + setrika', durasi_hari: 3 },
      { nama_layanan: 'Setrika Saja', harga_per_kg: 4000, deskripsi: 'Layanan setrika saja', durasi_hari: 1 },
    ],
    packages: [
      { nama: 'Reguler', durasi_jam: 72, harga_tambahan: 0 },
      { nama: 'Express', durasi_jam: 24, harga_tambahan: 3000 },
      { nama: 'Kilat', durasi_jam: 6, harga_tambahan: 5000 },
    ],
  },
  hotel: {
    label: 'Laundry Hotel / Penginapan',
    services: [
      { nama_layanan: 'Cuci Sprei & Bed Cover', harga_per_kg: 8000, deskripsi: 'Cuci sprei, sarung bantal, bed cover', durasi_hari: 2 },
      { nama_layanan: 'Cuci Handuk', harga_per_kg: 6000, deskripsi: 'Cuci handuk mandi & handuk kecil', durasi_hari: 1 },
      { nama_layanan: 'Cuci Selimut & Gordyn', harga_per_kg: 10000, deskripsi: 'Cuci selimut tebal, gordyn, karpet kecil', durasi_hari: 3 },
    ],
    packages: [
      { nama: 'Reguler', durasi_jam: 48, harga_tambahan: 0 },
      { nama: 'Express', durasi_jam: 12, harga_tambahan: 5000 },
      { nama: 'Kilat', durasi_jam: 4, harga_tambahan: 10000 },
    ],
  },
  premium: {
    label: 'Laundry Premium / Dry Clean',
    services: [
      { nama_layanan: 'Dry Clean', harga_per_kg: 15000, deskripsi: 'Layanan dry clean untuk pakaian formal', durasi_hari: 3 },
      { nama_layanan: 'Cuci Jas & Blazer', harga_per_kg: 20000, deskripsi: 'Cuci jas, blazer, setelan formal', durasi_hari: 3 },
      { nama_layanan: 'Cuci Gaun & Dress', harga_per_kg: 25000, deskripsi: 'Cuci gaun, dress, kebaya, batik premium', durasi_hari: 5 },
    ],
    packages: [
      { nama: 'Standar', durasi_jam: 72, harga_tambahan: 0 },
      { nama: 'Express', durasi_jam: 24, harga_tambahan: 10000 },
      { nama: 'Prioritas', durasi_jam: 8, harga_tambahan: 20000 },
    ],
  },
};

// POST /api/v1/sync/apply-template
// Replaces existing services & packages with a preset template.
// Called from wizard Step 2 when user selects a template.
export const applyTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    const role = req.user?.role || '';
    if (!tenantId) {
      return res.status(401).json({ status: 'error', message: 'Token tidak valid.' });
    }
    if (!['admin', 'owner', 'super_admin'].includes(role)) {
      return res.status(403).json({ status: 'error', message: 'Akses ditolak.' });
    }

    const { template_id } = req.body;
    if (!template_id || !TEMPLATES[template_id]) {
      return res.status(400).json({
        status: 'error',
        message: `Template tidak valid. Pilihan: ${Object.keys(TEMPLATES).join(', ')}`,
      });
    }

    const tpl = TEMPLATES[template_id];

    await db.$transaction(async (tx) => {
      // 1. Hapus semua services & packages lama (yang belum dipakai di order)
      await tx.services.deleteMany({ where: { tenant_id: tenantId } });
      await tx.paket_laundry.deleteMany({ where: { tenant_id: tenantId } });

      // 2. Insert template baru
      await tx.services.createMany({
        data: tpl.services.map((s) => ({ tenant_id: tenantId, ...s })),
      });
      await tx.paket_laundry.createMany({
        data: tpl.packages.map((p) => ({ tenant_id: tenantId, ...p })),
      });
    });

    res.json({
      status: 'success',
      message: `Template "${tpl.label}" berhasil diterapkan.`,
      data: { template_id, label: tpl.label },
    });
  } catch (err: any) {
    console.error('[ApplyTemplate Error]', err);
    // Jika gagal karena foreign key (services/packages sudah dipakai di order)
    if (err?.code === 'P2003') {
      return res.status(409).json({
        status: 'error',
        message: 'Tidak bisa mengganti template karena sudah ada pesanan yang menggunakan layanan saat ini.',
      });
    }
    res.status(500).json({ status: 'error', message: 'Gagal menerapkan template.' });
  }
};

// GET /api/v1/sync/templates
// Returns available templates for wizard Step 2.
export const getTemplates = async (_req: AuthRequest, res: Response) => {
  const result = Object.entries(TEMPLATES).map(([id, t]) => ({
    id,
    label: t.label,
    services: t.services.map((s) => ({ nama: s.nama_layanan, harga: s.harga_per_kg, deskripsi: s.deskripsi })),
    packages: t.packages.map((p) => ({ nama: p.nama, durasi_jam: p.durasi_jam, harga_tambahan: p.harga_tambahan })),
  }));
  res.json({ status: 'success', data: result });
};
