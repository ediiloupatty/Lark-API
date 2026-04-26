"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * app.ts — Express application setup (tanpa listen).
 *
 * Dipisahkan dari index.ts agar bisa di-import oleh test (Supertest)
 * tanpa harus menjalankan server. Semua middleware, route, dan error
 * handler tetap sama persis seperti sebelumnya.
 *
 * @version 1.1.0 — CI/CD pipeline + coverage integration
 */
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
// Global patch BigInt → JSON
// @ts-ignore
BigInt.prototype.toJSON = function () {
    return this.toString();
};
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const syncRoutes_1 = __importDefault(require("./routes/syncRoutes"));
const paymentRoutes_1 = __importDefault(require("./routes/paymentRoutes"));
const trackingRoutes_1 = __importDefault(require("./routes/trackingRoutes"));
const publicController_1 = require("./controllers/publicController");
const maintenanceMiddleware_1 = require("./middlewares/maintenanceMiddleware");
const csrfMiddleware_1 = require("./middlewares/csrfMiddleware");
const authMiddleware_1 = require("./middlewares/authMiddleware");
const financeController_1 = require("./controllers/financeController");
const blogController_1 = require("./controllers/blogController");
const db_1 = require("./config/db");
const app = (0, express_1.default)();
// Security 1: Helmet
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "unsafe-none" }
}));
app.set('trust proxy', 1);
// Security 2: Rate Limit (disabled in test environment)
if (process.env.NODE_ENV !== 'test') {
    const globalLimiter = (0, express_rate_limit_1.default)({
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
    if (origin && isAllowedOrigin(origin))
        return next();
    if (vercelId || (forwardedHost && forwardedHost.endsWith('.vercel.app')))
        return next();
    if (platform === 'LarkMobile' || platform === 'LarkWeb')
        return next();
    if (req.path.startsWith('/api/v1/public/') || req.path === '/api/v1/health' || req.path === '/api/v1/payments/notify')
        return next();
    return res.status(403).json({
        status: 'error',
        message: 'Akses ditolak. Endpoint hanya dapat diakses melalui aplikasi resmi Lark Laundry.'
    });
});
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true);
        if (isAllowedOrigin(origin))
            return callback(null, true);
        if (origin.startsWith('file://') || origin.startsWith('android-app://') || origin.startsWith('capacitor://')) {
            return callback(null, true);
        }
        callback(null, false);
    },
    credentials: true
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
app.use((0, cookie_parser_1.default)());
// Maintenance Mode
app.use(maintenanceMiddleware_1.maintenanceMiddleware);
// CSRF Protection
app.use(csrfMiddleware_1.setCsrfCookie);
const sysAdminRoutes_1 = __importDefault(require("./routes/sysAdminRoutes"));
// Routes
app.use('/api/v1/auth', authRoutes_1.default);
app.use('/api/v1/sync', csrfMiddleware_1.verifyCsrf, syncRoutes_1.default);
app.use('/api/v1/payments', paymentRoutes_1.default);
app.use('/api/v1/sys-admin', csrfMiddleware_1.verifyCsrf, sysAdminRoutes_1.default);
// Public endpoints
app.use('/api/v1/public/track', trackingRoutes_1.default);
app.get('/api/v1/public/landing-stats', publicController_1.getLandingStats);
app.get('/api/v1/public/blog', blogController_1.listBlogArticles);
app.post('/api/v1/public/blog/generate', blogController_1.triggerGenerate);
app.get('/api/v1/public/blog/:slug', blogController_1.getBlogArticle);
// Expense alias routes
app.get('/api/v1/expenses', authMiddleware_1.authenticateToken, financeController_1.getExpenses);
app.post('/api/v1/expenses', authMiddleware_1.authenticateToken, financeController_1.addExpense);
app.put('/api/v1/expenses', authMiddleware_1.authenticateToken, financeController_1.updateExpense);
app.delete('/api/v1/expenses', authMiddleware_1.authenticateToken, financeController_1.deleteExpense);
// Health check
app.get('/api/v1/health', async (req, res) => {
    const dbHealth = await (0, db_1.isDbHealthy)();
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
app.use((req, res) => {
    res.status(404).json({ status: 'error', message: `Endpoint tidak ditemukan: ${req.method} ${req.url}` });
});
// Global error handler
app.use((err, req, res, next) => {
    console.error('🚨 [Global Error]', err);
    res.status(500).json({
        status: 'error',
        success: false,
        message: 'Internal Server Error. Silakan coba lagi nanti.'
    });
});
exports.default = app;
