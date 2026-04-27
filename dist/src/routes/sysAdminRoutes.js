"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const sysAdminController_1 = require("../controllers/sysAdminController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Semua rute ini harus lewat authenticateToken
router.use(authMiddleware_1.authenticateToken);
router.get('/health', sysAdminController_1.getSystemHealth);
router.get('/stats', sysAdminController_1.getGlobalStats);
router.get('/tenants', sysAdminController_1.getTenantsList);
router.post('/tenants/:id/toggle-status', sysAdminController_1.toggleTenantStatus);
router.post('/tenants/:id/extend-subscription', sysAdminController_1.extendSubscription);
router.get('/finance', sysAdminController_1.getFinanceData);
router.get('/audit-logs', sysAdminController_1.getAuditLogs);
router.get('/global-settings', sysAdminController_1.getGlobalSettings);
exports.default = router;
