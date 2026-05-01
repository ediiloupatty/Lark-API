import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { sendPushToAdmins } from './firebaseService';

// ═══════════════════════════════════════════════════════════════
//  PRODUCTION-HARDENED WHATSAPP SERVICE
//  Features: Rate Limiting, Message Queue, Cooldown, Daily Limit,
//            Auto-Reconnect, Disconnect Alerts
// ═══════════════════════════════════════════════════════════════

// ── Configuration Constants ─────────────────────────────────────
const CONFIG = {
  /** Maximum messages per tenant per minute (sliding window) */
  RATE_LIMIT_PER_MINUTE: 8,
  /** Maximum messages per tenant per day */
  DAILY_LIMIT: 200,
  /** Minimum delay between messages in ms (5-10 seconds randomized) */
  MIN_QUEUE_DELAY_MS: 5000,
  MAX_QUEUE_DELAY_MS: 10000,
  /** Cooldown base delay after send failure (exponential backoff) */
  COOLDOWN_BASE_MS: 30_000,   // 30 seconds
  COOLDOWN_MAX_MS: 600_000,   // 10 minutes max
  /** Max consecutive failures before pausing queue */
  MAX_CONSECUTIVE_FAILURES: 5,
  /** Auto-reconnect delay on startup */
  RECONNECT_DELAY_MS: 3000,
  /** Session directory base path */
  SESSION_BASE_DIR: path.join(__dirname, '../../../wa_sessions'),
};

// ── Types ───────────────────────────────────────────────────────

interface WASession {
  client: WASocket;
  qrCode: string | null;
  status: 'disconnected' | 'connecting' | 'connected';
  retries: number;
}

interface QueueItem {
  to: string;
  message: string;
  resolve: (val: boolean) => void;
  retryCount: number;
  addedAt: number;
}

interface TenantRateLimiter {
  /** Timestamps of recent sent messages (sliding window — last 60 seconds) */
  minuteWindow: number[];
  /** Daily counter — resets at midnight */
  dailyCount: number;
  dailyResetDate: string; // 'YYYY-MM-DD'
  /** Consecutive failure counter for cooldown */
  consecutiveFailures: number;
  /** Cooldown until timestamp — queue paused until this time */
  cooldownUntil: number;
}

// ── State Maps ──────────────────────────────────────────────────

const sessions = new Map<number, WASession>();
const messageQueues = new Map<number, QueueItem[]>();
const queueProcessing = new Map<number, boolean>();
const rateLimiters = new Map<number, TenantRateLimiter>();
/** Track last disconnect alert time to avoid spamming admins */
const lastAlertSent = new Map<number, number>();

// ── Rate Limiter Helpers ────────────────────────────────────────

function getRateLimiter(tenantId: number): TenantRateLimiter {
  const today = new Date().toISOString().slice(0, 10);
  let rl = rateLimiters.get(tenantId);
  if (!rl) {
    rl = {
      minuteWindow: [],
      dailyCount: 0,
      dailyResetDate: today,
      consecutiveFailures: 0,
      cooldownUntil: 0,
    };
    rateLimiters.set(tenantId, rl);
  }
  // Reset daily counter at midnight
  if (rl.dailyResetDate !== today) {
    rl.dailyCount = 0;
    rl.dailyResetDate = today;
    rl.consecutiveFailures = 0;
    rl.cooldownUntil = 0;
  }
  return rl;
}

/** Slide the 60-second window and check if under rate limit */
function canSendNow(tenantId: number): { allowed: boolean; reason?: string } {
  const rl = getRateLimiter(tenantId);
  const now = Date.now();

  // 1. Check cooldown
  if (now < rl.cooldownUntil) {
    const waitSec = Math.ceil((rl.cooldownUntil - now) / 1000);
    return { allowed: false, reason: `Cooldown aktif, tunggu ${waitSec}s lagi` };
  }

  // 2. Check daily limit
  if (rl.dailyCount >= CONFIG.DAILY_LIMIT) {
    return { allowed: false, reason: `Batas harian tercapai (${CONFIG.DAILY_LIMIT} pesan/hari)` };
  }

  // 3. Slide minute window: remove timestamps older than 60s
  rl.minuteWindow = rl.minuteWindow.filter(t => now - t < 60_000);

  // 4. Check per-minute rate limit
  if (rl.minuteWindow.length >= CONFIG.RATE_LIMIT_PER_MINUTE) {
    return { allowed: false, reason: `Rate limit: max ${CONFIG.RATE_LIMIT_PER_MINUTE} pesan/menit` };
  }

  return { allowed: true };
}

/** Record a successful send */
function recordSend(tenantId: number): void {
  const rl = getRateLimiter(tenantId);
  rl.minuteWindow.push(Date.now());
  rl.dailyCount++;
  rl.consecutiveFailures = 0;
  rl.cooldownUntil = 0;
}

/** Record a send failure with exponential backoff cooldown */
function recordFailure(tenantId: number): void {
  const rl = getRateLimiter(tenantId);
  rl.consecutiveFailures++;

  // Exponential backoff: 30s, 60s, 120s, 240s, ...  (max 10 min)
  const backoff = Math.min(
    CONFIG.COOLDOWN_BASE_MS * Math.pow(2, rl.consecutiveFailures - 1),
    CONFIG.COOLDOWN_MAX_MS
  );
  rl.cooldownUntil = Date.now() + backoff;

  console.warn(
    `[WA] Tenant ${tenantId}: failure #${rl.consecutiveFailures}, cooldown ${Math.round(backoff / 1000)}s`
  );
}

// ── Message Queue Engine ────────────────────────────────────────

function getRandomDelay(): number {
  return CONFIG.MIN_QUEUE_DELAY_MS +
    Math.random() * (CONFIG.MAX_QUEUE_DELAY_MS - CONFIG.MIN_QUEUE_DELAY_MS);
}

function enqueueMessage(tenantId: number, to: string, message: string): Promise<boolean> {
  return new Promise(resolve => {
    if (!messageQueues.has(tenantId)) {
      messageQueues.set(tenantId, []);
    }
    messageQueues.get(tenantId)!.push({
      to,
      message,
      resolve,
      retryCount: 0,
      addedAt: Date.now(),
    });
    // Trigger processing if not already running
    processQueue(tenantId);
  });
}

async function processQueue(tenantId: number): Promise<void> {
  // Prevent concurrent processing
  if (queueProcessing.get(tenantId)) return;
  queueProcessing.set(tenantId, true);

  const queue = messageQueues.get(tenantId);
  if (!queue) {
    queueProcessing.set(tenantId, false);
    return;
  }

  while (queue.length > 0) {
    const rl = getRateLimiter(tenantId);

    // Check if queue should be paused (too many failures)
    if (rl.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
      console.error(`[WA] Tenant ${tenantId}: ${CONFIG.MAX_CONSECUTIVE_FAILURES} consecutive failures — pausing queue`);
      // Resolve all remaining items as false
      while (queue.length > 0) {
        queue.shift()!.resolve(false);
      }
      break;
    }

    // Check rate limits — wait if needed
    const check = canSendNow(tenantId);
    if (!check.allowed) {
      // Wait for cooldown or rate limit window to pass
      const waitTime = rl.cooldownUntil > Date.now()
        ? rl.cooldownUntil - Date.now()
        : 10_000; // Wait 10s for rate limit window to slide
      console.log(`[WA] Tenant ${tenantId}: queue paused — ${check.reason}. Retrying in ${Math.round(waitTime / 1000)}s`);
      await sleep(waitTime);
      continue;
    }

    const item = queue.shift()!;

    // Discard messages older than 30 minutes (stale)
    if (Date.now() - item.addedAt > 30 * 60 * 1000) {
      console.warn(`[WA] Tenant ${tenantId}: discarding stale message to ${item.to}`);
      item.resolve(false);
      continue;
    }

    // Send the message
    const success = await rawSendMessage(tenantId, item.to, item.message);
    if (success) {
      recordSend(tenantId);
      item.resolve(true);
    } else {
      recordFailure(tenantId);
      item.resolve(false);
    }

    // Wait random delay between messages (5-10s) to mimic human behavior
    if (queue.length > 0) {
      await sleep(getRandomDelay());
    }
  }

  queueProcessing.set(tenantId, false);
}

// ── Core Baileys Functions ──────────────────────────────────────

export class WhatsAppService {
  /**
   * Initialize WA client for a tenant.
   */
  static async initialize(tenantId: number): Promise<void> {
    if (sessions.has(tenantId)) {
      const session = sessions.get(tenantId)!;
      if (session.status !== 'disconnected') {
        return; // Already initialized or connecting
      }
    }

    console.log(`[WA] Initializing Baileys client for tenant ${tenantId}...`);

    const sessionDir = path.join(CONFIG.SESSION_BASE_DIR, `tenant_${tenantId}`);

    // Create initial session object
    sessions.set(tenantId, {
      client: {} as WASocket,
      qrCode: null,
      status: 'connecting',
      retries: 0,
    });

    const startSock = async () => {
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`[WA] Using WA v${version.join('.')}, isLatest: ${isLatest}`);

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'warn' }),
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: true,
      });

      if (sessions.has(tenantId)) {
        sessions.get(tenantId)!.client = sock;
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const sessionData = sessions.get(tenantId);
        if (!sessionData) return;

        if (qr) {
          console.log(`[WA] QR Code received for tenant ${tenantId}`);
          try {
            const qrDataUrl = await qrcode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 4 });
            sessionData.qrCode = qrDataUrl;
            sessionData.status = 'disconnected'; // Waiting for scan
          } catch (error) {
            console.error(`[WA] Error generating QR for tenant ${tenantId}:`, error);
          }
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
          console.log(`[WA] Connection closed for tenant ${tenantId}. Reconnecting: ${shouldReconnect}`);

          const previousStatus = sessionData.status;
          sessionData.status = 'disconnected';
          sessionData.qrCode = null;

          // ── Point 6: Alert admin on disconnect ──
          if (previousStatus === 'connected') {
            alertAdminDisconnect(tenantId);
          }

          if (shouldReconnect) {
            setTimeout(startSock, 2000);
          } else {
            console.log(`[WA] Tenant ${tenantId} logged out manually.`);
            if (fs.existsSync(sessionDir)) {
              fs.rmSync(sessionDir, { recursive: true, force: true });
            }
          }
        } else if (connection === 'open') {
          console.log(`[WA] ✅ Client connected for tenant ${tenantId}`);
          sessionData.status = 'connected';
          sessionData.qrCode = null;
          sessionData.retries = 0;
        }
      });
    };

    startSock();
  }

  /**
   * Get current status (and QR if available).
   */
  static getStatus(tenantId: number) {
    const session = sessions.get(tenantId);
    if (!session) {
      return { status: 'disconnected', qrCode: null };
    }
    return {
      status: session.status,
      qrCode: session.qrCode,
    };
  }

  /**
   * Get rate limiter stats for a tenant (for monitoring API).
   */
  static getStats(tenantId: number) {
    const rl = getRateLimiter(tenantId);
    const queueLength = messageQueues.get(tenantId)?.length ?? 0;
    return {
      dailySent: rl.dailyCount,
      dailyLimit: CONFIG.DAILY_LIMIT,
      dailyRemaining: Math.max(0, CONFIG.DAILY_LIMIT - rl.dailyCount),
      consecutiveFailures: rl.consecutiveFailures,
      cooldownActive: Date.now() < rl.cooldownUntil,
      cooldownRemainingMs: Math.max(0, rl.cooldownUntil - Date.now()),
      queueLength,
      ratePerMinute: rl.minuteWindow.filter(t => Date.now() - t < 60_000).length,
      rateLimit: CONFIG.RATE_LIMIT_PER_MINUTE,
    };
  }

  /**
   * Disconnect session and delete auth folder.
   */
  static async logout(tenantId: number): Promise<void> {
    const session = sessions.get(tenantId);
    if (session) {
      try {
        session.client.logout();
      } catch (error) {
        console.error(`[WA] Error logging out tenant ${tenantId}:`, error);
      }
      sessions.delete(tenantId);
    }

    // Clear queue
    const queue = messageQueues.get(tenantId);
    if (queue) {
      queue.forEach(item => item.resolve(false));
      messageQueues.delete(tenantId);
    }
    rateLimiters.delete(tenantId);

    const sessionPath = path.join(CONFIG.SESSION_BASE_DIR, `tenant_${tenantId}`);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
    console.log(`[WA] Logged out tenant ${tenantId}`);
  }

  /**
   * Send a message through the queue (rate-limited, delayed, with cooldown).
   * This is the PRIMARY method all code should call.
   */
  static async sendMessage(tenantId: number, to: string, message: string): Promise<boolean> {
    const session = sessions.get(tenantId);
    if (!session || session.status !== 'connected') {
      console.log(`[WA] Cannot queue message. Tenant ${tenantId} is not connected.`);
      return false;
    }

    // Pre-check daily limit before even queueing
    const rl = getRateLimiter(tenantId);
    if (rl.dailyCount >= CONFIG.DAILY_LIMIT) {
      console.warn(`[WA] Tenant ${tenantId}: daily limit reached (${CONFIG.DAILY_LIMIT}). Message dropped.`);
      return false;
    }

    return enqueueMessage(tenantId, to, message);
  }

  /**
   * Check if client is connected and ready.
   */
  static isReady(tenantId: number): boolean {
    const session = sessions.get(tenantId);
    return session?.status === 'connected';
  }

  /**
   * Point 5: Auto-reconnect existing sessions on server startup.
   * Scans wa_sessions directory for existing tenant sessions and reconnects them.
   */
  static async autoReconnectAll(): Promise<void> {
    if (!fs.existsSync(CONFIG.SESSION_BASE_DIR)) {
      console.log('[WA] No session directory found. Skipping auto-reconnect.');
      return;
    }

    const entries = fs.readdirSync(CONFIG.SESSION_BASE_DIR, { withFileTypes: true });
    const tenantDirs = entries
      .filter(e => e.isDirectory() && e.name.startsWith('tenant_'))
      .map(e => {
        const id = parseInt(e.name.replace('tenant_', ''), 10);
        return isNaN(id) ? null : id;
      })
      .filter((id): id is number => id !== null);

    if (tenantDirs.length === 0) {
      console.log('[WA] No existing sessions to reconnect.');
      return;
    }

    console.log(`[WA] 🔄 Auto-reconnecting ${tenantDirs.length} tenant session(s)...`);

    for (const tenantId of tenantDirs) {
      try {
        await WhatsAppService.initialize(tenantId);
        // Stagger reconnections to avoid overwhelming WhatsApp
        await sleep(CONFIG.RECONNECT_DELAY_MS);
      } catch (error) {
        console.error(`[WA] Failed to auto-reconnect tenant ${tenantId}:`, error);
      }
    }
  }
}

// ── Raw Send (internal — no queue, no rate limit) ───────────────

async function rawSendMessage(tenantId: number, to: string, message: string): Promise<boolean> {
  const session = sessions.get(tenantId);
  if (!session || session.status !== 'connected') {
    return false;
  }

  try {
    // Format phone number
    let formattedNumber = to.replace(/\D/g, '');
    if (formattedNumber.startsWith('0')) {
      formattedNumber = '62' + formattedNumber.substring(1);
    }

    const jid = `${formattedNumber}@s.whatsapp.net`;

    // Verify number is on WhatsApp
    const onWhatsAppResults = await session.client.onWhatsApp(jid);
    if (!onWhatsAppResults || onWhatsAppResults.length === 0 || !onWhatsAppResults[0].exists) {
      console.log(`[WA] Number ${formattedNumber} is not registered on WhatsApp.`);
      return false;
    }

    const result = onWhatsAppResults[0];

    // ── ANTI-BAN: Human-like behavior ──
    await session.client.sendPresenceUpdate('available', result.jid);
    await session.client.sendPresenceUpdate('composing', result.jid);

    // Typing delay based on message length (30ms per char, 500-1500ms base)
    const baseDelay = Math.floor(Math.random() * 1000) + 500;
    const typingTime = message.length * 30;
    const totalDelay = Math.min(baseDelay + typingTime, 5000);
    await sleep(totalDelay);

    // Send
    await session.client.sendMessage(result.jid, { text: message });

    // Stop typing
    await session.client.sendPresenceUpdate('paused', result.jid);

    console.log(`[WA] ✅ Message sent to ${formattedNumber} (tenant ${tenantId})`);
    return true;
  } catch (error) {
    console.error(`[WA] ❌ Send failed for tenant ${tenantId}:`, error);
    return false;
  }
}

// ── Point 6: Disconnect Alert ───────────────────────────────────

async function alertAdminDisconnect(tenantId: number): Promise<void> {
  const now = Date.now();
  const lastAlert = lastAlertSent.get(tenantId) ?? 0;

  // Don't spam alerts — max 1 alert per 10 minutes per tenant
  if (now - lastAlert < 10 * 60 * 1000) return;
  lastAlertSent.set(tenantId, now);

  console.warn(`[WA] ⚠️ Sending disconnect alert for tenant ${tenantId}`);

  try {
    await sendPushToAdmins({
      tenantId,
      title: '⚠️ WhatsApp Terputus',
      body: 'Koneksi WhatsApp terputus. Buka Pengaturan > Integrasi WA untuk menghubungkan kembali.',
      data: { type: 'wa_disconnect', tab: 'whatsapp' },
    });
  } catch (error) {
    console.error(`[WA] Failed to send disconnect alert:`, error);
  }
}

// ── Utility ─────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Compatibility Layer (unchanged public API) ──────────────────

export interface SendWAOptions {
  tenantId: number;
  phone: string;
  message: string;
}

/**
 * Send WA using the queue system (replaces old Fonnte).
 * Fire-and-forget — will not throw.
 */
export async function sendWhatsApp(opts: SendWAOptions): Promise<void> {
  await WhatsAppService.sendMessage(opts.tenantId, opts.phone, opts.message);
}

/**
 * Template: New order notification.
 */
export function buildNewOrderMessage(data: {
  nama_toko: string;
  nama_pelanggan: string;
  tracking_code: string;
  total_harga: number;
  estimasi_tanggal: string;
  layanan_nama?: string;
}): string {
  const total = Math.round(data.total_harga).toLocaleString('id-ID');
  const estimasi = data.estimasi_tanggal
    ? new Date(data.estimasi_tanggal).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })
    : '-';

  return (
    `🧺 *${data.nama_toko}* — Pesanan Diterima!\n\n` +
    `Halo *${data.nama_pelanggan}*,\n` +
    `Pesanan laundry Anda telah kami terima.\n\n` +
    `📋 *Detail Pesanan:*\n` +
    `• No. Nota  : *${data.tracking_code}*\n` +
    (data.layanan_nama ? `• Layanan   : ${data.layanan_nama}\n` : '') +
    `• Total     : *Rp ${total}*\n` +
    `• Est. Selesai: *${estimasi}*\n\n` +
    `Kami akan informasikan kembali saat cucian siap diambil. 🙏`
  );
}

/**
 * Template: Status update notification.
 */
export function buildStatusUpdateMessage(data: {
  nama_toko: string;
  nama_pelanggan: string;
  tracking_code: string;
  status: string;
}): string {
  const statusText: Record<string, string> = {
    siap_diambil: '✅ *Cucian Anda sudah selesai dan siap diambil!*',
    siap_diantar: '🚚 *Cucian Anda sedang dalam perjalanan!*',
    selesai:      '🎉 *Terima kasih! Pesanan Anda telah selesai.*',
  };

  const msg = statusText[data.status];
  if (!msg) return '';

  return (
    `🧺 *${data.nama_toko}*\n\n` +
    `Halo *${data.nama_pelanggan}*,\n` +
    `${msg}\n\n` +
    `📋 No. Nota: *${data.tracking_code}*\n\n` +
    `Terima kasih telah mempercayai kami! 🙏`
  );
}
