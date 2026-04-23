"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboard = void 0;
const db_1 = require("../config/db");
const getDashboard = async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id;
        if (!tenantId) {
            return res.status(403).json({ status: 'error', message: 'Tenant ID required.' });
        }
        let outletId = req.user?.outlet_id || null;
        const role = req.user?.role || '';
        const isAdmin = role === 'admin' || role === 'super_admin' || role === 'owner';
        if (isAdmin && req.query.oid) {
            const qOid = parseInt(req.query.oid);
            if (qOid > 0)
                outletId = qOid;
        }
        // Build outlet condition snippet for raw queries
        const outletCondRaw = outletId ? `AND outlet_id = ${outletId}` : '';
        const outletCondRawOrders = outletId ? `AND o.outlet_id = ${outletId}` : '';
        // Fetch outlets list for the selector (only for admins)
        let available_outlets = [];
        if (isAdmin) {
            available_outlets = await db_1.db.$queryRawUnsafe(`SELECT id, nama FROM outlets WHERE tenant_id = $1 ORDER BY nama`, tenantId);
        }
        // 1. Common Statistics
        // Today's Orders
        const todayRes = await db_1.db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 AND date(tgl_order) = CURRENT_DATE ${outletCondRaw}`, tenantId);
        const today_count = Number(todayRes[0]?.count || 0);
        // Pending Orders
        const pendingRes = await db_1.db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 AND status = 'menunggu_konfirmasi' ${outletCondRaw}`, tenantId);
        const pending_count = Number(pendingRes[0]?.count || 0);
        // 2. Role-Specific Data
        let role_stats = {};
        if (isAdmin) {
            const incomeRes = await db_1.db.$queryRawUnsafe(`SELECT SUM(total_harga) as total FROM orders WHERE tenant_id = $1 AND date_trunc('month', tgl_order) = date_trunc('month', CURRENT_DATE) AND status != 'dibatalkan' ${outletCondRaw}`, tenantId);
            const monthly_income = Number(incomeRes[0]?.total || 0);
            role_stats = {
                title: 'Pendapatan Bulan Ini',
                value: "Rp " + monthly_income.toLocaleString('id-ID'),
                color: '0xFF10B981'
            };
        }
        else {
            const activeRes = await db_1.db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 AND status IN ('diproses') ${outletCondRaw}`, tenantId);
            role_stats = {
                title: 'Sedang Diproses',
                value: Number(activeRes[0]?.count || 0).toString() + " Rak",
                color: '0xFF3B82F6'
            };
        }
        // Ready to pickup
        const readyRes = await db_1.db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 AND status IN ('siap_diambil', 'siap_diantar') ${outletCondRaw}`, tenantId);
        const ready_count = Number(readyRes[0]?.count || 0);
        // 3. Revenue Chart Data (Last 7 Days)
        const rawChartData = await db_1.db.$queryRawUnsafe(`
      SELECT date(tgl_order) as order_date, SUM(total_harga) as income 
      FROM orders 
      WHERE tenant_id = $1 AND tgl_order >= CURRENT_DATE - INTERVAL '7 days' AND status != 'dibatalkan' ${outletCondRaw}
      GROUP BY order_date
      ORDER BY order_date ASC
    `, tenantId);
        const chart_data = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const found = rawChartData.find((r) => {
                if (!r.order_date)
                    return false;
                // In node-postgres, date might be returned as JS Date object
                const rDate = r.order_date instanceof Date ? r.order_date.toISOString().split('T')[0] : String(r.order_date).split('T')[0];
                return rDate === dateStr;
            });
            const dayStr = d.toLocaleDateString('en-US', { weekday: 'short' });
            const labelStr = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            chart_data.push({
                day: dayStr,
                income: found ? Number(found.income || 0) : 0,
                label: labelStr
            });
        }
        // 4. Recent Orders — include all fields required by OrderDao.cacheFromRemote()
        const recentOrdersRaw = await db_1.db.$queryRawUnsafe(`
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
      WHERE o.tenant_id = $1 ${outletCondRawOrders}
      ORDER BY o.tgl_order DESC 
      LIMIT 20
    `, tenantId);
        const formatted_orders = recentOrdersRaw.map((o) => ({
            id: o.tracking_code || ('ORD-' + o.id),
            raw_id: o.id,
            customer: o.nama_pelanggan,
            status: o.status ? o.status.charAt(0).toUpperCase() + o.status.slice(1).replace(/_/g, ' ') : 'Unknown',
            price: "Rp " + Number(o.total_harga || 0).toLocaleString('id-ID'),
            color: mapStatusToDashColor(o.status),
            status_bayar: o.status_pembayaran ?? 'pending',
        }));
        // -- Additional Web Admin Stats --
        const totCustRes = await db_1.db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM customers WHERE tenant_id = $1`, tenantId);
        const total_customers = Number(totCustRes[0]?.count || 0);
        const totOrdRes = await db_1.db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 ${outletCondRaw}`, tenantId);
        const total_orders_count = Number(totOrdRes[0]?.count || 0);
        const selesaiRes = await db_1.db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 AND status = 'selesai' ${outletCondRaw}`, tenantId);
        const selesai_orders_count = Number(selesaiRes[0]?.count || 0);
        const totRevRes = await db_1.db.$queryRawUnsafe(`SELECT SUM(total_harga) as total FROM orders WHERE tenant_id = $1 AND status = 'selesai' ${outletCondRaw}`, tenantId);
        const total_revenue = Number(totRevRes[0]?.total || 0);
        const payPendRes = await db_1.db.$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM payments p 
      JOIN orders o ON p.order_id = o.id 
      WHERE p.status_pembayaran = 'pending' AND o.tenant_id = $1 ${outletCondRawOrders}
    `, tenantId);
        const pay_pending_count = Number(payPendRes[0]?.count || 0);
        const todayRevRes = await db_1.db.$queryRawUnsafe(`SELECT SUM(total_harga) as total FROM orders WHERE tenant_id = $1 AND date(tgl_order) = CURRENT_DATE AND status != 'dibatalkan' ${outletCondRaw}`, tenantId);
        const today_revenue = Number(todayRevRes[0]?.total || 0);
        let status_counts = {};
        const statuses = ['menunggu_konfirmasi', 'diproses', 'siap_diantar', 'selesai', 'dibatalkan'];
        for (const s of statuses) {
            const scRes = await db_1.db.$queryRawUnsafe(`SELECT COUNT(*) as count FROM orders WHERE tenant_id = $1 AND status = $2::order_status ${outletCondRaw}`, tenantId, s);
            status_counts[s] = Number(scRes[0]?.count || 0);
        }
        let outlet_rankings = [];
        if (!outletId && isAdmin) {
            outlet_rankings = await db_1.db.$queryRawUnsafe(`
        SELECT ot.id, ot.nama,
        (SELECT COUNT(*) FROM orders WHERE outlet_id = ot.id AND DATE(tgl_order) = CURRENT_DATE) as c_today,
        (SELECT COALESCE(SUM(total_harga), 0) FROM orders WHERE outlet_id = ot.id AND DATE(tgl_order) = CURRENT_DATE AND status != 'dibatalkan') as r_today
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
            const otRes = await db_1.db.$queryRawUnsafe(`SELECT nama FROM outlets WHERE id = $1`, outletId);
            if (otRes.length > 0)
                outlet_nama = otRes[0].nama;
        }
        // Fetch real full name from DB — JWT only stores username, not nama
        const userId = req.user?.user_id;
        let userNama = req.user?.username || 'User';
        if (userId) {
            const userRow = await db_1.db.$queryRawUnsafe(`SELECT nama FROM users WHERE id = $1`, userId);
            if (userRow.length > 0 && userRow[0].nama) {
                userNama = userRow[0].nama;
            }
        }
        // Fetch services dan packages untuk di-cache di perangkat mobile
        const servicesRaw = await db_1.db.$queryRawUnsafe(`SELECT s.id, s.nama_layanan as name, s.harga_per_kg as price,
              CONCAT('Rp ', TO_CHAR(s.harga_per_kg, 'FM999,999,999')) as price_formatted,
              s.satuan as unit, COALESCE(s.durasi_jam, s.durasi_hari * 24, 72) as duration,
              s.deskripsi, s.paket_id
       FROM services s
       WHERE s.tenant_id = $1 AND s.is_active = true
       ORDER BY s.id ASC`, tenantId);
        const packagesRaw = await db_1.db.$queryRawUnsafe(`SELECT p.id, p.nama, p.durasi_jam, p.deskripsi,
              CONCAT(p.durasi_jam, ' Jam') as durasi_label,
              p.is_active as is_available, COALESCE(p.harga_tambahan, 0) as price_tambahan
       FROM paket_laundry p
       WHERE p.tenant_id = $1
       ORDER BY p.durasi_jam ASC`, tenantId);
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
                services: servicesRaw.map((s) => ({
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
                packages: packagesRaw.map((p) => ({
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
    }
    catch (err) {
        console.error('[Dashboard Sync]', err);
        res.status(500).json({ status: 'error', message: 'Gagal memuat dashboard. Silakan coba lagi.' });
    }
};
exports.getDashboard = getDashboard;
function mapStatusToDashColor(status) {
    switch (status) {
        case 'selesai': return '0xFF10B981';
        case 'diproses': return '0xFF3B82F6';
        case 'siap_diambil':
        case 'siap_diantar': return '0xFF8B5CF6';
        case 'menunggu_konfirmasi': return '0xFFF59E0B';
        default: return '0xFF64748B';
    }
}
