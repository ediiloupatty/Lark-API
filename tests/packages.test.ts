/**
 * tests/packages.test.ts — Paket Durasi (7 test cases)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { seedTestData, cleanupTestData, authHeaders, TEST_PREFIX } from './setup';

describe('Package Controller', () => {
  let ctx: Awaited<ReturnType<typeof seedTestData>>;
  let newPackageId: number;

  beforeAll(async () => { ctx = await seedTestData(); });
  afterAll(async () => { await cleanupTestData(); });

  // ✅ Normal: Get packages
  it('GET /sync/packages — berhasil', async () => {
    const res = await request(app)
      .get('/api/v1/sync/packages')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // ✅ Normal: Tambah paket (admin only: POST /sync/add-package)
  it('POST /sync/add-package — berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/add-package')
      .set(authHeaders(ctx.adminToken))
      .send({ nama: `${TEST_PREFIX}Kilat`, durasi_jam: 3, price_tambahan: 5000 });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    newPackageId = res.body.data.id;
  });

  // ⚠️ Edge: Durasi ≤ 0
  it('POST /sync/add-package — durasi 0 ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/add-package')
      .set(authHeaders(ctx.adminToken))
      .send({ nama: 'Invalid', durasi_jam: 0 });

    expect(res.status).toBe(400);
  });

  // 🔒 Security: Outlet IDOR
  it('POST /sync/add-package — IDOR outlet ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/add-package')
      .set(authHeaders(ctx.adminToken))
      .send({ nama: 'Hacked', durasi_jam: 6, outlet_id: 999999 });

    expect(res.status).toBe(403);
  });

  // ✅ Normal: Update paket (admin only: PUT /sync/manage-package)
  it('PUT /sync/manage-package — berhasil', async () => {
    const res = await request(app)
      .put('/api/v1/sync/manage-package')
      .set(authHeaders(ctx.adminToken))
      .send({ id: newPackageId, nama: `${TEST_PREFIX}Updated Kilat`, durasi_jam: 4, price_tambahan: 6000 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  // ✅ Normal: Delete paket (admin only: DELETE /sync/manage-package)
  it('DELETE /sync/manage-package — berhasil', async () => {
    const res = await request(app)
      .delete(`/api/v1/sync/manage-package?id=${newPackageId}`)
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('dihapus');
  });

  // ❌ Failure: Paket not found
  it('DELETE /sync/manage-package — not found', async () => {
    const res = await request(app)
      .delete('/api/v1/sync/manage-package?id=999999')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(404);
  });
});
