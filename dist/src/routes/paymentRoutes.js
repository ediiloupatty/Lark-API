"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const paymentController_1 = require("../controllers/paymentController");
const router = (0, express_1.Router)();
// Endpoint for the Test Transaction button
// In production, you might protect this with requireAuth, but for the reviewer,
// we might leave it open if they don't have an account, or we assume they will register first.
router.post('/checkout-test', paymentController_1.PaymentController.createTestTransaction);
// Webhook for iPaymu (must be public)
router.post('/notify', paymentController_1.PaymentController.handleNotification);
exports.default = router;
