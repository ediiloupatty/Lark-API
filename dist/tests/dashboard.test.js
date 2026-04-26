"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tests/dashboard.test.ts — Dashboard (4 test cases)
 */
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../src/app"));
const setup_1 = require("./setup");
(0, vitest_1.describe)('Dashboard Controller', () => {
    let ctx;
    (0, vitest_1.beforeAll)(async () => { ctx = await (0, setup_1.seedTestData)(); });
    (0, vitest_1.afterAll)(async () => { await (0, setup_1.cleanupTestData)(); });
    // ✅ Normal: Admin dashboard
    (0, vitest_1.it)('GET /sync/dashboard — admin stats lengkap', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/dashboard')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(res.body.data.stats).toBeDefined();
        (0, vitest_1.expect)(res.body.data.chart_data).toBeDefined();
        (0, vitest_1.expect)(res.body.data.recent_orders).toBeDefined();
        (0, vitest_1.expect)(res.body.data.stats.role_highlights).toBeDefined();
    });
    // ✅ Normal: Karyawan dashboard (role_stats berbeda)
    (0, vitest_1.it)('GET /sync/dashboard — karyawan stats berbeda', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/dashboard')
            .set((0, setup_1.authHeaders)(ctx.staffToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.data.stats.role_highlights.title).toContain('Diproses');
    });
    // ✅ Normal: Outlet filter
    (0, vitest_1.it)('GET /sync/dashboard — outlet filter', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get(`/api/v1/sync/dashboard?oid=${ctx.outletId}`)
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.data.user.outlet_id).toBe(ctx.outletId);
    });
    // 🔒 Security: Tanpa tenant ditolak
    (0, vitest_1.it)('GET /sync/dashboard — tanpa tenant ditolak', async () => {
        const badToken = (0, setup_1.generateToken)({
            user_id: 0,
            username: 'hacker',
            role: 'admin',
            tenant_id: 0,
            outlet_id: null,
        });
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/dashboard')
            .set((0, setup_1.authHeaders)(badToken));
        (0, vitest_1.expect)(res.status).toBeGreaterThanOrEqual(400);
    });
});
