import crypto from "node:crypto";
import { FriendshipRow } from "../../auth/db/schema.js";

export interface IFriendsRepository {
  createOrUpdateFriendship(data: {
    user1Id: string;
    user2Id: string;
    requesterId: string;
    addresseeId: string;
    status: "pending" | "accepted" | "blocked";
    blockedBy?: string | null;
  }): Promise<FriendshipRow>;

  getRelationship(userA: string, userB: string): Promise<FriendshipRow | null>;
  findFriendshipById(id: string): Promise<FriendshipRow | null>;
  getUserFriendships(userId: string): Promise<FriendshipRow[]>;
  deleteFriendship(id: string): Promise<boolean>;
  deleteRelationship(userA: string, userB: string): Promise<boolean>;
  deleteAllUserFriendships(userId: string): Promise<number>;
}

/**
 * In-memory repository implementing IFriendsRepository.
 * Treats (A, B) and (B, A) as the exact same canonical relationship pair.
 */
export class MemoryFriendsRepository implements IFriendsRepository {
  private friendships: Map<string, FriendshipRow> = new Map();

  private getPairKey(userA: string, userB: string): string {
    const [u1, u2] = userA < userB ? [userA, userB] : [userB, userA];
    return `${u1}:${u2}`;
  }

  public async createOrUpdateFriendship(data: {
    user1Id: string;
    user2Id: string;
    requesterId: string;
    addresseeId: string;
    status: "pending" | "accepted" | "blocked";
    blockedBy?: string | null;
  }): Promise<FriendshipRow> {
    const key = this.getPairKey(data.user1Id, data.user2Id);
    const existing = this.friendships.get(key);
    const now = new Date();

    if (existing) {
      existing.requesterId = data.requesterId;
      existing.addresseeId = data.addresseeId;
      existing.status = data.status;
      existing.blockedBy = data.blockedBy ?? null;
      existing.updatedAt = now;
      return { ...existing };
    }

    const [u1, u2] = data.user1Id < data.user2Id ? [data.user1Id, data.user2Id] : [data.user2Id, data.user1Id];
    const newRow: FriendshipRow = {
      id: crypto.randomUUID(),
      user1Id: u1,
      user2Id: u2,
      requesterId: data.requesterId,
      addresseeId: data.addresseeId,
      status: data.status,
      blockedBy: data.blockedBy ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.friendships.set(key, newRow);
    return { ...newRow };
  }

  public async getRelationship(userA: string, userB: string): Promise<FriendshipRow | null> {
    const key = this.getPairKey(userA, userB);
    const row = this.friendships.get(key);
    return row ? { ...row } : null;
  }

  public async findFriendshipById(id: string): Promise<FriendshipRow | null> {
    for (const row of this.friendships.values()) {
      if (row.id === id) {
        return { ...row };
      }
    }
    return null;
  }

  public async getUserFriendships(userId: string): Promise<FriendshipRow[]> {
    const results: FriendshipRow[] = [];
    for (const row of this.friendships.values()) {
      if (row.user1Id === userId || row.user2Id === userId) {
        results.push({ ...row });
      }
    }
    return results;
  }

  public async deleteFriendship(id: string): Promise<boolean> {
    for (const [key, row] of this.friendships.entries()) {
      if (row.id === id) {
        this.friendships.delete(key);
        return true;
      }
    }
    return false;
  }

  public async deleteRelationship(userA: string, userB: string): Promise<boolean> {
    const key = this.getPairKey(userA, userB);
    return this.friendships.delete(key);
  }

  public async deleteAllUserFriendships(userId: string): Promise<number> {
    let count = 0;
    for (const [key, row] of this.friendships.entries()) {
      if (row.user1Id === userId || row.user2Id === userId) {
        this.friendships.delete(key);
        count++;
      }
    }
    return count;
  }

  public clear(): void {
    this.friendships.clear();
  }
}
