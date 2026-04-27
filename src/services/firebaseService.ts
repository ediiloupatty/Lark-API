import * as admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { db } from '../config/db';

// ── Inisialisasi Firebase Admin SDK ──────────────────────────────
// Walk up directories to find firebase-service-account.json
// Works in both dev (src/services/) and prod (dist/src/services/)
function findFirebaseConfig(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, 'firebase-service-account.json');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

const serviceAccountPath = findFirebaseConfig();

let firebaseInitialized = false;

function initFirebase() {
  if (firebaseInitialized || admin.apps.length > 0) return;

  if (!serviceAccountPath) {
    console.warn('[Firebase] firebase-service-account.json tidak ditemukan di project root. Push notification dinonaktifkan.');
    return;
  }

  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
    console.info('[Firebase] ✅ Firebase Admin SDK berhasil diinisialisasi.');
  } catch (err) {
    console.error('[Firebase] ❌ Gagal inisialisasi Firebase:', err);
  }
}

initFirebase();

// ── Simpan / update device token ──────────────────────────────────
export async function registerDeviceToken(params: {
  userId: number;
  tenantId: number;
  token: string;
  platform?: string;
}): Promise<void> {
  const { userId, tenantId, token, platform = 'android' } = params;
  await db.device_tokens.upsert({
    where: { token },
    create: { user_id: userId, tenant_id: tenantId, token, platform },
    update: { user_id: userId, tenant_id: tenantId, platform, updated_at: new Date() },
  });
}

// ── Hapus device token (saat logout) ─────────────────────────────
export async function removeDeviceToken(token: string): Promise<void> {
  await db.device_tokens.deleteMany({ where: { token } })
    .catch((e: unknown) => console.error('[Firebase] Remove device token failed:', e));
}

// ── Kirim push ke semua admin dalam 1 tenant ─────────────────────
export async function sendPushToAdmins(params: {
  tenantId: number;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<void> {
  if (!firebaseInitialized) return;

  const { tenantId, title, body, data = {} } = params;

  // Ambil semua token milik admin / super_admin di tenant ini
  const tokens = await db.$queryRaw<{ token: string }[]>`
    SELECT dt.token
    FROM device_tokens dt
    JOIN users u ON u.id = dt.user_id
    WHERE dt.tenant_id = ${tenantId}
      AND u.role IN ('admin', 'super_admin', 'owner')
      AND u.is_active = true
      AND u.deleted_at IS NULL
  `;

  if (tokens.length === 0) return;

  const tokenList = tokens.map((t: { token: string }) => t.token);

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
    const invalidTokens: string[] = [];
    response.responses.forEach((res, idx) => {
      if (!res.success && res.error?.code === 'messaging/registration-token-not-registered') {
        invalidTokens.push(tokenList[idx]);
      }
    });
    if (invalidTokens.length > 0) {
      await db.device_tokens.deleteMany({ where: { token: { in: invalidTokens } } });
    }

    console.info(`[Firebase] Push dikirim: ${response.successCount} sukses, ${response.failureCount} gagal`);
  } catch (err) {
    console.error('[Firebase] Gagal kirim push notification:', err);
  }
}

// ── Simpan notifikasi ke database (inbox in-app) ──────────────────
export async function saveNotification(params: {
  tenantId: number;
  userId: number;
  orderId?: number;
  tipe: string;
  pesan: string;
}): Promise<void> {
  await db.notifications.create({
    data: {
      tenant_id: params.tenantId,
      user_id: params.userId,
      order_id: params.orderId,
      tipe: params.tipe,
      pesan: params.pesan,
    },
  });
}
