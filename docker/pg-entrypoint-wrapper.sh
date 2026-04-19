#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# PostgreSQL Entrypoint Wrapper
# ──────────────────────────────────────────────────────────────────────────────
# Wraps the official docker-entrypoint.sh to add a background password sync
# that runs AFTER PostgreSQL is fully started. This ensures password stays
# in sync with POSTGRES_PASSWORD env var on every container restart.
# ──────────────────────────────────────────────────────────────────────────────

# Run password sync in background after PG is ready
(
    sleep 5  # Give PostgreSQL time to fully start
    /docker-entrypoint-initdb.d/sync-password.sh
) &

# Delegate to the official PostgreSQL entrypoint
exec docker-entrypoint.sh "$@"
