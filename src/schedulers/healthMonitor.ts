/**
 * Lark Laundry — System Health Monitor
 *
 * Scheduler (cron setiap 5 menit) yang memonitor kesehatan sistem:
 *   1. Database latency (SELECT 1 via pool)
 *   2. Memory usage (process.memoryUsage)
 *   3. Frontend availability (HTTP GET larklaundry.com)
 *   4. Uptime check (crash loop detection)
 *   5. Connection pool saturation
 *
 * Saat anomali terdeteksi:
 *   - Simpan notifikasi ke semua super_admin (saveNotification)
 *   - Kirim push notification (sendPushToAdmins)
 *   - Log ke audit_logs
 *
 * Deduplication: cooldown 30 menit per jenis alert.
 */

import cron from 'node-cron';
import { db } from '../config/db';
import { isDbHealthy, pool } from '../config/db';
import { sendPushToAdmins, saveNotification } from '../services/firebaseService';
import { getCurrentErrorRate } from '../middlewares/errorTracker';

// ── Threshold Configuration ──────────────────────────────────────
const THRESHOLDS = {
  DB_LATENCY_MS: 1000,        // Alert jika DB latency > 1 detik
  MEMORY_MB: 512,             // Alert jika RSS > 512MB
  UPTIME_MIN_SECONDS: 60,     // Alert jika uptime < 60 detik (possible crash loop)
  FRONTEND_TIMEOUT_MS: 10000, // Timeout untuk cek frontend
  ERROR_RATE_PER_MIN: 10,     // Alert jika > 10 API errors per menit
};

// ── Cooldown: mencegah spam alert berulang ──────────────────────
const COOLDOWN_MS = 30 * 60 * 1000; // 30 menit
const lastAlertTimestamps = new Map<string, number>();

function shouldAlert(alertType: string): boolean {
  const lastSent = lastAlertTimestamps.get(alertType);
  if (lastSent && Date.now() - lastSent < COOLDOWN_MS) return false;
  lastAlertTimestamps.set(alertType, Date.now());
  return true;
}

// ── Alert Severity ──────────────────────────────────────────────
type Severity = 'critical' | 'warning' | 'info';

interface HealthAlert {
  type: string;
  severity: Severity;
  message: string;
  value: string;
}

// ── Helper: kirim alert ke semua super_admin ────────────────────
async function dispatchAlert(alert: HealthAlert): Promise<void> {
  const severityEmoji: Record<Severity, string> = {
    critical: '🔴',
    warning: '🟡',
    info: '🔵',
  };
  const emoji = severityEmoji[alert.severity];
  const pesan = `${emoji} [${alert.severity.toUpperCase()}] ${alert.message} (${alert.value})`;

  try {
    // Cari semua user super_admin aktif
    const superAdmins = await db.users.findMany({
      where: { role: 'super_admin', is_active: true, deleted_at: null },
      select: { id: true, tenant_id: true },
    });

    // Simpan notifikasi ke DB untuk setiap super_admin
    for (const admin of superAdmins) {
      await saveNotification({
        tenantId: admin.tenant_id ?? null,
        userId: admin.id,
        tipe: 'system_alert',
        pesan,
      });
    }

    // Push notification ke device (Firebase)
    // Kirim ke semua tenant yang punya super_admin (biasanya 1)
    const tenantIds = [...new Set(superAdmins.map(a => a.tenant_id).filter(Boolean))] as number[];
    for (const tenantId of tenantIds) {
      await sendPushToAdmins({
        tenantId,
        title: `⚠️ System Alert — ${alert.type}`,
        body: alert.message,
        data: {
          type: 'system_alert',
          severity: alert.severity,
          alert_type: alert.type,
        },
      });
    }

    // Log ke audit_logs
    await db.audit_logs.create({
      data: {
        entity_type: 'system_health',
        action: `health_alert_${alert.severity}`,
        metadata: {
          alert_type: alert.type,
          severity: alert.severity,
          message: alert.message,
          value: alert.value,
          timestamp: new Date().toISOString(),
        },
      },
    }).catch((e: unknown) => console.error('[HealthMonitor] Audit log error:', e));

    console.warn(`[HealthMonitor] ${pesan}`);
  } catch (err) {
    console.error('[HealthMonitor] Failed to dispatch alert:', err);
  }
}

// ── Core Health Check ───────────────────────────────────────────
export async function runHealthCheck(): Promise<void> {
  const alerts: HealthAlert[] = [];

  // 1. Database Health & Latency
  try {
    const dbHealth = await isDbHealthy();
    if (!dbHealth.ok) {
      if (shouldAlert('db_down')) {
        alerts.push({
          type: 'Database Down',
          severity: 'critical',
          message: `Database tidak dapat dijangkau: ${dbHealth.error || 'Unknown error'}`,
          value: `${dbHealth.latencyMs}ms`,
        });
      }
    } else if (dbHealth.latencyMs > THRESHOLDS.DB_LATENCY_MS) {
      if (shouldAlert('db_latency')) {
        alerts.push({
          type: 'DB Latency Tinggi',
          severity: 'warning',
          message: `Database latency melebihi threshold (${THRESHOLDS.DB_LATENCY_MS}ms)`,
          value: `${dbHealth.latencyMs}ms`,
        });
      }
    }
  } catch (err: any) {
    if (shouldAlert('db_check_fail')) {
      alerts.push({
        type: 'DB Check Error',
        severity: 'critical',
        message: `Gagal mengecek kesehatan database: ${err.message}`,
        value: 'N/A',
      });
    }
  }

  // 2. Memory Usage
  const memUsage = process.memoryUsage();
  const rssMb = Math.round(memUsage.rss / (1024 * 1024));
  if (rssMb > THRESHOLDS.MEMORY_MB) {
    if (shouldAlert('memory_high')) {
      alerts.push({
        type: 'Memory Tinggi',
        severity: 'warning',
        message: `Penggunaan memory (RSS) melebihi ${THRESHOLDS.MEMORY_MB}MB`,
        value: `${rssMb}MB`,
      });
    }
  }

  // 3. Frontend Availability
  try {
    const frontendUrl = process.env.FRONTEND_URL || 'https://larklaundry.com';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), THRESHOLDS.FRONTEND_TIMEOUT_MS);

    const res = await fetch(frontendUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'LarkHealthMonitor/1.0' },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      if (shouldAlert('frontend_down')) {
        alerts.push({
          type: 'Frontend Down',
          severity: 'critical',
          message: `Frontend (${frontendUrl}) merespons HTTP ${res.status}`,
          value: `HTTP ${res.status}`,
        });
      }
    }
  } catch (err: any) {
    if (shouldAlert('frontend_unreachable')) {
      alerts.push({
        type: 'Frontend Unreachable',
        severity: 'critical',
        message: `Tidak dapat menjangkau frontend: ${err.name === 'AbortError' ? 'Timeout' : err.message}`,
        value: 'Timeout/Error',
      });
    }
  }

  // 4. Uptime Check (Crash Loop Detection)
  const uptimeSeconds = process.uptime();
  if (uptimeSeconds < THRESHOLDS.UPTIME_MIN_SECONDS) {
    if (shouldAlert('crash_loop')) {
      alerts.push({
        type: 'Possible Crash Loop',
        severity: 'warning',
        message: `Server baru restart ${Math.round(uptimeSeconds)} detik lalu — kemungkinan crash loop`,
        value: `${Math.round(uptimeSeconds)}s`,
      });
    }
  }

  // 5. Connection Pool Saturation
  try {
    const poolStats = {
      total: (pool as any).totalCount ?? 0,
      idle: (pool as any).idleCount ?? 0,
      waiting: (pool as any).waitingCount ?? 0,
    };

    if (poolStats.idle === 0 && poolStats.waiting > 0) {
      if (shouldAlert('pool_exhausted')) {
        alerts.push({
          type: 'Pool Exhausted',
          severity: 'critical',
          message: `Semua koneksi DB terpakai, ${poolStats.waiting} request menunggu`,
          value: `${poolStats.total} total, ${poolStats.waiting} waiting`,
        });
      }
    }
  } catch {
    // Pool stats not available — skip silently
  }

  // Dispatch all alerts
  for (const alert of alerts) {
    await dispatchAlert(alert);
  }

  if (alerts.length === 0) {
    // Silent log hanya saat debug — production bisa dimatikan
    // console.log('[HealthMonitor] ✅ All systems healthy');
  }
}

// ── Last snapshot storage (in-memory) ───────────────────────────
// Digunakan oleh GET /sys-admin/health-snapshot endpoint
export interface HealthSnapshot {
  timestamp: string;
  db: { ok: boolean; latencyMs: number; error?: string };
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
  frontend: { ok: boolean; statusCode: number | null; error?: string };
  uptime: { seconds: number; formatted: string };
  pool: { total: number; idle: number; waiting: number };
  errorRate: number; // API errors per minute
  alerts: HealthAlert[];
}

let latestSnapshot: HealthSnapshot | null = null;

export function getLatestSnapshot(): HealthSnapshot | null {
  return latestSnapshot;
}

/** Extended version: juga simpan snapshot untuk API consumption */
export async function runHealthCheckWithSnapshot(): Promise<HealthSnapshot> {
  const alerts: HealthAlert[] = [];

  // 1. DB
  let dbResult: { ok: boolean; latencyMs: number; error?: string } = { ok: false, latencyMs: 0 };
  try {
    const healthResult = await isDbHealthy();
    dbResult = { ok: healthResult.ok, latencyMs: healthResult.latencyMs, error: healthResult.error };
    if (!dbResult.ok && shouldAlert('db_down')) {
      alerts.push({ type: 'Database Down', severity: 'critical', message: `Database tidak dapat dijangkau: ${dbResult.error || 'Unknown'}`, value: `${dbResult.latencyMs}ms` });
    } else if (dbResult.ok && dbResult.latencyMs > THRESHOLDS.DB_LATENCY_MS && shouldAlert('db_latency')) {
      alerts.push({ type: 'DB Latency Tinggi', severity: 'warning', message: `DB latency: ${dbResult.latencyMs}ms (> ${THRESHOLDS.DB_LATENCY_MS}ms)`, value: `${dbResult.latencyMs}ms` });
    }
  } catch (err: any) {
    dbResult = { ok: false, latencyMs: 0, error: err.message };
    if (shouldAlert('db_check_fail')) {
      alerts.push({ type: 'DB Check Error', severity: 'critical', message: `Gagal cek DB: ${err.message}`, value: 'N/A' });
    }
  }

  // 2. Memory
  const mem = process.memoryUsage();
  const rssMb = Math.round(mem.rss / (1024 * 1024));
  const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));
  const heapTotalMb = Math.round(mem.heapTotal / (1024 * 1024));
  if (rssMb > THRESHOLDS.MEMORY_MB && shouldAlert('memory_high')) {
    alerts.push({ type: 'Memory Tinggi', severity: 'warning', message: `RSS: ${rssMb}MB (> ${THRESHOLDS.MEMORY_MB}MB)`, value: `${rssMb}MB` });
  }

  // 3. Frontend
  let feResult = { ok: true, statusCode: null as number | null, error: undefined as string | undefined };
  try {
    const frontendUrl = process.env.FRONTEND_URL || 'https://larklaundry.com';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), THRESHOLDS.FRONTEND_TIMEOUT_MS);
    const res = await fetch(frontendUrl, { method: 'GET', signal: controller.signal, headers: { 'User-Agent': 'LarkHealthMonitor/1.0' } });
    clearTimeout(timeout);
    feResult = { ok: res.ok, statusCode: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
    if (!res.ok && shouldAlert('frontend_down')) {
      alerts.push({ type: 'Frontend Down', severity: 'critical', message: `Frontend HTTP ${res.status}`, value: `HTTP ${res.status}` });
    }
  } catch (err: any) {
    feResult = { ok: false, statusCode: null, error: err.name === 'AbortError' ? 'Timeout' : err.message };
    if (shouldAlert('frontend_unreachable')) {
      alerts.push({ type: 'Frontend Unreachable', severity: 'critical', message: `Frontend unreachable: ${feResult.error}`, value: 'Error' });
    }
  }

  // 4. Uptime
  const uptimeSec = process.uptime();
  if (uptimeSec < THRESHOLDS.UPTIME_MIN_SECONDS && shouldAlert('crash_loop')) {
    alerts.push({ type: 'Possible Crash Loop', severity: 'warning', message: `Server restart ${Math.round(uptimeSec)}s ago`, value: `${Math.round(uptimeSec)}s` });
  }
  const hours = Math.floor(uptimeSec / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  const days = Math.floor(hours / 24);
  const uptimeFormatted = days > 0 ? `${days}d ${hours % 24}h ${minutes}m` : `${hours}h ${minutes}m`;

  // 5. Pool
  let poolStats = { total: 0, idle: 0, waiting: 0 };
  try {
    poolStats = {
      total: (pool as any).totalCount ?? 0,
      idle: (pool as any).idleCount ?? 0,
      waiting: (pool as any).waitingCount ?? 0,
    };
    if (poolStats.idle === 0 && poolStats.waiting > 0 && shouldAlert('pool_exhausted')) {
      alerts.push({ type: 'Pool Exhausted', severity: 'critical', message: `${poolStats.waiting} requests waiting`, value: `${poolStats.total} total` });
    }
  } catch { /* skip */ }

  // 6. API Error Rate Spike Detection
  const currentErrorRate = getCurrentErrorRate();
  if (currentErrorRate > THRESHOLDS.ERROR_RATE_PER_MIN && shouldAlert('error_rate_spike')) {
    alerts.push({
      type: 'Error Rate Spike',
      severity: 'warning',
      message: `API error rate tinggi: ${currentErrorRate} errors/menit (threshold: ${THRESHOLDS.ERROR_RATE_PER_MIN})`,
      value: `${currentErrorRate}/min`,
    });
  }

  // Dispatch alerts
  for (const alert of alerts) {
    await dispatchAlert(alert);
  }

  const snapshot: HealthSnapshot = {
    timestamp: new Date().toISOString(),
    db: dbResult,
    memory: { rssMb, heapUsedMb, heapTotalMb },
    frontend: feResult,
    uptime: { seconds: uptimeSec, formatted: uptimeFormatted },
    pool: poolStats,
    errorRate: currentErrorRate,
    alerts,
  };

  latestSnapshot = snapshot;
  return snapshot;
}

// ── Start Scheduler ─────────────────────────────────────────────
export function startHealthMonitor(): void {
  // Run immediately on startup (after 10s delay to let everything initialize)
  setTimeout(() => {
    runHealthCheckWithSnapshot().catch(err =>
      console.error('[HealthMonitor] Initial check error:', err)
    );
  }, 10_000);

  // Then every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    runHealthCheckWithSnapshot().catch(err =>
      console.error('[HealthMonitor] Scheduled check error:', err)
    );
  }, {
    timezone: 'Asia/Jakarta',
  });

  console.log('[HealthMonitor] ✅ Started — checks every 5 minutes');
}
