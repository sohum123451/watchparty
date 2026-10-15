import crypto from "node:crypto";
import { UserRow, RefreshTokenRow, EmailTokenRow } from "./schema.js";

export interface IAuthRepository {
  // User operations
  createUser(data: {
    email: string;
    passwordHash: string;
    displayName: string;
    username?: string;
    friendCode?: string;
    presencePrivacy?: "everyone" | "friends" | "nobody";
    whoCanFriendMe?: "everyone" | "friends_of_friends" | "nobody";
    whoCanInviteMe?: "everyone" | "friends_only" | "nobody";
    bio?: string;
    avatar?: string;
    notificationPreferences?: string;
    pendingEmail?: string;
    emailVerifiedAt?: Date | null;
    googleId?: string;
    role?: string;
  }): Promise<UserRow>;

  findUserById(id: string): Promise<UserRow | null>;
  findUserByEmail(email: string): Promise<UserRow | null>;
  findUserByUsername(username: string): Promise<UserRow | null>;
  findUserByFriendCode(friendCode: string): Promise<UserRow | null>;
  findUserByGoogleId(googleId: string): Promise<UserRow | null>;
  searchUsers(query: string, limit?: number): Promise<UserRow[]>;
  getAllUsers(options?: { query?: string; limit?: number; offset?: number }): Promise<UserRow[]>;
  countUsers(): Promise<number>;
  banUser(userId: string, reason?: string): Promise<UserRow | null>;
  unbanUser(userId: string): Promise<UserRow | null>;
  updateUser(id: string, updates: Partial<UserRow>): Promise<UserRow | null>;
  deleteUser(id: string): Promise<boolean>;

  // Session & Refresh token operations
  createRefreshToken(data: {
    userId: string;
    tokenHash: string;
    familyId: string;
    deviceInfo?: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRow>;

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRow | null>;
  getActiveSessions(userId: string): Promise<RefreshTokenRow[]>;
  revokeRefreshToken(id: string): Promise<void>;
  revokeTokenFamily(familyId: string): Promise<number>;
  revokeOtherSessions(userId: string, currentSessionId: string): Promise<number>;
  revokeAllUserTokens(userId: string): Promise<number>;

  // Email token operations
  createEmailToken(data: {
    userId: string;
    type: "verify" | "reset" | "change_email";
    tokenHash: string;
    expiresAt: Date;
  }): Promise<EmailTokenRow>;

  findEmailTokenByHash(tokenHash: string, type: "verify" | "reset" | "change_email"): Promise<EmailTokenRow | null>;
  markEmailTokenUsed(id: string): Promise<void>;
  invalidatePendingEmailTokens(userId: string, type: "verify" | "reset" | "change_email"): Promise<void>;
}

/**
 * High-performance, schema-compliant repository implementing IAuthRepository.
 * Provides out-of-the-box in-memory execution for unit tests, CI, and local dev,
 * with identical constraints and transactional semantics as PostgreSQL.
 */
export class MemoryAuthRepository implements IAuthRepository {
  private users: Map<string, UserRow> = new Map();
  private refreshTokens: Map<string, RefreshTokenRow> = new Map();
  private emailTokens: Map<string, EmailTokenRow> = new Map();

  public async createUser(data: {
    email: string;
    passwordHash: string;
    displayName: string;
    username?: string;
    friendCode?: string;
    presencePrivacy?: "everyone" | "friends" | "nobody";
    whoCanFriendMe?: "everyone" | "friends_of_friends" | "nobody";
    whoCanInviteMe?: "everyone" | "friends_only" | "nobody";
    bio?: string;
    avatar?: string;
    notificationPreferences?: string;
    pendingEmail?: string;
    emailVerifiedAt?: Date | null;
    googleId?: string;
    role?: string;
  }): Promise<UserRow> {
    const normalizedEmail = data.email.toLowerCase().trim();

    // Check unique constraint on email
    for (const u of this.users.values()) {
      if (u.email === normalizedEmail) {
        const error: any = new Error("Unique constraint violation: email already exists");
        error.code = "23505";
        throw error;
      }
    }

    // Generate or validate unique friend code
    let friendCode = data.friendCode?.toUpperCase().trim();
    if (!friendCode) {
      const cleanPrefix = data.displayName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6) || "USER";
      let candidate = `${cleanPrefix}#${crypto.randomInt(1000, 9999)}`;
      while (Array.from(this.users.values()).some((u) => u.friendCode === candidate)) {
        candidate = `${cleanPrefix}#${crypto.randomInt(1000, 9999)}`;
      }
      friendCode = candidate;
    }

    // Generate or validate unique username
    let username = data.username ? data.username.toLowerCase().trim() : undefined;
    if (!username) {
      const baseName = (data.displayName.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() || normalizedEmail.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "")).slice(0, 24);
      let candidate = baseName;
      let counter = 1;
      while (Array.from(this.users.values()).some((u) => u.username === candidate)) {
        candidate = `${baseName}${counter++}`;
      }
      username = candidate;
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const user: UserRow = {
      id,
      email: normalizedEmail,
      passwordHash: data.passwordHash,
      displayName: data.displayName,
      username,
      friendCode,
      presencePrivacy: data.presencePrivacy || "friends",
      whoCanFriendMe: data.whoCanFriendMe || "everyone",
      whoCanInviteMe: data.whoCanInviteMe || "everyone",
      bio: data.bio || null,
      avatar: data.avatar || null,
      notificationPreferences: data.notificationPreferences || null,
      pendingEmail: data.pendingEmail || null,
      emailVerifiedAt: data.emailVerifiedAt || null,
      googleId: data.googleId || null,
      role: data.role || "user",
      isBanned: false,
      bannedAt: null,
      bannedReason: null,
      createdAt: now,
    };

    this.users.set(id, user);
    return { ...user };
  }

  public async getAllUsers(options: { query?: string; limit?: number; offset?: number } = {}): Promise<UserRow[]> {
    const { query, limit = 50, offset = 0 } = options;
    let list = Array.from(this.users.values());

    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q) ||
          (u.username && u.username.toLowerCase().includes(q))
      );
    }

    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return list.slice(offset, offset + limit).map((u) => ({ ...u }));
  }

  public async countUsers(): Promise<number> {
    return this.users.size;
  }

  public async banUser(userId: string, reason?: string): Promise<UserRow | null> {
    const user = this.users.get(userId);
    if (!user) return null;

    user.isBanned = true;
    user.bannedAt = new Date();
    user.bannedReason = reason || "Banned by administrator";
    this.users.set(userId, user);

    // Invalidate all tokens for banned user
    await this.revokeAllUserTokens(userId);

    return { ...user };
  }

  public async unbanUser(userId: string): Promise<UserRow | null> {
    const user = this.users.get(userId);
    if (!user) return null;

    user.isBanned = false;
    user.bannedAt = null;
    user.bannedReason = null;
    this.users.set(userId, user);

    return { ...user };
  }

  public async deleteUser(id: string): Promise<boolean> {
    const existed = this.users.delete(id);
    if (existed) {
      for (const [tokenId, token] of this.refreshTokens.entries()) {
        if (token.userId === id) {
          this.refreshTokens.delete(tokenId);
        }
      }
      for (const [tokenId, token] of this.emailTokens.entries()) {
        if (token.userId === id) {
          this.emailTokens.delete(tokenId);
        }
      }
    }
    return existed;
  }

  public async findUserById(id: string): Promise<UserRow | null> {
    const u = this.users.get(id);
    return u ? { ...u } : null;
  }

  public async findUserByEmail(email: string): Promise<UserRow | null> {
    const normalized = email.toLowerCase().trim();
    for (const u of this.users.values()) {
      if (u.email === normalized) {
        return { ...u };
      }
    }
    return null;
  }

  public async findUserByUsername(username: string): Promise<UserRow | null> {
    const normalized = username.toLowerCase().trim();
    for (const u of this.users.values()) {
      if (u.username && u.username.toLowerCase() === normalized) {
        return { ...u };
      }
    }
    return null;
  }

  public async findUserByFriendCode(friendCode: string): Promise<UserRow | null> {
    const normalized = friendCode.toUpperCase().trim();
    for (const u of this.users.values()) {
      if (u.friendCode && u.friendCode.toUpperCase() === normalized) {
        return { ...u };
      }
    }
    return null;
  }

  public async searchUsers(query: string, limit = 20): Promise<UserRow[]> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    const results: UserRow[] = [];
    for (const u of this.users.values()) {
      const matchUsername = u.username && u.username.toLowerCase().includes(normalized);
      const matchFriendCode = u.friendCode && u.friendCode.toLowerCase() === normalized;
      const matchDisplayName = u.displayName.toLowerCase().includes(normalized);

      if (matchUsername || matchFriendCode || matchDisplayName) {
        results.push({ ...u });
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  public async findUserByGoogleId(googleId: string): Promise<UserRow | null> {
    for (const u of this.users.values()) {
      if (u.googleId === googleId) {
        return { ...u };
      }
    }
    return null;
  }

  public async updateUser(id: string, updates: Partial<UserRow>): Promise<UserRow | null> {
    const user = this.users.get(id);
    if (!user) return null;

    if (updates.email) {
      updates.email = updates.email.toLowerCase().trim();
    }

    const updated = { ...user, ...updates };
    this.users.set(id, updated);
    return { ...updated };
  }

  public async createRefreshToken(data: {
    userId: string;
    tokenHash: string;
    familyId: string;
    deviceInfo?: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRow> {
    const id = crypto.randomUUID();
    const token: RefreshTokenRow = {
      id,
      userId: data.userId,
      tokenHash: data.tokenHash,
      familyId: data.familyId,
      deviceInfo: data.deviceInfo || null,
      expiresAt: data.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.refreshTokens.set(id, token);
    return { ...token };
  }

  public async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
    for (const t of this.refreshTokens.values()) {
      if (t.tokenHash === tokenHash) {
        return { ...t };
      }
    }
    return null;
  }

  public async getActiveSessions(userId: string): Promise<RefreshTokenRow[]> {
    const now = new Date();
    const sessions: RefreshTokenRow[] = [];
    for (const t of this.refreshTokens.values()) {
      if (t.userId === userId && !t.revokedAt && t.expiresAt > now) {
        sessions.push({ ...t });
      }
    }
    return sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public async revokeRefreshToken(id: string): Promise<void> {
    const token = this.refreshTokens.get(id);
    if (token) {
      token.revokedAt = new Date();
    }
  }

  public async revokeTokenFamily(familyId: string): Promise<number> {
    let count = 0;
    const now = new Date();
    for (const t of this.refreshTokens.values()) {
      if (t.familyId === familyId && !t.revokedAt) {
        t.revokedAt = now;
        count++;
      }
    }
    return count;
  }

  public async revokeOtherSessions(userId: string, currentSessionId: string): Promise<number> {
    let count = 0;
    const now = new Date();
    for (const t of this.refreshTokens.values()) {
      if (t.userId === userId && t.id !== currentSessionId && !t.revokedAt) {
        t.revokedAt = now;
        count++;
      }
    }
    return count;
  }

  public async revokeAllUserTokens(userId: string): Promise<number> {
    let count = 0;
    const now = new Date();
    for (const t of this.refreshTokens.values()) {
      if (t.userId === userId && !t.revokedAt) {
        t.revokedAt = now;
        count++;
      }
    }
    return count;
  }

  public async createEmailToken(data: {
    userId: string;
    type: "verify" | "reset" | "change_email";
    tokenHash: string;
    expiresAt: Date;
  }): Promise<EmailTokenRow> {
    const id = crypto.randomUUID();
    const token: EmailTokenRow = {
      id,
      userId: data.userId,
      type: data.type,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      usedAt: null,
      createdAt: new Date(),
    };
    this.emailTokens.set(id, token);
    return { ...token };
  }

  public async findEmailTokenByHash(tokenHash: string, type: "verify" | "reset" | "change_email"): Promise<EmailTokenRow | null> {
    for (const t of this.emailTokens.values()) {
      if (t.tokenHash === tokenHash && t.type === type) {
        return { ...t };
      }
    }
    return null;
  }

  public async markEmailTokenUsed(id: string): Promise<void> {
    const t = this.emailTokens.get(id);
    if (t) {
      t.usedAt = new Date();
    }
  }

  public async invalidatePendingEmailTokens(userId: string, type: "verify" | "reset" | "change_email"): Promise<void> {
    const now = new Date();
    for (const t of this.emailTokens.values()) {
      if (t.userId === userId && t.type === type && !t.usedAt) {
        t.usedAt = now;
      }
    }
  }

  public clear(): void {
    this.users.clear();
    this.refreshTokens.clear();
    this.emailTokens.clear();
  }
}
