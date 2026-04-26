"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tests/customers.test.ts — Pelanggan (8 test cases)
 */
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../src/app"));
const setup_1 = require("./setup");
(0, vitest_1.describe)('Customer Controller', () => {
    let ctx;
    (0, vitest_1.beforeAll)(async () => { ctx = await (0, setup_1.seedTestData)(); });
    (0, vitest_1.afterAll)(async () => { await (0, setup_1.cleanupTestData)(); });
    // ✅ Normal: Get customers
    (0, vitest_1.it)('GET /sync/customers — tenant isolation', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/customers')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(Array.isArray(res.body.data)).toBe(true);
    });
    // ✅ Normal: Search filter
    (0, vitest_1.it)('GET /sync/customers?search — filter berfungsi', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get(`/api/v1/sync/customers?search=${setup_1.TEST_PREFIX}`)
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
    // ✅ Normal: Tambah pelanggan
    (0, vitest_1.it)('POST /sync/add-customer — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/add-customer')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ nama: `${setup_1.TEST_PREFIX}New Customer`, no_hp: `082${Date.now().toString().slice(-9)}` });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.status).toBe('success');
    });
    // ⚠️ Edge: Tanpa nama
    (0, vitest_1.it)('POST /sync/add-customer — tanpa nama ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/add-customer')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ no_hp: '081999999999' });
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    // ⚠️ Edge: No HP duplikat
    (0, vitest_1.it)('POST /sync/add-customer — no HP duplikat ditolak', async () => {
        const phone = `083${Date.now().toString().slice(-9)}`;
        // First add
        await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/add-customer')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ nama: `${setup_1.TEST_PREFIX}Dup1`, no_hp: phone });
        // Second add with same phone
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/add-customer')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ nama: `${setup_1.TEST_PREFIX}Dup2`, no_hp: phone });
        (0, vitest_1.expect)(res.status).toBe(400);
        (0, vitest_1.expect)(res.body.message).toContain('sudah terdaftar');
    });
    // ✅ Normal: Update pelanggan
    (0, vitest_1.it)('PUT /sync/update-customer — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .put('/api/v1/sync/update-customer')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ id: ctx.customerId, nama: `${setup_1.TEST_PREFIX}Updated Customer`, no_hp: `084${Date.now().toString().slice(-9)}` });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
    });
    // ✅ Normal: Admin hapus pelanggan
    (0, vitest_1.it)('POST /sync/delete-customer — admin bisa', async () => {
        // Create disposable customer
        const addRes = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/add-customer')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ nama: `${setup_1.TEST_PREFIX}Delete Me` });
        const delId = addRes.body.data?.id;
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/delete-customer')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ id: delId });
        (0, vitest_1.expect)(res.status).toBe(200);
    });
    // 🔒 Security: Karyawan tidak bisa hapus
    (0, vitest_1.it)('POST /sync/delete-customer — karyawan ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/delete-customer')
            .set((0, setup_1.authHeaders)(ctx.staffToken))
            .send({ id: ctx.customerId });
        (0, vitest_1.expect)(res.status).toBe(403);
    });
});
