# WatchParty Production Deployment Guide

This guide provides end-to-end instructions for deploying WatchParty on a **small, low-cost ($4–$6/month), always-on server** with automatic HTTPS, persistent PostgreSQL, zero-ops backups, and zero-surprise rolling updates.

---

## 1. Architecture & Cost Breakdown

```text
       Internet (Clients & Mobile PWAs)
                     │
              Ports 80 & 443 (HTTP/2 + HTTP/3)
                     ▼
         ┌───────────────────────┐
         │     Caddy 2 Proxy     │  Automatic TLS (Let's Encrypt / ZeroSSL)
         └───────────┬───────────┘
                     │ (Internal Bridge Network)
         ┌───────────▼───────────┐
         │    WatchParty App     │  Node.js 22 LTS, WebSockets, PWA Shell
         └───┬───────────────┬───┘
             │               │
 ┌───────────▼────────┐  ┌───▼────────────────┐
 │   PostgreSQL 16    │  │      Redis 7       │
 │ + Scheduled Backup │  │ Snapshots & PubSub │
 └────────────────────┘  └────────────────────┘
```

### Estimated Running Cost: **~$4.50 – $6.00 / month**
* **VPS**: Hetzner Cloud CX22 (2 vCPU, 4 GB RAM, 40 GB NVMe, 20 TB traffic) = **€3.79/mo** (~$4.15/mo) OR DigitalOcean Basic Droplet = **$6.00/mo**.
* **SSL / TLS**: **Free** (Automated ZeroSSL / Let's Encrypt certificates managed by Caddy).
* **Database & Cache**: **Free** (Containerized PostgreSQL 16 & Redis 7 with local volumes).
* **Email**: **Free Tier** (Resend 3,000 emails/mo or Postmark).
* **Web Push**: **Free** (Direct RFC 8292 VAPID over WebPush protocol; zero external SaaS fees).

---

## 2. Primary Deployment: Small VPS with Caddy (Step-by-Step)

### Step 1: Provision a Cloud Server
1. Create a server with **Ubuntu 24.04 LTS** on Hetzner, DigitalOcean, Linode, or Vultr.
2. Note your server's public IPv4 (and IPv6 if available).

### Step 2: Configure DNS Records
At your domain registrar (Cloudflare, Namecheap, Route53, etc.), create two records:
* **`A` record**: `watchparty.example.com` &rarr; `YOUR_SERVER_IPV4`
* **`AAAA` record** (optional): `watchparty.example.com` &rarr; `YOUR_SERVER_IPV6`

---

### Step 3: Install Docker and Docker Compose
SSH into your server and run:

```bash
ssh root@YOUR_SERVER_IP

# Install official Docker engine & compose plugin
curl -fsSL https://get.docker.com | sh

# Verify installation
docker --version
docker compose version
```

---

### Step 4: Clone Repository & Create Production Directory

```bash
mkdir -p /opt/watchparty
cd /opt/watchparty

# Clone code or download release archive
git clone https://github.com/yourusername/watchparty.git .
```

---

### Step 5: Configure Production Environment (`.env`)

Copy the production template and generate cryptographically secure secrets:

```bash
cp .env.production.example .env
```

Generate your secrets using `openssl`:

```bash
# Generate JWT Secret
openssl rand -base64 32

# Generate Field Encryption Key
openssl rand -hex 32

# Generate Database Password
openssl rand -base64 24 | tr -dc 'a-zA-Z0-9'
```

Edit `.env` using `nano .env`:
```ini
NODE_ENV=production
PORT=3001
DOMAIN=watchparty.example.com
BASE_URL=https://watchparty.example.com
ACME_EMAIL=your-email@example.com

POSTGRES_USER=watchparty
POSTGRES_PASSWORD=<PASTE_GENERATED_DB_PASSWORD>
POSTGRES_DB=watchparty_db
DATABASE_URL=postgresql://watchparty:<PASTE_GENERATED_DB_PASSWORD>@postgres:5432/watchparty_db

JWT_SECRET=<PASTE_GENERATED_JWT_SECRET>
ENCRYPTION_KEY=<PASTE_GENERATED_ENCRYPTION_KEY>

MAILER_PROVIDER=resend
RESEND_API_KEY=re_your_api_key
MAIL_FROM="WatchParty" <no-reply@watchparty.example.com>
```

---

### Step 6: Launch the Production Stack

```bash
# Build and start all services (Caddy, App, Postgres, Postgres-Backup, Redis)
docker compose -f docker-compose.prod.yml up -d --build
```

Monitor container boot and migrations:

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

You should see:
```text
[Entrypoint] Running database migrations on deploy...
[Migrations] Connecting to PostgreSQL to inspect database schema...
[Migrations] Applying migration: 0001_initial_core_schema...
[Migrations] ✓ Successfully applied 0001_initial_core_schema
[Migrations] Applying migration: 0002_daily_delight_parties_and_push...
[Migrations] ✓ Successfully applied 0002_daily_delight_parties_and_push
[WatchParty Server] Running on https://watchparty.example.com (WebSocket ws://localhost:3001)
```

---

### Step 7: Verify Automatic HTTPS & Status Page

Open your browser and navigate to:
1. `https://watchparty.example.com` &rarr; Locks with valid Let's Encrypt / ZeroSSL TLS certificate!
2. `https://watchparty.example.com/status` &rarr; Real-time system health dashboard with operational metrics.
3. `https://watchparty.example.com/health` &rarr; JSON health probe (`{"status":"healthy"}`).

---

## 3. Zero-Surprise Deploys & Instant Rollback

### How Zero-Surprise Rolling Updates Work:
1. When you push to `main`, GitHub Actions runs the test suite and pushes the new container image to GitHub Container Registry (`ghcr.io`).
2. The VPS runs:
   ```bash
   docker compose -f docker-compose.prod.yml pull app
   docker compose -f docker-compose.prod.yml up -d --no-deps app
   ```
3. The outgoing app container receives `SIGTERM`:
   - It sets `isDraining = true` so readiness checks return 503 to traffic routers.
   - It sends WebSocket close code `1012` (`SERVICE_RESTART`) with reason `"Server is restarting, reconnecting..."`.
   - It immediately flushes all active room states (playlists, video positions, chat history) to durable storage and PostgreSQL.
4. The new container boots, runs any pending migrations in `docker-entrypoint.sh`, restores the active rooms, and begins accepting connections.
5. All connected mobile and desktop clients automatically reconnect within 1–2 seconds and resume synchronized playback with zero state loss.

### One-Command Instant Rollback:

If an issue ever occurs in a new release:

```bash
# Roll back to the previous stable image in one command:
./scripts/rollback.sh
```

---

## 4. Alternative Deployment: Fly.io

For a PaaS alternative with managed global Anycast edge routing:

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Authenticate: `fly auth login`
3. Launch app:
   ```bash
   fly launch --no-deploy
   ```
4. Attach a Fly Postgres cluster:
   ```bash
   fly postgres create --name watchparty-db --vm-size shared-cpu-1x --initial-cluster-size 1 --volume-size 10
   fly postgres attach watchparty-db
   ```
5. Set secrets:
   ```bash
   fly secrets set JWT_SECRET="<KEY>" ENCRYPTION_KEY="<KEY>" RESEND_API_KEY="<KEY>"
   ```
6. Deploy:
   ```bash
   fly deploy
   ```

---

## 5. Maintenance Commands Cheat Sheet

| Task | Command |
| :--- | :--- |
| View live server logs | `docker compose -f docker-compose.prod.yml logs -f app` |
| View Caddy TLS access logs | `docker compose -f docker-compose.prod.yml logs -f caddy` |
| Trigger on-demand backup | `./scripts/backup-db.sh` |
| Restore database from backup | `./scripts/restore-db.sh ./backups/watchparty_backup_XYZ.sql.gz` |
| Roll back to previous image | `./scripts/rollback.sh` |
| Inspect running containers | `docker compose -f docker-compose.prod.yml ps` |
| Restart all services | `docker compose -f docker-compose.prod.yml restart` |
| Check Postgres tables | `docker exec -it watchparty-postgres psql -U watchparty -d watchparty_db` |
