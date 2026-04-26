"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const trackingController_1 = require("../controllers/trackingController");
const router = (0, express_1.Router)();
router.get('/:resi', trackingController_1.TrackingController.getTracking);
router.post('/verify', trackingController_1.TrackingController.verifyTracking);
exports.default = router;
