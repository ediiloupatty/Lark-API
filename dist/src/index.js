"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// Resolve .env path — works in both src/ (dev) and dist/ (production)
function findEnvFile() {
    let dir = __dirname;
    for (let i = 0; i < 5; i++) {
        const candidate = path_1.default.join(dir, '.env');
        if (fs_1.default.existsSync(candidate))
            return candidate;
        dir = path_1.default.dirname(dir);
    }
    return path_1.default.join(__dirname, '../.env');
}
dotenv_1.default.config({ path: findEnvFile() });
const app_1 = __importDefault(require("./app"));
const db_1 = require("./config/db");
const PORT = process.env.PORT || 3000;
async function bootstrap() {
    const isDbConnected = await (0, db_1.checkConnection)();
    if (!isDbConnected) {
        console.error('🚨 [Bootstrap] Database TIDAK tersedia. Server akan jalan tapi API bergantung DB akan error 503.');
    }
    // DDL bootstrap menggunakan pool pg langsung
    // Retry logic karena dalam Docker, DNS resolution bisa lambat beberapa detik
    if (isDbConnected) {
        let client = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                client = await db_1.pool.connect();
                break; // Connected successfully
            }
            catch (e) {
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
                console.log('[Bootstrap] ✅ Tabel device_tokens sudah siap.');
                await client.query(`
          ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0
        `);
                console.log('[Bootstrap] ✅ Kolom token_version sudah siap.');
                await client.query(`
          CREATE TABLE IF NOT EXISTS blog_articles (
            id          SERIAL PRIMARY KEY,
            slug        VARCHAR(255) UNIQUE NOT NULL,
            title       VARCHAR(500) NOT NULL,
            excerpt     TEXT NOT NULL,
            content     TEXT NOT NULL,
            read_time   VARCHAR(20) DEFAULT '5 min',
            category    VARCHAR(50) DEFAULT 'bisnis',
            status      VARCHAR(20) DEFAULT 'published',
            source_urls TEXT[] DEFAULT '{}',
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
          )
        `);
                await client.query(`CREATE INDEX IF NOT EXISTS idx_blog_articles_status ON blog_articles(status)`);
                await client.query(`CREATE INDEX IF NOT EXISTS idx_blog_articles_slug ON blog_articles(slug)`);
                console.log('[Bootstrap] ✅ Tabel blog_articles sudah siap.');
            }
            catch (e) {
                if (e.code !== '42P07') {
                    console.warn('[Bootstrap] DDL warning:', e.message);
                }
            }
            finally {
                client.release();
            }
        }
        else {
            console.warn('[Bootstrap] ⚠️ Pool connect gagal setelah 3 percobaan. DDL dilewati — tabel mungkin perlu dibuat manual.');
        }
    }
    app_1.default.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
        if (!isDbConnected) {
            console.warn('⚠️  Server jalan TANPA koneksi database. Periksa DATABASE_URL dan status PostgreSQL!');
        }
    });
}
bootstrap();
// Fix BS-3: Graceful shutdown — tutup koneksi DB dengan benar saat Docker/PM2 stop
async function shutdown(signal) {
    console.log(`[Server] Menerima signal ${signal}. Shutdown dengan benar...`);
    try {
        await db_1.db.$disconnect();
        console.log('[Server] ✅ Prisma disconnected.');
    }
    catch (e) {
        console.error('[Server] Error saat disconnect Prisma:', e);
    }
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
