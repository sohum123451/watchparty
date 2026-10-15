export interface NetworkConditions {
  packetLossRate?: number; // 0.0 to 1.0 (e.g. 0.20 = 20%)
  jitterMs?: number;       // Random added delay in [0, jitterMs]
  fixedLatencyMs?: number; // Fixed base latency in ms
}

/**
 * Simulates real-world imperfect network conditions including packet loss,
 * latency spikes, and asymmetric jitter.
 */
export class NetworkEmulator {
  private conditions: NetworkConditions;

  constructor(conditions: NetworkConditions = {}) {
    this.conditions = conditions;
  }

  public updateConditions(conditions: NetworkConditions): void {
    this.conditions = { ...this.conditions, ...conditions };
  }

  public getConditions(): NetworkConditions {
    return { ...this.conditions };
  }

  /**
   * Determines if a message should be dropped due to packet loss.
   */
  public shouldDrop(): boolean {
    if (!this.conditions.packetLossRate || this.conditions.packetLossRate <= 0) {
      return false;
    }
    return Math.random() < this.conditions.packetLossRate;
  }

  /**
   * Calculates synthetic transit delay in milliseconds (fixed latency + jitter).
   */
  public getDelayMs(): number {
    let delay = this.conditions.fixedLatencyMs ?? 0;
    if (this.conditions.jitterMs && this.conditions.jitterMs > 0) {
      delay += Math.floor(Math.random() * this.conditions.jitterMs);
    }
    return delay;
  }

  /**
   * Transmits a payload with simulated delay and drop, executing callback upon delivery.
   */
  public transmit(deliver: () => void): void {
    if (this.shouldDrop()) {
      // Packet dropped!
      return;
    }

    const delay = this.getDelayMs();
    if (delay <= 0) {
      deliver();
    } else {
      setTimeout(deliver, delay);
    }
  }
}
