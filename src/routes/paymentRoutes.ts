import { Router } from 'express';
import { PaymentController } from '../controllers/paymentController';

import { rateLimit } from 'express-rate-limit';

const router = Router();

// Public route for iPaymu Reviewers/Landing Page testing
// Rate limited to prevent spam (max 5 requests per 15 minutes per IP)
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per `window`
  message: { success: false, message: 'Terlalu banyak permintaan transaksi. Silakan coba lagi nanti.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/checkout-test', checkoutLimiter, PaymentController.createTestTransaction);

// Webhook for iPaymu (must be public)
router.post('/notify', PaymentController.handleNotification);

export default router;
