"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tests/notifications.test.ts — Notifikasi (5 test cases)
 */
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../src/app"));
const setup_1 = require("./setup");
(0, vitest_1.describe)('Notification Controller', () => {
    let ctx;
    (0, vitest_1.beforeAll)(async () => { ctx = await (0, setup_1.seedTestData)(); });
    (0, vitest_1.afterAll)(async () => { await (0, setup_1.cleanupTestData)(); });
    // ✅ Normal: Register device token
    (0, vitest_1.it)('POST /sync/device-token — register berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/device-token')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ token: `fake-fcm-token-${Date.now()}`, platform: 'android' });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.success).toBe(true);
    });
    // ⚠️ Edge: Token kosong ditolak
    (0, vitest_1.it)('POST /sync/device-token — tanpa token ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/device-token')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ platform: 'android' });
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    // ✅ Normal: Get notifications
    (0, vitest_1.it)('GET /sync/notifications — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/notifications')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.success).toBe(true);
        (0, vitest_1.expect)(res.body.data).toBeDefined();
        (0, vitest_1.expect)(typeof res.body.unread_count).toBe('number');
    });
    // ✅ Normal: Mark all as read
    (0, vitest_1.it)('POST /sync/notifications/read-all — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/notifications/read-all')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.success).toBe(true);
    });
    // ✅ Normal: Unregister device token
    (0, vitest_1.it)('DELETE /sync/device-token — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .delete('/api/v1/sync/device-token?token=fake-fcm-token-cleanup')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.success).toBe(true);
    });
});
