#!/usr/bin/env bash
set -eo pipefail

# ==============================================================================
# WatchParty - Restore Database from Amazon S3 Backup
# Usage: ./scripts/restore-from-s3.sh [s3_uri_or_filename]
# Example: ./scripts/restore-from-s3.sh s3://my-bucket/backups/watchparty_backup_20261015_120000.sql.gz
# Or restore latest: ./scripts/restore-from-s3.sh --latest
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"

if [ -f "${BASE_DIR}/.env" ]; then
  # shellcheck disable=SC1091
  source "${BASE_DIR}/.env"
fi

if [ -f "${BASE_DIR}/.aws_env" ]; then
  # shellcheck disable=SC1091
  source "${BASE_DIR}/.aws_env"
fi

S3_BUCKET="${BACKUP_BUCKET:-}"
TARGET_INPUT="$1"

if [ -z "${TARGET_INPUT}" ] || [ "${TARGET_INPUT}" == "--help" ]; then
  echo "Usage: $0 [--latest | s3://bucket/path/backup.sql.gz | filename.sql.gz]"
  echo ""
  if [ -n "${S3_BUCKET}" ]; then
    echo "Available recent backups in s3://${S3_BUCKET}/backups/:"
    aws s3 ls "s3://${S3_BUCKET}/backups/" | tail -n 5 || true
  fi
  exit 1
fi

# Determine full S3 URI
if [ "${TARGET_INPUT}" == "--latest" ]; then
  if [ -z "${S3_BUCKET}" ]; then
    echo "Error: BACKUP_BUCKET environment variable must be set to use --latest" >&2
    exit 1
  fi
  echo "Finding latest backup in s3://${S3_BUCKET}/backups/..."
  LATEST_KEY=$(aws s3 ls "s3://${S3_BUCKET}/backups/" | sort | tail -n 1 | awk '{print $4}')
  if [ -z "${LATEST_KEY}" ]; then
    echo "Error: No backups found in s3://${S3_BUCKET}/backups/" >&2
    exit 1
  fi
  S3_URI="s3://${S3_BUCKET}/backups/${LATEST_KEY}"
elif [[ "${TARGET_INPUT}" =~ ^s3:// ]]; then
  S3_URI="${TARGET_INPUT}"
else
  # Treat as filename inside configured bucket
  if [ -z "${S3_BUCKET}" ]; then
    echo "Error: BACKUP_BUCKET environment variable must be set" >&2
    exit 1
  fi
  S3_URI="s3://${S3_BUCKET}/backups/${TARGET_INPUT}"
fi

TMP_RESTORE="/tmp/wp_restore_$(date +%s).sql.gz"
CONTAINER_NAME="${POSTGRES_CONTAINER:-watchparty-postgres}"
DB_NAME="${POSTGRES_DB:-watchparty_db}"
DB_USER="${POSTGRES_USER:-watchparty}"

echo "======================================================="
echo " WARNING: DATABASE RESTORATION FROM S3"
echo " S3 Backup Source: ${S3_URI}"
echo " Target Container: ${CONTAINER_NAME}"
echo " Target Database:  ${DB_NAME} (User: ${DB_USER})"
echo " Time:             $(date)"
echo "======================================================="
echo "This operation will REPLACE existing database tables and records!"

if [ -t 0 ] && [ -z "${FORCE_RESTORE}" ]; then
  read -p "Are you sure you want to proceed? [y/N]: " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Restoration aborted by user."
    exit 0
  fi
fi

# 1. Verify Postgres container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Error: Container '${CONTAINER_NAME}' is not running." >&2
  exit 1
fi

# 2. Download from S3
echo "1. Downloading backup from ${S3_URI} to ${TMP_RESTORE}..."
aws s3 cp "${S3_URI}" "${TMP_RESTORE}" --only-show-errors

if [ ! -s "${TMP_RESTORE}" ]; then
  echo "Error: Downloaded file is empty or missing." >&2
  rm -f "${TMP_RESTORE}"
  exit 1
fi

# 3. Terminate active database connections
echo "2. Terminating active database connections..."
docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" || true

# 4. Decompress and pipe to psql
echo "3. Restoring database schema and records..."
gunzip -c "${TMP_RESTORE}" | docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}"

# 5. Verification queries
echo "4. Running post-restore integrity check..."
USER_COUNT=$(docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT COUNT(*) FROM users;" 2>/dev/null | xargs || echo "0")
ROOM_COUNT=$(docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT COUNT(*) FROM rooms;" 2>/dev/null | xargs || echo "0")

# 6. Clean up temp download
rm -f "${TMP_RESTORE}"

echo "======================================================="
echo "✓ S3 Database restoration completed successfully!"
echo "  • Restored from: ${S3_URI}"
echo "  • Total users verified: ${USER_COUNT}"
echo "  • Active rooms in DB:   ${ROOM_COUNT}"
echo "======================================================="
