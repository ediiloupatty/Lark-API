"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDeviceToken = registerDeviceToken;
exports.removeDeviceToken = removeDeviceToken;
exports.sendPushToAdmins = sendPushToAdmins;
exports.saveNotification = saveNotification;
const admin = __importStar(require("firebase-admin"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const db_1 = require("../config/db");
// ── Inisialisasi Firebase Admin SDK ──────────────────────────────
// Walk up directories to find firebase-service-account.json
// Works in both dev (src/services/) and prod (dist/src/services/)
function findFirebaseConfig() {
    let dir = __dirname;
    for (let i = 0; i < 5; i++) {
        const candidate = path_1.default.join(dir, 'firebase-service-account.json');
        if (fs_1.default.existsSync(candidate))
            return candidate;
        dir = path_1.default.dirname(dir);
    }
    return null;
}
const serviceAccountPath = findFirebaseConfig();
let firebaseInitialized = false;
function initFirebase() {
    if (firebaseInitialized || admin.apps.length > 0)
        return;
    if (!serviceAccountPath) {
        console.warn('[Firebase] firebase-service-account.json tidak ditemukan di project root. Push notification dinonaktifkan.');
        return;
    }
    try {
        const serviceAccount = JSON.parse(fs_1.default.readFileSync(serviceAccountPath, 'utf8'));
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
        firebaseInitialized = true;
        console.log('[Firebase] ✅ Firebase Admin SDK berhasil diinisialisasi.');
    }
    catch (err) {
        console.error('[Firebase] ❌ Gagal inisialisasi Firebase:', err);
    }
}
initFirebase();
// ── Simpan / update device token ──────────────────────────────────
async function registerDeviceToken(params) {
    const { userId, tenantId, token, platform = 'android' } = params;
    await db_1.db.device_tokens.upsert({
        where: { token },
        create: { user_id: userId, tenant_id: tenantId, token, platform },
        update: { user_id: userId, tenant_id: tenantId, platform, updated_at: new Date() },
    });
}
// ── Hapus device token (saat logout) ─────────────────────────────
async function removeDeviceToken(token) {
    await db_1.db.device_tokens.deleteMany({ where: { token } }).catch(() => { });
}
// ── Kirim push ke semua admin dalam 1 tenant ─────────────────────
async function sendPushToAdmins(params) {
    if (!firebaseInitialized)
        return;
    const { tenantId, title, body, data = {} } = params;
    // Ambil semua token milik admin / super_admin di tenant ini
    const tokens = await db_1.db.$queryRaw `
    SELECT dt.token
    FROM device_tokens dt
    JOIN users u ON u.id = dt.user_id
    WHERE dt.tenant_id = ${tenantId}
      AND u.role IN ('admin', 'super_admin', 'owner')
      AND u.is_active = true
      AND u.deleted_at IS NULL
  `;
    if (tokens.length === 0)
        return;
    const tokenList = tokens.map((t) => t.token);
    try {
        const response = await admin.messaging().sendEachForMulticast({
            tokens: tokenList,
            notification: { title, body },
            data,
            android: {
                priority: 'high',
                notification: {
                    channelId: 'lark_orders',
                    priority: 'high',
                    defaultSound: true,
                },
            },
        });
        // Bersihkan token yang sudah tidak valid (HP ganti / uninstall)
        const invalidTokens = [];
        response.responses.forEach((res, idx) => {
            if (!res.success && res.error?.code === 'messaging/registration-token-not-registered') {
                invalidTokens.push(tokenList[idx]);
            }
        });
        if (invalidTokens.length > 0) {
            await db_1.db.device_tokens.deleteMany({ where: { token: { in: invalidTokens } } });
        }
        console.log(`[Firebase] Push dikirim: ${response.successCount} sukses, ${response.failureCount} gagal`);
    }
    catch (err) {
        console.error('[Firebase] Gagal kirim push notification:', err);
    }
}
// ── Simpan notifikasi ke database (inbox in-app) ──────────────────
async function saveNotification(params) {
    await db_1.db.notifications.create({
        data: {
            tenant_id: params.tenantId,
            user_id: params.userId,
            order_id: params.orderId,
            tipe: params.tipe,
            pesan: params.pesan,
        },
    });
}
