export function getAdminDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WatchParty - Admin & Observability Suite</title>
  <meta name="description" content="WatchParty internal administration, telemetry, moderation, and user management.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090b10;
      --card-bg: rgba(18, 22, 33, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.25);
      --accent-hover: #4f46e5;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --border: rgba(255, 255, 255, 0.1);
      --radius: 12px;
      --font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      background-image: 
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.08) 0px, transparent 50%);
      color: var(--text);
      font-family: var(--font-sans);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      line-height: 1.5;
    }

    /* Container */
    .admin-layout {
      max-width: 1300px;
      width: 100%;
      margin: 0 auto;
      padding: 24px 20px;
    }

    /* Header */
    header.admin-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
    }
    .brand-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    /* Badge & Buttons */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-success { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-warning { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-danger { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .badge-neutral { background: rgba(255, 255, 255, 0.08); color: var(--text-muted); }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
      font-family: inherit;
    }
    .btn-primary {
      background: var(--accent);
      color: white;
    }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.08);
      color: var(--text);
      border-color: var(--border);
    }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.12); }
    .btn-danger {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.3);
    }
    .btn-danger:hover { background: rgba(239, 68, 68, 0.25); }
    .btn-sm { padding: 4px 8px; font-size: 12px; }

    /* Alert Banner */
    .alert-banner {
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.3);
      padding: 12px 16px;
      border-radius: var(--radius);
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 13px;
    }
    .alert-banner.critical {
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(239, 68, 68, 0.35);
    }

    /* Grid Stats */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 18px;
    }
    .stat-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      color: var(--text-muted);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .stat-value {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin-bottom: 6px;
    }
    .stat-subtext {
      font-size: 12px;
      color: var(--text-muted);
    }
    .progress-bar-wrap {
      width: 100%;
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 9999px;
      margin-top: 10px;
      overflow: hidden;
    }
    .progress-bar {
      height: 100%;
      background: var(--accent);
      border-radius: 9999px;
      transition: width 0.3s ease;
    }
    .progress-bar.warning { background: var(--warning); }
    .progress-bar.danger { background: var(--danger); }

    /* Navigation Tabs */
    .tabs-nav {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
      overflow-x: auto;
    }
    .tab-btn {
      padding: 10px 16px;
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      position: relative;
      transition: color 0.15s ease;
      white-space: nowrap;
      font-family: inherit;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active {
      color: var(--text);
    }
    .tab-btn.active::after {
      content: "";
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--accent);
    }

    /* Panel & Tables */
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }

    .card {
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 20px;
      margin-bottom: 20px;
    }

    .card-header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .search-input {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      color: var(--text);
      font-family: inherit;
      font-size: 13px;
      min-width: 260px;
    }
    .search-input:focus { outline: none; border-color: var(--accent); }

    .data-table-wrap {
      overflow-x: auto;
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }
    table.data-table th {
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.02);
      color: var(--text-muted);
      font-weight: 600;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    table.data-table td {
      padding: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      vertical-align: middle;
    }
    table.data-table tr:hover td {
      background: rgba(255, 255, 255, 0.015);
    }
    .font-mono { font-family: var(--font-mono); font-size: 12px; }

    /* Modals & Overlays */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(6px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 20px;
    }
    .modal-backdrop.open { display: flex; }
    .modal-dialog {
      background: #131722;
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      max-width: 480px;
      width: 100%;
      padding: 24px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .modal-title { font-size: 18px; font-weight: 700; margin-bottom: 12px; }
    .modal-desc { font-size: 13px; color: var(--text-muted); margin-bottom: 18px; }
    .form-group { margin-bottom: 14px; }
    .form-label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: var(--text-muted); }
    .form-input, .form-select {
      width: 100%;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 12px;
      color: var(--text);
      font-family: inherit;
      font-size: 13px;
    }
    .form-input:focus, .form-select:focus { outline: none; border-color: var(--accent); }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 20px;
    }

    /* Toast */
    #toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1e293b;
      color: white;
      padding: 12px 18px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 13px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
      opacity: 0;
      pointer-events: none;
      transform: translateY(10px);
      transition: all 0.2s ease;
      z-index: 200;
    }
    #toast.show { opacity: 1; transform: translateY(0); pointer-events: auto; }
  </style>
</head>
<body>
  <div class="admin-layout">
    <!-- Header -->
    <header class="admin-header">
      <div class="brand-wrap">
        <div class="brand-logo">WP</div>
        <div>
          <h1 class="brand-title">WatchParty Admin Suite</h1>
          <div style="font-size: 12px; color: var(--text-muted);">Observability, User Controls & Cost Guardrails</div>
        </div>
      </div>
      <div class="header-actions">
        <span id="regModeBadge" class="badge badge-warning">Registration: Invite-Only</span>
        <button class="btn btn-secondary btn-sm" onclick="openRegModeModal()">Change Mode</button>
        <button class="btn btn-danger btn-sm" onclick="logoutAdmin()">Logout</button>
      </div>
    </header>

    <!-- Dynamic Alert Banner if Quotas Near Cap -->
    <div id="costAlertBanner" class="alert-banner" style="display: none;">
      <div>
        <strong id="alertBannerTitle">Cost & Quota Alert</strong>
        <div id="alertBannerMsg" style="color: var(--text-muted); margin-top: 2px;"></div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="dismissBanner()">Dismiss</button>
    </div>

    <!-- Stats & Cost Cards -->
    <div class="stats-grid">
      <!-- 1. Email Quota -->
      <div class="stat-card">
        <div class="stat-header">
          <span>Transactional Email</span>
          <span id="emailStatusBadge" class="badge badge-success">Healthy</span>
        </div>
        <div id="emailStatVal" class="stat-value">0 / 100</div>
        <div id="emailStatSub" class="stat-subtext">0 sent today (0% of free daily cap)</div>
        <div class="progress-bar-wrap">
          <div id="emailProgress" class="progress-bar" style="width: 0%;"></div>
        </div>
      </div>

      <!-- 2. Persistent Storage -->
      <div class="stat-card">
        <div class="stat-header">
          <span>Persistent Storage</span>
          <span id="storageStatusBadge" class="badge badge-success">Healthy</span>
        </div>
        <div id="storageStatVal" class="stat-value">0.0 MB</div>
        <div id="storageStatSub" class="stat-subtext">Data directory (.data & backups)</div>
        <div class="progress-bar-wrap">
          <div id="storageProgress" class="progress-bar" style="width: 1%;"></div>
        </div>
      </div>

      <!-- 3. Active Rooms & Sockets -->
      <div class="stat-card">
        <div class="stat-header">
          <span>Live Connections</span>
          <span class="badge badge-neutral">Real-time</span>
        </div>
        <div id="liveRoomsVal" class="stat-value">0 Rooms</div>
        <div id="liveSocketsVal" class="stat-subtext">0 connected WebSocket clients</div>
      </div>

      <!-- 4. System Uptime & Status -->
      <div class="stat-card">
        <div class="stat-header">
          <span>Uptime & Engine</span>
          <span class="badge badge-success">Online</span>
        </div>
        <div id="uptimeVal" class="stat-value">0m</div>
        <div class="stat-subtext"><a href="/status" target="_blank" style="color: var(--accent); text-decoration: none;">View Public Status Page →</a></div>
      </div>
    </div>

    <!-- Tab Navigation -->
    <div class="tabs-nav">
      <button class="tab-btn active" onclick="switchTab('usersTab', this)">Users (<span id="userCount">0</span>)</button>
      <button class="tab-btn" onclick="switchTab('roomsTab', this)">Active Rooms (<span id="roomCount">0</span>)</button>
      <button class="tab-btn" onclick="switchTab('reportsTab', this)">Reported Content (<span id="reportCount">0</span>)</button>
      <button class="tab-btn" onclick="switchTab('invitesTab', this)">Invite Codes (<span id="inviteCount">0</span>)</button>
      <button class="tab-btn" onclick="switchTab('errorsTab', this)">Sentry & Errors (<span id="errorCount">0</span>)</button>
    </div>

    <!-- Tab 1: Users -->
    <div id="usersTab" class="tab-pane active">
      <div class="card">
        <div class="card-header-bar">
          <input type="text" id="userSearchInput" class="search-input" placeholder="Search by email, name, or username..." oninput="debounceUserSearch()">
          <button class="btn btn-secondary btn-sm" onclick="fetchUsers()">Refresh Users</button>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>User / Display Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Email Verified</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="usersTableBody">
              <tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">Loading users...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Tab 2: Active Rooms -->
    <div id="roomsTab" class="tab-pane">
      <div class="card">
        <div class="card-header-bar">
          <h3>Active Watch Party Rooms</h3>
          <button class="btn btn-secondary btn-sm" onclick="fetchRooms()">Refresh Rooms</button>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Room Code</th>
                <th>Room Name</th>
                <th>Host</th>
                <th>Members</th>
                <th>Current Media / Status</th>
                <th>Type / Flags</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="roomsTableBody">
              <tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No active rooms right now.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Tab 3: Reported Content -->
    <div id="reportsTab" class="tab-pane">
      <div class="card">
        <div class="card-header-bar">
          <h3>Moderation Reports</h3>
          <button class="btn btn-secondary btn-sm" onclick="fetchReports()">Refresh Reports</button>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Reporter</th>
                <th>Target User</th>
                <th>Reason</th>
                <th>Reported Content</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="reportsTableBody">
              <tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No open moderation reports.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Tab 4: Invites -->
    <div id="invitesTab" class="tab-pane">
      <div class="card">
        <div class="card-header-bar">
          <div>
            <h3>Invite-Only Registration Codes</h3>
            <div style="font-size: 12px; color: var(--text-muted);">Generate unique or multi-use invite links for the friend group.</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="openCreateInviteModal()">+ Create Invite Code</button>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Invite Code</th>
                <th>Usage</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Note</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="invitesTableBody">
              <tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No invite codes created yet.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Tab 5: Sentry & Error Telemetry -->
    <div id="errorsTab" class="tab-pane">
      <div class="card">
        <div class="card-header-bar">
          <div>
            <h3>Error Tracking & Sentry Free Tier Telemetry</h3>
            <div style="font-size: 12px; color: var(--text-muted);">Correlated error logs tagged with roomId and userId.</div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="fetchErrors()">Refresh Errors</button>
        </div>
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Level</th>
                <th>Error Message</th>
                <th>Room ID</th>
                <th>User ID</th>
                <th>Stack Snippet</th>
              </tr>
            </thead>
            <tbody id="errorsTableBody">
              <tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No errors captured. System running clean!</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- Modal: Registration Mode & Kill Switch -->
  <div id="regModeModal" class="modal-backdrop">
    <div class="modal-dialog">
      <h3 class="modal-title">Registration Mode & Kill Switch</h3>
      <p class="modal-desc">Control access to your instance. "Disabled" functions as an immediate emergency kill switch for new account creation.</p>
      <div class="form-group">
        <label class="form-label" for="regModeSelect">Select Mode</label>
        <select id="regModeSelect" class="form-select">
          <option value="invite_only">Invite-Only (Requires valid code/link)</option>
          <option value="public">Public (Open registration)</option>
          <option value="disabled">🚨 Emergency Kill Switch (Disable signups entirely)</option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal('regModeModal')">Cancel</button>
        <button class="btn btn-primary" onclick="submitRegMode()">Save Changes</button>
      </div>
    </div>
  </div>

  <!-- Modal: Create Invite Code -->
  <div id="createInviteModal" class="modal-backdrop">
    <div class="modal-dialog">
      <h3 class="modal-title">Generate Registration Invite</h3>
      <p class="modal-desc">Create a single-use or multi-use invite code for friends or testing.</p>
      <div class="form-group">
        <label class="form-label" for="customCodeInput">Custom Code (Optional, e.g. MOVIENIGHT)</label>
        <input type="text" id="customCodeInput" class="form-input" placeholder="Leave blank to auto-generate">
      </div>
      <div class="form-group">
        <label class="form-label" for="maxUsesInput">Maximum Uses</label>
        <input type="number" id="maxUsesInput" class="form-input" placeholder="e.g. 5 (Leave blank for unlimited)" min="1">
      </div>
      <div class="form-group">
        <label class="form-label" for="expiryDaysInput">Expires In (Days)</label>
        <input type="number" id="expiryDaysInput" class="form-input" placeholder="e.g. 7 (Leave blank for no expiration)" min="1">
      </div>
      <div class="form-group">
        <label class="form-label" for="noteInput">Admin Note / Recipient</label>
        <input type="text" id="noteInput" class="form-input" placeholder="e.g. For college group">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal('createInviteModal')">Cancel</button>
        <button class="btn btn-primary" onclick="submitCreateInvite()">Create Invite</button>
      </div>
    </div>
  </div>

  <!-- Toast Element -->
  <div id="toast">Action completed successfully</div>

  <script>
    // Global Auth & Token Management
    function getAdminSecret() {
      return localStorage.getItem("wp_admin_secret") || "";
    }

    async function apiFetch(url, options = {}) {
      const secret = getAdminSecret();
      const headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + secret,
        ...(options.headers || {})
      };

      const res = await fetch(url, { ...options, headers });
      if (res.status === 401) {
        promptAdminLogin();
        throw new Error("Unauthorized");
      }
      return res;
    }

    function promptAdminLogin() {
      const input = prompt("Enter WatchParty ADMIN_SECRET to access dashboard:");
      if (input) {
        localStorage.setItem("wp_admin_secret", input.trim());
        location.reload();
      }
    }

    function logoutAdmin() {
      localStorage.removeItem("wp_admin_secret");
      location.reload();
    }

    function showToast(msg) {
      const t = document.getElementById("toast");
      t.innerText = msg;
      t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), 3000);
    }

    function switchTab(tabId, el) {
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.getElementById(tabId).classList.add("active");
      el.classList.add("active");
    }

    function openModal(id) { document.getElementById(id).classList.add("open"); }
    function closeModal(id) { document.getElementById(id).classList.remove("open"); }

    // =========================================================================
    // STATS & DASHBOARD REFRESH
    // =========================================================================
    async function loadStats() {
      try {
        const res = await apiFetch("/api/admin/stats");
        if (!res.ok) return;
        const data = await res.json();

        // 1. Email Stat
        const em = data.email;
        document.getElementById("emailStatVal").innerText = em.sentToday + " / " + em.dailyLimit;
        document.getElementById("emailStatSub").innerText = em.sentToday + " sent today (" + em.sentThisMonth + "/" + em.monthlyLimit + " this month)";
        const emProg = document.getElementById("emailProgress");
        emProg.style.width = em.percentDailyUsed + "%";
        emProg.className = "progress-bar " + (em.status === "critical" ? "danger" : em.status === "warning" ? "warning" : "");
        const emBadge = document.getElementById("emailStatusBadge");
        emBadge.innerText = em.status.toUpperCase();
        emBadge.className = "badge badge-" + (em.status === "critical" ? "danger" : em.status === "warning" ? "warning" : "success");

        // 2. Storage Stat
        const st = data.storage;
        document.getElementById("storageStatVal").innerText = st.dataDirSizeMB + " MB";
        document.getElementById("storageStatSub").innerText = st.percentThresholdUsed + "% of " + st.warningThresholdMB + " MB target threshold";
        const stProg = document.getElementById("storageProgress");
        stProg.style.width = Math.max(1, st.percentThresholdUsed) + "%";
        stProg.className = "progress-bar " + (st.status === "critical" ? "danger" : st.status === "warning" ? "warning" : "");
        const stBadge = document.getElementById("storageStatusBadge");
        stBadge.innerText = st.status.toUpperCase();
        stBadge.className = "badge badge-" + (st.status === "critical" ? "danger" : st.status === "warning" ? "warning" : "success");

        // 3. Live System
        const sys = data.system;
        document.getElementById("liveRoomsVal").innerText = sys.activeRooms + " Active Rooms";
        document.getElementById("liveSocketsVal").innerText = sys.connectedSockets + " connected sockets";
        document.getElementById("roomCount").innerText = sys.activeRooms;
        document.getElementById("uptimeVal").innerText = Math.floor(sys.uptimeSeconds / 60) + "m";

        // Registration Badge
        const regBadge = document.getElementById("regModeBadge");
        if (sys.registrationMode === "disabled") {
          regBadge.innerText = "🚨 Kill Switch Active";
          regBadge.className = "badge badge-danger";
        } else if (sys.registrationMode === "public") {
          regBadge.innerText = "Registration: Public";
          regBadge.className = "badge badge-success";
        } else {
          regBadge.innerText = "Registration: Invite-Only";
          regBadge.className = "badge badge-warning";
        }

        // Proactive Alerts Banner
        if (data.alerts && data.alerts.length > 0) {
          const topAlert = data.alerts[0];
          document.getElementById("alertBannerTitle").innerText = topAlert.title;
          document.getElementById("alertBannerMsg").innerText = topAlert.message + " — Action: " + topAlert.recommendedAction;
          const banner = document.getElementById("costAlertBanner");
          banner.style.display = "flex";
          banner.className = "alert-banner " + (topAlert.level === "critical" ? "critical" : "");
        }
      } catch (err) {
        console.error("Failed to load stats", err);
      }
    }

    function dismissBanner() {
      document.getElementById("costAlertBanner").style.display = "none";
    }

    // =========================================================================
    // USERS MANAGEMENT
    // =========================================================================
    let userSearchTimer = null;
    function debounceUserSearch() {
      clearTimeout(userSearchTimer);
      userSearchTimer = setTimeout(fetchUsers, 250);
    }

    async function fetchUsers() {
      const q = document.getElementById("userSearchInput").value.trim();
      const tbody = document.getElementById("usersTableBody");

      try {
        const res = await apiFetch("/api/admin/users?query=" + encodeURIComponent(q));
        const data = await res.json();
        document.getElementById("userCount").innerText = data.pagination.total;

        if (data.users.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No users match your search.</td></tr>';
          return;
        }

        tbody.innerHTML = data.users.map(u => {
          const isBanned = u.isBanned;
          const statusBadge = isBanned
            ? '<span class="badge badge-danger">BANNED</span>'
            : '<span class="badge badge-success">ACTIVE</span>';
          const verifiedBadge = u.isEmailVerified
            ? '<span class="badge badge-success">Verified</span>'
            : '<span class="badge badge-neutral">Pending</span>';

          const banBtn = isBanned
            ? '<button class="btn btn-secondary btn-sm" onclick="unbanUser(\\'' + u.id + '\\')">Unban</button>'
            : '<button class="btn btn-danger btn-sm" onclick="banUser(\\'' + u.id + '\\')">Ban</button>';

          return '<tr>' +
            '<td><strong>' + escapeHtml(u.displayName) + '</strong><br><span class="font-mono text-muted">@' + escapeHtml(u.username || "—") + '</span></td>' +
            '<td class="font-mono">' + escapeHtml(u.email) + '</td>' +
            '<td><span class="badge badge-neutral">' + u.role + '</span></td>' +
            '<td>' + statusBadge + '</td>' +
            '<td>' + verifiedBadge + '</td>' +
            '<td style="color: var(--text-muted); font-size: 12px;">' + new Date(u.createdAt).toLocaleDateString() + '</td>' +
            '<td><div style="display: flex; gap: 6px;">' +
              banBtn +
              (!u.isEmailVerified ? '<button class="btn btn-secondary btn-sm" onclick="resendVerification(\\'' + u.id + '\\')">Resend Verify</button>' : '') +
              '<button class="btn btn-secondary btn-sm" onclick="revokeSessions(\\'' + u.id + '\\')">Revoke</button>' +
            '</div></td>' +
          '</tr>';
        }).join("");
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 24px;">Failed to fetch users. Check admin token.</td></tr>';
      }
    }

    async function banUser(userId) {
      const reason = prompt("Enter reason for banning user:");
      if (!reason) return;
      const res = await apiFetch("/api/admin/users/" + userId + "/ban", {
        method: "POST",
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      showToast(data.message || "User banned");
      fetchUsers();
    }

    async function unbanUser(userId) {
      if (!confirm("Are you sure you want to unban this user?")) return;
      const res = await apiFetch("/api/admin/users/" + userId + "/unban", { method: "POST" });
      const data = await res.json();
      showToast(data.message || "User unbanned");
      fetchUsers();
    }

    async function revokeSessions(userId) {
      if (!confirm("Revoke all active sessions and disconnect user?")) return;
      const res = await apiFetch("/api/admin/users/" + userId + "/revoke-sessions", { method: "POST" });
      const data = await res.json();
      showToast("Revoked " + (data.revokedCount || 0) + " sessions");
      fetchUsers();
    }

    async function resendVerification(userId) {
      const res = await apiFetch("/api/admin/users/" + userId + "/resend-verification", { method: "POST" });
      const data = await res.json();
      showToast(data.message || "Verification email sent");
      loadStats();
    }

    // =========================================================================
    // ROOMS MANAGEMENT
    // =========================================================================
    async function fetchRooms() {
      const tbody = document.getElementById("roomsTableBody");
      try {
        const res = await apiFetch("/api/admin/rooms");
        const rooms = await res.json();
        document.getElementById("roomCount").innerText = rooms.length;

        if (rooms.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No active rooms right now.</td></tr>';
          return;
        }

        tbody.innerHTML = rooms.map(r => {
          return '<tr>' +
            '<td class="font-mono"><strong>' + escapeHtml(r.roomCode) + '</strong></td>' +
            '<td>' + escapeHtml(r.roomName) + '</td>' +
            '<td>' + escapeHtml(r.hostUserName) + '</td>' +
            '<td><span class="badge badge-neutral">' + r.memberCount + ' members</span></td>' +
            '<td>' + (r.currentVideoId ? '<span class="font-mono">' + escapeHtml(r.currentVideoId.slice(0, 24)) + '</span>' : 'Idle') + ' (' + r.playbackStatus + ')</td>' +
            '<td>' +
              (r.isLocked ? '<span class="badge badge-danger">Locked</span> ' : '') +
              (r.isHomeRoom ? '<span class="badge badge-success">Home Room</span> ' : '') +
            '</td>' +
            '<td><div style="display: flex; gap: 6px;">' +
              '<button class="btn btn-secondary btn-sm" onclick="toggleRoomLock(\\'' + r.roomId + '\\', ' + (!r.isLocked) + ')">' + (r.isLocked ? 'Unlock' : 'Lock') + '</button>' +
              '<button class="btn btn-danger btn-sm" onclick="closeRoom(\\'' + r.roomId + '\\')">Close</button>' +
            '</div></td>' +
          '</tr>';
        }).join("");
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 24px;">Failed to fetch rooms.</td></tr>';
      }
    }

    async function closeRoom(roomId) {
      const reason = prompt("Enter reason for force closing room (sent to participants):", "Terminated by admin");
      if (!reason) return;
      const res = await apiFetch("/api/admin/rooms/" + roomId + "/close", {
        method: "POST",
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      showToast(data.message || "Room closed");
      fetchRooms();
      loadStats();
    }

    async function toggleRoomLock(roomId, locked) {
      const res = await apiFetch("/api/admin/rooms/" + roomId + "/lock", {
        method: "POST",
        body: JSON.stringify({ locked })
      });
      const data = await res.json();
      showToast(data.message || "Room lock status changed");
      fetchRooms();
    }

    // =========================================================================
    // MODERATION REPORTS
    // =========================================================================
    async function fetchReports() {
      const tbody = document.getElementById("reportsTableBody");
      try {
        const res = await apiFetch("/api/admin/reports");
        const reports = await res.json();
        document.getElementById("reportCount").innerText = reports.length;

        if (reports.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No moderation reports.</td></tr>';
          return;
        }

        tbody.innerHTML = reports.map(rep => {
          const statusBadge = rep.status === "pending"
            ? '<span class="badge badge-warning">Pending</span>'
            : '<span class="badge badge-neutral">' + rep.status + '</span>';

          return '<tr>' +
            '<td class="font-mono">' + escapeHtml(rep.roomCode) + '</td>' +
            '<td>' + escapeHtml(rep.reporterUserName) + '</td>' +
            '<td><strong>' + escapeHtml(rep.targetUserName) + '</strong></td>' +
            '<td>' + escapeHtml(rep.reason) + '</td>' +
            '<td><div style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + escapeHtml(rep.reportedMessageText || rep.description || "—") + '</div></td>' +
            '<td>' + statusBadge + '</td>' +
            '<td><div style="display: flex; gap: 6px;">' +
              '<button class="btn btn-danger btn-sm" onclick="actionReport(\\'' + rep.id + '\\', \\'ban_user\\')">Ban Offender</button>' +
              '<button class="btn btn-secondary btn-sm" onclick="actionReport(\\'' + rep.id + '\\', \\'dismiss\\')">Dismiss</button>' +
            '</div></td>' +
          '</tr>';
        }).join("");
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 24px;">Failed to fetch reports.</td></tr>';
      }
    }

    async function actionReport(reportId, action) {
      if (!confirm("Are you sure you want to perform action: " + action + "?")) return;
      const res = await apiFetch("/api/admin/reports/" + reportId + "/action", {
        method: "POST",
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      showToast(data.message || "Action executed");
      fetchReports();
    }

    // =========================================================================
    // INVITES MANAGEMENT
    // =========================================================================
    async function fetchInvites() {
      const tbody = document.getElementById("invitesTableBody");
      try {
        const res = await apiFetch("/api/admin/invites");
        const invites = await res.json();
        document.getElementById("inviteCount").innerText = invites.length;

        if (invites.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No invite codes created yet.</td></tr>';
          return;
        }

        tbody.innerHTML = invites.map(inv => {
          const isExpired = inv.expiresAt && Date.now() > inv.expiresAt;
          const status = inv.isRevoked
            ? '<span class="badge badge-danger">Revoked</span>'
            : isExpired
            ? '<span class="badge badge-warning">Expired</span>'
            : '<span class="badge badge-success">Active</span>';

          const max = inv.maxUses ? inv.maxUses : "∞";
          const exp = inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : "Never";

          return '<tr>' +
            '<td class="font-mono"><strong>' + escapeHtml(inv.code) + '</strong></td>' +
            '<td>' + inv.useCount + ' / ' + max + '</td>' +
            '<td style="color: var(--text-muted);">' + exp + '</td>' +
            '<td>' + status + '</td>' +
            '<td>' + escapeHtml(inv.note || "—") + '</td>' +
            '<td><div style="display: flex; gap: 6px;">' +
              '<button class="btn btn-secondary btn-sm" onclick="copyInviteLink(\\'' + inv.code + '\\')">Copy Link</button>' +
              (!inv.isRevoked ? '<button class="btn btn-danger btn-sm" onclick="revokeInvite(\\'' + inv.code + '\\')">Revoke</button>' : '') +
            '</div></td>' +
          '</tr>';
        }).join("");
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 24px;">Failed to fetch invites.</td></tr>';
      }
    }

    function openCreateInviteModal() {
      openModal("createInviteModal");
    }

    async function submitCreateInvite() {
      const customCode = document.getElementById("customCodeInput").value.trim();
      const maxUses = parseInt(document.getElementById("maxUsesInput").value, 10) || undefined;
      const expiresInDays = parseInt(document.getElementById("expiryDaysInput").value, 10) || undefined;
      const note = document.getElementById("noteInput").value.trim();

      const res = await apiFetch("/api/admin/invites", {
        method: "POST",
        body: JSON.stringify({ customCode, maxUses, expiresInDays, note })
      });

      if (res.ok) {
        closeModal("createInviteModal");
        showToast("Invite created successfully");
        fetchInvites();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to create invite");
      }
    }

    async function revokeInvite(code) {
      if (!confirm("Revoke invite code " + code + "?")) return;
      const res = await apiFetch("/api/admin/invites/" + encodeURIComponent(code), { method: "DELETE" });
      if (res.ok) {
        showToast("Invite revoked");
        fetchInvites();
      }
    }

    function copyInviteLink(code) {
      const url = window.location.origin + "/?invite=" + encodeURIComponent(code);
      navigator.clipboard.writeText(url).then(() => {
        showToast("Copied invite link: " + url);
      }).catch(() => {
        prompt("Copy invite link:", url);
      });
    }

    // =========================================================================
    // REGISTRATION MODE & KILL SWITCH
    // =========================================================================
    function openRegModeModal() {
      openModal("regModeModal");
    }

    async function submitRegMode() {
      const mode = document.getElementById("regModeSelect").value;
      if (mode === "disabled") {
        if (!confirm("WARNING: Emergency Kill Switch will completely block all new user registrations across the server. Proceed?")) {
          return;
        }
      }

      const res = await apiFetch("/api/admin/registration-mode", {
        method: "POST",
        body: JSON.stringify({ mode })
      });

      if (res.ok) {
        closeModal("regModeModal");
        showToast("Registration mode updated to " + mode);
        loadStats();
      }
    }

    // =========================================================================
    // SENTRY & ERROR LOGS
    // =========================================================================
    async function fetchErrors() {
      const tbody = document.getElementById("errorsTableBody");
      try {
        const res = await apiFetch("/api/admin/errors");
        const errors = await res.json();
        document.getElementById("errorCount").innerText = errors.length;

        if (errors.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">No recent errors captured. System healthy!</td></tr>';
          return;
        }

        tbody.innerHTML = errors.map(err => {
          return '<tr>' +
            '<td style="white-space: nowrap; font-size: 11px; color: var(--text-muted);">' + new Date(err.timestamp).toLocaleTimeString() + '</td>' +
            '<td><span class="badge badge-' + (err.level === 'error' ? 'danger' : 'warning') + '">' + err.level + '</span></td>' +
            '<td><strong>' + escapeHtml(err.message) + '</strong></td>' +
            '<td class="font-mono">' + escapeHtml(err.roomId || "—") + '</td>' +
            '<td class="font-mono">' + escapeHtml(err.userId || "—") + '</td>' +
            '<td><pre style="max-width: 320px; max-height: 48px; overflow: auto; font-size: 10px; color: var(--text-muted);">' + escapeHtml(err.stack || "—") + '</pre></td>' +
          '</tr>';
        }).join("");
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 24px;">Failed to fetch error telemetry.</td></tr>';
      }
    }

    function escapeHtml(str) {
      if (!str) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    // Initial Bootstrap
    document.addEventListener("DOMContentLoaded", () => {
      loadStats();
      fetchUsers();
      fetchRooms();
      fetchReports();
      fetchInvites();
      fetchErrors();
      setInterval(loadStats, 15000); // 15s live polling
    });
  </script>
</body>
</html>
`;
}
