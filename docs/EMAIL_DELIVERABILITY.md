# Transactional Email & Deliverability Guide (SPF, DKIM, DMARC)

To guarantee that user registration verification, password reset, and watch party invitation emails reach the inbox (avoiding Spam / Junk folders in Gmail, Outlook, Apple Mail, and Yahoo), you must configure your domain's DNS authentication records.

---

## 1. Supported Transactional Providers

WatchParty supports three production transactional email providers out of the box:

| Provider | Configuration Key | Recommended For | Free / Low-Cost Tier |
| :--- | :--- | :--- | :--- |
| **Resend** (Recommended) | `MAILER_PROVIDER=resend`<br>`RESEND_API_KEY=re_...` | Modern REST API, fastest setup, intuitive dashboard | 3,000 emails/month free |
| **Postmark** | `MAILER_PROVIDER=postmark`<br>`POSTMARK_SERVER_TOKEN=...` | Highest industry inbox placement, ultra-fast delivery (&lt;1.5s) | 100 emails/month free, then $15/mo |
| **AWS SES / SMTP** | `MAILER_PROVIDER=smtp`<br>`SMTP_HOST=...` | High volume, rock-bottom cost ($0.10 per 1,000 emails) | 62,000 emails/mo free on EC2 |

---

## 2. DNS Authentication Records (Step-by-Step)

Assume your domain is `example.com` and you send emails from `no-reply@example.com` (`MAIL_FROM="WatchParty <no-reply@example.com>"`).

Add the following DNS records to your DNS registrar (Cloudflare, Namecheap, Porkbun, Route53, etc.):

### Record 1: SPF (Sender Policy Framework)
Authorizes the provider's mail transfer agents (MTAs) to send mail on behalf of your domain.

* **Type**: `TXT`
* **Host / Name**: `@` (or `example.com`)
* **Value (for Resend)**:
  ```text
  v=spf1 include:_spf.resend.com ~all
  ```
* **Value (for Postmark)**:
  ```text
  v=spf1 include:spf.mtasv.net ~all
  ```
* **Value (for AWS SES)**:
  ```text
  v=spf1 include:amazonses.com ~all
  ```

> [!IMPORTANT]
> A domain should **only have ONE SPF TXT record**. If you already use Google Workspace or Microsoft 365, merge them into a single record:
> `v=spf1 include:_spf.google.com include:_spf.resend.com ~all`

---

### Record 2: DKIM (DomainKeys Identified Mail)
Attaches an asymmetric cryptographic signature to every outgoing email header, ensuring the content is tamper-proof in transit.

Both Resend and Postmark generate **3 CNAME records** in their dashboard under **Domains -> Add Domain**.

Example CNAMEs (from Resend):
| Type | Name / Host | Target / Value |
| :--- | :--- | :--- |
| `CNAME` | `resend._domainkey.example.com` | `dkim.resend.com.` |
| `CNAME` | `resend2._domainkey.example.com` | `dkim2.resend.com.` |
| `CNAME` | `resend3._domainkey.example.com` | `dkim3.resend.com.` |

Example CNAMEs (from Postmark):
| Type | Name / Host | Target / Value |
| :--- | :--- | :--- |
| `TXT` | `20261015._domainkey.example.com` | `k=rsa; p=MIGfMA0GCSqGSIb3...` |

---

### Record 3: DMARC (Policy & Alignment)
Enforces SPF and DKIM validation policies across all global receiving mail servers (Gmail, Yahoo, Outlook mandatory standard since Feb 2024).

* **Type**: `TXT`
* **Host / Name**: `_dmarc` (or `_dmarc.example.com`)
* **Recommended Initial Policy (Monitoring)**:
  ```text
  v=DMARC1; p=none; pct=100; rua=mailto:dmarc-reports@example.com; sp=none; aspf=r; adkim=r
  ```
* **Production Enforced Policy (After 7 days of 100% pass rate)**:
  ```text
  v=DMARC1; p=quarantine; pct=100; rua=mailto:dmarc-reports@example.com; fo=1
  ```

Parameters explained:
- `p=quarantine`: Messages failing authentication are placed in spam instead of being accepted into the inbox.
- `rua=mailto:...`: Aggregate XML reports will be delivered to this inbox to alert you of spoofing attempts.
- `pct=100`: Policy applies to 100% of outbound messages.

---

### Record 4: Custom Return-Path (Bounce Domain)
Allows SPF alignment to achieve a **10/10 Score** on Mail-Tester:

* **Type**: `CNAME`
* **Host / Name**: `bounces` (or `bounces.example.com`)
* **Value (for Resend)**: `feedback.resend.com`
* **Value (for Postmark)**: `pm.mtasv.net`

---

## 3. Environment Configuration in WatchParty

In your production `.env`:

```bash
# If using Resend:
MAILER_PROVIDER=resend
RESEND_API_KEY=re_123456789_abcdef
MAIL_FROM="WatchParty" <no-reply@example.com>

# If using Postmark:
MAILER_PROVIDER=postmark
POSTMARK_SERVER_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MAIL_FROM="WatchParty" <no-reply@example.com>
```

---

## 4. Testing & Verification Checklist

1. Send a test email from WatchParty:
   - Trigger a verification email by registering a new test user account.
   - Or trigger a password reset from `/app`.
2. Inspect headers in Gmail:
   - Click the 3 dots in the upper right -> **"Show original"**.
   - Confirm all three checks pass:
     - `SPF: PASS` with IP ...
     - `DKIM: PASS` with domain `example.com`
     - `DMARC: PASS`
3. Online Testing Tool:
   - Send an email to [mail-tester.com](https://www.mail-tester.com).
   - Target Score: **10/10** (Passes SPF, DKIM, DMARC, Reverse DNS, and SpamAssassin checks).
