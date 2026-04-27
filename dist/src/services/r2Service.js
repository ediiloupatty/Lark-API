"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToR2 = uploadToR2;
exports.deleteFromR2 = deleteFromR2;
exports.isR2Configured = isR2Configured;
const client_s3_1 = require("@aws-sdk/client-s3");
const sharp_1 = __importDefault(require("sharp"));
// ── R2 Configuration ──────────────────────────────────────────────
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_ENDPOINT = process.env.R2_ENDPOINT || '';
const R2_BUCKET = process.env.R2_BUCKET || 'lark-uploads';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';
const API_PUBLIC_URL = process.env.API_PUBLIC_URL || 'https://api.larklaundry.com';
const s3 = new client_s3_1.S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
});
// ── Allowed MIME types ────────────────────────────────────────────
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB before compression
// ── Compression ───────────────────────────────────────────────────
// All images are converted to WebP for optimal size/quality ratio.
// Proof images (bukti) are reference documents — prioritize small size
// over high resolution for fast loading on any network condition.
// Average output: 30-120KB from a 2-5MB phone photo.
async function compressImage(buffer) {
    return (0, sharp_1.default)(buffer)
        .resize({ width: 800, withoutEnlargement: true })
        .webp({ quality: 65, effort: 6 })
        .toBuffer();
}
// ── Professional Naming Convention ────────────────────────────────
// Payment: BKT-PAY-T{tenantId}-{trackingCode}-{timestamp}.webp
// Expense: BKT-EXP-T{tenantId}-{expenseId}-{timestamp}.webp
function generateKey(type, tenantId, identifier) {
    const ts = Date.now();
    const prefix = type === 'payment' ? 'payments' : 'expenses';
    const code = type === 'payment' ? 'PAY' : 'EXP';
    const sanitizedId = identifier.replace(/[^a-zA-Z0-9_-]/g, '');
    return `${prefix}/tenant_${tenantId}/BKT-${code}-T${tenantId}-${sanitizedId}-${ts}.webp`;
}
// ── Upload to R2 ──────────────────────────────────────────────────
async function uploadToR2(file, type, tenantId, identifier) {
    // Validate file type
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
        throw new Error(`Tipe file tidak didukung: ${file.mimetype}. Gunakan JPG, PNG, atau WebP.`);
    }
    // Validate file size (before compression)
    if (file.size > MAX_FILE_SIZE) {
        throw new Error(`Ukuran file terlalu besar (max ${MAX_FILE_SIZE / 1024 / 1024}MB).`);
    }
    // Compress to WebP
    const compressed = await compressImage(file.buffer);
    const key = generateKey(type, tenantId, identifier);
    // Upload to R2
    await s3.send(new client_s3_1.PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: compressed,
        ContentType: 'image/webp',
    }));
    // Return proxy URL instead of direct R2 URL (R2 dev domain blocked by Indonesian ISPs)
    const proxyUrl = `${API_PUBLIC_URL}/api/v1/public/media/${key}`;
    console.log(`[R2] Uploaded: ${key} (${file.size} → ${compressed.length} bytes)`);
    return proxyUrl;
}
// ── Delete from R2 ────────────────────────────────────────────────
async function deleteFromR2(publicUrl) {
    if (!publicUrl || !R2_PUBLIC_URL)
        return;
    try {
        // Extract key from either proxy URL or direct R2 URL
        let key = '';
        const proxyPrefix = '/api/v1/public/media/';
        if (publicUrl.includes(proxyPrefix)) {
            key = publicUrl.substring(publicUrl.indexOf(proxyPrefix) + proxyPrefix.length);
        }
        else if (R2_PUBLIC_URL && publicUrl.startsWith(R2_PUBLIC_URL)) {
            key = publicUrl.replace(R2_PUBLIC_URL, '').replace(/^\//, '');
        }
        else {
            // Try to extract path after last known pattern
            const match = publicUrl.match(/(payments|expenses)\/tenant_\d+\/.+$/);
            key = match ? match[0] : '';
        }
        if (!key)
            return;
        await s3.send(new client_s3_1.DeleteObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
        }));
        console.log(`[R2] Deleted: ${key}`);
    }
    catch (err) {
        // Non-fatal: log but don't throw — deleting an old file should never block operations
        console.error('[R2] Delete error (non-fatal):', err);
    }
}
// ── Validate R2 Config ────────────────────────────────────────────
function isR2Configured() {
    return !!(R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ENDPOINT && R2_BUCKET && R2_PUBLIC_URL);
}
