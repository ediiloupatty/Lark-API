// Buat user test "edi" / password "1" sebagai owner tenant baru.
require('../node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('../node_modules/pg');
const bcrypt = require('../node_modules/bcrypt');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Cek apakah user 'edi' sudah ada
    const existing = await client.query("SELECT id, tenant_id FROM users WHERE username = 'edi'");
    if (existing.rows.length > 0) {
      console.log('User edi sudah ada (id=' + existing.rows[0].id + ', tenant_id=' + existing.rows[0].tenant_id + '). Skip.');
      await client.query('ROLLBACK');
      return;
    }

    // Buat tenant
    const { rows: [tenant] } = await client.query(
      `INSERT INTO tenants (name, slug, address, phone, subscription_plan, subscription_until, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'free', NOW() + INTERVAL '30 days', true, NOW(), NOW()) RETURNING id`,
      ['Edi Test Onboarding', 'edi-test-onboarding', 'Belum diatur', 'Belum diatur']
    );
    const tid = tenant.id;
    console.log('✅ Tenant created: id=' + tid);

    // Hash password '1'
    const hash = await bcrypt.hash('1', 10);

    // Buat user owner
    const { rows: [user] } = await client.query(
      `INSERT INTO users (tenant_id, username, password, role, nama, is_active, auth_provider, created_at, updated_at)
       VALUES ($1, 'edi', $2, 'owner', 'Edi Test', true, 'local', NOW(), NOW()) RETURNING id`,
      [tid, hash]
    );
    console.log('✅ User edi created: id=' + user.id);

    // Seed paket default supaya order bisa dibuat (tapi tanpa service — sengaja kosong untuk test misi)
    await client.query(
      `INSERT INTO paket_laundry (tenant_id, nama, durasi_jam, harga_tambahan, created_at, updated_at)
       VALUES
         ($1, 'Reguler', 72, 0, NOW(), NOW()),
         ($1, 'Express', 24, 3000, NOW(), NOW()),
         ($1, 'Kilat',   6,  5000, NOW(), NOW())`,
      [tid]
    );

    await client.query('COMMIT');
    console.log('\n✅ Selesai. Login pakai username=edi password=1');
    console.log('Tenant ID untuk dihapus: ' + tid);
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
