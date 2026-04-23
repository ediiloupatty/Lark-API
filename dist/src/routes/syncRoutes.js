"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const syncPullController_1 = require("../controllers/syncPullController");
const syncPushController_1 = require("../controllers/syncPushController");
const dashboardController_1 = require("../controllers/dashboardController");
const customerController_1 = require("../controllers/customerController");
const serviceController_1 = require("../controllers/serviceController");
const orderController_1 = require("../controllers/orderController");
const outletController_1 = require("../controllers/outletController");
const staffController_1 = require("../controllers/staffController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const authorizeRole_1 = require("../middlewares/authorizeRole");
const packageController_1 = require("../controllers/packageController");
const financeController_1 = require("../controllers/financeController");
const settingsController_1 = require("../controllers/settingsController");
const profileController_1 = require("../controllers/profileController");
const notificationController_1 = require("../controllers/notificationController");
const router = (0, express_1.Router)();
// ── Shorthand untuk role groups ──────────────────────────────────
const ADMIN_ROLES = ['admin', 'owner', 'super_admin'];
const adminOnly = (0, authorizeRole_1.authorizeRole)(...ADMIN_ROLES);
// ── Sinkronisasi & Dashboard ──────────────────────────────────
router.get('/pull', authMiddleware_1.authenticateToken, syncPullController_1.pullChanges);
router.get('/bootstrap', authMiddleware_1.authenticateToken, syncPullController_1.pullChanges);
router.post('/push', authMiddleware_1.authenticateToken, syncPushController_1.pushChanges);
router.get('/dashboard', authMiddleware_1.authenticateToken, dashboardController_1.getDashboard);
// ── Profile & Auth ────────────────────────────────────────────
router.get('/profile', authMiddleware_1.authenticateToken, profileController_1.getProfile);
router.post('/profile', authMiddleware_1.authenticateToken, profileController_1.updateProfile);
router.post('/change-password', authMiddleware_1.authenticateToken, profileController_1.changePassword);
// ── Customers (semua role boleh akses — karyawan butuh ini untuk input order) ──
router.get('/customers', authMiddleware_1.authenticateToken, customerController_1.getCustomers);
router.post('/add-customer', authMiddleware_1.authenticateToken, customerController_1.addCustomer);
router.put('/update-customer', authMiddleware_1.authenticateToken, customerController_1.updateCustomer);
router.post('/delete-customer', authMiddleware_1.authenticateToken, customerController_1.deleteCustomer);
// ── Services (semua role boleh GET, tapi CUD = admin only) ────
router.get('/services', authMiddleware_1.authenticateToken, serviceController_1.getServices);
router.post('/services', authMiddleware_1.authenticateToken, adminOnly, serviceController_1.addService);
router.put('/services', authMiddleware_1.authenticateToken, adminOnly, serviceController_1.updateService);
router.delete('/services', authMiddleware_1.authenticateToken, adminOnly, serviceController_1.deleteService);
// ── Orders (semua role butuh akses CRUD order) ────────────────
router.get('/orders', authMiddleware_1.authenticateToken, orderController_1.getOrders);
router.post('/create-order', authMiddleware_1.authenticateToken, orderController_1.createOrder);
router.post('/update-order-status', authMiddleware_1.authenticateToken, orderController_1.updateOrderStatus);
router.put('/update-order-status', authMiddleware_1.authenticateToken, orderController_1.updateOrderStatus);
router.post('/pay-order', authMiddleware_1.authenticateToken, orderController_1.payOrder);
router.post('/delete-order', authMiddleware_1.authenticateToken, orderController_1.deleteOrder);
router.delete('/delete-order', authMiddleware_1.authenticateToken, orderController_1.deleteOrder);
// ── Outlets (admin only — karyawan tidak boleh kelola outlet) ──
router.get('/outlets', authMiddleware_1.authenticateToken, outletController_1.getOutlets);
router.post('/add-outlet', authMiddleware_1.authenticateToken, adminOnly, outletController_1.addOutlet);
router.put('/update-outlet', authMiddleware_1.authenticateToken, adminOnly, outletController_1.updateOutlet);
router.post('/delete-outlet', authMiddleware_1.authenticateToken, adminOnly, outletController_1.deleteOutlet);
router.delete('/delete-outlet', authMiddleware_1.authenticateToken, adminOnly, outletController_1.deleteOutlet);
// ── Staff (admin only — karyawan tidak boleh kelola staff lain) ──
router.get('/staff', authMiddleware_1.authenticateToken, adminOnly, staffController_1.getStaff);
router.post('/add-staff', authMiddleware_1.authenticateToken, adminOnly, staffController_1.addStaff);
router.put('/update-staff', authMiddleware_1.authenticateToken, adminOnly, staffController_1.updateStaff);
router.post('/delete-staff', authMiddleware_1.authenticateToken, adminOnly, staffController_1.deleteStaff);
router.delete('/delete-staff', authMiddleware_1.authenticateToken, adminOnly, staffController_1.deleteStaff);
router.post('/toggle-staff-status', authMiddleware_1.authenticateToken, adminOnly, staffController_1.toggleStaffStatus);
router.get('/global-permissions', authMiddleware_1.authenticateToken, adminOnly, staffController_1.getGlobalPermissions);
router.post('/global-permissions', authMiddleware_1.authenticateToken, adminOnly, staffController_1.updateGlobalPermissions);
router.put('/global-permissions', authMiddleware_1.authenticateToken, adminOnly, staffController_1.updateGlobalPermissions);
router.put('/update-permissions', authMiddleware_1.authenticateToken, adminOnly, staffController_1.updateStaffPermissions);
// ── Packages (semua role boleh GET, CUD = admin only) ─────────
router.get('/packages', authMiddleware_1.authenticateToken, packageController_1.getPackages);
router.post('/add-package', authMiddleware_1.authenticateToken, adminOnly, packageController_1.addPackage);
router.post('/delete-package', authMiddleware_1.authenticateToken, adminOnly, packageController_1.deletePackage);
router.get('/manage-package', authMiddleware_1.authenticateToken, packageController_1.getPackages);
router.get('/get-packages', authMiddleware_1.authenticateToken, packageController_1.getPackages);
router.post('/manage-package', authMiddleware_1.authenticateToken, adminOnly, packageController_1.addPackage);
router.put('/manage-package', authMiddleware_1.authenticateToken, adminOnly, packageController_1.updatePackage);
router.delete('/manage-package', authMiddleware_1.authenticateToken, adminOnly, packageController_1.deletePackage);
// ── Finance & Reports ─────────────────────────────────────────
router.get('/expenses', authMiddleware_1.authenticateToken, financeController_1.getExpenses);
router.post('/expenses', authMiddleware_1.authenticateToken, financeController_1.addExpense);
router.put('/expenses', authMiddleware_1.authenticateToken, financeController_1.updateExpense);
router.delete('/expenses', authMiddleware_1.authenticateToken, financeController_1.deleteExpense);
router.post('/add-expense', authMiddleware_1.authenticateToken, financeController_1.addExpense);
router.post('/delete-expense', authMiddleware_1.authenticateToken, financeController_1.deleteExpense);
router.get('/reports', authMiddleware_1.authenticateToken, financeController_1.getReports);
router.get('/payments', authMiddleware_1.authenticateToken, financeController_1.getPayments);
router.post('/approve-payment', authMiddleware_1.authenticateToken, adminOnly, financeController_1.approvePayment);
// ── Settings & Subscriptions (admin only) ─────────────────────
router.get('/settings', authMiddleware_1.authenticateToken, adminOnly, settingsController_1.getSettings);
router.post('/settings', authMiddleware_1.authenticateToken, adminOnly, settingsController_1.updateSettings);
router.get('/subscriptions', authMiddleware_1.authenticateToken, adminOnly, settingsController_1.getSubscriptions);
// ── Notifications & Device Token ──────────────────────────────
router.post('/device-token', authMiddleware_1.authenticateToken, notificationController_1.registerToken);
router.delete('/device-token', authMiddleware_1.authenticateToken, notificationController_1.unregisterToken);
router.get('/notifications', authMiddleware_1.authenticateToken, notificationController_1.getNotifications);
router.post('/notifications/read-all', authMiddleware_1.authenticateToken, notificationController_1.markAllRead);
router.post('/notifications/read/:id', authMiddleware_1.authenticateToken, notificationController_1.markOneRead);
exports.default = router;
