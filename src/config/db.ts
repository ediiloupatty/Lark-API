import { PrismaClient } from '@prisma/client';
import { Pool, PoolClient } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'path';

// Fix import hoisting bug: Load .env before initializing Prisma
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ── Pool Configuration ───────────────────────────────────────────────────────
// Pool dikonfigurasi agar tahan terhadap gangguan koneksi sementara.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 100,                       // Maks 100 koneksi paralel untuk mengakomodasi Offline Sync
  idleTimeoutMillis: 30000,       // Tutup koneksi idle setelah 30 detik
  connectionTimeoutMillis: 5000,  // Timeout 5 detik jika pool penuh
});

// ── Pool Error Handler (CRITICAL) ───────────────────────────────────────────
// Tanpa ini, error tak tertangkap dari idle client akan CRASH seluruh Node.js process.
// Ini menangkap error seperti: koneksi terputus tiba-tiba, password berubah, DB restart, dll.
pool.on('error', (err: Error) => {
  console.error('[DB Pool] ❌ Unexpected error pada idle client:', err.message);
  // JANGAN process.exit() di sini — biarkan pool auto-recover.
  // Pool akan otomatis membuat koneksi baru saat dibutuhkan.
});

export { pool };

const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

// ── DB Health Probe ──────────────────────────────────────────────────────────
// Digunakan oleh health check endpoint untuk memastikan DB benar-benar responsive.
// Return true jika koneksi OK, false jika gagal.
export async function isDbHealthy(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  } finally {
    if (client) client.release();
  }
}

// ── Connection Check with Retry ──────────────────────────────────────────────
// Dipanggil saat startup. Retry sampai 5x dengan exponential backoff.
// Ini mencegah race condition saat PostgreSQL belum siap tapi backend sudah jalan.
export const checkConnection = async (): Promise<boolean> => {
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 2000; // 2s, 4s, 8s, 16s, 32s

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await prisma.$connect();
      console.log('✅ Koneksi ke PostgreSQL via Prisma berhasil.');
      return true;
    } catch (err: any) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.error(
        `❌ [Attempt ${attempt}/${MAX_RETRIES}] Database connection gagal: ${err.message}`
      );
      if (attempt < MAX_RETRIES) {
        console.log(`   ⏳ Retry dalam ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  console.error('🚨 FATAL: Tidak bisa konek ke database setelah semua retry. Server tetap jalan tapi API akan error.');
  return false;
};

// Ekspor Prisma instance Default ini mirip seperti Pool connection sebelumnya
export const db = prisma;
