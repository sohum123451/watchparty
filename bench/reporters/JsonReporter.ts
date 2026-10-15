import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { DistributionStats } from "./Stats.js";

export interface ScenarioBenchmarkResult {
  scenarioName: string;
  description: string;
  clientCount: number;
  durationSeconds: number;
  latencyStats: DistributionStats;
  driftStats: DistributionStats;
  passLatency: boolean; // p95 <= 250 ms
  passDrift: boolean;   // max <= 500 ms
  status: "PASS" | "FAIL";
  notes?: string;
}

export interface BenchmarkSuiteResult {
  timestamp: string;
  environment: {
    platform: string;
    release: string;
    arch: string;
    cpus: number;
    cpuModel: string;
    totalMemoryGb: string;
    nodeVersion: string;
  };
  targets: {
    controlPropagationLatencyP95Ms: number; // 250
    postCorrectionDriftMaxMs: number;       // 500
  };
  summary: {
    totalScenarios: number;
    passedScenarios: number;
    failedScenarios: number;
    overallPass: boolean;
  };
  scenarios: ScenarioBenchmarkResult[];
}

export class JsonReporter {
  public static async saveResults(
    results: BenchmarkSuiteResult,
    outputPath = "bench-results.json"
  ): Promise<string> {
    const fullPath = path.resolve(outputPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, JSON.stringify(results, null, 2), "utf-8");
    return fullPath;
  }

  public static getEnvironmentMetadata() {
    return {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || "Unknown",
      totalMemoryGb: (os.totalmem() / 1024 ** 3).toFixed(2),
      nodeVersion: process.version,
    };
  }
}
