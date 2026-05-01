import { db } from './src/config/db';
async function main() {
  const expenses = await db.expenses.findMany({ orderBy: { id: 'desc' }, take: 3 });
  console.log(JSON.stringify(expenses, null, 2));
}
main().finally(() => db.$disconnect());
