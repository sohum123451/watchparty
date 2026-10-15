import { PlaybackState } from "@watchparty/shared";
import { PlayerAdapter } from "../adapters/PlayerAdapter.js";

export interface SyncVideoElement {
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  seeking: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: (event?: any) => void): void;
  removeEventListener(type: string, listener: (event?: any) => void): void;
}

export type SyncStatus =
  | "in_sync"
  | "adjusting"
  | "seeking"
  | "buffering"
  | "paused"
  | "stopped";

export interface SyncMetrics {
  currentDriftMs: number;
  clockOffsetMs: number;
  rttMs: number;
  hardSeekCount: number;
  softCorrectionCount: number;
  timeInSyncPercent: number;
  syncStatus: SyncStatus;
  playbackRate: number;
  autoplayBlocked: boolean;
  serverTimeMs: number;
  totalPlayingDurationMs: number;
  timeInDeadbandMs: number;
}

export type UserPlaybackAction =
  | { type: "PLAY"; positionMs: number }
  | { type: "PAUSE"; positionMs: number }
  | { type: "SEEK"; targetPositionMs: number };

export interface ClockSyncSample {
  offsetMs: number;
  rttMs: number;
  timestamp: number;
}

export interface TimeProvider {
  now(): number;
  setInterval(handler: () => void, timeout: number): any;
  clearInterval(handle: any): void;
  setTimeout(handler: () => void, timeout: number): any;
  clearTimeout(handle: any): void;
}

export interface SyncEngineConfig {
  adapter?: PlayerAdapter;
  video?: SyncVideoElement;
  sendPing: (clientSendTimeMs: number) => void;
  onUserAction?: (action: UserPlaybackAction) => void;
  onBufferReport?: (report: { isBuffering: boolean; bufferedUpToMs?: number }) => void;
  onAutoplayBlocked?: (blocked: boolean) => void;
  onMetricsUpdate?: (metrics: SyncMetrics) => void;
  timeProvider?: TimeProvider;
  
  // Custom tuning thresholds (defaults applied if omitted)
  driftIntervalMs?: number;        // default: 250 ms
  pingIntervalMs?: number;         // default: 5000 ms
  deadZoneMs?: number;             // default: 40 ms
  hysteresisZoneMs?: number;       // default: 20 ms
  hardSeekThresholdMs?: number;    // default: 1000 ms
  maxRateAdjustment?: number;      // default: 0.08 (allows 0.92x - 1.08x)
}

