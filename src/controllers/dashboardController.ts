import { Response } from 'express';
import { db } from '../config/db';
import { AuthRequest } from '../middlewares/authMiddleware';

export const getDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) {
      return res.status(403).json({ status: 'error', message: 'Tenant ID required.' });
    }

    let outletId = req.user?.outlet_id || null;
    const role = req.user?.role || '';
    const isAdmin = role === 'admin' || role === 'super_admin' || role === 'owner';

    if (isAdmin && req.query.oid) {
      const qOid = parseInt(req.query.oid as string);
      if (qOid > 0) outletId = qOid;
    }

    // BUG-30 FIX: Use parameterized queries instead of string interpolation
    // Previously outletId was interpolated directly into SQL strings (`${outletId}`)
    // which violates OWASP prepared statement rules even though parseInt provided mitigation.
    // Now all queries use proper $N parameters.

    // Helper to build parameterized outlet condition
    // Returns { clause, params } where clause is like "AND outlet_id = $2" and params is [outletId]
    const buildOutletCond = (pIdx: number, alias = '') => {
      const col = alias ? `${alias}.outlet_id` : 'outlet_id';
      if (outletId) {
        return { clause: `AND ${col} = $${pIdx}`, params: [outletId], nextIdx: pIdx + 1 };
      }
      return { clause: '', params: [] as any[], nextIdx: pIdx };
    };

    // Resolve tenant timezone — used in all date-aware queries
    // Whitelist to prevent SQL injection since tz is interpolated into SQL strings
    const VALID_TIMEZONES: Record<string, string> = {
      'Asia/Jakarta': 'Asia/Jakarta',     // WIB  (UTC+7)
      'Asia/Makassar': 'Asia/Makassar',   // WITA (UTC+8)
      'Asia/Jayapura': 'Asia/Jayapura',   // WIT  (UTC+9)
    };
    const tenantRow = await db.tenants.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    const tz = VALID_TIMEZONES[tenantRow?.timezone || ''] || 'Asia/Makassar';

    // Fetch outlets list for the selector (only for admins)
    let available_outlets: any[] = [];
    if (isAdmin) {
      available_outlets = await db.$queryRawUnsafe(`SELECT id, nama FROM outlets WHERE tenant_id = $1 ORDER BY nama`, tenantId);
    }

    // 1. Common Statistics
    // Today's Orders
    const oc1 = buildOutletCond(2);
    const todayRes = await db.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 AND (tgl_order AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date ${oc1.clause}`,
      tenantId, ...oc1.params
    );
    const today_count = Number(todayRes[0]?.count || 0);

    // Pending Orders
    const oc2 = buildOutletCond(2);
    const pendingRes = await db.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 AND status = 'menunggu_konfirmasi' ${oc2.clause}`,
      tenantId, ...oc2.params
    );
    const pending_count = Number(pendingRes[0]?.count || 0);

    // 2. Role-Specific Data
    let role_stats: any = {};
    if (isAdmin) {
      const oc3 = buildOutletCond(2);
      const incomeRes = await db.$queryRawUnsafe<any[]>(
        `SELECT SUM(total_harga) as total FROM orders WHERE tenant_id = $1 AND date_trunc('month', tgl_order AT TIME ZONE 'UTC' AT TIME ZONE '${tz}') = date_trunc('month', NOW() AT TIME ZONE '${tz}') AND status != 'dibatalkan' ${oc3.clause}`,
        tenantId, ...oc3.params
      );
      const monthly_income = Number(incomeRes[0]?.total || 0);
      role_stats = {
        title: 'Pendapatan Bulan Ini',
        value: "Rp " + monthly_income.toLocaleString('id-ID'),
        color: '0xFF10B981'
      };
    } else {
      const oc3 = buildOutletCond(2);
      const activeRes = await db.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 AND status IN ('diproses') ${oc3.clause}`,
        tenantId, ...oc3.params
      );
      role_stats = {
        title: 'Sedang Diproses',
        value: Number(activeRes[0]?.count || 0).toString() + " Rak",
        color: '0xFF3B82F6'
      };
    }

    // Ready to pickup
    const oc4 = buildOutletCond(2);
    const readyRes = await db.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 AND status IN ('siap_diambil', 'siap_diantar') ${oc4.clause}`,
      tenantId, ...oc4.params
    );
    const ready_count = Number(readyRes[0]?.count || 0);

    // 3. Revenue Chart Data (Last 7 Days)
    const oc5 = buildOutletCond(2);
    const rawChartData = await db.$queryRawUnsafe<any[]>(`
      SELECT (tgl_order AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date as order_date, SUM(total_harga) as income 
      FROM orders 
      WHERE tenant_id = $1 AND (tgl_order AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date >= (NOW() AT TIME ZONE '${tz}')::date - INTERVAL '7 days' AND status != 'dibatalkan' ${oc5.clause}
      GROUP BY (tgl_order AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date
      ORDER BY (tgl_order AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date ASC
    `, tenantId, ...oc5.params);

    const getTenantDateString = (dateObj: Date): string => {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
      return formatter.format(dateObj);
    };

    const chart_data: any[] = [];
    for (let i = 6; i >= 0; i--) {
      // Create a date object offset by i days from now (in UTC, but it's just for math)
      // Actually, standard JS date math is safe if we format it to the target timezone right after.
      // Wait, 1 day = 86400000 ms. We can just subtract ms to avoid local timezone math issues.
      const d = new Date(Date.now() - i * 86400000);
      const dateStr = getTenantDateString(d);
      
      const found = rawChartData.find((r: any) => {
        if (!r.order_date) return false;
        // In node-postgres, date might be returned as JS Date object
        const rDate = r.order_date instanceof Date ? r.order_date.toISOString().split('T')[0] : String(r.order_date).split('T')[0];
        return rDate === dateStr;
      });

      const dayStr = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, month: '2-digit', day: '2-digit' }).formatToParts(d);
      // formatToParts returns an array of objects like { type: 'month', value: '05' }
      const m = parts.find(p => p.type === 'month')?.value || '00';
      const day = parts.find(p => p.type === 'day')?.value || '00';
      const labelStr = `${day}/${m}`;

      chart_data.push({
        day: dayStr,
        income: found ? Number(found.income || 0) : 0,
        label: labelStr
      });
    }

    // 4. Recent Orders — include all fields required by OrderDao.cacheFromRemote()
    const oc6 = buildOutletCond(2, 'o');
    const recentOrdersRaw = await db.$queryRawUnsafe<any[]>(`
      SELECT o.id, o.client_id, o.server_version, o.tracking_code,
             o.tgl_order, o.updated_at,
             o.total_harga, o.status, o.metode_antar, o.catatan,
             o.outlet_id,
             c.nama as nama_pelanggan, c.no_hp, c.alamat as alamat_pelanggan,
             ot.nama as outlet_nama, ot.alamat as outlet_alamat,
             (SELECT status_pembayaran FROM payments WHERE order_id = o.id LIMIT 1) as status_pembayaran,
             (SELECT metode_pembayaran FROM payments WHERE order_id = o.id LIMIT 1) as metode_bayar
      FROM orders o 
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN outlets ot ON o.outlet_id = ot.id
      WHERE o.tenant_id = $1 ${oc6.clause}
      ORDER BY o.tgl_order DESC 
      LIMIT 20
    `, tenantId, ...oc6.params);

    const formatted_orders = recentOrdersRaw.map((o: any) => ({
      id: o.tracking_code || ('ORD-' + o.id),
      raw_id: o.id,
      customer: o.nama_pelanggan,
      status: o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1).replace(/_/g, ' ') : 'Unknown',
      price: "Rp " + Number(o.total_harga || 0).toLocaleString('id-ID'),
      color: mapStatusToDashColor(o.status),
      status_bayar: o.status_pembayaran ?? 'pending',
    }));

    // -- Additional Web Admin Stats --
    const totCustRes = await db.$queryRawUnsafe<any[]>(`SELECT COUNT(*) as count FROM customers WHERE tenant_id = $1`, tenantId);
    const total_customers = Number(totCustRes[0]?.count || 0);

    const oc7 = buildOutletCond(2);
    const totOrdRes = await db.$queryRawUnsafe<any[]>(`SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 ${oc7.clause}`, tenantId, ...oc7.params);
    const total_orders_count = Number(totOrdRes[0]?.count || 0);

    const oc8 = buildOutletCond(2);
    const selesaiRes = await db.$queryRawUnsafe<any[]>(`SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 AND status = 'selesai' ${oc8.clause}`, tenantId, ...oc8.params);
    const selesai_orders_count = Number(selesaiRes[0]?.count || 0);

    const oc9 = buildOutletCond(2);
    const totRevRes = await db.$queryRawUnsafe<any[]>(`SELECT SUM(total_harga) as total FROM orders WHERE tenant_id = $1 AND status = 'selesai' ${oc9.clause}`, tenantId, ...oc9.params);
    const total_revenue = Number(totRevRes[0]?.total || 0);

    const oc10 = buildOutletCond(2, 'o');
    const payPendRes = await db.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*) as count FROM payments p 
      JOIN orders o ON p.order_id = o.id 
      WHERE p.status_pembayaran = 'pending' AND o.tenant_id = $1 ${oc10.clause}
    `, tenantId, ...oc10.params);
    const pay_pending_count = Number(payPendRes[0]?.count || 0);

    const oc11 = buildOutletCond(2);
    const todayRevRes = await db.$queryRawUnsafe<any[]>(`SELECT SUM(total_harga) as total FROM orders WHERE tenant_id = $1 AND (tgl_order AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date AND status != 'dibatalkan' ${oc11.clause}`, tenantId, ...oc11.params);
    const today_revenue = Number(todayRevRes[0]?.total || 0);

    let status_counts: any = {};
    const statuses = ['menunggu_konfirmasi', 'diproses', 'siap_diambil', 'siap_diantar', 'selesai', 'dibatalkan'];
    // Single query replaces 6 sequential queries
    const oc12 = buildOutletCond(2);
    const scRows = await db.$queryRawUnsafe<any[]>(
      `SELECT status::text, COUNT(*) as count FROM orders WHERE tenant_id = $1 ${oc12.clause} GROUP BY status`,
      tenantId, ...oc12.params
    );
    for (const s of statuses) status_counts[s] = 0;
    for (const r of scRows) status_counts[r.status] = Number(r.count || 0);

    let outlet_rankings: any[] = [];
    if (!outletId && isAdmin) {
      outlet_rankings = await db.$queryRawUnsafe<any[]>(`
        SELECT ot.id, ot.nama,
        (SELECT COUNT(*) FROM orders WHERE outlet_id = ot.id AND (tgl_order AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date) as c_today,
        (SELECT COALESCE(SUM(total_harga), 0) FROM orders WHERE outlet_id = ot.id AND (tgl_order AT TIME ZONE 'UTC' AT TIME ZONE '${tz}')::date = (NOW() AT TIME ZONE '${tz}')::date AND status != 'dibatalkan') as r_today
        FROM outlets ot WHERE ot.tenant_id = $1 ORDER BY r_today DESC NULLS LAST
      `, tenantId);
      
      // Convert largeints/decimals to regular numbers so they map properly
      outlet_rankings = outlet_rankings.map(r => ({
        id: r.id,
        nama: r.nama,
        c_today: Number(r.c_today || 0),
        r_today: Number(r.r_today || 0)
      }));
    }

    let outlet_nama = 'Semua Cabang';
    if (outletId) {
      const otRes = await db.$queryRawUnsafe<any[]>(`SELECT nama FROM outlets WHERE id = $1`, outletId);
      if (otRes.length > 0) outlet_nama = otRes[0].nama;
    }

    // Fetch real full name from DB — JWT only stores username, not nama
    const userId = req.user?.user_id;
    let userNama = req.user?.username || 'User';
    if (userId) {
      const userRow = await db.$queryRawUnsafe<any[]>(`SELECT nama FROM users WHERE id = $1`, userId);
      if (userRow.length > 0 && userRow[0].nama) {
        userNama = userRow[0].nama;
      }
    }

    // Fetch services dan packages untuk di-cache di perangkat mobile
    const servicesRaw = await db.$queryRawUnsafe<any[]>(
      `SELECT s.id, s.nama_layanan as name, s.harga_per_kg as price,
              CONCAT('Rp ', TO_CHAR(s.harga_per_kg, 'FM999,999,999')) as price_formatted,
              s.satuan as unit, COALESCE(s.durasi_jam, s.durasi_hari * 24, 72) as duration,
              s.deskripsi, s.paket_id
       FROM services s
       WHERE s.tenant_id = $1 AND s.is_active = true
       ORDER BY s.id ASC`,
      tenantId
    );
    const packagesRaw = await db.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.nama, p.durasi_jam, p.deskripsi,
              CONCAT(p.durasi_jam, ' Jam') as durasi_label,
              p.is_active as is_available, COALESCE(p.harga_tambahan, 0) as price_tambahan
       FROM paket_laundry p
       WHERE p.tenant_id = $1
       ORDER BY p.durasi_jam ASC`,
      tenantId
    );

    res.json({
      status: 'success',
      message: 'Sync-Dashboard OK.',
      data: {
        stats: {
          today_orders: today_count,
          today_revenue: today_revenue,
          pending_confirmation: pending_count,
          ready_orders: ready_count,
          total_customers: total_customers,
          total_orders: total_orders_count,
          selesai_orders: selesai_orders_count,
          total_revenue: total_revenue,
          pay_pending: pay_pending_count,
          status_counts: status_counts,
          role_highlights: role_stats
        },
        chart_data: chart_data,
        recent_orders: formatted_orders,
        latest_orders_raw: recentOrdersRaw,
        outlet_rankings: outlet_rankings,
        // Catalog untuk di-cache secara proaktif oleh mobile
        services: servicesRaw.map((s: any) => ({
          id: Number(s.id),
          name: s.name,
          price: Number(s.price || 0),
          price_formatted: s.price_formatted,
          unit: s.unit || 'kg',
          duration: Number(s.duration || 72),
          durasi_jam: Number(s.duration || 72),
          deskripsi: s.deskripsi || '',
          paket_id: s.paket_id ? Number(s.paket_id) : null,
        })),
        packages: packagesRaw.map((p: any) => ({
          id: Number(p.id),
          nama: p.nama,
          durasi_jam: Number(p.durasi_jam || 72),
          durasi_label: p.durasi_label,
          deskripsi: p.deskripsi || '',
          is_available: p.is_available ?? true,
          price_tambahan: Number(p.price_tambahan || 0),
        })),
        user: {
          nama: userNama,
          role: role,
          outlet_id: outletId,
          outlet_nama: outlet_nama,
          outlets: available_outlets
        }
      }
    });

  } catch (err: any) {

    console.error('[Dashboard Sync]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memuat dashboard. Silakan coba lagi.' });
  }
};

function mapStatusToDashColor(status: string) {
  switch (status) {
    case 'selesai': return '0xFF10B981';
    case 'diproses': return '0xFF3B82F6';
    case 'siap_diambil':
    case 'siap_diantar': return '0xFF8B5CF6';
    case 'menunggu_konfirmasi': return '0xFFF59E0B';
    default: return '0xFF64748B';
  }
}
