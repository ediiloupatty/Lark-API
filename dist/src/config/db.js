"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.checkConnection = exports.prisma = exports.pool = void 0;
exports.isDbHealthy = isDbHealthy;
const client_1 = require("@prisma/client");
const pg_1 = require("pg");
const adapter_pg_1 = require("@prisma/adapter-pg");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
/**
 * Resolve .env path yang benar baik di development (src/) maupun production (dist/).
 *
 * Masalah sebelumnya:
 *   - Di dev: __dirname = /project/src/config → ../../.env = /project/.env ✅
 *   - Di prod: __dirname = /project/dist/src/config → ../../.env = /project/dist/.env ❌
 *
 * Solusi: Walk up dari __dirname sampai menemukan directory yang mengandung .env
 */
function findEnvFile() {
    let dir = __dirname;
    for (let i = 0; i < 5; i++) {
        const candidate = path_1.default.join(dir, '.env');
        if (fs_1.default.existsSync(candidate))
            return candidate;
        dir = path_1.default.dirname(dir);
    }
    // Fallback: pakai path relatif seperti sebelumnya
    return path_1.default.join(__dirname, '../../.env');
}
dotenv_1.default.config({ path: findEnvFile() });
// ── Pool Configuration ───────────────────────────────────────────────────────
// Pool dikonfigurasi agar tahan terhadap gangguan koneksi sementara.
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 100, // Maks 100 koneksi paralel untuk mengakomodasi Offline Sync
    idleTimeoutMillis: 30000, // Tutup koneksi idle setelah 30 detik
    connectionTimeoutMillis: 5000, // Timeout 5 detik jika pool penuh
});
exports.pool = pool;
// ── Pool Error Handler (CRITICAL) ───────────────────────────────────────────
// Tanpa ini, error tak tertangkap dari idle client akan CRASH seluruh Node.js process.
// Ini menangkap error seperti: koneksi terputus tiba-tiba, password berubah, DB restart, dll.
pool.on('error', (err) => {
    console.error('[DB Pool] ❌ Unexpected error pada idle client:', err.message);
    // JANGAN process.exit() di sini — biarkan pool auto-recover.
    // Pool akan otomatis membuat koneksi baru saat dibutuhkan.
});
const adapter = new adapter_pg_1.PrismaPg(pool);
exports.prisma = new client_1.PrismaClient({ adapter });
// ── DB Health Probe ──────────────────────────────────────────────────────────
// Digunakan oleh health check endpoint untuk memastikan DB benar-benar responsive.
// Return true jika koneksi OK, false jika gagal.
async function isDbHealthy() {
    const start = Date.now();
    let client = null;
    try {
        client = await pool.connect();
        await client.query('SELECT 1');
        return { ok: true, latencyMs: Date.now() - start };
    }
    catch (err) {
        return { ok: false, latencyMs: Date.now() - start, error: err.message };
    }
    finally {
        if (client)
            client.release();
    }
}
// ── Connection Check with Retry ──────────────────────────────────────────────
// Dipanggil saat startup. Retry sampai 5x dengan exponential backoff.
// Ini mencegah race condition saat PostgreSQL belum siap tapi backend sudah jalan.
const checkConnection = async () => {
    const MAX_RETRIES = 5;
    const BASE_DELAY_MS = 2000; // 2s, 4s, 8s, 16s, 32s
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await exports.prisma.$connect();
            console.log('✅ Koneksi ke PostgreSQL via Prisma berhasil.');
            return true;
        }
        catch (err) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            console.error(`❌ [Attempt ${attempt}/${MAX_RETRIES}] Database connection gagal: ${err.message}`);
            if (attempt < MAX_RETRIES) {
                console.log(`   ⏳ Retry dalam ${delay / 1000}s...`);
                await new Promise((r) => setTimeout(r, delay));
            }
        }
    }
    console.error('🚨 FATAL: Tidak bisa konek ke database setelah semua retry. Server tetap jalan tapi API akan error.');
    return false;
};
exports.checkConnection = checkConnection;
// Ekspor Prisma instance Default ini mirip seperti Pool connection sebelumnya
exports.db = exports.prisma;
