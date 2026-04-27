import { Router } from 'express';
import { PaymentController } from '../controllers/paymentController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

// BUG-26 FIX: Require authentication for checkout — was previously public
// Anyone could create infinite iPaymu transactions without logging in
router.post('/checkout-test', authenticateToken, PaymentController.createTestTransaction);

// Webhook for iPaymu (must be public)
router.post('/notify', PaymentController.handleNotification);

export default router;
