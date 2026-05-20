-- Migration: Tarif ongkir per-outlet + kolom logistik order (Bug C)
-- Tanggal: 2026-05-20

-- 1. Tabel tarif ongkir per outlet per zona
CREATE TABLE IF NOT EXISTS outlet_delivery_rates (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER NOT NULL,
  outlet_id       INTEGER NOT NULL,
  zone            VARCHAR(20) NOT NULL,
  fee             NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
  server_version  BIGINT,
  CONSTRAINT outlet_delivery_rates_outlet_zone_key UNIQUE (outlet_id, zone),
  CONSTRAINT outlet_delivery_rates_tenant_fk FOREIGN KEY (tenant_id)
    REFERENCES tenants(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT outlet_delivery_rates_outlet_fk FOREIGN KEY (outlet_id)
    REFERENCES outlets(id) ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS idx_odr_tenant ON outlet_delivery_rates(tenant_id);

-- 2. Kolom logistik di orders (Bug C: detail jemput-antar tidak pernah disimpan)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_method          VARCHAR(30);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method        VARCHAR(30);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_zone            VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone          VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address       TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_location_link   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_location_link TEXT;
