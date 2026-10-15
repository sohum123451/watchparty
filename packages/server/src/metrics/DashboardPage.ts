export function getGrafanaDashboardJson(): object {
  return {
    annotations: { list: [] },
    editable: true,
    fiscalYearStartMonth: 0,
    graphTooltip: 0,
    id: null,
    links: [],
    liveNow: false,
    panels: [
      {
        gridPos: { h: 4, w: 4, x: 0, y: 0 },
        id: 1,
        title: "Active Rooms",
        type: "stat",
        targets: [{ expr: "watchparty_active_rooms", refId: "A" }],
        fieldConfig: { defaults: { color: { mode: "palette-classic" }, unit: "none" } },
      },
      {
        gridPos: { h: 4, w: 4, x: 4, y: 0 },
        id: 2,
        title: "Connected Sockets",
        type: "stat",
        targets: [{ expr: "watchparty_connected_sockets", refId: "A" }],
        fieldConfig: { defaults: { color: { mode: "palette-classic" }, unit: "none" } },
      },
      {
        gridPos: { h: 4, w: 4, x: 8, y: 0 },
        id: 3,
        title: "Latency (p95)",
        type: "stat",
        targets: [
          {
            expr: "histogram_quantile(0.95, sum(rate(watchparty_command_latency_seconds_bucket[5m])) by (le)) * 1000",
            refId: "A",
          },
        ],
        fieldConfig: {
          defaults: {
            color: { mode: "thresholds" },
            thresholds: {
              mode: "absolute",
              steps: [
                { color: "green", value: null },
                { color: "yellow", value: 150 },
                { color: "red", value: 250 },
              ],
            },
            unit: "ms",
          },
        },
      },
      {
        gridPos: { h: 4, w: 4, x: 12, y: 0 },
        id: 4,
        title: "Max Drift",
        type: "stat",
        targets: [
          {
            expr: "histogram_quantile(0.99, sum(rate(watchparty_drift_milliseconds_bucket[5m])) by (le))",
            refId: "A",
          },
        ],
        fieldConfig: {
          defaults: {
            color: { mode: "thresholds" },
            thresholds: {
              mode: "absolute",
              steps: [
                { color: "green", value: null },
                { color: "yellow", value: 200 },
                { color: "red", value: 500 },
              ],
            },
            unit: "ms",
          },
        },
      },
      {
        gridPos: { h: 4, w: 4, x: 16, y: 0 },
        id: 5,
        title: "Reconnect Rate",
        type: "stat",
        targets: [{ expr: "rate(watchparty_reconnect_total[1m])", refId: "A" }],
        fieldConfig: { defaults: { unit: "reqps" } },
      },
      {
        gridPos: { h: 4, w: 4, x: 20, y: 0 },
        id: 6,
        title: "Error Rate",
        type: "stat",
        targets: [{ expr: "rate(watchparty_errors_total[1m])", refId: "A" }],
        fieldConfig: {
          defaults: {
            color: { mode: "thresholds" },
            thresholds: {
              mode: "absolute",
              steps: [
                { color: "green", value: null },
                { color: "red", value: 0.1 },
              ],
            },
            unit: "reqps",
          },
        },
      },
      {
        gridPos: { h: 8, w: 12, x: 0, y: 4 },
        id: 7,
        title: "Command Latency Distribution (p50, p90, p95)",
        type: "timeseries",
        targets: [
          {
            expr: "histogram_quantile(0.50, sum(rate(watchparty_command_latency_seconds_bucket[1m])) by (le)) * 1000",
            legendFormat: "p50 (median)",
            refId: "A",
          },
          {
            expr: "histogram_quantile(0.90, sum(rate(watchparty_command_latency_seconds_bucket[1m])) by (le)) * 1000",
            legendFormat: "p90",
            refId: "B",
          },
          {
            expr: "histogram_quantile(0.95, sum(rate(watchparty_command_latency_seconds_bucket[1m])) by (le)) * 1000",
            legendFormat: "p95 (target <= 250ms)",
            refId: "C",
          },
        ],
        fieldConfig: { defaults: { custom: { lineWidth: 2 }, unit: "ms" } },
      },
      {
        gridPos: { h: 8, w: 12, x: 12, y: 4 },
        id: 8,
        title: "Playback Drift Distribution (p95)",
        type: "timeseries",
        targets: [
          {
            expr: "histogram_quantile(0.95, sum(rate(watchparty_drift_milliseconds_bucket[1m])) by (le))",
            legendFormat: "p95 Drift (target <= 500ms)",
            refId: "A",
          },
        ],
        fieldConfig: { defaults: { custom: { lineWidth: 2 }, unit: "ms" } },
      },
    ],
    schemaVersion: 39,
    tags: ["watchparty", "prometheus", "production"],
    title: "WatchParty - Real-Time Observability & Performance Dashboard",
    uid: "watchparty-prod-metrics",
    version: 1,
  };
}

export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WatchParty - Metrics & Cluster Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 24, 38, 0.7);
      --border: rgba(255, 255, 255, 0.08);
      --border-glow: rgba(99, 102, 241, 0.25);
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --accent: #06b6d4;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(6, 182, 212, 0.1) 0px, transparent 50%);
      color: var(--text);
      font-family: 'Inter', -apple-system, sans-serif;
      min-height: 100vh;
      padding: 2rem;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    .header-left h1 {
      font-size: 1.75rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--success);
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .status-dot {
      width: 6px;
      height: 6px;
      background: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--success);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .actions {
      display: flex;
      gap: 0.75rem;
    }
    .btn {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.5rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s ease;
      backdrop-filter: blur(12px);
    }
    .btn:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: var(--border-glow);
      transform: translateY(-1px);
    }
    .btn-primary {
      background: var(--primary);
      border-color: var(--primary);
      color: white;
    }
    .btn-primary:hover {
      background: var(--primary-hover);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.5rem;
      backdrop-filter: blur(16px);
      transition: all 0.2s ease;
      position: relative;
      overflow: hidden;
    }
    .card:hover {
      border-color: var(--border-glow);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
    }
    .card-label {
      color: var(--text-muted);
      font-size: 0.8125rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    .card-val {
      font-size: 2.25rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: #fff;
    }
    .card-sub {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .val-pass { color: var(--success); }
    .val-warn { color: var(--warning); }
    .val-fail { color: var(--danger); }
    
    .charts-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
      margin-bottom: 2rem;
    }
    @media (max-width: 900px) {
      .charts-row { grid-template-columns: 1fr; }
    }
    .panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.5rem;
      backdrop-filter: blur(16px);
    }
    .panel-title {
      font-size: 1rem;
      font-weight: 700;
      margin-bottom: 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .code-block {
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8125rem;
      color: #a5b4fc;
      max-height: 280px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
    .progress-bar-container {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 9999px;
      height: 8px;
      overflow: hidden;
      margin-top: 0.75rem;
    }
    .progress-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--primary), var(--accent));
      border-radius: 9999px;
      transition: width 0.3s ease;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>WatchParty Live Observability</h1>
      <div class="status-badge">
        <span class="status-dot"></span>
        <span id="systemStatus">Cluster Healthy</span>
      </div>
    </div>
    <div class="actions">
      <a href="/api/metrics/dashboard.json" download="watchparty-grafana-dashboard.json" class="btn">
        <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20"><path d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"/></svg>
        Export Grafana JSON
      </a>
      <a href="/metrics" target="_blank" class="btn btn-primary">
        <svg width="14" height="14" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 11H9v-2h2v2zm0-4H9V5h2v4z"/></svg>
        Prometheus Endpoint
      </a>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="card-label">Active Sockets</div>
      <div class="card-val" id="connectedSockets">0</div>
      <div class="card-sub">WebSocket clients online</div>
    </div>
    <div class="card">
      <div class="card-label">Active Rooms</div>
      <div class="card-val" id="activeRooms">0</div>
      <div class="card-sub">Synchronized rooms</div>
    </div>
    <div class="card">
      <div class="card-label">Command Latency (p95)</div>
      <div class="card-val val-pass" id="latencyP95">0 ms</div>
      <div class="card-sub">Target SLA: &le; 250ms</div>
      <div class="progress-bar-container">
        <div class="progress-bar" id="latencyBar" style="width: 10%"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-label">Max Drift</div>
      <div class="card-val val-pass" id="maxDrift">0 ms</div>
      <div class="card-sub">Target SLA: &le; 500ms</div>
      <div class="progress-bar-container">
        <div class="progress-bar" id="driftBar" style="width: 5%"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-label">Reconnects / Min</div>
      <div class="card-val" id="reconnectRate">0</div>
      <div class="card-sub">Total: <span id="reconnectTotal">0</span></div>
    </div>
    <div class="card">
      <div class="card-label">Errors / Min</div>
      <div class="card-val val-pass" id="errorRate">0</div>
      <div class="card-sub">Total Errors: <span id="errorTotal">0</span></div>
    </div>
  </div>

  <div class="charts-row">
    <div class="panel">
      <div class="panel-title">
        <span>Latency Breakdown</span>
        <span style="font-size: 0.75rem; color: var(--text-muted);">Real-time Quantiles</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; text-align: center; margin-bottom: 1.5rem;">
        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">p50 (Median)</div>
          <div style="font-size: 1.25rem; font-weight: 700;" id="p50Val">0 ms</div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">p90</div>
          <div style="font-size: 1.25rem; font-weight: 700;" id="p90Val">0 ms</div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">p95</div>
          <div style="font-size: 1.25rem; font-weight: 700; color: var(--success);" id="p95Val">0 ms</div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">p99</div>
          <div style="font-size: 1.25rem; font-weight: 700;" id="p99Val">0 ms</div>
        </div>
      </div>
      <div class="panel-title">
        <span>Raw Prometheus Feed (/metrics)</span>
      </div>
      <div class="code-block" id="rawMetrics">Loading metrics...</div>
    </div>

    <div class="panel">
      <div class="panel-title">
        <span>Multi-Node Cluster Topology & Guarantees</span>
        <span class="status-badge" style="background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.3); color: var(--primary);">Redis Pub/Sub</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.875rem; color: var(--text-muted);">
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
          <span>Per-Room Ordering</span>
          <strong style="color: var(--success);">Enforced (Single-Owner Node)</strong>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
          <span>State Snapshots</span>
          <strong style="color: #fff;">Redis Key: room:snapshot:*</strong>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
          <span>Cluster Pub/Sub</span>
          <strong style="color: #fff;">watchparty:cluster:events</strong>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
          <span>Server Uptime</span>
          <strong style="color: #fff;" id="uptime">0s</strong>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 0.5rem 0;">
          <span>Messages (In / Out)</span>
          <strong style="color: #fff;"><span id="msgIn">0</span> / <span id="msgOut">0</span></strong>
        </div>
      </div>
    </div>
  </div>

  <script>
    async function updateDashboard() {
      try {
        const [sumRes, promRes] = await Promise.all([
          fetch('/api/metrics/summary').then(r => r.json()),
          fetch('/metrics').then(r => r.text())
        ]);

        document.getElementById('connectedSockets').innerText = sumRes.connectedSockets;
        document.getElementById('activeRooms').innerText = sumRes.activeRooms;
        
        const p95 = sumRes.commandLatency.p95 || 0;
        const p95El = document.getElementById('latencyP95');
        p95El.innerText = p95 + ' ms';
        p95El.className = 'card-val ' + (p95 <= 250 ? 'val-pass' : 'val-fail');
        document.getElementById('latencyBar').style.width = Math.min(100, (p95 / 250) * 100) + '%';

        const maxDrift = sumRes.drift.maxMs || 0;
        const driftEl = document.getElementById('maxDrift');
        driftEl.innerText = maxDrift + ' ms';
        driftEl.className = 'card-val ' + (maxDrift <= 500 ? 'val-pass' : 'val-fail');
        document.getElementById('driftBar').style.width = Math.min(100, (maxDrift / 500) * 100) + '%';

        document.getElementById('reconnectRate').innerText = sumRes.reconnects.ratePerMinute;
        document.getElementById('reconnectTotal').innerText = (sumRes.reconnects.totalSuccess + sumRes.reconnects.totalFailure);

        const errorRate = sumRes.errors.ratePerMinute;
        const errorEl = document.getElementById('errorRate');
        errorEl.innerText = errorRate;
        errorEl.className = 'card-val ' + (errorRate === 0 ? 'val-pass' : 'val-fail');
        document.getElementById('errorTotal').innerText = sumRes.errors.total;

        document.getElementById('p50Val').innerText = sumRes.commandLatency.p50 + ' ms';
        document.getElementById('p90Val').innerText = sumRes.commandLatency.p90 + ' ms';
        document.getElementById('p95Val').innerText = p95 + ' ms';
        document.getElementById('p99Val').innerText = sumRes.commandLatency.p99 + ' ms';

        document.getElementById('uptime').innerText = sumRes.uptimeSeconds + 's';
        document.getElementById('msgIn').innerText = sumRes.messages.inbound;
        document.getElementById('msgOut').innerText = sumRes.messages.outbound;

        document.getElementById('rawMetrics').innerText = promRes;
      } catch (err) {
        console.warn('Dashboard update error:', err);
      }
    }

    updateDashboard();
    setInterval(updateDashboard, 2000);
  </script>
</body>
</html>
`;
}
