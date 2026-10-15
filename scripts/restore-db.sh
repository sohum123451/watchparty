#!/usr/bin/env bash
set -eo pipefail

# ==============================================================================
# WatchParty - PostgreSQL Database Restoration Script
# Usage: ./scripts/restore-db.sh <path_to_backup.sql.gz>
# ==============================================================================

if [ -z "$1" ]; then
  echo "Usage: $0 <path_to_backup.sql.gz>" >&2
  echo "Example: $0 ./backups/watchparty_backup_20261015_120000.sql.gz" >&2
  exit 1
fi

BACKUP_FILE="$1"
CONTAINER_NAME="${POSTGRES_CONTAINER:-watchparty-postgres}"
DB_NAME="${POSTGRES_DB:-watchparty_db}"
DB_USER="${POSTGRES_USER:-watchparty}"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file '${BACKUP_FILE}' not found." >&2
  exit 1
fi

echo "======================================================="
echo " WARNING: DATABASE RESTORATION"
echo " Target DB:  ${DB_NAME} (User: ${DB_USER})"
echo " Container:  ${CONTAINER_NAME}"
echo " File:       ${BACKUP_FILE}"
echo "======================================================="
echo "This operation will REPLACE existing database tables and records."

if [ -t 0 ] && [ -z "${FORCE_RESTORE}" ]; then
  read -p "Are you sure you want to proceed? [y/N]: " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Restoration aborted by user."
    exit 0
  fi
fi

# Verify Docker container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Error: Docker container '${CONTAINER_NAME}' is not running." >&2
  exit 1
fi

echo "1. Terminating active database connections..."
docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" || true

echo "2. Decompressing and executing SQL restore..."
gunzip -c "${BACKUP_FILE}" | docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}"

echo "3. Running verification query..."
MIGRATION_COUNT=$(docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT COUNT(*) FROM schema_migrations;" | xargs)
USER_COUNT=$(docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT COUNT(*) FROM users;" | xargs)

echo "======================================================="
echo "✓ Database restoration completed successfully!"
echo "  • Schema migrations verified: ${MIGRATION_COUNT}"
echo "  • Total users restored:       ${USER_COUNT}"
echo "======================================================="
