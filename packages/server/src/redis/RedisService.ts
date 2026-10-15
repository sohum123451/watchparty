import { Redis } from "ioredis";

export interface IRedisService {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, handler: (message: string) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  acquireLock(lockKey: string, owner: string, ttlMs: number): Promise<boolean>;
  releaseLock(lockKey: string, owner: string): Promise<boolean>;
  renewLock(lockKey: string, owner: string, ttlMs: number): Promise<boolean>;
  ping(): Promise<boolean>;
  disconnect(): Promise<void>;
  isReady(): boolean;
}

/**
 * High-performance In-Memory Redis Implementation for testing, CI, and zero-dependency fallbacks.
 * Accurately models TTLs, key glob matching, channel Pub/Sub, and atomic distributed locking.
 */
export class MemoryRedisService implements IRedisService {
  private store: Map<string, { value: string; expiresAt: number | null }> = new Map();
  private subscribers: Map<string, Set<(message: string) => void>> = new Map();
  private locks: Map<string, { owner: string; expiresAt: number }> = new Map();
  private ready = true;

  private isKeyExpired(entry: { value: string; expiresAt: number | null }): boolean {
    if (entry.expiresAt === null) return false;
    return Date.now() > entry.expiresAt;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isKeyExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  public async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt = typeof ttlSeconds === "number" ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  public async del(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  public async keys(pattern: string): Promise<string[]> {
    const regexStr = "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
    const regex = new RegExp(regexStr);
    const results: string[] = [];
    const now = Date.now();

    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.store.delete(key);
        continue;
      }
      if (regex.test(key)) {
        results.push(key);
      }
    }
    return results;
  }

  public async publish(channel: string, message: string): Promise<number> {
    const subs = this.subscribers.get(channel);
    if (!subs || subs.size === 0) return 0;
    for (const handler of subs) {
      try {
        handler(message);
      } catch (err) {
        console.error(`[MemoryRedis] Error in pub/sub handler for ${channel}:`, err);
      }
    }
    return subs.size;
  }

  public async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    let subs = this.subscribers.get(channel);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(channel, subs);
    }
    subs.add(handler);
  }

  public async unsubscribe(channel: string): Promise<void> {
    this.subscribers.delete(channel);
  }

  public async acquireLock(lockKey: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.locks.get(lockKey);
    if (existing && existing.expiresAt > now && existing.owner !== owner) {
      return false;
    }
    this.locks.set(lockKey, { owner, expiresAt: now + ttlMs });
    return true;
  }

  public async releaseLock(lockKey: string, owner: string): Promise<boolean> {
    const existing = this.locks.get(lockKey);
    if (existing && existing.owner === owner) {
      this.locks.delete(lockKey);
      return true;
    }
    return false;
  }

  public async renewLock(lockKey: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.locks.get(lockKey);
    if (existing && existing.owner === owner && existing.expiresAt > now) {
      existing.expiresAt = now + ttlMs;
      return true;
    }
    return false;
  }

  public async ping(): Promise<boolean> {
    return this.ready;
  }

  public async disconnect(): Promise<void> {
    this.ready = false;
    this.store.clear();
    this.subscribers.clear();
    this.locks.clear();
  }

  public clear(): void {
    this.store.clear();
    this.subscribers.clear();
    this.locks.clear();
  }
}

/**
 * Production Redis Service using real ioredis client.
 */
export class RealRedisService implements IRedisService {
  private client: Redis;
  private subClient: Redis;
  private channelHandlers: Map<string, Set<(message: string) => void>> = new Map();
  private ready = false;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      lazyConnect: true,
    });

    this.subClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.client.on("ready", () => {
      this.ready = true;
    });

    this.client.on("error", (err) => {
      console.warn(`[RealRedisService] Client error: ${err.message}`);
      this.ready = false;
    });

    this.subClient.on("message", (channel, message) => {
      const handlers = this.channelHandlers.get(channel);
      if (handlers) {
        for (const h of handlers) {
          try {
            h(message);
          } catch (e) {
            console.error(`[RealRedisService] Message dispatch error:`, e);
          }
        }
      }
    });
  }

  public async init(): Promise<void> {
    await this.client.connect();
    await this.subClient.connect();
    this.ready = true;
  }

  public isReady(): boolean {
    return this.ready && this.client.status === "ready";
  }

  public async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  public async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
      await this.client.set(key, value, "EX", ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  public async del(key: string): Promise<boolean> {
    const deleted = await this.client.del(key);
    return deleted > 0;
  }

  public async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  public async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  public async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    let handlers = this.channelHandlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.channelHandlers.set(channel, handlers);
      await this.subClient.subscribe(channel);
    }
    handlers.add(handler);
  }

  public async unsubscribe(channel: string): Promise<void> {
    this.channelHandlers.delete(channel);
    await this.subClient.unsubscribe(channel);
  }

  public async acquireLock(lockKey: string, owner: string, ttlMs: number): Promise<boolean> {
    // Redis SET NX PX
    const res = await this.client.set(lockKey, owner, "PX", ttlMs, "NX");
    return res === "OK";
  }

  public async releaseLock(lockKey: string, owner: string): Promise<boolean> {
    // Atomic Lua script check and delete
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const res = await this.client.eval(luaScript, 1, lockKey, owner);
    return res === 1;
  }

  public async renewLock(lockKey: string, owner: string, ttlMs: number): Promise<boolean> {
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;
    const res = await this.client.eval(luaScript, 1, lockKey, owner, ttlMs);
    return res === 1;
  }

  public async ping(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === "PONG";
    } catch {
      return false;
    }
  }

  public async disconnect(): Promise<void> {
    this.ready = false;
    try {
      await this.subClient.quit();
    } catch {
      this.subClient.disconnect();
    }
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

/**
 * Creates an IRedisService. If REDIS_URL is provided, tries to connect to real Redis.
 * If connection fails or no URL provided, falls back gracefully to MemoryRedisService.
 */
export async function createRedisService(redisUrl?: string): Promise<IRedisService> {
  const url = redisUrl || process.env.REDIS_URL;
  if (!url || process.env.NODE_ENV === "test") {
    return new MemoryRedisService();
  }

  try {
    const realService = new RealRedisService(url);
    await realService.init();
    console.log(`[Redis] Connected successfully to ${url.replace(/\/\/.*@/, "//***@")}`);
    return realService;
  } catch (err: any) {
    console.warn(`[Redis] Failed to connect to ${url} (${err.message}). Falling back to MemoryRedisService.`);
    return new MemoryRedisService();
  }
}
