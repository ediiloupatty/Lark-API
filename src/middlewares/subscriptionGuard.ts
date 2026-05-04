import { Response, NextFunction } from 'express';
import { db } from '../config/db';
import { AuthRequest } from './authMiddleware';

/**
 * Subscription Guard Middleware
 *
 * Tujuan: Mencegah tenant dengan langganan expired melakukan operasi write tertentu.
 * Strategi: Soft Degradation — tenant tetap bisa login, lihat data, dan proses order lama.
 *
 * Status langganan:
 *   - 'active'  : subscription_until > now
 *   - 'grace'   : subscription_until <= now, tapi belum > 7 hari
 *   - 'expired' : subscription_until + 7 hari < now
 *
 * Diterapkan HANYA pada route write tertentu (create-order, add-staff, dll).
 * TIDAK diterapkan pada GET/read routes atau update-order-status.
 *
 * super_admin selalu bypass — mereka bukan tenant user.
 */

const GRACE_PERIOD_DAYS = 7;

// In-memory cache per tenant — invalidate setiap 60 detik
// Alasan: Menghindari query DB di setiap request. Cache pendek agar
// perubahan subscription (extend via Super Admin) terasa dalam 1 menit.
interface SubscriptionCache {
  status: 'active' | 'grace' | 'expired';
  daysLeft: number;
  subscriptionUntil: Date | null;
  cachedAt: number;
}
const cache = new Map<number, SubscriptionCache>();
const CACHE_TTL_MS = 60_000; // 60 detik

/**
 * Hitung status langganan dari subscription_until.
 */
export function computeSubscriptionStatus(subscriptionUntil: Date | null): {
  status: 'active' | 'grace' | 'expired';
  daysLeft: number;
  graceUntil: Date | null;
  canCreateOrder: boolean;
} {
  if (!subscriptionUntil) {
    // Tidak ada tanggal → anggap expired (seharusnya tidak terjadi)
    return { status: 'expired', daysLeft: -999, graceUntil: null, canCreateOrder: false };
  }

  const now = Date.now();
  const until = new Date(subscriptionUntil).getTime();
  const daysLeft = Math.ceil((until - now) / (24 * 60 * 60 * 1000));

  const graceEnd = new Date(until + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  if (daysLeft > 0) {
    // Masih dalam periode aktif
    return { status: 'active', daysLeft, graceUntil: null, canCreateOrder: true };
  }

  if (now < graceEnd.getTime()) {
    // Sudah lewat subscription_until, tapi masih dalam grace period
    const graceDaysLeft = Math.ceil((graceEnd.getTime() - now) / (24 * 60 * 60 * 1000));
    return { status: 'grace', daysLeft: graceDaysLeft, graceUntil: graceEnd, canCreateOrder: true };
  }

  // Sudah lewat grace period — expired
  return { status: 'expired', daysLeft, graceUntil: graceEnd, canCreateOrder: false };
}

/**
 * Ambil status subscription dengan cache.
 */
async function getSubscriptionStatus(tenantId: number): Promise<SubscriptionCache> {
  const cached = cache.get(tenantId);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    return cached;
  }

  const tenant = await db.tenants.findUnique({
    where: { id: tenantId },
    select: { subscription_until: true },
  });

  const result = computeSubscriptionStatus(tenant?.subscription_until ?? null);

  const entry: SubscriptionCache = {
    status: result.status,
    daysLeft: result.daysLeft,
    subscriptionUntil: tenant?.subscription_until ?? null,
    cachedAt: Date.now(),
  };
  cache.set(tenantId, entry);
  return entry;
}

/**
 * Middleware utama — terapkan di route yang perlu diblokir saat expired.
 */
export async function subscriptionGuard(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Super admin selalu bypass — bukan tenant user
    if (req.user?.role === 'super_admin') {
      return next();
    }

    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return next(); // Tidak ada tenant — biarkan middleware lain handle
    }

    const sub = await getSubscriptionStatus(tenantId);

    if (sub.status === 'expired') {
      res.status(403).json({
        status: 'error',
        code: 'SUBSCRIPTION_EXPIRED',
        message: 'Langganan Anda telah berakhir. Upgrade untuk melanjutkan.',
        subscription: {
          status: 'expired',
          expired_since: sub.subscriptionUntil
            ? new Date(sub.subscriptionUntil).toISOString().split('T')[0]
            : null,
          upgrade_url: '/subscriptions',
        },
      });
      return;
    }

    // active atau grace → lanjut
    return next();
  } catch (err) {
    // Jika DB error, biarkan request lewat (graceful degradation)
    // Lebih baik tenant bisa pakai daripada app down karena subscription check gagal
    console.error('[SubscriptionGuard] Error:', err);
    return next();
  }
}

/**
 * Invalidate cache untuk tenant tertentu.
 * Panggil ini setelah Super Admin extend subscription.
 */
export function invalidateSubscriptionCache(tenantId: number): void {
  cache.delete(tenantId);
}
