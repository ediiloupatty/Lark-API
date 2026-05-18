require('../node_modules/dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('../node_modules/pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const tenantId = parseInt(process.argv[2]);
  if (!tenantId) { console.error('Usage: node delete-test-users.js <tenant_id>'); process.exit(1); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount: u } = await client.query('DELETE FROM users WHERE tenant_id = $1', [tenantId]);
    const { rowCount: t } = await client.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await client.query('COMMIT');
    console.log(`✅ Hapus ${u} users + ${t} tenant (id=${tenantId})`);
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
