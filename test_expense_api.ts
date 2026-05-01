import { db } from './src/config/db';

async function main() {
  const [year, month] = '2026-05'.split('-').map(Number);
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1); 

  console.log("StartDate:", startDate.toISOString());
  console.log("EndDate:", endDate.toISOString());

  const expenses = await db.expenses.findMany({
    where: {
      tanggal: {
        gte: startDate,
        lt: endDate,
      }
    }
  });
  console.log("Found expenses for 2026-05:", expenses.length);

  // Also try 2026-04
  const startDate4 = new Date(2026, 3, 1);
  const endDate4 = new Date(2026, 4, 1);
  const expenses4 = await db.expenses.findMany({
    where: {
      tanggal: {
        gte: startDate4,
        lt: endDate4,
      }
    }
  });
  console.log("Found expenses for 2026-04:", expenses4.length);
}
main().finally(() => db.$disconnect());
