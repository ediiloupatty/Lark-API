// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require('@prisma/client');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('Test123!', 10);

  // Buat 1 tenant test
  const tenant = await prisma.tenants.create({
    data: {
      name: 'Laundry Test Banyak User',
      slug: 'laundry-test-banyak-user',
      phone: '081234567890',
      email: 'test-banyak@larklaundry.com',
      is_active: true,
    },
  });
  console.log(`Tenant created: id=${tenant.id}`);

  // Owner
  await prisma.users.create({
    data: { tenant_id: tenant.id, username: 'owner_test01', password: hash, role: 'owner', nama: 'Owner Test Satu', email: 'owner.test01@larklaundry.com', is_active: true },
  });

  // 5 Admin
  for (let i = 1; i <= 5; i++) {
    await prisma.users.create({
      data: { tenant_id: tenant.id, username: `admin_test${String(i).padStart(2,'0')}`, password: hash, role: 'admin', nama: `Admin Test ${i}`, email: `admin.test${i}@larklaundry.com`, is_active: true },
    });
  }

  // 10 Karyawan
  for (let i = 1; i <= 10; i++) {
    await prisma.users.create({
      data: { tenant_id: tenant.id, username: `karyawan_test${String(i).padStart(2,'0')}`, password: hash, role: 'karyawan', nama: `Karyawan Test ${i}`, email: `karyawan.test${i}@larklaundry.com`, is_active: true },
    });
  }

  // 52 Pelanggan
  for (let i = 1; i <= 52; i++) {
    await prisma.users.create({
      data: { tenant_id: tenant.id, username: `pelanggan_test${String(i).padStart(3,'0')}`, password: hash, role: 'pelanggan', nama: `Pelanggan Test ${i}`, email: `pelanggan.test${i}@larklaundry.com`, is_active: i % 7 !== 0 },
    });
  }

  console.log('Done: 1 owner + 5 admin + 10 karyawan + 52 pelanggan');
  console.log(`Tenant ID untuk dihapus nanti: ${tenant.id}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
