import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';

// ── PRODUCT CATEGORIES ──────────────────────────────────────────

export const getProductCategories = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const categories = await db.product_categories.findMany({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: { nama: 'asc' },
      include: { _count: { select: { products: { where: { is_active: true } } } } },
    });

    res.json({ status: 'success', data: categories });
  } catch (err) {
    console.error('[getProductCategories]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memuat kategori produk.' });
  }
};

export const addProductCategory = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const { nama, deskripsi } = req.body;
    if (!nama?.trim()) return res.status(400).json({ status: 'error', message: 'Nama kategori wajib diisi.' });

    const category = await db.product_categories.create({
      data: { tenant_id: tenantId, nama: nama.trim(), deskripsi: deskripsi?.trim() || null },
    });

    res.status(201).json({ status: 'success', message: 'Kategori berhasil ditambahkan.', data: category });
  } catch (err) {
    console.error('[addProductCategory]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menambahkan kategori.' });
  }
};

export const deleteProductCategory = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const id = parseInt(req.body.id || req.query.id as string);
    if (!id) return res.status(400).json({ status: 'error', message: 'ID kategori wajib.' });

    // Tenant boundary check
    const cat = await db.product_categories.findFirst({ where: { id, tenant_id: tenantId } });
    if (!cat) return res.status(404).json({ status: 'error', message: 'Kategori tidak ditemukan.' });

    // Soft delete
    await db.product_categories.update({ where: { id }, data: { is_active: false } });

    res.json({ status: 'success', message: 'Kategori berhasil dihapus.' });
  } catch (err) {
    console.error('[deleteProductCategory]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus kategori.' });
  }
};

// ── PRODUCTS ─────────────────────────────────────────────────────

export const getProducts = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const products = await db.products.findMany({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: { nama: 'asc' },
      include: { category: { select: { id: true, nama: true } } },
    });

    res.json({ status: 'success', data: products });
  } catch (err) {
    console.error('[getProducts]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memuat produk.' });
  }
};

export const addProduct = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const { nama, harga, satuan, stok, lacak_stok, deskripsi, category_id } = req.body;

    if (!nama?.trim()) return res.status(400).json({ status: 'error', message: 'Nama produk wajib diisi.' });
    if (!harga || Number(harga) <= 0) return res.status(400).json({ status: 'error', message: 'Harga harus lebih dari 0.' });

    // Validate category belongs to tenant if provided
    if (category_id) {
      const cat = await db.product_categories.findFirst({ where: { id: parseInt(category_id), tenant_id: tenantId, is_active: true } });
      if (!cat) return res.status(400).json({ status: 'error', message: 'Kategori tidak valid.' });
    }

    const product = await db.products.create({
      data: {
        tenant_id: tenantId,
        nama: nama.trim(),
        harga: Number(harga),
        satuan: satuan?.trim() || 'pcs',
        stok: parseInt(stok || '0'),
        lacak_stok: lacak_stok === true || lacak_stok === 'true',
        deskripsi: deskripsi?.trim() || null,
        category_id: category_id ? parseInt(category_id) : null,
      },
      include: { category: { select: { id: true, nama: true } } },
    });

    res.status(201).json({ status: 'success', message: 'Produk berhasil ditambahkan.', data: product });
  } catch (err) {
    console.error('[addProduct]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menambahkan produk.' });
  }
};

export const updateProduct = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const { id, nama, harga, satuan, stok, lacak_stok, deskripsi, category_id } = req.body;
    if (!id) return res.status(400).json({ status: 'error', message: 'ID produk wajib.' });

    // Tenant boundary check
    const existing = await db.products.findFirst({ where: { id: parseInt(id), tenant_id: tenantId } });
    if (!existing) return res.status(404).json({ status: 'error', message: 'Produk tidak ditemukan.' });

    // Validate category if changed
    if (category_id) {
      const cat = await db.product_categories.findFirst({ where: { id: parseInt(category_id), tenant_id: tenantId, is_active: true } });
      if (!cat) return res.status(400).json({ status: 'error', message: 'Kategori tidak valid.' });
    }

    const updated = await db.products.update({
      where: { id: parseInt(id) },
      data: {
        ...(nama ? { nama: nama.trim() } : {}),
        ...(harga !== undefined ? { harga: Number(harga) } : {}),
        ...(satuan ? { satuan: satuan.trim() } : {}),
        ...(stok !== undefined ? { stok: parseInt(stok) } : {}),
        ...(lacak_stok !== undefined ? { lacak_stok: lacak_stok === true || lacak_stok === 'true' } : {}),
        ...(deskripsi !== undefined ? { deskripsi: deskripsi?.trim() || null } : {}),
        ...(category_id !== undefined ? { category_id: category_id ? parseInt(category_id) : null } : {}),
        updated_at: new Date(),
      },
      include: { category: { select: { id: true, nama: true } } },
    });

    res.json({ status: 'success', message: 'Produk berhasil diupdate.', data: updated });
  } catch (err) {
    console.error('[updateProduct]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengupdate produk.' });
  }
};

export const deleteProduct = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const id = parseInt(req.body.id || req.query.id as string);
    if (!id) return res.status(400).json({ status: 'error', message: 'ID produk wajib.' });

    // Tenant boundary check
    const prod = await db.products.findFirst({ where: { id, tenant_id: tenantId } });
    if (!prod) return res.status(404).json({ status: 'error', message: 'Produk tidak ditemukan.' });

    // Soft delete
    await db.products.update({ where: { id }, data: { is_active: false, updated_at: new Date() } });

    res.json({ status: 'success', message: 'Produk berhasil dihapus.' });
  } catch (err) {
    console.error('[deleteProduct]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus produk.' });
  }
};
