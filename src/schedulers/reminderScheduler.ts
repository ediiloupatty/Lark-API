/**
 * Lark Laundry — Reminder Scheduler
 *
 * Cron job yang berjalan harian (09:00 WIB) untuk:
 *  1. Mengirim WA reminder ke pelanggan yang pesanannya siap tapi belum diambil
 *  2. Menandai pesanan > 30 hari sebagai 'abandoned'
 *
 * Schedule (configurable via tenant_settings 'reminder_config'):
 *   +24h  → WA reminder pertama
 *   +3d   → WA reminder kedua
 *   +7d   → WA reminder + warning
 *   +30d  → Mark as abandoned + notif admin
 */

import cron from 'node-cron';
import { db } from '../config/db';
import { sendWhatsApp } from '../services/whatsappService';

// Default reminder thresholds in hours
const DEFAULT_THRESHOLDS = {
  reminder_1: 24,      // 24 hours = 1 day
  reminder_2: 72,      // 72 hours = 3 days
  reminder_3: 168,     // 168 hours = 7 days
  abandoned: 720,      // 720 hours = 30 days
};

interface ReminderConfig {
  enabled: boolean;
  reminder_1_hours: number;
  reminder_2_hours: number;
  reminder_3_hours: number;
  abandoned_hours: number;
}

/**
 * Load reminder config from tenant_settings.
 * Falls back to defaults if not configured.
 */
async function getReminderConfig(tenantId: number): Promise<ReminderConfig> {
  try {
    const row = await db.tenant_settings.findFirst({
      where: { tenant_id: tenantId, setting_key: 'reminder_config' },
      select: { setting_value: true },
    });

    if (row?.setting_value) {
      const cfg = typeof row.setting_value === 'string'
        ? JSON.parse(row.setting_value)
        : row.setting_value as any;

      return {
        enabled: cfg.enabled !== false,
        reminder_1_hours: cfg.reminder_1_hours || DEFAULT_THRESHOLDS.reminder_1,
        reminder_2_hours: cfg.reminder_2_hours || DEFAULT_THRESHOLDS.reminder_2,
        reminder_3_hours: cfg.reminder_3_hours || DEFAULT_THRESHOLDS.reminder_3,
        abandoned_hours: cfg.abandoned_hours || DEFAULT_THRESHOLDS.abandoned,
      };
    }
  } catch {
    // Fallback to defaults
  }

  return {
    enabled: true,
    reminder_1_hours: DEFAULT_THRESHOLDS.reminder_1,
    reminder_2_hours: DEFAULT_THRESHOLDS.reminder_2,
    reminder_3_hours: DEFAULT_THRESHOLDS.reminder_3,
    abandoned_hours: DEFAULT_THRESHOLDS.abandoned,
  };
}

/**
 * Build WhatsApp reminder message based on tier.
 */
function buildReminderMessage(data: {
  nama_toko: string;
  nama_pelanggan: string;
  tracking_code: string;
  tier: 1 | 2 | 3;
  hari_sejak_siap: number;
}): string {
  const tierMessages: Record<number, string> = {
    1: `Halo *${data.nama_pelanggan}*,\n\nCucian Anda di *${data.nama_toko}* sudah siap diambil! 🧺\n\n📋 No. Nota: *${data.tracking_code}*\n\nSilakan ambil di outlet kami. Terima kasih! 🙏`,
    2: `Halo *${data.nama_pelanggan}*,\n\nCucian Anda di *${data.nama_toko}* sudah menunggu selama *${data.hari_sejak_siap} hari*.\n\n📋 No. Nota: *${data.tracking_code}*\n\nMohon segera diambil ya. Terima kasih! 🙏`,
    3: `Halo *${data.nama_pelanggan}*,\n\n⚠️ Cucian Anda di *${data.nama_toko}* sudah menunggu selama *${data.hari_sejak_siap} hari*.\n\n📋 No. Nota: *${data.tracking_code}*\n\nMohon segera diambil. Setelah 30 hari, pesanan akan ditandai sebagai abandoned dan mungkin dikenakan biaya penyimpanan.\n\nTerima kasih! 🙏`,
  };

  return tierMessages[data.tier] || tierMessages[1];
}

/**
 * Core reminder processing logic.
 * Called by cron job or can be triggered manually.
 */
export async function processReminders(): Promise<void> {
  console.log('[Reminder] Starting daily reminder check...');

  try {
    // Get all active tenants
    const tenants = await db.tenants.findMany({
      where: { is_active: true },
      select: { id: true, name: true },
    });

    let totalReminders = 0;
    let totalAbandoned = 0;

    for (const tenant of tenants) {
      const config = await getReminderConfig(tenant.id);
      if (!config.enabled) continue;

      const now = new Date();

      // Find orders that are 'siap_diambil' or 'siap_diantar' with tgl_siap set
      const readyOrders = await db.$queryRawUnsafe<any[]>(`
        SELECT 
          o.id, o.tracking_code, o.tgl_siap, o.status,
          c.nama AS nama_pelanggan, c.no_hp,
          t.name AS nama_toko,
          EXTRACT(EPOCH FROM (NOW() - o.tgl_siap)) / 3600 AS hours_since_ready
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN tenants t ON t.id = o.tenant_id
        WHERE o.tenant_id = $1
          AND o.status IN ('siap_diambil', 'siap_diantar')
          AND o.tgl_siap IS NOT NULL
        ORDER BY o.tgl_siap ASC
      `, tenant.id);

      for (const order of readyOrders) {
        const hoursSinceReady = Number(order.hours_since_ready || 0);
        const daysSinceReady = Math.floor(hoursSinceReady / 24);

        // ── Abandoned (30+ days) ──
        if (hoursSinceReady >= config.abandoned_hours) {
          await db.$queryRawUnsafe(`
            UPDATE orders SET status = 'abandoned'::order_status, 
            server_version = CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT)
            WHERE id = $1 AND tenant_id = $2
          `, order.id, tenant.id);

          // Log status change
          await db.order_status_logs.create({
            data: {
              order_id: order.id,
              tenant_id: tenant.id,
              status_lama: order.status,
              status_baru: 'abandoned',
              catatan: `Auto-marked abandoned setelah ${daysSinceReady} hari tidak diambil`,
            },
          }).catch((e: unknown) => console.error('[Reminder] Audit log error:', e));

          totalAbandoned++;
          console.log(`[Reminder] Order #${order.tracking_code} marked as ABANDONED (${daysSinceReady} days)`);
          continue;
        }

        // ── Determine reminder tier ──
        let tier: 1 | 2 | 3 | null = null;

        if (hoursSinceReady >= config.reminder_3_hours) {
          tier = 3;
        } else if (hoursSinceReady >= config.reminder_2_hours) {
          tier = 2;
        } else if (hoursSinceReady >= config.reminder_1_hours) {
          tier = 1;
        }

        if (tier === null || !order.no_hp) continue;

        // ── Check if this tier reminder was already sent ──
        const reminderKey = `reminder_tier_${tier}`;
        const alreadySent = await db.audit_logs.findFirst({
          where: {
            tenant_id: tenant.id,
            entity_type: 'order_reminder',
            entity_id: order.id,
            action: reminderKey,
          },
        });

        if (alreadySent) continue; // Skip — already sent this tier

        // ── Send WhatsApp reminder ──
        const message = buildReminderMessage({
          nama_toko: order.nama_toko,
          nama_pelanggan: order.nama_pelanggan,
          tracking_code: order.tracking_code,
          tier,
          hari_sejak_siap: daysSinceReady,
        });

        await sendWhatsApp({
          tenantId: tenant.id,
          phone: order.no_hp,
          message,
        });

        // ── Log that this reminder was sent ──
        await db.audit_logs.create({
          data: {
            tenant_id: tenant.id,
            entity_type: 'order_reminder',
            entity_id: order.id,
            action: reminderKey,
            metadata: {
              tracking_code: order.tracking_code,
              tier,
              hours_since_ready: Math.round(hoursSinceReady),
              sent_to: order.no_hp,
            },
          },
        }).catch((e: unknown) => console.error('[Reminder] Audit log error:', e));

        totalReminders++;
        console.log(`[Reminder] Sent tier-${tier} reminder for #${order.tracking_code} (${daysSinceReady} days)`);
      }
    }

    console.log(`[Reminder] Done. Sent ${totalReminders} reminders, marked ${totalAbandoned} as abandoned.`);
  } catch (err) {
    console.error('[Reminder] Fatal error:', err);
  }
}

/**
 * Start the cron scheduler.
 * Runs daily at 09:00 WIB (02:00 UTC).
 */
export function startReminderScheduler(): void {
  // Cron: "0 2 * * *" = 02:00 UTC = 09:00 WIB
  cron.schedule('0 2 * * *', () => {
    processReminders();
  }, {
    timezone: 'Asia/Jakarta',
  });

  console.log('[Reminder] ✅ Scheduler started — runs daily at 09:00 WIB');
}
