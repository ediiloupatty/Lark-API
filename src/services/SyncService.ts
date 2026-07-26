import { PrismaClient } from '@prisma/client';

export const syncTableHasColumn = async (db: PrismaClient, table: string, column: string): Promise<boolean> => {
  return true; // Bypass dynamic checks on Supabase production to prevent massive latency spikes!
};

export const syncTableExists = async (db: PrismaClient, table: string): Promise<boolean> => {
  return true; // Bypass dynamic checks on Supabase production
};

export const syncFetchOrderPayload = async (db: PrismaClient, tenantId: number, orderId: number): Promise<any | null> => {
  const hasPaketLaundryTable = await syncTableExists(db, 'paket_laundry');
  const hasOrderClientId = await syncTableHasColumn(db, 'orders', 'client_id');
  const hasOrderServerVersion = await syncTableHasColumn(db, 'orders', 'server_version');

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

  const orders = await db.$queryRawUnsafe<any[]>(query, orderId, tenantId);
  if (!orders || orders.length === 0) return null;
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

  const items = await db.$queryRawUnsafe<any[]>(queryItems, orderId);
  order.items = items;

  if (items.length > 0) {
    order.layanan_nama = items[0].nama_item;
    order.harga_per_kg = items[0].harga_per_kg;
    order.berat = items[0].berat;
  }

  return order;
};

/**
 * Optimistic locking guard untuk endpoint yang dipanggil offline sync.
 *
 * Mobile mengirim `base_version` = server_version yang terlihat saat perubahan
 * dibuat offline (lihat OfflineSyncService._syncUpdateOrderStatus / _syncPayOrder
 * / _syncUpdateCustomer / _syncDeleteCustomer). Bila server sudah lebih baru,
 * perubahan itu dibuat di atas data basi — tolak dengan 409 agar mobile
 * menandai baris sebagai konflik (_SyncConflictException) dan user memilih
 * versi lokal atau versi server lewat Sync Center.
 *
 * Guard bersifat opt-in: klien yang tidak mengirim base_version (web dashboard,
 * mobile versi lama) tetap lolos, jadi tidak ada kompatibilitas yang putus.
 */
export const syncIsStaleWrite = (baseVersion: unknown, currentVersion: unknown): boolean => {
  if (baseVersion === undefined || baseVersion === null) return false;

  const base = String(baseVersion).trim();
  if (base === '' || base === '0' || base === 'null' || base === 'undefined') return false;

  const current = String(currentVersion ?? '').trim();
  // Baris tanpa server_version (kolom NULL / belum pernah di-bump) tidak bisa
  // dibandingkan — biarkan lolos daripada memblokir tulisan secara permanen.
  if (current === '' || current === '0' || current === 'null') return false;

  const baseNum = Number(base);
  const currentNum = Number(current);
  if (Number.isFinite(baseNum) && Number.isFinite(currentNum)) return baseNum !== currentNum;
  return base !== current;
};

export const syncCurrentServerVersion = async (db: PrismaClient, tenantId: number): Promise<number> => {
  const candidates: number[] = [0];
  const tables = ['customers', 'orders', 'services', 'paket_laundry'];

  for (const table of tables) {
    if (!(await syncTableExists(db, table)) || !(await syncTableHasColumn(db, table, 'server_version'))) {
      continue;
    }

    let query = `SELECT COALESCE(MAX(server_version), 0) as max_val FROM ${table} WHERE tenant_id = $1`;
    if (table === 'customers' && await syncTableHasColumn(db, 'customers', 'deleted_at')) {
      query += ` AND deleted_at IS NULL`;
    }
    if ((table === 'services' || table === 'paket_laundry') && await syncTableHasColumn(db, table, 'is_active')) {
      query += ` AND is_active = true`;
    }

    const rows = await db.$queryRawUnsafe<any[]>(query, tenantId);
    if (rows[0] && rows[0].max_val) {
      candidates.push(Number(rows[0].max_val));
    }
  }

  return Math.max(...candidates);
};
