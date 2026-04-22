import { Router } from 'express';
import {
  loginAdmin,
  loginStaff,
  registerAdmin,
  forgotPassword,
  resetPassword,
  googleLogin,
  logoutAdmin,
} from '../controllers/authController';
import { loginRateLimiter, registerRateLimiter } from '../middlewares/rateLimiter';

const router = Router();

// Apply rate limiters selectively per-endpoint:
// - login:            5 failed attempts → lockout 15 menit per IP
// - register:         3 registrations per IP per 1 jam
// - forgot-password:  re-use loginRateLimiter (5 attempts → lockout 15 min)
// - google login:     re-use loginRateLimiter
router.post('/login',           loginRateLimiter, loginAdmin);
router.post('/login-staff',     loginRateLimiter, loginStaff);
router.post('/register',        registerRateLimiter, registerAdmin);
router.post('/forgot-password', loginRateLimiter, forgotPassword);
router.post('/reset-password',  resetPassword);
router.post('/google',          loginRateLimiter, googleLogin);
// Logout: hapus httpOnly cookie dari browser (mobile cukup hapus token lokal mereka)
router.post('/logout',          logoutAdmin);

export default router;
