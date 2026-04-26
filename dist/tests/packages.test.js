"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tests/packages.test.ts — Paket Durasi (7 test cases)
 */
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../src/app"));
const setup_1 = require("./setup");
(0, vitest_1.describe)('Package Controller', () => {
    let ctx;
    let newPackageId;
    (0, vitest_1.beforeAll)(async () => { ctx = await (0, setup_1.seedTestData)(); });
    (0, vitest_1.afterAll)(async () => { await (0, setup_1.cleanupTestData)(); });
    // ✅ Normal: Get packages
    (0, vitest_1.it)('GET /sync/packages — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/packages')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(Array.isArray(res.body.data)).toBe(true);
    });
    // ✅ Normal: Tambah paket (admin only: POST /sync/add-package)
    (0, vitest_1.it)('POST /sync/add-package — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/add-package')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ nama: `${setup_1.TEST_PREFIX}Kilat`, durasi_jam: 3, price_tambahan: 5000 });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.data.id).toBeDefined();
        newPackageId = res.body.data.id;
    });
    // ⚠️ Edge: Durasi ≤ 0
    (0, vitest_1.it)('POST /sync/add-package — durasi 0 ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/add-package')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ nama: 'Invalid', durasi_jam: 0 });
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    // 🔒 Security: Outlet IDOR
    (0, vitest_1.it)('POST /sync/add-package — IDOR outlet ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/add-package')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ nama: 'Hacked', durasi_jam: 6, outlet_id: 999999 });
        (0, vitest_1.expect)(res.status).toBe(403);
    });
    // ✅ Normal: Update paket (admin only: PUT /sync/manage-package)
    (0, vitest_1.it)('PUT /sync/manage-package — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .put('/api/v1/sync/manage-package')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ id: newPackageId, nama: `${setup_1.TEST_PREFIX}Updated Kilat`, durasi_jam: 4, price_tambahan: 6000 });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
    });
    // ✅ Normal: Delete paket (admin only: DELETE /sync/manage-package)
    (0, vitest_1.it)('DELETE /sync/manage-package — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .delete(`/api/v1/sync/manage-package?id=${newPackageId}`)
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.message).toContain('dihapus');
    });
    // ❌ Failure: Paket not found
    (0, vitest_1.it)('DELETE /sync/manage-package — not found', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .delete('/api/v1/sync/manage-package?id=999999')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(404);
    });
});
