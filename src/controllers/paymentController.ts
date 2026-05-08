import { Request, Response } from 'express';
import { db } from '../config/db';
import { MayarService } from '../services/mayarService';

interface MayarWebhookPayload {
  event: string;
  data: {
    id: string;
    status: string;
    customerName?: string;
    customerEmail?: string;
    customerMobile?: string;
    amount?: number;
    productId?: string;
    productName?: string;
  };
}

const PLAN_DURATION_DAYS: Record<string, number> = {
  month_1: 30,
  months_3: 90,
  months_12: 365,
};

// Menyimpan mapping invoiceId → { tenantId, planCode } sementara sampai webhook diterima.
// Invoice Mayar expire dalam 24 jam, jadi entry ini tidak akan menumpuk terlalu lama.
const pendingInvoices = new Map<string, { tenantId: number; planCode: string }>();

export class PaymentController {

  static async createPayment(req: Request, res: Response) {
    try {
      const { tenantId, planCode } = req.body;
      const appUrl = process.env.APP_URL || 'https://larklaundry.com';

      if (!tenantId || !planCode) {
        return res.status(400).json({ success: false, message: 'tenantId dan planCode wajib diisi' });
      }

      const pkg = await db.subscription_packages.findFirst({
        where: { plan_code: planCode as any, is_active: true },
      });

      if (!pkg) {
        return res.status(404).json({ success: false, message: 'Paket tidak ditemukan' });
      }

      const tenant = await db.tenants.findFirst({
        where: { id: Number(tenantId) },
      });

      if (!tenant) {
        return res.status(404).json({ success: false, message: 'Tenant tidak ditemukan' });
      }

      if (!tenant.phone || tenant.phone.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Nomor telepon tenant belum diisi. Lengkapi profil toko terlebih dahulu.',
        });
      }

      const sanitizedPhone = tenant.phone.replace(/\D/g, '');
      if (sanitizedPhone.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Nomor telepon tenant tidak valid. Perbarui profil toko terlebih dahulu.',
        });
      }

      const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const invoiceData = await MayarService.createInvoice({
        name: tenant.name,
        email: tenant.email || process.env.MAYAR_DEFAULT_EMAIL || 'ediloupatty@gmail.com',
        mobile: sanitizedPhone,
        redirectUrl: `${appUrl}/dashboard?payment=success&tenant=${tenantId}`,
        description: `Berlangganan Lark Laundry - ${pkg.nama_paket}`,
        expiredAt,
        items: [
          {
            quantity: 1,
            rate: Number(pkg.harga),
            description: `${pkg.nama_paket} - Lark Laundry`,
          },
        ],
        extraData: {
          noCustomer: String(tenantId),
          idProd: planCode,
        },
      });

      // Simpan mapping invoiceId → { tenantId, planCode } untuk dipakai saat webhook masuk
      pendingInvoices.set(invoiceData.id, { tenantId: Number(tenantId), planCode });

      console.info(`[Mayar] Invoice created: ${invoiceData.id} | tenant ${tenantId} | plan ${planCode}`);

      return res.status(200).json({
        success: true,
        data: {
          paymentUrl: invoiceData.link,
          invoiceId: invoiceData.id,
        },
      });

    } catch (error: unknown) {
      console.error('[Mayar] Create payment error:', error);
      const errMsg = error instanceof Error ? error.message : 'Terjadi kesalahan saat memproses pembayaran.';
      return res.status(500).json({ success: false, message: errMsg });
    }
  }

  static async handleNotification(req: Request, res: Response) {
    try {
      const payload: MayarWebhookPayload = req.body;
      console.info('[Mayar] Webhook received:', JSON.stringify(payload));

      // Selain "purchase", terima juga event lain agar tidak error (testing, reminder, dll)
      if (payload.event !== 'purchase') {
        console.info(`[Mayar] Ignoring non-purchase event: ${payload.event}`);
        return res.status(200).send('OK');
      }

      const { data } = payload;

      if (data.status !== 'SUCCESS') {
        console.info(`[Mayar] Payment not successful: status=${data.status}, invoiceId=${data.id}`);
        return res.status(200).send('OK');
      }

      // Ambil tenantId dan planCode dari map yang disimpan saat membuat invoice
      const mapping = pendingInvoices.get(data.id);
      if (!mapping) {
        console.warn(`[Mayar] No pending invoice found for id: ${data.id}`);
        return res.status(200).send('OK');
      }

      const { tenantId, planCode } = mapping;
      pendingInvoices.delete(data.id);

      const durationDays = PLAN_DURATION_DAYS[planCode] ?? 30;

      try {
        const currentTenant = await db.tenants.findFirst({ where: { id: tenantId } });

        // Jika langganan masih aktif, extend dari tanggal kedaluwarsa yang ada
        const baseDate =
          currentTenant?.subscription_until && new Date(currentTenant.subscription_until) > new Date()
            ? new Date(currentTenant.subscription_until)
            : new Date();

        const newExpiry = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

        await db.tenants.update({
          where: { id: tenantId },
          data: {
            subscription_plan: planCode as any,
            subscription_until: newExpiry,
            is_active: true,
          },
        });

        console.info(`[Mayar] Subscription updated: tenant ${tenantId} | plan ${planCode} | until ${newExpiry.toISOString()}`);
      } catch (updateErr) {
        console.error('[Mayar] Failed to update subscription:', updateErr);
      }

      return res.status(200).send('OK');

    } catch (error) {
      console.error('[Mayar] Webhook handler error:', error);
      return res.status(200).send('OK');
    }
  }
}
