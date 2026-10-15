import crypto from "node:crypto";
import {
  WatchHistoryRow,
  FavouriteRow,
  CoWatchSessionRow,
  PersonalPlaylistRow,
} from "../auth/db/schema.js";
import { PlaylistItem, FriendCoWatchStats, CoWatchedVideoSummary } from "@watchparty/shared";

export interface IUserDataRepository {
  // Watch History
  addWatchHistory(item: {
    userId: string;
    videoId: string;
    title: string;
    durationMs?: number;
    durationWatchedMs?: number;
    completed?: boolean;
    thumbnailUrl?: string | null;
    roomId?: string | null;
  }): Promise<WatchHistoryRow>;
  getWatchHistory(userId: string, limit?: number, offset?: number): Promise<{ items: WatchHistoryRow[]; total: number }>;
  clearWatchHistory(userId: string): Promise<number>;
  removeWatchHistoryItem(userId: string, id: string): Promise<boolean>;

  // Favourites
  addFavourite(item: {
    userId: string;
    videoId: string;
    title: string;
    thumbnailUrl?: string | null;
    durationMs?: number;
  }): Promise<FavouriteRow>;
  removeFavourite(userId: string, videoId: string): Promise<boolean>;
  getFavourites(userId: string, limit?: number, offset?: number): Promise<{ items: FavouriteRow[]; total: number }>;
  isFavourite(userId: string, videoId: string): Promise<boolean>;

  // Co-Watching
  recordCoWatchSession(item: {
    userId: string;
    friendUserId: string;
    friendDisplayName: string;
    videoId: string;
    videoTitle: string;
    durationWatchedMs: number;
    roomId?: string | null;
  }): Promise<CoWatchSessionRow>;
  getCoWatchSessions(userId: string, friendUserId?: string): Promise<CoWatchSessionRow[]>;
  getCoWatchStats(userId: string, friendUserId?: string): Promise<FriendCoWatchStats[]>;

  // Personal Playlists
  createPlaylist(userId: string, data: {
    title: string;
    description?: string | null;
    isPublic?: boolean;
    items: PlaylistItem[];
  }): Promise<PersonalPlaylistRow>;
  getPlaylistById(id: string): Promise<PersonalPlaylistRow | null>;
  getUserPlaylists(userId: string): Promise<PersonalPlaylistRow[]>;
  updatePlaylist(id: string, userId: string, data: Partial<{
    title: string;
    description: string | null;
    isPublic: boolean;
    items: PlaylistItem[];
  }>): Promise<PersonalPlaylistRow | null>;
  deletePlaylist(id: string, userId: string): Promise<boolean>;

  // Deletion cascade & data export
  deleteAllUserData(userId: string): Promise<void>;
  getUserTakeoutData(userId: string): Promise<{
    history: WatchHistoryRow[];
    favourites: FavouriteRow[];
    coWatchSessions: CoWatchSessionRow[];
    playlists: PersonalPlaylistRow[];
  }>;
}

export class MemoryUserDataRepository implements IUserDataRepository {
  private watchHistory: Map<string, WatchHistoryRow> = new Map();
  private favourites: Map<string, FavouriteRow> = new Map();
  private coWatchSessions: Map<string, CoWatchSessionRow> = new Map();
  private personalPlaylists: Map<string, PersonalPlaylistRow> = new Map();

  // Watch History
  public async addWatchHistory(item: {
    userId: string;
    videoId: string;
    title: string;
    durationMs?: number;
    durationWatchedMs?: number;
    completed?: boolean;
    thumbnailUrl?: string | null;
    roomId?: string | null;
  }): Promise<WatchHistoryRow> {
    const id = crypto.randomUUID();
    const row: WatchHistoryRow = {
      id,
      userId: item.userId,
      videoId: item.videoId,
      title: item.title,
      durationMs: String(item.durationMs ?? 0),
      durationWatchedMs: String(item.durationWatchedMs ?? 0),
      completed: Boolean(item.completed),
      thumbnailUrl: item.thumbnailUrl ?? null,
      roomId: item.roomId ?? null,
      watchedAt: new Date(),
    };
    this.watchHistory.set(id, row);
    return { ...row };
  }

  public async getWatchHistory(userId: string, limit = 50, offset = 0): Promise<{ items: WatchHistoryRow[]; total: number }> {
    const matching: WatchHistoryRow[] = [];
    for (const row of this.watchHistory.values()) {
      if (row.userId === userId) {
        matching.push({ ...row });
      }
    }
    // Sort descending by watchedAt
    matching.sort((a, b) => b.watchedAt.getTime() - a.watchedAt.getTime());
    const total = matching.length;
    const items = matching.slice(offset, offset + limit);
    return { items, total };
  }

  public async clearWatchHistory(userId: string): Promise<number> {
    let count = 0;
    for (const [id, row] of this.watchHistory.entries()) {
      if (row.userId === userId) {
        this.watchHistory.delete(id);
        count++;
      }
    }
    return count;
  }

  public async removeWatchHistoryItem(userId: string, id: string): Promise<boolean> {
    const row = this.watchHistory.get(id);
    if (row && row.userId === userId) {
      this.watchHistory.delete(id);
      return true;
    }
    return false;
  }

  // Favourites
  public async addFavourite(item: {
    userId: string;
    videoId: string;
    title: string;
    thumbnailUrl?: string | null;
    durationMs?: number;
  }): Promise<FavouriteRow> {
    // If already exists, return existing
    for (const row of this.favourites.values()) {
      if (row.userId === item.userId && row.videoId === item.videoId) {
        return { ...row };
      }
    }

    const id = crypto.randomUUID();
    const row: FavouriteRow = {
      id,
      userId: item.userId,
      videoId: item.videoId,
      title: item.title,
      thumbnailUrl: item.thumbnailUrl ?? null,
      durationMs: item.durationMs !== undefined ? String(item.durationMs) : null,
      addedAt: new Date(),
    };
    this.favourites.set(id, row);
    return { ...row };
  }

  public async removeFavourite(userId: string, videoId: string): Promise<boolean> {
    for (const [id, row] of this.favourites.entries()) {
      if (row.userId === userId && row.videoId === videoId) {
        this.favourites.delete(id);
        return true;
      }
    }
    return false;
  }

  public async getFavourites(userId: string, limit = 50, offset = 0): Promise<{ items: FavouriteRow[]; total: number }> {
    const matching: FavouriteRow[] = [];
    for (const row of this.favourites.values()) {
      if (row.userId === userId) {
        matching.push({ ...row });
      }
    }
    matching.sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
    const total = matching.length;
    const items = matching.slice(offset, offset + limit);
    return { items, total };
  }

  public async isFavourite(userId: string, videoId: string): Promise<boolean> {
    for (const row of this.favourites.values()) {
      if (row.userId === userId && row.videoId === videoId) {
        return true;
      }
    }
    return false;
  }

  // Co-Watching
  public async recordCoWatchSession(item: {
    userId: string;
    friendUserId: string;
    friendDisplayName: string;
    videoId: string;
    videoTitle: string;
    durationWatchedMs: number;
    roomId?: string | null;
  }): Promise<CoWatchSessionRow> {
    const id = crypto.randomUUID();
    const row: CoWatchSessionRow = {
      id,
      userId: item.userId,
      friendUserId: item.friendUserId,
      friendDisplayName: item.friendDisplayName,
      videoId: item.videoId,
      videoTitle: item.videoTitle,
      durationWatchedMs: String(item.durationWatchedMs),
      roomId: item.roomId ?? null,
      watchedAt: new Date(),
    };
    this.coWatchSessions.set(id, row);
    return { ...row };
  }

  public async getCoWatchSessions(userId: string, friendUserId?: string): Promise<CoWatchSessionRow[]> {
    const results: CoWatchSessionRow[] = [];
    for (const row of this.coWatchSessions.values()) {
      if (row.userId === userId) {
        if (!friendUserId || row.friendUserId === friendUserId) {
          results.push({ ...row });
        }
      }
    }
    return results.sort((a, b) => b.watchedAt.getTime() - a.watchedAt.getTime());
  }

  public async getCoWatchStats(userId: string, friendUserId?: string): Promise<FriendCoWatchStats[]> {
    const sessions = await this.getCoWatchSessions(userId, friendUserId);

    // Group by friendUserId
    const friendMap = new Map<
      string,
      {
        friendUserId: string;
        friendDisplayName: string;
        totalCoWatchDurationMs: number;
        totalSessionsCount: number;
        firstWatchedAt: string;
        lastWatchedAt: string;
        videosMap: Map<string, CoWatchedVideoSummary>;
      }
    >();

    for (const s of sessions) {
      const watchedAtIso = s.watchedAt.toISOString();
      let group = friendMap.get(s.friendUserId);
      if (!group) {
        group = {
          friendUserId: s.friendUserId,
          friendDisplayName: s.friendDisplayName,
          totalCoWatchDurationMs: 0,
          totalSessionsCount: 0,
          firstWatchedAt: watchedAtIso,
          lastWatchedAt: watchedAtIso,
          videosMap: new Map(),
        };
        friendMap.set(s.friendUserId, group);
      }

      const duration = Number(s.durationWatchedMs) || 0;
      group.totalCoWatchDurationMs += duration;
      group.totalSessionsCount += 1;
      if (watchedAtIso < group.firstWatchedAt) group.firstWatchedAt = watchedAtIso;
      if (watchedAtIso > group.lastWatchedAt) group.lastWatchedAt = watchedAtIso;

      const existingVideo = group.videosMap.get(s.videoId);
      if (existingVideo) {
        existingVideo.sessionsCount += 1;
        existingVideo.totalDurationWatchedMs += duration;
        if (watchedAtIso > existingVideo.lastWatchedAt) {
          existingVideo.lastWatchedAt = watchedAtIso;
        }
      } else {
        group.videosMap.set(s.videoId, {
          videoId: s.videoId,
          title: s.videoTitle,
          sessionsCount: 1,
          totalDurationWatchedMs: duration,
          lastWatchedAt: watchedAtIso,
        });
      }
    }

    const stats: FriendCoWatchStats[] = [];
    for (const group of friendMap.values()) {
      const videos = Array.from(group.videosMap.values()).sort(
        (a, b) => b.totalDurationWatchedMs - a.totalDurationWatchedMs
      );
      stats.push({
        friendUserId: group.friendUserId,
        friendDisplayName: group.friendDisplayName,
        totalCoWatchDurationMs: group.totalCoWatchDurationMs,
        totalSessionsCount: group.totalSessionsCount,
        videosWatchedTogether: videos,
        firstWatchedAt: group.firstWatchedAt,
        lastWatchedAt: group.lastWatchedAt,
      });
    }

    return stats.sort((a, b) => b.totalCoWatchDurationMs - a.totalCoWatchDurationMs);
  }

  // Personal Playlists
  public async createPlaylist(userId: string, data: {
    title: string;
    description?: string | null;
    isPublic?: boolean;
    items: PlaylistItem[];
  }): Promise<PersonalPlaylistRow> {
    const id = crypto.randomUUID();
    const now = new Date();
    const row: PersonalPlaylistRow = {
      id,
      userId,
      title: data.title,
      description: data.description ?? null,
      isPublic: data.isPublic ?? false,
      items: JSON.stringify(data.items || []),
      createdAt: now,
      updatedAt: now,
    };
    this.personalPlaylists.set(id, row);
    return { ...row };
  }

  public async getPlaylistById(id: string): Promise<PersonalPlaylistRow | null> {
    const row = this.personalPlaylists.get(id);
    return row ? { ...row } : null;
  }

  public async getUserPlaylists(userId: string): Promise<PersonalPlaylistRow[]> {
    const results: PersonalPlaylistRow[] = [];
    for (const row of this.personalPlaylists.values()) {
      if (row.userId === userId) {
        results.push({ ...row });
      }
    }
    return results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  public async updatePlaylist(id: string, userId: string, data: Partial<{
    title: string;
    description: string | null;
    isPublic: boolean;
    items: PlaylistItem[];
  }>): Promise<PersonalPlaylistRow | null> {
    const row = this.personalPlaylists.get(id);
    if (!row || row.userId !== userId) {
      return null;
    }

    if (data.title !== undefined) row.title = data.title;
    if (data.description !== undefined) row.description = data.description;
    if (data.isPublic !== undefined) row.isPublic = data.isPublic;
    if (data.items !== undefined) row.items = JSON.stringify(data.items);
    row.updatedAt = new Date();

    return { ...row };
  }

  public async deletePlaylist(id: string, userId: string): Promise<boolean> {
    const row = this.personalPlaylists.get(id);
    if (row && row.userId === userId) {
      this.personalPlaylists.delete(id);
      return true;
    }
    return false;
  }

  // Cascade Deletion
  public async deleteAllUserData(userId: string): Promise<void> {
    // Watch history
    for (const [id, row] of this.watchHistory.entries()) {
      if (row.userId === userId) {
        this.watchHistory.delete(id);
      }
    }
    // Favourites
    for (const [id, row] of this.favourites.entries()) {
      if (row.userId === userId) {
        this.favourites.delete(id);
      }
    }
    // Co-watch sessions (where user is either participant)
    for (const [id, row] of this.coWatchSessions.entries()) {
      if (row.userId === userId || row.friendUserId === userId) {
        this.coWatchSessions.delete(id);
      }
    }
    // Personal playlists
    for (const [id, row] of this.personalPlaylists.entries()) {
      if (row.userId === userId) {
        this.personalPlaylists.delete(id);
      }
    }
  }

  // Data Takeout
  public async getUserTakeoutData(userId: string): Promise<{
    history: WatchHistoryRow[];
    favourites: FavouriteRow[];
    coWatchSessions: CoWatchSessionRow[];
    playlists: PersonalPlaylistRow[];
  }> {
    const history: WatchHistoryRow[] = [];
    for (const row of this.watchHistory.values()) {
      if (row.userId === userId) history.push({ ...row });
    }

    const favourites: FavouriteRow[] = [];
    for (const row of this.favourites.values()) {
      if (row.userId === userId) favourites.push({ ...row });
    }

    const coWatchSessions: CoWatchSessionRow[] = [];
    for (const row of this.coWatchSessions.values()) {
      if (row.userId === userId) coWatchSessions.push({ ...row });
    }

    const playlists: PersonalPlaylistRow[] = [];
    for (const row of this.personalPlaylists.values()) {
      if (row.userId === userId) playlists.push({ ...row });
    }

    return { history, favourites, coWatchSessions, playlists };
  }

  public clear(): void {
    this.watchHistory.clear();
    this.favourites.clear();
    this.coWatchSessions.clear();
    this.personalPlaylists.clear();
  }
}
