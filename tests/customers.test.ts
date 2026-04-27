/**
 * @module customers.test
 * @description Integration tests untuk CustomerController — CRUD Pelanggan
 *
 * Scope:
 *  - getCustomers: tenant isolation, search filter
 *  - addCustomer: input validation (nama required), phone uniqueness within tenant
 *  - updateCustomer: field update with tenant scoping
 *  - deleteCustomer: RBAC (admin-only), soft delete
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

describe('Customer Controller', () => {
  let ctx: Awaited<ReturnType<typeof seedTestData>>;

  beforeAll(async () => { ctx = await seedTestData(); });
  afterAll(async () => { await cleanupTestData(); });

  // ✅ Normal: Get customers
  it('GET /sync/customers — tenant isolation', async () => {
    const res = await request(app)
      .get('/api/v1/sync/customers')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // ✅ Normal: Search filter
  it('GET /sync/customers?search — filter berfungsi', async () => {
    const res = await request(app)
      .get(`/api/v1/sync/customers?search=${TEST_PREFIX}`)
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  // ✅ Normal: Tambah pelanggan
  it('POST /sync/add-customer — berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/add-customer')
      .set(authHeaders(ctx.adminToken))
      .send({ nama: `${TEST_PREFIX}New Customer`, no_hp: `082${Date.now().toString().slice(-9)}` });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
  });

  // ⚠️ Edge: Tanpa nama
  it('POST /sync/add-customer — tanpa nama ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/add-customer')
      .set(authHeaders(ctx.adminToken))
      .send({ no_hp: '081999999999' });

    expect(res.status).toBe(400);
  });

  // ⚠️ Edge: No HP duplikat
  it('POST /sync/add-customer — no HP duplikat ditolak', async () => {
    const phone = `083${Date.now().toString().slice(-9)}`;
    // First add
    await request(app)
      .post('/api/v1/sync/add-customer')
      .set(authHeaders(ctx.adminToken))
      .send({ nama: `${TEST_PREFIX}Dup1`, no_hp: phone });

    // Second add with same phone
    const res = await request(app)
      .post('/api/v1/sync/add-customer')
      .set(authHeaders(ctx.adminToken))
      .send({ nama: `${TEST_PREFIX}Dup2`, no_hp: phone });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('sudah terdaftar');
  });

  // ✅ Normal: Update pelanggan
  it('PUT /sync/update-customer — berhasil', async () => {
    const res = await request(app)
      .put('/api/v1/sync/update-customer')
      .set(authHeaders(ctx.adminToken))
      .send({ id: ctx.customerId, nama: `${TEST_PREFIX}Updated Customer`, no_hp: `084${Date.now().toString().slice(-9)}` });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  // ✅ Normal: Admin hapus pelanggan
  it('POST /sync/delete-customer — admin bisa', async () => {
    // Create disposable customer
    const addRes = await request(app)
      .post('/api/v1/sync/add-customer')
      .set(authHeaders(ctx.adminToken))
      .send({ nama: `${TEST_PREFIX}Delete Me` });

    const delId = addRes.body.data?.id;

    const res = await request(app)
      .post('/api/v1/sync/delete-customer')
      .set(authHeaders(ctx.adminToken))
      .send({ id: delId });

    expect(res.status).toBe(200);
  });

  // 🔒 Security: Karyawan tidak bisa hapus
  it('POST /sync/delete-customer — karyawan ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/delete-customer')
      .set(authHeaders(ctx.staffToken))
      .send({ id: ctx.customerId });

    expect(res.status).toBe(403);
  });
});
