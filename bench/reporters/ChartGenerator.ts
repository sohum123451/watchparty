import { DistributionStats, computeHistogramBins } from "./Stats.js";

export interface LatencyChartData {
  title: string;
  latencies: number[];
  stats: DistributionStats;
  passThresholdMs: number; // 250 ms
}

export interface DriftTimePoint {
  timeSeconds: number;
  drifts: number[]; // drift for each client at this instant
  meanDrift: number;
  p95Drift: number;
  maxDrift: number;
  marker?: string; // e.g. "SEEK", "RECONNECT"
}

export interface DriftChartData {
  title: string;
  durationSeconds: number;
  timePoints: DriftTimePoint[];
  passThresholdMs: number; // 500 ms
  deadZoneMs: number;      // 40 ms
}

export class ChartGenerator {
  /**
   * Generates a clean, professional SVG Histogram for Control Propagation Latency.
   */
  public static generateLatencyHistogramSvg(data: LatencyChartData): string {
    const { latencies, stats, passThresholdMs } = data;
    const width = 900;
    const height = 480;
    const padding = { top: 60, right: 50, bottom: 80, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Use at least passThresholdMs * 1.2 or max latency
    const maxVal = Math.max(passThresholdMs * 1.2, Math.max(...latencies, 50));
    const binCount = 20;
    const bins = computeHistogramBins(latencies, binCount, 0, maxVal);
    const maxCount = Math.max(1, ...bins.map((b) => b.count));

    // Scales
    const xScale = (val: number) => padding.left + (val / maxVal) * chartWidth;
    const yScale = (count: number) =>
      padding.top + chartHeight - (count / maxCount) * chartHeight;

    // SLA Marker
    const slaX = xScale(passThresholdMs);
    const p50X = xScale(stats.p50);
    const p95X = xScale(stats.p95);
    const p99X = xScale(stats.p99);

    const isPass = stats.p95 <= passThresholdMs;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <defs>
    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#0284c7" stop-opacity="0.5"/>
    </linearGradient>
    <linearGradient id="exceedGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f87171" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#dc2626" stop-opacity="0.5"/>
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity="0.3"/>
    </filter>
  </defs>

  <!-- Title & Status -->
  <text x="${padding.left}" y="35" fill="#f8fafc" font-size="18" font-weight="700">Control Propagation Latency Distribution</text>
  <text x="${width - padding.right}" y="35" text-anchor="end" fill="${isPass ? '#4ade80' : '#f87171'}" font-size="14" font-weight="700">
    STATUS: ${isPass ? 'PASS (p95 ≤ 250ms)' : 'FAIL (p95 > 250ms)'}
  </text>

  <!-- Grid lines (horizontal) -->
  ${[0, 0.25, 0.5, 0.75, 1.0]
    .map((ratio) => {
      const y = padding.top + chartHeight * (1 - ratio);
      const val = Math.round(maxCount * ratio);
      return `
    <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#334155" stroke-dasharray="3,3" stroke-width="1"/>
    <text x="${padding.left - 10}" y="${y + 4}" fill="#94a3b8" font-size="11" text-anchor="end">${val}</text>`;
    })
    .join("")}

  <!-- Axes -->
  <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${width - padding.right}" y2="${padding.top + chartHeight}" stroke="#64748b" stroke-width="1.5"/>
  <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartHeight}" stroke="#64748b" stroke-width="1.5"/>

  <!-- Axis Labels -->
  <text x="${padding.left + chartWidth / 2}" y="${height - 20}" fill="#94a3b8" font-size="12" font-weight="600" text-anchor="middle">Latency (milliseconds)</text>
  <text x="25" y="${padding.top + chartHeight / 2}" fill="#94a3b8" font-size="12" font-weight="600" text-anchor="middle" transform="rotate(-90, 25, ${padding.top + chartHeight / 2})">Sample Count</text>

  <!-- Bars -->
  ${bins
    .map((b) => {
      const x = xScale(b.binStart) + 1;
      const binW = Math.max(2, xScale(b.binEnd) - xScale(b.binStart) - 2);
      const y = yScale(b.count);
      const barH = padding.top + chartHeight - y;
      const isExceeding = b.binStart >= passThresholdMs;
      const fill = isExceeding ? "url(#exceedGradient)" : "url(#barGradient)";
      const stroke = isExceeding ? "#ef4444" : "#38bdf8";

      return `
    <rect x="${x}" y="${y}" width="${binW}" height="${barH}" fill="${fill}" stroke="${stroke}" stroke-width="1" rx="2" filter="url(#shadow)">
      <title>${b.binStart.toFixed(0)}-${b.binEnd.toFixed(0)} ms: ${b.count} samples (${b.percentage}%)</title>
    </rect>`;
    })
    .join("")}

  <!-- X-Axis Tick Marks -->
  ${[0, 50, 100, 150, 200, 250, 300]
    .filter((tick) => tick <= maxVal)
    .map((tick) => {
      const x = xScale(tick);
      return `
    <line x1="${x}" y1="${padding.top + chartHeight}" x2="${x}" y2="${padding.top + chartHeight + 6}" stroke="#64748b" stroke-width="1.5"/>
    <text x="${x}" y="${padding.top + chartHeight + 20}" fill="#94a3b8" font-size="11" text-anchor="middle">${tick}ms</text>`;
    })
    .join("")}

  <!-- SLA Threshold Line (250 ms) -->
  <line x1="${slaX}" y1="${padding.top - 10}" x2="${slaX}" y2="${padding.top + chartHeight}" stroke="#ef4444" stroke-width="2.5" stroke-dasharray="6,4"/>
  <rect x="${slaX - 60}" y="${padding.top - 25}" width="120" height="20" fill="#7f1d1d" rx="4" stroke="#ef4444" stroke-width="1"/>
  <text x="${slaX}" y="${padding.top - 11}" fill="#fecaca" font-size="10" font-weight="700" text-anchor="middle">SLA TARGET: 250ms</text>

  <!-- Percentile Markers -->
  <!-- p50 -->
  <line x1="${p50X}" y1="${padding.top}" x2="${p50X}" y2="${padding.top + chartHeight}" stroke="#a855f7" stroke-width="1.5" stroke-dasharray="4,3"/>
  <text x="${p50X}" y="${padding.top + 15}" fill="#c084fc" font-size="10" font-weight="700" text-anchor="middle">p50: ${stats.p50}ms</text>

  <!-- p95 -->
  <line x1="${p95X}" y1="${padding.top}" x2="${p95X}" y2="${padding.top + chartHeight}" stroke="#f59e0b" stroke-width="2"/>
  <text x="${p95X}" y="${padding.top + 30}" fill="#fbbf24" font-size="10" font-weight="700" text-anchor="middle">p95: ${stats.p95}ms</text>

  <!-- Summary Box -->
  <rect x="${width - padding.right - 220}" y="${padding.top + 10}" width="210" height="105" fill="#1e293b" rx="6" stroke="#334155" stroke-width="1"/>
  <text x="${width - padding.right - 205}" y="${padding.top + 30}" fill="#e2e8f0" font-size="11" font-weight="700">Summary Statistics (N=${stats.count})</text>
  <text x="${width - padding.right - 205}" y="${padding.top + 48}" fill="#94a3b8" font-size="10">p50: <tspan fill="#f1f5f9" font-weight="600">${stats.p50} ms</tspan> | p90: <tspan fill="#f1f5f9" font-weight="600">${stats.p90} ms</tspan></text>
  <text x="${width - padding.right - 205}" y="${padding.top + 66}" fill="#94a3b8" font-size="10">p95: <tspan fill="#f1f5f9" font-weight="600">${stats.p95} ms</tspan> | p99: <tspan fill="#f1f5f9" font-weight="600">${stats.p99} ms</tspan></text>
  <text x="${width - padding.right - 205}" y="${padding.top + 84}" fill="#94a3b8" font-size="10">Mean: <tspan fill="#f1f5f9" font-weight="600">${stats.mean} ms</tspan> | Max: <tspan fill="#f1f5f9" font-weight="600">${stats.max} ms</tspan></text>
  <text x="${width - padding.right - 205}" y="${padding.top + 102}" fill="#94a3b8" font-size="10">Pass SLA: <tspan fill="${isPass ? '#4ade80' : '#f87171'}" font-weight="700">${isPass ? 'YES' : 'NO'}</tspan></text>
</svg>`;

    return svg;
  }

  /**
   * Generates a clean, multi-client Post-Correction Drift Over Time SVG chart.
   */
  public static generateDriftOverTimeSvg(data: DriftChartData): string {
    const { timePoints, durationSeconds, passThresholdMs, deadZoneMs } = data;
    const width = 1000;
    const height = 520;
    const padding = { top: 60, right: 60, bottom: 80, left: 80 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Y scale range from -passThresholdMs * 1.15 to +passThresholdMs * 1.15 (e.g. -575 to +575)
    const yLimit = Math.max(passThresholdMs * 1.15, 550);

    const xScale = (sec: number) => padding.left + (sec / durationSeconds) * chartWidth;
    const yScale = (driftMs: number) => {
      const clamped = Math.max(-yLimit, Math.min(yLimit, driftMs));
      return padding.top + chartHeight / 2 - (clamped / yLimit) * (chartHeight / 2);
    };

    const zeroY = yScale(0);
    const upperDeadZoneY = yScale(deadZoneMs);
    const lowerDeadZoneY = yScale(-deadZoneMs);
    const upperSlaY = yScale(passThresholdMs);
    const lowerSlaY = yScale(-passThresholdMs);

    // Compute max absolute drift recorded across all samples
    let maxObservedAbsDrift = 0;
    for (const pt of timePoints) {
      if (pt.maxDrift > maxObservedAbsDrift) {
        maxObservedAbsDrift = pt.maxDrift;
      }
    }
    const isPass = maxObservedAbsDrift <= passThresholdMs;

    // Generate Path for mean drift
    const meanPathD = timePoints
      .map((pt, i) => `${i === 0 ? "M" : "L"} ${xScale(pt.timeSeconds).toFixed(1)} ${yScale(pt.meanDrift).toFixed(1)}`)
      .join(" ");

    // Generate Path for p95 drift envelope
    const upperEnvD = timePoints
      .map((pt, i) => `${i === 0 ? "M" : "L"} ${xScale(pt.timeSeconds).toFixed(1)} ${yScale(pt.p95Drift).toFixed(1)}`)
      .join(" ");

    const lowerEnvD = timePoints
      .map((pt, i) => `${i === 0 ? "M" : "L"} ${xScale(pt.timeSeconds).toFixed(1)} ${yScale(-pt.p95Drift).toFixed(1)}`)
      .join(" ");

    // Events / Markers (Seek, Reconnect)
    const markerElements = timePoints
      .filter((pt) => pt.marker)
      .map((pt) => {
        const x = xScale(pt.timeSeconds);
        return `
    <line x1="${x}" y1="${padding.top}" x2="${x}" y2="${padding.top + chartHeight}" stroke="#eab308" stroke-width="1.5" stroke-dasharray="3,3"/>
    <rect x="${x - 45}" y="${padding.top + 10}" width="90" height="20" rx="3" fill="#854d0e" stroke="#eab308" stroke-width="1"/>
    <text x="${x}" y="${padding.top + 24}" fill="#fef08a" font-size="9" font-weight="700" text-anchor="middle">${pt.marker} (${pt.timeSeconds}s)</text>`;
      })
      .join("");

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <defs>
    <linearGradient id="deadbandGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#10b981" stop-opacity="0.25"/>
    </linearGradient>
    <linearGradient id="slaGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ef4444" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#ef4444" stop-opacity="0.05"/>
    </linearGradient>
  </defs>

  <!-- Title & Status -->
  <text x="${padding.left}" y="35" fill="#f8fafc" font-size="18" font-weight="700">Client Post-Correction Drift Over Time (5-Minute Timeline)</text>
  <text x="${width - padding.right}" y="35" text-anchor="end" fill="${isPass ? '#4ade80' : '#f87171'}" font-size="14" font-weight="700">
    PASS CRITERION: ≤ 500ms | STATUS: ${isPass ? 'PASS' : 'FAIL'}
  </text>

  <!-- Deadband Zone Shading (±40ms) -->
  <rect x="${padding.left}" y="${upperDeadZoneY}" width="${chartWidth}" height="${lowerDeadZoneY - upperDeadZoneY}" fill="url(#deadbandGradient)" stroke="#10b981" stroke-width="0.5" stroke-dasharray="2,2"/>
  <text x="${width - padding.right - 10}" y="${upperDeadZoneY + 14}" fill="#34d399" font-size="10" font-weight="600" text-anchor="end">In-Sync Deadband (±40 ms)</text>

  <!-- Horizontal Grid lines -->
  ${[-500, -250, 0, 250, 500]
    .map((drift) => {
      const y = yScale(drift);
      const isZero = drift === 0;
      return `
    <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${isZero ? '#64748b' : '#334155'}" stroke-width="${isZero ? 1.5 : 1}" stroke-dasharray="${isZero ? '' : '3,3'}"/>
    <text x="${padding.left - 10}" y="${y + 4}" fill="#94a3b8" font-size="11" text-anchor="end">${drift > 0 ? '+' : ''}${drift} ms</text>`;
    })
    .join("")}

  <!-- Upper and Lower SLA Boundary Lines (±500ms) -->
  <line x1="${padding.left}" y1="${upperSlaY}" x2="${width - padding.right}" y2="${upperSlaY}" stroke="#ef4444" stroke-width="2" stroke-dasharray="6,3"/>
  <line x1="${padding.left}" y1="${lowerSlaY}" x2="${width - padding.right}" y2="${lowerSlaY}" stroke="#ef4444" stroke-width="2" stroke-dasharray="6,3"/>
  <text x="${padding.left + 10}" y="${upperSlaY - 6}" fill="#f87171" font-size="10" font-weight="700">+500 ms SLA Threshold</text>
  <text x="${padding.left + 10}" y="${lowerSlaY + 14}" fill="#f87171" font-size="10" font-weight="700">-500 ms SLA Threshold</text>

  <!-- Axes -->
  <line x1="${padding.left}" y1="${padding.top + chartHeight}" x2="${width - padding.right}" y2="${padding.top + chartHeight}" stroke="#64748b" stroke-width="1.5"/>
  <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartHeight}" stroke="#64748b" stroke-width="1.5"/>

  <!-- Axis Labels -->
  <text x="${padding.left + chartWidth / 2}" y="${height - 20}" fill="#94a3b8" font-size="12" font-weight="600" text-anchor="middle">Elapsed Video Playback Time (seconds)</text>
  <text x="25" y="${padding.top + chartHeight / 2}" fill="#94a3b8" font-size="12" font-weight="600" text-anchor="middle" transform="rotate(-90, 25, ${padding.top + chartHeight / 2})">Simulated Video Drift vs Target (ms)</text>

  <!-- X-Axis Ticks (every 30s) -->
  ${Array.from({ length: Math.floor(durationSeconds / 30) + 1 }, (_, i) => i * 30)
    .map((sec) => {
      const x = xScale(sec);
      const minutes = Math.floor(sec / 60);
      const remSec = sec % 60;
      const label = `${minutes}:${remSec < 10 ? '0' : ''}${remSec}`;
      return `
    <line x1="${x}" y1="${padding.top + chartHeight}" x2="${x}" y2="${padding.top + chartHeight + 6}" stroke="#64748b" stroke-width="1"/>
    <text x="${x}" y="${padding.top + chartHeight + 20}" fill="#94a3b8" font-size="10" text-anchor="middle">${label}</text>`;
    })
    .join("")}

  <!-- Markers for Seek / Reconnect -->
  ${markerElements}

  <!-- Upper and Lower Envelope (p95 drift envelope) -->
  <path d="${upperEnvD}" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="2,2"/>
  <path d="${lowerEnvD}" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="2,2"/>

  <!-- Mean Drift Path -->
  <path d="${meanPathD}" fill="none" stroke="#38bdf8" stroke-width="2.5"/>

  <!-- Legend Box -->
  <rect x="${width - padding.right - 260}" y="${height - padding.bottom + 35}" width="250" height="35" fill="#1e293b" rx="4" stroke="#334155" stroke-width="1"/>
  <line x1="${width - padding.right - 245}" y1="${height - padding.bottom + 52}" x2="${width - padding.right - 225}" y2="${height - padding.bottom + 52}" stroke="#38bdf8" stroke-width="2.5"/>
  <text x="${width - padding.right - 220}" y="${height - padding.bottom + 56}" fill="#cbd5e1" font-size="10">Mean Drift</text>
  <line x1="${width - padding.right - 155}" y1="${height - padding.bottom + 52}" x2="${width - padding.right - 135}" y2="${height - padding.bottom + 52}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="2,2"/>
  <text x="${width - padding.right - 130}" y="${height - padding.bottom + 56}" fill="#cbd5e1" font-size="10">p95 Envelope</text>
  <rect x="${width - padding.right - 55}" y="${height - padding.bottom + 46}" width="12" height="12" fill="#10b981" fill-opacity="0.4" stroke="#10b981" stroke-width="1"/>
  <text x="${width - padding.right - 38}" y="${height - padding.bottom + 56}" fill="#cbd5e1" font-size="10">Deadband</text>
</svg>`;

    return svg;
  }
}
