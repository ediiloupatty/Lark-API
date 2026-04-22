import { db } from './src/config/db';

async function main() {
  try {
    const users = await db.users.findMany({
      select: {
        username: true,
        role: true,
        nama: true,
        is_active: true,
        deleted_at: true,
        auth_provider: true,
        google_id: true,
      }
    });
    console.log(JSON.stringify(users, null, 2));
  } catch (error) {
    console.error("Error querying users:", error);
  } finally {
    await db.$disconnect();
    // Need to exit because of the pg pool keeping the process alive
    process.exit(0);
  }
}

main();
