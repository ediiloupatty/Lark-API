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

// Security 3: Segel Pintu Gerbang Web (CORS Strict List)
// Aplikasi Mobile tidak terkena blokir karena tidak memiliki origin browser.
const allowedOrigins = [
  'http://localhost:5173', // Web Lokal Dev
  'http://127.0.0.1:5173',
  process.env.VITE_FRONTEND_URL || 'https://lark-laundry.vercel.app' // Web Live Produksi
];

app.use(cors({
  origin: (origin, callback) => {
    // 1. Izinkan koneksi tanpa origin (seperti curl, postman, Mobile App)
    if (!origin) return callback(null, true);
    
    // 2. Izinkan domain web terdaftar
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // 3. Toleransi untuk Emulator Mobile / Capacitor yang kadang mengirimkan origin unik
    if (origin.startsWith('http://localhost') || origin.startsWith('file://') || origin.startsWith('android-app://') || origin.startsWith('capacitor://')) {
      return callback(null, true);
    }
    
    // 4. Wildcard untuk URL Vercel (sangat berguna untuk deploy tanpa perlu ganti-ganti .env)
    if (origin.endsWith('.vercel.app')) {
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

// ── Maintenance Mode ─────────────────────────────────────────────────────────
// Harus didaftarkan SEBELUM semua route agar intercept semua request.
// Aktifkan dengan set MAINTENANCE_MODE=true di .env, lalu restart backend.
app.use(maintenanceMiddleware);

// Connect to Database (with retry)
const dbReady = checkConnection();

// Register Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/sync', syncRoutes);

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


// Health check endpoint — benar-benar test koneksi DB, bukan cuma return OK
import { isDbHealthy } from './config/db';
app.get('/api/v1/health', async (req: Request, res: Response) => {
  const dbHealth = await isDbHealthy();
  const status = dbHealth.ok ? 'ok' : 'degraded';
  const httpCode = dbHealth.ok ? 200 : 503;

  res.status(httpCode).json({
    status,
    message: dbHealth.ok
      ? 'LarkLaundry Node.js API is running'
      : 'API running but database is unreachable',
    db: {
      connected: dbHealth.ok,
      latency_ms: dbHealth.latencyMs,
      ...(dbHealth.error ? { error: dbHealth.error } : {}),
    },
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.use((req: Request, res: Response, next) => {
  console.log(`[404 NOT FOUND] Method: ${req.method} | URL: ${req.url}`);
  // Fix BC-5: Kembalikan JSON agar Flutter tidak crash saat parse response
  res.status(404).json({ status: 'error', message: `Endpoint tidak ditemukan: ${req.method} ${req.url}` });
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
