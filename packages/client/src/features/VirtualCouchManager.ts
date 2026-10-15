import { MemberPublicInfo, CouchSeat } from "@watchparty/shared";

export interface CouchStateListener {
  (seats: CouchSeat[]): void;
}

const PALETTE = [
  "#6366f1", // Indigo
  "#ec4899", // Pink
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#8b5cf6", // Purple
  "#06b6d4", // Cyan
  "#f43f5e", // Rose
  "#3b82f6", // Blue
  "#14b8a6", // Teal
  "#84cc16", // Lime
  "#eab308", // Yellow
  "#d946ef", // Fuchsia
];

export class VirtualCouchManager {
  private seats: Map<string, CouchSeat> = new Map();
  private maxSeats = 12;
  private listeners: Set<CouchStateListener> = new Set();
  private reactionTimeouts: Map<string, any> = new Map();

  constructor(options?: { maxSeats?: number }) {
    if (options?.maxSeats) {
      this.maxSeats = options.maxSeats;
    }
  }

  public syncMembers(members: MemberPublicInfo[]): void {
    const activeIds = new Set(members.map((m) => m.userId));

    // Remove left members
    for (const userId of this.seats.keys()) {
      if (!activeIds.has(userId)) {
        this.seats.delete(userId);
      }
    }

    // Assign or update seats
    members.forEach((m, idx) => {
      let seat = this.seats.get(m.userId);
      if (!seat) {
        const colorIdx = Math.abs(this.hashString(m.userId)) % PALETTE.length;
        seat = {
          seatIndex: idx < this.maxSeats ? idx : this.seats.size,
          userId: m.userId,
          userName: m.userName,
          isHost: m.isHost,
          avatarSeed: m.userId,
          avatarColor: PALETTE[colorIdx],
          status: m.isBuffering ? "buffering" : "watching",
        };
        this.seats.set(m.userId, seat);
      } else {
        seat.userName = m.userName;
        seat.isHost = m.isHost;
        seat.seatIndex = idx;
        if (seat.status !== "reacting") {
          seat.status = m.isBuffering ? "buffering" : "watching";
        }
      }
    });

    this.notify();
  }

  /**
   * Triggers an animated emoji reaction on a member's couch avatar.
   */
  public triggerMemberReaction(userId: string, emoji: string, durationMs = 2500): void {
    const seat = this.seats.get(userId);
    if (!seat) return;

    seat.status = "reacting";
    seat.lastReactionEmoji = emoji;
    seat.reactionExpiryMs = Date.now() + durationMs;

    const existing = this.reactionTimeouts.get(userId);
    if (existing) {
      clearTimeout(existing);
    }

    const timeout = setTimeout(() => {
      this.reactionTimeouts.delete(userId);
      if (seat.status === "reacting") {
        seat.status = "watching";
        seat.lastReactionEmoji = undefined;
        this.notify();
      }
    }, durationMs);

    this.reactionTimeouts.set(userId, timeout);
    this.notify();
  }

  /**
   * Updates buffering status on an avatar.
   */
  public updateMemberBuffering(userId: string, isBuffering: boolean): void {
    const seat = this.seats.get(userId);
    if (seat) {
      if (isBuffering) {
        seat.status = "buffering";
      } else if (seat.status === "buffering") {
        seat.status = "watching";
      }
      this.notify();
    }
  }

  public getSeats(): CouchSeat[] {
    return Array.from(this.seats.values()).sort((a, b) => a.seatIndex - b.seatIndex);
  }

  public subscribe(listener: CouchStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getSeats());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const list = this.getSeats();
    for (const listener of this.listeners) {
      listener(list);
    }
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  public destroy(): void {
    for (const t of this.reactionTimeouts.values()) {
      clearTimeout(t);
    }
    this.reactionTimeouts.clear();
    this.seats.clear();
    this.listeners.clear();
  }
}
