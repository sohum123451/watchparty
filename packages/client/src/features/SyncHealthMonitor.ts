import {
  RoomSyncHealthSummary,
  MemberSyncMetrics,
} from "@watchparty/shared";
import { ClockSync } from "../sync/ClockSync.js";
import { PlaybackSyncEngine } from "../sync/PlaybackSyncEngine.js";

export interface SyncHealthListener {
  (summary: RoomSyncHealthSummary): void;
}

export interface MetricsReporter {
  (metrics: {
    rttMs: number;
    clockOffsetMs: number;
    driftMs: number;
    playbackRate: number;
    isBuffering: boolean;
  }): void;
}

export class SyncHealthMonitor {
  private clockSync: ClockSync;
  private syncEngine: PlaybackSyncEngine;
  private reporter?: MetricsReporter;
  private currentSummary: RoomSyncHealthSummary;
  private reportInterval: any = null;
  private listeners: Set<SyncHealthListener> = new Set();

  constructor(options: {
    clockSync: ClockSync;
    syncEngine: PlaybackSyncEngine;
    reporter?: MetricsReporter;
    initialSummary?: RoomSyncHealthSummary;
  }) {
    this.clockSync = options.clockSync;
    this.syncEngine = options.syncEngine;
    this.reporter = options.reporter;

    this.currentSummary = options.initialSummary || {
      p50DriftMs: 0,
      p95DriftMs: 0,
      maxDriftMs: 0,
      averageRttMs: 0,
      bufferingCount: 0,
      totalMembers: 1,
      syncCoherenceScore: 100,
      memberMetrics: [],
    };
  }

  public startReporting(intervalMs = 2000): void {
    this.stopReporting();
    this.reportCurrentMetrics();
    this.reportInterval = setInterval(() => {
      this.reportCurrentMetrics();
    }, intervalMs);
  }

  public stopReporting(): void {
    if (this.reportInterval !== null) {
      clearInterval(this.reportInterval);
      this.reportInterval = null;
    }
  }

  public reportCurrentMetrics(): void {
    if (!this.reporter) return;

    let rtt = 20;
    let offset = 0;
    if (typeof this.clockSync.getStats === "function") {
      const stats = this.clockSync.getStats();
      rtt = stats.lowestRttMs || 20;
      offset = stats.offsetMs || 0;
    } else {
      if (typeof this.clockSync.getLatestRtt === "function") {
        rtt = this.clockSync.getLatestRtt() || 20;
      }
      if (typeof this.clockSync.getClockOffset === "function") {
        offset = this.clockSync.getClockOffset() || 0;
      }
    }

    let driftMs = 0;
    let playbackRate = 1.0;
    let isBuffering = false;

    if (typeof this.syncEngine?.getMetrics === "function") {
      const metrics: any = this.syncEngine.getMetrics();
      driftMs = metrics.currentDriftMs ?? metrics.driftMs ?? 0;
      playbackRate = metrics.playbackRate ?? metrics.currentRate ?? 1.0;
      isBuffering = metrics.syncStatus === "buffering" || Boolean(metrics.isBuffering);
    }

    this.reporter({
      rttMs: rtt,
      clockOffsetMs: offset,
      driftMs,
      playbackRate,
      isBuffering,
    });
  }

  public handleServerBroadcast(summary: RoomSyncHealthSummary): void {
    this.currentSummary = { ...summary };
    this.notify();
  }

  public getSummary(): RoomSyncHealthSummary {
    return { ...this.currentSummary };
  }

  /**
   * Computes an academic/enterprise reliability grade based on hard measurable constraints:
   * Playback drift <= 500 ms constraint.
   */
  public getReliabilityGrade(): {
    grade: "A+" | "A" | "B" | "C" | "Degraded";
    badgeColor: string;
    details: string;
  } {
    const { p95DriftMs, maxDriftMs, bufferingCount } = this.currentSummary;

    if (p95DriftMs < 50 && maxDriftMs < 100 && bufferingCount === 0) {
      return {
        grade: "A+",
        badgeColor: "#10b981", // Emerald
        details: "Imperceptible drift (< 50ms) across all peers",
      };
    }
    if (p95DriftMs < 150 && bufferingCount === 0) {
      return {
        grade: "A",
        badgeColor: "#3b82f6", // Blue
        details: "Excellent synchronization (< 150ms)",
      };
    }
    if (p95DriftMs < 300) {
      return {
        grade: "B",
        badgeColor: "#f59e0b", // Amber
        details: "Good sync (< 300ms) with minor network variance",
      };
    }
    if (p95DriftMs <= 500) {
      return {
        grade: "C",
        badgeColor: "#f97316", // Orange
        details: "Acceptable sync (satisfies <= 500ms hard requirement)",
      };
    }
    return {
      grade: "Degraded",
      badgeColor: "#ef4444", // Red
      details: "High drift detected; rate nudging actively compensating",
    };
  }

  public subscribe(listener: SyncHealthListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.currentSummary });
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const summary = { ...this.currentSummary };
    for (const listener of this.listeners) {
      listener(summary);
    }
  }

  public destroy(): void {
    this.stopReporting();
    this.listeners.clear();
  }
}
