import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Global patch to prevent Express res.json() from crashing on BigInt fields from PostgreSQL/Prisma
// @ts-ignore
BigInt.prototype.toJSON = function () {
  return this.toString();
};

// MUST be called before any local imports that depend on ENV vars (like Prisma)
dotenv.config({ path: path.join(__dirname, '../.env') });

import { checkConnection } from './config/db';
import authRoutes from './routes/authRoutes';
import syncRoutes from './routes/syncRoutes';
import { getLandingStats } from './controllers/publicController';
import { maintenanceMiddleware } from './middlewares/maintenanceMiddleware';

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { setCsrfCookie, verifyCsrf } from './middlewares/csrfMiddleware';

const app = express();
const PORT = process.env.PORT || 3000;

// Security 1: Menyembunyikan Identitas Node.js/Express (Anti-Header Profiling)
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "unsafe-none" }
}));

// Deteksi IP asli di belakang Docker/Nginx Proxy agar Rate Limiter tidak memblokir semua user sekaligus
app.set('trust proxy', 1);

// Security 2: Pertahanan DDoS / Spam Limit
const globalLimiter = rateLimit({
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
  'https://larklaundry.com',         // Web Live (non-www)
  'https://www.larklaundry.com',     // Web Live (www — Vercel)
  process.env.VITE_FRONTEND_URL || 'https://lark-laundry.vercel.app' // Web Live Produksi
];

/** Cek apakah origin diizinkan (termasuk wildcard Vercel dan jaringan lokal) */
function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.includes(origin)) return true;
  if (origin.endsWith('.vercel.app')) return true;
  if (origin.endsWith('.larklaundry.com') || origin === 'https://larklaundry.com') return true;
  if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) return true;
  if (origin.startsWith('http://192.168.') || origin.startsWith('http://10.')) return true;
  return false;
}

app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  const platform = req.headers['x-app-platform'];
  const vercelId = req.headers['x-vercel-id'];
  const forwardedHost = req.headers['x-forwarded-host'] as string | undefined;

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

app.use(cors({
  origin: (origin, callback) => {
    // 1. Izinkan koneksi tanpa origin (seperti curl, postman, Mobile App) yang lolos pengecekan custom header
    if (!origin) return callback(null, true);
    
    // 2. Izinkan domain web terdaftar (termasuk www dan non-www)
    if (isAllowedOrigin(origin)) return callback(null, true);

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
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Parse cookies — dibutuhkan oleh authMiddleware untuk membaca httpOnly token
app.use(cookieParser());


// ── Maintenance Mode ─────────────────────────────────────────────────────────
// Harus didaftarkan SEBELUM semua route agar intercept semua request.
// Aktifkan dengan set MAINTENANCE_MODE=true di .env, lalu restart backend.
app.use(maintenanceMiddleware);

// Connect to Database (with retry)
const dbReady = checkConnection();

// ── CSRF Protection ──────────────────────────────────────────────────────────
// Set CSRF cookie pada setiap response (jika belum ada)
app.use(setCsrfCookie);

// Register Routes
// Auth routes: TIDAK pakai CSRF (session belum terbentuk saat login/register)
app.use('/api/v1/auth', authRoutes);
// Sync routes: PAKAI CSRF (mutating requests pada session aktif)
app.use('/api/v1/sync', verifyCsrf, syncRoutes);

// [Public] Landing page stats — no auth required
app.get('/api/v1/public/landing-stats', getLandingStats);

// [1] Alias: Mobile ExpenseService calls /api/v1/expenses (without /sync/ prefix)
// Mount same syncRoutes so /api/v1/expenses resolves correctly
import { authenticateToken } from './middlewares/authMiddleware';
import { getExpenses, addExpense, updateExpense, deleteExpense } from './controllers/financeController';
app.get('/api/v1/expenses',    authenticateToken, getExpenses);
app.post('/api/v1/expenses',   authenticateToken, addExpense);
app.put('/api/v1/expenses',    authenticateToken, updateExpense);
app.delete('/api/v1/expenses', authenticateToken, deleteExpense);


// Health check endpoint — industry-standard format (RFC Health Check Response)
import { isDbHealthy } from './config/db';
app.get('/api/v1/health', async (req: Request, res: Response) => {
  const dbHealth = await isDbHealthy();
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

app.use((req: Request, res: Response, next) => {
  console.log(`[404 NOT FOUND] Method: ${req.method} | URL: ${req.url}`);
  // Fix BC-5: Kembalikan JSON agar Flutter tidak crash saat parse response
  res.status(404).json({ status: 'error', message: `Endpoint tidak ditemukan: ${req.method} ${req.url}` });
});

// Global Error Handler (Menangkap Unhandled Promise Rejections & Error tak terduga)
app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
  console.error('🚨 [Global Error]', err);
  res.status(500).json({ 
    status: 'error', 
    success: false, 
    message: 'Internal Server Error. Silakan coba lagi nanti.' 
  });
});

import { db, pool } from './config/db';

async function bootstrap() {
  // Tunggu hasil checkConnection (retry logic)
  const isDbConnected = await dbReady;

  if (!isDbConnected) {
    console.error('🚨 [Bootstrap] Database TIDAK tersedia. Server akan jalan tapi API bergantung DB akan error 503.');
  }

  // Gunakan pool pg langsung untuk DDL — $executeRawUnsafe tidak support PrismaPg adapter
  if (isDbConnected) {
    try {
      const client = await pool.connect();
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
      } catch (e: any) {
        if (e.code !== '42P07') {
          console.warn('[Bootstrap] device_tokens warning:', e.message);
        }
      } finally {
        client.release();
      }
    } catch (e: any) {
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
async function shutdown(signal: string) {
  console.log(`[Server] Menerima signal ${signal}. Shutdown dengan benar...`);
  try {
    await db.$disconnect();
    console.log('[Server] ✅ Prisma disconnected.');
  } catch (e) {
    console.error('[Server] Error saat disconnect Prisma:', e);
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
