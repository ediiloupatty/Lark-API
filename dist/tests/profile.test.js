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
 * tests/profile.test.ts — Profil (5 test cases)
 *
 * CATATAN: Test change-password yang berhasil akan menaikkan token_version,
 * membuat token lama invalid. Test diurutkan dengan hati-hati.
 */
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../src/app"));
const setup_1 = require("./setup");
(0, vitest_1.describe)('Profile Controller', () => {
    let ctx;
    (0, vitest_1.beforeAll)(async () => { ctx = await (0, setup_1.seedTestData)(); });
    (0, vitest_1.afterAll)(async () => { await (0, setup_1.cleanupTestData)(); });
    // ✅ Normal: Get profile
    (0, vitest_1.it)('GET /sync/profile — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/profile')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(res.body.data.username).toBe(ctx.adminUsername);
        (0, vitest_1.expect)(res.body.data.tenant).toBeDefined();
    });
    // ✅ Normal: Update profile
    (0, vitest_1.it)('POST /sync/profile — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/profile')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({
            nama: 'Admin Updated Name',
            email: `${setup_1.TEST_PREFIX}updated@test.com`,
            username: ctx.adminUsername,
            no_hp: '08199999999',
            alamat: 'Jl. Updated',
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.data.nama).toBe('Admin Updated Name');
    });
    // ⚠️ Edge: Username duplikat
    (0, vitest_1.it)('POST /sync/profile — username duplikat ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/profile')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({
            nama: 'Admin',
            email: 'admin@test.com',
            username: ctx.staffUsername, // Belongs to staff
        });
        (0, vitest_1.expect)(res.status).toBe(400);
        (0, vitest_1.expect)(res.body.message).toContain('sudah digunakan');
    });
    // ❌ Failure: Password lama salah (HARUS sebelum change-password sukses!)
    (0, vitest_1.it)('POST /sync/change-password — password lama salah', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/change-password')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ old_password: 'wrong_old_pw', new_password: 'newsecure123' });
        (0, vitest_1.expect)(res.status).toBe(400);
        (0, vitest_1.expect)(res.body.message).toContain('tidak sesuai');
    });
    // ✅ Normal: Change password berhasil (TERAKHIR — increments token_version)
    (0, vitest_1.it)('POST /sync/change-password — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/change-password')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ old_password: 'testpassword123', new_password: 'newsecure123' });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.message).toContain('berhasil');
        // Restore password for cleanup (use raw SQL since token may be invalid now)
        const { db } = await Promise.resolve().then(() => __importStar(require('../src/config/db')));
        const bcrypt = await Promise.resolve().then(() => __importStar(require('bcrypt')));
        const hashed = await bcrypt.hash('testpassword123', 10);
        await db.$queryRawUnsafe(`UPDATE users SET password = $1, token_version = 0 WHERE id = $2`, hashed, ctx.adminUserId);
    });
});
