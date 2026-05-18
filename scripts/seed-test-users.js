// Script sekali pakai untuk seed test data — hapus setelah dipakai
require('../node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('../node_modules/pg');
const bcrypt = require('../node_modules/bcrypt');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Buat tenant test
    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenants (name, slug, phone, email, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,true,NOW(),NOW()) RETURNING id`,
      ['Laundry Test Banyak User', 'laundry-test-banyak-user', '081234567890', 'test-banyak@larklaundry.com']
    );
    const tid = tenant.id;
    console.log(`✅ Tenant created: id=${tid}`);

    const hash = await bcrypt.hash('Test123!', 10);
    let count = 0;

    const insert = async (username, role, nama, email, active = true) => {
      await client.query(
        `INSERT INTO users (tenant_id, username, password, role, nama, email, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
        [tid, username, hash, role, nama, email, active]
      );
      count++;
    };

    // Owner
    await insert('owner_testbanyak', 'owner', 'Owner Test Banyak', `owner.testbanyak@larktest.com`);

    // 5 Admin
    for (let i = 1; i <= 5; i++) {
      await insert(`admin_test${String(i).padStart(2,'0')}`, 'admin', `Admin Test ${i}`, `admin.test${i}@larktest.com`);
    }

    // 10 Karyawan
    for (let i = 1; i <= 10; i++) {
      await insert(`karyawan_test${String(i).padStart(2,'0')}`, 'karyawan', `Karyawan Test ${i}`, `karyawan.test${i}@larktest.com`, i % 3 !== 0);
    }

    // 52 Pelanggan
    for (let i = 1; i <= 52; i++) {
      await insert(`pelanggan_test${String(i).padStart(3,'0')}`, 'pelanggan', `Pelanggan Test ${i}`, `pelanggan.test${i}@larktest.com`, i % 7 !== 0);
    }

    await client.query('COMMIT');
    console.log(`✅ Selesai: ${count} users dibuat di tenant ${tid}`);
    console.log(`\n⚠️  Untuk hapus semua data test ini jalankan:\n   node scripts/delete-test-users.js ${tid}`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

main()
  .catch(e => { console.error('❌', e.message); process.exit(1); })
  .finally(() => pool.end());
