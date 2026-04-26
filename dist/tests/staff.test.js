"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * tests/staff.test.ts — Karyawan & Permissions (10 test cases)
 */
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const app_1 = __importDefault(require("../src/app"));
const setup_1 = require("./setup");
(0, vitest_1.describe)('Staff Controller', () => {
    let ctx;
    let newStaffId;
    (0, vitest_1.beforeAll)(async () => { ctx = await (0, setup_1.seedTestData)(); });
    (0, vitest_1.afterAll)(async () => { await (0, setup_1.cleanupTestData)(); });
    // ✅ Normal: Get staff list (admin)
    (0, vitest_1.it)('GET /sync/staff — admin bisa lihat', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/staff')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        (0, vitest_1.expect)(Array.isArray(res.body.data)).toBe(true);
    });
    // 🔒 Security: Karyawan tidak bisa lihat staff list
    (0, vitest_1.it)('GET /sync/staff — karyawan ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/staff')
            .set((0, setup_1.authHeaders)(ctx.staffToken));
        (0, vitest_1.expect)(res.status).toBe(403);
    });
    // ✅ Normal: Tambah staff
    (0, vitest_1.it)('POST /sync/add-staff — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/add-staff')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({
            staff_code: `${setup_1.TEST_PREFIX}newkasir_${Date.now()}`,
            nama: 'Kasir Baru Test',
            outlet_id: ctx.outletId,
        });
        (0, vitest_1.expect)(res.status).toBe(201);
        (0, vitest_1.expect)(res.body.status).toBe('success');
        newStaffId = res.body.data.id;
    });
    // ⚠️ Edge: Username duplikat dalam tenant
    (0, vitest_1.it)('POST /sync/add-staff — username duplikat ditolak', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/add-staff')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({
            staff_code: ctx.staffUsername, // Already exists
            nama: 'Duplikat',
        });
        (0, vitest_1.expect)(res.status).toBe(400);
        (0, vitest_1.expect)(res.body.message).toContain('sudah digunakan');
    });
    // ✅ Normal: Update staff
    (0, vitest_1.it)('PUT /sync/update-staff — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .put('/api/v1/sync/update-staff')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({
            id: newStaffId,
            staff_code: `${setup_1.TEST_PREFIX}updkasir_${Date.now()}`,
            nama: 'Kasir Updated',
            outlet_id: ctx.outletId,
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
    });
    // ✅ Normal: Toggle staff status
    (0, vitest_1.it)('POST /sync/toggle-staff-status — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/toggle-staff-status')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ id: newStaffId, is_active: false });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
    });
    // ✅ Normal: Delete staff (soft delete)
    (0, vitest_1.it)('POST /sync/delete-staff — admin soft-delete berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/delete-staff')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ user_id: newStaffId });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('success');
    });
    // ✅ Normal: Get global permissions
    (0, vitest_1.it)('GET /sync/global-permissions — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .get('/api/v1/sync/global-permissions')
            .set((0, setup_1.authHeaders)(ctx.adminToken));
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.data.permissions).toBeDefined();
        (0, vitest_1.expect)(typeof res.body.data.permissions.manage_orders).toBe('boolean');
    });
    // 🔒 Security: Update global permissions — admin only
    (0, vitest_1.it)('POST /sync/global-permissions — admin berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .post('/api/v1/sync/global-permissions')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({ permissions: { manage_orders: true, confirm_payments: false, view_reports: true, manage_expenses: false } });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.data.permissions.manage_orders).toBe(true);
    });
    // ✅ Normal: Update individual staff permissions
    (0, vitest_1.it)('PUT /sync/update-permissions — berhasil', async () => {
        const res = await (0, supertest_1.default)(app_1.default)
            .put('/api/v1/sync/update-permissions')
            .set((0, setup_1.authHeaders)(ctx.adminToken))
            .send({
            staff_id: ctx.staffUserId,
            permissions: { manage_orders: true, confirm_payments: true, view_reports: false, manage_expenses: false },
        });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.data.permissions.confirm_payments).toBe(true);
    });
});
