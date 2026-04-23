"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerToken = registerToken;
exports.unregisterToken = unregisterToken;
exports.getNotifications = getNotifications;
exports.markAllRead = markAllRead;
exports.markOneRead = markOneRead;
const firebaseService_1 = require("../services/firebaseService");
const db_1 = require("../config/db");
// POST /sync/device-token
// Dipanggil Flutter setelah login berhasil untuk mendaftarkan FCM token
async function registerToken(req, res) {
    const user = req.user;
    if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
    }
    const { token, platform } = req.body;
    if (!token || typeof token !== 'string') {
        res.status(400).json({ success: false, message: 'token wajib diisi' });
        return;
    }
    await (0, firebaseService_1.registerDeviceToken)({
        userId: user.user_id,
        tenantId: user.tenant_id,
        token,
        platform: platform ?? 'android',
    });
    res.json({ success: true, message: 'Device token terdaftar' });
}
// DELETE /sync/device-token?token=xxx
// Dipanggil Flutter saat logout untuk menghapus token (berhenti terima notif)
async function unregisterToken(req, res) {
    // Token bisa dari body (jika POST) atau query param (jika DELETE via http package Flutter)
    const token = req.body?.token || req.query.token;
    if (token)
        await (0, firebaseService_1.removeDeviceToken)(token);
    res.json({ success: true, message: 'Device token dihapus' });
}
// GET /sync/notifications
// Ambil daftar notifikasi in-app untuk user yang login
async function getNotifications(req, res) {
    const user = req.user;
    if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
    }
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const [notifications, unreadCount] = await Promise.all([
        db_1.db.notifications.findMany({
            where: { user_id: user.user_id, tenant_id: user.tenant_id },
            orderBy: { created_at: 'desc' },
            take: limit,
            skip: offset,
        }),
        db_1.db.notifications.count({
            where: { user_id: user.user_id, tenant_id: user.tenant_id, is_read: false },
        }),
    ]);
    res.json({ success: true, data: notifications, unread_count: unreadCount });
}
// POST /sync/notifications/read-all
// Tandai semua notifikasi sebagai sudah dibaca
async function markAllRead(req, res) {
    const user = req.user;
    if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
    }
    await db_1.db.notifications.updateMany({
        where: { user_id: user.user_id, tenant_id: user.tenant_id, is_read: false },
        data: { is_read: true },
    });
    res.json({ success: true, message: 'Semua notifikasi ditandai terbaca' });
}
// POST /sync/notifications/read/:id
// Tandai 1 notifikasi sebagai terbaca
async function markOneRead(req, res) {
    const user = req.user;
    if (!user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
    }
    const id = parseInt(req.params.id);
    await db_1.db.notifications.updateMany({
        where: { id, user_id: user.user_id },
        data: { is_read: true },
    });
    res.json({ success: true });
}
