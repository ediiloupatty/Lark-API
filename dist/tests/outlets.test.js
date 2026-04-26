"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tests/outlets.test.ts — Outlet (7 test cases)
 */
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../src/app"));
const setup_1 = require("./setup");
(0, vitest_1.describe)('Outlet Controller', () => {
    let ctx;
    let newOutletId;
    (0, vitest_1.beforeAll)(async () => { ctx = await (0, setup_1.seedTestData)(); });
    (0, vitest_1.afterAll)(async () => { await (0, setup_1.cleanupTestData)(); });
    // ✅ Normal: Get outlets (admin lihat semua)
    (0, vitest_1.it)('GET /sync/outlets — admin semua outlet', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/outlets')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(Array.isArray(res.body.data)).toBe(true);
        (0, vitest_1.expect)(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
    // 🔒 Security: Karyawan hanya lihat outletnya
    (0, vitest_1.it)('GET /sync/outlets — staff filtered', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/outlets')
            .set((0, setup_1.authHeaders)(ctx.staffToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.data.length).toBeLessThanOrEqual(1);
    });
    // ✅ Normal: Tambah outlet (admin only)
    (0, vitest_1.it)('POST /sync/add-outlet — admin berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/add-outlet')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ nama: `${setup_1.TEST_PREFIX}Outlet Cabang`, alamat: 'Jl. Cabang', phone: '081222' });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.data.id).toBeDefined();
        newOutletId = res.body.data.id;
    });
    // 🔒 Security: Karyawan tidak bisa tambah outlet
    (0, vitest_1.it)('POST /sync/add-outlet — karyawan ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/add-outlet')
            .set((0, setup_1.authHeaders)(ctx.staffToken))
            .send({ nama: 'Hacked Outlet' });
        (0, vitest_1.expect)(res.status).toBe(403);
    });
    // ✅ Normal: Update outlet
    (0, vitest_1.it)('PUT /sync/update-outlet — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .put('/api/v1/sync/update-outlet')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ id: newOutletId, nama: `${setup_1.TEST_PREFIX}Updated Outlet`, alamat: 'Jl. Updated' });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
    });
    // ✅ Normal: Delete outlet
    (0, vitest_1.it)('POST /sync/delete-outlet — admin berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/delete-outlet')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ id: newOutletId });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.message).toContain('dihapus');
    });
    // 🔒 Security: Karyawan tidak bisa delete
    (0, vitest_1.it)('POST /sync/delete-outlet — karyawan ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/delete-outlet')
            .set((0, setup_1.authHeaders)(ctx.staffToken))
            .send({ id: ctx.outletId });
        (0, vitest_1.expect)(res.status).toBe(403);
    });
});
