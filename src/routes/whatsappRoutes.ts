import { Router } from 'express';
import { getStatus, generateQr, logout } from '../controllers/whatsappController';
import { authenticateToken } from '../middlewares/authMiddleware';

const router = Router();

// Semua rute WA membutuhkan autentikasi
router.use(authenticateToken);

router.get('/status', getStatus);
router.post('/generate-qr', generateQr);
router.post('/logout', logout);

export default router;
