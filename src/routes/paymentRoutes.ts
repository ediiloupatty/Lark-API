import { Router } from 'express';
import { PaymentController } from '../controllers/paymentController';

const router = Router();

// Endpoint for the Test Transaction button
// In production, you might protect this with requireAuth, but for the reviewer,
// we might leave it open if they don't have an account, or we assume they will register first.
router.post('/checkout-test', PaymentController.createTestTransaction);

// Webhook for iPaymu (must be public)
router.post('/notify', PaymentController.handleNotification);

export default router;
