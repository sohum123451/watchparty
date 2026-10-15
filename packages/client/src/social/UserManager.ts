import {
  UserProfile,
  UserProfileUpdate,
  ActiveSession,
  WatchHistoryItem,
  FavouriteItem,
  FriendCoWatchStats,
  PersonalPlaylist,
  UserDataExport,
  PlaylistItem,
} from "@watchparty/shared";

export interface UserManagerOptions {
  baseUrl?: string;
  accessToken?: string;
  refreshToken?: string;
}

export class UserManager {
  private baseUrl: string;
  private accessToken?: string;
  private refreshToken?: string;

  public profile?: UserProfile;
  public watchHistory: WatchHistoryItem[] = [];
  public favourites: FavouriteItem[] = [];
  public playlists: PersonalPlaylist[] = [];
  public coWatchStats: FriendCoWatchStats[] = [];

  constructor(options: UserManagerOptions = {}) {
    this.baseUrl = (options.baseUrl || "http://localhost:3001").replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
  }

  public setAccessToken(token?: string): void {
    this.accessToken = token;
  }

  public setRefreshToken(token?: string): void {
    this.refreshToken = token;
  }

  private getHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      ...extra,
    };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    if (this.refreshToken) {
      headers["x-refresh-token"] = this.refreshToken;
    }
    return headers;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = this.getHeaders(
      (options.headers as Record<string, string>) || { "Content-Type": "application/json" }
    );

    const res = await fetch(url, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error: any = new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
      error.status = res.status;
      error.details = data.details;
      throw error;
    }

    return data as T;
  }

  // ==========================================
  // PROFILE & AVATAR
  // ==========================================

  public async getProfile(): Promise<UserProfile> {
    const res = await this.request<{ profile: UserProfile }>("/api/user/profile");
    this.profile = res.profile;
    return res.profile;
  }

  public async updateProfile(updates: UserProfileUpdate): Promise<UserProfile> {
    const res = await this.request<{ profile: UserProfile }>("/api/user/profile", {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    this.profile = res.profile;
    return res.profile;
  }

  public async uploadAvatar(
    imageBase64: string,
    mimeType: string
  ): Promise<{ avatarUrl: string; size: number; mimeType: string }> {
    const res = await this.request<{ avatarUrl: string; size: number; mimeType: string }>(
      "/api/user/avatar",
      {
        method: "POST",
        body: JSON.stringify({ imageBase64, mimeType }),
      }
    );
    if (this.profile) {
      this.profile.avatar = res.avatarUrl;
    }
    return res;
  }

  // ==========================================
  // ACCOUNT SETTINGS & SECURITY
  // ==========================================

  public async requestEmailChange(
    newEmail: string,
    password: string
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>("/api/user/email/change", {
      method: "POST",
      body: JSON.stringify({ newEmail, password }),
    });
  }

  public async confirmEmailChange(
    token: string
  ): Promise<{ success: boolean; user: any }> {
    return this.request<{ success: boolean; user: any }>("/api/user/email/confirm", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  public async changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; message: string; revokedSessionsCount: number }> {
    return this.request<{ success: boolean; message: string; revokedSessionsCount: number }>(
      "/api/user/password/change",
      {
        method: "POST",
        body: JSON.stringify({
          currentPassword,
          newPassword,
          currentRefreshToken: this.refreshToken,
        }),
      }
    );
  }

  public async getActiveSessions(): Promise<ActiveSession[]> {
    const res = await this.request<{ sessions: ActiveSession[] }>("/api/user/sessions");
    return res.sessions;
  }

  public async revokeSession(sessionId: string): Promise<boolean> {
    const res = await this.request<{ success: boolean }>(`/api/user/sessions/${sessionId}`, {
      method: "DELETE",
    });
    return res.success;
  }

  public async revokeOtherSessions(): Promise<number> {
    const res = await this.request<{ success: boolean; revokedCount: number }>(
      "/api/user/sessions/revoke-others",
      {
        method: "POST",
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      }
    );
    return res.revokedCount;
  }

  public async deleteAccount(password: string): Promise<{ success: boolean; message: string }> {
    const res = await this.request<{ success: boolean; message: string }>(
      "/api/user/delete-account",
      {
        method: "POST",
        body: JSON.stringify({ password }),
      }
    );
    this.profile = undefined;
    this.accessToken = undefined;
    this.refreshToken = undefined;
    return res;
  }

  public async exportData(): Promise<UserDataExport> {
    const res = await this.request<{ data: UserDataExport }>("/api/user/export-data");
    return res.data;
  }

  // ==========================================
  // WATCH HISTORY
  // ==========================================

  public async getWatchHistory(
    limit = 50,
    offset = 0
  ): Promise<{ items: WatchHistoryItem[]; total: number }> {
    const res = await this.request<{ items: WatchHistoryItem[]; total: number }>(
      `/api/user/history?limit=${limit}&offset=${offset}`
    );
    this.watchHistory = res.items;
    return res;
  }

  public async addWatchHistory(item: {
    videoId: string;
    title: string;
    durationMs?: number;
    durationWatchedMs?: number;
    completed?: boolean;
    thumbnailUrl?: string;
    roomId?: string;
  }): Promise<WatchHistoryItem> {
    const res = await this.request<{ item: WatchHistoryItem }>("/api/user/history", {
      method: "POST",
      body: JSON.stringify(item),
    });
    this.watchHistory.unshift(res.item);
    return res.item;
  }

  public async clearWatchHistory(): Promise<{ clearedCount: number }> {
    const res = await this.request<{ clearedCount: number }>("/api/user/history", {
      method: "DELETE",
    });
    this.watchHistory = [];
    return res;
  }

  public async removeWatchHistoryItem(id: string): Promise<boolean> {
    const res = await this.request<{ success: boolean }>(`/api/user/history/${id}`, {
      method: "DELETE",
    });
    if (res.success) {
      this.watchHistory = this.watchHistory.filter((h) => h.id !== id);
    }
    return res.success;
  }

  // ==========================================
  // FAVOURITES
  // ==========================================

  public async getFavourites(
    limit = 50,
    offset = 0
  ): Promise<{ items: FavouriteItem[]; total: number }> {
    const res = await this.request<{ items: FavouriteItem[]; total: number }>(
      `/api/user/favourites?limit=${limit}&offset=${offset}`
    );
    this.favourites = res.items;
    return res;
  }

  public async addFavourite(item: {
    videoId: string;
    title: string;
    thumbnailUrl?: string;
    durationMs?: number;
  }): Promise<FavouriteItem> {
    const res = await this.request<{ item: FavouriteItem }>("/api/user/favourites", {
      method: "POST",
      body: JSON.stringify(item),
    });
    this.favourites.unshift(res.item);
    return res.item;
  }

  public async removeFavourite(videoId: string): Promise<boolean> {
    const res = await this.request<{ success: boolean }>(
      `/api/user/favourites/${encodeURIComponent(videoId)}`,
      {
        method: "DELETE",
      }
    );
    if (res.success) {
      this.favourites = this.favourites.filter((f) => f.videoId !== videoId);
    }
    return res.success;
  }

  // ==========================================
  // CO-WATCHING STATS
  // ==========================================

  public async recordCoWatchSession(item: {
    friendUserId: string;
    friendDisplayName: string;
    videoId: string;
    videoTitle: string;
    durationWatchedMs: number;
    roomId?: string;
  }): Promise<void> {
    await this.request<{ success: boolean }>("/api/user/co-watch/record", {
      method: "POST",
      body: JSON.stringify(item),
    });
  }

  public async getCoWatchStats(friendUserId?: string): Promise<FriendCoWatchStats[]> {
    const query = friendUserId ? `?friendUserId=${encodeURIComponent(friendUserId)}` : "";
    const res = await this.request<{ stats: FriendCoWatchStats[] }>(
      `/api/user/stats/co-watch${query}`
    );
    this.coWatchStats = res.stats;
    return res.stats;
  }

  // ==========================================
  // PERSONAL PLAYLISTS
  // ==========================================

  public async getPlaylists(): Promise<PersonalPlaylist[]> {
    const res = await this.request<{ playlists: PersonalPlaylist[] }>("/api/user/playlists");
    this.playlists = res.playlists;
    return res.playlists;
  }

  public async createPlaylist(data: {
    title: string;
    description?: string;
    isPublic?: boolean;
    items: PlaylistItem[];
  }): Promise<PersonalPlaylist> {
    const res = await this.request<{ playlist: PersonalPlaylist }>("/api/user/playlists", {
      method: "POST",
      body: JSON.stringify(data),
    });
    this.playlists.unshift(res.playlist);
    return res.playlist;
  }

  public async getPlaylist(playlistId: string): Promise<PersonalPlaylist> {
    const res = await this.request<{ playlist: PersonalPlaylist }>(
      `/api/user/playlists/${playlistId}`
    );
    return res.playlist;
  }

  public async updatePlaylist(
    playlistId: string,
    data: {
      title?: string;
      description?: string;
      isPublic?: boolean;
      items?: PlaylistItem[];
    }
  ): Promise<PersonalPlaylist> {
    const res = await this.request<{ playlist: PersonalPlaylist }>(
      `/api/user/playlists/${playlistId}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );
    const idx = this.playlists.findIndex((p) => p.id === playlistId);
    if (idx !== -1) {
      this.playlists[idx] = res.playlist;
    }
    return res.playlist;
  }

  public async deletePlaylist(playlistId: string): Promise<boolean> {
    const res = await this.request<{ success: boolean }>(`/api/user/playlists/${playlistId}`, {
      method: "DELETE",
    });
    if (res.success) {
      this.playlists = this.playlists.filter((p) => p.id !== playlistId);
    }
    return res.success;
  }

  public async loadPlaylistIntoRoom(
    playlistId: string,
    roomId: string,
    mode: "replace" | "append" = "append"
  ): Promise<{ success: boolean; itemCount: number; message?: string }> {
    return this.request<{ success: boolean; itemCount: number; message?: string }>(
      `/api/user/playlists/${playlistId}/load-to-room`,
      {
        method: "POST",
        body: JSON.stringify({ roomId, mode }),
      }
    );
  }
}
