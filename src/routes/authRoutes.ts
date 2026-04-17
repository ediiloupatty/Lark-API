import { Router } from 'express';
import { loginAdmin, loginStaff, registerAdmin, forgotPassword, resetPassword } from '../controllers/authController';
import { loginRateLimiter } from '../middlewares/rateLimiter';

const router = Router();

// Apply the rate limiter selectively to the login endpoint, like in PHP.
router.post('/login',           loginRateLimiter, loginAdmin);
router.post('/login-staff',     loginRateLimiter, loginStaff);
router.post('/register',        registerAdmin);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password',  resetPassword);

export default router;
