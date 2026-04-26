"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tests/services.test.ts — Layanan (8 test cases)
 */
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../src/app"));
const setup_1 = require("./setup");
(0, vitest_1.describe)('Service Controller', () => {
    let ctx;
    let newServiceId;
    (0, vitest_1.beforeAll)(async () => { ctx = await (0, setup_1.seedTestData)(); });
    (0, vitest_1.afterAll)(async () => { await (0, setup_1.cleanupTestData)(); });
    // ✅ Normal: Get services
    (0, vitest_1.it)('GET /sync/services — tenant isolation', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/services')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(Array.isArray(res.body.data)).toBe(true);
    });
    // 🔒 Security: Karyawan tetap bisa GET services (semua role boleh)
    (0, vitest_1.it)('GET /sync/services — staff bisa GET', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/services')
            .set((0, setup_1.authHeaders)(ctx.staffToken));
        (0, vitest_1.expect)(res.status).toBe(200);
    });
    // ✅ Normal: Tambah layanan (admin only route: POST /sync/services)
    (0, vitest_1.it)('POST /sync/services — admin berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/services')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ name: `${setup_1.TEST_PREFIX}Dry Clean`, price: 15000, unit: 'pcs', duration_jam: 24 });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.data.id).toBeDefined();
        newServiceId = res.body.data.id;
    });
    // ⚠️ Edge: Harga ≤ 0
    (0, vitest_1.it)('POST /sync/services — harga 0 ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/services')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ name: 'Invalid Price', price: 0 });
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    // 🔒 Security: Outlet IDOR cross-tenant
    (0, vitest_1.it)('POST /sync/services — IDOR outlet ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/services')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ name: 'Hacked', price: 10000, outlet_id: 999999 });
        (0, vitest_1.expect)(res.status).toBe(403);
    });
    // ✅ Normal: Update layanan (admin only route: PUT /sync/services)
    (0, vitest_1.it)('PUT /sync/services — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .put('/api/v1/sync/services')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ id: newServiceId, name: `${setup_1.TEST_PREFIX}Updated Service`, price: 20000, unit: 'pcs', duration_jam: 12 });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
    });
    // ✅ Normal: Delete layanan (admin only route: DELETE /sync/services)
    (0, vitest_1.it)('DELETE /sync/services — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .delete(`/api/v1/sync/services?id=${newServiceId}`)
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.message).toContain('dihapus');
    });
    // ❌ Failure: Layanan not found
    (0, vitest_1.it)('DELETE /sync/services — not found', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .delete('/api/v1/sync/services?id=999999')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(404);
    });
});
