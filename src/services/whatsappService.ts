import makeWASocket, { useMultiFileAuthState, DisconnectReason, WASocket, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as qrcode from 'qrcode';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

interface WASession {
  client: WASocket;
  qrCode: string | null;
  status: 'disconnected' | 'connecting' | 'connected';
  retries: number;
}

const sessions = new Map<number, WASession>();

export class WhatsAppService {
  /**
   * Menginisialisasi Client WA untuk suatu tenant (toko).
   */
  static async initialize(tenantId: number): Promise<void> {
    if (sessions.has(tenantId)) {
      const session = sessions.get(tenantId)!;
      if (session.status !== 'disconnected') {
        return; // Sudah inisialisasi atau sedang terhubung
      }
    }

    console.log(`[WA] Initializing Baileys client for tenant ${tenantId}...`);

    const sessionDir = path.join(__dirname, `../../../wa_sessions/tenant_${tenantId}`);
    
    // Create initial session object
    sessions.set(tenantId, {
      client: {} as WASocket, // placeholder
      qrCode: null,
      status: 'connecting',
      retries: 0
    });

    const startSock = async () => {
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`[WA] Using WA v${version.join('.')}, isLatest: ${isLatest}`);
      
      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'warn' }), // Enable logs to debug connection issue
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: false, // ANTI-BAN: Jangan selalu terlihat online saat terkoneksi
        generateHighQualityLinkPreview: true
      });

      // Update the session client
      if (sessions.has(tenantId)) {
        sessions.get(tenantId)!.client = sock;
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        const sessionData = sessions.get(tenantId);
        
        if (!sessionData) return; // Session was likely deleted/logged out

        if (qr) {
          console.log(`[WA] QR Code received for tenant ${tenantId}`);
          try {
            const qrDataUrl = await qrcode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 4 });
            sessionData.qrCode = qrDataUrl;
            sessionData.status = 'disconnected'; // Waiting for scan
          } catch (error) {
            console.error(`[WA] Error generating QR data URL for tenant ${tenantId}:`, error);
          }
        }

        if (connection === 'close') {
          const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
          console.log(`[WA] Connection closed for tenant ${tenantId}. Reconnecting: ${shouldReconnect}. Reason:`, lastDisconnect?.error);
          
          sessionData.status = 'disconnected';
          sessionData.qrCode = null;

          if (shouldReconnect) {
            // Wait a bit before reconnecting
            setTimeout(startSock, 2000);
          } else {
            console.log(`[WA] Tenant ${tenantId} logged out manually.`);
            // Clean up session directory if logged out
            if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
          }
        } else if (connection === 'open') {
          console.log(`[WA] Client connected for tenant ${tenantId}`);
          sessionData.status = 'connected';
          sessionData.qrCode = null;
          sessionData.retries = 0;
        }
      });
    };

    startSock();
  }

  /**
   * Mendapatkan status saat ini (dan QR jika ada).
   */
  static getStatus(tenantId: number) {
    const session = sessions.get(tenantId);
    if (!session) {
      return { status: 'disconnected', qrCode: null };
    }
    return {
      status: session.status,
      qrCode: session.qrCode
    };
  }

  /**
   * Memutuskan sesi dan menghapus folder LocalAuth untuk tenant.
   */
  static async logout(tenantId: number): Promise<void> {
    const session = sessions.get(tenantId);
    if (session) {
      try {
        session.client.logout(); // Baileys specific logout
      } catch (error) {
        console.error(`[WA] Error logging out client for tenant ${tenantId}:`, error);
      }
      sessions.delete(tenantId);
    }
    
    const sessionPath = path.join(__dirname, `../../../wa_sessions/tenant_${tenantId}`);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
    console.log(`[WA] Logged out tenant ${tenantId}`);
  }

  /**
   * Mengirim pesan otomatis
   */
  static async sendMessage(tenantId: number, to: string, message: string): Promise<boolean> {
    const session = sessions.get(tenantId);
    if (!session || session.status !== 'connected') {
      console.log(`[WA] Cannot send message. Tenant ${tenantId} is not connected.`);
      return false;
    }

    try {
      // Pastikan format nomor benar (buang '0' atau '+' di awal, pakai kode negara)
      let formattedNumber = to.replace(/\D/g, '');
      if (formattedNumber.startsWith('0')) {
        formattedNumber = '62' + formattedNumber.substring(1);
      }
      
      // Baileys format is number@s.whatsapp.net
      const jid = `${formattedNumber}@s.whatsapp.net`;
      
      const onWhatsAppResults = await session.client.onWhatsApp(jid);
      if (!onWhatsAppResults || onWhatsAppResults.length === 0 || !onWhatsAppResults[0].exists) {
         console.log(`[WA] Number ${jid} is not registered on WhatsApp.`);
         return false;
      }
      
      const result = onWhatsAppResults[0];

      // --- ANTI-BAN MANIPULATION ---
      // 1. Simulate reading/online presence
      await session.client.sendPresenceUpdate('available', result.jid);
      
      // 2. Simulate "typing..." status
      await session.client.sendPresenceUpdate('composing', result.jid);

      // 3. Add random human-like delay based on message length (approx 50ms per character + random 500-1500ms)
      const baseDelay = Math.floor(Math.random() * 1000) + 500;
      const typingTime = message.length * 30; // 30ms per char
      const totalDelay = Math.min(baseDelay + typingTime, 5000); // max 5 seconds delay
      await new Promise(resolve => setTimeout(resolve, totalDelay));

      // 4. Send the actual message
      await session.client.sendMessage(result.jid, { text: message });

      // 5. Turn off typing status
      await session.client.sendPresenceUpdate('paused', result.jid);
      // -----------------------------

      console.log(`[WA] Message sent to ${formattedNumber} for tenant ${tenantId}`);
      return true;
    } catch (error) {
      console.error(`[WA] Error sending message for tenant ${tenantId}:`, error);
      return false;
    }
  }

  /**
   * Cek apakah client siap
   */
  static isReady(tenantId: number): boolean {
    const session = sessions.get(tenantId);
    return session?.status === 'connected';
  }
}

// ── Compatibility layer for existing controllers ──

export interface SendWAOptions {
  tenantId: number;
  phone: string;
  message: string;
}

/**
 * Kirim WA menggunakan WhatsAppService (pengganti Fonnte).
 * Bersifat "fire-and-forget" — tidak akan throw error ke caller.
 */
export async function sendWhatsApp(opts: SendWAOptions): Promise<void> {
  await WhatsAppService.sendMessage(opts.tenantId, opts.phone, opts.message);
}

/**
 * Template pesan WA saat pesanan baru dibuat.
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
 * Template pesan WA saat status pesanan berubah ke siap_diambil / selesai.
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
  if (!msg) return ''; // hanya kirim untuk status tertentu

  return (
    `🧺 *${data.nama_toko}*\n\n` +
    `Halo *${data.nama_pelanggan}*,\n` +
    `${msg}\n\n` +
    `📋 No. Nota: *${data.tracking_code}*\n\n` +
    `Terima kasih telah mempercayai kami! 🙏`
  );
}
