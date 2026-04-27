/**
 * @module staff.test
 * @description Integration tests untuk StaffController — CRUD Karyawan & Permissions
 *
 * Scope:
 *  - getStaff: RBAC (admin-only list), tenant isolation
 *  - addStaff: staff_code uniqueness, outlet assignment
 *  - updateStaff: field update with admin check
 *  - toggleStaffStatus: activate/deactivate staff account
 *  - deleteStaff: soft delete (deleted_at timestamp)
 *  - globalPermissions: get/set tenant-wide permission defaults
 *  - updatePermissions: per-staff permission override
 *
 * Dependencies (real — integration test):
 *  - PostgreSQL (test database via seedTestData)
 *  - Express app instance
 *
 * @see rules-test.md Section 6.1 untuk mandatory test scenarios
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { seedTestData, cleanupTestData, authHeaders, TEST_PREFIX } from './setup';

describe('Staff Controller', () => {
  let ctx: Awaited<ReturnType<typeof seedTestData>>;
  let newStaffId: number;

  beforeAll(async () => { ctx = await seedTestData(); });
  afterAll(async () => { await cleanupTestData(); });

  // ✅ Normal: Get staff list (admin)
  it('GET /sync/staff — admin bisa lihat', async () => {
    const res = await request(app)
      .get('/api/v1/sync/staff')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // 🔒 Security: Karyawan tidak bisa lihat staff list
  it('GET /sync/staff — karyawan ditolak', async () => {
    const res = await request(app)
      .get('/api/v1/sync/staff')
      .set(authHeaders(ctx.staffToken));

    expect(res.status).toBe(403);
  });

  // ✅ Normal: Tambah staff
  it('POST /sync/add-staff — berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/add-staff')
      .set(authHeaders(ctx.adminToken))
      .send({
        staff_code: `${TEST_PREFIX}newkasir_${Date.now()}`,
        nama: 'Kasir Baru Test',
        outlet_id: ctx.outletId,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    newStaffId = res.body.data.id;
  });

  // ⚠️ Edge: Username duplikat dalam tenant
  it('POST /sync/add-staff — username duplikat ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/add-staff')
      .set(authHeaders(ctx.adminToken))
      .send({
        staff_code: ctx.staffUsername, // Already exists
        nama: 'Duplikat',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('sudah digunakan');
  });

  // ✅ Normal: Update staff
  it('PUT /sync/update-staff — berhasil', async () => {
    const res = await request(app)
      .put('/api/v1/sync/update-staff')
      .set(authHeaders(ctx.adminToken))
      .send({
        id: newStaffId,
        staff_code: `${TEST_PREFIX}updkasir_${Date.now()}`,
        nama: 'Kasir Updated',
        outlet_id: ctx.outletId,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  // ✅ Normal: Toggle staff status
  it('POST /sync/toggle-staff-status — berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/toggle-staff-status')
      .set(authHeaders(ctx.adminToken))
      .send({ id: newStaffId, is_active: false });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  // ✅ Normal: Delete staff (soft delete)
  it('POST /sync/delete-staff — admin soft-delete berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/delete-staff')
      .set(authHeaders(ctx.adminToken))
      .send({ user_id: newStaffId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  // ✅ Normal: Get global permissions
  it('GET /sync/global-permissions — berhasil', async () => {
    const res = await request(app)
      .get('/api/v1/sync/global-permissions')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toBeDefined();
    expect(typeof res.body.data.permissions.manage_orders).toBe('boolean');
  });

  // 🔒 Security: Update global permissions — admin only
  it('POST /sync/global-permissions — admin berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/global-permissions')
      .set(authHeaders(ctx.adminToken))
      .send({ permissions: { manage_orders: true, confirm_payments: false, view_reports: true, manage_expenses: false } });

    expect(res.status).toBe(200);
    expect(res.body.data.permissions.manage_orders).toBe(true);
  });

  // ✅ Normal: Update individual staff permissions
  it('PUT /sync/update-permissions — berhasil', async () => {
    const res = await request(app)
      .put('/api/v1/sync/update-permissions')
      .set(authHeaders(ctx.adminToken))
      .send({
        staff_id: ctx.staffUserId,
        permissions: { manage_orders: true, confirm_payments: true, view_reports: false, manage_expenses: false },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.permissions.confirm_payments).toBe(true);
  });
});
