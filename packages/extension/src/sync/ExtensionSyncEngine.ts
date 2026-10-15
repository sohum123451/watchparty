import { PlayerAdapter, PlayerState } from "../adapter/StreamingPageAdapter.js";

export interface RoomPlaybackState {
  roomId: string;
  state: PlayerState;
  positionMs: number;
  playbackRate: number;
  updatedAtServerMs: number;
  isHost: boolean;
}

export interface DriftMetrics {
  driftMs: number;
  mode: "in-sync" | "nudging" | "seeking" | "paused" | "buffering";
  localTimeMs: number;
  targetTimeMs: number;
  playbackRate: number;
  clockOffsetMs: number;
}

export interface ExtensionSyncConfig {
  deadbandMs?: number;        // Default: 50ms
  hardSeekThresholdMs?: number; // Default: 500ms
  nudgeSlowdownRatio?: number; // Default: 0.95
  nudgeSpeedupRatio?: number;  // Default: 1.05
  tickIntervalMs?: number;    // Default: 250ms
}

export class ExtensionSyncEngine {
  private adapter: PlayerAdapter;
  private roomState: RoomPlaybackState | null = null;
  private clockOffsetMs: number = 0;
  private isHost: boolean = false;
  private isRunning: boolean = false;
  private intervalId: any = null;

  private deadbandMs: number;
  private hardSeekThresholdMs: number;
  private nudgeSlowdownRatio: number;
  private nudgeSpeedupRatio: number;
  private tickIntervalMs: number;

  private onMetricsCallback?: (metrics: DriftMetrics) => void;

  constructor(adapter: PlayerAdapter, config: ExtensionSyncConfig = {}) {
    this.adapter = adapter;
    this.deadbandMs = config.deadbandMs ?? 50;
    this.hardSeekThresholdMs = config.hardSeekThresholdMs ?? 500;
    this.nudgeSlowdownRatio = config.nudgeSlowdownRatio ?? 0.95;
    this.nudgeSpeedupRatio = config.nudgeSpeedupRatio ?? 1.05;
    this.tickIntervalMs = config.tickIntervalMs ?? 250;
  }

  public setClockOffset(offsetMs: number): void {
    this.clockOffsetMs = offsetMs;
  }

  public getClockOffset(): number {
    return this.clockOffsetMs;
  }

  public setHost(isHost: boolean): void {
    this.isHost = isHost;
  }

  public updateRoomState(state: RoomPlaybackState): DriftMetrics | null {
    this.roomState = state;
    if (this.isHost) {
      // As host, user controls playback; we don't force local player to follow remote
      return null;
    }
    return this.evaluateSync();
  }

  public onMetrics(callback: (metrics: DriftMetrics) => void): void {
    this.onMetricsCallback = callback;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.tick();
    }, this.tickIntervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public tick(): void {
    if (!this.isRunning || !this.roomState) return;
    this.evaluateSync();
  }

  public calculateTargetTimeMs(nowMs: number = Date.now()): number {
    if (!this.roomState) return 0;
    if (this.roomState.state !== "playing") {
      return this.roomState.positionMs;
    }
    const currentServerTime = nowMs + this.clockOffsetMs;
    const elapsedServerTime = Math.max(0, currentServerTime - this.roomState.updatedAtServerMs);
    return Math.round(this.roomState.positionMs + elapsedServerTime * (this.roomState.playbackRate || 1.0));
  }

  public evaluateSync(): DriftMetrics {
    const now = Date.now();
    const localTimeMs = this.adapter.getCurrentTime();
    const targetTimeMs = this.calculateTargetTimeMs(now);
    const driftMs = localTimeMs - targetTimeMs; // positive = ahead, negative = behind
    const absDrift = Math.abs(driftMs);
    const localState = this.adapter.getState();
    const roomState = this.roomState?.state || "unstarted";
    const baseRate = this.roomState?.playbackRate || 1.0;

    let mode: DriftMetrics["mode"] = "in-sync";

    if (this.isHost) {
      // Host generates state, does not get adjusted
      const metrics: DriftMetrics = {
        driftMs: 0,
        mode: "in-sync",
        localTimeMs,
        targetTimeMs: localTimeMs,
        playbackRate: baseRate,
        clockOffsetMs: this.clockOffsetMs
      };
      if (this.onMetricsCallback) this.onMetricsCallback(metrics);
      return metrics;
    }

    if (roomState === "paused") {
      mode = "paused";
      if (localState !== "paused") {
        this.adapter.pause();
      }
      if (absDrift > this.deadbandMs) {
        this.adapter.seek(targetTimeMs);
      }
      this.adapter.setPlaybackRate(baseRate);
    } else if (roomState === "playing") {
      if (localState === "paused") {
        this.adapter.play();
      }

      if (absDrift <= this.deadbandMs) {
        mode = "in-sync";
        this.adapter.setPlaybackRate(baseRate);
      } else if (absDrift <= this.hardSeekThresholdMs) {
        mode = "nudging";
        // If ahead (drift > 0), slow down. If behind (drift < 0), speed up.
        const nudgedRate = driftMs > 0
          ? baseRate * this.nudgeSlowdownRatio
          : baseRate * this.nudgeSpeedupRatio;
        this.adapter.setPlaybackRate(nudgedRate);
      } else {
        // Severe drift: perform hard seek
        mode = "seeking";
        this.adapter.seek(targetTimeMs);
        this.adapter.setPlaybackRate(baseRate);
      }
    }

    const metrics: DriftMetrics = {
      driftMs,
      mode,
      localTimeMs,
      targetTimeMs,
      playbackRate: (this.adapter as any).getPlaybackRate ? (this.adapter as any).getPlaybackRate() : baseRate,
      clockOffsetMs: this.clockOffsetMs
    };

    if (this.onMetricsCallback) {
      this.onMetricsCallback(metrics);
    }

    return metrics;
  }
}
