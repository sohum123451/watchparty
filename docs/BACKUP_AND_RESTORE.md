# Database Backup & Disaster Recovery Runbook

This runbook documents the automated daily backups, retention policies, on-demand snapshots, and step-by-step restoration procedures for WatchParty.

---

## 1. Automated Daily Backup Architecture

In production (`docker-compose.prod.yml`), the `postgres-backup` service automatically handles scheduled dumps with zero external cron dependencies:

- **Schedule**: Daily at midnight UTC (`@daily`).
- **Engine**: Native PostgreSQL 16 client (`pg_dump` with gzip compression level 9).
- **Target Volume**: Dedicated persistent Docker volume `pgbackups` mounted at `/backups`.
- **Retention Policy**:
  - Daily backups kept: **7 days** (`BACKUP_KEEP_DAYS=7`).
  - Weekly backups kept: **4 weeks** (`BACKUP_KEEP_WEEKS=4`).
  - Monthly backups kept: **6 months** (`BACKUP_KEEP_MONTHS=6`).
- **File Naming Format**: `watchparty_db_YYYYMMDD_HHMMSS.sql.gz`.

---

## 2. On-Demand Manual Backup

To capture a snapshot immediately before deploying major updates or migrations:

```bash
# Run the included backup script
./scripts/backup-db.sh

# Or create a backup in a custom directory
./scripts/backup-db.sh /var/backups/watchparty
```

### Manual Command Alternative (Docker CLI)

```bash
docker exec -t watchparty-postgres \
  pg_dump -U watchparty -d watchparty_db --clean --if-exists \
  | gzip -9 > ./backups/watchparty_manual_$(date +%Y%m%d_%H%M%S).sql.gz
```

---

## 3. Offsite Backup Sync (S3 / R2 / Backblaze B2)

To ensure resilience against single-datacenter loss, sync backups offsite nightly using AWS CLI or `rclone`:

```bash
# Example cron job: sync to Cloudflare R2 or AWS S3 at 03:00 UTC
# 0 3 * * * rclone sync /var/lib/docker/volumes/watchparty_pgbackups/_data r2:my-watchparty-backups --max-age 14d
```

---

## 4. Step-by-Step Restoration Procedure

### Prerequisites
1. Ensure the PostgreSQL container is running (`docker compose -f docker-compose.prod.yml ps`).
2. Identify the target backup archive (e.g. `watchparty_backup_20261015_020000.sql.gz`).

### Step 1: Put Server in Maintenance / Draining Mode
Temporarily stop the application container to avoid database write contention during restore:

```bash
docker compose -f docker-compose.prod.yml stop app
```

### Step 2: Execute Restore Script
Run the automated restore script:

```bash
./scripts/restore-db.sh ./backups/watchparty_backup_20261015_020000.sql.gz
```

The script will:
1. Prompt for confirmation (`y/N`).
2. Terminate any stray database client connections.
3. Stream the decompressed SQL statements into PostgreSQL.
4. Execute validation queries against `schema_migrations` and `users`.

### Step 3: Manual Direct Restore (Alternative)

If executing without the script:

```bash
# 1. Terminate active connections
docker exec -i watchparty-postgres psql -U watchparty -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'watchparty_db' AND pid <> pg_backend_pid();"

# 2. Stream backup into psql
gunzip -c ./backups/watchparty_backup_20261015_020000.sql.gz \
  | docker exec -i watchparty-postgres psql -U watchparty -d watchparty_db
```

### Step 4: Verification Queries

Run the following checks to confirm data integrity:

```bash
docker exec -i watchparty-postgres psql -U watchparty -d watchparty_db -c \
  "SELECT 'Migrations Applied' as check, count(*) as count FROM schema_migrations
   UNION ALL
   SELECT 'Users Registered', count(*) FROM users
   UNION ALL
   SELECT 'Friendships', count(*) FROM friendships
   UNION ALL
   SELECT 'Rooms Persisted', count(*) FROM rooms;"
```

Expected output format:
```text
       check        | count 
--------------------+-------
 Migrations Applied |     2
 Users Registered   |    42
 Friendships        |    68
 Rooms Persisted    |     5
```

### Step 5: Start Application Server

Restart the app container and verify health probes:

```bash
docker compose -f docker-compose.prod.yml start app
curl -f http://localhost:3001/health
```

---

## 5. Disaster Recovery Runbook: Cold Restore to a New Server

In the event of total server loss:

1. **Provision new VPS** (Ubuntu 24.04).
2. **Install Docker & Docker Compose**:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. **Clone repository or download release config**:
   ```bash
   git clone https://github.com/yourusername/watchparty.git /opt/watchparty
   cd /opt/watchparty
   ```
4. **Copy production `.env` and `Caddyfile`**.
5. **Start PostgreSQL only**:
   ```bash
   docker compose -f docker-compose.prod.yml up -d postgres
   ```
6. **Download latest offsite backup archive** and restore:
   ```bash
   ./scripts/restore-db.sh ./latest_backup.sql.gz
   ```
7. **Start full stack**:
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```
8. **Verify DNS A/AAAA records point to the new VPS IP**. Caddy will automatically issue fresh TLS certificates upon the first inbound HTTPS request.
