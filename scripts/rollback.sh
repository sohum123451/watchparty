#!/usr/bin/env bash
set -eo pipefail

# ==============================================================================
# WatchParty - One-Command Instant Production Rollback Script
# Usage: ./scripts/rollback.sh [target_image_tag_or_sha]
# ==============================================================================

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
STATE_FILE="${STATE_FILE:-.last_deployed_tag}"

if [ -n "$1" ]; then
  TARGET_TAG="$1"
elif [ -f "${STATE_FILE}" ]; then
  TARGET_TAG=$(cat "${STATE_FILE}")
  echo "Using previous deployed tag recorded in ${STATE_FILE}: ${TARGET_TAG}"
else
  echo "Usage: $0 <target_image_tag_or_sha>" >&2
  echo "Example: $0 sha-9a4f21b" >&2
  exit 1
fi

echo "======================================================="
echo " WatchParty One-Command Production Rollback"
echo " Target Tag: ${TARGET_TAG}"
echo " Compose:    ${COMPOSE_FILE}"
echo " Time:       $(date)"
echo "======================================================="

# Current image before rollback
CURRENT_IMAGE=$(docker compose -f "${COMPOSE_FILE}" images app --format '{{.Repository}}:{{.Tag}}' 2>/dev/null || echo "unknown")
echo "Current running app: ${CURRENT_IMAGE}"

export APP_IMAGE="${TARGET_TAG}"
# If TARGET_TAG is not a fully qualified image, prepend repo from current image if available
if [[ "${TARGET_TAG}" != *":"* ]] && [[ "${TARGET_TAG}" != *"/"* ]]; then
  REPO_BASE=$(echo "${CURRENT_IMAGE}" | cut -d':' -f1)
  if [ -n "${REPO_BASE}" ] && [ "${REPO_BASE}" != "unknown" ]; then
    export APP_IMAGE="${REPO_BASE}:${TARGET_TAG}"
  fi
fi

echo "1. Pulling rollback image: ${APP_IMAGE}..."
docker compose -f "${COMPOSE_FILE}" pull app

echo "2. Gracefully restarting app container with rollback image..."
docker compose -f "${COMPOSE_FILE}" up -d --no-deps app

echo "3. Waiting for health check probe on /health..."
for i in {1..15}; do
  if docker exec watchparty-app wget --no-verbose --tries=1 --spider http://localhost:3001/health 2>/dev/null; then
    echo "✓ Health check passed! Application is live and healthy."
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "Error: Health check timed out after rollback. Inspect logs with: docker logs watchparty-app" >&2
    exit 1
  fi
  sleep 2
done

echo "======================================================="
echo "✓ Instant rollback complete! Running: ${APP_IMAGE}"
echo "======================================================="
