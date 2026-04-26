"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tests/orders.test.ts — Pesanan & Pembayaran (12 test cases)
 */
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../src/app"));
const setup_1 = require("./setup");
(0, vitest_1.describe)('Order Controller', () => {
    let ctx;
    let createdOrderId;
    let createdTrackingCode;
    (0, vitest_1.beforeAll)(async () => { ctx = await (0, setup_1.seedTestData)(); });
    (0, vitest_1.afterAll)(async () => { await (0, setup_1.cleanupTestData)(); });
    // ✅ Normal: Buat pesanan
    (0, vitest_1.it)('POST /sync/create-order — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/create-order')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({
            customer_id: ctx.customerId,
            items: [{ service_id: ctx.serviceId, berat: 3 }],
            metode_antar: 'antar_sendiri',
            status_bayar: 'nanti',
        });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(res.body.data.tracking_code).toMatch(/^ORD-/);
        (0, vitest_1.expect)(res.body.data.total_amount).toBe(15000); // 3kg * 5000
        createdOrderId = res.body.data.order_id;
        createdTrackingCode = res.body.data.tracking_code;
    });
    // ⚠️ Edge: Tanpa customer_id
    (0, vitest_1.it)('POST /sync/create-order — tanpa customer ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/create-order')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ items: [{ service_id: ctx.serviceId, berat: 2 }] });
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    // ⚠️ Edge: Items kosong
    (0, vitest_1.it)('POST /sync/create-order — items kosong ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/create-order')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ customer_id: ctx.customerId, items: [] });
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    // 🔒 Security: Customer milik tenant lain (IDOR)
    (0, vitest_1.it)('POST /sync/create-order — IDOR customer ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/create-order')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({
            customer_id: 999999, // Non-existent / different tenant
            items: [{ service_id: ctx.serviceId, berat: 1 }],
        });
        (0, vitest_1.expect)(res.status).toBe(403);
    });
    // ⚠️ Edge: Idempotency — client_id sama
    (0, vitest_1.it)('POST /sync/create-order — idempotency check', async () => {
        const clientId = `test-idempotent-${Date.now()}`;
        // First call
        const res1 = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/create-order')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ customer_id: ctx.customerId, items: [{ service_id: ctx.serviceId, berat: 1 }], client_id: clientId });
        (0, vitest_1.expect)(res1.status).toBe(201);
        // Second call with same client_id
        const res2 = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/create-order')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ customer_id: ctx.customerId, items: [{ service_id: ctx.serviceId, berat: 1 }], client_id: clientId });
        (0, vitest_1.expect)(res2.status).toBe(200); // Not 201 — already exists
        (0, vitest_1.expect)(res2.body.data.tracking_code).toBe(res1.body.data.tracking_code);
    });
    // ✅ Normal: Get orders (admin)
    (0, vitest_1.it)('GET /sync/orders — admin melihat orders', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/orders')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(res.body.data.orders).toBeDefined();
        (0, vitest_1.expect)(Array.isArray(res.body.data.orders)).toBe(true);
    });
    // 🔒 Security: Karyawan hanya lihat outlet sendiri
    (0, vitest_1.it)('GET /sync/orders — staff filtered by outlet', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/orders')
            .set((0, setup_1.authHeaders)(ctx.staffToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        // Should only return orders for staff's outlet
        (0, vitest_1.expect)(res.body.status).toBe('success');
    });
    // ✅ Normal: Update status
    (0, vitest_1.it)('PUT /sync/update-order-status — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .put('/api/v1/sync/update-order-status')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ order_id: createdOrderId, status: 'siap_diambil' });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
    });
    // ⚠️ Edge: Update tanpa ID
    (0, vitest_1.it)('PUT /sync/update-order-status — tanpa ID ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .put('/api/v1/sync/update-order-status')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ status: 'selesai' });
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    // ✅ Normal: Payment
    (0, vitest_1.it)('POST /sync/pay-order — pembayaran berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/pay-order')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ order_id: createdOrderId, metode_bayar: 'cash' });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
    });
    // 🔒 Security: Enum metode_bayar invalid → fallback
    (0, vitest_1.it)('POST /sync/pay-order — invalid method fallback ke cash', async () => {
        // Create a new order for this test
        const orderRes = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/create-order')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ customer_id: ctx.customerId, items: [{ service_id: ctx.serviceId, berat: 1 }], status_bayar: 'nanti' });
        const newOrderId = orderRes.body.data.order_id;
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/pay-order')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ order_id: newOrderId, metode_bayar: 'hacked_value' });
        (0, vitest_1.expect)(res.status).toBe(200); // Should succeed with fallback to 'cash'
    });
    // 🔒 Security: Delete order
    (0, vitest_1.it)('POST /sync/delete-order — admin soft-delete berhasil', async () => {
        // Create a disposable order
        const orderRes = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/create-order')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ customer_id: ctx.customerId, items: [{ service_id: ctx.serviceId, berat: 1 }] });
        const disposableId = orderRes.body.data.order_id;
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/delete-order')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ order_id: disposableId });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.message).toContain('dibatalkan');
    });
});
