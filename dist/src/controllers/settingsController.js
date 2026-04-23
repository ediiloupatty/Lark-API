"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSubscriptions = exports.updateSettings = exports.getSettings = void 0;
const db_1 = require("../config/db");
// --- SETTINGS (Umum & Nota) ---
const getSettings = async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id;
        const settings = await db_1.db.tenant_settings.findMany({
            where: { tenant_id: tenantId }
        });
        const settingsMap = settings.reduce((acc, curr) => {
            acc[curr.setting_key] = curr.setting_value;
            return acc;
        }, {});
        res.json({ status: 'success', data: settingsMap });
    }
    catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal memuat pengaturan' });
    }
};
exports.getSettings = getSettings;
const updateSettings = async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id;
        const updates = req.body;
        // Fix B-2: Whitelist key yang diizinkan — cegah injection key sembarang
        const ALLOWED_SETTING_KEYS = new Set([
            'toko_info', 'nota_info', 'whatsapp_config',
            'jam_operasional', 'global_staff_permissions', 'printer_config',
        ]);
        for (const [key, value] of Object.entries(updates)) {
            if (!ALLOWED_SETTING_KEYS.has(key))
                continue;
            await db_1.db.tenant_settings.upsert({
                where: { tenant_id_setting_key: { tenant_id: tenantId, setting_key: key } },
                update: { setting_value: value, updated_at: new Date() },
                create: { tenant_id: tenantId, setting_key: key, setting_value: value }
            });
        }
        res.json({ status: 'success', message: 'Pengaturan berhasil disimpan!' });
    }
    catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal menyimpan pengaturan' });
    }
};
exports.updateSettings = updateSettings;
// --- SUBSCRIPTIONS ---
const getSubscriptions = async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id;
        const tenant = await db_1.db.tenants.findUnique({
            where: { id: tenantId },
            select: { subscription_plan: true, subscription_until: true }
        });
        const packages = await db_1.db.subscription_packages.findMany({
            where: { is_active: true }
        });
        const planNameMap = {
            'free': 'Paket Gratis',
            'basic': 'Paket Basic',
            'premium': 'Paket Premium'
        };
        let untilString = '-';
        let isExpired = false;
        if (tenant?.subscription_until) {
            const dateObj = new Date(tenant.subscription_until);
            untilString = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
            isExpired = dateObj.getTime() < Date.now();
        }
        else {
            if (tenant?.subscription_plan === 'free') {
                untilString = 'Selamanya (Akses Dasar)';
            }
        }
        res.json({
            status: 'success',
            data: {
                current: {
                    plan_code: tenant?.subscription_plan || 'free',
                    plan_name: planNameMap[tenant?.subscription_plan || 'free'] || 'Paket Aktif',
                    is_expired: isExpired,
                    until: untilString
                },
                packages: packages.map(p => ({ ...p, harga: Number(p.harga) }))
            }
        });
    }
    catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal memuat billing' });
    }
};
exports.getSubscriptions = getSubscriptions;
