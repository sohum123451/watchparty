variable "aws_region" {
  type        = string
  description = "AWS Region nearest to your user group (e.g. us-east-1, us-west-2, eu-central-1, ap-southeast-1)"
  default     = "us-east-1"
}

variable "project_name" {
  type        = string
  description = "Project name used for resource naming and tagging"
  default     = "watchparty"
}

variable "environment" {
  type        = string
  description = "Environment identifier (e.g. production, staging)"
  default     = "production"
}

variable "domain_name" {
  type        = string
  description = "Apex or subdomain for WatchParty (e.g. watchparty.example.com)"
  default     = "watchparty.example.com"
}

variable "acme_email" {
  type        = string
  description = "Admin email address for Let's Encrypt / ZeroSSL TLS certificate notifications"
  default     = "admin@example.com"
}

variable "instance_type" {
  type        = string
  description = "EC2 ARM64 instance type (t4g.small offers 2 vCPUs, 2 GB RAM Graviton2 for ~$12/month)"
  default     = "t4g.small"
}

variable "root_volume_size_gb" {
  type        = number
  description = "Size of root gp3 EBS volume in GB"
  default     = 20
}

variable "enable_ssh" {
  type        = bool
  description = "Whether to open port 22 in Security Group. Default is false (AWS SSM Session Manager provides secure zero-open-port shell access)."
  default     = false
}

variable "admin_ip_cidr" {
  type        = string
  description = "Admin IP CIDR for SSH access if enable_ssh is true (e.g. 203.0.113.4/32)"
  default     = "127.0.0.1/32"
}

variable "monthly_budget_usd" {
  type        = number
  description = "Monthly budget limit in USD for AWS Budget cost alerts"
  default     = 15.0
}

variable "budget_alert_emails" {
  type        = list(string)
  description = "Email addresses to receive budget alerts at 50%, 80%, and 100% thresholds"
  default     = ["admin@example.com"]
}

variable "backup_retention_days" {
  type        = number
  description = "Number of days before S3 database backups expire"
  default     = 30
}

variable "tags" {
  type        = map(string)
  description = "Additional tags to apply to all resources"
  default     = {}
}
