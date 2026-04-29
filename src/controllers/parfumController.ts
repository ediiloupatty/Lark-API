import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';

// ── GET ALL PARFUMS ─────────────────────────────────────────────

export const getParfums = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const parfums = await db.parfums.findMany({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: [{ is_default: 'desc' }, { nama: 'asc' }],
    });

    res.json({ status: 'success', data: parfums });
  } catch (err) {
    console.error('[getParfums]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memuat daftar parfum.' });
  }
};

// ── ADD PARFUM ──────────────────────────────────────────────────

export const addParfum = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const { nama, emoji, harga_tambahan, is_default, deskripsi } = req.body;

    if (!nama?.trim()) return res.status(400).json({ status: 'error', message: 'Nama parfum wajib diisi.' });

    // Jika parfum baru di-set sebagai default, unset semua default lama
    if (is_default === true || is_default === 'true') {
      await db.parfums.updateMany({
        where: { tenant_id: tenantId, is_default: true },
        data: { is_default: false },
      });
    }

    const parfum = await db.parfums.create({
      data: {
        tenant_id: tenantId,
        nama: nama.trim(),
        emoji: emoji?.trim() || '🧴',
        harga_tambahan: Number(harga_tambahan || 0),
        is_default: is_default === true || is_default === 'true',
        deskripsi: deskripsi?.trim() || null,
      },
    });

    res.status(201).json({ status: 'success', message: 'Parfum berhasil ditambahkan.', data: parfum });
  } catch (err) {
    console.error('[addParfum]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menambahkan parfum.' });
  }
};

// ── UPDATE PARFUM ───────────────────────────────────────────────

export const updateParfum = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const { id, nama, emoji, harga_tambahan, is_default, is_active, deskripsi } = req.body;
    if (!id) return res.status(400).json({ status: 'error', message: 'ID parfum wajib.' });

    // Tenant boundary check
    const existing = await db.parfums.findFirst({ where: { id: parseInt(id), tenant_id: tenantId } });
    if (!existing) return res.status(404).json({ status: 'error', message: 'Parfum tidak ditemukan.' });

    // Jika di-set sebagai default, unset semua default lama terlebih dahulu
    if (is_default === true || is_default === 'true') {
      await db.parfums.updateMany({
        where: { tenant_id: tenantId, is_default: true, id: { not: parseInt(id) } },
        data: { is_default: false },
      });
    }

    const updated = await db.parfums.update({
      where: { id: parseInt(id) },
      data: {
        ...(nama ? { nama: nama.trim() } : {}),
        ...(emoji !== undefined ? { emoji: emoji?.trim() || '🧴' } : {}),
        ...(harga_tambahan !== undefined ? { harga_tambahan: Number(harga_tambahan) } : {}),
        ...(is_default !== undefined ? { is_default: is_default === true || is_default === 'true' } : {}),
        ...(is_active !== undefined ? { is_active: is_active === true || is_active === 'true' } : {}),
        ...(deskripsi !== undefined ? { deskripsi: deskripsi?.trim() || null } : {}),
      },
    });

    res.json({ status: 'success', message: 'Parfum berhasil diupdate.', data: updated });
  } catch (err) {
    console.error('[updateParfum]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengupdate parfum.' });
  }
};

// ── DELETE PARFUM (soft delete) ─────────────────────────────────

export const deleteParfum = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const id = parseInt(req.body.id || req.query.id as string);
    if (!id) return res.status(400).json({ status: 'error', message: 'ID parfum wajib.' });

    // Tenant boundary check
    const parfum = await db.parfums.findFirst({ where: { id, tenant_id: tenantId } });
    if (!parfum) return res.status(404).json({ status: 'error', message: 'Parfum tidak ditemukan.' });

    // Soft delete — tetap bisa direferensikan oleh order lama
    await db.parfums.update({ where: { id }, data: { is_active: false } });

    res.json({ status: 'success', message: 'Parfum berhasil dihapus.' });
  } catch (err) {
    console.error('[deleteParfum]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus parfum.' });
  }
};
