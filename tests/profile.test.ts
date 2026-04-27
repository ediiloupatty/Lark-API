/**
 * @module profile.test
 * @description Integration tests untuk ProfileController — User Profile & Password Change
 *
 * Scope:
 *  - getProfile: user info retrieval with tenant data
 *  - updateProfile: field update, username uniqueness check
 *  - changePassword: old password verification, token_version increment on success
 *
 * Dependencies (real — integration test):
 *  - PostgreSQL (test database via seedTestData)
 *  - Express app instance
 *  - bcrypt (password restore in cleanup)
 *
 * CATATAN: Test change-password yang berhasil akan menaikkan token_version,
 * membuat token lama invalid. Test diurutkan dengan hati-hati agar
 * change-password sukses menjadi test TERAKHIR.
 *
 * @see rules-test.md Section 5.2 — profileController requires 100% branch coverage
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { seedTestData, cleanupTestData, authHeaders, TEST_PREFIX } from './setup';

describe('Profile Controller', () => {
  let ctx: Awaited<ReturnType<typeof seedTestData>>;

  beforeAll(async () => { ctx = await seedTestData(); });
  afterAll(async () => { await cleanupTestData(); });

  // ✅ Normal: Get profile
  it('GET /sync/profile — berhasil', async () => {
    const res = await request(app)
      .get('/api/v1/sync/profile')
      .set(authHeaders(ctx.adminToken));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.username).toBe(ctx.adminUsername);
    expect(res.body.data.tenant).toBeDefined();
  });

  // ✅ Normal: Update profile
  it('POST /sync/profile — berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/profile')
      .set(authHeaders(ctx.adminToken))
      .send({
        nama: 'Admin Updated Name',
        email: `${TEST_PREFIX}updated@test.com`,
        username: ctx.adminUsername,
        no_hp: '08199999999',
        alamat: 'Jl. Updated',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.nama).toBe('Admin Updated Name');
  });

  // ⚠️ Edge: Username duplikat
  it('POST /sync/profile — username duplikat ditolak', async () => {
    const res = await request(app)
      .post('/api/v1/sync/profile')
      .set(authHeaders(ctx.adminToken))
      .send({
        nama: 'Admin',
        email: 'admin@test.com',
        username: ctx.staffUsername, // Belongs to staff
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('sudah digunakan');
  });

  // ❌ Failure: Password lama salah (HARUS sebelum change-password sukses!)
  it('POST /sync/change-password — password lama salah', async () => {
    const res = await request(app)
      .post('/api/v1/sync/change-password')
      .set(authHeaders(ctx.adminToken))
      .send({ old_password: 'wrong_old_pw', new_password: 'newsecure123' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('tidak sesuai');
  });

  // ✅ Normal: Change password berhasil (TERAKHIR — increments token_version)
  it('POST /sync/change-password — berhasil', async () => {
    const res = await request(app)
      .post('/api/v1/sync/change-password')
      .set(authHeaders(ctx.adminToken))
      .send({ old_password: 'testpassword123', new_password: 'newsecure123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('berhasil');

    // Restore password for cleanup (use raw SQL since token may be invalid now)
    const { db } = await import('../src/config/db');
    const bcrypt = await import('bcrypt');
    const hashed = await bcrypt.hash('testpassword123', 10);
    await db.$queryRawUnsafe(`UPDATE users SET password = $1, token_version = 0 WHERE id = $2`, hashed, ctx.adminUserId);
  });
});
