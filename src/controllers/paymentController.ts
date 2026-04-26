import { Request, Response } from 'express';
import { IpaymuService } from '../services/ipaymuService';

export class PaymentController {
  
  // Endpoint to create a test transaction for iPaymu Reviewers
  static async createTestTransaction(req: Request, res: Response) {
    try {
      const { productName, price } = req.body;
      const appUrl = process.env.APP_URL || 'http://localhost:5173';

      const paymentData = await IpaymuService.createPayment({
        product: [productName || 'Lark Laundry - Berlangganan'],
        qty: [1],
        price: [price ? parseInt(price) : 10000],
        returnUrl: `${appUrl}/dashboard?payment=success`,
        cancelUrl: `${appUrl}/dashboard?payment=canceled`,
        notifyUrl: `https://www.larklaundry.com/api/payments/notify`, // Webhook URL
        buyerName: 'iPaymu Reviewer',
        buyerEmail: 'support@ipaymu.com',
        buyerPhone: '081234567890'
      });

      // return the payment Url so frontend can redirect
      return res.status(200).json({
        success: true,
        data: paymentData // Contains SessionId, Url, etc.
      });

    } catch (error: any) {
      console.error('Error creating test transaction:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Terjadi kesalahan saat memproses pembayaran'
      });
    }
  }

  // Webhook endpoint for iPaymu to send notification
  static async handleNotification(req: Request, res: Response) {
    try {
      // iPaymu sends payment status updates to this URL via POST
      const notificationData = req.body;
      console.log('Received iPaymu Notification:', notificationData);

      // Handle the status update (e.g., update user subscription status)
      // For now, just acknowledge receipt
      
      return res.status(200).send('OK');
    } catch (error) {
      console.error('Error handling notification:', error);
      return res.status(500).send('Internal Server Error');
    }
  }
}
