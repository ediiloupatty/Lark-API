"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const sysAdminController_1 = require("../controllers/sysAdminController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Semua rute ini harus lewat authenticateToken
router.use(authMiddleware_1.authenticateToken);
router.get('/stats', sysAdminController_1.getGlobalStats);
router.get('/tenants', sysAdminController_1.getTenantsList);
exports.default = router;
