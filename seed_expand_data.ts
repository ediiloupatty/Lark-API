/**
 * seed_expand_data.ts
 * --------------------
 * Expands existing dummy data with:
 * - More customers (total ~25)
 * - More outlets (3 cabang)
 * - Paket laundry (3 paket)
 * - Staff / karyawan (3 orang)
 * - More orders (total ~80-100 for 5 days)
 * - More expenses (diverse categories)
 * - Audit logs for activity feed
 *
 * Usage:  npx tsx seed_expand_data.ts
 */

import { db } from './src/config/db';
import bcrypt from 'bcrypt';

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[rand(0, arr.length - 1)];
const randomCode = (prefix: string) => `${prefix}-${Date.now().toString(36).slice(-4).toUpperCase()}${rand(1000, 9999)}`;
const daysBefore = (n: number): Date => {
  const d = new Date(); d.setDate(d.getDate() - n);
  d.setHours(rand(7, 21), rand(0, 59), rand(0, 59), 0);
  return d;
};

async function main() {
  console.log('🔍 Loading existing state...\n');

  const tenant = await db.tenants.findFirst({ where: { is_active: true } });
  if (!tenant) { console.error('❌ No tenant found.'); return; }
  const TID = tenant.id;

  const admin = await db.users.findFirst({ where: { tenant_id: TID, is_active: true } });
  if (!admin) { console.error('❌ No user found.'); return; }

  console.log(`  Tenant: ${tenant.name} (ID: ${TID})`);
  console.log(`  User:   ${admin.username} (ID: ${admin.id})\n`);

  // ═══════════════════════════════════════════════
  // 1. MORE OUTLETS
  // ═══════════════════════════════════════════════
  const outletData = [
    { nama: 'Cabang Pusat',     alamat: 'Jl. Sudirman No. 1, Jakarta Pusat',  phone: '081234567890' },
    { nama: 'Cabang Selatan',   alamat: 'Jl. Fatmawati No. 22, Jakarta Selatan', phone: '081234567891' },
    { nama: 'Cabang Timur',     alamat: 'Jl. Jatinegara No. 15, Jakarta Timur',  phone: '081234567892' },
  ];
  for (const o of outletData) {
    const exists = await db.outlets.findFirst({ where: { tenant_id: TID, nama: o.nama } });
    if (!exists) await db.outlets.create({ data: { tenant_id: TID, ...o } });
  }
  const outlets = await db.outlets.findMany({ where: { tenant_id: TID } });
  console.log(`✅ Outlets: ${outlets.length}`);

  // ═══════════════════════════════════════════════
  // 2. STAFF / KARYAWAN
  // ═══════════════════════════════════════════════
  const staffData = [
    { username: 'staff_rina',  nama: 'Rina Sari',     role: 'karyawan' as const, outlet_id: outlets[0]?.id },
    { username: 'staff_doni',  nama: 'Doni Setiawan',  role: 'karyawan' as const, outlet_id: outlets[1]?.id || outlets[0]?.id },
    { username: 'staff_mega',  nama: 'Mega Putri',     role: 'karyawan' as const, outlet_id: outlets[2]?.id || outlets[0]?.id },
  ];
  const pwHash = await bcrypt.hash('staff123', 10);
  for (const s of staffData) {
    const exists = await db.users.findFirst({ where: { username: s.username } });
    if (!exists) {
      await db.users.create({
        data: { tenant_id: TID, username: s.username, password: pwHash, role: s.role, nama: s.nama, is_active: true, outlet_id: s.outlet_id, permissions: {} },
      });
    }
  }
  const allStaff = await db.users.findMany({ where: { tenant_id: TID, is_active: true } });
  console.log(`✅ Staff: ${allStaff.length} (termasuk admin)`);

  // ═══════════════════════════════════════════════
  // 3. MORE CUSTOMERS (total ~25)
  // ═══════════════════════════════════════════════
  const customerNames = [
    { nama: 'Budi Santoso',     no_hp: '081234567001', alamat: 'Jl. Merdeka No. 1',         email: 'budi@email.com' },
    { nama: 'Siti Rahayu',      no_hp: '081234567002', alamat: 'Jl. Pahlawan No. 12',       email: 'siti@email.com' },
    { nama: 'Ahmad Hidayat',    no_hp: '081234567003', alamat: 'Jl. Gatot Subroto No. 5',   email: null },
    { nama: 'Dewi Lestari',     no_hp: '081234567004', alamat: 'Jl. Thamrin No. 8',         email: 'dewi@email.com' },
    { nama: 'Andi Pratama',     no_hp: '081234567005', alamat: 'Jl. Diponegoro No. 3',      email: null },
    { nama: 'Rina Wulandari',   no_hp: '081234567006', alamat: 'Jl. Asia Afrika No. 22',    email: 'rina@email.com' },
    { nama: 'Joko Susanto',     no_hp: '081234567007', alamat: 'Jl. Dago No. 15',           email: null },
    { nama: 'Maria Christina',  no_hp: '081234567008', alamat: 'Jl. Braga No. 7',           email: 'maria@email.com' },
    { nama: 'Hendra Wijaya',    no_hp: '081234567009', alamat: 'Jl. Kebon Jeruk No. 11',    email: 'hendra@email.com' },
    { nama: 'Fitri Handayani',  no_hp: '081234567010', alamat: 'Jl. Kemang Raya No. 5',     email: null },
    { nama: 'Bambang Suryadi',  no_hp: '081234567011', alamat: 'Jl. Tendean No. 44',        email: 'bambang@email.com' },
    { nama: 'Lina Marlina',     no_hp: '081234567012', alamat: 'Jl. Cipete Raya No. 8',     email: null },
    { nama: 'Rudi Hartono',     no_hp: '081234567013', alamat: 'Jl. Prapanca No. 21',       email: 'rudi@email.com' },
    { nama: 'Indah Permata',    no_hp: '081234567014', alamat: null,                          email: 'indah@email.com' },
    { nama: 'Agus Setiabudi',   no_hp: '081234567015', alamat: 'Jl. Casablanca No. 3',      email: null },
    { nama: 'Novi Anggraeni',   no_hp: '081234567016', alamat: 'Jl. Senopati No. 88',       email: 'novi@email.com' },
    { nama: 'Dian Sastro',      no_hp: '081234567017', alamat: 'Jl. Blok M No. 7',          email: null },
    { nama: 'Wahyu Nugroho',    no_hp: '081234567018', alamat: 'Jl. Tebet Raya No. 12',     email: 'wahyu@email.com' },
    { nama: 'Yuliana Dewi',     no_hp: '081234567019', alamat: null,                          email: null },
    { nama: 'Fajar Ramadhan',   no_hp: '081234567020', alamat: 'Jl. Pancoran No. 5',        email: 'fajar@email.com' },
    { nama: 'Citra Kirana',     no_hp: '081234567021', alamat: 'Jl. Pondok Indah No. 33',   email: null },
    { nama: 'Eko Prasetyo',     no_hp: '081234567022', alamat: 'Jl. Radio Dalam No. 18',    email: 'eko@email.com' },
    { nama: 'Putri Ayu',        no_hp: '081234567023', alamat: 'Jl. Wolter Monginsidi No. 9',email: null },
    { nama: 'Irfan Hakim',      no_hp: '081234567024', alamat: 'Jl. Panglima Polim No. 14', email: 'irfan@email.com' },
    { nama: 'Sandra Dewi',      no_hp: '081234567025', alamat: 'Jl. Kebayoran Baru No. 6',  email: 'sandra@email.com' },
  ];
  for (const c of customerNames) {
    const exists = await db.customers.findFirst({ where: { tenant_id: TID, no_hp: c.no_hp } });
    if (!exists) await db.customers.create({ data: { tenant_id: TID, ...c } });
  }
  const customers = await db.customers.findMany({ where: { tenant_id: TID, deleted_at: null } });
  console.log(`✅ Customers: ${customers.length}`);

  // ═══════════════════════════════════════════════
  // 4. PAKET LAUNDRY
  // ═══════════════════════════════════════════════
  const paketData = [
    { nama: 'Paket Reguler',    deskripsi: 'Cuci standar, selesai 24 jam',       durasi_jam: 24, kapasitas_per_hari: 50 },
    { nama: 'Paket Express',    deskripsi: 'Cuci kilat, selesai 6 jam',          durasi_jam: 6,  kapasitas_per_hari: 20, harga_tambahan: 5000 },
    { nama: 'Paket Premium',    deskripsi: 'Cuci premium + pewangi eksklusif',   durasi_jam: 48, kapasitas_per_hari: 15, harga_tambahan: 10000 },
  ];
  for (const p of paketData) {
    const exists = await db.paket_laundry.findFirst({ where: { tenant_id: TID, nama: p.nama } });
    if (!exists) await db.paket_laundry.create({ data: { tenant_id: TID, ...p } });
  }
  const paketList = await db.paket_laundry.findMany({ where: { tenant_id: TID } });
  console.log(`✅ Paket: ${paketList.length}`);

  // ═══════════════════════════════════════════════
  // 5. ENSURE SERVICES (add a few more if needed)
  // ═══════════════════════════════════════════════
  const svcData = [
    { nama_layanan: 'Cuci Kering',        harga_per_kg: 7000,  durasi_jam: 24, satuan: 'kg' },
    { nama_layanan: 'Cuci Setrika',        harga_per_kg: 10000, durasi_jam: 48, satuan: 'kg' },
    { nama_layanan: 'Setrika Saja',        harga_per_kg: 5000,  durasi_jam: 12, satuan: 'kg' },
    { nama_layanan: 'Cuci Express (6jam)', harga_per_kg: 15000, durasi_jam: 6,  satuan: 'kg' },
    { nama_layanan: 'Cuci Bed Cover',      harga_per_kg: 25000, durasi_jam: 48, satuan: 'pcs' },
    { nama_layanan: 'Cuci Sepatu',         harga_per_kg: 20000, durasi_jam: 72, satuan: 'pcs' },
    { nama_layanan: 'Cuci Jas / Blazer',   harga_per_kg: 30000, durasi_jam: 72, satuan: 'pcs' },
    { nama_layanan: 'Cuci Karpet',         harga_per_kg: 15000, durasi_jam: 72, satuan: 'm²' },
  ];
  for (const s of svcData) {
    const exists = await db.services.findFirst({ where: { tenant_id: TID, nama_layanan: s.nama_layanan } });
    if (!exists) await db.services.create({ data: { tenant_id: TID, ...s } });
  }
  const services = await db.services.findMany({ where: { tenant_id: TID, is_active: true } });
  console.log(`✅ Services: ${services.length}`);

  // ═══════════════════════════════════════════════
  // 6. MASS ORDER GENERATION (5 days, 12-20 per day)
  // ═══════════════════════════════════════════════
  console.log('\n📊 Generating more orders...');

  const STATUSES = ['menunggu_konfirmasi', 'diproses', 'siap_diambil', 'selesai', 'selesai', 'selesai', 'selesai', 'dibatalkan'] as const;
  const METODE = ['jemput', 'antar_sendiri'] as const;
  const PAY_METHODS = ['cash', 'transfer', 'qris', 'gopay', 'dana'] as const;
  const CATATAN = [
    'Pisahkan baju putih', 'Jangan pakai pewangi', 'Setrika rapi', 'Extra parfum',
    'Jemput sebelum jam 10', 'Hati-hati bahan sutra', 'Lipat saja, jangan gantung',
    'Pewangi downy', 'Jangan dicampur handuk', 'Pakaian bayi, deterjen khusus',
    null, null, null, null,
  ];

  let totalNew = 0;
  let totalRevNew = 0;

  for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
    const numOrders = rand(12, 20);
    const baseDate = daysBefore(dayOffset);
    const dateLabel = baseDate.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
    let dayRev = 0;

    for (let i = 0; i < numOrders; i++) {
      const customer = pick(customers);
      const outlet = pick(outlets);
      const staff = pick(allStaff);
      const status = pick([...STATUSES]);
      const metode = pick([...METODE]);
      const catatan = pick(CATATAN);
      const paket = rand(0, 3) === 0 ? pick(paketList) : null; // 25% chance paket

      // 1-4 services
      const numSvc = rand(1, Math.min(4, services.length));
      const selectedSvc = [...services].sort(() => Math.random() - 0.5).slice(0, numSvc);

      const details: { service_id: number; jenis_pakaian: string; jumlah: number; berat: number; harga: number; subtotal: number }[] = [];
      let total = 0;

      for (const svc of selectedSvc) {
        const berat = parseFloat((rand(10, 100) / 10).toFixed(1)); // 1.0 - 10.0
        const harga = Number(svc.harga_per_kg);
        const subtotal = Math.round(berat * harga);
        total += subtotal;
        details.push({ service_id: svc.id, jenis_pakaian: svc.nama_layanan, jumlah: rand(1, 3), berat, harga, subtotal });
      }

      // Paket surcharge
      if (paket && paket.harga_tambahan) total += Number(paket.harga_tambahan);

      // Discount (10% chance)
      const discount = rand(0, 9) === 0 ? Math.round(total * 0.1) : 0;
      total -= discount;

      // Ongkir for jemput
      const ongkir = metode === 'jemput' ? rand(1, 3) * 5000 : 0;
      total += ongkir;

      const tgl_order = new Date(baseDate);
      tgl_order.setMinutes(tgl_order.getMinutes() + rand(0, 20) * i);

      let tgl_diproses: Date | null = null;
      let tgl_siap: Date | null = null;
      let tgl_selesai: Date | null = null;

      if (['diproses', 'siap_diambil', 'selesai'].includes(status)) {
        tgl_diproses = new Date(tgl_order);
        tgl_diproses.setHours(tgl_diproses.getHours() + rand(1, 4));
      }
      if (['siap_diambil', 'selesai'].includes(status)) {
        tgl_siap = new Date(tgl_diproses!);
        tgl_siap.setHours(tgl_siap.getHours() + rand(4, 36));
      }
      if (status === 'selesai') {
        tgl_selesai = new Date(tgl_siap!);
        tgl_selesai.setHours(tgl_selesai.getHours() + rand(1, 12));
      }

      const order = await db.orders.create({
        data: {
          tenant_id: TID,
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
          user_id: staff.id,
          paket_id: paket?.id ?? null,
          catatan,
          discount_amount: discount,
          ongkos_kirim: ongkir,
          alamat_jemput: metode === 'jemput' ? customer.alamat : null,
          estimasi_tanggal: new Date(tgl_order.getTime() + rand(24, 72) * 3600000),
        },
      });

      for (const d of details) {
        await db.order_details.create({ data: { order_id: order.id, ...d } });
      }

      // Payment
      const isLunas = ['selesai', 'siap_diambil'].includes(status);
      const isBatal = status === 'dibatalkan';
      await db.payments.create({
        data: {
          tenant_id: TID,
          order_id: order.id,
          metode_pembayaran: pick([...PAY_METHODS]) as any,
          jumlah_bayar: total,
          status_pembayaran: isBatal ? 'dibatalkan' : isLunas ? 'lunas' : 'pending',
          outlet_id: outlet.id,
          tgl_pembayaran: isLunas ? (tgl_selesai ?? tgl_siap ?? tgl_order) : null,
        },
      });

      totalNew++;
      totalRevNew += total;
      dayRev += total;
    }

    console.log(`  📅 ${dateLabel}: ${numOrders} pesanan — Rp ${dayRev.toLocaleString('id-ID')}`);
  }

  // ═══════════════════════════════════════════════
  // 7. MORE EXPENSES
  // ═══════════════════════════════════════════════
  console.log('\n💸 Adding more expenses...');
  const expenseList = [
    { kategori: 'Operasional',   deskripsi: 'Tagihan listrik cabang pusat',     jumlah: 1250000 },
    { kategori: 'Operasional',   deskripsi: 'Tagihan air PDAM',                 jumlah: 480000 },
    { kategori: 'Perlengkapan',  deskripsi: 'Deterjen Ariel 5kg x 5',           jumlah: 375000 },
    { kategori: 'Perlengkapan',  deskripsi: 'Pewangi Downy 2L x 3',             jumlah: 135000 },
    { kategori: 'Perlengkapan',  deskripsi: 'Plastik laundry 1 roll',           jumlah: 85000 },
    { kategori: 'Perlengkapan',  deskripsi: 'Hanger besi 50pcs',                jumlah: 150000 },
    { kategori: 'Gaji',          deskripsi: 'Gaji kasir Rina (April)',           jumlah: 2500000 },
    { kategori: 'Gaji',          deskripsi: 'Gaji karyawan Doni (April)',        jumlah: 2300000 },
    { kategori: 'Gaji',          deskripsi: 'Gaji karyawan Mega (April)',        jumlah: 2300000 },
    { kategori: 'Lainnya',       deskripsi: 'Service mesin cuci Samsung',        jumlah: 650000 },
    { kategori: 'Lainnya',       deskripsi: 'Beli selang inlet baru',            jumlah: 120000 },
    { kategori: 'Operasional',   deskripsi: 'Sewa tempat cabang selatan',        jumlah: 3500000 },
    { kategori: 'Operasional',   deskripsi: 'Internet + WiFi bulanan',           jumlah: 450000 },
    { kategori: 'Perlengkapan',  deskripsi: 'Kertas struk thermal 10 roll',      jumlah: 95000 },
    { kategori: 'Lainnya',       deskripsi: 'Pembelian setrika uap baru',        jumlah: 850000 },
  ];
  for (const exp of expenseList) {
    await db.expenses.create({
      data: {
        tenant_id: TID,
        outlet_id: pick(outlets).id,
        kategori: exp.kategori,
        deskripsi: exp.deskripsi,
        jumlah: exp.jumlah,
        tanggal: daysBefore(rand(0, 4)),
        created_by: admin.id,
      },
    });
  }
  console.log(`  ✅ Added ${expenseList.length} expenses`);

  // ═══════════════════════════════════════════════
  // 8. AUDIT LOGS (activity feed data)
  // ═══════════════════════════════════════════════
  console.log('\n📋 Adding audit log entries...');
  const auditActions = [
    { action: 'login_success_web_node', entity_type: 'user' },
    { action: 'login_success_web_node', entity_type: 'user' },
    { action: 'login_success_mobile',   entity_type: 'user' },
    { action: 'create_order',           entity_type: 'order' },
    { action: 'create_order',           entity_type: 'order' },
    { action: 'create_order',           entity_type: 'order' },
    { action: 'update_order',           entity_type: 'order' },
    { action: 'update_order',           entity_type: 'order' },
    { action: 'create_customer',        entity_type: 'customer' },
    { action: 'create_customer',        entity_type: 'customer' },
    { action: 'register_success',       entity_type: 'user' },
    { action: 'logout',                 entity_type: 'user' },
  ];
  for (let i = 0; i < 20; i++) {
    const act = pick(auditActions);
    const staff = pick(allStaff);
    const outlet = pick(outlets);
    await db.audit_logs.create({
      data: {
        tenant_id: TID,
        actor_user_id: staff.id,
        outlet_id: outlet.id,
        entity_type: act.entity_type,
        entity_id: rand(1, 100),
        action: act.action,
        metadata: { ip: `192.168.1.${rand(10, 200)}`, device: pick(['Chrome/Win', 'Safari/Mac', 'Mobile/Android', 'Mobile/iOS']) },
        created_at: daysBefore(rand(0, 4)),
      },
    });
  }
  console.log(`  ✅ Added 20 audit log entries`);

  // ── Final count ──
  const finalOrders = await db.orders.count({ where: { tenant_id: TID } });
  const finalCustomers = await db.customers.count({ where: { tenant_id: TID } });
  const finalPayments = await db.payments.count({ where: { tenant_id: TID } });
  const finalExpenses = await db.expenses.count({ where: { tenant_id: TID } });

  console.log('\n════════════════════════════════════════');
  console.log('🎉 DATA EXPANSION COMPLETE!');
  console.log(`   Outlets:    ${outlets.length}`);
  console.log(`   Staff:      ${allStaff.length}`);
  console.log(`   Customers:  ${finalCustomers}`);
  console.log(`   Services:   ${services.length}`);
  console.log(`   Paket:      ${paketList.length}`);
  console.log(`   Orders:     ${finalOrders} (added ${totalNew})`);
  console.log(`   Payments:   ${finalPayments}`);
  console.log(`   Expenses:   ${finalExpenses}`);
  console.log(`   New Rev:    Rp ${totalRevNew.toLocaleString('id-ID')}`);
  console.log('════════════════════════════════════════');
  console.log('\n🔄 Refresh dashboard!');
}

main()
  .catch(e => { console.error('❌', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
