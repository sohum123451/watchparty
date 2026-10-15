# Uptime Monitoring, Phone Alerting & Cost Guardrails Runbook

This guide covers real-world uptime monitoring, instant phone push/SMS alerts, error tracking (Sentry free tier), and proactive cost guardrails for running WatchParty on a low-cost ($4–$6/month) VPS without surprise bills.

---

## 1. Health & Readiness Probe Architecture

WatchParty exposes three dedicated observability endpoints:

| Endpoint | Purpose | Target Status | Typical Check Interval |
| :--- | :--- | :--- | :--- |
| `GET /health` | **Liveness Probe**: Confirms the event loop and HTTP server are active. | `200 OK` (`"status":"healthy"`) | Every 1–3 minutes |
| `GET /ready` | **Readiness Probe**: Checks Redis connectivity and zero-downtime draining state. | `200 OK` (`"ready":true`) / `503` (Draining) | Every 15–30 seconds |
| `GET /status` | **Public Status Page**: Interactive dark-mode dashboard showing uptime, database, and Redis. | `200 OK` (HTML or JSON) | On-demand / Team |

### Sample Response (`GET /health`)
```json
{
  "status": "healthy",
  "nodeId": "node_vps_1",
  "uptimeSeconds": 86420,
  "activeRooms": 3,
  "connectedSockets": 12,
  "timestamp": 1776240000000
}
```

---

## 2. Phone Alert Setup: Better Stack Uptime (Recommended)

[Better Stack Uptime](https://betterstack.com) provides a **100% free tier** with 10 monitors, 3-minute check intervals, and instant push notifications to your phone via their native iOS and Android apps.

### Step-by-Step Configuration:
1. **Create Free Account**: Sign up at [betterstack.com](https://betterstack.com) (no credit card required).
2. **Download Mobile App**: Install **Better Stack** on your iPhone or Android phone and log in.
3. **Add Monitor**:
   - **Monitor type**: `HTTP(s)`
   - **URL**: `https://<YOUR_DOMAIN>/health`
   - **Check interval**: `3 minutes` (free tier)
   - **Advanced settings**:
     - Expected status code: `200`
     - Keyword validation: `"status":"healthy"`
     - Request timeout: `10 seconds`
4. **Configure Escalation Policy**:
   - Go to **Integrations** &rarr; **Phone push notifications**.
   - Set: *"When monitor goes down &rarr; Send push notification to my phone immediately"*.
   - Enable "Critical Alerts" permission on iOS / Android so phone alerts pierce Do Not Disturb if the server goes down.

---

## 3. Webhook Alerting (Discord / Telegram / Pushover)

WatchParty includes a built-in proactive webhook alert dispatcher configured via `UPTIME_ALERT_WEBHOOK_URL` in your `.env`.

When cost limits, disk thresholds, or uncaught server exceptions occur, WatchParty dispatches rich markdown embeds directly to your phone.

### Setting up a Telegram Phone Alert (Zero-Cost):
1. Open Telegram and message `@BotFather`. Type `/newbot` and follow prompts to get your `BOT_TOKEN`.
2. Start a chat with your new bot and send a message.
3. Fetch your Chat ID:
   ```bash
   curl https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
   ```
4. Configure in production `.env`:
   ```bash
   UPTIME_ALERT_WEBHOOK_URL=https://api.telegram.org/bot<BOT_TOKEN>/sendMessage?chat_id=<CHAT_ID>
   ```

### Setting up a Discord Alert:
1. In your private Discord server, create an `#alerts` channel.
2. Go to **Channel Settings** &rarr; **Integrations** &rarr; **Create Webhook**.
3. Copy Webhook URL and paste into `.env`:
   ```bash
   UPTIME_ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz
   ```

---

## 4. Error Tracking: Sentry Free Tier

WatchParty includes a lightweight, resilient Sentry client that correlates all unhandled exceptions, WebSocket close events, and room errors with `roomId` and `userId` tags.

### Sentry Free Tier Capacity:
- **5,000 errors / month** free forever.
- Zero external native binaries or memory bloat.

### Configuration:
1. Create a project at [sentry.io](https://sentry.io) (platform: **Node.js**).
2. Copy the DSN from **Project Settings &rarr; Client Keys (DSN)**:
   ```text
   https://o123456.ingest.sentry.io/7890123
   ```
3. Set in `.env`:
   ```bash
   SENTRY_DSN=https://o123456.ingest.sentry.io/7890123
   CLIENT_SENTRY_DSN=https://o123456.ingest.sentry.io/7890123
   SENTRY_ENVIRONMENT=production
   ```
4. Restart the server. Any unhandled rejections, HTTP 500s, or browser client errors will appear in Sentry with full breadcrumbs:
   ```json
   {
     "tags": {
       "roomId": "room_friday_movie",
       "userId": "usr_98a7bc",
       "environment": "production"
     }
   }
   ```

---

## 5. Usage & Cost Guardrails

To prevent unexpected billing or dropped messages on free tiers, WatchParty automatically tracks:

### 1. Transactional Email Quotas
- **Resend Free Tier**: 100 emails/day, 3,000 emails/month.
- **Postmark Free Tier**: 100 emails/month.
- **Threshold Warnings**:
  - `80% Used` (&ge; 80 emails/day): Amber warning banner on `/admin` dashboard.
  - `95% Used` (&ge; 95 emails/day): Critical alert dispatched via webhook; recommends switching to invite-only registration.

### 2. VPS Storage & Backups
- **Small VPS Disk**: ~20GB–40GB total disk on $4–$6 VPS.
- **Data Dir Warning Threshold**: 2,000 MB (2 GB).
- Automatically cleans up local PostgreSQL backups older than 14 days.

### 3. Bandwidth
- Outbound & inbound WebSocket traffic is recorded in memory and displayed in MB on `/admin`.

---

## 6. Incident Response & Emergency Kill Switch

If spam accounts or malicious activity occurs, use the emergency admin tooling at `https://<YOUR_DOMAIN>/admin`:

1. **Activate Kill Switch**:
   - Click **Change Mode** in the header.
   - Select **🚨 Emergency Kill Switch (Disable signups entirely)**.
   - Instantly rejects all new `/api/auth/signup` requests with HTTP 403 `REGISTRATION_DISABLED`.
2. **Ban Offender**:
   - Find the user in the **Users** tab.
   - Click **Ban**.
   - Instantly:
     - Marks account as banned in the database.
     - Revokes all refresh tokens and session families.
     - Disconnects all active WebSocket connections with close code `4003`.
     - Rejects any future login or token refresh attempts.
3. **Force Close Room**:
   - If an abusive room is active, click **Close** in the **Active Rooms** tab.
   - Sends a notification to all participants and tears down the room state.
