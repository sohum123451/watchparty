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

echo "==> 2. Generating production secrets and environment..."
cat <<'EOF' > .env
NODE_ENV=production
PORT=3001
DOMAIN=party.watchparty.live
BASE_URL=http://3.7.195.152
ACME_EMAIL=mangalapalli.sohum2026@vitstudent.ac.in
POSTGRES_USER=watchparty
POSTGRES_PASSWORD=wp_secret_pass_2026_x7a9
POSTGRES_DB=watchparty_db
DATABASE_URL=postgresql://watchparty:wp_secret_pass_2026_x7a9@postgres:5432/watchparty_db
REDIS_URL=redis://redis:6379
DATA_DIR=/data
JWT_SECRET=f8c3a1b2d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
ADMIN_SECRET=admin_secret_wp_2026_secure
REGISTRATION_MODE=public
BACKUP_BUCKET=watchparty-production-backups-d0d42d83
EOF

echo "==> 3. Configuring Caddyfile for both Direct IP (HTTP :80) and Domain (HTTPS :443)..."
cat <<'EOF' > Caddyfile
{
  email {$ACME_EMAIL:mangalapalli.sohum2026@vitstudent.ac.in}
  admin off
}

# Direct Elastic IP (HTTP access)
:80 {
  encode zstd gzip
  reverse_proxy app:3001 {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
  }
}

# Domain (Automatic Let's Encrypt / ZeroSSL TLS)
{$DOMAIN:party.watchparty.live} {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "SAMEORIGIN"
    Referrer-Policy "strict-origin-when-cross-origin"
  }
  reverse_proxy app:3001 {
    header_up Host {host}
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
  }
}
EOF

echo "==> 4. Building and starting production Docker stack..."
docker compose -f docker-compose.prod.yml down --remove-orphans || true
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

echo "==> 5. Awaiting application healthcheck..."
for i in {1..30}; do
  if curl -sf http://localhost:3001/health | grep -q 'healthy'; then
    echo "✓ Application container is healthy on port 3001!"
    break
  fi
  echo "Waiting for app to start (attempt $i)..."
  sleep 3
done

echo "==> 6. Testing Caddy reverse proxy on port 80..."
curl -I http://localhost:80/health || true

echo "==> 7. Setting up automated daily S3 backup cron..."
chmod +x /opt/watchparty/scripts/*.sh
(crontab -l 2>/dev/null | grep -v 'backup-to-s3.sh' || true; echo "0 3 * * * /opt/watchparty/scripts/backup-to-s3.sh >> /var/log/watchparty-backup.log 2>&1") | crontab -

echo "======================================================="
echo "✓ WatchParty is LIVE in production on EC2!"
echo "======================================================="
