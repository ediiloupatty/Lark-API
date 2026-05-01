/**
 * index.ts — Server bootstrap & startup.
 *
 * App setup (middleware, routes) sekarang ada di app.ts.
 * File ini hanya bertanggung jawab untuk:
 *  - Mengecek koneksi database
 *  - Menjalankan DDL bootstrap
 *  - Memulai server listen
 *  - Graceful shutdown
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Resolve .env path — works in both src/ (dev) and dist/ (production)
function findEnvFile(): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return path.join(__dirname, '../.env');
}

dotenv.config({ path: findEnvFile() });

import app from './app';
import { checkConnection, db, pool } from './config/db';
import { startReminderScheduler } from './schedulers/reminderScheduler';
import { WhatsAppService } from './services/whatsappService';

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  const isDbConnected = await checkConnection();

  if (!isDbConnected) {
    console.error('🚨 [Bootstrap] Database TIDAK tersedia. Server akan jalan tapi API bergantung DB akan error 503.');
  }

  // DDL bootstrap menggunakan pool pg langsung
  // Retry logic karena dalam Docker, DNS resolution bisa lambat beberapa detik
  if (isDbConnected) {
    let client: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        client = await pool.connect();
        break; // Connected successfully
      } catch (e: any) {
        console.warn(`[Bootstrap] Pool connect attempt ${attempt}/3 gagal: ${e.message}`);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
        }
      }
    }

    if (client) {
      try {
        await client.query(`
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
        await client.query(`CREATE INDEX IF NOT EXISTS idx_device_tokens_tenant_id ON device_tokens(tenant_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id ON device_tokens(user_id)`);

        await client.query(`
          ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0
        `);


      } catch (e: any) {
        if (e.code !== '42P07') {
          console.warn('[Bootstrap] DDL warning:', e.message);
        }
      } finally {
        client.release();
      }
    } else {
      console.warn('[Bootstrap] ⚠️ Pool connect gagal setelah 3 percobaan. DDL dilewati — tabel mungkin perlu dibuat manual.');
    }
  }

  app.listen(PORT, () => {
    if (!isDbConnected) {
      console.warn('⚠️  Server jalan TANPA koneksi database. Periksa DATABASE_URL dan status PostgreSQL!');
    }
  });

  // Start daily reminder cron job (09:00 WIB)
  if (isDbConnected) {
    startReminderScheduler();
  }

  // Auto-reconnect existing WhatsApp sessions (Point 5)
  WhatsAppService.autoReconnectAll().catch(err =>
    console.error('[Bootstrap] WA auto-reconnect error:', err)
  );
}

bootstrap();

// Fix BS-3: Graceful shutdown — tutup koneksi DB dengan benar saat Docker/PM2 stop
async function shutdown(signal: string) {
  try {
    await db.$disconnect();
  } catch (e) {
    console.error('[Server] Error saat disconnect Prisma:', e);
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
