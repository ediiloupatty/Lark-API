import { Router } from 'express';
import { PaymentController } from '../controllers/paymentController';
import { rateLimit } from 'express-rate-limit';

const router = Router();

// Create payment (authenticated or via API key)
router.post('/checkout', PaymentController.createPayment);
// Backward compatibility for typo used by older mobile builds
router.post('/chechout', PaymentController.createPayment);

// Webhook for iPaymu (must be public)
router.post('/notify', PaymentController.handleNotification);

export default router;
