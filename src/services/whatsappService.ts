/**
 * Lark Laundry – WhatsApp Notification Service (via Fonnte API)
 *
 * Digunakan untuk mengirim pesan WA otomatis ke pelanggan
 * saat pesanan dibuat atau status berubah.
 *
 * Token Fonnte disimpan per-tenant di tabel tenant_settings
 * dengan key 'whatsapp_config' → { token: string, enabled: boolean }
 *
 * Referensi API: https://fonnte.com/docs/
 */

import { db } from '../config/db';

const FONNTE_API_URL = 'https://api.fonnte.com/send';

interface SendWAOptions {
  tenantId: number;
  phone: string;       // nomor WA pelanggan (format: 08xx atau 628xx)
  message: string;     // teks pesan
}

/**
 * Ambil konfigurasi WA dari tenant_settings.
 * Return null jika belum dikonfigurasi atau disabled.
 */
async function getWAConfig(tenantId: number): Promise<{ token: string; enabled: boolean } | null> {
  try {
    const row = await db.tenant_settings.findFirst({
      where: { tenant_id: tenantId, setting_key: 'whatsapp_config' },
      select: { setting_value: true },
    });

    if (!row?.setting_value) return null;

    const cfg = typeof row.setting_value === 'string'
      ? JSON.parse(row.setting_value)
      : row.setting_value as any;

    if (!cfg?.token || !cfg?.enabled) return null;
    return { token: String(cfg.token), enabled: Boolean(cfg.enabled) };
  } catch {
    return null;
  }
}

/**
 * Normalisasi nomor HP ke format internasional 628xx
 */
function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) return '62' + cleaned.slice(1);
  if (cleaned.startsWith('62')) return cleaned;
  return '62' + cleaned;
}

/**
 * Kirim WA melalui Fonnte API.
 * Bersifat "fire-and-forget" — tidak akan throw error ke caller.
 */
export async function sendWhatsApp(opts: SendWAOptions): Promise<void> {
  const { tenantId, phone, message } = opts;

  if (!phone || phone.trim().length < 9) return; // nomor tidak valid

  const config = await getWAConfig(tenantId);
  if (!config) return; // WA belum dikonfigurasi atau disabled

  const normalizedPhone = normalizePhone(phone);

  try {
    const response = await fetch(FONNTE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': config.token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        target: normalizedPhone,
        message: message,
        countryCode: '62',
      }).toString(),
    });

    const result = await response.json() as any;
    if (!result?.status) {
      console.warn(`[WA Fonnte] Gagal kirim ke ${normalizedPhone}:`, result?.reason);
    } else {
      console.log(`[WA Fonnte] Terkirim ke ${normalizedPhone}`);
    }
  } catch (err) {
    // Tidak lempar error — pengiriman WA tidak boleh menggagalkan proses bisnis
    console.error('[WA Fonnte] Network error:', err);
  }
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
