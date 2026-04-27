import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import { db } from '../config/db';
import { pool } from '../config/db';

export const getGlobalStats = async (req: AuthRequest, res: Response) => {
  try {
    // Pastikan ini adalah global master admin (role super_admin dan tidak terikat tenant)
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak. Khusus Master Admin.' });
    }

    const totalTenants = await db.tenants.count();
    const totalOrders = await db.orders.count();
    
    const revenueAgg = await db.orders.aggregate({
      _sum: { total_harga: true },
      where: { status: 'selesai' }
    });

    // 1. Dapatkan jumlah blog dari raw PG pool
    let totalBlogs = 0;
    try {
      const blogRes = await pool.query(`SELECT count(*) as count FROM blog_articles WHERE status = 'published'`);
      totalBlogs = parseInt(blogRes.rows[0].count, 10);
    } catch (e) {
      console.warn('Gagal menghitung blogs:', e);
    }

    // 1b. Revenue today vs yesterday comparison
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);

    const [revToday, revYesterday, newTenantsToday] = await Promise.all([
      db.orders.aggregate({ _sum: { total_harga: true }, where: { status: { not: 'dibatalkan' }, tgl_order: { gte: todayStart } } }),
      db.orders.aggregate({ _sum: { total_harga: true }, where: { status: { not: 'dibatalkan' }, tgl_order: { gte: yesterdayStart, lt: todayStart } } }),
      db.tenants.count({ where: { created_at: { gte: todayStart } } }),
    ]);
    const revenueToday = Number((revToday._sum as any).total_harga) || 0;
    const revenueYesterday = Number((revYesterday._sum as any).total_harga) || 0;
    const revenueDelta = revenueYesterday > 0 ? Math.round(((revenueToday - revenueYesterday) / revenueYesterday) * 100) : (revenueToday > 0 ? 100 : 0);

    // 2. Data Chart: Pendapatan & Pesanan 30 hari terakhir (Group By Date)
    const chartDataRaw = await db.$queryRaw`
      SELECT 
        DATE(tgl_order) as date,
        SUM(total_harga) as revenue,
        COUNT(*) as orders
      FROM orders
      WHERE tgl_order >= NOW() - INTERVAL '30 days'
        AND status != 'dibatalkan'
      GROUP BY DATE(tgl_order)
      ORDER BY DATE(tgl_order) ASC
    `;

    const chartData = (chartDataRaw as any[]).map(row => ({
      date: row.date.toISOString().split('T')[0],
      revenue: Number(row.revenue) || 0,
      orders: Number(row.orders) || 0,
    }));

    // 3. Activity Feed: 10 Aktivitas terbaru
    const activities = await db.audit_logs.findMany({
      take: 10,
      orderBy: { created_at: 'desc' },
      include: {
        users: { select: { nama: true, role: true } },
        outlets: { select: { nama: true } },
        tenants: { select: { name: true } }
      }
    });

    // 4. Platform MRR (Monthly Recurring Revenue)
    const mrrRaw = await db.$queryRaw`
      SELECT sum(sp.harga) as mrr
      FROM tenants t
      JOIN subscription_packages sp ON t.subscription_plan = sp.plan_code
      WHERE t.is_active = true AND t.subscription_plan != 'free'
    `;
    const platformMrr = mrrRaw && (mrrRaw as any[])[0]?.mrr ? Number((mrrRaw as any[])[0].mrr) : 0;

    return res.status(200).json({
      success: true,
      data: {
        total_tenants: totalTenants,
        total_orders: totalOrders,
        total_revenue: (revenueAgg._sum as any).total_harga || 0,
        total_blogs: totalBlogs,
        platform_mrr: platformMrr,
        revenue_today: revenueToday,
        revenue_yesterday: revenueYesterday,
        revenue_delta: revenueDelta,
        new_tenants_today: newTenantsToday,
        chart_data: chartData,
        activities: activities
      }
    });
  } catch (error: any) {
    console.error('[SysAdminController] getGlobalStats error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil statistik global.' });
  }
};

export const getTenantsList = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak. Khusus Master Admin.' });
    }

    const tenants = await db.tenants.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        subscription_plan: true,
        subscription_until: true,
        is_active: true,
        created_at: true,
        _count: {
          select: { orders: true, outlets: true }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    return res.status(200).json({
      success: true,
      data: tenants
    });
  } catch (error: any) {
    console.error('[SysAdminController] getTenantsList error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil daftar tenant.' });
  }
};

export const getSystemHealth = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    // Ping Database
    const dbPing = await db.$queryRaw`SELECT 1 as ping`;
    const isDbConnected = Array.isArray(dbPing) && dbPing.length > 0;

    return res.status(200).json({
      success: true,
      data: {
        api_status: 'Online',
        db_connected: isDbConnected,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[SysAdminController] getSystemHealth error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengecek kesehatan sistem.' });
  }
};

export const toggleTenantStatus = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const tenantId = parseInt(req.params.id as string);
    if (isNaN(tenantId)) {
      return res.status(400).json({ success: false, error: 'ID Tenant tidak valid.' });
    }

    const tenant = await db.tenants.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Tenant tidak ditemukan.' });
    }

    const newStatus = !tenant.is_active;

    const updated = await db.tenants.update({
      where: { id: tenantId },
      data: { is_active: newStatus }
    });

    // Catat di audit log
    await db.audit_logs.create({
      data: {
        actor_user_id: req.user.user_id,
        tenant_id: tenantId,
        entity_type: 'tenant',
        entity_id: tenantId,
        action: newStatus ? 'reactivate_tenant' : 'suspend_tenant',
        metadata: { previous_status: tenant.is_active, new_status: newStatus }
      }
    });

    return res.status(200).json({
      success: true,
      message: `Tenant berhasil ${newStatus ? 'diaktifkan' : 'disuspend'}.`,
      data: updated
    });
  } catch (error: any) {
    console.error('[SysAdminController] toggleTenantStatus error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengubah status tenant.' });
  }
};

export const extendSubscription = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const tenantId = parseInt(req.params.id as string);
    if (isNaN(tenantId)) {
      return res.status(400).json({ success: false, error: 'ID Tenant tidak valid.' });
    }

    const tenant = await db.tenants.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Tenant tidak ditemukan.' });
    }

    const currentDate = tenant.subscription_until ? new Date(tenant.subscription_until) : new Date();
    // Jika sudah expired, mulai 30 hari dari hari ini. Jika belum expired, tambah 30 hari dari batas akhir.
    const baseDate = currentDate < new Date() ? new Date() : currentDate;
    const newDate = new Date(baseDate.setDate(baseDate.getDate() + 30));

    const updated = await db.tenants.update({
      where: { id: tenantId },
      data: { subscription_until: newDate }
    });

    await db.audit_logs.create({
      data: {
        actor_user_id: req.user.user_id,
        tenant_id: tenantId,
        entity_type: 'tenant',
        entity_id: tenantId,
        action: 'extend_subscription',
        metadata: { previous_date: tenant.subscription_until, new_date: newDate }
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Langganan berhasil diperpanjang 30 hari.',
      data: updated
    });
  } catch (error: any) {
    console.error('[SysAdminController] extendSubscription error:', error);
    return res.status(500).json({ success: false, error: 'Gagal memperpanjang langganan.' });
  }
};

/* ═══════════════════════════════════════════════════════
   FINANCE & BILLING
═══════════════════════════════════════════════════════ */
export const getFinanceData = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    // Total revenue platform (all tenants, selesai orders)
    const totalRevAgg = await db.orders.aggregate({
      _sum: { total_harga: true },
      where: { status: 'selesai' },
    });
    const totalRevenue = Number((totalRevAgg._sum as any).total_harga) || 0;

    // Revenue this month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthRevAgg = await db.orders.aggregate({
      _sum: { total_harga: true },
      where: { status: 'selesai', tgl_order: { gte: startOfMonth } },
    });
    const monthRevenue = Number((monthRevAgg._sum as any).total_harga) || 0;

    // Payments summary
    const totalPayments = await db.payments.count();
    const lunasPayments = await db.payments.count({ where: { status_pembayaran: 'lunas' } });
    const pendingPayments = await db.payments.count({ where: { status_pembayaran: 'pending' } });

    // Subscription breakdown
    const subBreakdown = await db.tenants.groupBy({
      by: ['subscription_plan'],
      _count: { id: true },
      where: { is_active: true },
    });

    // MRR
    const mrrRaw = await db.$queryRaw`
      SELECT sum(sp.harga) as mrr
      FROM tenants t
      JOIN subscription_packages sp ON t.subscription_plan = sp.plan_code
      WHERE t.is_active = true AND t.subscription_plan != 'free'
    `;
    const platformMrr = mrrRaw && (mrrRaw as any[])[0]?.mrr ? Number((mrrRaw as any[])[0].mrr) : 0;

    // Recent payments (last 20)
    const recentPayments = await db.payments.findMany({
      take: 20,
      orderBy: { created_at: 'desc' },
      include: {
        orders: { select: { kode_pesanan: true, customers: { select: { nama: true } } } },
        tenants: { select: { name: true } },
      },
    });

    // Revenue by tenant (top 10)
    const revenueByTenant = await db.$queryRaw`
      SELECT t.name, SUM(o.total_harga) as revenue, COUNT(o.id) as orders
      FROM orders o
      JOIN tenants t ON o.tenant_id = t.id
      WHERE o.status = 'selesai'
      GROUP BY t.name
      ORDER BY revenue DESC
      LIMIT 10
    `;

    // Revenue trend (daily, last 14 days) for chart
    const revenueTrend = await db.$queryRaw`
      SELECT DATE(tgl_order) as date, SUM(total_harga) as revenue, COUNT(*) as orders
      FROM orders
      WHERE tgl_order >= NOW() - INTERVAL '14 days' AND status != 'dibatalkan'
      GROUP BY DATE(tgl_order)
      ORDER BY date ASC
    `;

    return res.status(200).json({
      success: true,
      data: {
        total_revenue: totalRevenue,
        month_revenue: monthRevenue,
        platform_mrr: platformMrr,
        total_payments: totalPayments,
        lunas_payments: lunasPayments,
        pending_payments: pendingPayments,
        subscription_breakdown: subBreakdown.map((s: any) => ({
          plan: s.subscription_plan,
          count: s._count.id,
        })),
        recent_payments: recentPayments.map((p: any) => ({
          id: p.id,
          tenant: p.tenants?.name || '-',
          customer: p.orders?.customers?.nama || '-',
          kode: p.orders?.kode_pesanan || '-',
          metode: p.metode_pembayaran,
          jumlah: Number(p.jumlah_bayar),
          status: p.status_pembayaran,
          tgl: p.tgl_pembayaran || p.created_at,
        })),
        revenue_by_tenant: (revenueByTenant as any[]).map(r => ({
          name: r.name,
          revenue: Number(r.revenue),
          orders: Number(r.orders),
        })),
        revenue_trend: (revenueTrend as any[]).map(r => ({
          date: r.date.toISOString().split('T')[0],
          revenue: Number(r.revenue) || 0,
          orders: Number(r.orders) || 0,
        })),
      },
    });
  } catch (error: any) {
    console.error('[SysAdminController] getFinanceData error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil data keuangan.' });
  }
};

/* ═══════════════════════════════════════════════════════
   AUDIT LOGS
═══════════════════════════════════════════════════════ */
export const getAuditLogs = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;
    const skip = (page - 1) * limit;
    const actionFilter = req.query.action as string | undefined;

    const whereClause = actionFilter ? { action: actionFilter } : {};

    const [logs, total, actionCounts] = await Promise.all([
      db.audit_logs.findMany({
        where: whereClause,
        take: limit,
        skip,
        orderBy: { created_at: 'desc' },
        include: {
          users: { select: { nama: true, username: true, role: true } },
          tenants: { select: { name: true } },
          outlets: { select: { nama: true } },
        },
      }),
      db.audit_logs.count({ where: whereClause }),
      db.audit_logs.groupBy({ by: ['action'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        logs: logs.map((l: any) => ({
          id: Number(l.id),
          action: l.action,
          entity_type: l.entity_type,
          entity_id: l.entity_id,
          user: l.users?.nama || l.users?.username || 'System',
          user_role: l.users?.role || '-',
          tenant: l.tenants?.name || '-',
          outlet: l.outlets?.nama || null,
          metadata: l.metadata,
          created_at: l.created_at,
        })),
        total,
        page,
        total_pages: Math.ceil(total / limit),
        action_filter: actionFilter || null,
        available_actions: actionCounts.map((a: any) => ({ action: a.action, count: a._count.id })),
      },
    });
  } catch (error: any) {
    console.error('[SysAdminController] getAuditLogs error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil audit logs.' });
  }
};

/* ═══════════════════════════════════════════════════════
   GLOBAL SETTINGS
═══════════════════════════════════════════════════════ */
export const getGlobalSettings = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    // System health
    const dbPing = await db.$queryRaw`SELECT 1 as ping`;
    const isDbConnected = Array.isArray(dbPing) && dbPing.length > 0;

    // Counts
    const totalUsers = await db.users.count();
    const activeUsers = await db.users.count({ where: { is_active: true } });
    const totalTenants = await db.tenants.count();
    const activeTenants = await db.tenants.count({ where: { is_active: true } });
    const totalOrders = await db.orders.count();
    const totalCustomers = await db.customers.count();
    const totalServices = await db.services.count();
    const totalOutlets = await db.outlets.count();

    // Platform growth: new users per month (last 6 months)
    const growthRaw = await db.$queryRaw`
      SELECT
        to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
        COUNT(*) as new_users
      FROM users
      WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY date_trunc('month', created_at)
      ORDER BY month ASC
    `;

    // DB size
    let dbSizeMb = 0;
    try {
      const sizeRes = await db.$queryRaw`SELECT pg_database_size(current_database()) as size`;
      dbSizeMb = Math.round(Number((sizeRes as any[])[0]?.size) / 1024 / 1024);
    } catch (_) {}

    // Subscription packages
    const packages = await db.subscription_packages.findMany({
      orderBy: { harga: 'asc' },
    });

    return res.status(200).json({
      success: true,
      data: {
        system: {
          api_status: 'Online',
          db_connected: isDbConnected,
          node_version: process.version,
          uptime_seconds: Math.floor(process.uptime()),
          memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          timestamp: new Date().toISOString(),
          db_size_mb: dbSizeMb,
          platform: process.platform,
          arch: process.arch,
        },
        counts: {
          total_users: totalUsers,
          active_users: activeUsers,
          total_tenants: totalTenants,
          active_tenants: activeTenants,
          total_orders: totalOrders,
          total_customers: totalCustomers,
          total_services: totalServices,
          total_outlets: totalOutlets,
        },
        subscription_packages: packages.map((p: any) => ({
          id: p.id,
          plan_code: p.plan_code,
          nama_paket: p.nama_paket,
          harga: Number(p.harga),
          badge_label: p.badge_label,
          is_active: p.is_active,
        })),
        platform_growth: (growthRaw as any[]).map(r => ({
          month: r.month,
          new_users: Number(r.new_users),
        })),
      },
    });
  } catch (error: any) {
    console.error('[SysAdminController] getGlobalSettings error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil pengaturan global.' });
  }
};
