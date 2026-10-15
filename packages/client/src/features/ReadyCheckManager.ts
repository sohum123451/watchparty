import { ReadyCheck } from "@watchparty/shared";
import { ClockSync } from "../sync/ClockSync.js";

export interface ReadyCheckListener {
  (state: {
    active: boolean;
    countdownSeconds: number;
    secondsRemaining: number;
    progress: number; // 0.0 to 1.0
    initiatedByUserName: string;
    targetServerTimeMs: number;
  } | null): void;
}

export interface ReadyCheckCompleteHandler {
  (startPositionMs: number): void;
}

export class ReadyCheckManager {
  private currentReadyCheck: ReadyCheck | null = null;
  private clockSync: ClockSync;
  private timerId: any = null;
  private listeners: Set<ReadyCheckListener> = new Set();
  private onComplete?: ReadyCheckCompleteHandler;

  constructor(options: {
    clockSync: ClockSync;
    onComplete?: ReadyCheckCompleteHandler;
  }) {
    this.clockSync = options.clockSync;
    this.onComplete = options.onComplete;
  }

  public handleCountdownStart(readyCheck: ReadyCheck): void {
    this.currentReadyCheck = { ...readyCheck };
    this.startCountdownLoop();
  }

  public handleCountdownCancel(): void {
    this.stopCountdownLoop();
    this.currentReadyCheck = null;
    this.notify();
  }

  public getActiveReadyCheck(): ReadyCheck | null {
    return this.currentReadyCheck ? { ...this.currentReadyCheck } : null;
  }

  private startCountdownLoop(): void {
    this.stopCountdownLoop();

    const tick = () => {
      if (!this.currentReadyCheck || !this.currentReadyCheck.active) {
        this.stopCountdownLoop();
        return;
      }

      const serverNow = this.clockSync.serverNow();
      const remainingMs = this.currentReadyCheck.targetServerTimeMs - serverNow;

      if (remainingMs <= 0) {
        // Countdown completed!
        const startPos = this.currentReadyCheck.startPositionMs;
        this.currentReadyCheck.active = false;
        this.stopCountdownLoop();
        this.notify();

        if (this.onComplete) {
          this.onComplete(startPos);
        }
        return;
      }

      this.notify();
      this.timerId = setTimeout(tick, 50); // High-precision 50ms check
    };

    tick();
  }

  private stopCountdownLoop(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  public subscribe(listener: ReadyCheckListener): () => void {
    this.listeners.add(listener);
    this.notifyListener(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      this.notifyListener(listener);
    }
  }

  private notifyListener(listener: ReadyCheckListener): void {
    if (!this.currentReadyCheck || !this.currentReadyCheck.active) {
      listener(null);
      return;
    }

    const serverNow = this.clockSync.serverNow();
    const remainingMs = Math.max(0, this.currentReadyCheck.targetServerTimeMs - serverNow);
    const totalDuration = this.currentReadyCheck.countdownMs;
    const progress = Math.min(1.0, Math.max(0, 1.0 - remainingMs / totalDuration));
    const secondsRemaining = Math.ceil(remainingMs / 1000);

    listener({
      active: true,
      countdownSeconds: Math.round(totalDuration / 1000),
      secondsRemaining,
      progress,
      initiatedByUserName: this.currentReadyCheck.initiatedByUserName,
      targetServerTimeMs: this.currentReadyCheck.targetServerTimeMs,
    });
  }

  public destroy(): void {
    this.stopCountdownLoop();
    this.listeners.clear();
  }
}
