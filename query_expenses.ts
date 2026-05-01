import { db } from './src/config/db';
async function main() {
  const expenses = await db.expenses.findMany();
  console.log(JSON.stringify(expenses, null, 2));
}
main().finally(() => db.$disconnect());
