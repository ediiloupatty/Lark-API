import bcrypt from 'bcrypt';
import crypto from 'crypto';

export const isLegacyMd5Hash = (hash: string): boolean => {
  return /^[a-f0-9]{32}$/i.test(hash);
};

export const verifyModernPassword = async (plain: string, storedHash: string): Promise<boolean> => {
  // Check Bcrypt modern format
  if (!isLegacyMd5Hash(storedHash)) {
    return bcrypt.compare(plain, storedHash);
  }

  // Fallback to MD5 logic exactly like PHP
  const hashedPlain = crypto.createHash('md5').update(plain).digest('hex');
  return hashedPlain.toLowerCase() === storedHash.toLowerCase();
};

export const needsPasswordRehashUpgrade = (storedHash: string): boolean => {
  return isLegacyMd5Hash(storedHash);
};

// L-1: Cost factor 12 — industry best practice 2026. Slower brute-force offline.
export const hashPassword = async (plain: string): Promise<string> => {
  return bcrypt.hash(plain, 12);
};

export const normalizeAppRole = (role: string): string => {
  const r = role.toLowerCase();
  if (r === 'super_admin' || r === 'superadmin') return 'super_admin';
  if (r === 'admin' || r === 'owner') return 'admin';
  if (r === 'karyawan' || r === 'staff') return 'karyawan';
  return r;
};
