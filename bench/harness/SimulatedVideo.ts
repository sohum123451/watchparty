import { SyncVideoElement, TimeProvider } from "@watchparty/client";

export interface SimulatedVideoOptions {
  timeProvider?: TimeProvider;
  hardwareDriftPpm?: number; // Parts-per-million hardware clock skew (e.g. +15 or -10)
}

/**
 * Headless simulated HTML5 video element with realistic clock progression,
 * variable playbackRate slew handling, seek events, and simulated buffering.
 */
export class SimulatedVideo implements SyncVideoElement {
  private _currentTimeSeconds = 0;
  private _playbackRate = 1.0;
  private _paused = true;
  private _seeking = false;
  private _lastTimestampMs: number;
  private readonly timeProvider: TimeProvider;
  private readonly clockSkewRatio: number;
  private listeners: Map<string, Set<(e?: any) => void>> = new Map();

  constructor(options: SimulatedVideoOptions = {}) {
    this.timeProvider = options.timeProvider || {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id),
    };
    this.clockSkewRatio = 1 + (options.hardwareDriftPpm ?? 0) / 1_000_000;
    this._lastTimestampMs = this.timeProvider.now();
  }

  /**
   * Advances the internal clock state based on time elapsed since last check.
   */
  private updateClock(): void {
    const now = this.timeProvider.now();
    const elapsedMs = Math.max(0, now - this._lastTimestampMs);
    this._lastTimestampMs = now;

    if (!this._paused && !this._seeking && elapsedMs > 0) {
      const elapsedSeconds = (elapsedMs / 1000) * this._playbackRate * this.clockSkewRatio;
      this._currentTimeSeconds += elapsedSeconds;
    }
  }

  get currentTime(): number {
    this.updateClock();
    return this._currentTimeSeconds;
  }

  set currentTime(val: number) {
    this.updateClock();
    this._currentTimeSeconds = Math.max(0, val);
    this._seeking = true;
    this.emit("seeking");
    this._seeking = false;
    this.emit("seeked");
  }

  get playbackRate(): number {
    return this._playbackRate;
  }

  set playbackRate(val: number) {
    this.updateClock();
    this._playbackRate = val;
  }

  get paused(): boolean {
    return this._paused;
  }

  get seeking(): boolean {
    return this._seeking;
  }

  public async play(): Promise<void> {
    this.updateClock();
    this._paused = false;
    this.emit("play");
    this.emit("playing");
  }

  public pause(): void {
    this.updateClock();
    this._paused = true;
    this.emit("pause");
  }

  public triggerBuffering(durationMs = 1500): Promise<void> {
    this.updateClock();
    this.emit("waiting");
    return new Promise((resolve) => {
      this.timeProvider.setTimeout(() => {
        this.emit("canplay");
        this.emit("playing");
        resolve();
      }, durationMs);
    });
  }

  public addEventListener(type: string, listener: (e?: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: (e?: any) => void): void {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(listener);
    }
  }

  private emit(type: string, event?: any): void {
    const set = this.listeners.get(type);
    if (set) {
      for (const listener of set) {
        try {
          listener(event);
        } catch {
          // Ignore listener errors
        }
      }
    }
  }

  public reset(positionSeconds = 0): void {
    this._currentTimeSeconds = positionSeconds;
    this._paused = true;
    this._seeking = false;
    this._playbackRate = 1.0;
    this._lastTimestampMs = this.timeProvider.now();
  }
}
