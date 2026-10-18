# WatchParty

> Ultra-low latency, synchronized multi-user video co-watching system with sub-frame accuracy, authoritative server arbitration, and fault-tolerant drift recovery.

[![Build & Test](https://img.shields.io/badge/tests-passing-brightgreen.svg)]()
[![Benchmark SLA](https://img.shields.io/badge/benchmark_SLA-100%25_PASS-success.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)]()

---

## 🚀 Live Production Deployment

WatchParty is now deployed to a **free‑tier Fly.io shared‑CPU VM** with automated TLS.

- **Live Web App (Free HTTPS DNS)**: **[https://watchparty.fly.dev](https://watchparty.fly.dev)**
- **Backup Mirror**: **[https://watchparty.fly.dev (Edge CDN)](https://watchparty.fly.dev)**
- **System Health Status**: **[https://watchparty.fly.dev/health](https://watchparty.fly.dev/health)**
- **System Status Dashboard**: **[https://watchparty.fly.dev/status](https://watchparty.fly.dev/status)**

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run unit and integration tests
npm test

# 3. Run distributed headless benchmark suite
npm run bench

# 4. Start HTTP & WebSocket server
npm run start:server
```

---

## Authentication & Security Highlights

- **Database**: PostgreSQL (Drizzle ORM) with `users`, `refresh_tokens`, and `email_tokens`.
- **Argon2id Hashing**: High-memory, multi-iteration Argon2id password hashing; password policy enforcement & common password dictionary checks.
- **Session Hygiene**: Short-lived access JWTs (15 min) + rotating refresh tokens in `httpOnly`, `Secure`, `SameSite=Lax` cookies.
- **Reuse Detection**: Automatic token family invalidation and socket termination if an expired or stolen refresh token is replayed.
- **WebSocket Auth**: Secure handshake tickets (`/api/auth/ws-ticket`) and header auth without logging sensitive tokens in query strings.
- **Guest Support**: Invite links allow guest participation, with seamless guest-to-account upgrades retaining room state.
- **Rate Limiting & Lockout**: Progressive exponential backoff across authentication endpoints (IP & Account).

---

## Room Access Control & Moderation

- **Room Types**:
  - `public`: Open to all participants up to configured `maxMembers`.
  - `friends-only`: Restricted to accepted friends of the host.
  - `invite-only`: Requires a valid, unrevoked room invite token.
  - **Room Passwords**: Salted PBKDF2 hashing with constant-time verification.
  - **Member Limits**: Dynamic server-enforced `maxMembers` per room.
- **Waiting Room / Lobby**:
  - Unapproved participants are placed in a live queue.
  - Hosts and moderators review, approve, or deny join requests.
  - `autoApproveFriends`: Toggle allowing friends of the host to bypass the lobby queue.
- **Roles & Granular Permission Matrix**:
  - Roles: `host`, `moderator`, `member`, `guest`.
  - Matrix controls playback control, playlist editing, group poll creation, kicks, bans, chat mutes, message deletion, room locking, invite link generation, and role assignment.
  - Role hierarchy: Moderators cannot moderate other moderators or the host.
- **Active Moderation Suite**:
  - **Kick & Ban**: Immediate eviction with dedicated close codes (`USER_KICKED: 4007`, `USER_BANNED: 4006`); ban evasion prevention by account ID, session token, and user ID.
  - **Chat Moderation**: Timed or indefinite user mutes, configurable slow mode interval, and message deletion with sanitization.
  - **Profanity Filter**: Real-time word boundary matching and leetspeak normalization masking offensive terms.
  - **Room Lock**: Instantly freeze rooms against new connections.
  - **Reporting Engine**: User and message reporting capturing recent chat context for moderation review.
- **Invite Links Lifecycle**:
  - Expiring timestamps, revocable on demand, usage-limited counters, and instant regeneration to invalidate leaked links.
- **Server-Side Validation & Audit Logging**:
  - Every moderation event is server-validated, broadcasted in real time, and recorded in structured audit logs.

---

## Privacy Transparency, Data Retention & Safety Tools

Real-world community safety, privacy transparency, and user autonomy built into the platform:

1. **Plain-Language Legal Pages (`/privacy` & `/terms`)**:
   - **Privacy Policy**: Plain English description of what we store (accounts, chat, watch history, session cookies), what we never touch (zero media rehosting, zero streaming service credentials, zero advertising trackers), and how to permanently delete everything.
   - **Terms of Service**: Respectful community guidelines, host room rules adherence, content rights representations, invite-only tokens, and emergency admin kill switch disclosures.
   - **Accessible Everywhere**: Fixed links in the application footer and authentication modals.

2. **Configurable Room Chat Retention**:
   - **Auto-Deletion Engine**: Hosts can configure chat auto-deletion per room to **1 day, 7 days (default), 30 days, 90 days, or persistent (0)**.
   - **Automatic Server Pruning**: Messages older than the configured threshold are pruned on every chat message, setting update, and snapshot request.
   - **Host & Member Visibility**: Current room retention policy is clearly displayed in the room rules modal and room settings dialog.

3. **Self-Service Account Deletion Flow**:
   - **1-Click Self-Service**: Users can permanently delete their account at any time from the Account Settings modal under the Danger Zone.
   - **Argon2id Verification**: Requires password re-authentication to prevent accidental or unauthorized deletions.
   - **Full Cascading Purge**: Erases user database records, watch history, favourites, playlists, friendship links, and notifications.
   - **Connection Eviction**: Terminates active WebSocket connections immediately with typed close code (`POLICY_VIOLATION: 4008`).
   - **Chat Anonymization**: All chat messages previously sent by the user in active rooms are immediately anonymized to `[Deleted User]`.

4. **Per-User Block, Local Mute & Reporting**:
   - **Client-Side Mute**: Instantly hides all incoming chat messages and landscape overlay pings from specified users.
   - **Account-Level Block & Unblock**: Prevents interaction, presence tracking, and friend requests. Manage blocked users directly within Account Settings.
   - **In-Room Moderation Reports**: One-click flag buttons (`🚩`) on messages and member items allow users to report abusive content or behavior. Reports capture the target message and a surrounding context window (±5 messages) for staff review.
   - **Host Room Rules**: Hosts can set custom room rules (e.g. spoiler etiquette, push-to-talk guidelines) displayed to all participants via the **"📜 Rules"** header pill and auto-prompted on join.

---

## Source Guardrails, Safe-Link UX & Zero-Rehosting Architecture

WatchParty implements strict, defense-in-depth security guardrails for all user-supplied links, media sources, podcasts, and co-browse destinations:

1. **Permission Matrix & Link Approval Queue**:
   - Only the host or approved members (`add_sources` permission) can add sources to the playlist or change active playback.
   - Rooms can toggle **"Require Host Approval for Each Added Link"** (`requireLinkApproval`). When enabled, submissions by non-approved members are routed to a pending approval queue where hosts review metadata, verify origin reputation, and approve or reject submissions.
   - Hosts can grant specific members instant addition rights (`approvedSourceAdders`).
2. **Safe-Link UX & Automated Threat Scanning**:
   - **Prominent Domain Visibility**: All playlist items, player overlays, and co-browse headers display the extracted origin domain badge (e.g. `🌐 archive.org`).
   - **Malicious-URL Check**: URLs submitted to the room are scanned against a local threat blocklist and the **Google Safe Browsing API v4** (`https://safebrowsing.googleapis.com/v4/threatMatches:find`) for malware, phishing, and unwanted software.
   - **Interstitial Safe-Link Warning**: Any external navigation button ("Open in your own tab ↗", "Original Source ↗", creator links) triggers an interstitial confirmation modal displaying the target origin, threat assessment badge, and security advisories before allowing users to proceed.
3. **Zero-Rehosting Guarantee & Creator Attribution**:
   - **Origin-Only Streaming**: WatchParty **never rehosts, caches, or re-encodes third-party media**. The client always streams directly from the creator host or origin server.
   - **Mandatory Attribution**: Every item in the player, playlist, and podcast stage displays creator attribution, origin domain, and a direct link to the original webpage.
4. **Report-Source Action, Blocklist Management & Audit Log**:
   - **Source Reporting**: Members can flag suspicious, abusive, or copyrighted streams with categorized reasons (`malware_phishing`, `copyright`, `offensive`, `spam`, `broken_link`, `other`) and optional descriptions.
   - **Room & Platform Blocklists**: Hosts can add custom domain/regex blocklist rules for their room. The platform enforces a global blocklist of known threat origins. Blocklist matches are blocked immediately in-memory with clear user feedback.
   - **Audit Log**: A structured, chronological audit log tracks every source event (`added`, `submitted`, `approved`, `rejected`, `blocked`, `reported`) with timestamps, actor IDs, user names, and origin domains.
5. **Clear Terms Notice & Content Rights**:
   - The source submission modal prominently features an explicit legal terms notice: *users are responsible for warranting they hold all legal rights, permissions, and licenses to stream and view the content they add.*

---

## Benchmark Highlights (Tested on Intel Core 5 210H, 12 vCPUs, Node v26)

All benchmark tests validate against two formal Service Level Agreements (SLAs):
1. **Control Propagation Latency**: $p95 \le 250\text{ ms}$
2. **Post-Correction Drift**: $\text{Max Drift} \le 500\text{ ms}$

| Scenario | N Clients | Latency p50 | Latency p95 (SLA ≤ 250ms) | Drift p50 | Drift Max (SLA ≤ 500ms) | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Scalability (N=10)** | 10 | 2.13 ms | **3.37 ms** ✓ | 7 ms | **13 ms** ✓ | **PASS** |
| **Scalability (N=25)** | 25 | 5.01 ms | **8.49 ms** ✓ | 8 ms | **21 ms** ✓ | **PASS** |
| **Scalability (N=50)** | 50 | 4.60 ms | **11.94 ms** ✓ | 15 ms | **39 ms** ✓ | **PASS** |
| **All-Clients-Seek Storm** | 20 | 25.91 ms | **30.48 ms** ✓ | 0 ms | **0 ms** ✓ | **PASS** |
| **Host Disconnects Mid-Play** | 10 | 50.00 ms | **50.00 ms** ✓ | 0 ms | **0 ms** ✓ | **PASS** |
| **Late Joiner at 40m Mark** | 2 | 4.66 ms | **4.66 ms** ✓ | 1 ms | **1 ms** ✓ | **PASS** |
| **20% Message Drop** | 10 | 3.17 ms | **3.44 ms** ✓ | 3 ms | **4 ms** ✓ | **PASS** |
| **150 ms Added Jitter** | 10 | 141.03 ms | **203.22 ms** ✓ | 0 ms | **29 ms** ✓ | **PASS** |
| **Reconnect Loop** | 8 | 8.05 ms | **11.96 ms** ✓ | 0 ms | **1 ms** ✓ | **PASS** |
| **5-Minute Continuous Drift** | 10 | 1.90 ms | **2.16 ms** ✓ | 1.07 ms | **6.11 ms** ✓ | **PASS** |

### Benchmark Charts
- **Control Propagation Latency Distribution**: [`bench/results/latency_histogram.svg`](file:///bench/results/latency_histogram.svg)
- **5-Minute Post-Correction Drift Over Time**: [`bench/results/drift_over_time.svg`](file:///bench/results/drift_over_time.svg)
- **Interactive HTML Dashboard**: [`bench/results/benchmark_report.html`](file:///bench/results/benchmark_report.html)
- **Raw JSON Results**: [`bench-results.json`](file:///bench-results.json)

---

## Manifest V3 Browser Extension (`packages/extension`)

Synchronize video playback across major streaming platforms (Netflix, Disney+, Prime Video, YouTube, Hulu, Max) where each participant uses their own legitimate account:

- **Zero Stream Proxying & Privacy Preserving**: Runs entirely client-side against the page's native `<video>` element within the user's authenticated session. DRM media streams, credentials, and browsing history are never intercepted or transmitted.
- **Provider-Agnostic PlayerAdapter**: Connects the page video element directly to the standard `PlayerAdapter` interface via `StreamingPageAdapter`.
- **Background Service Worker**: Maintains WebSocket connectivity, performs round-trip NTP clock synchronization, and relays authoritative room playback events.
- **Micro-Adaptive Drift Engine**: Deadband threshold ($\le 50\text{ ms}$), micro-nudging of playback rates ($0.95\times - 1.05\times$), and hard seeking ($> 500\text{ ms}$).
- **Single Page App (SPA) Support**: Automatically detects navigation and DOM changes across episodes and titles using `history` proxies and `MutationObserver`.
- **Modern Popup & Live HUD**: Sleek glassmorphism popup with room code input, host broadcast toggle, real-time sync health readout, and on-video HUD status pill.
- **Scoped Host Permissions**: Clean, audit-ready permission manifest targeting only explicitly supported streaming domains (no broad `<all_urls>`).

### Loading the Extension in Developer Mode:
1. Build the extension bundle:
   ```bash
   npm --workspace=@watchparty/extension run build
   ```
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the [`packages/extension`](file:///packages/extension) directory.
5. Navigate to any supported streaming service (e.g. YouTube or Netflix), open the WatchParty popup, and join your room code!

---

## Legally Free Discovery Catalogue & Attribution

The demo catalogue is seeded with legally free, openly licensed, and public-domain content so rooms always have media ready to co-watch without subscriptions:

- **Public-Domain Films**: Classic cinematic masterpieces sourced from Internet Archive and Wikimedia Commons (e.g. *Night of the Living Dead*, *A Trip to the Moon*, *The Great Train Robbery*).
- **Open-Source Movies**: Award-winning Creative Commons open movies produced by the Blender Foundation (e.g. *Big Buck Bunny*, *Sintel*, *Tears of Steel*, *Elephants Dream*).
- **Creative Commons YouTube Content**: Embedded CC-BY licensed documentaries and shorts playable directly in room sessions via the `YouTubeAdapter`.
- **Movie Details & Legal Attribution Panel**: Selecting any title opens a rich modal displaying official license details (CC-BY, CC0, Public Domain), copyright year, and upstream attribution links.
- **"Free to Watch" Filter**: One-click filter pill in the Discovery UI instantly isolates guaranteed free-to-stream open content.

---

## Server-Side "Source Resolver" Service

When a host pastes an arbitrary media URL, the server-side Source Resolver pipeline analyzes the target and outputs a normalized playback descriptor:

```typescript
interface NormalizedSourceDescriptor {
  kind: 'video' | 'audio' | 'stream' | 'cobrowse';
  provider: 'youtube' | 'vimeo' | 'twitch' | 'soundcloud' | 'html5' | 'podcast' | 'embed' | 'cobrowse';
  sourceRef: string;
  title: string;
  author?: string;
  durationMs?: number;
  thumbnail?: string;
  embedAllowed: boolean;
  controllable: 'full' | 'limited' | 'none';
  warnings: string[];
}
```

### 6-Stage Resolution Pipeline (stops at first success)
1. **Known Providers**: Instant client-side & server matching for YouTube, Vimeo, Twitch, and SoundCloud with deterministic adapter mappings.
2. **Direct Media URLs**: Validates direct audio/video extensions (`.mp3`, `.m4a`, `.mp4`, `.webm`, `.m3u8`) and verifies `Content-Type` headers via HEAD request. Maps to `HTML5Adapter`.
3. **Podcast Feeds**: Discovers `<link rel="alternate" type="application/rss+xml">` or XML feeds, parses RSS/Atom channel structure, extracts episode enclosure URLs, durations, and cover art. Maps to `PodcastAdapter`.
4. **oEmbed & Open Graph / Twitter Tags**: Discovers `<link rel="alternate" type="application/json+oembed">`, Open Graph (`og:video`, `og:audio`), and Twitter Cards (`twitter:player`). Maps to `EmbedAdapter`.
5. **HTML Media Tags & JSON-LD**: Extracts media tags (`<video>`, `<audio>`, `<source>`) and schema.org structured data (`VideoObject`, `AudioObject`, `PodcastEpisode`).
6. **Fallback Co-Browse**: Safe fallback to synchronized co-browsing (`kind: cobrowse`) extracting favicon, page title, and meta description.

### Security & SSRF Protection Architecture (Mandatory Defense-in-Depth)
- **Protocol Enforcement**: Strictly allows only `http:` and `https:`. Rejects all other URI schemes (`file:`, `gopher:`, `ftp:`, etc.).
- **DNS Resolution & Private IP Blocking**: Actively resolves hostnames to IPv4 and IPv6 addresses before connecting. Drops requests matching:
  - Loopback (`127.0.0.0/8`, `::1`)
  - Private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`)
  - Link-local and cloud metadata ranges (`169.254.0.0/16`, `fe80::/10`)
  - Current network (`0.0.0.0/8`, `::`), CGNAT (`100.64.0.0/10`), IPv4-mapped IPv6, and multicast.
- **DNS Rebinding & Redirect Defense**: Re-resolves and re-verifies SSRF constraints on every redirect hop (maximum 3 redirects allowed).
- **Denial of Service Limits**: Strict 2 MB response body cap via stream-chunk accounting and 5000 ms connection timeout with `AbortController`.
- **Hardened User-Agent**: Identified user-agent string (`WatchParty-SourceResolver/1.0 (+https://watchparty.live/bot; bot@watchparty.live)`).
- **robots.txt Compliance**: Automatically queries and parses upstream `/robots.txt` directives with cached TTL entries.
- **Frame Ancestors & Security Headers**: Honors upstream `X-Frame-Options` (`DENY`, `SAMEORIGIN`) and `Content-Security-Policy: frame-ancestors`. When framing is disallowed, flags `embedAllowed: false` and safely falls back.
- **Rate Limiting & Sanitization**: Strict per-user token bucket rate limiting on `/api/resolve`, with HTML/XSS sanitization on all extracted metadata.

---

## Universal Streaming Service Support & Extension Bridge (`@watchparty/extension`)

WatchParty synchronizes playback across major streaming platforms in real time:

- **Supported Streaming Platforms**:
  - **Netflix** (`https://*.netflix.com/*`)
  - **JioHotstar** (`https://*.hotstar.com/*`) & **JioCinema** (`https://*.jiocinema.com/*`)
  - **Disney+** (`https://*.disneyplus.com/*`)
  - **Amazon Prime Video** (`https://*.amazon.com/*` & `https://*.primevideo.com/*`)
  - **YouTube** (`https://*.youtube.com/*`)
  - **Max** (`https://*.max.com/*`) & **Hulu** (`https://*.hulu.com/*`)
  - **Public Domain & Creative Commons Cinema** (direct HLS `.m3u8` and MP4 streams)
- **Extension Bridge Architecture**:
  - Automatically hooks into native HTML5 `<video>` elements on streaming platforms.
  - Sub-frame NTP synchronization maintains synchronization within 50ms across all participants.
  - Zero DRM interception: streams are rendered legitimately through each user's own streaming service session.

---

## Synchronized Co-Browsing (`packages/client/src/cobrowse` & `packages/extension`)

For web pages, blogs, research papers, and articles that cannot be framed or controlled via embedded APIs, WatchParty provides synchronized **Co-Browsing**:

- **Zero-Proxy & Zero-Content Ingestion**: The system strictly never proxies, mirrors, or stores third-party web pages. Every room participant opens and renders the page independently in their own browser environment.
- **Split-View / Own Tab Experience**:
  - When a target website allows iframe embedding (`embedAllowed: true`), WatchParty loads the page directly in an integrated split view alongside the live chat and member sidebar.
  - When framing is blocked via `X-Frame-Options` or CSP `frame-ancestors`, an informative fallback card explains the security header restriction and provides a one-click **"Open in your own tab ↗"** button with automatic URL copying.
- **Browser Extension Content Script**:
  - **Privacy Guard**: Extension content scripts activate strictly on URLs matching the active room's co-browse session. Browsing history and unrelated tabs are ignored.
  - **Zero Page Scraping**: Only semantic anchors, text selections, and user-initiated highlights are synchronized—no page body content is ever broadcasted.
  - **Visible Status**: A persistent floating glassmorphism **"Synced to Room"** pill indicates active synchronization state.
  - **Responsive Relative Scroll Sync**: Instead of raw pixel offsets (which break across different monitor resolutions and viewports), reading position is tracked as the nearest heading (`<h1>`-`<h6>`) or paragraph (`<p>`) anchor plus relative offset, paired with an optional **"Follow Host"** toggle.
  - **W3C Web Annotation Text-Quote Selectors**: Text highlights and sticky comments use `{ exact, prefix, suffix }` disambiguation to cleanly locate highlighted phrases even if dynamic ads, sidebars, or responsive reflows shift DOM indices.
  - **Live Section Presence & Cursors**: Visual avatars show which article section each member is currently reading.
  - **HTMLMediaElement Sync**: In-page `<video>` and `<audio>` players are automatically discovered and tethered to WatchParty's drift engine and NTP clock.
- **Shared Reading Room (Non-Extension Fallback)**:
  - Participants without the extension retain full engagement through the **Reading Room** side panel.
  - Features real-time collaborative notes with debounced conflict resolution, timestamped **"Now at Section X"** pings, reading reactions, and jump-to-section navigation.

---

## Voice & Video Call Quality, Scale Matrices & Decoupled Playback

WatchParty delivers high-fidelity audio/video conferencing built specifically for co-watching, with strict isolation between movie playback synchronization and WebRTC media streams:

- **Per-Participant Call Quality Debug Panel**:
  - Real-time display of **RTT**, **packet loss %**, **jitter (ms)**, **audio/video bitrate (kbps)**, and **active codecs** (Opus 48kHz stereo, VP8 / H.264 simulcast).
  - Health summary badge (🟢 Excellent, 🟡 Fair, ⚠️ Degraded) with LiveKit SFU mesh metrics.
  - Interactive test simulation buttons for instant verification directly in the browser UI.
- **Scale Matrices (2, 5, and 10 Participants)**:
  - **2 Users**: 1-on-1 Wi-Fi mesh, sub-25ms latency, 0% loss, full 720p/30fps video per stream.
  - **5 Users**: Heterogeneous network support (Wi-Fi & 4G/5G mobile data) with adaptive 480p/24fps downscaling for mobile links.
  - **10 Users**: Stress-scale hangout room with SFU bandwidth management, active speaker prioritization, and thumbnail layer distribution.
- **Graceful Throttling Degradation (Chrome DevTools 3G Profile)**:
  - When packet loss and latency spike (e.g. 280ms RTT, 8.5% loss), the throttled participant gracefully degrades to **audio-only with Opus Forward Error Correction (FEC)**.
  - **SFU Isolation**: Other participants on good connections in the room continue receiving 720p video without degradation.
- **Page Visibility & Background Tab Optimization**:
  - Backgrounded tabs automatically throttle video rendering to 15fps to conserve CPU/power while keeping audio streaming uninterrupted. Full 30fps decoding restores on foregrounding.
- **Mid-Call Device Switching**:
  - Hot-swapping microphones, Bluetooth headsets, or cameras without dropped frames, renegotiation storms, or call teardown.
- **Playback Sync Engine Invariance**:
  - Sync Plane (movie playback over WebSocket NTP) and Media Plane (WebRTC/SFU) are strictly decoupled.
  - Joining, leaving, muting, or experiencing network drops in voice mid-movie causes **0ms clock drift**, zero seek hitches, and 100% steady 1.0x video playback.
- **Complete Test Plan**:
  - Comprehensive documentation and automated vitest test suites: [CALL_QUALITY_TEST_PLAN.md](file:///CALL_QUALITY_TEST_PLAN.md).

---

## Production Deployment & Operations

WatchParty is engineered for low-cost ($4–$6/month), zero-ops, always-on hosting:

- **Primary VPS Deployment**: [Step-by-step VPS & Caddy Deployment Guide](file:///docs/DEPLOYMENT_GUIDE.md)
  - Automatic HTTPS via Let's Encrypt / ZeroSSL with HTTP/2 and HTTP/3 support.
  - Containerized PostgreSQL 16 with persistent volume and health probes.
  - Multi-stage non-root Dockerfile and `docker-compose.prod.yml`.
- **Zero-Surprise Rolling Deploys**:
  - Graceful connection draining with WebSocket close code `1012` (`SERVICE_RESTART`).
  - Active rooms and playback positions flushed to durable storage / PostgreSQL on change and on shutdown.
  - Clients auto-reconnect with reconnect tokens and resume playback within 1–2 seconds.
  - One-command instant rollback: `./scripts/rollback.sh <tag>`.
- **Database Migrations & Backups**:
  - [Database Backup & Restore Runbook](file:///docs/BACKUP_AND_RESTORE.md).
  - Migrations execute automatically on container deploy (`docker-entrypoint.sh`).
  - Automated daily backups with 7-day retention (`postgres-backup` service).
- **Email Deliverability**:
  - [Transactional Email Deliverability (SPF, DKIM, DMARC)](file:///docs/EMAIL_DELIVERABILITY.md).
  - Resend and Postmark native REST adapters + SMTP fallback.
- **Observability & Status**:
  - Admin Dashboard: `/admin` (User management, active room monitoring, moderation reports, invite links, Sentry telemetry, registration mode & emergency kill switch).
  - Public status page: `/status` (HTML status dashboard or JSON API).
  - Prometheus metrics: `/metrics`.
  - Liveness & Readiness: `/health` & `/ready`.

---

## Lightweight Observability, Admin Dashboard & Cost Guardrails

Built specifically for low-maintenance hosting on small VPS nodes ($4–$6/month):

- **Error Tracking (Sentry Free Tier)**:
  - Client & server crash reporting using lightweight Sentry store ingest (no heavy native binaries or extra bundle bloat).
  - Enriched structured logs with `roomId`, `userId`, and `environment` tags.
  - Client error forwarder via `POST /api/observability/client-errors` capturing uncaught window exceptions and unhandled promise rejections.
  - In-memory recent error ring buffer displayed live on `/admin`.
- **Uptime Monitoring & Instant Phone Alerts**:
  - `GET /health` liveness probe and `GET /ready` draining probe.
  - 100% free phone push & critical alert configuration with Better Stack Uptime (iOS / Android).
  - Direct webhook alert dispatcher for Discord, Telegram bot, or Pushover via `UPTIME_ALERT_WEBHOOK_URL`.
- **Admin Dashboard (`/admin`)**:
  - Protected by `ADMIN_SECRET` cookie session with constant-time verification.
  - **User Management**: Search users, toggle ban/unban with instantaneous WebSocket disconnection (code `4003`), one-click session revocation, and resend email verification.
  - **Active Rooms**: Live participant count, current video/sync status, lock/unlock toggle, and force-close room.
  - **Moderation Queue**: Review reported content, users, and chat messages with contextual message logs and resolution actions.
  - **Invite-Only Registration & Kill Switch**:
    - **Public Mode**: Open signups.
    - **Invite-Only Mode**: Requires either the shared master invite code (`REGISTRATION_INVITE_CODE`) or an admin-generated dynamic invite link (`/?invite=CODE`).
    - **Emergency Kill Switch**: Instantly rejects all new signups if an incident occurs.
  - **Usage & Cost Alerts**:
    - Real-time email send tracking against free tier limits (Resend 100/day, Postmark 100/mo) with amber 80% and red 95% alerts.
    - VPS disk storage warnings for `.data` directory.
    - Real-time inbound & outbound bandwidth metering.

---

## Full Documentation

For comprehensive technical specifications, refer to:
👉 **[AWS Cheap & Reliable Deployment Runbook (t4g.small / Terraform)](file:///docs/AWS_DEPLOYMENT_RUNBOOK.md)**
👉 **[Architecture, Synchronization Engine & Benchmark Specification](file:///docs/ARCHITECTURE_AND_SYNC.md)**
👉 **[Production Deployment Guide](file:///docs/DEPLOYMENT_GUIDE.md)**
👉 **[Database Backup & Restore Runbook](file:///docs/BACKUP_AND_RESTORE.md)**
👉 **[Email Deliverability & DNS Guide](file:///docs/EMAIL_DELIVERABILITY.md)**
👉 **[Uptime Monitoring, Phone Alerts & Observability Runbook](file:///docs/UPTIME_AND_ALERTS.md)**


