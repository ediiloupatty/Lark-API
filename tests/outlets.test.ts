/**
 * @module outlets.test
 * @description Integration tests untuk OutletController — CRUD Outlet/Cabang
 *
 * Scope:
 *  - getOutlets: admin sees all, staff filtered to own outlet
 *  - addOutlet: RBAC (admin-only), tenant scoping
 *  - updateOutlet: field update with ownership check
 *  - deleteOutlet: RBAC (admin-only), soft delete (is_active = false)
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

describe('Outlet Controller', () => {
  let ctx: Awaited<ReturnType<typeof seedTestData>>;
  let newOutletId: number;

  beforeAll(async () => { ctx = await seedTestData(); });
  afterAll(async () => { await cleanupTestData(); });

  // ✅ Normal: Get outlets (admin lihat semua)
  it('GET /sync/outlets — admin semua outlet', async () => {
    const res = await request(app)
      .get('/api/v1/sync/outlets')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  // 🔒 Security: Karyawan hanya lihat outletnya
  it('GET /sync/outlets — staff filtered', async () => {
    const res = await request(app)
      .get('/api/v1/sync/outlets')
      .set(authHeaders(ctx.staffToken));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
  });

  // ✅ Normal: Tambah outlet (admin only)
  it('POST /sync/add-outlet — admin berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/add-outlet')
      .set(authHeaders(ctx.adminToken))
      .send({ nama: `${TEST_PREFIX}Outlet Cabang`, alamat: 'Jl. Cabang', phone: '081222' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    newOutletId = res.body.data.id;
  });

  // 🔒 Security: Karyawan tidak bisa tambah outlet
  it('POST /sync/add-outlet — karyawan ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/add-outlet')
      .set(authHeaders(ctx.staffToken))
      .send({ nama: 'Hacked Outlet' });

    expect(res.status).toBe(403);
  });

  // ✅ Normal: Update outlet
  it('PUT /sync/update-outlet — berhasil', async () => {
    const res = await request(app)
      .put('/api/v1/sync/update-outlet')
      .set(authHeaders(ctx.adminToken))
      .send({ id: newOutletId, nama: `${TEST_PREFIX}Updated Outlet`, alamat: 'Jl. Updated' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  // ✅ Normal: Delete outlet
  it('POST /sync/delete-outlet — admin berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/delete-outlet')
      .set(authHeaders(ctx.adminToken))
      .send({ id: newOutletId });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('dinonaktifkan');
  });

  // 🔒 Security: Karyawan tidak bisa delete
  it('POST /sync/delete-outlet — karyawan ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/delete-outlet')
      .set(authHeaders(ctx.staffToken))
      .send({ id: ctx.outletId });

    expect(res.status).toBe(403);
  });
});
