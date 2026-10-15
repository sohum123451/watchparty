import { RoomEvent } from "../models.js";

/**
 * Bounded ring buffer holding the most recent RoomEvents keyed by monotonic version.
 * Enables fast reconnection replay of missed events when the gap is within capacity.
 */
export class VersionedRingBuffer {
  private buffer: RoomEvent[];
  private readonly capacity: number;

  constructor(capacity = 100) {
    this.capacity = capacity;
    this.buffer = [];
  }

  public push(event: RoomEvent): void {
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
    }
    this.buffer.push(event);
  }

  public getEventsSince(lastKnownVersion: number): RoomEvent[] | null {
    if (this.buffer.length === 0) {
      return [];
    }

    const minVersion = this.buffer[0].version;
    const maxVersion = this.buffer[this.buffer.length - 1].version;

    // Client is already up to date
    if (lastKnownVersion >= maxVersion) {
      return [];
    }

    // Gap too large: the client missed events that have been evicted from the ring buffer
    if (lastKnownVersion < minVersion - 1) {
      return null;
    }

    // Filter events strictly greater than lastKnownVersion
    return this.buffer.filter((e) => e.version > lastKnownVersion);
  }

  public getMinVersion(): number {
    return this.buffer.length > 0 ? this.buffer[0].version : 0;
  }

  public getMaxVersion(): number {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].version : 0;
  }

  public size(): number {
    return this.buffer.length;
  }

  public clear(): void {
    this.buffer = [];
  }
}
