#!/usr/bin/env bash
set -euxo pipefail

# ==============================================================================
# WatchParty - EC2 Bootstrap User Data (Ubuntu 24.04 LTS ARM64)
# Configures Docker, Docker Compose, 2GB Swap, AWS CLI, SSM Agent & Log Rotation
# ==============================================================================

export DEBIAN_FRONTEND=noninteractive

echo "==> 1. Updating base packages..."
apt-get update -y
apt-get install -y --no-install-recommends \
  apt-transport-https \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  git \
  jq \
  unzip \
  gzip \
  cron

echo "==> 2. Configuring 2GB Swap to prevent OOM on t4g.small (2GB RAM)..."
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Optimize swappiness for low-memory VPS
  sysctl vm.swappiness=15
  echo 'vm.swappiness=15' >> /etc/sysctl.conf
  sysctl vm.vfs_cache_pressure=50
  echo 'vm.vfs_cache_pressure=50' >> /etc/sysctl.conf
fi

echo "==> 3. Installing Official Docker Engine & Docker Compose Plugin..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Configure Docker daemon log rotation to prevent disk exhaustion
mkdir -p /etc/docker
cat <<'EOF' > /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

systemctl daemon-reload
systemctl enable docker
systemctl restart docker

# Add default ubuntu user to docker group
usermod -aG docker ubuntu || true

echo "==> 4. Installing AWS CLI v2 (ARM64)..."
curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"
unzip -q awscliv2.zip
./aws/install --update
rm -rf aws awscliv2.zip

echo "==> 5. Ensuring Amazon SSM Agent is active..."
snap install amazon-ssm-agent --classic || apt-get install -y amazon-ssm-agent || true
systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent.service || systemctl enable amazon-ssm-agent || true
systemctl start snap.amazon-ssm-agent.amazon-ssm-agent.service || systemctl start amazon-ssm-agent || true

echo "==> 6. Setting up application directory structure at /opt/watchparty..."
mkdir -p /opt/watchparty/{data,backups,scripts,caddy_data,caddy_config}
chown -R ubuntu:ubuntu /opt/watchparty

# Export environment metadata for S3 backup scripts
cat <<EOF > /opt/watchparty/.aws_env
BACKUP_BUCKET="${backup_bucket}"
AWS_DEFAULT_REGION="${aws_region}"
DOMAIN="${domain_name}"
EOF
chmod 600 /opt/watchparty/.aws_env
chown ubuntu:ubuntu /opt/watchparty/.aws_env

echo "==> 7. Bootstrap finished successfully!"
