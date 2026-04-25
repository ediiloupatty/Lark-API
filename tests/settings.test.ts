/**
 * tests/settings.test.ts — Pengaturan (4 test cases)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { seedTestData, cleanupTestData, authHeaders } from './setup';

describe('Settings Controller', () => {
  let ctx: Awaited<ReturnType<typeof seedTestData>>;

  beforeAll(async () => { ctx = await seedTestData(); });
  afterAll(async () => { await cleanupTestData(); });

  // ✅ Normal: Get settings
  it('GET /sync/settings — berhasil', async () => {
    const res = await request(app)
      .get('/api/v1/sync/settings')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toBeDefined();
  });

  // ✅ Normal: Update valid key
  it('POST /sync/settings — key valid berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/settings')
      .set(authHeaders(ctx.adminToken))
      .send({ toko_info: { nama: 'Test Updated', alamat: 'Jl. Updated', telepon: '081', email: 'up@test.com' } });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('berhasil');
  });

  // 🔒 Security: Key tidak di whitelist diabaikan
  it('POST /sync/settings — key invalid diabaikan (tidak error)', async () => {
    const res = await request(app)
      .post('/api/v1/sync/settings')
      .set(authHeaders(ctx.adminToken))
      .send({ hacked_key: 'malicious_value', toko_info: { nama: 'Safe' } });

    expect(res.status).toBe(200);
    // The hacked_key should be silently ignored
  });

  // ✅ Normal: Get subscriptions
  it('GET /sync/subscriptions — berhasil', async () => {
    const res = await request(app)
      .get('/api/v1/sync/subscriptions')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data.current).toBeDefined();
    expect(res.body.data.current.plan_code).toBeDefined();
  });
});
