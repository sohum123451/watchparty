import { TimeProvider } from "@watchparty/client";

/**
 * VirtualTimeProvider allows deterministic, high-speed time stepping
 * for long-duration benchmark simulations (e.g. 5 minutes / 300,000 ms in milliseconds).
 */
export class VirtualTimeProvider implements TimeProvider {
  private currentTime: number;
  private timerIdCounter = 1;
  private timers: Map<
    number,
    {
      type: "timeout" | "interval";
      targetTime: number;
      delay: number;
      fn: () => void;
    }
  > = new Map();

  constructor(initialTime = Date.now()) {
    this.currentTime = initialTime;
  }

  public now(): number {
    return this.currentTime;
  }

  public setTimeout(handler: () => void, timeout: number): any {
    const id = this.timerIdCounter++;
    this.timers.set(id, {
      type: "timeout",
      targetTime: this.currentTime + Math.max(0, timeout),
      delay: timeout,
      fn: handler,
    });
    return id;
  }

  public clearTimeout(handle: any): void {
    this.timers.delete(Number(handle));
  }

  public setInterval(handler: () => void, timeout: number): any {
    const id = this.timerIdCounter++;
    const delay = Math.max(1, timeout);
    this.timers.set(id, {
      type: "interval",
      targetTime: this.currentTime + delay,
      delay,
      fn: handler,
    });
    return id;
  }

  public clearInterval(handle: any): void {
    this.timers.delete(Number(handle));
  }

  /**
   * Advances virtual time by `deltaMs` and executes all timers that expired.
   */
  public advance(deltaMs: number): void {
    const target = this.currentTime + deltaMs;

    while (this.currentTime < target) {
      // Find the earliest expiring timer
      let nextTimerId: number | null = null;
      let earliestTime = target;

      for (const [id, timer] of this.timers.entries()) {
        if (timer.targetTime <= earliestTime) {
          earliestTime = timer.targetTime;
          nextTimerId = id;
        }
      }

      if (nextTimerId === null) {
        // No timers pending before target
        this.currentTime = target;
        break;
      }

      // Advance clock to this timer's firing time
      this.currentTime = earliestTime;
      const timer = this.timers.get(nextTimerId);
      if (!timer) continue;

      if (timer.type === "timeout") {
        this.timers.delete(nextTimerId);
        timer.fn();
      } else {
        // interval
        timer.targetTime = this.currentTime + timer.delay;
        timer.fn();
      }
    }
  }

  public setTime(timestampMs: number): void {
    this.currentTime = timestampMs;
  }
}
