import { ROOM_CONSTANTS } from "@watchparty/shared";

/**
 * Token bucket rate limiter for per-connection abuse prevention.
 */
export class TokenBucketRateLimiter {
  private capacity: number;
  private refillRate: number; // tokens per second
  private tokens: number;
  private lastRefillTimestamp: number;

  constructor(
    capacity = ROOM_CONSTANTS.RATE_LIMIT_CAPACITY,
    refillRate = ROOM_CONSTANTS.RATE_LIMIT_REFILL_RATE
  ) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefillTimestamp = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTimestamp) / 1000;
    if (elapsedSeconds > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRate);
      this.lastRefillTimestamp = now;
    }
  }

  /**
   * Tries to consume `cost` tokens. Returns true if allowed, false if rate limited.
   */
  public consume(cost = 1): boolean {
    this.refill();
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  public getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  public reset(): void {
    this.tokens = this.capacity;
    this.lastRefillTimestamp = Date.now();
  }
}
