import { db } from './src/config/db';

async function main() {
  const chartData = await db.$queryRaw`
    SELECT DATE(tgl_order) as date, SUM(total_harga) as revenue, COUNT(*) as orders
    FROM orders
    WHERE tgl_order >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(tgl_order)
    ORDER BY DATE(tgl_order) ASC
  `;
  console.log(chartData);

  const activities = await db.audit_logs.findMany({
    take: 5,
    orderBy: { created_at: 'desc' },
    include: { users: { select: { nama: true, role: true } }, outlets: { select: { nama_outlet: true } }, tenants: { select: { name: true } } }
  });
  console.log(activities);
}
main().catch(console.error).finally(() => process.exit(0));
