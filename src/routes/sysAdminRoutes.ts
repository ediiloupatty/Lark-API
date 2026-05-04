import { Router } from 'express';
import {
  getGlobalStats, getTenantsList, getSystemHealth, toggleTenantStatus, extendSubscription,
  getFinanceData, getAuditLogs, getGlobalSettings,
  // Blog CMS
  listBlogArticlesAdmin, createBlogArticle, updateBlogArticle, deleteBlogArticle,
  // User Management
  listAllUsers, toggleUserStatus, resetUserPassword,
  // Tenant Detail
  getTenantDetail,
  // Maintenance
  getMaintenanceStatus, toggleMaintenanceMode,
} from '../controllers/sysAdminController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

// Semua rute ini harus lewat authenticateToken
router.use(authenticateToken);

// ── Existing routes ──
router.get('/health', getSystemHealth);
router.get('/stats', getGlobalStats);
router.get('/tenants', getTenantsList);
router.post('/tenants/:id/toggle-status', toggleTenantStatus);
router.post('/tenants/:id/extend-subscription', extendSubscription);
router.get('/finance', getFinanceData);
router.get('/audit-logs', getAuditLogs);
router.get('/global-settings', getGlobalSettings);

// ── Blog/CMS Management ──
router.get('/blogs', listBlogArticlesAdmin);
router.post('/blogs', createBlogArticle);
router.put('/blogs/:id', updateBlogArticle);
router.delete('/blogs/:id', deleteBlogArticle);

// ── User Management ──
router.get('/users', listAllUsers);
router.post('/users/:id/toggle-status', toggleUserStatus);
router.post('/users/:id/reset-password', resetUserPassword);

// ── Tenant Detail ──
router.get('/tenants/:id/detail', getTenantDetail);

// ── Maintenance Mode ──
router.get('/maintenance', getMaintenanceStatus);
router.post('/maintenance/toggle', toggleMaintenanceMode);

export default router;
