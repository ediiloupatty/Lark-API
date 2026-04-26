"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tests/settings.test.ts — Pengaturan (4 test cases)
 */
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../src/app"));
const setup_1 = require("./setup");
(0, vitest_1.describe)('Settings Controller', () => {
    let ctx;
    (0, vitest_1.beforeAll)(async () => { ctx = await (0, setup_1.seedTestData)(); });
    (0, vitest_1.afterAll)(async () => { await (0, setup_1.cleanupTestData)(); });
    // ✅ Normal: Get settings
    (0, vitest_1.it)('GET /sync/settings — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/settings')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(res.body.data).toBeDefined();
    });
    // ✅ Normal: Update valid key
    (0, vitest_1.it)('POST /sync/settings — key valid berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/settings')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ toko_info: { nama: 'Test Updated', alamat: 'Jl. Updated', telepon: '081', email: 'up@test.com' } });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.message).toContain('berhasil');
    });
    // 🔒 Security: Key tidak di whitelist diabaikan
    (0, vitest_1.it)('POST /sync/settings — key invalid diabaikan (tidak error)', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/settings')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ hacked_key: 'malicious_value', toko_info: { nama: 'Safe' } });
        (0, vitest_1.expect)(res.status).toBe(200);
        // The hacked_key should be silently ignored
    });
    // ✅ Normal: Get subscriptions
    (0, vitest_1.it)('GET /sync/subscriptions — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/subscriptions')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.data.current).toBeDefined();
        (0, vitest_1.expect)(res.body.data.current.plan_code).toBeDefined();
    });
});
