import path from "node:path";
import fs from "node:fs/promises";
import { JsonReporter, BenchmarkSuiteResult } from "./reporters/JsonReporter.js";
import { MarkdownReporter } from "./reporters/MarkdownReporter.js";
import { ChartGenerator, DriftTimePoint } from "./reporters/ChartGenerator.js";
import { computeDistributionStats } from "./reporters/Stats.js";

import { runScalabilityScenario } from "./scenarios/ScalabilityScenario.js";
import { runSeekStormScenario } from "./scenarios/SeekStormScenario.js";
import { runHostDisconnectScenario } from "./scenarios/HostDisconnectScenario.js";
import { runLateJoinerScenario } from "./scenarios/LateJoinerScenario.js";
import { runPacketLossScenario } from "./scenarios/PacketLossScenario.js";
import { runJitterScenario } from "./scenarios/JitterScenario.js";
import { runReconnectLoopScenario } from "./scenarios/ReconnectLoopScenario.js";
import { runFiveMinuteDriftScenario } from "./scenarios/FiveMinuteDriftScenario.js";

async function main() {
  console.log("================================================================================");
  console.log("  WATCHPARTY DISTRIBUTED BENCHMARK HARNESS (/bench)");
  console.log("  Target SLAs: Control Latency p95 <= 250ms | Post-Correction Drift <= 500ms");
  console.log("================================================================================\n");

  const results: BenchmarkSuiteResult = {
    timestamp: new Date().toISOString(),
    environment: JsonReporter.getEnvironmentMetadata(),
    targets: {
      controlPropagationLatencyP95Ms: 250,
      postCorrectionDriftMaxMs: 500,
    },
    summary: {
      totalScenarios: 0,
      passedScenarios: 0,
      failedScenarios: 0,
      overallPass: false,
    },
    scenarios: [],
  };

  const allLatencies: number[] = [];
  let fiveMinuteDriftPoints: DriftTimePoint[] = [];

  const scenarioRunners: { name: string; run: () => Promise<any> }[] = [
    { name: "Scalability (N=10)", run: () => runScalabilityScenario(10) },
    { name: "Scalability (N=25)", run: () => runScalabilityScenario(25) },
    { name: "Scalability (N=50)", run: () => runScalabilityScenario(50) },
    { name: "Seek Storm", run: () => runSeekStormScenario(20) },
    { name: "Host Disconnect", run: () => runHostDisconnectScenario(10) },
    { name: "Late Joiner (40m)", run: () => runLateJoinerScenario() },
    { name: "20% Packet Loss", run: () => runPacketLossScenario(10) },
    { name: "150ms Jitter", run: () => runJitterScenario(10) },
    { name: "Reconnect Loop", run: () => runReconnectLoopScenario(8) },
    { name: "5-Minute Drift", run: () => runFiveMinuteDriftScenario(10) },
  ];

  const isSmoke = process.argv.includes("--smoke");
  const activeScenarioRunners = isSmoke
    ? [
        { name: "Scalability (N=10)", run: () => runScalabilityScenario(10) },
        { name: "Seek Storm", run: () => runSeekStormScenario(10) },
        { name: "Host Disconnect", run: () => runHostDisconnectScenario(5) },
        { name: "20% Packet Loss", run: () => runPacketLossScenario(5) },
      ]
    : scenarioRunners;

  if (isSmoke) {
    console.log(">> CI SMOKE MODE: Running fast validation subset\n");
  }

  for (let i = 0; i < activeScenarioRunners.length; i++) {
    const s = activeScenarioRunners[i];
    process.stdout.write(`[${i + 1}/${activeScenarioRunners.length}] Running ${s.name.padEnd(25)} ... `);
    const start = performance.now();

    try {
      const output = await s.run();
      const elapsed = ((performance.now() - start) / 1000).toFixed(2);
      results.scenarios.push(output.result);

      if (output.rawLatencies && output.rawLatencies.length > 0) {
        allLatencies.push(...output.rawLatencies);
      }
      if (output.driftTimePoints) {
        fiveMinuteDriftPoints = output.driftTimePoints;
      }

      if (output.result.status === "PASS") {
        console.log(`\x1b[32mPASS\x1b[0m (${elapsed}s) [p95: ${output.result.latencyStats.p95}ms, max drift: ${output.result.driftStats.max}ms]`);
      } else {
        console.log(`\x1b[31mFAIL\x1b[0m (${elapsed}s) [p95: ${output.result.latencyStats.p95}ms, max drift: ${output.result.driftStats.max}ms]`);
      }
    } catch (err: any) {
      console.log(`\x1b[31mERROR\x1b[0m: ${err.message}`);
      throw err;
    }
  }

  // Calculate totals
  results.summary.totalScenarios = results.scenarios.length;
  results.summary.passedScenarios = results.scenarios.filter((s) => s.status === "PASS").length;
  results.summary.failedScenarios = results.summary.totalScenarios - results.summary.passedScenarios;
  results.summary.overallPass = results.summary.failedScenarios === 0;

  console.log("\n================================================================================");
  console.log("  BENCHMARK SUMMARY & REPORT GENERATION");
  console.log("================================================================================\n");

  const resultsDir = path.resolve(process.cwd(), "bench", "results");
  await fs.mkdir(resultsDir, { recursive: true });

  // 1. Save JSON results
  const jsonPath = path.join(resultsDir, "benchmark-results.json");
  await JsonReporter.saveResults(results, jsonPath);
  await JsonReporter.saveResults(results, "bench-results.json");
  console.log(`✓ JSON Results written to: ${jsonPath} and bench-results.json`);

  // 2. Generate Markdown Table & Report
  const mdPath = path.join(resultsDir, "bench-results.md");
  await MarkdownReporter.saveMarkdown(results, mdPath);
  await MarkdownReporter.saveMarkdown(results, "bench-results.md");
  console.log(`✓ Markdown Table written to: ${mdPath} and bench-results.md`);

  // 3. Generate Latency Histogram SVG Chart
  const globalLatencyStats = computeDistributionStats(allLatencies);
  const latencySvg = ChartGenerator.generateLatencyHistogramSvg({
    title: "WatchParty Benchmark - Control Propagation Latency",
    latencies: allLatencies,
    stats: globalLatencyStats,
    passThresholdMs: 250,
  });
  const latencySvgPath = path.join(resultsDir, "latency_histogram.svg");
  await fs.writeFile(latencySvgPath, latencySvg, "utf-8");
  console.log(`✓ Latency Histogram SVG generated: ${latencySvgPath}`);

  // 4. Generate Drift Over Time SVG Chart
  const driftSvg = ChartGenerator.generateDriftOverTimeSvg({
    title: "WatchParty Benchmark - Post-Correction Drift (5-Minute Timeline)",
    durationSeconds: 300,
    timePoints: fiveMinuteDriftPoints,
    passThresholdMs: 500,
    deadZoneMs: 40,
  });
  const driftSvgPath = path.join(resultsDir, "drift_over_time.svg");
  await fs.writeFile(driftSvgPath, driftSvg, "utf-8");
  console.log(`✓ Drift Over Time SVG generated: ${driftSvgPath}`);

  // 5. Generate Interactive HTML Report
  const htmlPath = path.join(resultsDir, "benchmark_report.html");
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>WatchParty Benchmark Results Dashboard</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #f8fafc; margin: 0; padding: 2rem; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 2rem; color: #38bdf8; margin-bottom: 0.5rem; }
    .badge { display: inline-block; padding: 0.35rem 0.75rem; border-radius: 9999px; font-weight: 700; font-size: 0.85rem; }
    .badge-pass { background: #166534; color: #bbf7d0; }
    .badge-fail { background: #991b1b; color: #fecaca; }
    .card { background: #1e293b; border-radius: 0.75rem; border: 1px solid #334155; padding: 1.5rem; margin-top: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: 0.75rem 1rem; border-bottom: 1px solid #334155; }
    th { background: #0f172a; color: #94a3b8; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
    tr:hover { background: #243248; }
    .chart-container { display: flex; flex-direction: column; gap: 2rem; margin-top: 2rem; }
    .chart-box { background: #0f172a; border-radius: 0.75rem; border: 1px solid #334155; padding: 1.5rem; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="container">
    <h1>WatchParty Benchmark Results Dashboard</h1>
    <p style="color: #94a3b8;">Automated performance and drift SLA validation across distributed WebSocket clients.</p>
    <div>
      <span class="badge ${results.summary.overallPass ? 'badge-pass' : 'badge-fail'}">
        OVERALL: ${results.summary.overallPass ? 'ALL TESTS PASSED' : 'TESTS FAILED'} (${results.summary.passedScenarios}/${results.summary.totalScenarios})
      </span>
      <span style="color: #94a3b8; margin-left: 1rem; font-size: 0.9rem;">Executed on ${results.timestamp}</span>
    </div>

    <div class="card">
      <h2 style="margin-top: 0; font-size: 1.25rem;">Scenario Results Summary</h2>
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Clients</th>
            <th>Latency p50</th>
            <th>Latency p95 (SLA ≤ 250ms)</th>
            <th>Latency Max</th>
            <th>Drift p50</th>
            <th>Drift Max (SLA ≤ 500ms)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${results.scenarios
            .map(
              (s) => `<tr>
            <td style="font-weight: 600;">${s.scenarioName}</td>
            <td>${s.clientCount}</td>
            <td>${s.latencyStats.p50} ms</td>
            <td style="color: ${s.passLatency ? '#4ade80' : '#f87171'}; font-weight: 600;">${s.latencyStats.p95} ms</td>
            <td>${s.latencyStats.max} ms</td>
            <td>${s.driftStats.p50} ms</td>
            <td style="color: ${s.passDrift ? '#4ade80' : '#f87171'}; font-weight: 600;">${s.driftStats.max} ms</td>
            <td><span class="badge ${s.status === 'PASS' ? 'badge-pass' : 'badge-fail'}">${s.status}</span></td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <div class="chart-container">
      <div class="chart-box">
        <h3 style="margin-top: 0;">1. Control Propagation Latency Histogram</h3>
        ${latencySvg}
      </div>
      <div class="chart-box">
        <h3 style="margin-top: 0;">2. Post-Correction Drift Over Time (5-Minute Timeline)</h3>
        ${driftSvg}
      </div>
    </div>
  </div>
</body>
</html>`;
  await fs.writeFile(htmlPath, htmlContent, "utf-8");
  console.log(`✓ Interactive HTML Dashboard written to: ${htmlPath}`);

  // Print Markdown Table to terminal
  console.log("\n" + MarkdownReporter.generateMarkdown(results));
}

main().catch((err) => {
  console.error("Benchmark failed with uncaught exception:", err);
  process.exit(1);
});
