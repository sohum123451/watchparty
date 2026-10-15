/**
 * Plain-Language Privacy Policy & Terms of Service Pages
 * Beautiful glassmorphic dark-mode pages explaining in plain English:
 * - What we store (accounts, chat, watch history)
 * - What we don't (passwords, media streams, DRM credentials, ads/trackers)
 * - How to delete it (self-service 1-click delete, chat retention, anonymization)
 */

interface LegalPageOptions {
  activeTab: "privacy" | "terms";
}

function getLegalPageWrapper(title: string, activeTab: "privacy" | "terms", bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
  <title>${title} - WatchParty</title>
  <link rel="icon" type="image/svg+xml" href="/icon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 24, 38, 0.75);
      --card-solid: #121826;
      --border: rgba(255, 255, 255, 0.08);
      --border-focus: rgba(99, 102, 241, 0.5);
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --accent: #06b6d4;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --text-dim: #6b7280;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      line-height: 1.6;
    }

    header {
      background: rgba(9, 13, 22, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      padding: 0.85rem 1.75rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1.25rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      text-decoration: none;
      background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .nav-links {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .nav-btn {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.82rem;
      font-weight: 600;
      padding: 0.4rem 0.8rem;
      border-radius: 8px;
      transition: all 0.2s ease;
      border: 1px solid transparent;
    }
    .nav-btn:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.05);
    }
    .nav-btn.active {
      color: #fff;
      background: rgba(99, 102, 241, 0.15);
      border-color: rgba(99, 102, 241, 0.3);
    }

    .container {
      max-width: 860px;
      margin: 2.5rem auto;
      padding: 0 1.5rem 4rem;
      width: 100%;
    }

    .hero-banner {
      margin-bottom: 2rem;
      text-align: left;
    }
    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--accent);
      background: rgba(6, 182, 212, 0.1);
      border: 1px solid rgba(6, 182, 212, 0.25);
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      margin-bottom: 0.75rem;
    }
    .hero-title {
      font-size: 2.25rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: #fff;
      margin-bottom: 0.5rem;
    }
    .hero-sub {
      font-size: 1rem;
      color: var(--text-muted);
      max-width: 640px;
    }

    .legal-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 2rem;
      backdrop-filter: blur(16px);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
      margin-bottom: 2rem;
    }

    .section-title {
      font-size: 1.35rem;
      font-weight: 700;
      color: #fff;
      margin-top: 1.5rem;
      margin-bottom: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      letter-spacing: -0.02em;
    }
    .section-title:first-child { margin-top: 0; }

    .plain-box {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.25rem;
      margin: 1rem 0;
    }

    .plain-box.highlight {
      background: rgba(99, 102, 241, 0.08);
      border-color: rgba(99, 102, 241, 0.25);
    }

    .plain-box.success {
      background: rgba(16, 185, 129, 0.08);
      border-color: rgba(16, 185, 129, 0.25);
    }

    .plain-box.warning {
      background: rgba(245, 158, 11, 0.08);
      border-color: rgba(245, 158, 11, 0.25);
    }

    ul.check-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin: 0.75rem 0 1.25rem;
    }
    ul.check-list li {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      font-size: 0.92rem;
      color: #e5e7eb;
    }
    ul.check-list li strong {
      color: #fff;
    }
    .icon-badge {
      font-size: 1rem;
      line-height: 1.4;
      flex-shrink: 0;
    }

    footer {
      margin-top: auto;
      border-top: 1px solid var(--border);
      padding: 1.5rem 1.75rem;
      text-align: center;
      font-size: 0.8rem;
      color: var(--text-dim);
      background: rgba(9, 13, 22, 0.6);
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }
    .footer-links {
      display: flex;
      gap: 1.25rem;
    }
    .footer-links a {
      color: var(--text-muted);
      text-decoration: none;
      transition: color 0.2s;
    }
    .footer-links a:hover {
      color: #fff;
    }

    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      color: #fff;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid var(--border);
      padding: 0.45rem 0.9rem;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.2s;
    }
    .back-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.2);
    }
  </style>
</head>
<body>
  <header>
    <a href="/" class="logo">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: #6366f1;">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      WatchParty
    </a>

    <div class="nav-links">
      <a href="/privacy" class="nav-btn ${activeTab === 'privacy' ? 'active' : ''}">Privacy Policy</a>
      <a href="/terms" class="nav-btn ${activeTab === 'terms' ? 'active' : ''}">Terms of Service</a>
      <a href="/status" class="nav-btn">System Status</a>
      <a href="/" class="back-btn">
        <span>&larr;</span> Back to App
      </a>
    </div>
  </header>

  <main class="container">
    ${bodyHtml}
  </main>

  <footer>
    <div>&copy; ${new Date().getFullYear()} WatchParty. Plain language transparency.</div>
    <div class="footer-links">
      <a href="/">Home</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/status">Status</a>
    </div>
  </footer>
</body>
</html>`;
}

export function getPrivacyPolicyHtml(): string {
  const body = `
    <div class="hero-banner">
      <div class="hero-badge">🛡️ Plain English Transparency</div>
      <h1 class="hero-title">Privacy Policy</h1>
      <p class="hero-sub">We believe in radical clarity. Here is exactly what data we store, what we never touch, and how you can permanently delete everything with one click.</p>
    </div>

    <div class="legal-card">
      <h2 class="section-title">1. What We Store</h2>
      <p style="color: var(--text-muted); font-size: 0.92rem;">
        When you create an account or participate in a co-watching room, we store the minimum necessary data to provide synchronized co-watching:
      </p>

      <ul class="check-list">
        <li>
          <span class="icon-badge">👤</span>
          <div>
            <strong>Account Credentials:</strong> Your email address, display name, and a salted, memory-hard <code>Argon2id</code> password hash. We never see or store your plain-text password.
          </div>
        </li>
        <li>
          <span class="icon-badge">💬</span>
          <div>
            <strong>Room Chat & Reactions:</strong> Temporary text messages and reaction bursts sent in room channels. These are ephemeral and subject to the room's auto-retention policy (default: 7 days).
          </div>
        </li>
        <li>
          <span class="icon-badge">🎬</span>
          <div>
            <strong>Watch History & Saved Items:</strong> If you are logged in, we save your playback timestamps and favorite titles so you can resume where you left off. Guest sessions store zero server watch history.
          </div>
        </li>
        <li>
          <span class="icon-badge">🔑</span>
          <div>
            <strong>Session Tokens:</strong> Short-lived JWTs (15 min) and rotating refresh tokens stored in secure, <code>httpOnly</code>, <code>SameSite=Lax</code> cookies to keep you signed in securely.
          </div>
        </li>
      </ul>

      <h2 class="section-title">2. What We DO NOT Store (Our Zero-Data Guarantees)</h2>
      <div class="plain-box highlight">
        <ul class="check-list">
          <li>
            <span class="icon-badge">🚫</span>
            <div>
              <strong>No Video/Audio Rehosting:</strong> WatchParty never downloads, caches, mirrors, or re-encodes third-party media. All media streams load directly from original creators (YouTube, Vimeo, Internet Archive, podcast RSS feeds, or your local files).
            </div>
          </li>
          <li>
            <span class="icon-badge">🚫</span>
            <div>
              <strong>No Streaming Service Credentials:</strong> Our browser extension runs entirely inside your own browser against native HTML <code>&lt;video&gt;</code> elements. We never intercept, transmit, or store Netflix, Disney+, Prime Video, or other service credentials or DRM keys.
            </div>
          </li>
          <li>
            <span class="icon-badge">🚫</span>
            <div>
              <strong>No Advertising Trackers or Data Brokers:</strong> We do not run third-party advertising trackers, analytics pixels, or sell your personal data to anyone. Ever.
            </div>
          </li>
          <li>
            <span class="icon-badge">🚫</span>
            <div>
              <strong>No Keystroke or Web Scraping:</strong> Co-browsing synchronizes only relative section anchors and explicit text highlights—never your personal browsing history, passwords, or unrelated tabs.
            </div>
          </li>
        </ul>
      </div>

      <h2 class="section-title">3. Chat Retention & Auto-Deletion</h2>
      <p style="color: var(--text-muted); font-size: 0.92rem; margin-bottom: 0.75rem;">
        Room hosts have full control over how long chat messages persist:
      </p>
      <div class="plain-box success">
        <p style="font-size: 0.92rem; margin-bottom: 0.5rem;">
          <strong>Configurable Retention:</strong> Hosts can set room chat auto-deletion to <strong>1 day, 7 days (default), 30 days, or 90 days</strong>.
        </p>
        <p style="font-size: 0.88rem; color: var(--text-muted);">
          Our server automatically prunes messages older than the configured threshold on every chat update and snapshot. When a room is closed, all in-memory ephemeral state is discarded.
        </p>
      </div>

      <h2 class="section-title">4. How to Delete Your Account & All Data</h2>
      <div class="plain-box warning">
        <p style="font-size: 0.95rem; font-weight: 700; color: #fde68a; margin-bottom: 0.5rem;">
          ⚡ 100% Self-Service One-Click Account Deletion
        </p>
        <p style="font-size: 0.9rem; color: #e5e7eb; margin-bottom: 0.75rem;">
          You can delete your account and all associated data at any time without waiting for customer support:
        </p>
        <ol style="margin-left: 1.5rem; color: var(--text-muted); font-size: 0.88rem; display: flex; flex-direction: column; gap: 0.4rem;">
          <li>Log in and open your <strong>Account Profile / Settings</strong> modal.</li>
          <li>Scroll to the <strong>Danger Zone</strong> section.</li>
          <li>Click <strong>Delete Account</strong> and re-enter your password to confirm.</li>
        </ol>
      </div>

      <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 1rem;">
        <strong>What happens immediately upon deletion:</strong>
      </p>
      <ul class="check-list" style="margin-top: 0.5rem;">
        <li><span class="icon-badge">✓</span> <div>Your user record, email, and password hash are deleted from the database.</div></li>
        <li><span class="icon-badge">✓</span> <div>Your watch history, saved favorites, playlists, and notifications are permanently erased.</div></li>
        <li><span class="icon-badge">✓</span> <div>All friendships and pending requests are cleanly unlinked.</div></li>
        <li><span class="icon-badge">✓</span> <div>All active WebSocket connections and refresh token families are terminated.</div></li>
        <li><span class="icon-badge">✓</span> <div>Any chat messages in active rooms are immediately anonymized to <code>[Deleted User]</code>.</div></li>
      </ul>
    </div>
  `;

  return getLegalPageWrapper("Privacy Policy", "privacy", body);
}

export function getTermsOfServiceHtml(): string {
  const body = `
    <div class="hero-banner">
      <div class="hero-badge">📜 Fair & Human Terms</div>
      <h1 class="hero-title">Terms of Service</h1>
      <p class="hero-sub">Simple, respectful rules for co-watching with friends. We treat you like an adult, and we ask that you respect fellow viewers and copyright holders.</p>
    </div>

    <div class="legal-card">
      <h2 class="section-title">1. Respectful Co-Watching Community</h2>
      <p style="color: var(--text-muted); font-size: 0.92rem; margin-bottom: 0.75rem;">
        WatchParty is built for friends, families, and communities to gather around media. When using the platform, you agree to:
      </p>
      <ul class="check-list">
        <li><span class="icon-badge">🤝</span> <div><strong>Follow Room Rules:</strong> Room hosts set room-specific guidelines (e.g. spoiler etiquette, microphone muting). Respect the host and other participants.</div></li>
        <li><span class="icon-badge">🛑</span> <div><strong>Zero Tolerance for Abuse:</strong> No harassment, hate speech, threats, spam, or explicit content without consent. Violations result in immediate bans and session revocation.</div></li>
        <li><span class="icon-badge">🛡️</span> <div><strong>Use Moderation Tools Responsibly:</strong> Every user has access to local mute, user blocking, and message reporting. Malicious report abuse will result in account sanctions.</div></li>
      </ul>

      <h2 class="section-title">2. Content Rights & Zero-Rehosting Architecture</h2>
      <div class="plain-box highlight">
        <p style="font-size: 0.92rem; margin-bottom: 0.5rem;">
          <strong>You are responsible for the media URLs you submit:</strong>
        </p>
        <p style="font-size: 0.88rem; color: var(--text-muted); line-height: 1.5;">
          WatchParty strictly operates as an ephemeral synchronization coordinator. We do not host, store, cache, or distribute audio or video files. When you add a URL to a room, you represent and warrant that you have all necessary rights, permissions, or lawful licenses to view and share that media within your private group.
        </p>
      </div>

      <h2 class="section-title">3. Account Safety & Registration Access</h2>
      <ul class="check-list">
        <li><span class="icon-badge">🔒</span> <div><strong>Protect Your Credentials:</strong> Maintain a strong, unique password. If you suspect unauthorized access, use the "Revoke Other Sessions" button in your account settings.</div></li>
        <li><span class="icon-badge">🎟️</span> <div><strong>Invite-Only Instances:</strong> If this instance operates in invite-only mode, invite links and shared codes are for your personal use. The administrator reserves the right to disable compromised invite tokens.</div></li>
        <li><span class="icon-badge">🚨</span> <div><strong>Emergency Kill Switch:</strong> Platform administrators hold emergency controls to lock registration, evict malicious users, or terminate abusive rooms to protect service stability.</div></li>
      </ul>

      <h2 class="section-title">4. Termination & Self-Service Account Removal</h2>
      <p style="color: var(--text-muted); font-size: 0.92rem; margin-bottom: 0.75rem;">
        You can close your account at any time using the self-service Delete Account button. We reserve the right to suspend or ban accounts that repeatedly violate these terms or compromise the safety of our community.
      </p>
      <div class="plain-box">
        <p style="font-size: 0.85rem; color: var(--text-muted);">
          Questions or moderation inquiries? Reach out to the instance owner or check the <a href="/status" style="color: var(--accent); text-decoration: none;">System Status</a> page for node health and operator contact details.
        </p>
      </div>
    </div>
  `;

  return getLegalPageWrapper("Terms of Service", "terms", body);
}
