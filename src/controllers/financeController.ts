import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';
import { uploadToR2, deleteFromR2, isR2Configured } from '../services/r2Service';

// --- EXPENSES ---
export const getExpenses = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { kategori, bulan, outlet_id } = req.query;

    let where: any = { tenant_id: tenantId };
    if (kategori) where.kategori = kategori as string;
    if (outlet_id) where.outlet_id = parseInt(outlet_id as string);

    // Filter berdasarkan bulan (format: "YYYY-MM")
    if (bulan && typeof bulan === 'string' && /^\d{4}-\d{2}$/.test(bulan)) {
      const [year, month] = bulan.split('-').map(Number);
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1); // 1st of next month
      where.tanggal = {
        gte: startDate,
        lt: endDate,
      };
    }

    const expenses = await db.expenses.findMany({
      where,
      orderBy: { tanggal: 'desc' },
      take: 500, // Raised limit — we now have month filter so results are bounded
    });

    const formatted = expenses.map(e => ({
      ...e,
      jumlah: Number(e.jumlah)
    }));
    
    const total = formatted.reduce((sum, e) => sum + e.jumlah, 0);

    res.json({ status: 'success', data: { expenses: formatted, total } });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Gagal memuat pengeluaran' });
  }
};

export const addExpense = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { kategori, deskripsi, jumlah, tanggal, metode_bayar, outlet_id } = req.body;

    if (!kategori || !jumlah) {
      return res.status(400).json({ status: 'error', message: 'Kategori dan jumlah wajib diisi.' });
    }

    let finalOutletId = outlet_id ? parseInt(outlet_id) : null;
    if (finalOutletId) {
      // [SECURITY FIX] Cross-Tenant Outlet IDOR
      const verifyOutlet = await db.outlets.findFirst({ where: { id: finalOutletId, tenant_id: tenantId as number } });
      if (!verifyOutlet) return res.status(403).json({ status: 'error', message: 'Outlet tidak valid atau tidak dimiliki tenant ini.' });
    }

    // ── Upload bukti pengeluaran ke R2 (opsional) ──────────────────
    let buktiUrl: string | null = null;
    const multerFile = (req as any).file;
    if (multerFile && isR2Configured()) {
      try {
        const expIdentifier = `${kategori.replace(/\s+/g, '-')}-${Date.now()}`;
        buktiUrl = await uploadToR2(multerFile, 'expense', tenantId!, expIdentifier);
      } catch (uploadErr: any) {
        console.error('[AddExpense] R2 upload error (non-fatal):', uploadErr.message);
      }
    }

    const newExpense = await db.expenses.create({
      data: {
        tenant_id: tenantId!,
        kategori,
        deskripsi: deskripsi || '',
        jumlah: parseFloat(jumlah),
        metode_bayar: metode_bayar || 'cash',
        tanggal: new Date(tanggal || Date.now()),
        ...(finalOutletId ? { outlet_id: finalOutletId } : {}),
        ...(buktiUrl ? { bukti_pengeluaran: buktiUrl } : {}),
      }
    });

    res.status(201).json({ 
      status: 'success', 
      message: 'Pengeluaran ditambahkan', 
      data: { ...newExpense, jumlah: Number(newExpense.jumlah) }
    });
  } catch (err: any) {
    console.error('[AddExpense Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menambah pengeluaran' });
  }
};

// PUT /api/v1/expenses  OR  PUT /api/v1/sync/add-expense  (mobile updateExpense)
export const updateExpense = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    const { id, kategori, deskripsi, jumlah, tanggal, metode_bayar, outlet_id } = req.body;

    const expId = parseInt(id || '0');
    if (!expId) return res.status(400).json({ status: 'error', message: 'ID pengeluaran diperlukan.' });
    if (!kategori || !jumlah) return res.status(400).json({ status: 'error', message: 'Kategori dan jumlah wajib diisi.' });

    // Verify ownership
    const existing = await db.expenses.findFirst({ where: { id: expId, tenant_id: tenantId as number } });
    if (!existing) return res.status(404).json({ status: 'error', message: 'Pengeluaran tidak ditemukan.' });

    let finalOutletId = outlet_id ? parseInt(outlet_id) : null;
    if (finalOutletId) {
      // [SECURITY FIX] Cross-Tenant Outlet IDOR
      const verifyOutlet = await db.outlets.findFirst({ where: { id: finalOutletId, tenant_id: tenantId as number } });
      if (!verifyOutlet) return res.status(403).json({ status: 'error', message: 'Outlet tidak valid atau tidak dimiliki tenant ini.' });
    }

    // ── Upload bukti pengeluaran baru ke R2 (opsional) ─────────────
    let buktiUrl: string | undefined = undefined;
    const multerFile = (req as any).file;
    if (multerFile && isR2Configured()) {
      try {
        const expIdentifier = `${(kategori || existing.kategori).replace(/\s+/g, '-')}-${Date.now()}`;
        buktiUrl = await uploadToR2(multerFile, 'expense', tenantId!, expIdentifier);
        // Hapus file lama dari R2 jika ada
        if (existing.bukti_pengeluaran) {
          await deleteFromR2(existing.bukti_pengeluaran);
        }
      } catch (uploadErr: any) {
        console.error('[UpdateExpense] R2 upload error (non-fatal):', uploadErr.message);
      }
    }

    await db.expenses.update({
      where: { id: expId },
      data: {
        kategori,
        deskripsi: deskripsi || '',
        jumlah: parseFloat(jumlah),
        metode_bayar: metode_bayar || 'cash',
        tanggal: new Date(tanggal || existing.tanggal),
        ...(finalOutletId ? { outlet_id: finalOutletId } : {}),
        ...(buktiUrl ? { bukti_pengeluaran: buktiUrl } : {}),
      }
    });

    res.json({ status: 'success', message: 'Pengeluaran diperbarui.' });
  } catch (err: any) {
    console.error('[UpdateExpense Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memperbarui pengeluaran.' });
  }
};

export const deleteExpense = async (req: AuthRequest, res: Response) => {
  try {
    // Support id from body (POST), query string (DELETE ?id=), or body.id
    const idParam = req.body.id || req.query.id;
    const id = parseInt(idParam as string);
    if (!id) return res.status(400).json({ status: 'error', message: 'ID pengeluaran diperlukan.' });

    // Ambil existing untuk hapus file R2 jika ada
    const existing = await db.expenses.findFirst({ where: { id, tenant_id: req.user?.tenant_id as number } });
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Pengeluaran tidak ditemukan.' });
    }

    // Hapus file bukti dari R2 jika ada
    if (existing.bukti_pengeluaran) {
      await deleteFromR2(existing.bukti_pengeluaran);
    }

    await db.expenses.delete({ where: { id } });
    res.json({ status: 'success', message: 'Pengeluaran dihapus' });
  } catch (err: any) {
    console.error('[DeleteExpense Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus pengeluaran' });
  }
};


// --- REPORTS ---
export const getReports = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.status(403).json({ status: 'error', message: 'Tenant required.' });

    const role = req.user?.role || '';
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'owner';

    // Date range: default to current month
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];

    const startDate: string = (req.query.start_date as string) || firstOfMonth;
    const endDate: string   = (req.query.end_date   as string) || todayStr;

    // Outlet filter
    let outletId: number | null = req.user?.outlet_id || null;
    const reqOid = req.query.oid ? parseInt(req.query.oid as string) : null;
    if (reqOid !== null) {
      outletId = reqOid > 0 ? reqOid : null;
    }

    // M-2: Validasi eksplisit — outletId HARUS integer sebelum masuk ke SQL.
    // parseInt() sudah menjamin NaN atau integer, tapi ini defense-in-depth.
    if (outletId !== null && !Number.isInteger(outletId)) {
      outletId = null;
    }

    // SAFETY: outletId di titik ini dijamin null | positive integer (dari parseInt + isInteger check).
    // Interpolasi aman karena integer tidak bisa mengandung karakter SQL injection.
    const outletCond     = outletId ? `AND o.outlet_id = ${outletId}` : '';
    const outletCondPay  = outletId ? `AND COALESCE(p.outlet_id, o.outlet_id) = ${outletId}` : '';
    const outletCondExp  = outletId ? `AND e.outlet_id = ${outletId}` : '';

    // Previous period
    const start = new Date(startDate);
    const end   = new Date(endDate);
    const dayCount = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    const prevEnd   = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - Math.max(dayCount - 1, 0));
    const prevStartStr = prevStart.toISOString().split('T')[0];
    const prevEndStr   = prevEnd.toISOString().split('T')[0];

    // Scope label
    let scopeLabel = 'Semua Outlet';
    if (outletId) {
      const ot = await db.$queryRawUnsafe<any[]>(`SELECT nama FROM outlets WHERE tenant_id = $1 AND id = $2`, tenantId, outletId);
      if (ot.length > 0) scopeLabel = ot[0].nama;
    }

    // --- Summary current period ---
    const summaryRows = await db.$queryRawUnsafe<any[]>(`
      SELECT
        COUNT(o.id) AS total_orders,
        COUNT(CASE WHEN o.status = 'selesai' THEN 1 END) AS completed_orders,
        COUNT(CASE WHEN o.status = 'dibatalkan' THEN 1 END) AS cancelled_orders,
        COUNT(CASE WHEN o.status != 'dibatalkan' THEN 1 END) AS billable_orders,
        COALESCE(SUM(CASE WHEN o.status != 'dibatalkan' THEN o.total_harga ELSE 0 END), 0) AS gross_revenue,
        COUNT(DISTINCT CASE WHEN o.status != 'dibatalkan' THEN o.customer_id END) AS active_customers,
        COUNT(CASE WHEN o.status != 'dibatalkan' AND pay.status_pembayaran = 'lunas' THEN 1 END) AS paid_orders,
        COALESCE(SUM(CASE WHEN o.status != 'dibatalkan' AND pay.status_pembayaran = 'lunas' THEN o.total_harga ELSE 0 END), 0) AS collected_revenue,
        COALESCE(SUM(CASE WHEN o.status != 'dibatalkan' AND (pay.status_pembayaran IS NULL OR pay.status_pembayaran != 'lunas') THEN o.total_harga ELSE 0 END), 0) AS outstanding_revenue
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT p.status_pembayaran FROM payments p WHERE p.order_id = o.id ORDER BY p.id DESC LIMIT 1
      ) pay ON TRUE
      WHERE o.tenant_id = $1 AND DATE(o.tgl_order) BETWEEN $2 AND $3 ${outletCond}
    `, tenantId, startDate, endDate);

    const s = summaryRows[0] || {};
    const grossRevenue      = Number(s.gross_revenue      || 0);
    const billableOrders    = Number(s.billable_orders    || 0);
    const totalOrders       = Number(s.total_orders       || 0);
    const completedOrders   = Number(s.completed_orders   || 0);
    const cancelledOrders   = Number(s.cancelled_orders   || 0);
    const activeCustomers   = Number(s.active_customers   || 0);
    const paidOrders        = Number(s.paid_orders        || 0);
    const collectedRevenue  = Number(s.collected_revenue  || 0);
    const outstandingRevenue= Number(s.outstanding_revenue|| 0);
    const avgTicket         = billableOrders > 0 ? grossRevenue / billableOrders : 0;
    const avgDailyRevenue   = dayCount > 0 ? grossRevenue / dayCount : 0;
    const collectionRate    = grossRevenue > 0 ? (collectedRevenue / grossRevenue) * 100 : 0;
    const completionRate    = billableOrders > 0 ? (completedOrders / billableOrders) * 100 : 0;
    const cancellationRate  = totalOrders > 0 ? (cancelledOrders / totalOrders) * 100 : 0;

    // --- Previous period (for growth %) ---
    const prevRows = await db.$queryRawUnsafe<any[]>(`
      SELECT
        COUNT(CASE WHEN o.status != 'dibatalkan' THEN 1 END) AS billable_orders,
        COALESCE(SUM(CASE WHEN o.status != 'dibatalkan' THEN o.total_harga ELSE 0 END), 0) AS gross_revenue
      FROM orders o
      WHERE o.tenant_id = $1 AND DATE(o.tgl_order) BETWEEN $2 AND $3 ${outletCond}
    `, tenantId, prevStartStr, prevEndStr);

    const prevRevenue = Number(prevRows[0]?.gross_revenue || 0);
    const prevOrders  = Number(prevRows[0]?.billable_orders || 0);
    const revenueGrowthPct = prevRevenue === 0 ? (grossRevenue > 0 ? 100 : 0) : ((grossRevenue - prevRevenue) / prevRevenue) * 100;
    const orderGrowthPct   = prevOrders  === 0 ? (billableOrders > 0 ? 100 : 0) : ((billableOrders - prevOrders) / prevOrders) * 100;

    // --- Expenses ---
    const expRows = await db.$queryRawUnsafe<any[]>(`
      SELECT COALESCE(SUM(jumlah), 0) AS total FROM expenses e
      WHERE e.tenant_id = $1 AND DATE(e.tanggal) BETWEEN $2 AND $3 ${outletCondExp}
    `, tenantId, startDate, endDate);
    const totalExpenses = Number(expRows[0]?.total || 0);

    // --- Status breakdown ---
    const statusRaw = await db.$queryRawUnsafe<any[]>(`
      SELECT o.status, COUNT(*) AS order_count, COALESCE(SUM(o.total_harga), 0) AS total_amount
      FROM orders o
      WHERE o.tenant_id = $1 AND DATE(o.tgl_order) BETWEEN $2 AND $3 ${outletCond}
      GROUP BY o.status
    `, tenantId, startDate, endDate);

    const statusIndex: any = {};
    for (const r of statusRaw) statusIndex[r.status] = r;

    const STATUS_LABELS: Record<string, string> = {
      menunggu_konfirmasi: 'Menunggu Konfirmasi',
      diproses: 'Sedang Diproses',
      siap_diambil: 'Siap Diambil',
      siap_diantar: 'Siap Diantar',
      selesai: 'Selesai',
      dibatalkan: 'Dibatalkan',
    };
    const statusBreakdown = Object.entries(STATUS_LABELS).map(([key, label]) => {
      const r = statusIndex[key];
      const count = Number(r?.order_count || 0);
      return {
        status: key, label,
        order_count: count,
        total_amount: Number(r?.total_amount || 0),
        percentage: totalOrders > 0 ? (count / totalOrders) * 100 : 0,
      };
    });

    // --- Payment breakdown ---
    const payRows = await db.$queryRawUnsafe<any[]>(`
      SELECT COALESCE(pay.status_pembayaran, 'pending') AS payment_status,
             COUNT(o.id) AS order_count,
             COALESCE(SUM(o.total_harga), 0) AS total_amount
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT p.status_pembayaran FROM payments p WHERE p.order_id = o.id ORDER BY p.id DESC LIMIT 1
      ) pay ON TRUE
      WHERE o.tenant_id = $1 AND DATE(o.tgl_order) BETWEEN $2 AND $3
        AND o.status != 'dibatalkan' ${outletCond}
      GROUP BY COALESCE(pay.status_pembayaran, 'pending')
    `, tenantId, startDate, endDate);

    const payIndex: any = {};
    for (const r of payRows) payIndex[r.payment_status] = r;

    const PAYMENT_LABELS: Record<string, string> = { lunas: 'Lunas', pending: 'Belum Lunas', dibatalkan: 'Pembayaran Dibatalkan' };
    const paymentBreakdown = Object.entries(PAYMENT_LABELS).map(([key, label]) => {
      const r = payIndex[key];
      const amount = Number(r?.total_amount || 0);
      return {
        payment_status: key, label,
        order_count: Number(r?.order_count || 0),
        total_amount: amount,
        percentage: grossRevenue > 0 ? (amount / grossRevenue) * 100 : 0,
      };
    });

    // --- Payment methods ---
    const methodRows = await db.$queryRawUnsafe<any[]>(`
      SELECT COALESCE(pay.metode_pembayaran::text, 'belum_dicatat') AS payment_method,
             COUNT(o.id) AS order_count,
             COALESCE(SUM(o.total_harga), 0) AS total_amount
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT p.status_pembayaran, p.metode_pembayaran FROM payments p WHERE p.order_id = o.id ORDER BY p.id DESC LIMIT 1
      ) pay ON TRUE
      WHERE o.tenant_id = $1 AND DATE(o.tgl_order) BETWEEN $2 AND $3
        AND o.status != 'dibatalkan' AND pay.status_pembayaran = 'lunas' ${outletCond}
      GROUP BY COALESCE(pay.metode_pembayaran::text, 'belum_dicatat')
      ORDER BY total_amount DESC LIMIT 5
    `, tenantId, startDate, endDate);

    const paymentMethods = methodRows.map(r => ({
      payment_method: r.payment_method,
      order_count: Number(r.order_count || 0),
      total_amount: Number(r.total_amount || 0),
      percentage: grossRevenue > 0 ? (Number(r.total_amount) / grossRevenue) * 100 : 0,
    }));

    // --- Chart data ---
    const chartRaw = await db.$queryRawUnsafe<any[]>(`
      SELECT DATE(o.tgl_order) AS order_date,
             COUNT(CASE WHEN o.status != 'dibatalkan' THEN 1 END) AS daily_orders,
             COALESCE(SUM(CASE WHEN o.status != 'dibatalkan' THEN o.total_harga ELSE 0 END), 0) AS daily_revenue
      FROM orders o
      WHERE o.tenant_id = $1 AND DATE(o.tgl_order) BETWEEN $2 AND $3 ${outletCond}
      GROUP BY DATE(o.tgl_order)
      ORDER BY DATE(o.tgl_order) ASC
    `, tenantId, startDate, endDate);

    const chartIndex: any = {};
    for (const r of chartRaw) {
      const key = r.order_date instanceof Date ? r.order_date.toISOString().split('T')[0] : String(r.order_date).split('T')[0];
      chartIndex[key] = r;
    }

    const chartData: any[] = [];
    const cursor = new Date(startDate);
    const endCursor = new Date(endDate);
    while (cursor <= endCursor) {
      const key = cursor.toISOString().split('T')[0];
      const r = chartIndex[key];
      chartData.push({ date: key, daily_omzet: Number(r?.daily_revenue || 0), daily_orders: Number(r?.daily_orders || 0) });
      cursor.setDate(cursor.getDate() + 1);
    }

    // --- Top services ---
    const topServices = await db.$queryRawUnsafe<any[]>(`
      SELECT s.nama_layanan, COUNT(od.id) AS count, COALESCE(SUM(od.subtotal), 0) AS total
      FROM order_details od
      JOIN services s ON od.service_id = s.id
      JOIN orders o ON od.order_id = o.id
      WHERE o.tenant_id = $1 AND DATE(o.tgl_order) BETWEEN $2 AND $3 AND o.status != 'dibatalkan' ${outletCond}
      GROUP BY s.nama_layanan ORDER BY total DESC LIMIT 5
    `, tenantId, startDate, endDate);

    // --- Top customers ---
    const topCustomers = await db.$queryRawUnsafe<any[]>(`
      SELECT c.nama, COUNT(o.id) AS count, COALESCE(SUM(o.total_harga), 0) AS total_spent
      FROM orders o JOIN customers c ON o.customer_id = c.id
      WHERE o.tenant_id = $1 AND DATE(o.tgl_order) BETWEEN $2 AND $3 AND o.status != 'dibatalkan' ${outletCond}
      GROUP BY c.nama ORDER BY total_spent DESC LIMIT 5
    `, tenantId, startDate, endDate);

    // --- Top staff ---
    // Primary: staff who confirmed payments (dikonfirmasi_oleh)
    // Fallback: staff by outlet orders processed (when no payment confirmation data yet)
    let topStaff = await db.$queryRawUnsafe<any[]>(`
      SELECT u.nama, COUNT(p.id) AS count, COALESCE(SUM(p.jumlah_bayar), 0) AS total_confirmed
      FROM payments p
      JOIN users u ON p.dikonfirmasi_oleh = u.id
      JOIN orders o ON p.order_id = o.id
      WHERE p.tenant_id = $1
        AND DATE(COALESCE(p.tgl_pembayaran, o.tgl_order)) BETWEEN $2 AND $3
        AND p.status_pembayaran = 'lunas' ${outletCondPay}
      GROUP BY u.nama ORDER BY total_confirmed DESC LIMIT 5
    `, tenantId, startDate, endDate);

    // If no payment confirmation data exists, fall back to staff performance by orders in their outlet
    if (topStaff.length === 0) {
      topStaff = await db.$queryRawUnsafe<any[]>(`
        SELECT u.nama,
               COUNT(DISTINCT o.id) AS count,
               COALESCE(SUM(o.total_harga), 0) AS total_confirmed
        FROM users u
        JOIN outlets ot ON u.outlet_id = ot.id
        JOIN orders o ON o.outlet_id = ot.id
        WHERE u.tenant_id = $1
          AND u.role::text = 'karyawan'
          AND o.status NOT IN ('dibatalkan')
          AND DATE(o.tgl_order) BETWEEN $2 AND $3
          ${outletCond}
        GROUP BY u.nama ORDER BY total_confirmed DESC LIMIT 5
      `, tenantId, startDate, endDate);
    }

    // If still empty (no staff with outlet assignments), show all karyawan at minimum
    if (topStaff.length === 0) {
      topStaff = await db.$queryRawUnsafe<any[]>(`
        SELECT u.nama, 0 AS count, 0 AS total_confirmed
        FROM users u
        WHERE u.tenant_id = $1 AND u.role::text = 'karyawan'
        ORDER BY u.nama LIMIT 5
      `, tenantId);
    }


    // --- Top outlets (admin only) ---
    let topOutlets: any[] = [];
    if (!outletId && isAdmin) {
      topOutlets = await db.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(ot.nama, 'Tanpa Outlet') AS nama_outlet,
               COUNT(o.id) AS order_count, COALESCE(SUM(o.total_harga), 0) AS total_revenue
        FROM orders o LEFT JOIN outlets ot ON o.outlet_id = ot.id
        WHERE o.tenant_id = $1 AND DATE(o.tgl_order) BETWEEN $2 AND $3 AND o.status != 'dibatalkan'
        GROUP BY COALESCE(ot.nama, 'Tanpa Outlet') ORDER BY total_revenue DESC LIMIT 5
      `, tenantId, startDate, endDate);
    }

    res.json({
      status: 'success',
      message: 'Laporan berhasil ditarik.',
      data: {
        meta: {
          start_date: startDate,
          end_date: endDate,
          day_count: dayCount,
          previous_start_date: prevStartStr,
          previous_end_date: prevEndStr,
          scope_label: scopeLabel,
          outlet_id: outletId,
        },
        summary: {
          // Legacy keys for mobile compatibility
          omzet_bulan_ini: grossRevenue,
          total_pesanan_bulan_ini: billableOrders,
          rata_rata_harian: avgDailyRevenue,
          mata_uang: 'Rp',
          // Full metrics
          gross_revenue: grossRevenue,
          billable_orders: billableOrders,
          total_orders: totalOrders,
          completed_orders: completedOrders,
          cancelled_orders: cancelledOrders,
          active_customers: activeCustomers,
          avg_ticket: avgTicket,
          avg_daily_revenue: avgDailyRevenue,
          collected_revenue: collectedRevenue,
          outstanding_revenue: outstandingRevenue,
          total_expenses: totalExpenses,
          collection_rate: collectionRate,
          completion_rate: completionRate,
          cancellation_rate: cancellationRate,
          paid_orders: paidOrders,
          revenue_growth_pct: revenueGrowthPct,
          order_growth_pct: orderGrowthPct,
        },
        status_breakdown: statusBreakdown,
        payment_breakdown: paymentBreakdown,
        payment_methods: paymentMethods,
        top_services: topServices.map(r => ({ nama_layanan: r.nama_layanan, count: Number(r.count), total: Number(r.total) })),
        top_customers: topCustomers.map(r => ({ nama: r.nama, count: Number(r.count), total_spent: Number(r.total_spent) })),
        top_staff: topStaff.map(r => ({ nama: r.nama, count: Number(r.count), total_confirmed: Number(r.total_confirmed) })),
        top_outlets: topOutlets.map(r => ({ nama_outlet: r.nama_outlet, order_count: Number(r.order_count), total_revenue: Number(r.total_revenue) })),
        chart: chartData,
      }
    });
  } catch (err: any) {
    console.error('[GetReports Error]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memuat laporan.' });
  }
};


// --- PAYMENTS ---
export const getPayments = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenant_id;
        const payments = await db.$queryRaw<any[]>`
            SELECT p.id, 
                   CASE WHEN COALESCE(p.jumlah_bayar, 0) = 0 THEN o.total_harga ELSE p.jumlah_bayar END as jumlah_bayar,
                   p.status_pembayaran, p.metode_pembayaran, 
                   COALESCE(p.tgl_pembayaran, p.konfirmasi_pada, o.tgl_order) as tgl_pembayaran,
                   o.tracking_code, c.nama as pelanggan_nama,
                   p.bukti_pembayaran
            FROM payments p
            JOIN orders o ON p.order_id = o.id
            JOIN customers c ON o.customer_id = c.id
            WHERE p.tenant_id = ${tenantId}
            ORDER BY COALESCE(p.tgl_pembayaran, p.created_at) DESC LIMIT 50
        `;
        
        res.json({ 
            status: 'success', 
            data: payments.map(p => ({
                ...p, jumlah_bayar: Number(p.jumlah_bayar)
            }))
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal memuat pembayaran' });
    }
};

export const approvePayment = async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.user?.tenant_id;
        const id = parseInt(req.body.id);
        
        // Fix: also fill jumlah_bayar from order total if it was stored as 0
        await db.$executeRaw`
            UPDATE payments p SET 
              status_pembayaran = 'lunas', 
              tgl_pembayaran = NOW(),
              jumlah_bayar = CASE 
                WHEN COALESCE(p.jumlah_bayar, 0) = 0 
                THEN (SELECT COALESCE(o.total_harga, 0) FROM orders o WHERE o.id = p.order_id)
                ELSE p.jumlah_bayar 
              END
            WHERE p.id = ${id} AND p.tenant_id = ${tenantId}
        `;
        
        res.json({ status: 'success', message: 'Pembayaran Dikonfirmasi Lunas' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Gagal mengonfirmasi pembayaran' });
    }
};
