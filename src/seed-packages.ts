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

async function seedPackages() {
  const packages = [
    {
      plan_code: 'month_1' as const,
      nama_paket: '1 Bulan',
      harga: 23000,
      badge_label: null,
      deskripsi_singkat: 'Coba dulu tanpa komitmen panjang.',
      xendit_link: 'https://edi-loupatty.myr.id/m/larklaundry-1-bulan',
      features: [
        'Manajemen Pesanan Laundry',
        'Multi-outlet & Multi-karyawan',
        'Laporan Keuangan Harian & Bulanan',
        'Konfirmasi & Riwayat Pembayaran',
        'Manajemen Pelanggan & Staf',
        'Sync Mobile Real-time (Offline-First)',
        'Notifikasi WhatsApp Otomatis',
        'Export Laporan PDF',
        'Dashboard Analytics',
        'Prioritas Support',
      ],
      is_active: true,
    },
    {
      plan_code: 'months_3' as const,
      nama_paket: '3 Bulan',
      harga: 59000,
      badge_label: 'Hemat 15%',           // Rp 10.000 lebih hemat vs 3× bulanan
      deskripsi_singkat: 'Lebih hemat untuk usaha yang sudah berjalan.',
      xendit_link: 'https://edi-loupatty.myr.id/m/larklaundry-3-bulan',
      features: [
        'Manajemen Pesanan Laundry',
        'Multi-outlet & Multi-karyawan',
        'Laporan Keuangan Harian & Bulanan',
        'Konfirmasi & Riwayat Pembayaran',
        'Manajemen Pelanggan & Staf',
        'Sync Mobile Real-time (Offline-First)',
        'Notifikasi WhatsApp Otomatis',
        'Export Laporan PDF',
        'Dashboard Analytics',
        'Prioritas Support',
      ],
      is_active: true,
    },
    {
      plan_code: 'months_12' as const,
      nama_paket: '12 Bulan',
      harga: 199000,
      badge_label: 'Terbaik · Hemat Rp 77.000', // Rp 77.000 lebih hemat vs 12× bulanan
      deskripsi_singkat: 'Investasi terbaik untuk satu tahun operasional.',
      xendit_link: 'https://edi-loupatty.myr.id/m/larklaundry-12-bulan',
      features: [
        'Manajemen Pesanan Laundry',
        'Multi-outlet & Multi-karyawan',
        'Laporan Keuangan Harian & Bulanan',
        'Konfirmasi & Riwayat Pembayaran',
        'Manajemen Pelanggan & Staf',
        'Sync Mobile Real-time (Offline-First)',
        'Notifikasi WhatsApp Otomatis',
        'Export Laporan PDF',
        'Dashboard Analytics',
        'Prioritas Support',
      ],
      is_active: true,
    },
  ];

  for (const p of packages) {
    const result = await prisma.subscription_packages.upsert({
      where: { plan_code: p.plan_code },
      update: {
        nama_paket: p.nama_paket,
        harga: p.harga,
        badge_label: p.badge_label,
        deskripsi_singkat: p.deskripsi_singkat,
        features: p.features,
        is_active: p.is_active,
      },
      create: p,
    });
    console.log(`Upserted: ${result.plan_code} — Rp ${result.harga}`);
  }

  await prisma.$disconnect();
  console.log('Done!');
}

seedPackages().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
