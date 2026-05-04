import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';
import { computeSubscriptionStatus } from '../middlewares/subscriptionGuard';

// --- SETTINGS (Umum & Nota) ---
export const getSettings = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    const settings = await db.tenant_settings.findMany({
      where: { tenant_id: tenantId as number }
    });
    
    const settingsMap = settings.reduce((acc, curr) => {
      acc[curr.setting_key] = curr.setting_value;
      return acc;
    }, {} as any);

    // Include tenant timezone in settings response
    const tenant = await db.tenants.findUnique({
      where: { id: tenantId as number },
      select: { timezone: true }
    });
    settingsMap.timezone = tenant?.timezone || 'Asia/Makassar';

    res.json({ status: 'success', data: settingsMap });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Gagal memuat pengaturan' });
  }
};

export const updateSettings = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    // [SECURITY FIX] P1: Role check — hanya admin/owner yang boleh ubah pengaturan toko
    // Karyawan TIDAK boleh mengubah setting (WhatsApp config, nota, jam operasional, dll)
    // karena ini berdampak langsung ke operasional bisnis seluruh tenant.
    const role = req.user?.role || '';
    if (role !== 'admin' && role !== 'super_admin' && role !== 'owner') {
      return res.status(403).json({ status: 'error', message: 'Akses ditolak. Hanya admin yang bisa mengubah pengaturan.' });
    }

    const updates = req.body;

    // Fix B-2: Whitelist key yang diizinkan — cegah injection key sembarang
    const ALLOWED_SETTING_KEYS = new Set([
      'toko_info', 'nota_info', 'whatsapp_config', 'reminder_config',
      'jam_operasional', 'global_staff_permissions', 'printer_config',
    ]);

    let updatedCount = 0;

    // Handle timezone separately — stored on tenants table, not tenant_settings
    if (updates.timezone) {
      const VALID_TZ = ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'];
      if (VALID_TZ.includes(updates.timezone)) {
        await db.tenants.update({
          where: { id: tenantId },
          data: { timezone: updates.timezone }
        });
        updatedCount++;
      }
    }

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'timezone') continue; // Already handled above
      if (!ALLOWED_SETTING_KEYS.has(key)) continue;
      await db.tenant_settings.upsert({
        where: { tenant_id_setting_key: { tenant_id: tenantId, setting_key: key } },
        update: { setting_value: value as any, updated_at: new Date() },
        create: { tenant_id: tenantId, setting_key: key, setting_value: value as any }
      });
      updatedCount++;
    }

    res.json({ status: 'success', message: `Pengaturan berhasil disimpan! (${updatedCount} item diperbarui)` });
  } catch (err: any) {
    console.error('[UpdateSettings Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menyimpan pengaturan' });
  }
};

// --- SUBSCRIPTIONS ---
export const getSubscriptions = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    
    const tenant = await db.tenants.findUnique({
      where: { id: tenantId as number },
      select: { subscription_plan: true, subscription_until: true }
    });
    
    const packages = await db.subscription_packages.findMany({
      where: { is_active: true }
    });

    const planNameMap: Record<string, string> = {
      'free': 'Paket Gratis',
      'basic': 'Paket Basic',
      'premium': 'Paket Premium'
    };

    // Hitung subscription status menggunakan shared logic
    const subStatus = computeSubscriptionStatus(tenant?.subscription_until ?? null);
    
    let untilString = '-';
    if (tenant?.subscription_until) {
       const dateObj = new Date(tenant.subscription_until);
       untilString = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    } else {
       if (tenant?.subscription_plan === 'free') {
           untilString = 'Selamanya (Akses Dasar)'; 
       }
    }

    res.json({ 
      status: 'success', 
      data: {
        current: {
           plan_code: tenant?.subscription_plan || 'free',
           plan_name: planNameMap[tenant?.subscription_plan || 'free'] || 'Paket Aktif',
           is_expired: subStatus.status === 'expired',
           until: untilString,
           // Field baru — enriched subscription data
           subscription_status: subStatus.status,
           days_left: subStatus.daysLeft,
           can_create_order: subStatus.canCreateOrder,
           grace_until: subStatus.graceUntil
             ? subStatus.graceUntil.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
             : null,
        },
        packages: packages.map(p => ({ ...p, harga: Number(p.harga) }))
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Gagal memuat billing' });
  }
};

