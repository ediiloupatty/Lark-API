import { Router } from 'express';
import { getGlobalStats, getTenantsList, getSystemHealth, toggleTenantStatus, extendSubscription } from '../controllers/sysAdminController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

// Semua rute ini harus lewat authenticateToken
router.use(authenticateToken);

router.get('/health', getSystemHealth);
router.get('/stats', getGlobalStats);
router.get('/tenants', getTenantsList);
router.post('/tenants/:id/toggle-status', toggleTenantStatus);
router.post('/tenants/:id/extend-subscription', extendSubscription);

export default router;
