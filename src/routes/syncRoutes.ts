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
import { authorizeRole } from '../middlewares/authorizeRole';
import { subscriptionGuard } from '../middlewares/subscriptionGuard';
import { getPackages, addPackage, updatePackage, deletePackage } from '../controllers/packageController';
import { getExpenses, addExpense, updateExpense, deleteExpense, getReports, getPayments, approvePayment } from '../controllers/financeController';
import { getSettings, updateSettings, getSubscriptions } from '../controllers/settingsController';
import { getProducts, addProduct, updateProduct, deleteProduct, getProductCategories, addProductCategory, deleteProductCategory } from '../controllers/productController';
import { getParfums, addParfum, updateParfum, deleteParfum } from '../controllers/parfumController';
import { getProfile, updateProfile, changePassword, completeSetup } from '../controllers/profileController';
import { registerToken, unregisterToken, getNotifications, markAllRead, markOneRead } from '../controllers/notificationController';
import { upload } from '../middlewares/uploadMiddleware';

const router = Router();

// ── Shorthand untuk role groups ──────────────────────────────────
const ADMIN_ROLES = ['admin', 'owner', 'super_admin'] as const;
const adminOnly = authorizeRole(...ADMIN_ROLES);

// ── Sinkronisasi & Dashboard ──────────────────────────────────
router.get('/pull', authenticateToken, pullChanges);
router.get('/bootstrap', authenticateToken, pullChanges);
router.post('/push', authenticateToken, pushChanges);
router.get('/dashboard', authenticateToken, getDashboard);

// ── Profile & Auth ────────────────────────────────────────────
router.get('/profile', authenticateToken, getProfile);
router.post('/profile', authenticateToken, updateProfile);
router.post('/change-password', authenticateToken, changePassword);
router.post('/complete-setup', authenticateToken, adminOnly, completeSetup);

// ── Customers (semua role boleh akses — karyawan butuh ini untuk input order) ──
router.get('/customers', authenticateToken, getCustomers);
router.post('/add-customer', authenticateToken, subscriptionGuard, addCustomer);
router.put('/update-customer', authenticateToken, updateCustomer);
router.post('/delete-customer', authenticateToken, deleteCustomer);

// ── Services (semua role boleh GET, tapi CUD = admin only) ────
router.get('/services', authenticateToken, getServices);
router.post('/services', authenticateToken, adminOnly, addService);
router.put('/services', authenticateToken, adminOnly, updateService);
router.delete('/services', authenticateToken, adminOnly, deleteService);

// ── Orders (semua role butuh akses CRUD order) ────────────────
router.get('/orders', authenticateToken, getOrders);
router.post('/create-order', authenticateToken, subscriptionGuard, createOrder);
router.post('/update-order-status', authenticateToken, updateOrderStatus);
router.put('/update-order-status', authenticateToken, updateOrderStatus);
router.post('/pay-order', authenticateToken, upload.single('bukti'), payOrder);
router.post('/delete-order', authenticateToken, deleteOrder);
router.delete('/delete-order', authenticateToken, deleteOrder);

// ── Outlets (admin only — karyawan tidak boleh kelola outlet) ──
router.get('/outlets', authenticateToken, getOutlets);
router.post('/add-outlet', authenticateToken, adminOnly, subscriptionGuard, addOutlet);
router.put('/update-outlet', authenticateToken, adminOnly, updateOutlet);
router.post('/delete-outlet', authenticateToken, adminOnly, deleteOutlet);
router.delete('/delete-outlet', authenticateToken, adminOnly, deleteOutlet);

// ── Staff (admin only — karyawan tidak boleh kelola staff lain) ──
router.get('/staff', authenticateToken, adminOnly, getStaff);
router.post('/add-staff', authenticateToken, adminOnly, subscriptionGuard, addStaff);
router.put('/update-staff', authenticateToken, adminOnly, updateStaff);
router.post('/delete-staff', authenticateToken, adminOnly, deleteStaff);
router.delete('/delete-staff', authenticateToken, adminOnly, deleteStaff);
router.post('/toggle-staff-status', authenticateToken, adminOnly, toggleStaffStatus);
router.get('/global-permissions', authenticateToken, adminOnly, getGlobalPermissions);
router.post('/global-permissions', authenticateToken, adminOnly, updateGlobalPermissions);
router.put('/global-permissions', authenticateToken, adminOnly, updateGlobalPermissions);
router.put('/update-permissions', authenticateToken, adminOnly, updateStaffPermissions);

// ── Packages (semua role boleh GET, CUD = admin only) ─────────
router.get('/packages', authenticateToken, getPackages);
router.post('/add-package', authenticateToken, adminOnly, addPackage);
router.post('/delete-package', authenticateToken, adminOnly, deletePackage);
router.get('/manage-package', authenticateToken, getPackages);
router.get('/get-packages', authenticateToken, getPackages);
router.post('/manage-package', authenticateToken, adminOnly, addPackage);
router.put('/manage-package', authenticateToken, adminOnly, updatePackage);
router.delete('/manage-package', authenticateToken, adminOnly, deletePackage);

// ── Finance & Reports ─────────────────────────────────────────
router.get('/expenses', authenticateToken, getExpenses);
router.post('/expenses', authenticateToken, upload.single('bukti'), addExpense);
router.put('/expenses', authenticateToken, upload.single('bukti'), updateExpense);
router.delete('/expenses', authenticateToken, deleteExpense);
router.post('/add-expense', authenticateToken, upload.single('bukti'), addExpense);
router.post('/delete-expense', authenticateToken, deleteExpense);
router.get('/reports', authenticateToken, getReports);
router.get('/payments', authenticateToken, getPayments);
router.post('/approve-payment', authenticateToken, adminOnly, approvePayment);

// ── Settings & Subscriptions (admin only) ─────────────────────
router.get('/settings', authenticateToken, adminOnly, getSettings);
router.post('/settings', authenticateToken, adminOnly, updateSettings);
router.get('/subscriptions', authenticateToken, adminOnly, getSubscriptions);

// ── Products & Categories (semua role boleh GET, CUD = admin only) ──
router.get('/products', authenticateToken, getProducts);
router.post('/products', authenticateToken, adminOnly, addProduct);
router.put('/products', authenticateToken, adminOnly, updateProduct);
router.delete('/products', authenticateToken, adminOnly, deleteProduct);
router.get('/product-categories', authenticateToken, getProductCategories);
router.post('/product-categories', authenticateToken, adminOnly, addProductCategory);
router.delete('/product-categories', authenticateToken, adminOnly, deleteProductCategory);

// ── Parfums (semua role boleh GET, CUD = admin only) ──────────
router.get('/parfums', authenticateToken, getParfums);
router.post('/parfums', authenticateToken, adminOnly, addParfum);
router.put('/parfums', authenticateToken, adminOnly, updateParfum);
router.delete('/parfums', authenticateToken, adminOnly, deleteParfum);

// ── Notifications & Device Token ──────────────────────────────
router.post('/device-token', authenticateToken, registerToken);
router.delete('/device-token', authenticateToken, unregisterToken);
router.get('/notifications', authenticateToken, getNotifications);
router.post('/notifications/read-all', authenticateToken, markAllRead);
router.post('/notifications/read/:id', authenticateToken, markOneRead);

export default router;
