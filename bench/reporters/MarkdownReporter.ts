import fs from "node:fs/promises";
import path from "node:path";
import { BenchmarkSuiteResult } from "./JsonReporter.js";

export class MarkdownReporter {
  public static generateMarkdown(result: BenchmarkSuiteResult): string {
    const lines: string[] = [];

    lines.push("# WatchParty Benchmark Test Results");
    lines.push("");
    lines.push(`- **Test Run Date**: ${result.timestamp}`);
    lines.push(`- **Environment**: ${result.environment.cpuModel} (${result.environment.cpus} vCPUs), ${result.environment.totalMemoryGb} GB RAM, Node ${result.environment.nodeVersion} on ${result.environment.platform} ${result.environment.release}`);
    lines.push(`- **SLA Target 1 (Control Propagation Latency)**: p95 ≤ ${result.targets.controlPropagationLatencyP95Ms} ms`);
    lines.push(`- **SLA Target 2 (Post-Correction Drift)**: Max ≤ ${result.targets.postCorrectionDriftMaxMs} ms`);
    lines.push(`- **Overall Benchmark Status**: **${result.summary.overallPass ? "PASS" : "FAIL"}** (${result.summary.passedScenarios}/${result.summary.totalScenarios} scenarios passing)`);
    lines.push("");

    lines.push("### Scenario Results Table");
    lines.push("");
    lines.push("| Scenario | N Clients | Latency p50 | Latency p95 (SLA ≤250ms) | Latency Max | Drift p50 | Drift Max (SLA ≤500ms) | Status |");
    lines.push("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");

    for (const s of result.scenarios) {
      const latP95Str = `${s.latencyStats.p95} ms ${s.passLatency ? "✓" : "✗"}`;
      const driftMaxStr = `${s.driftStats.max} ms ${s.passDrift ? "✓" : "✗"}`;
      const statusBadge = s.status === "PASS" ? "**PASS**" : "**FAIL**";

      lines.push(
        `| **${s.scenarioName}** | ${s.clientCount} | ${s.latencyStats.p50} ms | ${latP95Str} | ${s.latencyStats.max} ms | ${s.driftStats.p50} ms | ${driftMaxStr} | ${statusBadge} |`
      );
    }

    lines.push("");
    lines.push("### Scenario Descriptions & Notes");
    lines.push("");
    for (const s of result.scenarios) {
      lines.push(`- **${s.scenarioName}**: ${s.description}. ${s.notes || ""}`);
    }

    lines.push("");
    lines.push("### Generated Artifacts");
    lines.push("");
    lines.push("- **JSON Results**: [`bench-results.json`](file:///bench-results.json)");
    lines.push("- **Latency Histogram Chart**: [`bench/results/latency_histogram.svg`](file:///bench/results/latency_histogram.svg)");
    lines.push("- **Drift Over Time Chart**: [`bench/results/drift_over_time.svg`](file:///bench/results/drift_over_time.svg)");
    lines.push("");

    return lines.join("\n");
  }

  public static async saveMarkdown(
    result: BenchmarkSuiteResult,
    outputPath = "bench-results.md"
  ): Promise<string> {
    const fullPath = path.resolve(outputPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    const content = this.generateMarkdown(result);
    await fs.writeFile(fullPath, content, "utf-8");
    return fullPath;
  }
}
