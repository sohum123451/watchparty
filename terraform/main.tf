terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(
      {
        Project     = var.project_name
        Environment = var.environment
        ManagedBy   = "Terraform"
        CostCenter  = "WatchParty-Friends"
      },
      var.tags
    )
  }
}

# Unique suffix for S3 bucket namespace
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# ==============================================================================
# 1. MINIMAL VPC ARCHITECTURE (ZERO NAT GATEWAY CHARGES: $0/MONTH)
# ==============================================================================
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${var.project_name}-${var.environment}-vpc"
  }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-${var.environment}-igw"
  }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
  availability_zone       = "${var.aws_region}a"

  tags = {
    Name = "${var.project_name}-${var.environment}-public-subnet"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ==============================================================================
# 2. SECURITY GROUP (PORTS 80/443 ONLY; ZERO-PORT ACCESS VIA SSM SESSION MGR)
# ==============================================================================
resource "aws_security_group" "app_sg" {
  name        = "${var.project_name}-${var.environment}-sg"
  description = "Allows inbound HTTP, HTTPS, HTTP/3 QUIC. Zero open SSH port required with SSM."
  vpc_id      = aws_vpc.main.id

  # HTTP (ACME TLS Challenge & Automated Redirect to HTTPS)
  ingress {
    description = "HTTP - Lets Encrypt and ZeroSSL ACME challenge"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTPS (TLS Web Application & WebSockets)
  ingress {
    description = "HTTPS - Caddy Reverse Proxy & WebSocket Gateway"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTP/3 (QUIC / UDP)
  ingress {
    description = "HTTP/3 QUIC - Low-latency UDP transport"
    from_port   = 443
    to_port     = 443
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Optional restricted SSH (Only if enable_ssh = true)
  dynamic "ingress" {
    for_each = var.enable_ssh ? [1] : []
    content {
      description = "Restricted SSH access from admin IP"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [var.admin_ip_cidr]
    }
  }

  # All outbound traffic permitted (package updates, container pulls, S3 backups)
  egress {
    description = "Permit all outbound egress traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-${var.environment}-sg"
  }
}

# ==============================================================================
# 3. LEAST-PRIVILEGE IAM ROLE & INSTANCE PROFILE
# ==============================================================================
resource "aws_iam_role" "ec2_role" {
  name = "${var.project_name}-${var.environment}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

# Attach AWS Systems Manager (SSM) Managed Policy for secure console & CLI terminal access
resource "aws_iam_role_policy_attachment" "ssm_managed" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Least-Privilege S3 Policy for Backups & Uploads
resource "aws_iam_policy" "s3_access" {
  name        = "${var.project_name}-${var.environment}-s3-policy"
  description = "Allows the EC2 instance to upload and download database backups from its S3 bucket"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.backups.arn,
          "${aws_s3_bucket.backups.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "s3_access_attach" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = aws_iam_policy.s3_access.arn
}

# Least-Privilege SES Policy for Email Verification & Notifications
resource "aws_iam_policy" "ses_send" {
  name        = "${var.project_name}-${var.environment}-ses-policy"
  description = "Allows EC2 instance to send transactional emails via Amazon SES"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "ses:FromAddress" = "no-reply@${var.domain_name}"
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ses_send_attach" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = aws_iam_policy.ses_send.arn
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "${var.project_name}-${var.environment}-instance-profile"
  role = aws_iam_role.ec2_role.name
}

# ==============================================================================
# 4. S3 BUCKET (ENCRYPTED, PRIVATE, WITH AUTOMATIC LIFECYCLE PRUNING)
# ==============================================================================
resource "aws_s3_bucket" "backups" {
  bucket        = "${var.project_name}-${var.environment}-backups-${random_id.bucket_suffix.hex}"
  force_destroy = false

  tags = {
    Name = "${var.project_name}-backups"
  }
}

# Block all public access
resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Server-Side Encryption (SSE-S3 AES-256 for zero KMS fee overhead)
resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# S3 Lifecycle Rules: Expire daily backups after retention period & abort ghost uploads
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire_old_database_backups"
    status = "Enabled"

    filter {
      prefix = "backups/"
    }

    expiration {
      days = var.backup_retention_days
    }
  }

  rule {
    id     = "abort_incomplete_multipart_uploads"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# ==============================================================================
# 5. EC2 INSTANCE (ARM64 GRAVITON2 t4g.small) & ELASTIC IP
# ==============================================================================
# Fetch the latest official Ubuntu 24.04 LTS Noble ARM64 AMI
data "aws_ami" "ubuntu_arm64" {
  most_recent = true
  owners      = ["099720109477"] # Canonical official account ID

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }
}

resource "aws_instance" "app_server" {
  ami                  = data.aws_ami.ubuntu_arm64.id
  instance_type        = var.instance_type
  subnet_id            = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.app_sg.id]
  iam_instance_profile = aws_iam_instance_profile.ec2_profile.name

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    encrypted             = true
    delete_on_termination = true
    tags = {
      Name = "${var.project_name}-root-ebs"
    }
  }

  user_data = templatefile("${path.module}/user_data.sh", {
    backup_bucket = aws_s3_bucket.backups.id
    aws_region    = var.aws_region
    domain_name   = var.domain_name
  })

  tags = {
    Name = "${var.project_name}-${var.environment}-server"
  }
}

# Fixed Static Elastic IP (never changes on reboot/stop)
resource "aws_eip" "app_eip" {
  instance = aws_instance.app_server.id
  domain   = "vpc"

  depends_on = [aws_internet_gateway.igw]

  tags = {
    Name = "${var.project_name}-eip"
  }
}

# ==============================================================================
# 6. AMAZON SES DOMAIN VERIFICATION & EASY DKIM
# ==============================================================================
resource "aws_ses_domain_identity" "domain" {
  domain = var.domain_name
}

resource "aws_ses_domain_dkim" "domain_dkim" {
  domain = aws_ses_domain_identity.domain.domain
}

# Mail-from subdomain for strict SPF alignment
resource "aws_ses_domain_mail_from" "mail_from" {
  domain           = aws_ses_domain_identity.domain.domain
  mail_from_domain = "mail.${var.domain_name}"
}

# ==============================================================================
# 7. AWS BUDGET COST CONTROLS WITH 50% / 80% / 100% THRESHOLD ALERTS
# ==============================================================================
resource "aws_budgets_budget" "monthly_budget" {
  name              = "${var.project_name}-monthly-cost-control"
  budget_type       = "COST"
  limit_amount      = tostring(var.monthly_budget_usd)
  limit_unit        = "USD"
  time_unit         = "MONTHLY"
  time_period_start = "2026-01-01_00:00"

  # Alert 1: 50% Actual Spend Threshold ($7.50 on $15 budget)
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_alert_emails
  }

  # Alert 2: 80% Actual Spend Threshold ($12.00 on $15 budget)
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.budget_alert_emails
  }

  # Alert 3: 100% Forecasted/Actual Spend Threshold ($15.00)
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_alert_emails
  }
}
