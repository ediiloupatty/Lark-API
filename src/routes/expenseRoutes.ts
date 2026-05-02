/**
 * expenseRoutes.ts — Routes for expense (pengeluaran) management.
 *
 * Extracted from app.ts to maintain consistent routing architecture.
 * All endpoints require authentication via JWT token.
 */
import { Router } from 'express';
import { authenticateToken } from '../middlewares/authMiddleware';
import { getExpenses, addExpense, updateExpense, deleteExpense } from '../controllers/financeController';
import { upload } from '../middlewares/uploadMiddleware';

const router = Router();

router.get('/', authenticateToken, getExpenses);
router.post('/', authenticateToken, upload.single('bukti'), addExpense);
router.put('/', authenticateToken, upload.single('bukti'), updateExpense);
router.delete('/', authenticateToken, deleteExpense);

export default router;
