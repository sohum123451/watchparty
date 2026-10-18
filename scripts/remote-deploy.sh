#!/usr/bin/env bash
set -euxo pipefail

# ==============================================================================
# WatchParty - Automated EC2 Production Deploy Script
# Executes on the EC2 instance via AWS SSM
# ==============================================================================

cd /opt/watchparty

echo "==> 1. Downloading deployment package from S3..."
aws s3 cp s3://watchparty-production-backups-d0d42d83/deploy/watchparty-deploy.tar.gz /tmp/watchparty-deploy.tar.gz
tar -xzf /tmp/watchparty-deploy.tar.gz -C /opt/watchparty

echo "==> 2. Ensuring production environment variables in .env..."
if [ ! -f .env ]; then
  cat <<'EOF' > .env
NODE_ENV=production
PORT=3001
DOMAIN=3.7.195.152.sslip.io
BASE_URL=https://3.7.195.152.sslip.io
ACME_EMAIL=mangalapalli.sohum2026@vitstudent.ac.in
POSTGRES_USER=watchparty
POSTGRES_PASSWORD=wp_secret_pass_2026_x7a9
POSTGRES_DB=watchparty_db
DATABASE_URL=postgresql://watchparty:wp_secret_pass_2026_x7a9@postgres:5432/watchparty_db
REDIS_URL=redis://redis:6379
DATA_DIR=/data
JWT_SECRET=cPKVqA3l4VnI0v0SsrIPWkyiDNTOMXWKzSCh9mI1slQ
ENCRYPTION_KEY=cdf6ff31d30a65d0eb1786235c66f2947e6ffd365b65e26f0d30acc28491e8d6
ADMIN_SECRET=admin_secret_wp_2026_secure
REGISTRATION_MODE=public
BACKUP_BUCKET=watchparty-production-backups-d0d42d83
ALLOWED_ORIGINS=https://watchparty-nine-coral.vercel.app,http://localhost:3000
CORS_ORIGIN=https://watchparty-nine-coral.vercel.app,http://localhost:3000
EOF
else
  # Ensure ALLOWED_ORIGINS and CORS_ORIGIN are updated without wildcards
  sed -i '/^ALLOWED_ORIGINS=/d' .env
  sed -i '/^CORS_ORIGIN=/d' .env
  echo "ALLOWED_ORIGINS=https://watchparty-nine-coral.vercel.app,http://localhost:3000" >> .env
  echo "CORS_ORIGIN=https://watchparty-nine-coral.vercel.app,http://localhost:3000" >> .env
  # Ensure DOMAIN and BASE_URL are set to working HTTPS endpoints
  if ! grep -q '^DOMAIN=' .env; then
    echo "DOMAIN=3.7.195.152.sslip.io" >> .env
  fi
  if ! grep -q '^BASE_URL=' .env; then
    echo "BASE_URL=https://3.7.195.152.sslip.io" >> .env
  fi
fi

echo "==> 3. Configuring Caddyfile..."
# Ensure Caddyfile from deployment package is active
if [ -f /opt/watchparty/Caddyfile ]; then
  chmod 644 /opt/watchparty/Caddyfile
fi

echo "==> 4. Starting database & redis services..."
docker compose -f docker-compose.prod.yml up -d postgres redis

echo "Waiting for postgres to be healthy..."
for i in {1..30}; do
  if docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U watchparty -d watchparty_db >/dev/null 2>&1; then
    echo "✓ PostgreSQL is ready and responding!"
    break
  fi
  sleep 1
done

echo "==> 5. Building production application container..."
docker compose -f docker-compose.prod.yml build app

echo "==> 6. Running database migrations & seeding catalogue..."
docker compose -f docker-compose.prod.yml run --rm \
  -e NODE_ENV=production \
  app node packages/server/dist/db/migrate.js

echo "==> 7. Starting full production stack (App + Caddy)..."
docker compose -f docker-compose.prod.yml down --remove-orphans || true
docker compose -f docker-compose.prod.yml up -d

echo "==> 8. Awaiting application healthcheck probe (/health)..."
HEALTHY=false
for i in {1..30}; do
  RESPONSE=$(curl -sf http://localhost:3001/health || true)
  if echo "$RESPONSE" | grep -q '"status":"healthy"'; then
    echo "✓ Application container is healthy on port 3001!"
    echo "Health response: $RESPONSE"
    HEALTHY=true
    break
  fi
  echo "Waiting for app to start (attempt $i/30)..."
  sleep 2
done

if [ "$HEALTHY" != "true" ]; then
  echo "FATAL: Deployment healthcheck probe failed! App logs:"
  docker compose -f docker-compose.prod.yml logs --tail=50 app
  exit 1
fi

echo "==> 9. Testing Caddy reverse proxy on port 80 and HTTPS..."
curl -I http://localhost:80/health || true

echo "==> 10. Setting up automated daily S3 backup cron..."
chmod +x /opt/watchparty/scripts/*.sh || true
(crontab -l 2>/dev/null | grep -v 'backup-to-s3.sh' || true; echo "0 3 * * * /opt/watchparty/scripts/backup-to-s3.sh >> /var/log/watchparty-backup.log 2>&1") | crontab -

echo "======================================================="
echo "✓ WatchParty is LIVE in production on EC2!"
echo "======================================================="
docker compose -f docker-compose.prod.yml ps
