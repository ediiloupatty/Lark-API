import { Router } from 'express';
import { pullChanges } from '../controllers/syncPullController';
import { pushChanges } from '../controllers/syncPushController';
import { getDashboard } from '../controllers/dashboardController';
import { getCustomers, addCustomer, updateCustomer, deleteCustomer } from '../controllers/customerController';
import { getServices, addService, updateService, deleteService } from '../controllers/serviceController';
import { getOrders, createOrder, updateOrderStatus, payOrder, deleteOrder } from '../controllers/orderController';
import { getOutlets, addOutlet, updateOutlet, deleteOutlet } from '../controllers/outletController';
import { getStaff, addStaff, updateStaff, deleteStaff, toggleStaffStatus, getGlobalPermissions, updateGlobalPermissions, updateStaffPermissions } from '../controllers/staffController';
import { authenticateToken } from '../middlewares/authMiddleware';
import { getPackages, addPackage, updatePackage, deletePackage } from '../controllers/packageController';
import { getExpenses, addExpense, updateExpense, deleteExpense, getReports, getPayments, approvePayment } from '../controllers/financeController';
import { getSettings, updateSettings, getSubscriptions } from '../controllers/settingsController';
import { getProfile, updateProfile, changePassword } from '../controllers/profileController';
import { registerToken, unregisterToken, getNotifications, markAllRead, markOneRead } from '../controllers/notificationController';

const router = Router();

// ── Sinkronisasi & Dashboard ──────────────────────────────────
router.get('/pull', authenticateToken, pullChanges);
router.get('/bootstrap', authenticateToken, pullChanges);
router.post('/push', authenticateToken, pushChanges);
router.get('/dashboard', authenticateToken, getDashboard);

// ── Profile & Auth ────────────────────────────────────────────
router.get('/profile', authenticateToken, getProfile);
router.post('/profile', authenticateToken, updateProfile);
// [7] Change password endpoint (mobile & web)
router.post('/change-password', authenticateToken, changePassword);

// ── Customers ─────────────────────────────────────────────────
router.get('/customers', authenticateToken, getCustomers);
router.post('/add-customer', authenticateToken, addCustomer);
router.put('/update-customer', authenticateToken, updateCustomer);
router.post('/delete-customer', authenticateToken, deleteCustomer);

// ── Services ──────────────────────────────────────────────────
router.get('/services', authenticateToken, getServices);
router.post('/services', authenticateToken, addService);
router.put('/services', authenticateToken, updateService);
router.delete('/services', authenticateToken, deleteService);

// ── Orders ────────────────────────────────────────────────────
router.get('/orders', authenticateToken, getOrders);
router.post('/create-order', authenticateToken, createOrder);
router.post('/update-order-status', authenticateToken, updateOrderStatus);
router.put('/update-order-status', authenticateToken, updateOrderStatus);  // fallback
router.post('/pay-order', authenticateToken, payOrder);
// [3] Delete order — mobile sends POST /sync/delete-order
router.post('/delete-order', authenticateToken, deleteOrder);
router.delete('/delete-order', authenticateToken, deleteOrder); // fallback DELETE verb

// ── Outlets ───────────────────────────────────────────────────
router.get('/outlets', authenticateToken, getOutlets);
router.post('/add-outlet', authenticateToken, addOutlet);
router.put('/update-outlet', authenticateToken, updateOutlet);
router.post('/delete-outlet', authenticateToken, deleteOutlet);
router.delete('/delete-outlet', authenticateToken, deleteOutlet); // fallback

// ── Staff ─────────────────────────────────────────────────────
router.get('/staff', authenticateToken, getStaff);
router.post('/add-staff', authenticateToken, addStaff);
router.put('/update-staff', authenticateToken, updateStaff);
// [4] DELETE verb support for delete-staff (mobile sends DELETE)
router.post('/delete-staff', authenticateToken, deleteStaff);
router.delete('/delete-staff', authenticateToken, deleteStaff);   // mobile sends DELETE /sync/delete-staff?user_id=X
router.post('/toggle-staff-status', authenticateToken, toggleStaffStatus);
router.get('/global-permissions', authenticateToken, getGlobalPermissions);
router.post('/global-permissions', authenticateToken, updateGlobalPermissions);
router.put('/global-permissions', authenticateToken, updateGlobalPermissions);
router.put('/update-permissions', authenticateToken, updateStaffPermissions);

// ── Packages ──────────────────────────────────────────────────
router.get('/packages', authenticateToken, getPackages);
router.post('/add-package', authenticateToken, addPackage);
router.post('/delete-package', authenticateToken, deletePackage);
// Backward compatible routes for Package Management
router.get('/manage-package', authenticateToken, getPackages);
router.get('/get-packages', authenticateToken, getPackages);
router.post('/manage-package', authenticateToken, addPackage);
router.put('/manage-package', authenticateToken, updatePackage);
router.delete('/manage-package', authenticateToken, deletePackage);

// ── Finance & Reports ─────────────────────────────────────────
// [1] /sync/expenses routes (mobile ExpenseService path)
router.get('/expenses', authenticateToken, getExpenses);
router.post('/expenses', authenticateToken, addExpense);      // mobile POST /sync/expenses (alias add)
router.put('/expenses', authenticateToken, updateExpense);    // [2] mobile PUT /sync/expenses (new updateExpense)
router.delete('/expenses', authenticateToken, deleteExpense); // mobile DELETE /sync/expenses?id=X
// Legacy routes
router.post('/add-expense', authenticateToken, addExpense);
router.post('/delete-expense', authenticateToken, deleteExpense);
router.get('/reports', authenticateToken, getReports);
router.get('/payments', authenticateToken, getPayments);
router.post('/approve-payment', authenticateToken, approvePayment);

// ── Settings & Subscriptions ──────────────────────────────────
router.get('/settings', authenticateToken, getSettings);
router.post('/settings', authenticateToken, updateSettings);
router.get('/subscriptions', authenticateToken, getSubscriptions);

// ── Notifications & Device Token ───────────────────────────────
router.post('/device-token', authenticateToken, registerToken);          // Daftar FCM token
router.delete('/device-token', authenticateToken, unregisterToken);      // Hapus FCM token (logout)
router.get('/notifications', authenticateToken, getNotifications);       // Daftar notifikasi
router.post('/notifications/read-all', authenticateToken, markAllRead);  // Tandai semua terbaca
router.post('/notifications/read/:id', authenticateToken, markOneRead);  // Tandai 1 terbaca

export default router;
