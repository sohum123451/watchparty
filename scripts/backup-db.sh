#!/usr/bin/env bash
set -eo pipefail

# ==============================================================================
# WatchParty - Manual & Automated PostgreSQL Backup Script
# Usage: ./scripts/backup-db.sh [backup_dir]
# ==============================================================================

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/watchparty_backup_${TIMESTAMP}.sql.gz"
CONTAINER_NAME="${POSTGRES_CONTAINER:-watchparty-postgres}"
DB_NAME="${POSTGRES_DB:-watchparty_db}"
DB_USER="${POSTGRES_USER:-watchparty}"

mkdir -p "${BACKUP_DIR}"

echo "======================================================="
echo " WatchParty Database Backup"
echo " Target: ${BACKUP_FILE}"
echo " Time:   $(date)"
echo "======================================================="

# Verify Docker container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Error: Docker container '${CONTAINER_NAME}' is not running." >&2
  exit 1
fi

# Run pg_dump inside container and pipe to gzip
echo "Executing pg_dump..."
docker exec -t "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip -9 > "${BACKUP_FILE}"

# Verify file size
FILESIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}" 2>/dev/null || wc -c < "${BACKUP_FILE}")

if [ "${FILESIZE}" -lt 500 ]; then
  echo "Error: Backup file is suspiciously small (${FILESIZE} bytes). Please check database status." >&2
  exit 1
fi

echo "✓ Backup successfully created: ${BACKUP_FILE} (${FILESIZE} bytes)"

# Optional: Prune local backups older than 14 days
echo "Pruning backups older than 14 days in ${BACKUP_DIR}..."
find "${BACKUP_DIR}" -name "watchparty_backup_*.sql.gz" -type f -mtime +14 -delete || true

echo "Done."
