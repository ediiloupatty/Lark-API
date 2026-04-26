import { Router } from 'express';
import { getGlobalStats, getTenantsList } from '../controllers/sysAdminController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

// Semua rute ini harus lewat authenticateToken
router.use(authenticateToken);

router.get('/stats', getGlobalStats);
router.get('/tenants', getTenantsList);

export default router;
