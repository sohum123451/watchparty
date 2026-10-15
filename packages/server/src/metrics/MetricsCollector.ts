export interface LatencyHistogram {
  buckets: number[]; // In seconds
  bucketCounts: number[];
  sum: number;
  count: number;
}

export interface DriftHistogram {
  buckets: number[]; // In milliseconds
  bucketCounts: number[];
  sum: number;
  count: number;
  max: number;
}

export class MetricsCollector {
  private connectedSockets = 0;
  private activeRooms = 0;
  private startTime = Date.now();

  // Command latency in seconds
  private latencyBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5];
  private latencyCounts: number[] = new Array(9).fill(0);
  private latencySum = 0;
  private latencyCount = 0;
  private recentLatenciesMs: number[] = [];

  // Drift in milliseconds
  private driftBuckets = [5, 15, 30, 50, 100, 250, 500, 1000];
  private driftCounts: number[] = new Array(8).fill(0);
  private driftSum = 0;
  private driftCount = 0;
  private driftMax = 0;
  private recentDriftsMs: number[] = [];

  // Counters
  private reconnectSuccess = 0;
  private reconnectFailure = 0;
  private errorsByCode: Map<string, number> = new Map();
  private messagesInbound = 0;
  private messagesOutbound = 0;
  private commandsByName: Map<string, number> = new Map();

  // Rate tracking windows (last 60s)
  private errorTimestamps: number[] = [];
  private reconnectTimestamps: number[] = [];

  public setConnectedSockets(count: number): void {
    this.connectedSockets = Math.max(0, count);
  }

  public incrementConnectedSockets(): void {
    this.connectedSockets++;
  }

  public decrementConnectedSockets(): void {
    if (this.connectedSockets > 0) this.connectedSockets--;
  }

  public setActiveRooms(count: number): void {
    this.activeRooms = Math.max(0, count);
  }

  public recordCommandLatency(latencyOrName: number | string, durationOrName?: number | string): void {
    let latencyMs: number;
    let commandName: string | undefined;

    if (typeof latencyOrName === "number") {
      latencyMs = latencyOrName;
      commandName = typeof durationOrName === "string" ? durationOrName : undefined;
    } else {
      commandName = latencyOrName;
      const val = typeof durationOrName === "number" ? durationOrName : 0;
      latencyMs = val < 10 ? val * 1000 : val;
    }

    const latencySec = latencyMs / 1000;
    this.latencyCount++;
    this.latencySum += latencySec;

    for (let i = 0; i < this.latencyBuckets.length; i++) {
      if (latencySec <= this.latencyBuckets[i]) {
        this.latencyCounts[i]++;
      }
    }

    this.recentLatenciesMs.push(latencyMs);
    if (this.recentLatenciesMs.length > 500) {
      this.recentLatenciesMs.shift();
    }

    if (commandName) {
      const current = this.commandsByName.get(commandName) || 0;
      this.commandsByName.set(commandName, current + 1);
    }
  }

  public recordDrift(driftMs: number): void {
    const absDrift = Math.abs(driftMs);
    this.driftCount++;
    this.driftSum += absDrift;
    if (absDrift > this.driftMax) {
      this.driftMax = absDrift;
    }

    for (let i = 0; i < this.driftBuckets.length; i++) {
      if (absDrift <= this.driftBuckets[i]) {
        this.driftCounts[i]++;
      }
    }

    this.recentDriftsMs.push(absDrift);
    if (this.recentDriftsMs.length > 500) {
      this.recentDriftsMs.shift();
    }
  }

  public recordReconnect(success: boolean): void {
    const now = Date.now();
    this.reconnectTimestamps.push(now);
    if (success) {
      this.reconnectSuccess++;
    } else {
      this.reconnectFailure++;
    }
  }

  public recordError(code = "UNKNOWN"): void {
    const now = Date.now();
    this.errorTimestamps.push(now);
    const count = this.errorsByCode.get(code) || 0;
    this.errorsByCode.set(code, count + 1);
  }

  public recordMessage(direction: "inbound" | "outbound"): void {
    if (direction === "inbound") this.messagesInbound++;
    else this.messagesOutbound++;
  }

  public recordInboundMessage(): void {
    this.messagesInbound++;
  }

  public recordOutboundMessage(): void {
    this.messagesOutbound++;
  }

  private cleanOldTimestamps(now: number): void {
    const windowStart = now - 60000;
    while (this.errorTimestamps.length > 0 && this.errorTimestamps[0] < windowStart) {
      this.errorTimestamps.shift();
    }
    while (this.reconnectTimestamps.length > 0 && this.reconnectTimestamps[0] < windowStart) {
      this.reconnectTimestamps.shift();
    }
  }

  private computePercentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return Number(sorted[idx].toFixed(2));
  }

  /**
   * Returns standard Prometheus OpenMetrics text format.
   */
  public toPrometheusText(): string {
    const uptimeSec = Math.floor((Date.now() - this.startTime) / 1000);
    const lines: string[] = [
      "# HELP watchparty_uptime_seconds Total server uptime in seconds",
      "# TYPE watchparty_uptime_seconds gauge",
      `watchparty_uptime_seconds ${uptimeSec}`,
      "",
      "# HELP watchparty_connected_sockets Current active WebSocket connections",
      "# TYPE watchparty_connected_sockets gauge",
      `watchparty_connected_sockets ${this.connectedSockets}`,
      "",
      "# HELP watchparty_active_rooms Current number of active rooms",
      "# TYPE watchparty_active_rooms gauge",
      `watchparty_active_rooms ${this.activeRooms}`,
      "",
      "# HELP watchparty_command_latency_seconds Command processing latency histogram",
      "# TYPE watchparty_command_latency_seconds histogram",
    ];

    for (let i = 0; i < this.latencyBuckets.length; i++) {
      lines.push(
        `watchparty_command_latency_seconds_bucket{le="${this.latencyBuckets[i]}"} ${this.latencyCounts[i]}`
      );
    }
    lines.push(`watchparty_command_latency_seconds_bucket{le="+Inf"} ${this.latencyCount}`);
    lines.push(`watchparty_command_latency_seconds_sum ${this.latencySum.toFixed(4)}`);
    lines.push(`watchparty_command_latency_seconds_count ${this.latencyCount}`);
    lines.push("");

    lines.push("# HELP watchparty_drift_milliseconds Playback drift from server clock in milliseconds");
    lines.push("# TYPE watchparty_drift_milliseconds histogram");
    for (let i = 0; i < this.driftBuckets.length; i++) {
      lines.push(
        `watchparty_drift_milliseconds_bucket{le="${this.driftBuckets[i]}"} ${this.driftCounts[i]}`
      );
    }
    lines.push(`watchparty_drift_milliseconds_bucket{le="+Inf"} ${this.driftCount}`);
    lines.push(`watchparty_drift_milliseconds_sum ${this.driftSum.toFixed(2)}`);
    lines.push(`watchparty_drift_milliseconds_count ${this.driftCount}`);
    lines.push("");

    lines.push("# HELP watchparty_reconnect_total Reconnect attempts by status");
    lines.push("# TYPE watchparty_reconnect_total counter");
    lines.push(`watchparty_reconnect_total{status="success"} ${this.reconnectSuccess}`);
    lines.push(`watchparty_reconnect_total{status="failure"} ${this.reconnectFailure}`);
    lines.push("");

    lines.push("# HELP watchparty_errors_total Total errors encountered by code");
    lines.push("# TYPE watchparty_errors_total counter");
    if (this.errorsByCode.size === 0) {
      lines.push(`watchparty_errors_total{code="NONE"} 0`);
    } else {
      for (const [code, count] of this.errorsByCode.entries()) {
        lines.push(`watchparty_errors_total{code="${code}"} ${count}`);
      }
    }
    lines.push("");

    lines.push("# HELP watchparty_messages_total Total WebSocket messages exchanged");
    lines.push("# TYPE watchparty_messages_total counter");
    lines.push(`watchparty_messages_total{direction="inbound"} ${this.messagesInbound}`);
    lines.push(`watchparty_messages_total{direction="outbound"} ${this.messagesOutbound}`);
    lines.push("");

    return lines.join("\n") + "\n";
  }

  public toPrometheusFormat(): string {
    return this.toPrometheusText();
  }

  public getSummaryJson() {
    return this.getMetricsSummary();
  }

  /**
   * Returns a structured summary JSON object for the web dashboard and REST APIs.
   */
  public getMetricsSummary() {
    const now = Date.now();
    this.cleanOldTimestamps(now);

    const totalErrors = Array.from(this.errorsByCode.values()).reduce((a, b) => a + b, 0);

    return {
      uptimeSeconds: Math.floor((now - this.startTime) / 1000),
      connectedSockets: this.connectedSockets,
      activeRooms: this.activeRooms,
      commandLatency: {
        count: this.latencyCount,
        sumSeconds: Number(this.latencySum.toFixed(4)),
        avgMs: this.latencyCount > 0 ? Number(((this.latencySum * 1000) / this.latencyCount).toFixed(2)) : 0,
        p50: this.computePercentile(this.recentLatenciesMs, 50),
        p90: this.computePercentile(this.recentLatenciesMs, 90),
        p95: this.computePercentile(this.recentLatenciesMs, 95),
        p99: this.computePercentile(this.recentLatenciesMs, 99),
      },
      drift: {
        count: this.driftCount,
        avgMs: this.driftCount > 0 ? Number((this.driftSum / this.driftCount).toFixed(2)) : 0,
        maxMs: Number(this.driftMax.toFixed(2)),
        p95: this.computePercentile(this.recentDriftsMs, 95),
      },
      reconnects: {
        totalSuccess: this.reconnectSuccess,
        totalFailure: this.reconnectFailure,
        ratePerMinute: this.reconnectTimestamps.length,
      },
      errors: {
        total: totalErrors,
        ratePerMinute: this.errorTimestamps.length,
        byCode: Object.fromEntries(this.errorsByCode.entries()),
      },
      messages: {
        inbound: this.messagesInbound,
        outbound: this.messagesOutbound,
      },
    };
  }
}

export const metricsCollector = new MetricsCollector();
