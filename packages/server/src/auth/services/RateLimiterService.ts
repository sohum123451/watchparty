export interface LockoutStatus {
  allowed: boolean;
  remainingLockoutMs?: number;
  retryAfterSeconds?: number;
  failureCount: number;
}

interface AttemptRecord {
  failureCount: number;
  lockoutUntil: number;
  firstAttemptAt: number;
}

export class RateLimiterService {
  private attempts: Map<string, AttemptRecord> = new Map();
  private readonly maxFailuresBeforeLockout: number;
  private readonly baseLockoutMs: number;
  private readonly maxLockoutMs: number;

  constructor(options: {
    maxFailuresBeforeLockout?: number;
    baseLockoutMs?: number;
    maxLockoutMs?: number;
  } = {}) {
    this.maxFailuresBeforeLockout = options.maxFailuresBeforeLockout ?? 5;
    this.baseLockoutMs = options.baseLockoutMs ?? 60_000;       // 1 minute
    this.maxLockoutMs = options.maxLockoutMs ?? 900_000;     // 15 minutes
  }

  /**
   * Checks if an action is currently allowed for the given key (IP or Account).
   */
  public check(key: string): LockoutStatus {
    const record = this.attempts.get(key);
    if (!record) {
      return { allowed: true, failureCount: 0 };
    }

    const now = Date.now();
    if (record.lockoutUntil > now) {
      const remainingMs = record.lockoutUntil - now;
      return {
        allowed: false,
        remainingLockoutMs: remainingMs,
        retryAfterSeconds: Math.ceil(remainingMs / 1000),
        failureCount: record.failureCount,
      };
    }

    return { allowed: true, failureCount: record.failureCount };
  }

  /**
   * Records a failed attempt and triggers exponential backoff lockout if threshold exceeded.
   */
  public recordFailure(key: string): LockoutStatus {
    const now = Date.now();
    let record = this.attempts.get(key);

    if (!record) {
      record = {
        failureCount: 1,
        lockoutUntil: 0,
        firstAttemptAt: now,
      };
      this.attempts.set(key, record);
      return { allowed: true, failureCount: 1 };
    }

    // Reset counter if previous lockout expired over 1 hour ago
    if (record.lockoutUntil > 0 && now - record.lockoutUntil > 3600_000) {
      record.failureCount = 0;
      record.lockoutUntil = 0;
    }

    record.failureCount++;

    if (record.failureCount >= this.maxFailuresBeforeLockout) {
      const excess = record.failureCount - this.maxFailuresBeforeLockout;
      // Exponential backoff: baseLockout * 2^excess (e.g. 1m, 2m, 4m, 8m, capped at maxLockout)
      const durationMs = Math.min(
        this.maxLockoutMs,
        this.baseLockoutMs * Math.pow(2, excess)
      );
      record.lockoutUntil = now + durationMs;

      return {
        allowed: false,
        remainingLockoutMs: durationMs,
        retryAfterSeconds: Math.ceil(durationMs / 1000),
        failureCount: record.failureCount,
      };
    }

    return { allowed: true, failureCount: record.failureCount };
  }

  /**
   * Records a successful operation, resetting the failure and lockout state.
   */
  public recordSuccess(key: string): void {
    this.attempts.delete(key);
  }

  public clear(): void {
    this.attempts.clear();
  }
}
