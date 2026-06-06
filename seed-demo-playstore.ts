/**
 * Seed akun demo untuk peninjauan Google Play Store.
 *
 * Membuat 1 tenant demo + 1 akun owner dengan akses penuh (langganan premium),
 * lengkap dengan outlet, layanan, pelanggan, dan beberapa pesanan contoh agar
 * reviewer Google dapat meninjau seluruh fitur aplikasi.
 *
 * Kredensial reviewer:
 *   username: owner_test01
 *   password: Test123!
 *
 * Script ini IDEMPOTENT — aman dijalankan berkali-kali (tidak menggandakan data).
 *
 * Jalankan di VPS (folder production):
 *   cd /var/www/larklaundry/backend-node
 *   npx tsx seed-demo-playstore.ts
 */
import { db } from './src/config/db';
import bcrypt from 'bcrypt';

const DEMO_SLUG = 'demo-playstore';
const DEMO_USERNAME = 'owner_test01';
const DEMO_PASSWORD = 'Test123!';

async function main() {
  // 1. Tenant demo dengan langganan premium 12 bulan (akses penuh ke fitur premium)
  const farFuture = new Date('2099-12-31T00:00:00Z');
  const tenant = await db.tenants.upsert({
    where: { slug: DEMO_SLUG },
    update: {
      subscription_plan: 'months_12',
      subscription_until: farFuture,
      is_active: true,
    },
    create: {
      name: 'Lark Laundry Demo',
      slug: DEMO_SLUG,
      address: 'Jl. Politeknik, Buha, Mapanget, Kota Manado, Sulawesi Utara, 95115',
      phone: '+6281200000000',
      email: 'laundrylark@gmail.com',
      subscription_plan: 'months_12',
      subscription_until: farFuture,
      is_active: true,
    },
  });
  console.log(`✓ Tenant demo siap: id=${tenant.id} (${tenant.slug})`);

  // 2. Outlet utama (buat hanya jika belum ada)
  let outlet = await db.outlets.findFirst({ where: { tenant_id: tenant.id } });
  if (!outlet) {
    outlet = await db.outlets.create({
      data: {
        tenant_id: tenant.id,
        nama: 'Outlet Pusat',
        alamat: 'Jl. Politeknik, Buha, Mapanget, Kota Manado',
        phone: '+6281200000000',
        is_active: true,
      },
    });
    console.log(`✓ Outlet dibuat: id=${outlet.id}`);
  } else {
    console.log(`✓ Outlet sudah ada: id=${outlet.id}`);
  }

  // 3. Akun owner (akses penuh) — upsert by username
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const owner = await db.users.upsert({
    where: { username: DEMO_USERNAME },
    update: {
      password: passwordHash,
      tenant_id: tenant.id,
      outlet_id: outlet.id,
      role: 'owner',
      is_active: true,
      auth_provider: 'local',
    },
    create: {
      username: DEMO_USERNAME,
      password: passwordHash,
      tenant_id: tenant.id,
      outlet_id: outlet.id,
      role: 'owner',
      nama: 'Owner Demo',
      email: 'owner.demo@larklaundry.com',
      no_hp: '+6281200000000',
      is_active: true,
      auth_provider: 'local',
      permissions: {},
    },
  });
  console.log(`✓ Akun owner siap: ${owner.username} / ${DEMO_PASSWORD}`);

  // 4. Layanan contoh (buat hanya jika tenant belum punya layanan)
  const serviceCount = await db.services.count({ where: { tenant_id: tenant.id } });
  if (serviceCount === 0) {
    await db.services.createMany({
      data: [
        { tenant_id: tenant.id, outlet_id: outlet.id, nama_layanan: 'Cuci Kering Lipat', harga_per_kg: 7000, durasi_hari: 1, is_active: true },
        { tenant_id: tenant.id, outlet_id: outlet.id, nama_layanan: 'Cuci Setrika', harga_per_kg: 10000, durasi_hari: 2, is_active: true },
        { tenant_id: tenant.id, outlet_id: outlet.id, nama_layanan: 'Express 6 Jam', harga_per_kg: 15000, durasi_hari: 1, is_active: true },
      ],
    });
    console.log('✓ 3 layanan contoh dibuat');
  } else {
    console.log(`✓ Layanan sudah ada (${serviceCount}) — dilewati`);
  }

  // 5. Pelanggan contoh (buat hanya jika tenant belum punya pelanggan)
  const customerCount = await db.customers.count({ where: { tenant_id: tenant.id } });
  if (customerCount === 0) {
    await db.customers.createMany({
      data: [
        { tenant_id: tenant.id, nama: 'Budi Santoso', no_hp: '081234567001', alamat: 'Jl. Merdeka No. 1, Manado' },
        { tenant_id: tenant.id, nama: 'Siti Aminah', no_hp: '081234567002', alamat: 'Jl. Sam Ratulangi No. 2, Manado' },
        { tenant_id: tenant.id, nama: 'Andi Wijaya', no_hp: '081234567003', alamat: 'Jl. Piere Tendean No. 3, Manado' },
      ],
    });
    console.log('✓ 3 pelanggan contoh dibuat');
  } else {
    console.log(`✓ Pelanggan sudah ada (${customerCount}) — dilewati`);
  }

  // 6. Pesanan contoh (buat hanya jika tenant belum punya pesanan)
  const orderCount = await db.orders.count({ where: { tenant_id: tenant.id } });
  if (orderCount === 0) {
    const customers = await db.customers.findMany({ where: { tenant_id: tenant.id }, take: 3 });
    const stamp = Date.now().toString().slice(-6);
    const seedOrders = [
      { cust: 0, status: 'diterima' as const, total: 35000 },
      { cust: 1, status: 'diproses' as const, total: 50000 },
      { cust: 2, status: 'selesai' as const, total: 75000 },
    ];
    for (let i = 0; i < seedOrders.length; i++) {
      const o = seedOrders[i];
      if (!customers[o.cust]) continue;
      await db.orders.create({
        data: {
          tenant_id: tenant.id,
          customer_id: customers[o.cust].id,
          outlet_id: outlet.id,
          user_id: owner.id,
          kode_pesanan: `DEMO-${stamp}-${i + 1}`,
          total_harga: o.total,
          status: o.status,
          metode_antar: 'antar_sendiri',
          catatan: 'Pesanan contoh untuk peninjauan Play Store',
        },
      });
    }
    console.log('✓ 3 pesanan contoh dibuat');
  } else {
    console.log(`✓ Pesanan sudah ada (${orderCount}) — dilewati`);
  }

  console.log('\n=== SELESAI ===');
  console.log(`Login reviewer  ->  username: ${DEMO_USERNAME}  |  password: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error('Seed gagal:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
