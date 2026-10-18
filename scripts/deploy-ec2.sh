#!/usr/bin/env bash
set -eo pipefail

# ==============================================================================
# WatchParty - Repeatable EC2 Deployment Script
# Rebuilds production stack, runs migrations, verifies database and /health
# ==============================================================================

DEPLOY_DIR="${1:-/opt/watchparty}"
cd "$DEPLOY_DIR"

echo "======================================================="
echo "==> 1. Verifying environment file (.env)..."
echo "======================================================="

if [ ! -f .env ]; then
  echo "ERROR: .env file not found in $DEPLOY_DIR"
  echo "Please copy .env.production.example to .env and set all required secrets."
  exit 1
fi

# Ensure required environment variables exist
REQUIRED_VARS=("DATABASE_URL" "JWT_SECRET" "ENCRYPTION_KEY" "ADMIN_SECRET" "ALLOWED_ORIGINS")
for var in "${REQUIRED_VARS[@]}"; do
  if ! grep -q "^${var}=" .env; then
    echo "ERROR: Missing required environment variable '$var' in .env"
    exit 1
  fi
done

echo "✓ Environment file verified."

echo "======================================================="
echo "==> 2. Ensuring supporting services (Postgres, Redis)..."
echo "======================================================="
docker compose -f docker-compose.prod.yml up -d postgres redis

echo "Waiting for PostgreSQL to be healthy..."
for i in {1..20}; do
  if docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U watchparty -d watchparty_db >/dev/null 2>&1; then
    echo "✓ PostgreSQL is ready!"
    break
  fi
  sleep 1
done

echo "======================================================="
echo "==> 3. Building application container..."
echo "======================================================="
docker compose -f docker-compose.prod.yml build app

echo "======================================================="
echo "==> 4. Running database migrations & catalogue seeding..."
echo "======================================================="
docker compose -f docker-compose.prod.yml run --rm \
  -e NODE_ENV=production \
  app node packages/server/dist/db/migrate.js

echo "======================================================="
echo "==> 5. Starting full production stack (App + Caddy)..."
echo "======================================================="
docker compose -f docker-compose.prod.yml up -d --remove-orphans app caddy

echo "======================================================="
echo "==> 6. Verifying health check probe (/health)..."
echo "======================================================="
HEALTHY=false
for i in {1..30}; do
  RESPONSE=$(curl -sf http://localhost:3001/health || true)
  if echo "$RESPONSE" | grep -q '"status":"healthy"'; then
    echo "✓ Server and database connection verified healthy!"
    echo "Response: $RESPONSE"
    HEALTHY=true
    break
  fi
  echo "Awaiting health check probe (attempt $i/30)..."
  sleep 2
done

if [ "$HEALTHY" != "true" ]; then
  echo "FATAL: Deployment healthcheck failed! Inspecting app logs:"
  docker compose -f docker-compose.prod.yml logs --tail=50 app
  exit 1
fi

echo "======================================================="
echo "==> 7. Verifying Caddy HTTPS/HTTP proxy..."
echo "======================================================="
curl -sf http://localhost:80/health >/dev/null && echo "✓ Caddy port 80 proxy OK" || echo "Note: Caddy port 80 check returned non-200"

echo "======================================================="
echo "✓ WatchParty production deployment successfully verified!"
echo "======================================================="
docker compose -f docker-compose.prod.yml ps
