"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Global patch to prevent Express res.json() from crashing on BigInt fields from PostgreSQL/Prisma
// @ts-ignore
BigInt.prototype.toJSON = function () {
    return this.toString();
};
// MUST be called before any local imports that depend on ENV vars (like Prisma)
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../.env') });
const db_1 = require("./config/db");
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const syncRoutes_1 = __importDefault(require("./routes/syncRoutes"));
const publicController_1 = require("./controllers/publicController");
const maintenanceMiddleware_1 = require("./middlewares/maintenanceMiddleware");
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const csrfMiddleware_1 = require("./middlewares/csrfMiddleware");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Security 1: Menyembunyikan Identitas Node.js/Express (Anti-Header Profiling)
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" }
}));
// Deteksi IP asli di belakang Docker/Nginx Proxy agar Rate Limiter tidak memblokir semua user sekaligus
app.set('trust proxy', 1);
// Security 2: Pertahanan DDoS / Spam Limit
const globalLimiter = (0, express_rate_limit_1.default)({
    windowMs: 5 * 60 * 1000, // 5 menit (dikurangi dari 15 menit)
    max: 3000, // Maksimal 3000 koneksi per-IP per-5m (Ditingkatkan drastis karena Offline Sync bisa mengirim banyak request sekaligus)
    // Ubah key 'error' menjadi 'message' agar aplikasi Flutter dapat membacanya langsung
    message: { status: 'error', success: false, message: 'Keamanan: Terlalu banyak permintaan. Sistem menjeda koneksi Anda sesaat.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', globalLimiter);
// Security 3: Segel Pintu Gerbang API (Custom Header & CORS Strict List)
const allowedOrigins = [
    'http://localhost:5173', // Web Lokal Dev
    'http://127.0.0.1:5173',
    'https://larklaundry.com', // Web Live (non-www)
    'https://www.larklaundry.com', // Web Live (www — Vercel)
    process.env.VITE_FRONTEND_URL || 'https://lark-laundry.vercel.app' // Web Live Produksi
];
/** Cek apakah origin diizinkan (termasuk wildcard Vercel dan jaringan lokal) */
function isAllowedOrigin(origin) {
    if (allowedOrigins.includes(origin))
        return true;
    if (origin.endsWith('.vercel.app'))
        return true;
    if (origin.endsWith('.larklaundry.com') || origin === 'https://larklaundry.com')
        return true;
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'))
        return true;
    if (origin.startsWith('http://192.168.') || origin.startsWith('http://10.'))
        return true;
    return false;
}
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const platform = req.headers['x-app-platform'];
    const vercelId = req.headers['x-vercel-id'];
    const forwardedHost = req.headers['x-forwarded-host'];
    // 1. Izinkan request dari Web yang memiliki origin terdaftar atau dari jaringan lokal (untuk dev)
    if (origin && isAllowedOrigin(origin)) {
        return next();
    }
    // 2. Izinkan request proxy dari Vercel (karena Vercel menghapus origin saat melakukan rewrite)
    if (vercelId || (forwardedHost && forwardedHost.endsWith('.vercel.app'))) {
        return next();
    }
    // 3. Izinkan request dari Mobile App / Web App yang secara eksplisit mengirimkan header
    if (platform === 'LarkMobile' || platform === 'LarkWeb') {
        return next();
    }
    // 4. Izinkan endpoint public / webhook (Health check, landing stats, auth lokal untuk mempermudah dev jika perlu)
    if (req.path.startsWith('/api/v1/public/') || req.path === '/api/v1/health') {
        return next();
    }
    // 5. Selain itu (seperti Postman, cURL tanpa header), blokir aksesnya
    return res.status(403).json({
        status: 'error',
        message: 'Akses ditolak. Endpoint hanya dapat diakses melalui aplikasi resmi Lark Laundry.'
    });
});
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // 1. Izinkan koneksi tanpa origin (seperti curl, postman, Mobile App) yang lolos pengecekan custom header
        if (!origin)
            return callback(null, true);
        // 2. Izinkan domain web terdaftar (termasuk www dan non-www)
        if (isAllowedOrigin(origin))
            return callback(null, true);
        // 3. Toleransi untuk Emulator Mobile / Capacitor yang kadang mengirimkan origin unik
        if (origin.startsWith('file://') || origin.startsWith('android-app://') || origin.startsWith('capacitor://')) {
            return callback(null, true);
        }
        // Jangan lempar 'new Error()' karena membuat Express crash & return HTML 500 JSON Parser Error di Flutter
        // Cukup tolak pelan-pelan (return false) agar Browser menolaknya secara natural
        callback(null, false);
    },
    credentials: true
}));
// Payload Limits: Mencegah serangan pengiriman file/teks raksasa yang menyebabkan Server Crash (Out of Memory)
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
// Parse cookies — dibutuhkan oleh authMiddleware untuk membaca httpOnly token
app.use((0, cookie_parser_1.default)());
// ── Maintenance Mode ─────────────────────────────────────────────────────────
// Harus didaftarkan SEBELUM semua route agar intercept semua request.
// Aktifkan dengan set MAINTENANCE_MODE=true di .env, lalu restart backend.
app.use(maintenanceMiddleware_1.maintenanceMiddleware);
// Connect to Database (with retry)
const dbReady = (0, db_1.checkConnection)();
// ── CSRF Protection ──────────────────────────────────────────────────────────
// Set CSRF cookie pada setiap response (jika belum ada)
app.use(csrfMiddleware_1.setCsrfCookie);
// Register Routes
// Auth routes: TIDAK pakai CSRF (session belum terbentuk saat login/register)
app.use('/api/v1/auth', authRoutes_1.default);
// Sync routes: PAKAI CSRF (mutating requests pada session aktif)
app.use('/api/v1/sync', csrfMiddleware_1.verifyCsrf, syncRoutes_1.default);
// [Public] Landing page stats — no auth required
app.get('/api/v1/public/landing-stats', publicController_1.getLandingStats);
// [Public] Blog articles — auto-generated by Qwen AI
const blogController_1 = require("./controllers/blogController");
app.get('/api/v1/public/blog', blogController_1.listBlogArticles);
app.post('/api/v1/public/blog/generate', blogController_1.triggerGenerate);
app.get('/api/v1/public/blog/:slug', blogController_1.getBlogArticle);
// [1] Alias: Mobile ExpenseService calls /api/v1/expenses (without /sync/ prefix)
// Mount same syncRoutes so /api/v1/expenses resolves correctly
const authMiddleware_1 = require("./middlewares/authMiddleware");
const financeController_1 = require("./controllers/financeController");
app.get('/api/v1/expenses', authMiddleware_1.authenticateToken, financeController_1.getExpenses);
app.post('/api/v1/expenses', authMiddleware_1.authenticateToken, financeController_1.addExpense);
app.put('/api/v1/expenses', authMiddleware_1.authenticateToken, financeController_1.updateExpense);
app.delete('/api/v1/expenses', authMiddleware_1.authenticateToken, financeController_1.deleteExpense);
// Health check endpoint — industry-standard format (RFC Health Check Response)
const db_2 = require("./config/db");
app.get('/api/v1/health', async (req, res) => {
    const dbHealth = await (0, db_2.isDbHealthy)();
    const status = dbHealth.ok ? 'healthy' : 'degraded';
    const httpCode = dbHealth.ok ? 200 : 503;
    res.status(httpCode).json({
        status,
        service: 'lark-laundry-api',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        checks: {
            database: {
                status: dbHealth.ok ? 'up' : 'down',
                latency_ms: dbHealth.latencyMs,
                ...(dbHealth.error ? { message: dbHealth.error } : {}),
            },
        },
    });
});
app.use((req, res, next) => {
    console.log(`[404 NOT FOUND] Method: ${req.method} | URL: ${req.url}`);
    // Fix BC-5: Kembalikan JSON agar Flutter tidak crash saat parse response
    res.status(404).json({ status: 'error', message: `Endpoint tidak ditemukan: ${req.method} ${req.url}` });
});
// Global Error Handler (Menangkap Unhandled Promise Rejections & Error tak terduga)
app.use((err, req, res, next) => {
    console.error('🚨 [Global Error]', err);
    res.status(500).json({
        status: 'error',
        success: false,
        message: 'Internal Server Error. Silakan coba lagi nanti.'
    });
});
const db_3 = require("./config/db");
async function bootstrap() {
    // Tunggu hasil checkConnection (retry logic)
    const isDbConnected = await dbReady;
    if (!isDbConnected) {
        console.error('🚨 [Bootstrap] Database TIDAK tersedia. Server akan jalan tapi API bergantung DB akan error 503.');
    }
    // Gunakan pool pg langsung untuk DDL — $executeRawUnsafe tidak support PrismaPg adapter
    if (isDbConnected) {
        try {
            const client = await db_3.pool.connect();
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
                // H2: Token Revocation — tambahkan kolom token_version jika belum ada
                await client.query(`
          ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0
        `);
                console.log('[Bootstrap] ✅ Kolom token_version sudah siap.');
                // Auto-Blog: Tabel blog_articles untuk artikel yang di-generate Gemini AI
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
                    console.warn('[Bootstrap] device_tokens warning:', e.message);
                }
            }
            finally {
                client.release();
            }
        }
        catch (e) {
            console.warn('[Bootstrap] Pool connect gagal (diabaikan):', e.message);
        }
    }
    app.listen(PORT, () => {
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
        await db_3.db.$disconnect();
        console.log('[Server] ✅ Prisma disconnected.');
    }
    catch (e) {
        console.error('[Server] Error saat disconnect Prisma:', e);
    }
    process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
