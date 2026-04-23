"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCurrentServerVersion = exports.syncFetchOrderPayload = exports.syncTableExists = exports.syncTableHasColumn = void 0;
const syncTableHasColumn = async (db, table, column) => {
    return true; // Bypass dynamic checks on Supabase production to prevent massive latency spikes!
};
exports.syncTableHasColumn = syncTableHasColumn;
const syncTableExists = async (db, table) => {
    return true; // Bypass dynamic checks on Supabase production
};
exports.syncTableExists = syncTableExists;
const syncFetchOrderPayload = async (db, tenantId, orderId) => {
    const hasPaketLaundryTable = await (0, exports.syncTableExists)(db, 'paket_laundry');
    const hasOrderClientId = await (0, exports.syncTableHasColumn)(db, 'orders', 'client_id');
    const hasOrderServerVersion = await (0, exports.syncTableHasColumn)(db, 'orders', 'server_version');
    const paketSelect = hasPaketLaundryTable ? 'pk.nama as paket_nama,' : 'NULL as paket_nama,';
    const paketJoin = hasPaketLaundryTable ? 'LEFT JOIN paket_laundry pk ON o.paket_id = pk.id' : '';
    const clientIdSelect = hasOrderClientId ? 'o.client_id,' : 'NULL as client_id,';
    const serverVersionSelect = hasOrderServerVersion ? 'o.server_version,' : '0 as server_version,';
    const query = `
    SELECT o.*, ${clientIdSelect} ${serverVersionSelect}
           c.nama as nama_pelanggan, c.no_hp, c.alamat as alamat_pelanggan,
           ot.nama as outlet_nama, ot.alamat as outlet_alamat, ot.phone as outlet_phone,
           p.status_pembayaran, p.metode_pembayaran as metode_bayar,
           p.jumlah_bayar, p.tgl_pembayaran, p.konfirmasi_pada,
           ${paketSelect}
           o.updated_at
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    LEFT JOIN outlets ot ON o.outlet_id = ot.id
    LEFT JOIN payments p ON o.id = p.order_id
    ${paketJoin}
    WHERE o.id = $1 AND o.tenant_id = $2
  `;
    const orders = await db.$queryRawUnsafe(query, orderId, tenantId);
    if (!orders || orders.length === 0)
        return null;
    const order = orders[0];
    const itemPaketSelect = hasPaketLaundryTable ? ', pkg.nama as paket_nama' : ', NULL as paket_nama';
    const itemPaketJoin = hasPaketLaundryTable ? 'LEFT JOIN paket_laundry pkg ON s.paket_id = pkg.id' : '';
    const queryItems = `
    SELECT od.*, s.nama_layanan as nama_item, s.harga_per_kg
           ${itemPaketSelect}
    FROM order_details od
    JOIN services s ON od.service_id = s.id
    ${itemPaketJoin}
    WHERE od.order_id = $1
  `;
    const items = await db.$queryRawUnsafe(queryItems, orderId);
    order.items = items;
    if (items.length > 0) {
        order.layanan_nama = items[0].nama_item;
        order.harga_per_kg = items[0].harga_per_kg;
        order.berat = items[0].berat;
    }
    return order;
};
exports.syncFetchOrderPayload = syncFetchOrderPayload;
const syncCurrentServerVersion = async (db, tenantId) => {
    const candidates = [0];
    const tables = ['customers', 'orders', 'services', 'paket_laundry'];
    for (const table of tables) {
        if (!(await (0, exports.syncTableExists)(db, table)) || !(await (0, exports.syncTableHasColumn)(db, table, 'server_version'))) {
            continue;
        }
        let query = `SELECT COALESCE(MAX(server_version), 0) as max_val FROM ${table} WHERE tenant_id = $1`;
        if (table === 'customers' && await (0, exports.syncTableHasColumn)(db, 'customers', 'deleted_at')) {
            query += ` AND deleted_at IS NULL`;
        }
        if ((table === 'services' || table === 'paket_laundry') && await (0, exports.syncTableHasColumn)(db, table, 'is_active')) {
            query += ` AND is_active = true`;
        }
        const rows = await db.$queryRawUnsafe(query, tenantId);
        if (rows[0] && rows[0].max_val) {
            candidates.push(Number(rows[0].max_val));
        }
    }
    return Math.max(...candidates);
};
exports.syncCurrentServerVersion = syncCurrentServerVersion;
