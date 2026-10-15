output "elastic_ip" {
  description = "Static Elastic Public IPv4 address. Point your DNS A record (e.g. watchparty.example.com) to this IP."
  value       = aws_eip.app_eip.public_ip
}

output "instance_id" {
  description = "EC2 Instance ID for AWS SSM Session Manager and CI/CD deployments"
  value       = aws_instance.app_server.id
}

output "s3_backup_bucket" {
  description = "Private encrypted S3 bucket for daily database dumps and uploads"
  value       = aws_s3_bucket.backups.id
}

output "ssm_connect_command" {
  description = "Zero-open-port command to open an instant shell terminal via AWS Systems Manager"
  value       = "aws ssm start-session --target ${aws_instance.app_server.id} --region ${var.aws_region}"
}

output "dns_records_required" {
  description = "Summary of DNS records needed in your domain registrar (Namecheap, Cloudflare, Route53, etc.)"
  value = {
    a_record = {
      name  = var.domain_name
      type  = "A"
      value = aws_eip.app_eip.public_ip
      ttl   = 300
    }
    ses_dkim_cname_records = [
      for token in aws_ses_domain_dkim.domain_dkim.dkim_tokens : {
        name  = "${token}._domainkey.${var.domain_name}"
        type  = "CNAME"
        value = "${token}.dkim.amazonses.com"
        ttl   = 300
      }
    ]
    ses_mail_from_mx = {
      name  = "mail.${var.domain_name}"
      type  = "MX"
      value = "10 feedback-smtp.${var.aws_region}.amazonses.com"
      ttl   = 300
    }
    ses_mail_from_spf = {
      name  = "mail.${var.domain_name}"
      type  = "TXT"
      value = "v=spf1 include:amazonses.com ~all"
      ttl   = 300
    }
    dmarc_record = {
      name  = "_dmarc.${var.domain_name}"
      type  = "TXT"
      value = "v=DMARC1; p=quarantine; pct=100; adkim=r; aspf=r; rua=mailto:dmarc-reports@${var.domain_name}"
      ttl   = 300
    }
  }
}
