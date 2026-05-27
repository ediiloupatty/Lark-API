// One-off script: update HANYA kolom `features` di subscription_packages
// supaya konsisten dengan landing page (pricing.f1–f15).
// Tidak menyentuh kolom lain → aman walau schema lokal/prod beda
// (mis. `mayar_link` belum ada di prod).
//
// Jalankan: npx tsx src/update-features.ts

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

const dbUrl = process.env.DATABASE_URL || '';
const needsSsl = dbUrl.includes('sslmode=require') || dbUrl.includes('neon.tech') || dbUrl.includes('supabase');

const pool = new Pool({
  connectionString: dbUrl,
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PREMIUM_FEATURES = [
  'Manajemen Pesanan Laundry',
  'Multi-outlet & Multi-karyawan',
  'Laporan Keuangan Harian & Bulanan',
  'Konfirmasi & Riwayat Pembayaran',
  'Manajemen Pelanggan & Staf',
  'Sync Mobile Real-time (Offline-First)',
  'Notifikasi WhatsApp Otomatis ke Pelanggan',
  'Export Laporan PDF & CSV',
  'Dashboard Analytics',
  'Tracking Pesanan Pelanggan',
  'Manajemen Produk & Parfum',
  'Pencatatan Pengeluaran',
  'Cetak Struk & Nota',
  'Prioritas Support',
  'Notifikasi Real-time untuk Admin & Karyawan',
];

async function main() {
  // Lihat dulu plan_code apa saja yang ada di DB (enum prod mungkin beda).
  const existing = await prisma.$queryRawUnsafe<any[]>(
    `SELECT plan_code::text AS plan_code FROM subscription_packages ORDER BY plan_code`
  );
  console.log('[update-features] Plan yang ada di DB:', existing.map(r => r.plan_code).join(', '));

  const json = JSON.stringify(PREMIUM_FEATURES);
  const affected = await prisma.$executeRawUnsafe(
    `UPDATE subscription_packages SET features = $1::jsonb`,
    json
  );
  console.log(`[update-features] Updated ${affected} package(s).`);

  // Verifikasi
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT plan_code::text AS plan_code, jsonb_array_length(features) AS n
     FROM subscription_packages
     ORDER BY plan_code`
  );
  for (const r of rows) {
    console.log(`  - ${r.plan_code}: ${r.n} fitur`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
