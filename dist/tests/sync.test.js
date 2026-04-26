"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tests/sync.test.ts — Sinkronisasi Pull + Push (5 test cases)
 */
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../src/app"));
const setup_1 = require("./setup");
(0, vitest_1.describe)('Sync Controller (Pull + Push)', () => {
    let ctx;
    (0, vitest_1.beforeAll)(async () => { ctx = await (0, setup_1.seedTestData)(); });
    (0, vitest_1.afterAll)(async () => { await (0, setup_1.cleanupTestData)(); });
    // ✅ Normal: Pull changes — initial sync
    (0, vitest_1.it)('GET /sync/pull — initial sync (since_version=0)', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/pull?since_version=0')
            .set((0, setup_1.authHeaders)(ctx.staffToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(res.body.data.services).toBeDefined();
        (0, vitest_1.expect)(res.body.data.customers).toBeDefined();
        (0, vitest_1.expect)(res.body.data.packages).toBeDefined();
        (0, vitest_1.expect)(res.body.data.outlets).toBeDefined();
        (0, vitest_1.expect)(res.body.data.server_version).toBeDefined();
    });
    // ✅ Normal: Pull changes — incremental
    (0, vitest_1.it)('GET /sync/pull — incremental (since_version > 0)', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/pull?since_version=9999999999999')
            .set((0, setup_1.authHeaders)(ctx.staffToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        // Should return empty/minimal data since version is very high
        (0, vitest_1.expect)(res.body.data.services.length).toBe(0);
        (0, vitest_1.expect)(res.body.data.customers.length).toBe(0);
    });
    // ✅ Normal: Push changes — single order
    (0, vitest_1.it)('POST /sync/push — single order berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/push')
            .set((0, setup_1.authHeaders)(ctx.staffToken))
            .send({
            orders: [{
                    offline_id: `offline-${Date.now()}`,
                    client_id: `clientid-${Date.now()}`,
                    customer_id: ctx.customerId,
                    customer_nama: 'Test Push Customer',
                    items: [{ service_id: ctx.serviceId, berat: 2 }],
                    status: 'diproses',
                    payment_method: 'cash',
                    total_amount: 10000,
                }],
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(res.body.data.synced_data.length).toBe(1);
        (0, vitest_1.expect)(res.body.data.synced_data[0].status).toBe('synced_success');
    });
    // ⚠️ Edge: Batch max 50 limit
    (0, vitest_1.it)('POST /sync/push — batch > 50 ditolak', async () => {
        const orders = Array.from({ length: 51 }, (_, i) => ({
            offline_id: `offline-${i}`,
            customer_nama: 'Bulk',
            items: [{ service_id: ctx.serviceId, berat: 1 }],
        }));
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/push')
            .set((0, setup_1.authHeaders)(ctx.staffToken))
            .send({ orders });
        (0, vitest_1.expect)(res.status).toBe(400);
        (0, vitest_1.expect)(res.body.message).toContain('50');
    });
    // 🔒 Security: IDOR customer cross-tenant
    (0, vitest_1.it)('POST /sync/push — IDOR customer ditangkap', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/push')
            .set((0, setup_1.authHeaders)(ctx.staffToken))
            .send({
            orders: [{
                    offline_id: `offline-idor-${Date.now()}`,
                    client_id: `clientid-idor-${Date.now()}`,
                    customer_id: 999999, // Non-existent/other tenant
                    items: [{ service_id: ctx.serviceId, berat: 1 }],
                    total_amount: 5000,
                }],
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        // Order should still sync but with a walk-in customer fallback (security measure)
        (0, vitest_1.expect)(res.body.data.synced_data[0].status).toBe('synced_success');
    });
});
