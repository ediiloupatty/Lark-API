/**
 * Seed Super Admin — One-time script
 * 
 * Membuat akun super_admin yang tidak terikat tenant tertentu.
 * Super admin dapat mengakses semua tenant di SysAdmin panel.
 * 
 * Jalankan: npx tsx src/scripts/seed-super-admin.ts
 */

import bcrypt from 'bcrypt';
import { db } from '../config/db';

async function main() {
  const USERNAME = 'ediloupatty';
  const PASSWORD = 'Loupatty143';
  const ROLE = 'super_admin' as const;
  const NAMA = 'Edi Loupatty';

  // 1. Cek apakah username sudah ada
  const existing = await db.users.findUnique({
    where: { username: USERNAME },
  });

  if (existing) {
    console.log(`⚠️  User "${USERNAME}" sudah ada (id=${existing.id}, role=${existing.role}).`);

    // Update ke super_admin jika belum
    if (existing.role !== ROLE) {
      await db.users.update({
        where: { id: existing.id },
        data: {
          role: ROLE,
          password: await bcrypt.hash(PASSWORD, 12),
          is_active: true,
          deleted_at: null,
        },
      });
      console.log(`✅ Role di-upgrade ke "${ROLE}" dan password di-reset.`);
    } else {
      // Update password saja
      await db.users.update({
        where: { id: existing.id },
        data: {
          password: await bcrypt.hash(PASSWORD, 12),
          is_active: true,
          deleted_at: null,
        },
      });
      console.log(`✅ Password di-reset untuk user "${USERNAME}".`);
    }
    return;
  }

  // 2. Hash password dengan bcrypt cost 12
  const hashedPassword = await bcrypt.hash(PASSWORD, 12);

  // 3. Super admin tidak terikat tenant tertentu (tenant_id = null)
  //    Ini memungkinkan akses lintas-tenant di SysAdmin panel
  const user = await db.users.create({
    data: {
      tenant_id: null,
      outlet_id: null,
      username: USERNAME,
      password: hashedPassword,
      role: ROLE,
      nama: NAMA,
      is_active: true,
      permissions: {},
      auth_provider: 'local',
    },
  });

  console.log(`✅ Super Admin berhasil dibuat:`);
  console.log(`   ID       : ${user.id}`);
  console.log(`   Username : ${user.username}`);
  console.log(`   Role     : ${user.role}`);
  console.log(`   Nama     : ${user.nama}`);
}

main()
  .catch((err) => {
    console.error('❌ Gagal membuat super admin:', err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
