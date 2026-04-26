/**
 * seed_dummy_orders.ts
 * ---------------------
 * Creates a complete demo environment with a tenant, admin user, customers,
 * services, packages, outlet, and realistic dummy transactions for the last 5 days.
 *
 * Usage:  npx tsx seed_dummy_orders.ts
 *
 * WHY: Populate dashboard charts, order tables, and reports with visible data
 *      so the admin UI shows meaningful metrics during development & demo.
 *
 * SAFETY: Does NOT delete existing data. Creates new records only.
 *         Uses unique tracking_code + kode_pesanan to avoid conflicts.
 */

import { db } from './src/config/db';
import bcrypt from 'bcrypt';

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
  'selesai',        // bias towards selesai for realistic revenue
] as const;

const METODE_ANTAR = ['jemput', 'antar_sendiri'] as const;
const PAYMENT_METHODS = ['cash', 'transfer', 'qris'] as const;

const CATATAN_LIST = [
  'Pisahkan baju putih',
  'Jangan pakai pewangi',
  'Setrika rapi',
  'Extra parfum',
  'Jemput sebelum jam 10',
  'Hati-hati bahan sutra',
  null, null, null,
];

/* ── Main ─────────────────────────────────────────── */
async function main() {
  console.log('🔍 Checking existing data in database...\n');

  // ────────────────────────────────────────────────────────
  // STEP 1: Ensure a tenant exists (reuse or create)
  // ────────────────────────────────────────────────────────
  let tenant = await db.tenants.findFirst({ where: { is_active: true } });

  if (!tenant) {
    console.log('📦 No tenant found. Creating demo tenant "Lark Laundry"...');
    tenant = await db.tenants.create({
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
    console.log(`  ✅ Tenant created: ${tenant.name} (ID: ${tenant.id})`);
  } else {
    console.log(`  ✅ Using existing tenant: ${tenant.name} (ID: ${tenant.id})`);
  }

  const TENANT_ID = tenant.id;

  // ────────────────────────────────────────────────────────
  // STEP 2: Ensure an admin user exists for this tenant
  // ────────────────────────────────────────────────────────
  let adminUser = await db.users.findFirst({
    where: { tenant_id: TENANT_ID, role: { in: ['admin', 'owner'] }, is_active: true },
  });

  if (!adminUser) {
    // Check if the super_admin exists, link them too
    const superAdmin = await db.users.findFirst({
      where: { role: 'super_admin', is_active: true },
    });

    if (superAdmin && !superAdmin.tenant_id) {
      // Link super_admin to tenant for demo purposes
      console.log(`  🔗 Linking super_admin "${superAdmin.username}" to tenant...`);
      await db.users.update({
        where: { id: superAdmin.id },
        data: { tenant_id: TENANT_ID },
      });
    }

    // Create a dedicated admin user
    const passwordHash = await bcrypt.hash('admin123', 10);
    adminUser = await db.users.create({
      data: {
        tenant_id: TENANT_ID,
        username: 'admin_lark',
        password: passwordHash,
        role: 'admin',
        nama: 'Admin Demo',
        email: 'admin@larklaundry.com',
        no_hp: '081298765432',
        is_active: true,
        permissions: {},
      },
    });
    console.log(`  ✅ Admin user created: ${adminUser.username} (password: admin123)`);
  } else {
    console.log(`  ✅ Using existing admin: ${adminUser.username} (ID: ${adminUser.id})`);
  }

  // ────────────────────────────────────────────────────────
  // STEP 3: Ensure outlet exists
  // ────────────────────────────────────────────────────────
  let outlet = await db.outlets.findFirst({ where: { tenant_id: TENANT_ID } });

  if (!outlet) {
    outlet = await db.outlets.create({
      data: {
        tenant_id: TENANT_ID,
        nama: 'Cabang Pusat',
        alamat: 'Jl. Sudirman No. 1, Jakarta',
        phone: '081234567890',
      },
    });
    console.log(`  ✅ Outlet created: ${outlet.nama}`);
  } else {
    console.log(`  ✅ Using existing outlet: ${outlet.nama}`);
  }

  // ────────────────────────────────────────────────────────
  // STEP 4: Ensure customers exist
  // ────────────────────────────────────────────────────────
  let customers = await db.customers.findMany({
    where: { tenant_id: TENANT_ID, deleted_at: null },
  });

  if (customers.length < 3) {
    console.log('  👥 Creating dummy customers...');
    const dummyNames = [
      { nama: 'Budi Santoso',   no_hp: '081234567001', alamat: 'Jl. Merdeka No. 1' },
      { nama: 'Siti Rahayu',    no_hp: '081234567002', alamat: 'Jl. Pahlawan No. 12' },
      { nama: 'Ahmad Hidayat',  no_hp: '081234567003', alamat: 'Jl. Gatot Subroto No. 5' },
      { nama: 'Dewi Lestari',   no_hp: '081234567004', alamat: 'Jl. Thamrin No. 8' },
      { nama: 'Andi Pratama',   no_hp: '081234567005', alamat: 'Jl. Diponegoro No. 3' },
      { nama: 'Rina Wulandari', no_hp: '081234567006', alamat: 'Jl. Asia Afrika No. 22' },
      { nama: 'Joko Widodo',    no_hp: '081234567007', alamat: 'Jl. Dago No. 15' },
      { nama: 'Maria Theresia', no_hp: '081234567008', alamat: 'Jl. Braga No. 7' },
    ];
    for (const c of dummyNames) {
      const exists = await db.customers.findFirst({
        where: { tenant_id: TENANT_ID, no_hp: c.no_hp },
      });
      if (!exists) {
        await db.customers.create({ data: { tenant_id: TENANT_ID, ...c } });
      }
    }
    customers = await db.customers.findMany({
      where: { tenant_id: TENANT_ID, deleted_at: null },
    });
    console.log(`  ✅ Total customers: ${customers.length}`);
  } else {
    console.log(`  ✅ Using ${customers.length} existing customers`);
  }

  // ────────────────────────────────────────────────────────
  // STEP 5: Ensure services exist
  // ────────────────────────────────────────────────────────
  let services = await db.services.findMany({
    where: { tenant_id: TENANT_ID, is_active: true },
  });

  if (services.length === 0) {
    console.log('  🧺 Creating laundry services...');
    const dummyServices = [
      { nama_layanan: 'Cuci Kering',       harga_per_kg: 7000,  durasi_jam: 24, satuan: 'kg' },
      { nama_layanan: 'Cuci Setrika',       harga_per_kg: 10000, durasi_jam: 48, satuan: 'kg' },
      { nama_layanan: 'Setrika Saja',       harga_per_kg: 5000,  durasi_jam: 12, satuan: 'kg' },
      { nama_layanan: 'Cuci Express (6jam)', harga_per_kg: 15000, durasi_jam: 6,  satuan: 'kg' },
      { nama_layanan: 'Cuci Bed Cover',     harga_per_kg: 25000, durasi_jam: 48, satuan: 'pcs' },
      { nama_layanan: 'Cuci Sepatu',        harga_per_kg: 20000, durasi_jam: 72, satuan: 'pcs' },
    ];
    for (const s of dummyServices) {
      await db.services.create({ data: { tenant_id: TENANT_ID, ...s } });
    }
    services = await db.services.findMany({
      where: { tenant_id: TENANT_ID, is_active: true },
    });
    console.log(`  ✅ Created ${services.length} services`);
  } else {
    console.log(`  ✅ Using ${services.length} existing services`);
  }

  // ────────────────────────────────────────────────────────
  // STEP 6: Generate orders for last 5 days
  // ────────────────────────────────────────────────────────
  console.log('\n📊 Generating orders for the last 5 days...');

  const ORDERS_PER_DAY_MIN = 4;
  const ORDERS_PER_DAY_MAX = 10;

  let totalOrders = 0;
  let totalRevenue = 0;

  for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
    const numOrders = rand(ORDERS_PER_DAY_MIN, ORDERS_PER_DAY_MAX);
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

      // Pick 1-3 services for this order
      const numSvc = rand(1, Math.min(3, services.length));
      const selectedServices = [...services]
        .sort(() => Math.random() - 0.5)
        .slice(0, numSvc);

      // Calculate order details
      const details: {
        service_id: number;
        jenis_pakaian: string;
        jumlah: number;
        berat: number;
        harga: number;
        subtotal: number;
      }[] = [];

      let total = 0;
      for (const svc of selectedServices) {
        const berat = parseFloat((rand(15, 80) / 10).toFixed(1)); // 1.5 - 8.0 kg
        const harga = Number(svc.harga_per_kg);
        const subtotal = Math.round(berat * harga);
        total += subtotal;
        details.push({
          service_id: svc.id,
          jenis_pakaian: svc.nama_layanan,
          jumlah: 1,
          berat,
          harga,
          subtotal,
        });
      }

      // Timestamps based on status progression
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

      const trackingCode = randomCode('TRK');
      const kodePesanan = randomCode('ORD');

      // Create order
      const order = await db.orders.create({
        data: {
          tenant_id: TENANT_ID,
          customer_id: customer.id,
          kode_pesanan: kodePesanan,
          tracking_code: trackingCode,
          total_harga: total,
          tgl_order,
          tgl_diproses,
          tgl_siap,
          tgl_selesai,
          status: status as any,
          metode_antar: metode as any,
          outlet_id: outlet.id,
          user_id: adminUser.id,
          catatan,
          estimasi_tanggal: new Date(tgl_order.getTime() + rand(24, 72) * 3600000),
        },
      });

      // Create order details
      for (const d of details) {
        await db.order_details.create({
          data: {
            order_id: order.id,
            service_id: d.service_id,
            jenis_pakaian: d.jenis_pakaian,
            jumlah: d.jumlah,
            berat: d.berat,
            harga: d.harga,
            subtotal: d.subtotal,
          },
        });
      }

      // Create payment record
      const paymentMethod = pick([...PAYMENT_METHODS]);
      const isLunas = ['selesai', 'siap_diambil'].includes(status);

      await db.payments.create({
        data: {
          tenant_id: TENANT_ID,
          order_id: order.id,
          metode_pembayaran: paymentMethod as any,
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

  // ────────────────────────────────────────────────────────
  // STEP 7: Create some expenses for realism
  // ────────────────────────────────────────────────────────
  console.log('\n💸 Adding operational expenses...');
  const expenseCategories = [
    { kategori: 'Operasional', deskripsi: 'Tagihan listrik bulanan',   jumlah: 850000 },
    { kategori: 'Perlengkapan', deskripsi: 'Deterjen 5kg x 3',        jumlah: 225000 },
    { kategori: 'Perlengkapan', deskripsi: 'Pewangi laundry 2 liter', jumlah: 75000 },
    { kategori: 'Operasional', deskripsi: 'Tagihan air PDAM',         jumlah: 320000 },
    { kategori: 'Gaji',        deskripsi: 'Gaji kasir part-time',     jumlah: 1500000 },
    { kategori: 'Lainnya',     deskripsi: 'Perbaikan mesin cuci',     jumlah: 450000 },
  ];

  for (const exp of expenseCategories) {
    const tanggal = daysBefore(rand(0, 4));
    await db.expenses.create({
      data: {
        tenant_id: TENANT_ID,
        outlet_id: outlet.id,
        kategori: exp.kategori,
        deskripsi: exp.deskripsi,
        jumlah: exp.jumlah,
        tanggal,
        created_by: adminUser.id,
      },
    });
  }
  console.log(`  ✅ Created ${expenseCategories.length} expense records`);

  // ── Summary ──
  console.log('\n════════════════════════════════════════');
  console.log(`🎉 SEED COMPLETE!`);
  console.log(`   Tenant:    ${tenant.name}`);
  console.log(`   Admin:     ${adminUser.username}`);
  console.log(`   Orders:    ${totalOrders} pesanan`);
  console.log(`   Revenue:   Rp ${totalRevenue.toLocaleString('id-ID')}`);
  console.log(`   Expenses:  ${expenseCategories.length} catatan`);
  console.log(`   Customers: ${customers.length} pelanggan`);
  console.log(`   Services:  ${services.length} layanan`);
  console.log('════════════════════════════════════════');
  console.log('\n🔄 Refresh your dashboard to see the data!');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
