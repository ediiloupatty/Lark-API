"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authController_1 = require("../controllers/authController");
const rateLimiter_1 = require("../middlewares/rateLimiter");
const router = (0, express_1.Router)();
// Apply rate limiters selectively per-endpoint:
// - login:            5 failed attempts → lockout 15 menit per IP
// - register:         3 registrations per IP per 1 jam
// - forgot-password:  re-use loginRateLimiter (5 attempts → lockout 15 min)
// - google login:     re-use loginRateLimiter
router.post('/login', rateLimiter_1.loginRateLimiter, authController_1.loginAdmin);
router.post('/login-staff', rateLimiter_1.loginRateLimiter, authController_1.loginStaff);
router.post('/register', rateLimiter_1.registerRateLimiter, authController_1.registerAdmin);
router.post('/forgot-password', rateLimiter_1.loginRateLimiter, authController_1.forgotPassword);
router.post('/reset-password', authController_1.resetPassword);
router.post('/google', rateLimiter_1.loginRateLimiter, authController_1.googleLogin);
// Logout: hapus httpOnly cookie dari browser (mobile cukup hapus token lokal mereka)
router.post('/logout', authController_1.logoutAdmin);
exports.default = router;
