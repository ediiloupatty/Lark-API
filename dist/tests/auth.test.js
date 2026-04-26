"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tests/auth.test.ts — Autentikasi (11 test cases)
 *
 * CATATAN: Endpoint /auth/register memiliki rate limiter (3 per IP/jam).
 * Test case register diurutkan agar validasi input (yang gagal cepat)
 * dijalankan lebih dulu sebelum register sukses.
 */
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../src/app"));
const setup_1 = require("./setup");
(0, vitest_1.describe)('Auth Controller', () => {
    let ctx;
    (0, vitest_1.beforeAll)(async () => {
        ctx = await (0, setup_1.seedTestData)();
    });
    (0, vitest_1.afterAll)(async () => {
        await (0, setup_1.cleanupTestData)();
    });
    // ─── LOGIN TESTS ───────────────────────────────────────────────
    // ✅ Normal: Login admin berhasil
    (0, vitest_1.it)('POST /auth/login — admin login berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/auth/login')
            .set('X-App-Platform', 'LarkMobile')
            .send({ username: ctx.adminUsername, password: 'testpassword123' });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(res.body.data.user.role).toBe('admin');
        (0, vitest_1.expect)(res.body.data.user.tenant_id).toBe(ctx.tenantId);
    });
    // ❌ Failure: Password salah
    (0, vitest_1.it)('POST /auth/login — password salah ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/auth/login')
            .set('X-App-Platform', 'LarkMobile')
            .send({ username: ctx.adminUsername, password: 'wrong_password' });
        (0, vitest_1.expect)(res.status).toBe(401);
        (0, vitest_1.expect)(res.body.status).toBe('error');
    });
    // ⚠️ Edge: Tanpa username/password
    (0, vitest_1.it)('POST /auth/login — tanpa input ditolak 400', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/auth/login')
            .set('X-App-Platform', 'LarkMobile')
            .send({});
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    // 🔒 Security: Karyawan tidak bisa login via web login endpoint
    (0, vitest_1.it)('POST /auth/login — karyawan ditolak via web', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/auth/login')
            .set('X-App-Platform', 'LarkMobile')
            .send({ username: ctx.staffUsername, password: 'testpassword123' });
        (0, vitest_1.expect)(res.status).toBe(403);
        (0, vitest_1.expect)(res.body.error).toContain('karyawan');
    });
    // 🔒 Security: Akun nonaktif ditolak
    (0, vitest_1.it)('POST /auth/login — akun nonaktif ditolak', async () => {
        const { db } = await Promise.resolve().then(() => __importStar(require('../src/config/db')));
        await db.$queryRawUnsafe(`UPDATE users SET is_active = false WHERE id = $1`, ctx.adminUserId);
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/auth/login')
            .set('X-App-Platform', 'LarkMobile')
            .send({ username: ctx.adminUsername, password: 'testpassword123' });
        (0, vitest_1.expect)(res.status).toBe(403);
        // Restore
        await db.$queryRawUnsafe(`UPDATE users SET is_active = true WHERE id = $1`, ctx.adminUserId);
    });
    // ─── REGISTER TESTS ─────────────────────────────────────────────
    // Rate limiter di-bypass otomatis saat NODE_ENV=test
    // ⚠️ Edge: Password terlalu pendek
    (0, vitest_1.it)('POST /auth/register — password < 8 char ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/auth/register')
            .set('X-App-Platform', 'LarkMobile')
            .send({
            username: `${setup_1.TEST_PREFIX}short_${Date.now()}`,
            password: '1234',
            confirm_password: '1234',
            nama: 'Short Pw',
        });
        (0, vitest_1.expect)(res.status).toBe(400);
        (0, vitest_1.expect)(res.body.error).toContain('8 karakter');
    });
    // ⚠️ Edge: Password mismatch
    (0, vitest_1.it)('POST /auth/register — password mismatch ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/auth/register')
            .set('X-App-Platform', 'LarkMobile')
            .send({
            username: `${setup_1.TEST_PREFIX}mm_${Date.now()}`,
            password: 'securepass123',
            confirm_password: 'differentpass456',
            nama: 'Mismatch',
        });
        (0, vitest_1.expect)(res.status).toBe(400);
        (0, vitest_1.expect)(res.body.error).toContain('tidak cocok');
    });
    // ✅ Normal: Register berhasil
    (0, vitest_1.it)('POST /auth/register — register admin baru', async () => {
        const uniqueUser = `${setup_1.TEST_PREFIX}reg_${Date.now()}`;
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/auth/register')
            .set('X-App-Platform', 'LarkMobile')
            .send({
            username: uniqueUser,
            password: 'securepass123',
            confirm_password: 'securepass123',
            nama: 'Test Register',
            email: `${uniqueUser}@test.com`,
        });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.success).toBe(true);
        // Cleanup: delete the registered tenant+user
        const { db } = await Promise.resolve().then(() => __importStar(require('../src/config/db')));
        const user = await db.$queryRawUnsafe(`SELECT id, tenant_id FROM users WHERE username = $1`, uniqueUser);
        if (user.length > 0) {
            await db.$queryRawUnsafe(`DELETE FROM services WHERE tenant_id = $1`, user[0].tenant_id);
            await db.$queryRawUnsafe(`DELETE FROM tenant_settings WHERE tenant_id = $1`, user[0].tenant_id);
            await db.$queryRawUnsafe(`DELETE FROM users WHERE id = $1`, user[0].id);
            await db.$queryRawUnsafe(`DELETE FROM outlets WHERE tenant_id = $1`, user[0].tenant_id);
            await db.$queryRawUnsafe(`DELETE FROM tenants WHERE id = $1`, user[0].tenant_id);
        }
    });
    // ❌ Failure: Username duplikat
    (0, vitest_1.it)('POST /auth/register — username duplikat ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/auth/register')
            .set('X-App-Platform', 'LarkMobile')
            .send({
            username: ctx.adminUsername,
            password: 'securepass123',
            confirm_password: 'securepass123',
            nama: 'Duplicate',
        });
        (0, vitest_1.expect)(res.status).toBe(400);
        (0, vitest_1.expect)(res.body.error).toContain('sudah digunakan');
    });
    // ─── LOGOUT ───────────────────────────────────────────────────
    // ✅ Normal: Logout
    (0, vitest_1.it)('POST /auth/logout — logout berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/auth/logout')
            .set('X-App-Platform', 'LarkMobile')
            .set('Authorization', `Bearer ${ctx.adminToken}`);
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.success).toBe(true);
    });
    // ─── STAFF LOGIN ──────────────────────────────────────────────
    // ✅ Normal: Staff login via staff_code (mobile only)
    (0, vitest_1.it)('POST /auth/login-staff — staff login berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/auth/login-staff')
            .set('X-App-Platform', 'LarkMobile')
            .send({ staff_code: ctx.staffUsername });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(res.body.data.user.role).toBe('karyawan');
    });
});
