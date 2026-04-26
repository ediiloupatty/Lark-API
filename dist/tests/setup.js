"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_PREFIX = void 0;
exports.generateToken = generateToken;
exports.seedTestData = seedTestData;
exports.cleanupTestData = cleanupTestData;
exports.authHeaders = authHeaders;
/**
 * tests/setup.ts — Test helpers for the Lark Laundry backend.
 *
 * Provides:
 * - JWT token generation for test users (admin + karyawan)
 * - Seed data creation (tenant, user, customer, service, outlet, package)
 * - Cleanup after tests
 *
 * SECURITY: Hanya digunakan di environment test, TIDAK di-import oleh kode produksi.
 */
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const db_1 = require("../src/config/db");
// Gunakan JWT_SECRET yang sama dengan .env
const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-automated-testing-only';
// ─── Test Data IDs ───────────────────────────────────────────────────────────
// Kita track semua ID yang dibuat agar bisa dibersihkan setelah test selesai.
exports.TEST_PREFIX = 'vitest_auto_';
let _ctx = null;
/**
 * Generate JWT token for test user
 */
function generateToken(payload) {
    return jsonwebtoken_1.default.sign({ ...payload, token_version: payload.token_version ?? 0 }, JWT_SECRET, { expiresIn: '1h' });
}
/**
 * Seed minimal test data and return context for all tests.
 * Idempotent — bisa dipanggil berkali-kali tanpa duplikasi.
 */
async function seedTestData() {
    if (_ctx)
        return _ctx;
    // Ensure DDL columns exist (normally created by index.ts bootstrap)
    try {
        await db_1.db.$queryRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0`);
    }
    catch (e) {
        // Column may already exist, ignore
    }
    const adminUsername = `${exports.TEST_PREFIX}admin_${Date.now()}`;
    const staffUsername = `${exports.TEST_PREFIX}staff_${Date.now()}`;
    const hashedPw = await bcrypt_1.default.hash('testpassword123', 10);
    // 1. Tenant
    const tenant = await db_1.db.tenants.create({
        data: {
            name: `${exports.TEST_PREFIX}Laundry Test`,
            slug: `${exports.TEST_PREFIX}laundry-test-${Date.now()}`,
            address: 'Jl. Test No. 1',
            phone: '08123456789',
            subscription_plan: 'free',
            subscription_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
    });
    // 2. Outlet
    const outlet = await db_1.db.$queryRawUnsafe(`INSERT INTO outlets (tenant_id, nama, alamat, phone, jam_buka, jam_tutup)
     VALUES ($1, $2, $3, $4, '08:00'::time, '20:00'::time) RETURNING id`, tenant.id, `${exports.TEST_PREFIX}Outlet Pusat`, 'Jl. Outlet No. 1', '08111111111');
    const outletId = outlet[0].id;
    // 3. Admin User (owner) — use raw SQL to avoid Prisma schema mismatch with token_version
    const adminResult = await db_1.db.$queryRawUnsafe(`INSERT INTO users (tenant_id, username, password, role, nama, email, is_active)
     VALUES ($1, $2, $3, 'owner', $4, $5, true) RETURNING id`, tenant.id, adminUsername, hashedPw, 'Admin Test', `${exports.TEST_PREFIX}admin@test.com`);
    const adminUserId = adminResult[0].id;
    // 4. Staff User (karyawan)
    const staffResult = await db_1.db.$queryRawUnsafe(`INSERT INTO users (tenant_id, outlet_id, username, password, role, nama, is_active)
     VALUES ($1, $2, $3, $4, 'karyawan', $5, true) RETURNING id`, tenant.id, outletId, staffUsername, hashedPw, 'Staff Test');
    const staffUserId = staffResult[0].id;
    // 5. Customer
    const customer = await db_1.db.customers.create({
        data: {
            tenant_id: tenant.id,
            nama: `${exports.TEST_PREFIX}Pelanggan Test`,
            no_hp: `081${Date.now().toString().slice(-9)}`,
            alamat: 'Jl. Customer No. 1',
        },
    });
    // 6. Service
    const svcResult = await db_1.db.$queryRawUnsafe(`INSERT INTO services (tenant_id, nama_layanan, harga_per_kg, deskripsi, durasi_hari, server_version)
     VALUES ($1, $2, $3, $4, $5, CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT)) RETURNING id`, tenant.id, `${exports.TEST_PREFIX}Cuci Biasa`, 5000, 'Test service', 3);
    const serviceId = svcResult[0].id;
    // 7. Package
    const pkgResult = await db_1.db.$queryRawUnsafe(`INSERT INTO paket_laundry (tenant_id, nama, durasi_jam, harga_tambahan, is_active, server_version)
     VALUES ($1, $2, $3, $4, true, CAST(EXTRACT(EPOCH FROM NOW()) * 1000 AS BIGINT)) RETURNING id`, tenant.id, `${exports.TEST_PREFIX}Paket Express`, 6, 3000);
    const packageId = pkgResult[0].id;
    // 8. Tenant Settings (untuk settings test)
    await db_1.db.tenant_settings.create({
        data: {
            tenant_id: tenant.id,
            setting_key: 'toko_info',
            setting_value: { nama: 'Test Laundry', alamat: 'Jl. Test', telepon: '081', email: 'test@test.com' },
        },
    });
    // Generate tokens
    const adminToken = generateToken({
        user_id: adminUserId,
        username: adminUsername,
        role: 'admin',
        tenant_id: tenant.id,
        outlet_id: null,
    });
    const staffToken = generateToken({
        user_id: staffUserId,
        username: staffUsername,
        role: 'karyawan',
        tenant_id: tenant.id,
        outlet_id: outletId,
    });
    _ctx = {
        tenantId: tenant.id,
        adminUserId,
        staffUserId,
        customerId: customer.id,
        serviceId,
        outletId,
        packageId,
        adminToken,
        staffToken,
        adminUsername,
        staffUsername,
    };
    return _ctx;
}
/**
 * Cleanup all test data created by seedTestData.
 */
async function cleanupTestData() {
    if (!_ctx)
        return;
    const t = _ctx.tenantId;
    try {
        // Delete in dependency order (child → parent)
        await db_1.db.$queryRawUnsafe(`DELETE FROM notifications WHERE tenant_id = $1`, t);
        await db_1.db.$queryRawUnsafe(`DELETE FROM order_details WHERE order_id IN (SELECT id FROM orders WHERE tenant_id = $1)`, t);
        await db_1.db.$queryRawUnsafe(`DELETE FROM payments WHERE tenant_id = $1`, t);
        await db_1.db.$queryRawUnsafe(`DELETE FROM orders WHERE tenant_id = $1`, t);
        await db_1.db.$queryRawUnsafe(`DELETE FROM expenses WHERE tenant_id = $1`, t);
        await db_1.db.$queryRawUnsafe(`DELETE FROM services WHERE tenant_id = $1`, t);
        await db_1.db.$queryRawUnsafe(`DELETE FROM paket_laundry WHERE tenant_id = $1`, t);
        await db_1.db.$queryRawUnsafe(`DELETE FROM customers WHERE tenant_id = $1`, t);
        await db_1.db.$queryRawUnsafe(`DELETE FROM tenant_settings WHERE tenant_id = $1`, t);
        await db_1.db.$queryRawUnsafe(`DELETE FROM device_tokens WHERE tenant_id = $1`, t);
        await db_1.db.$queryRawUnsafe(`DELETE FROM users WHERE tenant_id = $1`, t);
        await db_1.db.$queryRawUnsafe(`DELETE FROM outlets WHERE tenant_id = $1`, t);
        await db_1.db.$queryRawUnsafe(`DELETE FROM tenants WHERE id = $1`, t);
    }
    catch (e) {
        console.warn('[Cleanup] Warning:', e.message);
    }
    _ctx = null;
}
/**
 * Helper: build request headers with auth token + platform header
 * agar melewati custom origin check dan CSRF.
 */
function authHeaders(token) {
    return {
        'Content-Type': 'application/json',
        'X-App-Platform': 'LarkMobile',
        'Cookie': `lark_token=${token}`,
        'Authorization': `Bearer ${token}`,
    };
}
