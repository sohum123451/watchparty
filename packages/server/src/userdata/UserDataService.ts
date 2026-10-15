import {
  UserProfile,
  WatchHistoryItem,
  FavouriteItem,
  PersonalPlaylist,
  FriendCoWatchStats,
  UserDataExport,
  PlaylistItem,
  NotificationPreferences,
  UserPrivacySettings,
} from "@watchparty/shared";
import {
  WatchHistoryAddSchema,
  FavouriteAddSchema,
  CoWatchRecordSchema,
  PersonalPlaylistCreateSchema,
  PersonalPlaylistUpdateSchema,
} from "@watchparty/shared";
import { IUserDataRepository } from "./UserDataRepository.js";
import { RoomManager } from "../rooms/RoomManager.js";
import { IAuthRepository } from "../auth/db/AuthRepository.js";
import { IFriendsRepository } from "../friends/db/FriendsRepository.js";
import { INotificationRepository } from "../friends/db/NotificationRepository.js";

export class UserDataService {
  constructor(
    private readonly userDataRepo: IUserDataRepository,
    private readonly roomManager?: RoomManager,
    private readonly authRepo?: IAuthRepository,
    private readonly friendsRepo?: IFriendsRepository,
    private readonly notificationRepo?: INotificationRepository
  ) {}

  // ==========================================
  // WATCH HISTORY
  // ==========================================

  public async addWatchHistory(userId: string, input: unknown): Promise<WatchHistoryItem> {
    const validated = WatchHistoryAddSchema.parse(input);
    const row = await this.userDataRepo.addWatchHistory({
      userId,
      videoId: validated.videoId,
      title: validated.title,
      durationMs: validated.durationMs,
      durationWatchedMs: validated.durationWatchedMs,
      completed: validated.completed,
      thumbnailUrl: validated.thumbnailUrl,
      roomId: validated.roomId,
    });

    return {
      id: row.id,
      userId: row.userId,
      videoId: row.videoId,
      title: row.title,
      durationMs: Number(row.durationMs) || 0,
      durationWatchedMs: Number(row.durationWatchedMs) || 0,
      completed: row.completed,
      thumbnailUrl: row.thumbnailUrl ?? undefined,
      roomId: row.roomId ?? undefined,
      watchedAt: row.watchedAt.toISOString(),
    };
  }

  public async getWatchHistory(
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<{ items: WatchHistoryItem[]; total: number }> {
    const { items, total } = await this.userDataRepo.getWatchHistory(userId, limit, offset);
    return {
      items: items.map((row) => ({
        id: row.id,
        userId: row.userId,
        videoId: row.videoId,
        title: row.title,
        durationMs: Number(row.durationMs) || 0,
        durationWatchedMs: Number(row.durationWatchedMs) || 0,
        completed: row.completed,
        thumbnailUrl: row.thumbnailUrl ?? undefined,
        roomId: row.roomId ?? undefined,
        watchedAt: row.watchedAt.toISOString(),
      })),
      total,
    };
  }

  public async clearWatchHistory(userId: string): Promise<{ clearedCount: number }> {
    const count = await this.userDataRepo.clearWatchHistory(userId);
    return { clearedCount: count };
  }

  public async removeWatchHistoryItem(userId: string, id: string): Promise<boolean> {
    return this.userDataRepo.removeWatchHistoryItem(userId, id);
  }

  // ==========================================
  // FAVOURITES
  // ==========================================

  public async addFavourite(userId: string, input: unknown): Promise<FavouriteItem> {
    const validated = FavouriteAddSchema.parse(input);
    const row = await this.userDataRepo.addFavourite({
      userId,
      videoId: validated.videoId,
      title: validated.title,
      thumbnailUrl: validated.thumbnailUrl,
      durationMs: validated.durationMs,
    });

    return {
      id: row.id,
      userId: row.userId,
      videoId: row.videoId,
      title: row.title,
      thumbnailUrl: row.thumbnailUrl ?? undefined,
      durationMs: row.durationMs ? Number(row.durationMs) : undefined,
      addedAt: row.addedAt.toISOString(),
    };
  }

  public async removeFavourite(userId: string, videoId: string): Promise<boolean> {
    return this.userDataRepo.removeFavourite(userId, videoId);
  }

  public async getFavourites(
    userId: string,
    limit = 50,
    offset = 0
  ): Promise<{ items: FavouriteItem[]; total: number }> {
    const { items, total } = await this.userDataRepo.getFavourites(userId, limit, offset);
    return {
      items: items.map((row) => ({
        id: row.id,
        userId: row.userId,
        videoId: row.videoId,
        title: row.title,
        thumbnailUrl: row.thumbnailUrl ?? undefined,
        durationMs: row.durationMs ? Number(row.durationMs) : undefined,
        addedAt: row.addedAt.toISOString(),
      })),
      total,
    };
  }

  public async isFavourite(userId: string, videoId: string): Promise<boolean> {
    return this.userDataRepo.isFavourite(userId, videoId);
  }

  // ==========================================
  // CO-WATCHING STATS
  // ==========================================

  public async recordCoWatchSession(userId: string, input: unknown): Promise<void> {
    const validated = CoWatchRecordSchema.parse(input);
    await this.userDataRepo.recordCoWatchSession({
      userId,
      friendUserId: validated.friendUserId,
      friendDisplayName: validated.friendDisplayName,
      videoId: validated.videoId,
      videoTitle: validated.videoTitle,
      durationWatchedMs: validated.durationWatchedMs,
      roomId: validated.roomId,
    });
  }

  public async getCoWatchStats(userId: string, friendUserId?: string): Promise<FriendCoWatchStats[]> {
    return this.userDataRepo.getCoWatchStats(userId, friendUserId);
  }

  // ==========================================
  // PERSONAL PLAYLISTS
  // ==========================================

  public async createPlaylist(userId: string, input: unknown): Promise<PersonalPlaylist> {
    const validated = PersonalPlaylistCreateSchema.parse(input);
    const row = await this.userDataRepo.createPlaylist(userId, {
      title: validated.title,
      description: validated.description,
      isPublic: validated.isPublic,
      items: validated.items as PlaylistItem[],
    });

    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      description: row.description ?? undefined,
      isPublic: row.isPublic,
      items: JSON.parse(row.items) as PlaylistItem[],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  public async getUserPlaylists(userId: string): Promise<PersonalPlaylist[]> {
    const rows = await this.userDataRepo.getUserPlaylists(userId);
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      title: row.title,
      description: row.description ?? undefined,
      isPublic: row.isPublic,
      items: JSON.parse(row.items) as PlaylistItem[],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  public async getPlaylistById(playlistId: string, requestingUserId?: string): Promise<PersonalPlaylist | null> {
    const row = await this.userDataRepo.getPlaylistById(playlistId);
    if (!row) return null;
    if (!row.isPublic && (!requestingUserId || row.userId !== requestingUserId)) {
      return null;
    }
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      description: row.description ?? undefined,
      isPublic: row.isPublic,
      items: JSON.parse(row.items) as PlaylistItem[],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  public async updatePlaylist(userId: string, playlistId: string, input: unknown): Promise<PersonalPlaylist | null> {
    const validated = PersonalPlaylistUpdateSchema.parse(input);
    const row = await this.userDataRepo.updatePlaylist(playlistId, userId, {
      title: validated.title,
      description: validated.description,
      isPublic: validated.isPublic,
      items: validated.items as PlaylistItem[] | undefined,
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      description: row.description ?? undefined,
      isPublic: row.isPublic,
      items: JSON.parse(row.items) as PlaylistItem[],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  public async deletePlaylist(userId: string, playlistId: string): Promise<boolean> {
    return this.userDataRepo.deletePlaylist(playlistId, userId);
  }

  public async loadPlaylistIntoRoom(
    userId: string,
    playlistId: string,
    roomIdOrCode: string,
    mode: "replace" | "append" = "append"
  ): Promise<{ success: boolean; itemCount: number; message?: string }> {
    const playlist = await this.getPlaylistById(playlistId, userId);
    if (!playlist) {
      throw new Error("Playlist not found or access denied");
    }

    if (!this.roomManager) {
      throw new Error("RoomManager is not configured on UserDataService");
    }

    const room = this.roomManager.getRoomById(roomIdOrCode) || this.roomManager.getRoomByCode(roomIdOrCode);
    if (!room) {
      throw new Error(`Room not found: ${roomIdOrCode}`);
    }

    const result = room.loadPlaylist(userId, Date.now(), playlist.items, mode);
    if (!result.success) {
      throw new Error(result.message || "Failed to load playlist into room");
    }

    return {
      success: true,
      itemCount: playlist.items.length,
    };
  }

  // ==========================================
  // DATA TAKEOUT & CASCADE DELETION
  // ==========================================

  public async exportUserData(userId: string): Promise<UserDataExport> {
    if (!this.authRepo) {
      throw new Error("AuthRepository not configured on UserDataService");
    }

    const user = await this.authRepo.findUserById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    let notifPrefs: NotificationPreferences = {
      inApp: {
        friendRequests: true,
        roomInvites: true,
        chatMentions: true,
        coWatchMilestones: true,
      },
      emailDigest: "weekly",
    };
    if (user.notificationPreferences) {
      try {
        notifPrefs = JSON.parse(user.notificationPreferences);
      } catch {
        // use default
      }
    }

    const privacy: UserPrivacySettings = {
      presence: user.presencePrivacy as any,
      whoCanFriendMe: user.whoCanFriendMe as any,
      whoCanInviteMe: user.whoCanInviteMe as any,
    };

    const activeSessions = (await this.authRepo.getActiveSessions(userId)).map((s) => ({
      id: s.id,
      familyId: s.familyId,
      deviceInfo: s.deviceInfo ?? undefined,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }));

    const takeout = await this.userDataRepo.getUserTakeoutData(userId);

    const history: WatchHistoryItem[] = takeout.history.map((h) => ({
      id: h.id,
      userId: h.userId,
      videoId: h.videoId,
      title: h.title,
      durationMs: Number(h.durationMs) || 0,
      durationWatchedMs: Number(h.durationWatchedMs) || 0,
      completed: h.completed,
      thumbnailUrl: h.thumbnailUrl ?? undefined,
      roomId: h.roomId ?? undefined,
      watchedAt: h.watchedAt.toISOString(),
    }));

    const favourites: FavouriteItem[] = takeout.favourites.map((f) => ({
      id: f.id,
      userId: f.userId,
      videoId: f.videoId,
      title: f.title,
      thumbnailUrl: f.thumbnailUrl ?? undefined,
      durationMs: f.durationMs ? Number(f.durationMs) : undefined,
      addedAt: f.addedAt.toISOString(),
    }));

    const playlists: PersonalPlaylist[] = takeout.playlists.map((p) => ({
      id: p.id,
      userId: p.userId,
      title: p.title,
      description: p.description ?? undefined,
      isPublic: p.isPublic,
      items: JSON.parse(p.items) as PlaylistItem[],
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    }));

    const coWatchStats = await this.getCoWatchStats(userId);

    let friends: any[] = [];
    if (this.friendsRepo) {
      const friendships = await this.friendsRepo.getUserFriendships(userId);
      friends = friendships.map((f) => ({
        id: f.id,
        user1Id: f.user1Id,
        user2Id: f.user2Id,
        requesterId: f.requesterId,
        addresseeId: f.addresseeId,
        status: f.status,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      }));
    }

    const profile: UserProfile = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      username: user.username ?? undefined,
      friendCode: user.friendCode,
      bio: user.bio ?? undefined,
      avatar: user.avatar ?? undefined,
      privacySettings: privacy,
      notificationPreferences: notifPrefs,
      createdAt: user.createdAt.toISOString(),
      isEmailVerified: Boolean(user.emailVerifiedAt),
    };

    return {
      exportedAt: new Date().toISOString(),
      profile,
      privacySettings: privacy,
      notificationPreferences: notifPrefs,
      watchHistory: history,
      favourites,
      personalPlaylists: playlists,
      friends,
      coWatchStats,
      activeSessions,
    };
  }

  public async deleteAccountData(userId: string): Promise<void> {
    // 1. Delete user-specific records (history, favourites, co-watch, playlists)
    await this.userDataRepo.deleteAllUserData(userId);

    // 2. Cascade friendships if repository configured
    if (this.friendsRepo) {
      await this.friendsRepo.deleteAllUserFriendships(userId);
    }

    // 3. Cascade notifications if repository configured
    if (this.notificationRepo) {
      await this.notificationRepo.deleteAllUserNotifications(userId);
    }

    // 4. Anonymize chat messages across active rooms and kick connections
    if (this.roomManager) {
      this.roomManager.anonymizeUserAcrossRooms(userId);
    }
  }
}
