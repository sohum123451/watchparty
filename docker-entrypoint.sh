#!/bin/sh
set -e

# ==============================================================================
# WatchParty - Production Container Entrypoint
# ==============================================================================

echo "[Entrypoint] Initializing WatchParty production container..."

# 1. Run database migrations if DATABASE_URL is defined
if [ -n "$DATABASE_URL" ]; then
  echo "[Entrypoint] Running database migrations on deploy..."
  node packages/server/dist/db/migrate.js
else
  echo "[Entrypoint] No DATABASE_URL specified. Running with zero-dependency local storage."
fi

# 2. Execute main server command (or user passed command)
echo "[Entrypoint] Starting application server..."
exec "$@"
