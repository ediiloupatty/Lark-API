/**
 * app.ts — Express application setup (tanpa listen).
 *
 * Dipisahkan dari index.ts agar bisa di-import oleh test (Supertest)
 * tanpa harus menjalankan server. Semua middleware, route, dan error
 * handler tetap sama persis seperti sebelumnya.
 *
 * @version 1.1.0 — CI/CD pipeline + coverage integration
 */
import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Global patch BigInt → JSON
// @ts-ignore
BigInt.prototype.toJSON = function () {
  return this.toString();
};

import authRoutes from './routes/authRoutes';
import syncRoutes from './routes/syncRoutes';
import paymentRoutes from './routes/paymentRoutes';
import trackingRoutes from './routes/trackingRoutes';
import { getLandingStats } from './controllers/publicController';
import { maintenanceMiddleware } from './middlewares/maintenanceMiddleware';
import { setCsrfCookie, verifyCsrf } from './middlewares/csrfMiddleware';
import { authenticateToken } from './middlewares/authMiddleware';
import { listBlogArticles, getBlogArticle, triggerGenerate } from './controllers/blogController';
import { isDbHealthy } from './config/db';

const app = express();

// Security 1: Helmet
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "unsafe-none" }
}));

app.set('trust proxy', 1);

// Security 2: Rate Limit (disabled in test environment)
if (process.env.NODE_ENV !== 'test') {
  const globalLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 3000,
    message: { status: 'error', success: false, message: 'Keamanan: Terlalu banyak permintaan. Sistem menjeda koneksi Anda sesaat.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', globalLimiter);
}

// Security 3: Custom Origin + CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://larklaundry.com',
  'https://www.larklaundry.com',
  process.env.VITE_FRONTEND_URL || 'https://lark-laundry.vercel.app'
];

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

  if (origin && isAllowedOrigin(origin)) return next();
  if (vercelId || (forwardedHost && forwardedHost.endsWith('.vercel.app'))) return next();
  if (platform === 'LarkMobile' || platform === 'LarkWeb') return next();
  if (req.path.startsWith('/api/v1/public/') || req.path === '/api/v1/health' || req.path === '/api/v1/payments/notify') return next();

  return res.status(403).json({
    status: 'error',
    message: 'Akses ditolak. Endpoint hanya dapat diakses melalui aplikasi resmi Lark Laundry.'
  });
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (isAllowedOrigin(origin)) return callback(null, true);
    if (origin.startsWith('file://') || origin.startsWith('android-app://') || origin.startsWith('capacitor://')) {
      return callback(null, true);
    }
    callback(null, false);
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Maintenance Mode
app.use(maintenanceMiddleware);

// CSRF Protection
app.use(setCsrfCookie);

import sysAdminRoutes from './routes/sysAdminRoutes';
import whatsappRoutes from './routes/whatsappRoutes';

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/sync', verifyCsrf, syncRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/sys-admin', verifyCsrf, sysAdminRoutes);
app.use('/api/v1/whatsapp', verifyCsrf, whatsappRoutes);

// Public endpoints
app.use('/api/v1/public/track', trackingRoutes);
app.get('/api/v1/public/landing-stats', getLandingStats);
app.get('/api/v1/public/blog', listBlogArticles);
app.post('/api/v1/public/blog/generate', triggerGenerate);
app.get('/api/v1/public/blog/:slug', getBlogArticle);

// Media proxy — serves R2 images through our domain to bypass ISP SSL interception
import { proxyMedia } from './controllers/mediaProxyController';
app.get('/api/v1/public/media/*path', proxyMedia);

// Expense routes (extracted to dedicated router for architectural consistency)
import expenseRoutes from './routes/expenseRoutes';
app.use('/api/v1/expenses', verifyCsrf, expenseRoutes);

// Health check
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

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ status: 'error', message: `Endpoint tidak ditemukan: ${req.method} ${req.url}` });
});

// Global error handler
app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
  console.error('🚨 [Global Error]', err);
  res.status(500).json({
    status: 'error',
    success: false,
    message: 'Internal Server Error. Silakan coba lagi nanti.'
  });
});

export default app;
