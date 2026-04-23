"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.changePassword = exports.updateProfile = exports.getProfile = void 0;
const db_1 = require("../config/db");
const bcrypt_1 = __importDefault(require("bcrypt"));
const getProfile = async (req, res) => {
    try {
        const userId = req.user?.user_id;
        if (!userId)
            return res.status(401).json({ status: 'error', message: 'Token tidak valid' });
        const profileRes = await db_1.db.$queryRawUnsafe(`
      SELECT u.username, u.nama, u.email, u.role, u.no_hp, u.alamat,
             t.name as tenant_name, t.address as tenant_alamat, t.phone as tenant_no_hp
      FROM users u 
      LEFT JOIN tenants t ON u.tenant_id = t.id 
      WHERE u.id = $1
    `, userId);
        if (profileRes.length > 0) {
            const p = profileRes[0];
            const roleMap = { super_admin: 'Owner', admin: 'Admin', owner: 'Owner', karyawan: 'Staff' };
            const outRole = roleMap[p.role] || p.role;
            res.json({
                status: 'success',
                message: 'Profil berhasil diambil',
                data: {
                    username: p.username,
                    nama: p.nama,
                    email: p.email,
                    role: outRole,
                    no_hp: p.no_hp,
                    alamat: p.alamat,
                    tenant: {
                        nama: p.tenant_name || '',
                        alamat: p.tenant_alamat || '',
                        no_hp: p.tenant_no_hp || '',
                    }
                }
            });
        }
        else {
            res.status(404).json({ status: 'error', message: 'Profil tidak ditemukan' });
        }
    }
    catch (err) {
        console.error('[GetProfile]', err);
        res.status(500).json({ status: 'error', message: 'Gagal mengambil profil' });
    }
};
exports.getProfile = getProfile;
const updateProfile = async (req, res) => {
    try {
        const userId = req.user?.user_id;
        if (!userId)
            return res.status(401).json({ status: 'error', message: 'Token tidak valid' });
        const { nama, email, username, no_hp, alamat, password } = req.body;
        // Check if username exists
        const checkUser = await db_1.db.$queryRawUnsafe(`SELECT id FROM users WHERE username = $1 AND id != $2`, username, userId);
        if (checkUser.length > 0) {
            return res.status(400).json({ status: 'error', message: 'Username sudah digunakan oleh akun lain.' });
        }
        if (password) {
            const hashedPassword = await bcrypt_1.default.hash(password, 10);
            await db_1.db.$queryRawUnsafe(`
        UPDATE users SET nama = $1, email = $2, username = $3, password = $4, no_hp = $5, alamat = $6 WHERE id = $7
      `, nama, email, username, hashedPassword, no_hp, alamat, userId);
        }
        else {
            await db_1.db.$queryRawUnsafe(`
        UPDATE users SET nama = $1, email = $2, username = $3, no_hp = $4, alamat = $5 WHERE id = $6
      `, nama, email, username, no_hp, alamat, userId);
        }
        // Return updated
        const profileRes = await db_1.db.$queryRawUnsafe(`
      SELECT u.username, u.nama, u.email, u.role, u.no_hp, u.alamat,
             t.name as tenant_name, t.address as tenant_alamat, t.phone as tenant_no_hp
      FROM users u 
      LEFT JOIN tenants t ON u.tenant_id = t.id 
      WHERE u.id = $1
    `, userId);
        const p = profileRes[0];
        const roleMap = { super_admin: 'Owner', admin: 'Admin', owner: 'Owner', karyawan: 'Staff' };
        res.json({
            status: 'success',
            message: 'Profil berhasil diperbarui',
            data: {
                username: p.username,
                nama: p.nama,
                email: p.email,
                role: roleMap[p.role] || p.role,
                no_hp: p.no_hp,
                alamat: p.alamat,
                tenant: {
                    nama: p.tenant_name || '',
                    alamat: p.tenant_alamat || '',
                    no_hp: p.tenant_no_hp || '',
                }
            }
        });
    }
    catch (err) {
        console.error('[UpdateProfile]', err);
        res.status(500).json({ status: 'error', message: 'Gagal update profil' });
    }
};
exports.updateProfile = updateProfile;
// POST /api/v1/sync/change-password
const changePassword = async (req, res) => {
    try {
        const userId = req.user?.user_id;
        if (!userId)
            return res.status(401).json({ status: 'error', message: 'Token tidak valid.' });
        const { old_password, new_password } = req.body;
        if (!old_password || !new_password) {
            return res.status(400).json({ status: 'error', message: 'Password lama dan password baru wajib diisi.' });
        }
        // L-3: Standardized — minimal 8 karakter (konsisten dengan register dan reset password)
        if (new_password.length < 8) {
            return res.status(400).json({ status: 'error', message: 'Password baru minimal 8 karakter.' });
        }
        // Fetch current hashed password
        const rows = await db_1.db.$queryRawUnsafe(`SELECT password FROM users WHERE id = $1`, userId);
        if (rows.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Pengguna tidak ditemukan.' });
        }
        const isMatch = await bcrypt_1.default.compare(old_password, rows[0].password);
        if (!isMatch) {
            return res.status(400).json({ status: 'error', message: 'Password lama tidak sesuai.' });
        }
        const hashed = await bcrypt_1.default.hash(new_password, 10);
        await db_1.db.$queryRawUnsafe(`UPDATE users SET password = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2`, hashed, userId);
        res.json({ status: 'success', message: 'Password berhasil diubah. Semua sesi aktif akan di-logout.' });
    }
    catch (err) {
        console.error('[ChangePassword Error]', err);
        res.status(500).json({ status: 'error', message: 'Gagal mengubah password.' });
    }
};
exports.changePassword = changePassword;
