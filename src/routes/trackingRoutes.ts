import { Router } from 'express';
import { TrackingController } from '../controllers/trackingController';

const router = Router();

router.get('/:resi', TrackingController.getTracking);
router.post('/verify', TrackingController.verifyTracking);

export default router;
