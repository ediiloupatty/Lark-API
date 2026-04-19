#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# PostgreSQL Password Sync — Runs EVERY container startup (not just first init)
# ──────────────────────────────────────────────────────────────────────────────
# Problem: docker-entrypoint-initdb.d/ only runs on FIRST init (empty volume).
# This script runs via a custom entrypoint wrapper to force-sync password
# EVERY time the container starts, preventing auth mismatches permanently.
# ──────────────────────────────────────────────────────────────────────────────

set -e

# Wait for PostgreSQL to be ready (it starts before this script in the wrapper)
until pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-db_laundry}" -q; do
    echo "[sync-password] ⏳ Waiting for PostgreSQL to be ready..."
    sleep 1
done

if [ -n "$POSTGRES_PASSWORD" ]; then
    echo "[sync-password] 🔄 Syncing password for user '${POSTGRES_USER:-postgres}'..."
    psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-db_laundry}" -c "ALTER USER \"${POSTGRES_USER:-postgres}\" PASSWORD '${POSTGRES_PASSWORD}';"
    echo "[sync-password] ✅ Password synced successfully."
else
    echo "[sync-password] ⚠️ POSTGRES_PASSWORD not set, skipping."
fi
