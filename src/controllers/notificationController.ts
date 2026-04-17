import { Request, Response } from 'express';
import { registerDeviceToken, removeDeviceToken } from '../services/firebaseService';
import { db } from '../config/db';

interface AuthRequest extends Request {
  user?: { user_id: number; tenant_id: number; role: string; id?: number };
}

// POST /sync/device-token
// Dipanggil Flutter setelah login berhasil untuk mendaftarkan FCM token
export async function registerToken(req: AuthRequest, res: Response): Promise<void> {
  const user = req.user;
  if (!user) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }

  const { token, platform } = req.body;
  if (!token || typeof token !== 'string') {
    res.status(400).json({ success: false, message: 'token wajib diisi' });
    return;
  }

  await registerDeviceToken({
    userId: user.user_id || user.id as number,
    tenantId: user.tenant_id,
    token,
    platform: platform ?? 'android',
  });

  res.json({ success: true, message: 'Device token terdaftar' });
}

// DELETE /sync/device-token?token=xxx
// Dipanggil Flutter saat logout untuk menghapus token (berhenti terima notif)
export async function unregisterToken(req: AuthRequest, res: Response): Promise<void> {
  // Token bisa dari body (jika POST) atau query param (jika DELETE via http package Flutter)
  const token = req.body?.token || req.query.token;
  if (token) await removeDeviceToken(token as string);
  res.json({ success: true, message: 'Device token dihapus' });
}

// GET /sync/notifications
// Ambil daftar notifikasi in-app untuk user yang login
export async function getNotifications(req: AuthRequest, res: Response): Promise<void> {
  const user = req.user;
  if (!user) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }

  const page = parseInt(req.query.page as string) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;

  const realUserId = user.user_id || user.id as number;

  const [notifications, unreadCount] = await Promise.all([
    db.notifications.findMany({
      where: { user_id: realUserId, tenant_id: user.tenant_id },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.notifications.count({
      where: { user_id: realUserId, tenant_id: user.tenant_id, is_read: false },
    }),
  ]);

  res.json({ success: true, data: notifications, unread_count: unreadCount });
}

// POST /sync/notifications/read-all
// Tandai semua notifikasi sebagai sudah dibaca
export async function markAllRead(req: AuthRequest, res: Response): Promise<void> {
  const user = req.user;
  if (!user) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }

  const realUserId = user.user_id || user.id as number;

  await db.notifications.updateMany({
    where: { user_id: realUserId, tenant_id: user.tenant_id, is_read: false },
    data: { is_read: true },
  });

  res.json({ success: true, message: 'Semua notifikasi ditandai terbaca' });
}

// POST /sync/notifications/read/:id
// Tandai 1 notifikasi sebagai terbaca
export async function markOneRead(req: AuthRequest, res: Response): Promise<void> {
  const user = req.user;
  if (!user) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }

  const id = parseInt(req.params.id as string);
  const realUserId = user.user_id || user.id as number;
  
  await db.notifications.updateMany({
    where: { id, user_id: realUserId },
    data: { is_read: true },
  });

  res.json({ success: true });
}
