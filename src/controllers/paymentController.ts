import { Request, Response } from 'express';
import { db } from '../config/db';
import { IpaymuService } from '../services/ipaymuService';

interface IpaymuNotification {
  status: string;
  trx_id: string;
  reference_id: string;
  amount?: number;
  payment_method?: string;
  date?: string;
  channel?: string;
}

export class PaymentController {
  
  // Create payment via iPaymu
  static async createPayment(req: Request, res: Response) {
    try {
      const { tenantId, planCode } = req.body;
      const appUrl = process.env.APP_URL || 'https://larklaundry.com';

      if (!tenantId || !planCode) {
        return res.status(400).json({ success: false, message: 'tenantId dan planCode wajib diisi' });
      }

      // Get package details
      const pkg = await db.subscription_packages.findFirst({
        where: { plan_code: planCode as any, is_active: true }
      });

      if (!pkg) {
        return res.status(404).json({ success: false, message: 'Paket tidak ditemukan' });
      }

      // Get tenant
      const tenant = await db.tenants.findFirst({
        where: { id: Number(tenantId) }
      });

      if (!tenant) {
        return res.status(404).json({ success: false, message: 'Tenant tidak ditemukan' });
      }

      const referenceId = `SUB-${tenantId}-${Date.now()}`;

      const paymentData = await IpaymuService.createPayment({
        product: [`${pkg.nama_paket} - Lark Laundry`],
        qty: [1],
        price: [Number(pkg.harga)],
        returnUrl: `${appUrl}/dashboard?payment=success&tenant=${tenantId}`,
        cancelUrl: `${appUrl}/dashboard?payment=canceled&tenant=${tenantId}`,
        notifyUrl: `${appUrl}/api/v1/payments/notify`,
        referenceId,
        buyerName: tenant.name,
        buyerEmail: tenant.email || 'support@larklaundry.com',
        buyerPhone: tenant.phone || '081234567890',
      });

      // Log payment intent (payments table schema is for order payments, not subscription)
      // So we just log it here for tracking
      console.info(`[iPaymu] Payment intent created: ${referenceId} for tenant ${tenantId}, amount ${pkg.harga}`);

      return res.status(200).json({
        success: true,
        data: {
          sessionId: paymentData.SessionId,
          paymentUrl: paymentData.Url,
          referenceId,
        }
      });

    } catch (error: unknown) {
      console.error('[iPaymu] Create payment error:', error);
      const errMsg = error instanceof Error ? error.message : 'Terjadi kesalahan saat memproses pembayaran.';
      return res.status(500).json({
        success: false,
        message: errMsg
      });
    }
  }

  // Webhook endpoint for iPaymu
  static async handleNotification(req: Request, res: Response) {
    try {
      const data: IpaymuNotification = req.body;
      console.info('[iPaymu] Notification received:', JSON.stringify(data));

      if (!data.status || !data.reference_id) {
        console.warn('[iPaymu] Invalid notification - missing status or reference_id');
        return res.status(400).send('Invalid notification');
      }

      // Parse reference_id format: SUB-{tenantId}-{timestamp}
      const refParts = data.reference_id.split('-');
      const tenantId = parseInt(refParts[1]);

      if (isNaN(tenantId)) {
        console.warn('[iPaymu] Invalid reference_id format:', data.reference_id);
        return res.status(400).send('Invalid reference_id');
      }

      if (data.status === 'berhasil' || data.status === 'success') {
        console.info(`[iPaymu] Payment SUCCESS for tenant ${tenantId}`);

        // Update tenant subscription - use raw query for flexibility
        try {
          const currentExpiry = new Date();
          const newExpiry = new Date(currentExpiry.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days

          await db.tenants.update({
            where: { id: tenantId },
            data: {
              subscription_plan: 'month_1',
              subscription_until: newExpiry,
              is_active: true,
            }
          });

          console.info(`[iPaymu] Subscription extended for tenant ${tenantId} until ${newExpiry.toISOString()}`);
        } catch (updateErr) {
          console.error('[iPaymu] Failed to update subscription:', updateErr);
          // Still return 200 so iPaymu doesn't retry
        }

      } else if (data.status === 'gagal' || data.status === 'failed') {
        console.info(`[iPaymu] Payment FAILED for tenant ${tenantId}`);
        // Could update tenant status if needed

      } else if (data.status === 'pending') {
        console.info(`[iPaymu] Payment PENDING for tenant ${tenantId}`);
      }

      // Always return 200 to acknowledge receipt
      return res.status(200).send('OK');

    } catch (error) {
      console.error('[iPaymu] Notification handler error:', error);
      // Still return 200 to prevent iPaymu from retrying
      return res.status(200).send('OK');
    }
  }

  // Test transaction (for iPaymu verification)
  static async createTestTransaction(req: Request, res: Response) {
    try {
      const { productName, price } = req.body;
      const appUrl = process.env.APP_URL || 'https://larklaundry.com';

      const paymentData = await IpaymuService.createPayment({
        product: [productName || 'Lark Laundry - Berlangganan'],
        qty: [1],
        price: [price ? parseInt(price) : 10000],
        returnUrl: `${appUrl}/dashboard?payment=success`,
        cancelUrl: `${appUrl}/dashboard?payment=canceled`,
        notifyUrl: `${appUrl}/api/v1/payments/notify`,
        buyerName: 'iPaymu Reviewer',
        buyerEmail: 'support@ipaymu.com',
        buyerPhone: '081234567890'
      });

      return res.status(200).json({
        success: true,
        data: paymentData
      });

    } catch (error: unknown) {
      console.error('[iPaymu] Create transaction error:', error);
      return res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan saat memproses pembayaran.'
      });
    }
  }
}