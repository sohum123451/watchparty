import { ClockSyncSample, TimeProvider } from "./types.js";

const DEFAULT_TIME_PROVIDER: TimeProvider = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export class ClockSync {
  private readonly sendPing: (clientSendTimeMs: number) => void;
  private readonly timeProvider: TimeProvider;
  private readonly pingIntervalMs: number;
  private readonly maxSamples: number;

  private samples: ClockSyncSample[];
  private estimatedOffsetMs: number;
  private latestRttMs: number;
  private pingIntervalHandle: any;
  private burstTimeoutHandles: any[];
  private isInitialized: boolean;

  constructor(
    sendPing: (clientSendTimeMs: number) => void = () => {},
    options: {
      timeProvider?: TimeProvider;
      pingIntervalMs?: number;
      maxSamples?: number;
    } = {}
  ) {
    this.sendPing = sendPing;
    this.timeProvider = options.timeProvider || DEFAULT_TIME_PROVIDER;
    this.pingIntervalMs = options.pingIntervalMs ?? 5000;
    this.maxSamples = options.maxSamples ?? 15;

    this.samples = [];
    this.estimatedOffsetMs = 0;
    this.latestRttMs = 0;
    this.pingIntervalHandle = null;
    this.burstTimeoutHandles = [];
    this.isInitialized = false;
  }

  public start(): void {
    this.stop();

    // 1. Send first ping immediately
    this.triggerPing();

    // 2. Rapid burst (3 more pings at 100ms, 200ms, 300ms) for instant clock convergence
    const burstDelays = [100, 200, 300];
    this.burstTimeoutHandles = burstDelays.map((delay) =>
      this.timeProvider.setTimeout(() => {
        this.triggerPing();
      }, delay)
    );

    // 3. Periodic long-term maintenance sync every ~5 seconds
    this.pingIntervalHandle = this.timeProvider.setInterval(() => {
      this.triggerPing();
    }, this.pingIntervalMs);
  }

  public stop(): void {
    if (this.pingIntervalHandle) {
      this.timeProvider.clearInterval(this.pingIntervalHandle);
      this.pingIntervalHandle = null;
    }
    for (const handle of this.burstTimeoutHandles) {
      this.timeProvider.clearTimeout(handle);
    }
    this.burstTimeoutHandles = [];
  }

  public triggerPing(): void {
    const t0 = this.timeProvider.now();
    try {
      this.sendPing(t0);
    } catch {
      // Ignore transient network errors during ping dispatch
    }
  }

  /**
   * Processes a SYNC_PONG message from the authoritative server.
   * t0: Client send timestamp
   * t1: Server receive timestamp
   * t2: Server response send timestamp
   * t3: Client receive timestamp (defaults to current time)
   */
  public handlePong(t0: number, t1: number, t2: number, t3?: number): void {
    const clientReceiveTimeMs = t3 !== undefined ? t3 : this.timeProvider.now();

    // Standard NTP calculations:
    // Round-Trip Time excluding server processing time
    const rttMs = Math.max(0, (clientReceiveTimeMs - t0) - (t2 - t1));
    // Clock Offset
    const offsetMs = ((t1 - t0) + (t2 - clientReceiveTimeMs)) / 2;

    this.latestRttMs = rttMs;
    this.samples.push({
      offsetMs,
      rttMs,
      timestamp: clientReceiveTimeMs,
    });

    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    this.recalculateOffset();
    this.isInitialized = true;
  }

  private recalculateOffset(): void {
    if (this.samples.length === 0) return;
    if (this.samples.length === 1) {
      this.estimatedOffsetMs = this.samples[0].offsetMs;
      return;
    }

    // Sort samples by lowest RTT (cleanest network transit path)
    const sortedByRtt = [...this.samples].sort((a, b) => a.rttMs - b.rttMs);

    // Filter to the best 60% lowest-latency samples
    const countToKeep = Math.max(1, Math.ceil(sortedByRtt.length * 0.6));
    const bestSamples = sortedByRtt.slice(0, countToKeep);

    // Compute the median offset among the best samples to eliminate asymmetric routing jitter
    const offsets = bestSamples.map((s) => s.offsetMs).sort((a, b) => a - b);
    const mid = Math.floor(offsets.length / 2);

    let medianOffset: number;
    if (offsets.length % 2 !== 0) {
      medianOffset = offsets[mid];
    } else {
      medianOffset = (offsets[mid - 1] + offsets[mid]) / 2;
    }

    this.estimatedOffsetMs = Math.round(medianOffset);
  }

  /**
   * Returns estimated authoritative server time in milliseconds.
   */
  public serverNow(): number {
    return this.timeProvider.now() + this.estimatedOffsetMs;
  }

  public getClockOffset(): number {
    return this.estimatedOffsetMs;
  }

  public getLatestRtt(): number {
    return this.latestRttMs;
  }

  public getStats(): { offsetMs: number; lowestRttMs: number; isReady: boolean } {
    const lowestRtt =
      this.samples.length > 0 ? Math.min(...this.samples.map((s) => s.rttMs)) : this.latestRttMs;
    return {
      offsetMs: this.estimatedOffsetMs,
      lowestRttMs: lowestRtt,
      isReady: this.isInitialized,
    };
  }

  public isReady(): boolean {
    return this.isInitialized;
  }

  public reset(): void {
    this.stop();
    this.samples = [];
    this.estimatedOffsetMs = 0;
    this.latestRttMs = 0;
    this.isInitialized = false;
  }
}
