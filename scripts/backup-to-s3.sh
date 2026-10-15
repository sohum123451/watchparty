#!/usr/bin/env bash
set -eo pipefail

# ==============================================================================
# WatchParty - Automated Daily PostgreSQL Backup to Amazon S3
# Uses EC2 IAM Instance Profile for secure, keyless S3 authentication
# Usage: ./scripts/backup-to-s3.sh [s3_bucket_name]
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"

# Load environment configuration if present
if [ -f "${BASE_DIR}/.env" ]; then
  # shellcheck disable=SC1091
  source "${BASE_DIR}/.env"
fi

if [ -f "${BASE_DIR}/.aws_env" ]; then
  # shellcheck disable=SC1091
  source "${BASE_DIR}/.aws_env"
fi

S3_BUCKET="${1:-${BACKUP_BUCKET:-}}"

if [ -z "${S3_BUCKET}" ]; then
  echo "Error: BACKUP_BUCKET not specified. Pass as arg or set in .aws_env" >&2
  echo "Usage: $0 <s3_bucket_name>" >&2
  exit 1
fi

LOCAL_BACKUP_DIR="${BASE_DIR}/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="watchparty_backup_${TIMESTAMP}.sql.gz"
LOCAL_FILE="${LOCAL_BACKUP_DIR}/${FILENAME}"
S3_TARGET="s3://${S3_BUCKET}/backups/${FILENAME}"

CONTAINER_NAME="${POSTGRES_CONTAINER:-watchparty-postgres}"
DB_NAME="${POSTGRES_DB:-watchparty_db}"
DB_USER="${POSTGRES_USER:-watchparty}"

mkdir -p "${LOCAL_BACKUP_DIR}"

echo "======================================================="
echo " WatchParty Database S3 Backup"
echo " Date:      $(date)"
echo " Database:  ${DB_NAME} (User: ${DB_USER})"
echo " Local:     ${LOCAL_FILE}"
echo " S3 Target: ${S3_TARGET}"
echo "======================================================="

# 1. Verify Postgres container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Error: Container '${CONTAINER_NAME}' is not running." >&2
  exit 1
fi

# 2. Execute pg_dump and compress with gzip
echo "1. Creating database dump from '${CONTAINER_NAME}'..."
docker exec -t "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip -9 > "${LOCAL_FILE}"

# 3. Verify integrity & minimum size
FILESIZE=$(stat -c%s "${LOCAL_FILE}" 2>/dev/null || stat -f%z "${LOCAL_FILE}" 2>/dev/null || wc -c < "${LOCAL_FILE}")

if [ "${FILESIZE}" -lt 500 ]; then
  echo "Error: Dump file '${LOCAL_FILE}' is suspiciously small (${FILESIZE} bytes). Aborting S3 upload." >&2
  exit 1
fi

echo "✓ Local backup generated (${FILESIZE} bytes)."

# 4. Upload to Amazon S3 (Authenticated via EC2 IAM Instance Profile)
echo "2. Uploading to Amazon S3: ${S3_TARGET}..."
aws s3 cp "${LOCAL_FILE}" "${S3_TARGET}" \
  --metadata "created_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ"),db=${DB_NAME}" \
  --only-show-errors

echo "✓ Successfully uploaded to ${S3_TARGET}"

# 5. Prune local backups older than 7 days (S3 lifecycle manages cloud retention)
echo "3. Pruning local backups older than 7 days..."
find "${LOCAL_BACKUP_DIR}" -name "watchparty_backup_*.sql.gz" -type f -mtime +7 -delete || true

echo "======================================================="
echo "✓ S3 Backup completed successfully at $(date)!"
echo "======================================================="
