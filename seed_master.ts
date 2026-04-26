import { db } from './src/config/db';
import bcrypt from 'bcrypt';

async function main() {
  const email = 'master@larklaundry.com';
  const username = 'masteradmin';
  const passwordHash = await bcrypt.hash('LarkAdmin123!', 10);

  const existing = await db.users.findUnique({
    where: { username }
  });

  if (existing) {
    console.log('Master Admin already exists.');
    return;
  }

  const user = await db.users.create({
    data: {
      username: username,
      email: email,
      nama: 'Edi Loupatty',
      role: 'super_admin',
      password: passwordHash,
      is_active: true,
      permissions: {},
      // tenant_id sengaja TIDAK diset (null)
    }
  });

  console.log('Successfully created Master Admin:', user.username);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
