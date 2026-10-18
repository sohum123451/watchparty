#!/bin/sh
set -e

# ==============================================================================
# WatchParty - Production Container Entrypoint
# ==============================================================================

echo "[Entrypoint] Initializing WatchParty production container..."

# 1. Run database migrations with retry backoff if DATABASE_URL is defined
if [ -n "$DATABASE_URL" ]; then
  echo "[Entrypoint] Running database migrations on deploy..."
  MAX_RETRIES=10
  RETRY_COUNT=0
  until node packages/server/dist/db/migrate.js; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]; then
      echo "[Entrypoint] ERROR: Database migration failed after ${MAX_RETRIES} attempts."
      exit 1
    fi
    echo "[Entrypoint] Database not ready yet (attempt ${RETRY_COUNT}/${MAX_RETRIES}). Retrying in 2s..."
    sleep 2
  done
  echo "[Entrypoint] Database migrations completed successfully."
else
  echo "[Entrypoint] No DATABASE_URL specified. Running with zero-dependency local storage."
fi

# 2. Execute main server command (or user passed command)
echo "[Entrypoint] Starting application server..."
exec "$@"
