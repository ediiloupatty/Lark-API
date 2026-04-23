"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAppRole = exports.hashPassword = exports.needsPasswordRehashUpgrade = exports.verifyModernPassword = exports.isLegacyMd5Hash = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const isLegacyMd5Hash = (hash) => {
    return /^[a-f0-9]{32}$/i.test(hash);
};
exports.isLegacyMd5Hash = isLegacyMd5Hash;
const verifyModernPassword = async (plain, storedHash) => {
    // Check Bcrypt modern format
    if (!(0, exports.isLegacyMd5Hash)(storedHash)) {
        return bcrypt_1.default.compare(plain, storedHash);
    }
    // Fallback to MD5 logic exactly like PHP
    const hashedPlain = crypto_1.default.createHash('md5').update(plain).digest('hex');
    return hashedPlain.toLowerCase() === storedHash.toLowerCase();
};
exports.verifyModernPassword = verifyModernPassword;
const needsPasswordRehashUpgrade = (storedHash) => {
    return (0, exports.isLegacyMd5Hash)(storedHash);
};
exports.needsPasswordRehashUpgrade = needsPasswordRehashUpgrade;
// L-1: Cost factor 12 — industry best practice 2026. Slower brute-force offline.
const hashPassword = async (plain) => {
    return bcrypt_1.default.hash(plain, 12);
};
exports.hashPassword = hashPassword;
const normalizeAppRole = (role) => {
    const r = role.toLowerCase();
    if (r === 'super_admin' || r === 'superadmin')
        return 'super_admin';
    if (r === 'admin' || r === 'owner')
        return 'admin';
    if (r === 'karyawan' || r === 'staff')
        return 'karyawan';
    return r;
};
exports.normalizeAppRole = normalizeAppRole;
