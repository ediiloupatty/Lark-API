/**
 * seed_dashboard_scale.ts
 * ------------------------
 * Menambah ~300 tenant baru + ~6.000 order (tersebar 0-29 hari terakhir) untuk
 * mengisi dashboard Super Admin dengan angka yang lebih besar (tenant, global
 * orders, revenue hari ini/kemarin, trend 30 hari, revenue ranking).
 * TIDAK mengubah/menghapus tenant & data yang sudah ada.
 *
 * Usage (di dalam container backend): npx tsx seed_dashboard_scale.ts
 */

import { db } from './src/config/db';
import bcrypt from 'bcrypt';

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[rand(0, arr.length - 1)];

const FIRST_NAMES = [
  'Budi','Siti','Ahmad','Dewi','Andi','Rina','Joko','Maria','Hendra','Fitri','Bambang','Lina','Rudi','Indah','Agus',
  'Novi','Dian','Wahyu','Yuliana','Fajar','Citra','Eko','Putri','Irfan','Sandra','Rizky','Nur','Dedi','Yanti','Hadi',
  'Wati','Bayu','Sri','Doni','Ika','Adi','Retno','Yusuf','Anisa','Fauzan','Ratna','Sigit','Wulan','Hendro','Ayu',
  'Iwan','Gunawan','Melati','Taufik','Nita','Aris','Diah','Herman','Puji','Rahmat','Endah','Slamet','Tuti','Deni',
  'Riki','Susi','Arif','Zaenal','Kartika','Yoga','Sari','Hana','Galih','Vina','Reza','Intan','Dimas','Lestari',
];
const LAST_NAMES = [
  'Santoso','Rahayu','Hidayat','Lestari','Pratama','Wulandari','Susanto','Christina','Wijaya','Handayani','Suryadi',
  'Marlina','Hartono','Permata','Setiabudi','Anggraeni','Sastro','Nugroho','Ramadhan','Kirana','Prasetyo','Hakim',
  'Kusuma','Wibowo','Saputra','Setiawan','Yulianto','Purnomo','Iskandar','Halim','Firmansyah','Kurniawan','Maulana',
  'Utomo','Nasution','Siregar','Simatupang','Panjaitan','Manurung','Sihombing','Wardani','Gunadi','Sinaga','Salim',
];
const BIZ_WORDS = [
  'Bersih','Wangi','Kilat','Cepat','Sejahtera','Mandiri','Jaya','Makmur','Bahagia','Sentosa','Cemerlang','Gemilang',
  'Melati','Mawar','Anggrek','Kenanga','Sakura','Bintang','Mentari','Pelangi','Berkah','Amanah','Sejati','Prima',
  'Utama','Cerdas','Elit','Modern','Nusantara','Merdeka','Harapan','Damai','Ceria','Segar','Rapi','Kinclong',
  'Istimewa','Terpadu','Sukses','Maju',
];
const BIZ_TEMPLATES = [
  (w: string) => `${w} Laundry`,
  (w: string) => `Laundry ${w}`,
  (w: string) => `Laundry ${w} Express`,
  (w: string) => `${w} Laundry Kilat`,
  (w: string) => `Laundry ${w} & Dry Clean`,
  (w: string) => `${w} Fresh Laundry`,
];

const fullName = () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const NEW_TENANTS = 300;

async function main() {
  console.log(`Seeding ${NEW_TENANTS} tenant baru + order...\n`);

  const pwHash = await bcrypt.hash('Seed123!', 10);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  let totalOrdersCreated = 0;
  let totalRevenueCreated = 0;
  const usedSlugs = new Set<string>();

  for (let i = 0; i < NEW_TENANTS; i++) {
    const bizName = pick(BIZ_TEMPLATES)(pick(BIZ_WORDS));
    let slug = slugify(bizName) + '-' + (Date.now().toString(36).slice(-4)) + '-' + i;
    while (usedSlugs.has(slug)) slug += 'x';
    usedSlugs.add(slug);

    // Umur tenant acak 0-90 hari; 2% dibuat "hari ini" biar Tenant Baru Hari Ini > 0
    const isNewToday = Math.random() < 0.02;
    const tenantCreatedAt = isNewToday
      ? new Date(today.getTime() + rand(0, 6) * 3600000)
      : new Date(today.getTime() - rand(1, 90) * 86400000 - rand(0, 86399) * 1000);

    const isPaid = Math.random() < 0.2;
    const plan = !isPaid ? 'free' : pick(['month_1', 'months_3', 'months_12'] as const);
    const planDays = plan === 'month_1' ? 30 : plan === 'months_3' ? 90 : plan === 'months_12' ? 365 : 0;

    const tenant = await db.tenants.create({
      data: {
        name: bizName,
        slug,
        is_active: true,
        subscription_plan: plan as any,
        subscription_until: plan === 'free' ? null : new Date(Date.now() + planDays * 86400000),
        created_at: tenantCreatedAt,
      },
    });

    const outlet = await db.outlets.create({
      data: { tenant_id: tenant.id, nama: `${bizName} - Cabang Utama`, alamat: `Jl. Raya No. ${rand(1, 200)}`, phone: `08${rand(1000000000, 1999999999)}` },
    });

    const ownerName = fullName();
    await db.users.create({
      data: {
        tenant_id: tenant.id,
        username: `seed_owner_${tenant.id}`,
        password: pwHash,
        role: 'owner',
        nama: ownerName,
        email: `owner${tenant.id}.seed@larklaundry.local`,
        is_active: true,
        auth_provider: 'local',
        outlet_id: outlet.id,
        permissions: {},
        created_at: tenantCreatedAt,
      },
    });

    // Customers (bulk)
    const nCustomers = rand(6, 16);
    await db.customers.createMany({
      data: Array.from({ length: nCustomers }, () => ({
        tenant_id: tenant.id,
        nama: fullName(),
        no_hp: `08${rand(1000000000, 1999999999)}`,
        alamat: `Jl. ${pick(BIZ_WORDS)} No. ${rand(1, 99)}`,
      })),
    });
    const customers = await db.customers.findMany({ where: { tenant_id: tenant.id }, select: { id: true } });

    // Orders (bulk) — 8..30 order per tenant, tersebar hari ini/kemarin/2-29 hari lalu
    const nOrders = rand(8, 30);
    const ordersData = [];
    for (let j = 0; j < nOrders; j++) {
      const roll = Math.random();
      let dayOffset: number;
      if (roll < 0.04) dayOffset = 0;
      else if (roll < 0.08) dayOffset = 1;
      else dayOffset = rand(2, 29);

      const tgl_order = new Date(today.getTime() - dayOffset * 86400000 + rand(7 * 3600, 21 * 3600) * 1000);
      const statusRoll = Math.random();
      const status = statusRoll < 0.70 ? 'selesai' : statusRoll < 0.80 ? 'diproses' : statusRoll < 0.90 ? 'siap_diambil' : statusRoll < 0.95 ? 'menunggu_konfirmasi' : 'dibatalkan';
      const total_harga = rand(40000, 280000);

      ordersData.push({
        tenant_id: tenant.id,
        customer_id: pick(customers).id,
        kode_pesanan: `SEED-${tenant.id}-${j}-${Date.now().toString(36).slice(-4)}`,
        total_harga,
        tgl_order,
        tgl_selesai: status === 'selesai' ? new Date(tgl_order.getTime() + rand(4, 30) * 3600000) : null,
        status: status as any,
        metode_antar: pick(['jemput', 'antar_sendiri'] as const) as any,
        outlet_id: outlet.id,
        created_at: tgl_order,
      });

      if (status !== 'dibatalkan') totalRevenueCreated += total_harga;
    }
    await db.orders.createMany({ data: ordersData });
    totalOrdersCreated += ordersData.length;

    if ((i + 1) % 25 === 0) console.log(`  ...${i + 1}/${NEW_TENANTS} tenant, ${totalOrdersCreated} order sejauh ini`);
  }

  console.log('\n════════════════════════════════════════');
  console.log('SELESAI');
  console.log(`  Tenant baru : ${NEW_TENANTS}`);
  console.log(`  Order baru  : ${totalOrdersCreated}`);
  console.log(`  Revenue (perkiraan, non-dibatalkan): Rp ${totalRevenueCreated.toLocaleString('id-ID')}`);
  console.log('════════════════════════════════════════');
}

main()
  .catch(e => { console.error('ERROR', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
