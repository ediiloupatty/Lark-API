import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import dotenv from 'dotenv';
import path from 'path';

// Fix import hoisting bug: Load .env before initializing Prisma
dotenv.config({ path: path.join(__dirname, '../../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                        // Maks 20 koneksi paralel
  idleTimeoutMillis: 30000,       // Tutup koneksi idle setelah 30 detik
  connectionTimeoutMillis: 5000,  // Timeout 5 detik jika pool penuh
});
export { pool };
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

// Fungsi pengecekan status yang dipanggil di index.ts
export const checkConnection = async () => {
  try {
    await prisma.$connect();
    console.log('✅ Koneksi ke PostgreSQL via Prisma berhasil.');
  } catch (err: any) {
    console.error('❌ Database PostgreSQL Error via Prisma:', err.message);
  }
};

// Ekspor Prisma instance Default ini mirip seperti Pool connection sebelumnya
export const db = prisma;
