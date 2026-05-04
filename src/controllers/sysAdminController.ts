import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import { db } from '../config/db';
import { pool } from '../config/db';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { invalidateSubscriptionCache } from '../middlewares/subscriptionGuard';
import { getLatestSnapshot, runHealthCheckWithSnapshot } from '../schedulers/healthMonitor';
import { getErrorStats as getErrorStatsData } from '../middlewares/errorTracker';
import { saveNotification, sendPushToAdmins } from '../services/firebaseService';

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

    // Invalidate subscription cache agar guard langsung reflektif
    invalidateSubscriptionCache(tenantId);

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

/* ═══════════════════════════════════════════════════════
   BLOG/CMS MANAGEMENT
═══════════════════════════════════════════════════════ */

/** GET /sys-admin/blogs — List all blog articles (including drafts), with pagination */
export const listBlogArticlesAdmin = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const search = (req.query.search as string || '').trim();
    const statusFilter = req.query.status as string || '';

    const client = await pool.connect();
    try {
      let whereClause = 'WHERE 1=1';
      const params: any[] = [];
      let paramIdx = 1;

      if (statusFilter) {
        whereClause += ` AND status = $${paramIdx}`;
        params.push(statusFilter);
        paramIdx++;
      }
      if (search) {
        whereClause += ` AND (title ILIKE $${paramIdx} OR slug ILIKE $${paramIdx})`;
        params.push(`%${search}%`);
        paramIdx++;
      }

      const countRes = await client.query(`SELECT count(*) as total FROM blog_articles ${whereClause}`, params);
      const total = parseInt(countRes.rows[0].total, 10);

      const dataRes = await client.query(
        `SELECT id, slug, title, excerpt, category, status, read_time, created_at, updated_at
         FROM blog_articles ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset]
      );

      return res.json({
        success: true,
        data: {
          articles: dataRes.rows,
          total,
          page,
          total_pages: Math.ceil(total / limit),
        },
      });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('[SysAdmin] listBlogArticlesAdmin error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil daftar blog.' });
  }
};

/** POST /sys-admin/blogs — Create a new blog article */
export const createBlogArticle = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const { title, slug, excerpt, content, category, status, read_time } = req.body;

    if (!title || !slug || !excerpt || !content) {
      return res.status(400).json({ success: false, error: 'Title, slug, excerpt, dan content wajib diisi.' });
    }

    // Sanitize slug — hanya izinkan alphanumeric + dash
    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!cleanSlug) {
      return res.status(400).json({ success: false, error: 'Slug tidak valid.' });
    }

    const client = await pool.connect();
    try {
      // Cek slug unik
      const existing = await client.query('SELECT id FROM blog_articles WHERE slug = $1', [cleanSlug]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ success: false, error: `Slug "${cleanSlug}" sudah digunakan.` });
      }

      const result = await client.query(
        `INSERT INTO blog_articles (slug, title, excerpt, content, category, status, read_time, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING id, slug, title, status, created_at`,
        [cleanSlug, title, excerpt, content, category || 'bisnis', status || 'published', read_time || '5 min']
      );

      await db.audit_logs.create({
        data: {
          actor_user_id: req.user.user_id,
          entity_type: 'blog_article',
          entity_id: result.rows[0].id,
          action: 'create_blog',
          metadata: { title, slug: cleanSlug },
        },
      });

      return res.status(201).json({ success: true, message: 'Artikel berhasil dibuat.', data: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('[SysAdmin] createBlogArticle error:', error);
    return res.status(500).json({ success: false, error: 'Gagal membuat artikel.' });
  }
};

/** PUT /sys-admin/blogs/:id — Update a blog article */
export const updateBlogArticle = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const articleId = parseInt(req.params.id as string);
    if (isNaN(articleId)) {
      return res.status(400).json({ success: false, error: 'ID tidak valid.' });
    }

    const { title, slug, excerpt, content, category, status, read_time } = req.body;

    const client = await pool.connect();
    try {
      // Cek artikel ada
      const existing = await client.query('SELECT id FROM blog_articles WHERE id = $1', [articleId]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Artikel tidak ditemukan.' });
      }

      // Jika slug berubah, cek collision
      if (slug) {
        const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const collision = await client.query('SELECT id FROM blog_articles WHERE slug = $1 AND id != $2', [cleanSlug, articleId]);
        if (collision.rows.length > 0) {
          return res.status(409).json({ success: false, error: `Slug "${cleanSlug}" sudah digunakan.` });
        }
      }

      // Build dynamic UPDATE
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (title !== undefined)    { fields.push(`title = $${idx++}`);    values.push(title); }
      if (slug !== undefined)     { fields.push(`slug = $${idx++}`);     values.push(slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')); }
      if (excerpt !== undefined)  { fields.push(`excerpt = $${idx++}`);  values.push(excerpt); }
      if (content !== undefined)  { fields.push(`content = $${idx++}`);  values.push(content); }
      if (category !== undefined) { fields.push(`category = $${idx++}`); values.push(category); }
      if (status !== undefined)   { fields.push(`status = $${idx++}`);   values.push(status); }
      if (read_time !== undefined){ fields.push(`read_time = $${idx++}`);values.push(read_time); }
      fields.push(`updated_at = NOW()`);

      if (fields.length <= 1) {
        return res.status(400).json({ success: false, error: 'Tidak ada field yang diubah.' });
      }

      values.push(articleId);
      await client.query(`UPDATE blog_articles SET ${fields.join(', ')} WHERE id = $${idx}`, values);

      await db.audit_logs.create({
        data: {
          actor_user_id: req.user.user_id,
          entity_type: 'blog_article',
          entity_id: articleId,
          action: 'update_blog',
          metadata: { title, slug },
        },
      });

      return res.json({ success: true, message: 'Artikel berhasil diperbarui.' });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('[SysAdmin] updateBlogArticle error:', error);
    return res.status(500).json({ success: false, error: 'Gagal memperbarui artikel.' });
  }
};

/** DELETE /sys-admin/blogs/:id — Delete a blog article */
export const deleteBlogArticle = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const articleId = parseInt(req.params.id as string);
    if (isNaN(articleId)) {
      return res.status(400).json({ success: false, error: 'ID tidak valid.' });
    }

    const client = await pool.connect();
    try {
      const existing = await client.query('SELECT id, title FROM blog_articles WHERE id = $1', [articleId]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Artikel tidak ditemukan.' });
      }

      await client.query('DELETE FROM blog_articles WHERE id = $1', [articleId]);

      await db.audit_logs.create({
        data: {
          actor_user_id: req.user.user_id,
          entity_type: 'blog_article',
          entity_id: articleId,
          action: 'delete_blog',
          metadata: { title: existing.rows[0].title },
        },
      });

      return res.json({ success: true, message: 'Artikel berhasil dihapus.' });
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('[SysAdmin] deleteBlogArticle error:', error);
    return res.status(500).json({ success: false, error: 'Gagal menghapus artikel.' });
  }
};

/* ═══════════════════════════════════════════════════════
   USER MANAGEMENT
═══════════════════════════════════════════════════════ */

/** GET /sys-admin/users — List all users across all tenants */
export const listAllUsers = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const search = (req.query.search as string || '').trim();
    const roleFilter = req.query.role as string || '';

    const whereClause: any = { deleted_at: null };
    if (roleFilter) whereClause.role = roleFilter as any;
    if (search) {
      whereClause.OR = [
        { nama: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      db.users.findMany({
        where: whereClause,
        take: limit,
        skip,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          username: true,
          nama: true,
          email: true,
          no_hp: true,
          role: true,
          is_active: true,
          auth_provider: true,
          created_at: true,
          tenants: { select: { id: true, name: true } },
          outlets: { select: { id: true, nama: true } },
        },
      }),
      db.users.count({ where: whereClause }),
    ]);

    return res.json({
      success: true,
      data: {
        users: users.map((u: any) => ({
          id: u.id,
          username: u.username,
          nama: u.nama,
          email: u.email,
          no_hp: u.no_hp,
          role: u.role,
          is_active: u.is_active,
          auth_provider: u.auth_provider,
          tenant_name: u.tenants?.name || null,
          tenant_id: u.tenants?.id || null,
          outlet_name: u.outlets?.nama || null,
          created_at: u.created_at,
        })),
        total,
        page,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('[SysAdmin] listAllUsers error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil daftar user.' });
  }
};

/** POST /sys-admin/users/:id/toggle-status — Activate/deactivate a user */
export const toggleUserStatus = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const userId = parseInt(req.params.id as string);
    if (isNaN(userId)) {
      return res.status(400).json({ success: false, error: 'ID tidak valid.' });
    }

    // Jangan izinkan disable diri sendiri
    if (userId === req.user.user_id) {
      return res.status(400).json({ success: false, error: 'Tidak bisa menonaktifkan akun sendiri.' });
    }

    const user = await db.users.findUnique({ where: { id: userId }, select: { id: true, is_active: true, nama: true, role: true } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
    }

    const newStatus = !user.is_active;
    await db.users.update({ where: { id: userId }, data: { is_active: newStatus } });

    await db.audit_logs.create({
      data: {
        actor_user_id: req.user.user_id,
        entity_type: 'user',
        entity_id: userId,
        action: newStatus ? 'reactivate_user' : 'deactivate_user',
        metadata: { user_name: user.nama, user_role: user.role },
      },
    });

    return res.json({ success: true, message: `User berhasil ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}.` });
  } catch (error: any) {
    console.error('[SysAdmin] toggleUserStatus error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengubah status user.' });
  }
};

/** POST /sys-admin/users/:id/reset-password — Reset user password to a random string */
export const resetUserPassword = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const userId = parseInt(req.params.id as string);
    if (isNaN(userId)) {
      return res.status(400).json({ success: false, error: 'ID tidak valid.' });
    }

    const user = await db.users.findUnique({ where: { id: userId }, select: { id: true, nama: true, auth_provider: true } });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan.' });
    }

    if (user.auth_provider === 'google') {
      return res.status(400).json({ success: false, error: 'User login via Google — tidak bisa reset password manual.' });
    }

    // Generate random password 12 chars
    const newPassword = crypto.randomBytes(6).toString('hex');
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await db.users.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        token_version: { increment: 1 }, // Invalidate semua JWT lama
      },
    });

    await db.audit_logs.create({
      data: {
        actor_user_id: req.user.user_id,
        entity_type: 'user',
        entity_id: userId,
        action: 'reset_user_password',
        metadata: { user_name: user.nama },
      },
    });

    return res.json({
      success: true,
      message: 'Password berhasil direset.',
      data: { new_password: newPassword },
    });
  } catch (error: any) {
    console.error('[SysAdmin] resetUserPassword error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mereset password.' });
  }
};

/* ═══════════════════════════════════════════════════════
   TENANT DETAIL VIEW
═══════════════════════════════════════════════════════ */

/** GET /sys-admin/tenants/:id/detail — Deep-dive into a specific tenant */
export const getTenantDetail = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const tenantId = parseInt(req.params.id as string);
    if (isNaN(tenantId)) {
      return res.status(400).json({ success: false, error: 'ID tidak valid.' });
    }

    const tenant = await db.tenants.findUnique({
      where: { id: tenantId },
      select: {
        id: true, name: true, slug: true, address: true, phone: true, email: true,
        logo: true, subscription_plan: true, subscription_until: true, is_active: true,
        timezone: true, created_at: true, updated_at: true,
      },
    });

    if (!tenant) {
      return res.status(404).json({ success: false, error: 'Tenant tidak ditemukan.' });
    }

    // Stats
    const [totalOrders, totalCustomers, totalStaff, totalOutlets, revenueAgg] = await Promise.all([
      db.orders.count({ where: { tenant_id: tenantId } }),
      db.customers.count({ where: { tenant_id: tenantId, deleted_at: null } }),
      db.users.count({ where: { tenant_id: tenantId, deleted_at: null } }),
      db.outlets.count({ where: { tenant_id: tenantId } }),
      db.orders.aggregate({ _sum: { total_harga: true }, where: { tenant_id: tenantId, status: 'selesai' } }),
    ]);

    // Recent orders (10)
    const recentOrders = await db.orders.findMany({
      where: { tenant_id: tenantId },
      take: 10,
      orderBy: { created_at: 'desc' },
      select: {
        id: true, kode_pesanan: true, total_harga: true, status: true, tgl_order: true,
        customers: { select: { nama: true } },
      },
    });

    // Staff list
    const staffList = await db.users.findMany({
      where: { tenant_id: tenantId, deleted_at: null },
      select: { id: true, nama: true, username: true, role: true, is_active: true, email: true, created_at: true },
      orderBy: { created_at: 'desc' },
    });

    // Outlets
    const outletList = await db.outlets.findMany({
      where: { tenant_id: tenantId },
      select: { id: true, nama: true, alamat: true, phone: true, is_active: true },
    });

    return res.json({
      success: true,
      data: {
        ...tenant,
        stats: {
          total_orders: totalOrders,
          total_customers: totalCustomers,
          total_staff: totalStaff,
          total_outlets: totalOutlets,
          total_revenue: Number((revenueAgg._sum as any).total_harga) || 0,
        },
        recent_orders: recentOrders.map((o: any) => ({
          id: o.id,
          kode: o.kode_pesanan,
          total: Number(o.total_harga),
          status: o.status,
          tanggal: o.tgl_order,
          pelanggan: o.customers?.nama || '-',
        })),
        staff: staffList,
        outlets: outletList,
      },
    });
  } catch (error: any) {
    console.error('[SysAdmin] getTenantDetail error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil detail tenant.' });
  }
};

/* ═══════════════════════════════════════════════════════
   MAINTENANCE MODE TOGGLE
═══════════════════════════════════════════════════════ */

// Runtime maintenance state — digunakan oleh maintenanceMiddleware.
// PERSISTED: State disimpan ke file agar survive PM2 restart / server crash.
// Maintenance tetap aktif sampai super admin nonaktifkan secara eksplisit.
import fs from 'fs';
import path from 'path';

const MAINTENANCE_FILE = path.join(__dirname, '../../.maintenance-state.json');

interface MaintenanceState {
  enabled: boolean;
  message: string;
  estimatedEnd: string | null;
}

function loadMaintenanceState(): MaintenanceState {
  try {
    if (fs.existsSync(MAINTENANCE_FILE)) {
      const raw = fs.readFileSync(MAINTENANCE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      console.log(`[Maintenance] State restored from disk: ${parsed.enabled ? 'AKTIF' : 'NONAKTIF'}`);
      return {
        enabled: !!parsed.enabled,
        message: parsed.message || '',
        estimatedEnd: parsed.estimatedEnd || null,
      };
    }
  } catch (err) {
    console.error('[Maintenance] Failed to read state file, starting with default:', err);
  }
  return { enabled: false, message: '', estimatedEnd: null };
}

function saveMaintenanceState(state: MaintenanceState): void {
  try {
    fs.writeFileSync(MAINTENANCE_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Maintenance] Failed to save state file:', err);
  }
}

// Load state dari disk saat server start
export const maintenanceState = loadMaintenanceState();

/** GET /sys-admin/maintenance — Get current maintenance status */
export const getMaintenanceStatus = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    // Runtime state OR env variable (whichever is active)
    const isActive = maintenanceState.enabled || process.env.MAINTENANCE_MODE === 'true';

    return res.json({
      success: true,
      data: {
        enabled: isActive,
        message: maintenanceState.message || process.env.MAINTENANCE_MSG || '',
        estimated_end: maintenanceState.estimatedEnd || process.env.MAINTENANCE_UNTIL || null,
        source: maintenanceState.enabled ? 'runtime' : (process.env.MAINTENANCE_MODE === 'true' ? 'env' : 'off'),
      },
    });
  } catch (error: any) {
    console.error('[SysAdmin] getMaintenanceStatus error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil status maintenance.' });
  }
};

/** POST /sys-admin/maintenance/toggle — Toggle maintenance mode ON/OFF */
export const toggleMaintenanceMode = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const { enabled, message, estimated_end } = req.body;

    maintenanceState.enabled = !!enabled;
    maintenanceState.message = message || 'Sistem sedang dalam pemeliharaan terjadwal.';
    maintenanceState.estimatedEnd = estimated_end || null;

    // Persist ke disk agar survive PM2 restart / server crash
    saveMaintenanceState(maintenanceState);

    await db.audit_logs.create({
      data: {
        actor_user_id: req.user.user_id,
        entity_type: 'system',
        action: enabled ? 'enable_maintenance' : 'disable_maintenance',
        metadata: { message: maintenanceState.message, estimated_end: maintenanceState.estimatedEnd },
      },
    });

    return res.json({
      success: true,
      message: `Maintenance mode ${maintenanceState.enabled ? 'AKTIF' : 'NONAKTIF'}.`,
      data: {
        enabled: maintenanceState.enabled,
        message: maintenanceState.message,
        estimated_end: maintenanceState.estimatedEnd,
      },
    });
  } catch (error: any) {
    console.error('[SysAdmin] toggleMaintenanceMode error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengubah status maintenance.' });
  }
};

/* ═══════════════════════════════════════════════════════
   SYSTEM HEALTH MONITORING ENDPOINTS
═══════════════════════════════════════════════════════ */

/**
 * GET /sys-admin/alerts
 *
 * Mengambil daftar system alerts (notifikasi tipe 'system_alert').
 * Query params: page, limit, unread_only
 * Response: { alerts, unread_count, total, page, total_pages }
 */
export const getSystemAlerts = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const userId = req.user.user_id;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const unreadOnly = req.query.unread_only === 'true';
    const offset = (page - 1) * limit;

    // Count unread alerts (selalu dihitung untuk badge)
    const unreadCount = await db.notifications.count({
      where: { user_id: userId, tipe: 'system_alert', is_read: false },
    });

    // Build where clause
    const whereClause: any = { user_id: userId, tipe: 'system_alert' };
    if (unreadOnly) whereClause.is_read = false;

    const [alerts, total] = await Promise.all([
      db.notifications.findMany({
        where: whereClause,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: limit,
      }),
      db.notifications.count({ where: whereClause }),
    ]);

    return res.json({
      success: true,
      data: {
        alerts: alerts.map(a => ({
          id: a.id,
          pesan: a.pesan,
          is_read: a.is_read,
          created_at: a.created_at,
        })),
        unread_count: unreadCount,
        total,
        page,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    console.error('[SysAdmin] getSystemAlerts error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil system alerts.' });
  }
};

/**
 * POST /sys-admin/alerts/read
 *
 * Menandai alert sebagai sudah dibaca.
 * Body: { alert_ids?: number[], mark_all?: boolean }
 */
export const markAlertsRead = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const userId = req.user.user_id;
    const { alert_ids, mark_all } = req.body;

    if (mark_all) {
      // Mark semua system_alert milik user ini
      await db.notifications.updateMany({
        where: { user_id: userId, tipe: 'system_alert', is_read: false },
        data: { is_read: true },
      });
    } else if (Array.isArray(alert_ids) && alert_ids.length > 0) {
      // Mark specific alerts — validasi ownership via user_id
      const validIds = alert_ids.map((id: any) => parseInt(id)).filter((id: number) => !isNaN(id));
      if (validIds.length > 0) {
        await db.notifications.updateMany({
          where: {
            id: { in: validIds },
            user_id: userId,
            tipe: 'system_alert',
          },
          data: { is_read: true },
        });
      }
    } else {
      return res.status(400).json({ success: false, error: 'Kirim alert_ids (array) atau mark_all: true.' });
    }

    return res.json({ success: true, message: 'Alert berhasil ditandai telah dibaca.' });
  } catch (error: any) {
    console.error('[SysAdmin] markAlertsRead error:', error);
    return res.status(500).json({ success: false, error: 'Gagal menandai alerts.' });
  }
};

/**
 * GET /sys-admin/health-snapshot
 *
 * Return real-time health snapshot (atau snapshot terakhir jika ada).
 * Data: DB status, memory, frontend, uptime, pool stats.
 */
export const getHealthSnapshot = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    // Jika query param fresh=true, jalankan check baru (max 1x per 30 detik)
    const wantFresh = req.query.fresh === 'true';
    let snapshot = getLatestSnapshot();

    if (wantFresh || !snapshot) {
      snapshot = await runHealthCheckWithSnapshot();
    }

    return res.json({
      success: true,
      data: snapshot,
    });
  } catch (error: any) {
    console.error('[SysAdmin] getHealthSnapshot error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil health snapshot.' });
  }
};

/**
 * GET /sys-admin/error-stats
 *
 * Return API error tracking data dari in-memory ring buffer.
 * Data: recent errors, error rate per minute, top endpoints, breakdown by status code & platform.
 */
export const getApiErrorStats = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const stats = getErrorStatsData();
    return res.json({ success: true, data: stats });
  } catch (error: any) {
    console.error('[SysAdmin] getApiErrorStats error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil error stats.' });
  }
};

/* ═══════════════════════════════════════════════════════
   FITUR 1: BROADCAST NOTIFICATION ke Tenants
═══════════════════════════════════════════════════════ */
export const broadcastNotification = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const { title, message, target, tenant_ids } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Pesan tidak boleh kosong.' });
    }

    // Tentukan target tenants
    let targetTenants: { id: number; name: string }[];
    if (target === 'selected' && Array.isArray(tenant_ids) && tenant_ids.length > 0) {
      targetTenants = await db.tenants.findMany({
        where: { id: { in: tenant_ids.map(Number) }, is_active: true },
        select: { id: true, name: true },
      });
    } else {
      // Default: semua tenant aktif
      targetTenants = await db.tenants.findMany({
        where: { is_active: true },
        select: { id: true, name: true },
      });
    }

    if (targetTenants.length === 0) {
      return res.status(400).json({ success: false, error: 'Tidak ada tenant yang ditargetkan.' });
    }

    // Cari semua admin user di tenant-tenant tersebut
    const adminUsers = await db.users.findMany({
      where: {
        tenant_id: { in: targetTenants.map(t => t.id) },
        role: { in: ['admin', 'owner'] },
        is_active: true,
        deleted_at: null,
      },
      select: { id: true, tenant_id: true },
    });

    const pesan = title ? `📢 ${title}: ${message}` : `📢 ${message}`;

    // Simpan notifikasi ke setiap admin
    let notifCount = 0;
    for (const user of adminUsers) {
      await saveNotification({
        tenantId: user.tenant_id,
        userId: user.id,
        tipe: 'broadcast',
        pesan,
      });
      notifCount++;
    }

    // Push notification ke semua targeted tenants
    for (const tenant of targetTenants) {
      await sendPushToAdmins({
        tenantId: tenant.id,
        title: title || '📢 Pengumuman Lark Laundry',
        body: message,
        data: { type: 'broadcast' },
      }).catch(() => { /* skip push errors */ });
    }

    // Audit log
    await db.audit_logs.create({
      data: {
        actor_user_id: req.user.user_id,
        entity_type: 'broadcast',
        action: 'send_broadcast',
        metadata: {
          title, message,
          target: target || 'all',
          tenant_count: targetTenants.length,
          notif_count: notifCount,
        },
      },
    }).catch(() => {});

    return res.json({
      success: true,
      data: {
        tenants_reached: targetTenants.length,
        notifications_sent: notifCount,
        tenant_names: targetTenants.map(t => t.name),
      },
    });
  } catch (error: any) {
    console.error('[SysAdmin] broadcastNotification error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengirim broadcast.' });
  }
};

/* ═══════════════════════════════════════════════════════
   FITUR 2: SUBSCRIPTION EXPIRY ALERT
═══════════════════════════════════════════════════════ */
export const getExpiringSubscriptions = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const daysThreshold = parseInt(req.query.days as string) || 7;
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);

    const expiringTenants = await db.tenants.findMany({
      where: {
        is_active: true,
        subscription_plan: { not: 'free' },
        subscription_until: { lte: thresholdDate, gte: new Date() },
      },
      select: {
        id: true, name: true, slug: true, email: true, phone: true,
        subscription_plan: true, subscription_until: true,
        _count: { select: { orders: true, users: true } },
      },
      orderBy: { subscription_until: 'asc' },
    });

    // Juga ambil yang sudah expired (belum dinonaktifkan)
    const expiredTenants = await db.tenants.findMany({
      where: {
        is_active: true,
        subscription_plan: { not: 'free' },
        subscription_until: { lt: new Date() },
      },
      select: {
        id: true, name: true, slug: true, email: true,
        subscription_plan: true, subscription_until: true,
      },
      orderBy: { subscription_until: 'asc' },
    });

    return res.json({
      success: true,
      data: {
        expiring: expiringTenants.map(t => ({
          ...t,
          days_remaining: Math.ceil((new Date(t.subscription_until!).getTime() - Date.now()) / 86400000),
        })),
        expired: expiredTenants.map(t => ({
          ...t,
          days_overdue: Math.ceil((Date.now() - new Date(t.subscription_until!).getTime()) / 86400000),
        })),
        summary: {
          expiring_count: expiringTenants.length,
          expired_count: expiredTenants.length,
          threshold_days: daysThreshold,
        },
      },
    });
  } catch (error: any) {
    console.error('[SysAdmin] getExpiringSubscriptions error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil data subscription.' });
  }
};

/* ═══════════════════════════════════════════════════════
   FITUR 3: EXPORT DATA (CSV)
═══════════════════════════════════════════════════════ */
export const exportData = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const type = req.query.type as string; // 'tenants' | 'audit' | 'finance'

    if (type === 'tenants') {
      const tenants = await db.tenants.findMany({
        select: {
          id: true, name: true, slug: true, email: true, phone: true,
          subscription_plan: true, subscription_until: true, is_active: true, created_at: true,
          _count: { select: { orders: true, outlets: true, users: true } },
        },
        orderBy: { created_at: 'desc' },
      });

      const csvHeader = 'ID,Nama,Slug,Email,Phone,Plan,Subscription Until,Active,Orders,Outlets,Users,Created At\n';
      const csvRows = tenants.map(t =>
        `${t.id},"${t.name}","${t.slug}","${t.email || ''}","${t.phone || ''}",${t.subscription_plan},${t.subscription_until ? new Date(t.subscription_until).toLocaleDateString('id-ID') : '-'},${t.is_active},${t._count.orders},${t._count.outlets},${t._count.users},${t.created_at ? new Date(t.created_at).toLocaleDateString('id-ID') : '-'}`
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="tenants_export_${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send('\uFEFF' + csvHeader + csvRows); // BOM for Excel

    } else if (type === 'audit') {
      const logs = await db.audit_logs.findMany({
        take: 1000,
        orderBy: { created_at: 'desc' },
        include: {
          users: { select: { nama: true, role: true } },
          tenants: { select: { name: true } },
        },
      });

      const csvHeader = 'ID,Waktu,User,Role,Tenant,Entity,Action,Detail\n';
      const csvRows = logs.map(l =>
        `${l.id},${l.created_at ? new Date(l.created_at).toLocaleString('id-ID') : '-'},"${l.users?.nama || '-'}",${l.users?.role || '-'},"${l.tenants?.name || 'System'}","${l.entity_type}","${l.action}","${JSON.stringify(l.metadata || {}).replace(/"/g, '""').slice(0, 200)}"`
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send('\uFEFF' + csvHeader + csvRows);

    } else if (type === 'finance') {
      const financeRaw = await db.$queryRaw`
        SELECT
          t.id as tenant_id, t.name as tenant_name, t.subscription_plan,
          COUNT(o.id) as total_orders,
          SUM(CASE WHEN o.status = 'selesai' THEN o.total_harga ELSE 0 END) as total_revenue,
          SUM(CASE WHEN o.status = 'selesai' AND o.tgl_order >= NOW() - INTERVAL '30 days' THEN o.total_harga ELSE 0 END) as revenue_30d
        FROM tenants t
        LEFT JOIN orders o ON o.tenant_id = t.id
        WHERE t.is_active = true
        GROUP BY t.id, t.name, t.subscription_plan
        ORDER BY total_revenue DESC
      `;

      const csvHeader = 'Tenant ID,Nama Tenant,Plan,Total Orders,Total Revenue,Revenue 30 Hari\n';
      const csvRows = (financeRaw as any[]).map(r =>
        `${r.tenant_id},"${r.tenant_name}",${r.subscription_plan},${r.total_orders},${Number(r.total_revenue) || 0},${Number(r.revenue_30d) || 0}`
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="finance_export_${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send('\uFEFF' + csvHeader + csvRows);
    }

    return res.status(400).json({ success: false, error: 'Tipe export tidak valid. Gunakan: tenants, audit, finance' });
  } catch (error: any) {
    console.error('[SysAdmin] exportData error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengekspor data.' });
  }
};

/* ═══════════════════════════════════════════════════════
   FITUR 4: TENANT REVENUE RANKING
═══════════════════════════════════════════════════════ */
export const getTenantRevenueRanking = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    const period = (req.query.period as string) || '30d'; // '7d', '30d', '90d', 'all'
    let interval = "30 days";
    if (period === '7d') interval = "7 days";
    else if (period === '90d') interval = "90 days";
    else if (period === 'all') interval = "10 years";

    const rankingRaw = await pool.query(`
      SELECT
        t.id, t.name, t.slug, t.subscription_plan, t.is_active,
        COUNT(o.id) as total_orders,
        COALESCE(SUM(CASE WHEN o.status = 'selesai' THEN o.total_harga ELSE 0 END), 0) as total_revenue,
        COUNT(DISTINCT DATE(o.tgl_order)) as active_days,
        MAX(o.tgl_order) as last_order_date
      FROM tenants t
      LEFT JOIN orders o ON o.tenant_id = t.id
        AND o.tgl_order >= NOW() - INTERVAL '${interval}'
      GROUP BY t.id, t.name, t.slug, t.subscription_plan, t.is_active
      ORDER BY total_revenue DESC
    `);

    const ranking = rankingRaw.rows.map((r: any, idx: number) => ({
      rank: idx + 1,
      id: r.id,
      name: r.name,
      slug: r.slug,
      plan: r.subscription_plan,
      is_active: r.is_active,
      total_orders: parseInt(r.total_orders) || 0,
      total_revenue: parseFloat(r.total_revenue) || 0,
      active_days: parseInt(r.active_days) || 0,
      last_order_date: r.last_order_date,
      avg_daily_revenue: r.active_days > 0 ? Math.round(parseFloat(r.total_revenue) / parseInt(r.active_days)) : 0,
    }));

    // Summary stats
    const totalPlatformRevenue = ranking.reduce((s: number, r: any) => s + r.total_revenue, 0);
    const totalPlatformOrders = ranking.reduce((s: number, r: any) => s + r.total_orders, 0);

    return res.json({
      success: true,
      data: {
        period,
        ranking,
        summary: {
          total_tenants: ranking.length,
          active_tenants: ranking.filter((r: any) => r.total_orders > 0).length,
          total_platform_revenue: totalPlatformRevenue,
          total_platform_orders: totalPlatformOrders,
        },
      },
    });
  } catch (error: any) {
    console.error('[SysAdmin] getTenantRevenueRanking error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil ranking revenue.' });
  }
};

/* ═══════════════════════════════════════════════════════
   FITUR 5: DB BACKUP STATUS
═══════════════════════════════════════════════════════ */
export const getBackupStatus = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Akses ditolak.' });
    }

    // Cek file log backup
    const fs = await import('fs/promises');
    const logPath = '/var/log/lark-backup.log';
    let lastBackup = null;
    let backupEntries: { timestamp: string; status: string; size?: string; message: string }[] = [];

    try {
      const logContent = await fs.readFile(logPath, 'utf-8');
      const lines = logContent.trim().split('\n').filter(Boolean);
      const recentLines = lines.slice(-20); // Last 20 lines

      for (const line of recentLines) {
        const isSuccess = line.toLowerCase().includes('success') || line.toLowerCase().includes('uploaded') || line.toLowerCase().includes('selesai');
        const isError = line.toLowerCase().includes('error') || line.toLowerCase().includes('gagal') || line.toLowerCase().includes('fail');

        // Try extract timestamp from typical log format
        const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2})/);
        const sizeMatch = line.match(/(\d+\.?\d*\s?[KMGT]?B)/i);

        backupEntries.push({
          timestamp: tsMatch ? tsMatch[1] : new Date().toISOString().slice(0, 16),
          status: isError ? 'error' : isSuccess ? 'success' : 'info',
          size: sizeMatch ? sizeMatch[1] : undefined,
          message: line.slice(0, 200),
        });
      }

      // Determine last successful backup
      const lastSuccess = backupEntries.filter(e => e.status === 'success').pop();
      lastBackup = lastSuccess?.timestamp || null;
    } catch {
      // Log file not found — backup mungkin belum pernah jalan atau log di-rotate
    }

    // Cek ukuran database aktual
    let dbSizeMb = 0;
    try {
      const dbSizeResult = await pool.query(`SELECT pg_database_size(current_database()) as size`);
      dbSizeMb = Math.round(parseInt(dbSizeResult.rows[0].size) / (1024 * 1024));
    } catch { /* skip */ }

    // Cek crontab schedule
    let cronSchedule = 'Unknown';
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      const crontab = await execAsync('crontab -l 2>/dev/null | grep lark-db-backup || echo "not_found"');
      if (crontab.stdout.includes('lark-db-backup')) {
        cronSchedule = crontab.stdout.trim();
      } else {
        cronSchedule = 'Not scheduled';
      }
    } catch {
      cronSchedule = 'Unable to check';
    }

    return res.json({
      success: true,
      data: {
        last_backup: lastBackup,
        db_size_mb: dbSizeMb,
        cron_schedule: cronSchedule,
        recent_entries: backupEntries.slice(-10).reverse(),
        backup_destination: 'R2 Cloudflare',
        backup_script: '/usr/local/bin/lark-db-backup.sh',
      },
    });
  } catch (error: any) {
    console.error('[SysAdmin] getBackupStatus error:', error);
    return res.status(500).json({ success: false, error: 'Gagal mengambil status backup.' });
  }
};
