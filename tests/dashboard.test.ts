/**
 * @module dashboard.test
 * @description Integration tests untuk DashboardController — Sync Dashboard
 *
 * Scope:
 *  - getDashboard: admin stats (pendapatan bulanan), staff stats (diproses count)
 *  - outlet filter: query param ?oid filters dashboard data to specific outlet
 *  - security: request without valid tenant_id is rejected
 *
 * Dependencies (real — integration test):
 *  - PostgreSQL (test database via seedTestData)
 *  - Express app instance
 *  - JWT token generation (generateToken for security test)
 *
 * @see rules-test.md Section 6.1 untuk mandatory test scenarios
 * @see BUG-30 (SQL injection fix) dari audit v8
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { seedTestData, cleanupTestData, authHeaders, generateToken } from './setup';

describe('Dashboard Controller', () => {
  let ctx: Awaited<ReturnType<typeof seedTestData>>;

  beforeAll(async () => { ctx = await seedTestData(); });
  afterAll(async () => { await cleanupTestData(); });

  // ✅ Normal: Admin dashboard
  it('GET /sync/dashboard — admin stats lengkap', async () => {
    const res = await request(app)
      .get('/api/v1/sync/dashboard')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.stats).toBeDefined();
    expect(res.body.data.chart_data).toBeDefined();
    expect(res.body.data.recent_orders).toBeDefined();
    expect(res.body.data.stats.role_highlights).toBeDefined();
  });

  // ✅ Normal: Karyawan dashboard (role_stats berbeda)
  it('GET /sync/dashboard — karyawan stats berbeda', async () => {
    const res = await request(app)
      .get('/api/v1/sync/dashboard')
      .set(authHeaders(ctx.staffToken));

    expect(res.status).toBe(200);
    expect(res.body.data.stats.role_highlights.title).toContain('Diproses');
  });

  // ✅ Normal: Outlet filter
  it('GET /sync/dashboard — outlet filter', async () => {
    const res = await request(app)
      .get(`/api/v1/sync/dashboard?oid=${ctx.outletId}`)
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data.user.outlet_id).toBe(ctx.outletId);
  });

  // 🔒 Security: Tanpa tenant ditolak
  it('GET /sync/dashboard — tanpa tenant ditolak', async () => {
    const badToken = generateToken({
      user_id: 0,
      username: 'hacker',
      role: 'admin',
      tenant_id: 0 as any,
      outlet_id: null,
    });

    const res = await request(app)
      .get('/api/v1/sync/dashboard')
      .set(authHeaders(badToken));

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
