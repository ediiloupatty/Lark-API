-- Migration: Index untuk kolom tenant_id (dan payments.order_id)
-- Tanggal: 2026-08-02
--
-- LATAR BELAKANG
-- PostgreSQL TIDAK membuat index otomatis untuk kolom foreign key. Sebelum
-- migrasi ini, hampir semua tabel bertenant hanya punya primary key, sehingga
-- setiap kueri berpola `WHERE tenant_id = $1` melakukan sequential scan penuh.
-- Tabel `orders` sudah punya index sejak awal; sisanya belum.
--
-- Index paling berdampak di berkas ini adalah `idx_payments_order`.
-- dashboardController dan financeController memakai subquery berkorelasi
-- `SELECT ... FROM payments WHERE order_id = o.id` yang dijalankan sekali per
-- baris order — tanpa index, satu halaman laporan memicu seq scan payments
-- sebanyak jumlah order yang ditampilkan.
--
-- TIDAK disertakan karena sudah tercakup index lain:
--   promotions       → @@unique([tenant_id, code])        (tenant_id memimpin)
--   tenant_settings  → @@unique([tenant_id, setting_key]) (tenant_id memimpin)
--   orders           → idx_orders_status, idx_orders_tenant_customer
--
-- CARA MENJALANKAN DI PRODUKSI
--   psql "$DATABASE_URL" -f migrations/2026-08-02_tenant_indexes.sql
--
-- CONCURRENTLY dipakai agar tabel tidak terkunci terhadap INSERT/UPDATE selama
-- index dibangun, jadi aman dijalankan tanpa jendela pemeliharaan. Konsekuensi:
--   1. Perintah ini TIDAK BOLEH berada di dalam blok transaksi. Jangan bungkus
--      dengan BEGIN/COMMIT, dan jangan jalankan lewat `prisma migrate` yang
--      otomatis membuka transaksi. Jalankan langsung via psql.
--   2. Bila sebuah CREATE INDEX CONCURRENTLY gagal di tengah jalan, Postgres
--      meninggalkan index berstatus INVALID. Index itu tidak dipakai planner
--      dan harus dibuang manual sebelum diulang:
--        DROP INDEX CONCURRENTLY <nama_index>;
--      Kueri pemeriksaan ada di bagian VERIFIKASI di bawah.
--
-- Nama index sengaja disamakan dengan atribut `map:` di prisma/schema.prisma
-- agar `prisma db push` / `prisma migrate diff` menganggapnya sudah ada dan
-- tidak mencoba membuat duplikat.

-- ── Pelanggan: WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY nama ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_tenant_deleted
  ON customers (tenant_id, deleted_at);

-- ── Pengeluaran: WHERE tenant_id = $1 AND tanggal BETWEEN $2 AND $3 ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expenses_tenant_tanggal
  ON expenses (tenant_id, tanggal);

-- ── Pembayaran: subquery berkorelasi per baris order (paling berdampak) ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_order
  ON payments (order_id);

-- ── Pembayaran: agregat keuangan per tenant ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_tenant
  ON payments (tenant_id);

-- ── Staf: WHERE tenant_id = $1 AND role IN (...) AND deleted_at IS NULL ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_tenant_deleted
  ON users (tenant_id, deleted_at);

-- ── Layanan: WHERE tenant_id = $1 AND is_active = true ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_services_tenant_active
  ON services (tenant_id, is_active);

-- ── Outlet: daftar per tenant + verifikasi kepemilikan outlet ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outlets_tenant
  ON outlets (tenant_id);

-- ── Paket laundry: daftar per tenant ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_paket_laundry_tenant
  ON paket_laundry (tenant_id);

-- ── Inventaris: daftar per tenant ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_tenant
  ON inventory (tenant_id);

-- ── Laporan tersimpan: WHERE tenant_id = $1 ORDER BY tgl_laporan ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_tenant_tanggal
  ON reports (tenant_id, tgl_laporan);

-- ── Audit log: listing per tenant, terbaru di atas ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_tenant_created
  ON audit_logs (tenant_id, created_at);

-- ── Invoice langganan: lookup per tenant ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscription_invoices_tenant
  ON subscription_invoices (tenant_id);

-- ── Segarkan statistik planner agar index langsung dipakai ──
ANALYZE customers;
ANALYZE expenses;
ANALYZE payments;
ANALYZE users;
ANALYZE services;
ANALYZE outlets;
ANALYZE paket_laundry;
ANALYZE inventory;
ANALYZE reports;
ANALYZE audit_logs;
ANALYZE subscription_invoices;

-- ═══════════════════════════════════════════════════════════════
-- VERIFIKASI — jalankan setelah migrasi selesai
-- ═══════════════════════════════════════════════════════════════
--
-- 1. Pastikan ke-12 index terbentuk:
--
--    SELECT indexname FROM pg_indexes
--    WHERE schemaname = 'public' AND indexname IN (
--      'idx_customers_tenant_deleted', 'idx_expenses_tenant_tanggal',
--      'idx_payments_order', 'idx_payments_tenant',
--      'idx_users_tenant_deleted', 'idx_services_tenant_active',
--      'idx_outlets_tenant', 'idx_paket_laundry_tenant',
--      'idx_inventory_tenant', 'idx_reports_tenant_tanggal',
--      'idx_audit_logs_tenant_created', 'idx_subscription_invoices_tenant'
--    )
--    ORDER BY indexname;
--
-- 2. Pastikan tidak ada index INVALID (sisa CONCURRENTLY yang gagal):
--
--    SELECT c.relname AS index_name
--    FROM pg_class c
--    JOIN pg_index i ON i.indexrelid = c.oid
--    WHERE NOT i.indisvalid AND c.relname LIKE 'idx_%';
--
--    Bila ada hasilnya: DROP INDEX CONCURRENTLY <nama>; lalu ulangi
--    pernyataan CREATE yang bersangkutan.
