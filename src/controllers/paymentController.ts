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

      // Get package details
      const pkg = await db.subscription_packages.findFirst({
        where: { plan_code: planCode, is_active: true }
      });

      if (!pkg) {
        return res.status(404).json({ success: false, message: 'Paket tidak ditemukan' });
      }

      // Get tenant
      const tenant = await db.tenants.findFirst({
        where: { id: tenantId }
      });

      if (!tenant) {
        return res.status(404).json({ success: false, message: 'Tenant tidak ditemukan' });
      }

      const referenceId = `SUB-${tenantId}-${Date.now()}`;

      const paymentData = await IpaymuService.createPayment({
        product: [`${pkg.icon || ''} ${pkg.nama_paket} - Lark Laundry`],
        qty: [1],
        price: [Number(pkg.harga)],
        returnUrl: `${appUrl}/dashboard?payment=success&tenant=${tenantId}`,
        cancelUrl: `${appUrl}/dashboard?payment=canceled&tenant=${tenantId}`,
        notifyUrl: `${appUrl}/api/payments/notify`,
        referenceId,
        buyerName: tenant.name,
        buyerEmail: tenant.email || 'support@larklaundry.com',
        buyerPhone: tenant.phone || '081234567890',
      });

      // Save payment intent to database
      await db.payments.create({
        data: {
          tenant_id: tenantId,
          reference_id: referenceId,
          amount: Number(pkg.harga),
          payment_channel: 'iPaymu',
          status: 'pending',
          description: `Subscription: ${pkg.nama_paket}`,
          trx_id: paymentData.SessionId || null,
        }
      });

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
      return res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan saat memproses pembayaran.'
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

        const tenant = await db.tenants.findFirst({ where: { id: tenantId } });
        
        if (tenant) {
          const currentExpiry = tenant.subscription_until ? new Date(tenant.subscription_until) : new Date();
          let newExpiry = new Date(currentExpiry);

          if (newExpiry < new Date()) {
            newExpiry = new Date();
          }
          
          newExpiry.setDate(newExpiry.getDate() + 30);

          await db.tenants.update({
            where: { id: tenantId },
            data: {
              subscription_plan: 'premium',
              subscription_until: newExpiry,
              is_active: true,
            }
          });

          await db.payments.updateMany({
            where: { reference_id: data.reference_id },
            data: { 
              status: 'success',
              paid_at: new Date(),
              trx_id: data.trx_id || null,
            }
          });

          console.info(`[iPaymu] Subscription extended for tenant ${tenantId} until ${newExpiry.toISOString()}`);
        }

      } else if (data.status === 'gagal' || data.status === 'failed') {
        console.info(`[iPaymu] Payment FAILED for tenant ${tenantId}`);

        await db.payments.updateMany({
          where: { reference_id: data.reference_id },
          data: { status: 'failed' }
        });

      } else if (data.status === 'pending') {
        console.info(`[iPaymu] Payment PENDING for tenant ${tenantId}`);
        
        await db.payments.updateMany({
          where: { reference_id: data.reference_id },
          data: { status: 'pending' }
        });
      }

      return res.status(200).send('OK');

    } catch (error) {
      console.error('[iPaymu] Notification handler error:', error);
      return res.status(500).send('Internal Server Error');
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
        notifyUrl: `${appUrl}/api/payments/notify`,
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