/**
 * tests/auth.test.ts — Autentikasi (11 test cases)
 *
 * CATATAN: Endpoint /auth/register memiliki rate limiter (3 per IP/jam).
 * Test case register diurutkan agar validasi input (yang gagal cepat)
 * dijalankan lebih dulu sebelum register sukses.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { seedTestData, cleanupTestData, TEST_PREFIX } from './setup';

describe('Auth Controller', () => {
  let ctx: Awaited<ReturnType<typeof seedTestData>>;

  beforeAll(async () => {
    ctx = await seedTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  // ─── LOGIN TESTS ───────────────────────────────────────────────

  // ✅ Normal: Login admin berhasil
  it('POST /auth/login — admin login berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-App-Platform', 'LarkMobile')
      .send({ username: ctx.adminUsername, password: 'testpassword123' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.user.role).toBe('admin');
    expect(res.body.data.user.tenant_id).toBe(ctx.tenantId);
  });

  // ❌ Failure: Password salah
  it('POST /auth/login — password salah ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-App-Platform', 'LarkMobile')
      .send({ username: ctx.adminUsername, password: 'wrong_password' });

    expect(res.status).toBe(401);
    expect(res.body.status).toBe('error');
  });

  // ⚠️ Edge: Tanpa username/password
  it('POST /auth/login — tanpa input ditolak 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-App-Platform', 'LarkMobile')
      .send({});

    expect(res.status).toBe(400);
  });

  // 🔒 Security: Karyawan tidak bisa login via web login endpoint
  it('POST /auth/login — karyawan ditolak via web', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-App-Platform', 'LarkMobile')
      .send({ username: ctx.staffUsername, password: 'testpassword123' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('karyawan');
  });

  // 🔒 Security: Akun nonaktif ditolak
  it('POST /auth/login — akun nonaktif ditolak', async () => {
    const { db } = await import('../src/config/db');
    await db.$queryRawUnsafe(`UPDATE users SET is_active = false WHERE id = $1`, ctx.adminUserId);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-App-Platform', 'LarkMobile')
      .send({ username: ctx.adminUsername, password: 'testpassword123' });

    expect(res.status).toBe(403);

    // Restore
    await db.$queryRawUnsafe(`UPDATE users SET is_active = true WHERE id = $1`, ctx.adminUserId);
  });

  // ─── REGISTER TESTS ─────────────────────────────────────────────
  // Rate limiter di-bypass otomatis saat NODE_ENV=test

  // ⚠️ Edge: Password terlalu pendek
  it('POST /auth/register — password < 8 char ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('X-App-Platform', 'LarkMobile')
      .send({
        username: `${TEST_PREFIX}short_${Date.now()}`,
        password: '1234',
        confirm_password: '1234',
        nama: 'Short Pw',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('8 karakter');
  });

  // ⚠️ Edge: Password mismatch
  it('POST /auth/register — password mismatch ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('X-App-Platform', 'LarkMobile')
      .send({
        username: `${TEST_PREFIX}mm_${Date.now()}`,
        password: 'securepass123',
        confirm_password: 'differentpass456',
        nama: 'Mismatch',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('tidak cocok');
  });

  // ✅ Normal: Register berhasil
  it('POST /auth/register — register admin baru', async () => {
    const uniqueUser = `${TEST_PREFIX}reg_${Date.now()}`;
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('X-App-Platform', 'LarkMobile')
      .send({
        username: uniqueUser,
        password: 'securepass123',
        confirm_password: 'securepass123',
        nama: 'Test Register',
        email: `${uniqueUser}@test.com`,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    // Cleanup: delete the registered tenant+user
    const { db } = await import('../src/config/db');
    const user = await db.$queryRawUnsafe<any[]>(`SELECT id, tenant_id FROM users WHERE username = $1`, uniqueUser);
    if (user.length > 0) {
      await db.$queryRawUnsafe(`DELETE FROM services WHERE tenant_id = $1`, user[0].tenant_id);
      await db.$queryRawUnsafe(`DELETE FROM tenant_settings WHERE tenant_id = $1`, user[0].tenant_id);
      await db.$queryRawUnsafe(`DELETE FROM users WHERE id = $1`, user[0].id);
      await db.$queryRawUnsafe(`DELETE FROM outlets WHERE tenant_id = $1`, user[0].tenant_id);
      await db.$queryRawUnsafe(`DELETE FROM tenants WHERE id = $1`, user[0].tenant_id);
    }
  });

  // ❌ Failure: Username duplikat
  it('POST /auth/register — username duplikat ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('X-App-Platform', 'LarkMobile')
      .send({
        username: ctx.adminUsername,
        password: 'securepass123',
        confirm_password: 'securepass123',
        nama: 'Duplicate',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('sudah digunakan');
  });

  // ─── LOGOUT ───────────────────────────────────────────────────

  // ✅ Normal: Logout
  it('POST /auth/logout — logout berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('X-App-Platform', 'LarkMobile')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // ─── STAFF LOGIN ──────────────────────────────────────────────

  // ✅ Normal: Staff login via staff_code (mobile only)
  it('POST /auth/login-staff — staff login berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login-staff')
      .set('X-App-Platform', 'LarkMobile')
      .send({ staff_code: ctx.staffUsername });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.user.role).toBe('karyawan');
  });
});
