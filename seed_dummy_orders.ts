/**
 * seed_dummy_orders.ts
 * ---------------------
 * Seeds 5 days of dummy transactions using the EXISTING user account.
 * Creates only the supporting data (tenant, outlet, customers, services)
 * that the architecture requires, then assigns everything to the existing user.
 *
 * Usage:  npx tsx seed_dummy_orders.ts
 *
 * SAFETY: Does NOT create new user accounts. Only inserts supporting data.
 */

import { db } from './src/config/db';

/* ── Helpers ──────────────────────────────────────────── */
const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pick = <T>(arr: T[]): T => arr[rand(0, arr.length - 1)];

const randomCode = (prefix: string) =>
  `${prefix}-${Date.now().toString(36).slice(-4).toUpperCase()}${rand(100, 999)}`;

const daysBefore = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(rand(7, 20), rand(0, 59), rand(0, 59), 0);
  return d;
};

const STATUSES = [
  'menunggu_konfirmasi',
  'diproses',
  'siap_diambil',
  'selesai',
  'selesai',
  'selesai',
] as const;

const METODE_ANTAR = ['jemput', 'antar_sendiri'] as const;
const PAYMENT_METHODS = ['cash', 'transfer', 'qris'] as const;

const CATATAN_LIST = [
  'Pisahkan baju putih', 'Jangan pakai pewangi', 'Setrika rapi',
  'Extra parfum', 'Jemput sebelum jam 10', 'Hati-hati bahan sutra',
  null, null, null,
];

/* ── Main ─────────────────────────────────────────── */
async function main() {
  console.log('🔍 Looking up existing user account...\n');

  // ── STEP 1: Find the existing user ──
  const existingUser = await db.users.findFirst({
    where: { is_active: true },
    orderBy: { id: 'asc' },
  });

  if (!existingUser) {
    console.error('❌ No active user found in database.');
    return;
  }

  console.log(`  👤 Found user: "${existingUser.username}" (ID: ${existingUser.id}, role: ${existingUser.role})`);

  // ── STEP 2: Ensure tenant exists for this user ──
  let tenantId = existingUser.tenant_id;

  if (!tenantId) {
    console.log('  📦 User has no tenant. Creating tenant...');
    const tenant = await db.tenants.create({
      data: {
        name: 'Lark Laundry',
        slug: 'lark-laundry',
        address: 'Jl. Sudirman No. 1, Jakarta Pusat',
        phone: '081234567890',
        email: 'info@larklaundry.com',
        subscription_plan: 'free',
        is_active: true,
      },
    });
    tenantId = tenant.id;

    // Link existing user to tenant
    await db.users.update({
      where: { id: existingUser.id },
      data: { tenant_id: tenantId },
    });
    console.log(`  ✅ Tenant "Lark Laundry" created (ID: ${tenantId}) → linked to ${existingUser.username}`);
  } else {
    const tenant = await db.tenants.findUnique({ where: { id: tenantId } });
    console.log(`  ✅ Using existing tenant: "${tenant?.name}" (ID: ${tenantId})`);
  }

  // ── STEP 3: Ensure outlet exists ──
  let outlet = await db.outlets.findFirst({ where: { tenant_id: tenantId } });
  if (!outlet) {
    outlet = await db.outlets.create({
      data: {
        tenant_id: tenantId,
        nama: 'Cabang Pusat',
        alamat: 'Jl. Sudirman No. 1, Jakarta',
        phone: '081234567890',
      },
    });
    console.log(`  ✅ Outlet created: ${outlet.nama}`);
  } else {
    console.log(`  ✅ Using existing outlet: ${outlet.nama}`);
  }

  // ── STEP 4: Ensure customers exist ──
  let customers = await db.customers.findMany({
    where: { tenant_id: tenantId, deleted_at: null },
  });

  if (customers.length < 3) {
    console.log('  👥 Creating dummy customers...');
    const names = [
      { nama: 'Budi Santoso',   no_hp: '081234567001', alamat: 'Jl. Merdeka No. 1' },
      { nama: 'Siti Rahayu',    no_hp: '081234567002', alamat: 'Jl. Pahlawan No. 12' },
      { nama: 'Ahmad Hidayat',  no_hp: '081234567003', alamat: 'Jl. Gatot Subroto No. 5' },
      { nama: 'Dewi Lestari',   no_hp: '081234567004', alamat: 'Jl. Thamrin No. 8' },
      { nama: 'Andi Pratama',   no_hp: '081234567005', alamat: 'Jl. Diponegoro No. 3' },
      { nama: 'Rina Wulandari', no_hp: '081234567006', alamat: 'Jl. Asia Afrika No. 22' },
      { nama: 'Joko Susanto',   no_hp: '081234567007', alamat: 'Jl. Dago No. 15' },
      { nama: 'Maria Christina',no_hp: '081234567008', alamat: 'Jl. Braga No. 7' },
    ];
    for (const c of names) {
      const exists = await db.customers.findFirst({
        where: { tenant_id: tenantId, no_hp: c.no_hp },
      });
      if (!exists) await db.customers.create({ data: { tenant_id: tenantId, ...c } });
    }
    customers = await db.customers.findMany({
      where: { tenant_id: tenantId, deleted_at: null },
    });
    console.log(`  ✅ Total customers: ${customers.length}`);
  } else {
    console.log(`  ✅ Using ${customers.length} existing customers`);
  }

  // ── STEP 5: Ensure services exist ──
  let services = await db.services.findMany({
    where: { tenant_id: tenantId, is_active: true },
  });

  if (services.length === 0) {
    console.log('  🧺 Creating laundry services...');
    const svcList = [
      { nama_layanan: 'Cuci Kering',       harga_per_kg: 7000,  durasi_jam: 24, satuan: 'kg' },
      { nama_layanan: 'Cuci Setrika',       harga_per_kg: 10000, durasi_jam: 48, satuan: 'kg' },
      { nama_layanan: 'Setrika Saja',       harga_per_kg: 5000,  durasi_jam: 12, satuan: 'kg' },
      { nama_layanan: 'Cuci Express (6jam)', harga_per_kg: 15000, durasi_jam: 6,  satuan: 'kg' },
      { nama_layanan: 'Cuci Bed Cover',     harga_per_kg: 25000, durasi_jam: 48, satuan: 'pcs' },
      { nama_layanan: 'Cuci Sepatu',        harga_per_kg: 20000, durasi_jam: 72, satuan: 'pcs' },
    ];
    for (const s of svcList) await db.services.create({ data: { tenant_id: tenantId, ...s } });
    services = await db.services.findMany({
      where: { tenant_id: tenantId, is_active: true },
    });
    console.log(`  ✅ Created ${services.length} services`);
  } else {
    console.log(`  ✅ Using ${services.length} existing services`);
  }

  // ── STEP 6: Generate orders for last 5 days ──
  console.log(`\n📊 Generating orders for the last 5 days (user: ${existingUser.username})...`);

  let totalOrders = 0;
  let totalRevenue = 0;

  for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
    const numOrders = rand(4, 10);
    const baseDate = daysBefore(dayOffset);
    const dateLabel = baseDate.toLocaleDateString('id-ID', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });

    let dayRevenue = 0;

    for (let i = 0; i < numOrders; i++) {
      const customer = pick(customers);
      const status = pick([...STATUSES]);
      const metode = pick([...METODE_ANTAR]);
      const catatan = pick(CATATAN_LIST);

      // Pick 1-3 services
      const numSvc = rand(1, Math.min(3, services.length));
      const selectedServices = [...services].sort(() => Math.random() - 0.5).slice(0, numSvc);

      const details: { service_id: number; jenis_pakaian: string; jumlah: number; berat: number; harga: number; subtotal: number }[] = [];
      let total = 0;

      for (const svc of selectedServices) {
        const berat = parseFloat((rand(15, 80) / 10).toFixed(1));
        const harga = Number(svc.harga_per_kg);
        const subtotal = Math.round(berat * harga);
        total += subtotal;
        details.push({ service_id: svc.id, jenis_pakaian: svc.nama_layanan, jumlah: 1, berat, harga, subtotal });
      }

      // Timestamps
      const tgl_order = new Date(baseDate);
      tgl_order.setMinutes(tgl_order.getMinutes() + rand(0, 30) * i);

      let tgl_diproses: Date | null = null;
      let tgl_siap: Date | null = null;
      let tgl_selesai: Date | null = null;

      if (['diproses', 'siap_diambil', 'selesai'].includes(status)) {
        tgl_diproses = new Date(tgl_order);
        tgl_diproses.setHours(tgl_diproses.getHours() + rand(1, 3));
      }
      if (['siap_diambil', 'selesai'].includes(status)) {
        tgl_siap = new Date(tgl_diproses!);
        tgl_siap.setHours(tgl_siap.getHours() + rand(6, 24));
      }
      if (status === 'selesai') {
        tgl_selesai = new Date(tgl_siap!);
        tgl_selesai.setHours(tgl_selesai.getHours() + rand(1, 8));
      }

      // Create order — user_id = existing user
      const order = await db.orders.create({
        data: {
          tenant_id: tenantId,
          customer_id: customer.id,
          kode_pesanan: randomCode('ORD'),
          tracking_code: randomCode('TRK'),
          total_harga: total,
          tgl_order,
          tgl_diproses,
          tgl_siap,
          tgl_selesai,
          status: status as any,
          metode_antar: metode as any,
          outlet_id: outlet.id,
          user_id: existingUser.id,   // ← EXISTING USER
          catatan,
          estimasi_tanggal: new Date(tgl_order.getTime() + rand(24, 72) * 3600000),
        },
      });

      // Order details
      for (const d of details) {
        await db.order_details.create({
          data: { order_id: order.id, ...d },
        });
      }

      // Payment
      const isLunas = ['selesai', 'siap_diambil'].includes(status);
      await db.payments.create({
        data: {
          tenant_id: tenantId,
          order_id: order.id,
          metode_pembayaran: pick([...PAYMENT_METHODS]) as any,
          jumlah_bayar: total,
          status_pembayaran: isLunas ? 'lunas' : 'pending',
          outlet_id: outlet.id,
          tgl_pembayaran: isLunas ? (tgl_selesai ?? tgl_siap ?? tgl_order) : null,
        },
      });

      totalOrders++;
      totalRevenue += total;
      dayRevenue += total;
    }

    console.log(`  📅 ${dateLabel}: ${numOrders} pesanan — Rp ${dayRevenue.toLocaleString('id-ID')}`);
  }

  // ── STEP 7: Expenses ──
  console.log('\n💸 Adding operational expenses...');
  const expList = [
    { kategori: 'Operasional',  deskripsi: 'Tagihan listrik bulanan',  jumlah: 850000 },
    { kategori: 'Perlengkapan', deskripsi: 'Deterjen 5kg x 3',        jumlah: 225000 },
    { kategori: 'Perlengkapan', deskripsi: 'Pewangi laundry 2 liter',  jumlah: 75000 },
    { kategori: 'Operasional',  deskripsi: 'Tagihan air PDAM',         jumlah: 320000 },
    { kategori: 'Gaji',         deskripsi: 'Gaji kasir part-time',     jumlah: 1500000 },
    { kategori: 'Lainnya',      deskripsi: 'Perbaikan mesin cuci',     jumlah: 450000 },
  ];
  for (const exp of expList) {
    await db.expenses.create({
      data: {
        tenant_id: tenantId,
        outlet_id: outlet.id,
        kategori: exp.kategori,
        deskripsi: exp.deskripsi,
        jumlah: exp.jumlah,
        tanggal: daysBefore(rand(0, 4)),
        created_by: existingUser.id,
      },
    });
  }
  console.log(`  ✅ Created ${expList.length} expense records`);

  // ── Summary ──
  console.log('\n════════════════════════════════════════');
  console.log('🎉 SEED COMPLETE!');
  console.log(`   User:      ${existingUser.username} (ID: ${existingUser.id})`);
  console.log(`   Orders:    ${totalOrders} pesanan`);
  console.log(`   Revenue:   Rp ${totalRevenue.toLocaleString('id-ID')}`);
  console.log(`   Customers: ${customers.length}`);
  console.log(`   Services:  ${services.length}`);
  console.log('════════════════════════════════════════');
  console.log('\n🔄 Refresh dashboard to see the data!');
}

main()
  .catch((e) => { console.error('❌ Error:', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
