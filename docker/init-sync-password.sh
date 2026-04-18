#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# PostgreSQL Init Script: Sinkronisasi Password
# ──────────────────────────────────────────────────────────────────────────────
# Script ini dijalankan saat PostgreSQL container start.
# Fungsi: Memastikan password internal PostgreSQL selalu cocok dengan
# environment variable POSTGRES_PASSWORD di docker-compose.yml.
#
# MENGAPA INI DIPERLUKAN:
# PostgreSQL Docker image hanya membaca POSTGRES_PASSWORD saat PERTAMA KALI
# menginisialisasi data (volume kosong). Jika volume sudah ada, password lama
# tetap tersimpan dan env var baru DIABAIKAN — menyebabkan backend gagal
# autentikasi (error 28P01) tanpa peringatan.
#
# Script ini dijalankan setiap kali container start dan force-update password
# agar selalu sinkron dengan env var.
# ──────────────────────────────────────────────────────────────────────────────

set -e

# POSTGRES_PASSWORD sudah di-set oleh Docker env var
if [ -n "$POSTGRES_PASSWORD" ]; then
    echo "[init-sync-password] 🔄 Sinkronisasi password PostgreSQL user '$POSTGRES_USER'..."
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
        ALTER USER "$POSTGRES_USER" PASSWORD '$POSTGRES_PASSWORD';
EOSQL
    echo "[init-sync-password] ✅ Password sinkron."
else
    echo "[init-sync-password] ⚠️ POSTGRES_PASSWORD tidak diset, skip."
fi
