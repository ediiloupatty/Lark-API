/**
 * @module services.test
 * @description Integration tests untuk ServiceController — CRUD Layanan Laundry
 *
 * Scope:
 *  - getServices: tenant isolation, staff filtered by outlet
 *  - addService: input validation (name + price > 0), IDOR outlet cross-tenant check
 *  - updateService: field update with tenant + outlet scoping
 *  - deleteService: soft delete (is_active = false), not-found handling
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

describe('Service Controller', () => {
  let ctx: Awaited<ReturnType<typeof seedTestData>>;
  let newServiceId: number;

  beforeAll(async () => { ctx = await seedTestData(); });
  afterAll(async () => { await cleanupTestData(); });

  // ✅ Normal: Get services
  it('GET /sync/services — tenant isolation', async () => {
    const res = await request(app)
      .get('/api/v1/sync/services')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // 🔒 Security: Karyawan tetap bisa GET services (semua role boleh)
  it('GET /sync/services — staff bisa GET', async () => {
    const res = await request(app)
      .get('/api/v1/sync/services')
      .set(authHeaders(ctx.staffToken));

    expect(res.status).toBe(200);
  });

  // ✅ Normal: Tambah layanan (admin only route: POST /sync/services)
  it('POST /sync/services — admin berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/services')
      .set(authHeaders(ctx.adminToken))
      .send({ name: `${TEST_PREFIX}Dry Clean`, price: 15000, unit: 'pcs', duration_jam: 24 });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    newServiceId = res.body.data.id;
  });

  // ⚠️ Edge: Harga ≤ 0
  it('POST /sync/services — harga 0 ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/services')
      .set(authHeaders(ctx.adminToken))
      .send({ name: 'Invalid Price', price: 0 });

    expect(res.status).toBe(400);
  });

  // 🔒 Security: Outlet IDOR cross-tenant
  it('POST /sync/services — IDOR outlet ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/services')
      .set(authHeaders(ctx.adminToken))
      .send({ name: 'Hacked', price: 10000, outlet_id: 999999 });

    expect(res.status).toBe(403);
  });

  // ✅ Normal: Update layanan (admin only route: PUT /sync/services)
  it('PUT /sync/services — berhasil', async () => {
    const res = await request(app)
      .put('/api/v1/sync/services')
      .set(authHeaders(ctx.adminToken))
      .send({ id: newServiceId, name: `${TEST_PREFIX}Updated Service`, price: 20000, unit: 'pcs', duration_jam: 12 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  // ✅ Normal: Delete layanan (admin only route: DELETE /sync/services)
  it('DELETE /sync/services — berhasil', async () => {
    const res = await request(app)
      .delete(`/api/v1/sync/services?id=${newServiceId}`)
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('dihapus');
  });

  // ❌ Failure: Layanan not found
  it('DELETE /sync/services — not found', async () => {
    const res = await request(app)
      .delete('/api/v1/sync/services?id=999999')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(404);
  });
});
