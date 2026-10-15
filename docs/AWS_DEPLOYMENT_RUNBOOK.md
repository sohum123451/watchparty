# WatchParty - AWS Deployment & Operations Runbook

> **Target Audience**: Small friend groups & communities (5–50 concurrent users).  
> **Philosophy**: The cheapest reliable architecture on AWS. Zero bloated enterprise services. Zero open SSH ports. Automated backups, instant rollbacks, and built-in budget circuit breakers.

---

## 1. Architecture Blueprint & Cost Philosophy

### The "Cheap & Reliable" Architecture
Standard AWS enterprise tutorials recommend Multi-AZ RDS, an Application Load Balancer (ALB), private subnets, and NAT Gateways. That architecture costs **$80–$140/month** before even serving a single video stream!

WatchParty uses an optimized, battle-tested single-node architecture costing **~$13–$16/month** (or ~$9–$11/month on a 1-year Savings Plan):

```mermaid
graph TD
    User["Users & Friend Group (Web Browser / Mobile PWA)"] -->|HTTPS (443) / HTTP/3 (UDP 443)| EIP["Elastic IP (Static IPv4)"]
    EIP --> SG["Security Group (80, 443 TCP/UDP only - 0 Open SSH Ports)"]
    
    subgraph "Single Public Subnet (No NAT Gateway = $0/mo)"
        subgraph "EC2 t4g.small (ARM64 Graviton2: 2 vCPU, 2GB RAM + 2GB Swap)"
            Caddy["Caddy 2 Reverse Proxy (Automatic Let's Encrypt TLS)"]
            App["WatchParty Node.js Real-Time App (:3001)"]
            PG["PostgreSQL 16 (Persistent gp3 EBS)"]
            Redis["Redis 7 (Snapshot Persistence & Pub/Sub)"]
            SSM["AWS SSM Agent (IAM Managed Session Shell)"]
            
            Caddy -->|Reverse Proxy & WebSockets| App
            App --> PG
            App --> Redis
        end
    end

    App -.->|Transactional Emails| SES["Amazon SES (DKIM / SPF / DMARC)"]
    PG -.->|Daily pg_dump (cron)| S3["Private Encrypted S3 Bucket (30-day lifecycle)"]
    Admin["Admin / CI-CD"] -->|AWS SSM Session Manager| SSM
```

---

## 2. Realistic Monthly Cost Estimate (Post-Free-Tier / After Credits)

| AWS Resource | Specification | On-Demand (Monthly) | 1-Yr Savings Plan (Monthly) | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **EC2 Compute** | `t4g.small` (ARM64, 2 vCPU, 2 GB RAM) | $12.26 | $7.59 | 20% cheaper & higher performance than x86 `t3.small`. |
| **EBS Storage** | 20 GB `gp3` (3000 IOPS, 125 MB/s baseline) | $1.60 | $1.60 | High-speed SSD for DB data & OS. |
| **Public IPv4 (EIP)**| In-use Elastic IP ($0.005/hr) | $3.65 | $3.65 | AWS standard IPv4 charge since Feb 2024. |
| **S3 Storage** | ~2–5 GB daily backups (gzipped & encrypted) | $0.07 | $0.07 | Standard S3; auto-pruned after 30 days. |
| **Amazon SES** | ~1,000 auth/invite emails / month | $0.10 | $0.10 | First 62k emails/mo free if sent from EC2, or $0.10/1k. |
| **Data Transfer Out**| ~50–100 GB / month (chat, sync pings, state) | $0.00 | $0.00 | **First 100 GB/month data transfer out is 100% free** on AWS! |
| **AWS Budget & SSM** | AWS Budgets (2 free), SSM Session Manager | $0.00 | $0.00 | Native AWS free tier tools. |
| **TOTAL ESTIMATED** | **All-in monthly operational cost** | **~$17.68 / month** | **~$13.01 / month** | **Less than $0.35/user/month** for a group of 50. |

---

## 3. Services to AVOID: The AWS "Money Pits"

When deploying on a tight budget, **never enable these services**:

1. ❌ **AWS NAT Gateway** ($32.85/month base + $0.045/GB data processing)
   - *Why tutorials recommend it*: To give private subnets outbound internet.
   - *Why we avoid it*: Our EC2 instance sits in a public subnet with a Security Group blocking all ingress except 80/443. Outbound internet is free via the Internet Gateway ($0).
2. ❌ **Application Load Balancer (ALB)** ($16.20/month base + LCU data fees)
   - *Why tutorials recommend it*: For SSL termination and multi-server balancing.
   - *Why we avoid it*: Caddy handles SSL certificates (Let's Encrypt / ZeroSSL auto-renewal), HTTP/2, HTTP/3 QUIC, and WebSocket reverse proxying directly on the instance for $0.
3. ❌ **Multi-AZ Amazon RDS PostgreSQL** (~$35–$60/month minimum)
   - *Why tutorials recommend it*: Automated managed failover.
   - *Why we avoid it*: For 5–50 friends, a Dockerized Postgres 16 instance with persistent EBS storage and automated daily S3 backups provides 99.9% reliability for $0 extra.
4. ❌ **AWS Transit Gateway & PrivateLink** ($36.50/month per attachment)
   - Completely unnecessary for single-VPC apps.
5. ❌ **CloudWatch Detailed Monitoring (1-minute metrics)** ($2.10/instance/month)
   - Default basic monitoring (5-minute intervals) is completely free and sufficient.

---

## 4. Step-by-Step Initial Deployment

### Step 4.1: Provision Infrastructure via Terraform

1. Clone repository and navigate to `terraform/`:
   ```bash
   cd terraform
   cp terraform.tfvars.example terraform.tfvars
   ```

2. Edit `terraform.tfvars`:
   ```hcl
   aws_region          = "us-east-1" # Set to region closest to your friend group
   project_name        = "watchparty"
   domain_name         = "party.yourdomain.com"
   acme_email          = "admin@yourdomain.com"
   monthly_budget_usd  = 15.00
   budget_alert_emails = ["admin@yourdomain.com"]
   ```

3. Initialize and apply:
   ```bash
   terraform init
   terraform apply
   ```

4. Note down the outputs:
   - `elastic_ip`: e.g. `54.210.12.34`
   - `instance_id`: e.g. `i-0a1b2c3d4e5f67890`
   - `s3_backup_bucket`: e.g. `watchparty-production-backups-9a4f21b`
   - `dns_records_required`: DNS entries for your registrar.

---

### Step 4.2: Configure DNS Records at Your Domain Registrar

In Cloudflare, Namecheap, Route 53, or your registrar, add the following records:

| Record Type | Host / Name | Value / Target | TTL | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **A** | `party` (or `@`) | `<elastic_ip>` | 300 | Routes web traffic to EC2 |
| **CNAME** | `<token1>._domainkey` | `<token1>.dkim.amazonses.com` | 300 | SES Easy DKIM verification |
| **CNAME** | `<token2>._domainkey` | `<token2>.dkim.amazonses.com` | 300 | SES Easy DKIM verification |
| **CNAME** | `<token3>._domainkey` | `<token3>.dkim.amazonses.com` | 300 | SES Easy DKIM verification |
| **MX** | `mail.party` | `10 feedback-smtp.<region>.amazonses.com` | 300 | SES Custom MAIL FROM domain |
| **TXT** | `mail.party` | `v=spf1 include:amazonses.com ~all` | 300 | SPF email authentication |
| **TXT** | `_dmarc.party` | `v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc@yourdomain.com` | 300 | DMARC anti-spoofing policy |

---

### Step 4.3: Request Amazon SES Production Access

By default, Amazon SES accounts are placed in the **SES Sandbox** (can only send up to 200 emails/day to pre-verified addresses). To send invitations and password resets to your friend group:

1. Open AWS Console -> **Amazon SES** -> **Account dashboard**.
2. Click **Request production access** (top right banner).
3. Fill in the request details using this **proven, fast-approval template**:
   - **Mail type**: *Transactional*
   - **Website URL**: `https://party.yourdomain.com`
   - **Use case description**:
     ```text
     We are deploying WatchParty (https://party.yourdomain.com), an open-source, private co-watching application for an authenticated private community of 5 to 50 active members. 
     SES will strictly be used for transactional user lifecycle emails:
     1. New user registration email verification tokens.
     2. Password reset requests.
     3. Direct room invitation links initiated by authenticated hosts.

     We will not send marketing, bulk, or promotional emails. 
     All recipients must explicitly opt in during signup. We have configured Easy DKIM (3 CNAMEs), custom MAIL FROM with SPF, and a strict DMARC quarantine policy. Bounces and complaints are monitored via Amazon SNS and automatically deactivated in our user database.
     ```
4. Approvals typically complete within **4–12 hours**.

---

### Step 4.4: Connect to the Server via AWS SSM (Zero SSH Open Ports)

No SSH private key file or open port 22 is needed. Connect securely using the AWS CLI:

```bash
# Connect directly to interactive shell as root/ubuntu
aws ssm start-session --target <instance_id> --region <aws_region>

# Switch to ubuntu user
sudo su - ubuntu
cd /opt/watchparty
```

---

### Step 4.5: Initial Application Launch

1. Check out repository into `/opt/watchparty`:
   ```bash
   cd /opt/watchparty
   git clone https://github.com/yourusername/watchparty.git .
   ```

2. Populate production environment file:
   ```bash
   cp .env.production.example .env
   nano .env
   ```
   *Generate secrets securely*:
   ```bash
   # JWT_SECRET:
   openssl rand -base64 32
   # ENCRYPTION_KEY:
   openssl rand -hex 32
   # POSTGRES_PASSWORD:
   openssl rand -base64 24 | tr -dc 'a-zA-Z0-9'
   # ADMIN_SECRET:
   openssl rand -hex 24
   ```

3. Launch the Docker stack:
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

4. Verify all containers are running and healthy:
   ```bash
   docker compose -f docker-compose.prod.yml ps
   curl -I https://party.yourdomain.com/health
   ```
   *Caddy automatically requests, verifies, and installs the Let's Encrypt TLS certificate within 10 seconds of DNS propagation.*

---

## 5. Automated Daily S3 Backups & Disaster Recovery

### Step 5.1: Automatic Daily Cron Setup
The user data script creates `/opt/watchparty/.aws_env`. Add a root cron job to run the backup every night at 03:00 UTC:

```bash
sudo crontab -e
```
Add line:
```cron
0 3 * * * /opt/watchparty/scripts/backup-to-s3.sh >> /var/log/watchparty-backup.log 2>&1
```

### Step 5.2: Manual S3 Backup Test
```bash
cd /opt/watchparty
./scripts/backup-to-s3.sh

# Verify backup in S3:
aws s3 ls s3://$BACKUP_BUCKET/backups/
```

### Step 5.3: Tested Disaster Recovery / Database Restore
If the database volume is corrupted or accidental data loss occurs:

1. **Restore Latest S3 Backup**:
   ```bash
   cd /opt/watchparty
   ./scripts/restore-from-s3.sh --latest
   ```

2. **Restore Specific S3 Snapshot**:
   ```bash
   ./scripts/restore-from-s3.sh s3://my-bucket/backups/watchparty_backup_20261015_030000.sql.gz
   ```

3. **Verify Integrity**:
   The script terminates active connections, applies the dump, and verifies user and room counts automatically.

---

## 6. CI/CD Deployment & One-Command Rollback

### Step 6.1: Configure GitHub Actions Secrets
In your GitHub repository -> **Settings** -> **Secrets and variables** -> **Actions**, add:

| Secret Name | Value | Purpose |
| :--- | :--- | :--- |
| `AWS_ACCESS_KEY_ID` | IAM deployment user access key | For SSM deployment dispatch |
| `AWS_SECRET_ACCESS_KEY` | IAM deployment user secret key | For SSM deployment dispatch |
| `AWS_EC2_INSTANCE_ID` | `i-0a1b2c3d4e5f67890` | Target EC2 instance |
| `AWS_REGION` | `us-east-1` (or your region) | AWS region |

*(Optional)* If deploying via SSH instead of SSM:
- `DEPLOY_HOST`: Elastic IP address
- `DEPLOY_SSH_KEY`: Private SSH key
- `DEPLOY_USER`: `ubuntu`

### Step 6.2: One-Command Instant Rollback

#### Method A: Via GitHub Actions UI (1-Click)
1. Navigate to **Actions** -> **AWS Deploy & Rollback Pipeline**.
2. Click **Run workflow**.
3. Select `Action`: **rollback**.
4. (Optional) Provide specific `rollback_tag` (or leave empty to roll back to the previously recorded `.last_deployed_tag`).
5. Click **Run workflow**. The runner executes the rollback over SSM and verifies health within 15 seconds.

#### Method B: Via Server CLI (Instant)
```bash
aws ssm start-session --target <instance_id>
cd /opt/watchparty

# Rollback to immediate prior image:
./scripts/rollback.sh

# Or rollback to explicit SHA/tag:
./scripts/rollback.sh sha-a1b2c3d
```

---

## 7. Zero-Downtime Secret Rotation

### 7.1 Rotating Field Encryption Key (`ENCRYPTION_KEY`)
WatchParty supports zero-downtime key rotation using `ENCRYPTION_KEY_FALLBACKS`:

1. Generate a new 64-character hex key:
   ```bash
   NEW_KEY=$(openssl rand -hex 32)
   echo $NEW_KEY
   ```
2. In `.env`:
   - Copy current `ENCRYPTION_KEY` to `ENCRYPTION_KEY_FALLBACKS`.
   - Set `ENCRYPTION_KEY` to the `$NEW_KEY`.
3. Restart app container:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --no-deps app
   ```
   *The application writes all new data using the primary key while seamlessly reading existing records encrypted with fallback keys.*

### 7.2 Rotating JWT Signing Secret (`JWT_SECRET`)
1. Generate new secret: `openssl rand -base64 32`.
2. Update `JWT_SECRET` in `.env`.
3. Restart app: `docker compose -f docker-compose.prod.yml up -d --no-deps app`.
   *Active users will seamlessly refresh their 15-minute access token using their rotating refresh token cookie without logging out.*

### 7.3 Rotating PostgreSQL Password
1. Generate new password: `openssl rand -base64 24 | tr -dc 'a-zA-Z0-9'`.
2. Update Postgres user password inside running database:
   ```bash
   docker exec -it watchparty-postgres psql -U watchparty -d watchparty_db -c "ALTER USER watchparty WITH PASSWORD 'NEW_PASSWORD';"
   ```
3. Update `POSTGRES_PASSWORD` and `DATABASE_URL` in `.env`.
4. Recreate app container:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --no-deps app
   ```

---

## 8. Instance Resizing (Upgrading from t4g.small to t4g.medium)

If your community expands and requires more memory (e.g. running 10+ concurrent video rooms):

1. Stop the EC2 instance (takes ~20 seconds):
   ```bash
   aws ec2 stop-instances --instance-ids <instance_id>
   aws ec2 wait instance-stopped --instance-ids <instance_id>
   ```
2. Modify instance type:
   ```bash
   aws ec2 modify-instance-attribute --instance-id <instance_id> --instance-type "{\"Value\": \"t4g.medium\"}"
   ```
3. Start instance:
   ```bash
   aws ec2 start-instances --instance-ids <instance_id>
   ```
4. **Zero Configuration Changes Needed**:
   - The **Elastic IP remains attached**.
   - The **EBS persistent drive remains attached**.
   - Docker containers resume automatically with `restart: unless-stopped`.
   - Total downtime: **~90 seconds**.

---

## 9. Complete Teardown & Clean Destruction

To decommission all resources and guarantee zero ongoing charges:

```bash
cd terraform

# 1. Empty S3 backup bucket (AWS prevents deleting non-empty buckets)
BUCKET_NAME=$(terraform output -raw s3_backup_bucket)
aws s3 rm s3://${BUCKET_NAME} --recursive

# 2. Destroy all AWS resources
terraform destroy -auto-approve
```
*Outputs confirmation that VPC, EC2, Elastic IP, S3 bucket, SES identity, and AWS Budgets are cleanly eliminated.*
