import { PlaybackState } from "@watchparty/shared";
import {
  SyncVideoElement,
  SyncMetrics,
  SyncStatus,
  UserPlaybackAction,
  TimeProvider,
  SyncEngineConfig,
} from "./types.js";
import { ClockSync } from "./ClockSync.js";
import { PlayerAdapter, PlayerState } from "../adapters/PlayerAdapter.js";
import { HTML5Adapter } from "../adapters/HTML5Adapter.js";

const DEFAULT_TIME_PROVIDER: TimeProvider = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export class PlaybackSyncEngine {
  private adapter: PlayerAdapter;
  private readonly clockSync: ClockSync;
  private readonly timeProvider: TimeProvider;

  // Callbacks
  private readonly onUserAction?: (action: UserPlaybackAction) => void;
  private readonly onBufferReport?: (report: { isBuffering: boolean; bufferedUpToMs?: number }) => void;
  private readonly onAutoplayBlocked?: (blocked: boolean) => void;
  private readonly onMetricsUpdate?: (metrics: SyncMetrics) => void;

  // Thresholds & tuning
  private readonly driftIntervalMs: number;
  private readonly deadZoneMs: number;
  private readonly hysteresisZoneMs: number;
  private readonly hardSeekThresholdMs: number;
  private readonly maxRateAdjustment: number;

  // Current authoritative state from server
  private currentPlaybackState: PlaybackState | null = null;

  // Internal state flags
  private currentPlaybackRate = 1.0;
  private isBuffering = false;
  private isHardSeeking = false;
  private isNudging = false;
  private isAutoplayBlocked = false;
  private lastTickTimeMs = 0;
  private driftLoopHandle: any = null;

  // Echo suppression tokens
  private programmaticPlayTokens = 0;
  private programmaticPauseTokens = 0;
  private programmaticSeekTokens = 0;

  // Metrics telemetry
  private hardSeekCount = 0;
  private softCorrectionCount = 0;
  private totalPlayingDurationMs = 0;
  private timeInDeadbandMs = 0;
  private currentDriftMs = 0;
  private currentSyncStatus: SyncStatus = "stopped";

  // Metrics subscribers
  private metricsListeners: Set<(metrics: SyncMetrics) => void> = new Set();

  // Adapter event unsubscribers
  private adapterUnsubscribers: Array<() => void> = [];
  private boundOnVisibilityChange?: () => void;

  constructor(config: SyncEngineConfig) {
    if (config.adapter) {
      this.adapter = config.adapter;
    } else if (config.video) {
      this.adapter = new HTML5Adapter(config.video);
    } else {
      this.adapter = new HTML5Adapter();
    }

    this.timeProvider = config.timeProvider || DEFAULT_TIME_PROVIDER;
    this.onUserAction = config.onUserAction;
    this.onBufferReport = config.onBufferReport;
    this.onAutoplayBlocked = config.onAutoplayBlocked;
    this.onMetricsUpdate = config.onMetricsUpdate;

    const recommended =
      this.adapter && "getRecommendedSyncConfig" in this.adapter && typeof (this.adapter as any).getRecommendedSyncConfig === "function"
        ? (this.adapter as any).getRecommendedSyncConfig()
        : {};

    this.driftIntervalMs = config.driftIntervalMs ?? recommended.driftIntervalMs ?? 250;
    this.deadZoneMs = config.deadZoneMs ?? recommended.deadZoneMs ?? 40;
    this.hysteresisZoneMs = config.hysteresisZoneMs ?? recommended.hysteresisZoneMs ?? 20;
    this.hardSeekThresholdMs = config.hardSeekThresholdMs ?? recommended.hardSeekThresholdMs ?? 1000;
    this.maxRateAdjustment = config.maxRateAdjustment ?? recommended.maxRateAdjustment ?? 0.08;

    this.clockSync = new ClockSync(config.sendPing, {
      timeProvider: this.timeProvider,
      pingIntervalMs: config.pingIntervalMs ?? 5000,
    });

    this.attachAdapterListeners();
    this.attachDocumentVisibilityListener();
  }

  public getAdapter(): PlayerAdapter {
    return this.adapter;
  }

  public setAdapter(adapter: PlayerAdapter): void {
    this.detachAdapterListeners();
    this.adapter = adapter;
    this.attachAdapterListeners();
    this.evaluateDrift();
  }

  public get video(): SyncVideoElement | HTMLVideoElement {
    if ("getVideoElement" in this.adapter && typeof (this.adapter as any).getVideoElement === "function") {
      return (this.adapter as any).getVideoElement();
    }
    return {
      currentTime: this.adapter.getCurrentTime() / 1000,
      playbackRate: this.currentPlaybackRate,
      paused: this.adapter.getState() === "paused",
      seeking: this.isHardSeeking,
      play: () => this.adapter.play(),
      pause: () => this.adapter.pause(),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }

  public start(): void {
    this.clockSync.start();
    this.startDriftLoop();
  }

  public stop(): void {
    this.stopDriftLoop();
    this.clockSync.stop();
  }

  public destroy(): void {
    this.stop();
    this.detachAdapterListeners();
    this.detachDocumentVisibilityListener();
    this.metricsListeners.clear();
  }

  // ==========================================
  // CLOCK SYNC DELEGATION
  // ==========================================

  public handleSyncPong(t0: number, t1: number, t2: number, t3?: number): void {
    this.clockSync.handlePong(t0, t1, t2, t3);
  }

  public serverNow(): number {
    return this.clockSync.serverNow();
  }

  public getClockOffset(): number {
    return this.clockSync.getClockOffset();
  }

  public getLatestRtt(): number {
    return this.clockSync.getLatestRtt();
  }

  // ==========================================
  // AUTHORITATIVE STATE INGESTION
  // ==========================================

  public setPlaybackState(state: PlaybackState): void {
    const prevState = this.currentPlaybackState;
    this.currentPlaybackState = state;

    if (state.status === "paused") {
      this.currentSyncStatus = "paused";
      this.isNudging = false;
      this.applyProgrammaticRate(1.0);

      // Pause adapter if playing
      if (this.adapter.getState() !== "paused") {
        this.programmaticPause();
      }

      // If position differs noticeably from paused target, align immediately
      const currentPosMs = this.adapter.getCurrentTime();
      const diffMs = Math.abs(currentPosMs - state.positionMs);
      if (diffMs > this.deadZoneMs && !this.adapter.capabilities.isLive) {
        this.programmaticSeek(state.positionMs);
      }
    } else if (state.status === "playing") {
      // Calculate target position
      const targetPosMs = this.getTargetPositionMs();
      const currentPosMs = this.adapter.getCurrentTime();
      const diffMs = Math.abs(currentPosMs - targetPosMs);

      // If video was paused or gap exceeds hard seek threshold, perform hard seek
      if (
        !this.adapter.capabilities.isLive &&
        !this.adapter.capabilities.isHostDrivenSoftSync &&
        (diffMs > this.hardSeekThresholdMs || (prevState && prevState.status === "paused" && diffMs > this.deadZoneMs))
      ) {
        this.hardSeekCount++;
        this.programmaticSeek(targetPosMs);
      }

      if (this.adapter.getState() !== "playing") {
        this.programmaticPlay();
      }
    }

    this.evaluateDrift();
  }

  public getTargetPositionMs(): number {
    if (!this.currentPlaybackState) {
      return this.adapter.getCurrentTime();
    }

    if (this.currentPlaybackState.status === "playing") {
      const elapsedMs = Math.max(0, this.serverNow() - this.currentPlaybackState.serverTimeMs);
      const rate = this.currentPlaybackState.playbackRate || 1.0;
      return this.currentPlaybackState.positionMs + elapsedMs * rate;
    }

    return this.currentPlaybackState.positionMs;
  }

  // ==========================================
  // DRIFT EVALUATION & HYSTERESIS LOOP
  // ==========================================

  private startDriftLoop(): void {
    this.stopDriftLoop();
    this.lastTickTimeMs = this.timeProvider.now();

    this.driftLoopHandle = this.timeProvider.setInterval(() => {
      this.driftTick();
    }, this.driftIntervalMs);
  }

  private stopDriftLoop(): void {
    if (this.driftLoopHandle) {
      this.timeProvider.clearInterval(this.driftLoopHandle);
      this.driftLoopHandle = null;
    }
  }

  private driftTick(): void {
    const now = this.timeProvider.now();
    const elapsedSinceLastTick = now - this.lastTickTimeMs;
    this.lastTickTimeMs = now;

    // Detect browser background timer throttling (gap > 1000ms instead of 250ms)
    const isBackgroundThrottled = elapsedSinceLastTick > 1000;

    // Evaluate drift first so currentDriftMs is refreshed
    this.evaluateDrift(isBackgroundThrottled);

    // Track total playing time & deadband statistics when playing
    if (this.currentPlaybackState && this.currentPlaybackState.status === "playing" && this.adapter.getState() === "playing") {
      const tickDelta = isBackgroundThrottled ? elapsedSinceLastTick : this.driftIntervalMs;
      this.totalPlayingDurationMs += tickDelta;
      if (Math.abs(this.currentDriftMs) <= this.deadZoneMs) {
        this.timeInDeadbandMs += tickDelta;
      }
    }
  }

  public evaluateDrift(forceImmediate = false): void {
    if (!this.currentPlaybackState || this.currentPlaybackState.status !== "playing") {
      this.currentSyncStatus = "paused";
      this.emitMetrics();
      return;
    }

    // If currently buffering or hard-seeking, pause corrections until settled
    if (this.isBuffering) {
      this.currentSyncStatus = "buffering";
      this.emitMetrics();
      return;
    }

    if (this.isHardSeeking) {
      this.currentSyncStatus = "seeking";
      this.emitMetrics();
      return;
    }

    // Live streams (e.g., ScreenShare) cannot seek or adjust playback rate
    if (this.adapter.capabilities.isLive) {
      this.currentSyncStatus = "in_sync";
      this.currentDriftMs = 0;
      this.emitMetrics();
      return;
    }

    // Embeds in host-driven soft sync mode (embed cannot report live position)
    if (
      this.adapter.capabilities.isHostDrivenSoftSync ||
      this.adapter.capabilities.reliableGetCurrentTime === false
    ) {
      this.currentSyncStatus = "in_sync";
      this.currentDriftMs = 0;
      this.emitMetrics();
      return;
    }

    const currentPosMs = this.adapter.getCurrentTime();
    const targetPosMs = this.getTargetPositionMs();
    // drift: positive = client video is ahead; negative = client video is behind
    const driftMs = currentPosMs - targetPosMs;
    this.currentDriftMs = Math.round(driftMs);
    const absDriftMs = Math.abs(driftMs);

    // ========================================================
    // ZONE 3: HARD SEEK (drift > 1000 ms or background catchup)
    // ========================================================
    if (absDriftMs > this.hardSeekThresholdMs || (forceImmediate && absDriftMs > this.deadZoneMs)) {
      this.currentSyncStatus = "seeking";
      this.isNudging = false;
      this.applyProgrammaticRate(1.0);
      this.hardSeekCount++;
      this.programmaticSeek(targetPosMs);
      this.emitMetrics();
      return;
    }

    // ========================================================
    // HYSTERESIS DEAD ZONE LOGIC
    // ========================================================
    const activeDeadZone = this.isNudging ? this.hysteresisZoneMs : this.deadZoneMs;

    if (absDriftMs <= activeDeadZone) {
      // In dead zone -> In sync!
      this.currentSyncStatus = "in_sync";
      if (this.isNudging) {
        this.isNudging = false;
        this.applyProgrammaticRate(1.0);
      }
      this.emitMetrics();
      return;
    }

    // ========================================================
    // GRACEFUL DEGRADATION:
    // If adapter has limited control (no playbackRate or no precise seek),
    // drift engine falls back to hard seeks only!
    // ========================================================
    if (!this.adapter.capabilities.supportsPlaybackRate || !this.adapter.capabilities.supportsPreciseSeek) {
      this.currentSyncStatus = "seeking";
      this.isNudging = false;
      this.applyProgrammaticRate(1.0);
      this.hardSeekCount++;
      this.programmaticSeek(targetPosMs);
      this.emitMetrics();
      return;
    }

    // ========================================================
    // ZONE 2: SMOOTH PLAYBACK RATE NUDGING (40 ms to 1000 ms)
    // ========================================================
    this.isNudging = true;
    this.currentSyncStatus = "adjusting";

    // Proportional rate adjustment:
    // When behind (drift < 0): speed up (e.g. 1.02x - 1.08x)
    // When ahead (drift > 0): slow down (e.g. 0.92x - 0.98x)
    const normalizedFactor = Math.min(this.maxRateAdjustment, Math.max(0.02, absDriftMs / 5000));
    const targetRate = driftMs < 0 ? 1.0 + normalizedFactor : 1.0 - normalizedFactor;

    // Only update rate if difference exceeds 0.005 to prevent audio DSP micro-glitches
    if (Math.abs(this.currentPlaybackRate - targetRate) >= 0.005) {
      this.softCorrectionCount++;
      this.applyProgrammaticRate(Number(targetRate.toFixed(3)));
    }

    this.emitMetrics();
  }

  // ==========================================
  // PROGRAMMATIC ACTIONS WITH ECHO SUPPRESSION
  // ==========================================

  private async programmaticPlay(): Promise<void> {
    this.programmaticPlayTokens++;
    try {
      await this.adapter.play();
      this.isAutoplayBlocked = false;
      if (this.onAutoplayBlocked) {
        this.onAutoplayBlocked(false);
      }
      this.emitMetrics();
    } catch (err: any) {
      // Autoplay block detection (NotAllowedError)
      this.isAutoplayBlocked = true;
      if (this.onAutoplayBlocked) {
        this.onAutoplayBlocked(true);
      }
      this.emitMetrics();
    }
  }

  private programmaticPause(): void {
    this.programmaticPauseTokens++;
    this.adapter.pause();
  }

  private programmaticSeek(targetPositionMs: number): void {
    this.programmaticSeekTokens++;
    this.isHardSeeking = true;
    this.adapter.seek(targetPositionMs);
    // Automatically reset isHardSeeking after a brief interval if no seeked event fires
    this.timeProvider.setTimeout(() => {
      this.isHardSeeking = false;
    }, 100);
  }

  private applyProgrammaticRate(rate: number): void {
    this.currentPlaybackRate = rate;
    if (this.adapter.capabilities.supportsPlaybackRate) {
      this.adapter.setPlaybackRate(rate);
    }
  }

  /**
   * User interaction trigger to unlock audio/video playback when blocked by browser autoplay policy.
   */
  public async resolveAutoplayBlock(): Promise<void> {
    this.isAutoplayBlocked = false;
    if (this.onAutoplayBlocked) {
      this.onAutoplayBlocked(false);
    }
    await this.programmaticPlay();
    this.evaluateDrift(true);
  }

  // ==========================================
  // ADAPTER EVENT LISTENERS (ECHO SUPPRESSION)
  // ==========================================

  private attachAdapterListeners(): void {
    this.detachAdapterListeners();

    const unsubState = this.adapter.onStateChange((state: PlayerState) => {
      this.handleAdapterStateChange(state);
    });

    const unsubBuffer = this.adapter.onBuffering((buffering: boolean) => {
      this.handleAdapterBuffering(buffering);
    });

    const unsubEnded = this.adapter.onEnded(() => {
      this.currentSyncStatus = "stopped";
      this.emitMetrics();
    });

    const unsubError = this.adapter.onError((err: any) => {
      if (err?.name === "NotAllowedError") {
        this.isAutoplayBlocked = true;
        this.onAutoplayBlocked?.(true);
      }
      this.emitMetrics();
    });

    this.adapterUnsubscribers.push(unsubState, unsubBuffer, unsubEnded, unsubError);

    if (typeof this.adapter.onSeek === "function") {
      const unsubSeek = this.adapter.onSeek((posMs: number) => {
        this.handleAdapterSeek(posMs);
      });
      this.adapterUnsubscribers.push(unsubSeek);
    }
  }

  private detachAdapterListeners(): void {
    for (const unsub of this.adapterUnsubscribers) {
      try {
        unsub();
      } catch {}
    }
    this.adapterUnsubscribers = [];
  }

  private handleAdapterStateChange(state: PlayerState): void {
    if (state === "playing") {
      if (this.programmaticPlayTokens > 0) {
        this.programmaticPlayTokens--;
        return; // Echo suppressed!
      }

      this.isBuffering = false;
      if (this.onUserAction) {
        this.onUserAction({
          type: "PLAY",
          positionMs: this.adapter.getCurrentTime(),
        });
      }
      this.evaluateDrift();
    } else if (state === "paused") {
      if (this.programmaticPauseTokens > 0) {
        this.programmaticPauseTokens--;
        return; // Echo suppressed!
      }

      if (this.onUserAction) {
        this.onUserAction({
          type: "PAUSE",
          positionMs: this.adapter.getCurrentTime(),
        });
      }
      this.evaluateDrift();
    } else if (state === "buffering") {
      this.isBuffering = true;
      this.currentSyncStatus = "buffering";
      this.emitMetrics();
    }
  }

  private handleAdapterBuffering(buffering: boolean): void {
    this.isBuffering = buffering;
    if (buffering) {
      this.currentSyncStatus = "buffering";
    }
    if (this.onBufferReport) {
      this.onBufferReport({ isBuffering: buffering });
    }
    if (!buffering) {
      this.evaluateDrift();
    } else {
      this.emitMetrics();
    }
  }

  private handleAdapterSeek(targetPosMs: number): void {
    if (this.programmaticSeekTokens > 0) {
      this.programmaticSeekTokens--;
      this.isHardSeeking = false;
      return; // Echo suppressed!
    }

    this.isHardSeeking = false;
    if (this.onUserAction) {
      this.onUserAction({
        type: "SEEK",
        targetPositionMs: targetPosMs,
      });
    }
  }

  // ==========================================
  // TAB BACKGROUND THROTTLING RESILIENCE
  // ==========================================

  private attachDocumentVisibilityListener(): void {
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      this.boundOnVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          // Tab regained focus! Immediately resync to authoritative state
          this.evaluateDrift(true);
        }
      };
      document.addEventListener("visibilitychange", this.boundOnVisibilityChange);
    }
  }

  private detachDocumentVisibilityListener(): void {
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function" && this.boundOnVisibilityChange) {
      document.removeEventListener("visibilitychange", this.boundOnVisibilityChange);
    }
  }

  // ==========================================
  // METRICS & TELEMETRY
  // ==========================================

  public getMetrics(): SyncMetrics {
    const timeInSyncPercent =
      this.totalPlayingDurationMs > 0
        ? Math.min(100, Math.round((this.timeInDeadbandMs / this.totalPlayingDurationMs) * 1000) / 10)
        : 100;

    return {
      currentDriftMs: this.currentDriftMs,
      clockOffsetMs: this.clockSync.getClockOffset(),
      rttMs: this.clockSync.getLatestRtt(),
      hardSeekCount: this.hardSeekCount,
      softCorrectionCount: this.softCorrectionCount,
      timeInSyncPercent,
      syncStatus: this.currentSyncStatus,
      playbackRate: this.currentPlaybackRate,
      autoplayBlocked: this.isAutoplayBlocked,
      serverTimeMs: this.serverNow(),
      totalPlayingDurationMs: this.totalPlayingDurationMs,
      timeInDeadbandMs: this.timeInDeadbandMs,
    };
  }

  public subscribeMetrics(listener: (metrics: SyncMetrics) => void): () => void {
    this.metricsListeners.add(listener);
    listener(this.getMetrics());
    return () => {
      this.metricsListeners.delete(listener);
    };
  }

  private emitMetrics(): void {
    const metrics = this.getMetrics();
    if (this.onMetricsUpdate) {
      this.onMetricsUpdate(metrics);
    }
    for (const listener of this.metricsListeners) {
      try {
        listener(metrics);
      } catch {
        // Safe dispatch
      }
    }
  }
}
