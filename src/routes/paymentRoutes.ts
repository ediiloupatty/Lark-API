import { Router } from 'express';
import { PaymentController } from '../controllers/paymentController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

router.post('/checkout', authenticateToken, PaymentController.createPayment);
// Backward compatibility for typo used by older mobile builds
router.post('/chechout', authenticateToken, PaymentController.createPayment);

// Webhook dari Mayar (harus public, tanpa auth)
router.post('/notify', PaymentController.handleNotification);

export default router;
