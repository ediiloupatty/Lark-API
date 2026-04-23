"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Script satu kali: buat tabel device_tokens di database
// Jalankan: npx ts-node src/scripts/migrate_device_tokens.ts
const db_1 = require("../config/db");
async function run() {
    await db_1.db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS device_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      token VARCHAR(512) NOT NULL UNIQUE,
      platform VARCHAR(20) NOT NULL DEFAULT 'android',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
    await db_1.db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_device_tokens_tenant_id ON device_tokens(tenant_id)`);
    await db_1.db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id)`);
    console.log('✅ Tabel device_tokens berhasil dibuat!');
    await db_1.db.$disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
