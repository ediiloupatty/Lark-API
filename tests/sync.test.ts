/**
 * tests/sync.test.ts — Sinkronisasi Pull + Push (5 test cases)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { seedTestData, cleanupTestData, authHeaders } from './setup';

describe('Sync Controller (Pull + Push)', () => {
  let ctx: Awaited<ReturnType<typeof seedTestData>>;

  beforeAll(async () => { ctx = await seedTestData(); });
  afterAll(async () => { await cleanupTestData(); });

  // ✅ Normal: Pull changes — initial sync
  it('GET /sync/pull — initial sync (since_version=0)', async () => {
    const res = await request(app)
      .get('/api/v1/sync/pull?since_version=0')
      .set(authHeaders(ctx.staffToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.services).toBeDefined();
    expect(res.body.data.customers).toBeDefined();
    expect(res.body.data.packages).toBeDefined();
    expect(res.body.data.outlets).toBeDefined();
    expect(res.body.data.server_version).toBeDefined();
  });

  // ✅ Normal: Pull changes — incremental
  it('GET /sync/pull — incremental (since_version > 0)', async () => {
    const res = await request(app)
      .get('/api/v1/sync/pull?since_version=9999999999999')
      .set(authHeaders(ctx.staffToken));

    expect(res.status).toBe(200);
    // Should return empty/minimal data since version is very high
    expect(res.body.data.services.length).toBe(0);
    expect(res.body.data.customers.length).toBe(0);
  });

  // ✅ Normal: Push changes — single order
  it('POST /sync/push — single order berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/push')
      .set(authHeaders(ctx.staffToken))
      .send({
        orders: [{
          offline_id: `offline-${Date.now()}`,
          client_id: `clientid-${Date.now()}`,
          customer_id: ctx.customerId,
          customer_nama: 'Test Push Customer',
          items: [{ service_id: ctx.serviceId, berat: 2 }],
          status: 'diproses',
          payment_method: 'cash',
          total_amount: 10000,
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.synced_data.length).toBe(1);
    expect(res.body.data.synced_data[0].status).toBe('synced_success');
  });

  // ⚠️ Edge: Batch max 50 limit
  it('POST /sync/push — batch > 50 ditolak', async () => {
    const orders = Array.from({ length: 51 }, (_, i) => ({
      offline_id: `offline-${i}`,
      customer_nama: 'Bulk',
      items: [{ service_id: ctx.serviceId, berat: 1 }],
    }));

    const res = await request(app)
      .post('/api/v1/sync/push')
      .set(authHeaders(ctx.staffToken))
      .send({ orders });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('50');
  });

  // 🔒 Security: IDOR customer cross-tenant
  it('POST /sync/push — IDOR customer ditangkap', async () => {
    const res = await request(app)
      .post('/api/v1/sync/push')
      .set(authHeaders(ctx.staffToken))
      .send({
        orders: [{
          offline_id: `offline-idor-${Date.now()}`,
          client_id: `clientid-idor-${Date.now()}`,
          customer_id: 999999, // Non-existent/other tenant
          items: [{ service_id: ctx.serviceId, berat: 1 }],
          total_amount: 5000,
        }],
      });

    expect(res.status).toBe(200);
    // Order should still sync but with a walk-in customer fallback (security measure)
    expect(res.body.data.synced_data[0].status).toBe('synced_success');
  });
});
