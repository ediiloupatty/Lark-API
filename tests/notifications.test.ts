/**
 * @module notifications.test
 * @description Integration tests untuk NotificationController — Device Token & In-App Notifications
 *
 * Scope:
 *  - registerDeviceToken: FCM token registration with platform info
 *  - getNotifications: user-scoped notification list with unread count
 *  - markAllAsRead: bulk read-status update
 *  - unregisterDeviceToken: cleanup on logout/uninstall
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
import { seedTestData, cleanupTestData, authHeaders } from './setup';

describe('Notification Controller', () => {
  let ctx: Awaited<ReturnType<typeof seedTestData>>;

  beforeAll(async () => { ctx = await seedTestData(); });
  afterAll(async () => { await cleanupTestData(); });

  // ✅ Normal: Register device token
  it('POST /sync/device-token — register berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/device-token')
      .set(authHeaders(ctx.adminToken))
      .send({ token: `fake-fcm-token-${Date.now()}`, platform: 'android' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ⚠️ Edge: Token kosong ditolak
  it('POST /sync/device-token — tanpa token ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/device-token')
      .set(authHeaders(ctx.adminToken))
      .send({ platform: 'android' });

    expect(res.status).toBe(400);
  });

  // ✅ Normal: Get notifications
  it('GET /sync/notifications — berhasil', async () => {
    const res = await request(app)
      .get('/api/v1/sync/notifications')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(typeof res.body.unread_count).toBe('number');
  });

  // ✅ Normal: Mark all as read
  it('POST /sync/notifications/read-all — berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/notifications/read-all')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ✅ Normal: Unregister device token
  it('DELETE /sync/device-token — berhasil', async () => {
    const res = await request(app)
      .delete('/api/v1/sync/device-token?token=fake-fcm-token-cleanup')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
