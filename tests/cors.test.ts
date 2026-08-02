/**
 * @module cors.test
 * @description Regression tests untuk gerbang Origin di app.ts.
 *
 * Latar belakang: `isAllowedOrigin` dulu memakai pencocokan prefiks string
 * (`origin.startsWith('http://localhost')`), sehingga domain milik penyerang
 * seperti `http://localhost.evil.com` dinyatakan sah. Karena CORS dikonfigurasi
 * dengan `credentials: true`, halaman penyerang bisa memanggil API sambil
 * membawa cookie sesi korban dan membaca balasannya.
 *
 * Test ini mengunci perilaku: origin lookalike WAJIB ditolak 403, origin sah
 * WAJIB lolos gerbang (401 dari authenticateToken = gerbang sudah dilewati).
 *
 * Catatan: NODE_ENV=test, jadi izin localhost/LAN masih aktif — sama seperti
 * saat pengembangan. Di produksi seluruh cabang itu dimatikan.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

const PROTECTED_PATH = '/api/v1/sync/customers';

describe('CORS origin gate', () => {
  // 🚨 Security: domain lookalike yang dulu lolos pencocokan prefiks
  const lookalikeOrigins = [
    'http://localhost.evil.com',
    'http://127.0.0.1.evil.com',
    'http://10.evil.com',
    'http://192.168.evil.com',
    'http://localhost.attacker.test:8080',
  ];

  for (const origin of lookalikeOrigins) {
    it(`menolak origin lookalike: ${origin}`, async () => {
      const res = await request(app).get(PROTECTED_PATH).set('Origin', origin);

      expect(res.status).toBe(403);
    });
  }

  // ✅ Normal: origin yang memang terdaftar tetap lolos gerbang.
  // 401 = gerbang origin dilewati, ditolak authenticateToken karena tanpa token.
  it('meloloskan origin terdaftar (http://localhost:5173)', async () => {
    const res = await request(app)
      .get(PROTECTED_PATH)
      .set('Origin', 'http://localhost:5173');

    expect(res.status).toBe(401);
  });

  // ✅ Normal: LAN privat asli tetap boleh saat non-produksi (uji perangkat fisik)
  it('meloloskan LAN privat asli saat non-produksi', async () => {
    const res = await request(app)
      .get(PROTECTED_PATH)
      .set('Origin', 'http://192.168.1.10:5173');

    expect(res.status).toBe(401);
  });

  // ⚠️ Edge: origin tidak bisa di-parse jangan sampai melempar exception
  it('menolak origin yang bukan URL valid', async () => {
    const res = await request(app)
      .get(PROTECTED_PATH)
      .set('Origin', 'bukan-sebuah-url');

    expect(res.status).toBe(403);
  });

  // ⚠️ Edge: tanpa header Origin (mis. curl / aplikasi mobile) gerbang tidak
  // menghakimi berdasarkan origin — jalur ini dijaga oleh JWT, bukan CORS.
  it('tanpa Origin, request diteruskan ke lapisan autentikasi', async () => {
    const res = await request(app)
      .get(PROTECTED_PATH)
      .set('x-app-platform', 'LarkMobile');

    expect(res.status).toBe(401);
  });
});
