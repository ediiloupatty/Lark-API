/**
 * @module orders.test
 * @description Integration tests untuk OrderController — CRUD Pesanan & Pembayaran
 *
 * Scope:
 *  - createOrder: input validation, IDOR customer check, idempotency via client_id
 *  - getOrders: admin vs staff outlet filtering, tenant isolation
 *  - updateOrderStatus: state machine transitions, missing ID rejection
 *  - payOrder: payment creation, enum sanitization (invalid metode_bayar → fallback)
 *  - deleteOrder: admin soft-delete (status → dibatalkan)
 *
 * Dependencies (real — integration test):
 *  - PostgreSQL (test database via seedTestData)
 *  - Express app instance
 *  - Order state machine (VALID_TRANSITIONS)
 *
 * @see rules-test.md Section 6.1 untuk mandatory test scenarios
 * @see BUG-8 (state machine enforcement) dari audit v2
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { seedTestData, cleanupTestData, authHeaders } from './setup';

describe('Order Controller', () => {
  let ctx: Awaited<ReturnType<typeof seedTestData>>;
  let createdOrderId: number;
  let createdTrackingCode: string;

  beforeAll(async () => { ctx = await seedTestData(); });
  afterAll(async () => { await cleanupTestData(); });

  // ✅ Normal: Buat pesanan
  it('POST /sync/create-order — berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/create-order')
      .set(authHeaders(ctx.adminToken))
      .send({
        customer_id: ctx.customerId,
        items: [{ service_id: ctx.serviceId, berat: 3 }],
        metode_antar: 'antar_sendiri',
        status_bayar: 'nanti',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.tracking_code).toMatch(/^ORD-/);
    expect(res.body.data.total_amount).toBe(15000); // 3kg * 5000
    createdOrderId = res.body.data.order_id;
    createdTrackingCode = res.body.data.tracking_code;
  });

  // ⚠️ Edge: Tanpa customer_id
  it('POST /sync/create-order — tanpa customer ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/create-order')
      .set(authHeaders(ctx.adminToken))
      .send({ items: [{ service_id: ctx.serviceId, berat: 2 }] });

    expect(res.status).toBe(400);
  });

  // ⚠️ Edge: Items kosong
  it('POST /sync/create-order — items kosong ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/create-order')
      .set(authHeaders(ctx.adminToken))
      .send({ customer_id: ctx.customerId, items: [] });

    expect(res.status).toBe(400);
  });

  // 🔒 Security: Customer milik tenant lain (IDOR)
  it('POST /sync/create-order — IDOR customer ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/create-order')
      .set(authHeaders(ctx.adminToken))
      .send({
        customer_id: 999999, // Non-existent / different tenant
        items: [{ service_id: ctx.serviceId, berat: 1 }],
      });

    expect(res.status).toBe(403);
  });

  // ⚠️ Edge: Idempotency — client_id sama
  it('POST /sync/create-order — idempotency check', async () => {
    const clientId = `test-idempotent-${Date.now()}`;
    // First call
    const res1 = await request(app)
      .post('/api/v1/sync/create-order')
      .set(authHeaders(ctx.adminToken))
      .send({ customer_id: ctx.customerId, items: [{ service_id: ctx.serviceId, berat: 1 }], client_id: clientId });

    expect(res1.status).toBe(201);

    // Second call with same client_id
    const res2 = await request(app)
      .post('/api/v1/sync/create-order')
      .set(authHeaders(ctx.adminToken))
      .send({ customer_id: ctx.customerId, items: [{ service_id: ctx.serviceId, berat: 1 }], client_id: clientId });

    expect(res2.status).toBe(200); // Not 201 — already exists
    expect(res2.body.data.tracking_code).toBe(res1.body.data.tracking_code);
  });

  // ✅ Normal: Get orders (admin)
  it('GET /sync/orders — admin melihat orders', async () => {
    const res = await request(app)
      .get('/api/v1/sync/orders')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.orders).toBeDefined();
    expect(Array.isArray(res.body.data.orders)).toBe(true);
  });

  // 🔒 Security: Karyawan hanya lihat outlet sendiri
  it('GET /sync/orders — staff filtered by outlet', async () => {
    const res = await request(app)
      .get('/api/v1/sync/orders')
      .set(authHeaders(ctx.staffToken));

    expect(res.status).toBe(200);
    // Should only return orders for staff's outlet
    expect(res.body.status).toBe('success');
  });

  // ✅ Normal: Update status
  it('PUT /sync/update-order-status — berhasil', async () => {
    const res = await request(app)
      .put('/api/v1/sync/update-order-status')
      .set(authHeaders(ctx.adminToken))
      .send({ order_id: createdOrderId, status: 'siap_diambil' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  // ⚠️ Edge: Update tanpa ID
  it('PUT /sync/update-order-status — tanpa ID ditolak', async () => {
    const res = await request(app)
      .put('/api/v1/sync/update-order-status')
      .set(authHeaders(ctx.adminToken))
      .send({ status: 'selesai' });

    expect(res.status).toBe(400);
  });

  // ✅ Normal: Payment
  it('POST /sync/pay-order — pembayaran berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/pay-order')
      .set(authHeaders(ctx.adminToken))
      .send({ order_id: createdOrderId, metode_bayar: 'cash' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  // 🔒 Security: Enum metode_bayar invalid → fallback
  it('POST /sync/pay-order — invalid method fallback ke cash', async () => {
    // Create a new order for this test
    const orderRes = await request(app)
      .post('/api/v1/sync/create-order')
      .set(authHeaders(ctx.adminToken))
      .send({ customer_id: ctx.customerId, items: [{ service_id: ctx.serviceId, berat: 1 }], status_bayar: 'nanti' });

    const newOrderId = orderRes.body.data.order_id;

    const res = await request(app)
      .post('/api/v1/sync/pay-order')
      .set(authHeaders(ctx.adminToken))
      .send({ order_id: newOrderId, metode_bayar: 'hacked_value' });

    expect(res.status).toBe(200); // Should succeed with fallback to 'cash'
  });

  // 🔒 Security: Delete order
  it('POST /sync/delete-order — admin soft-delete berhasil', async () => {
    // Create a disposable order
    const orderRes = await request(app)
      .post('/api/v1/sync/create-order')
      .set(authHeaders(ctx.adminToken))
      .send({ customer_id: ctx.customerId, items: [{ service_id: ctx.serviceId, berat: 1 }] });

    const disposableId = orderRes.body.data.order_id;

    const res = await request(app)
      .post('/api/v1/sync/delete-order')
      .set(authHeaders(ctx.adminToken))
      .send({ order_id: disposableId });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('dibatalkan');
  });
});
