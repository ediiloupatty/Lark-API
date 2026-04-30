import { Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import fs from 'fs';
import path from 'path';

interface WASession {
  client: Client;
  qrCode: string | null;
  status: 'disconnected' | 'connecting' | 'connected';
  retries: number;
}

const sessions = new Map<number, WASession>();

export class WhatsAppService {
  /**
   * Menginisialisasi Client WA untuk suatu tenant (toko).
   * @param tenantId ID Toko
   */
  static async initialize(tenantId: number): Promise<void> {
    if (sessions.has(tenantId)) {
      const session = sessions.get(tenantId)!;
      if (session.status !== 'disconnected') {
        return; // Sudah inisialisasi atau sedang terhubung
      }
    }

    console.log(`[WA] Initializing client for tenant ${tenantId}...`);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: `tenant_${tenantId}`,
        dataPath: path.join(__dirname, '../../../wa_sessions')
      }),
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-extensions'],
        headless: true
      }
    });

    sessions.set(tenantId, {
      client,
      qrCode: null,
      status: 'connecting',
      retries: 0
    });

    const sessionData = sessions.get(tenantId)!;

    client.on('qr', async (qr) => {
      console.log(`[WA] QR Code received for tenant ${tenantId}`);
      // Convert QR to Base64 Data URL
      try {
        const qrDataUrl = await qrcode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 4 });
        sessionData.qrCode = qrDataUrl;
        sessionData.status = 'disconnected'; // Waiting for scan
      } catch (error) {
        console.error(`[WA] Error generating QR data URL for tenant ${tenantId}:`, error);
      }
    });

    client.on('ready', () => {
      console.log(`[WA] Client ready for tenant ${tenantId}`);
      sessionData.status = 'connected';
      sessionData.qrCode = null; // Hapus QR setelah sukses
    });

    client.on('authenticated', () => {
      console.log(`[WA] Client authenticated for tenant ${tenantId}`);
    });

    client.on('auth_failure', (msg) => {
      console.error(`[WA] Authentication failure for tenant ${tenantId}:`, msg);
      sessionData.status = 'disconnected';
    });

    client.on('disconnected', (reason) => {
      console.log(`[WA] Client disconnected for tenant ${tenantId}:`, reason);
      sessionData.status = 'disconnected';
      sessionData.qrCode = null;
    });

    try {
      await client.initialize();
    } catch (error) {
      console.error(`[WA] Failed to initialize client for tenant ${tenantId}:`, error);
      sessionData.status = 'disconnected';
    }
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
        await session.client.destroy();
      } catch (error) {
        console.error(`[WA] Error destroying client for tenant ${tenantId}:`, error);
      }
      sessions.delete(tenantId);
    }
    
    // Opsional: Hapus folder sesi LocalAuth secara manual jika diperlukan.
    const sessionPath = path.join(__dirname, `../../../wa_sessions/session-tenant_${tenantId}`);
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
      // Format nomor telepon ke format WA ID
      let formattedNumber = to.replace(/\D/g, '');
      if (formattedNumber.startsWith('0')) {
        formattedNumber = '62' + formattedNumber.substring(1);
      }
      const chatId = `${formattedNumber}@c.us`;

      await session.client.sendMessage(chatId, message);
      console.log(`[WA] Message sent successfully to ${to} for tenant ${tenantId}`);
      return true;
    } catch (error) {
      console.error(`[WA] Error sending message to ${to} for tenant ${tenantId}:`, error);
      return false;
    }
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
