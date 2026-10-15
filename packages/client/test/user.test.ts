import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UserManager } from "../src/social/UserManager.js";
import { SocialClient } from "../src/social/SocialClient.js";

describe("UserManager (Client SDK)", () => {
  let userManager: UserManager;
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    userManager = new UserManager({
      baseUrl: "http://localhost:3001",
      accessToken: "fake-access-token",
      refreshToken: "fake-refresh-token",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("Profile & Avatar", () => {
    it("fetches user profile and stores in manager state", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          profile: {
            id: "u_1",
            email: "alice@example.com",
            displayName: "Alice",
            friendCode: "ALICE#1234",
            privacySettings: { presence: "friends", whoCanFriendMe: "everyone", whoCanInviteMe: "everyone" },
            notificationPreferences: {
              inApp: { friendRequests: true, roomInvites: true, chatMentions: true, coWatchMilestones: true },
              emailDigest: "weekly",
            },
            createdAt: new Date().toISOString(),
            isEmailVerified: true,
          },
        }),
      });

      const profile = await userManager.getProfile();
      expect(profile.displayName).toBe("Alice");
      expect(userManager.profile?.email).toBe("alice@example.com");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/user/profile",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer fake-access-token",
          }),
        })
      );
    });

    it("updates user profile with bio and privacy settings", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          profile: {
            id: "u_1",
            email: "alice@example.com",
            displayName: "Alice Wonderland",
            bio: "Cinema lover",
            friendCode: "ALICE#1234",
            privacySettings: { presence: "nobody", whoCanFriendMe: "friends_of_friends", whoCanInviteMe: "friends_only" },
            notificationPreferences: {
              inApp: { friendRequests: true, roomInvites: false, chatMentions: true, coWatchMilestones: false },
              emailDigest: "daily",
            },
            createdAt: new Date().toISOString(),
            isEmailVerified: true,
          },
        }),
      });

      const updated = await userManager.updateProfile({
        displayName: "Alice Wonderland",
        bio: "Cinema lover",
        privacySettings: { presence: "nobody" },
      });

      expect(updated.bio).toBe("Cinema lover");
      expect(userManager.profile?.displayName).toBe("Alice Wonderland");
    });

    it("uploads avatar and updates profile avatar url", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          avatarUrl: "http://localhost:3001/api/storage/avatars/avatar_u1_123.png",
          size: 1024,
          mimeType: "image/png",
        }),
      });

      const res = await userManager.uploadAvatar("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "image/png");
      expect(res.avatarUrl).toContain("/api/storage/avatars/");
    });
  });

  describe("Account Settings & Security", () => {
    it("requests email change and confirms with token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: "Verification email sent to new@example.com" }),
      });

      const reqRes = await userManager.requestEmailChange("new@example.com", "Password123!");
      expect(reqRes.message).toContain("new@example.com");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          user: { id: "u_1", email: "new@example.com", displayName: "Alice", isEmailVerified: true },
        }),
      });

      const confirmRes = await userManager.confirmEmailChange("sample-token-123");
      expect(confirmRes.success).toBe(true);
      expect(confirmRes.user.email).toBe("new@example.com");
    });

    it("changes password and lists/revokes active sessions", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          message: "Password changed successfully",
          revokedSessionsCount: 2,
        }),
      });

      const changeRes = await userManager.changePassword("OldPass123!", "NewPass999!");
      expect(changeRes.success).toBe(true);
      expect(changeRes.revokedSessionsCount).toBe(2);

      // List active sessions
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sessions: [
            { id: "s1", familyId: "f1", deviceInfo: "Laptop", createdAt: "2026-01-01", expiresAt: "2026-02-01", isCurrent: true },
            { id: "s2", familyId: "f2", deviceInfo: "Phone", createdAt: "2026-01-01", expiresAt: "2026-02-01", isCurrent: false },
          ],
        }),
      });

      const sessions = await userManager.getActiveSessions();
      expect(sessions.length).toBe(2);
      expect(sessions[0].isCurrent).toBe(true);

      // Revoke individual session
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const revoked = await userManager.revokeSession("s2");
      expect(revoked).toBe(true);
    });

    it("exports complete data bundle and deletes account", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            exportedAt: "2026-01-01T00:00:00.000Z",
            profile: { id: "u_1", email: "alice@example.com", displayName: "Alice" },
            watchHistory: [],
            favourites: [],
            personalPlaylists: [],
            friends: [],
            coWatchStats: [],
            activeSessions: [],
          },
        }),
      });

      const exportBundle = await userManager.exportData();
      expect(exportBundle.exportedAt).toBeDefined();

      // Delete account
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: "Account deleted" }),
      });

      const delRes = await userManager.deleteAccount("Password123!");
      expect(delRes.success).toBe(true);
      expect(userManager.profile).toBeUndefined();
    });
  });

  describe("Watch History, Favourites, and Playlists", () => {
    it("handles watch history tracking and clearing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          item: { id: "h1", userId: "u1", videoId: "v1", title: "Inception", durationMs: 1000, durationWatchedMs: 1000, completed: true, watchedAt: "2026-01-01" },
        }),
      });

      const item = await userManager.addWatchHistory({
        videoId: "v1",
        title: "Inception",
        durationMs: 1000,
        completed: true,
      });
      expect(item.title).toBe("Inception");
      expect(userManager.watchHistory.length).toBe(1);

      // Clear history
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ clearedCount: 1 }),
      });

      const clearRes = await userManager.clearWatchHistory();
      expect(clearRes.clearedCount).toBe(1);
      expect(userManager.watchHistory.length).toBe(0);
    });

    it("creates personal playlist and loads it into a room", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          playlist: {
            id: "pl_99",
            userId: "u1",
            title: "Anime Chill",
            isPublic: true,
            items: [{ videoId: "v_ghibli", title: "Totoro", durationMs: 5000 }],
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
        }),
      });

      const pl = await userManager.createPlaylist({
        title: "Anime Chill",
        items: [{ videoId: "v_ghibli", title: "Totoro", durationMs: 5000 }],
      });
      expect(pl.id).toBe("pl_99");
      expect(userManager.playlists.length).toBe(1);

      // Load into room
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, itemCount: 1 }),
      });

      const loadRes = await userManager.loadPlaylistIntoRoom("pl_99", "room_abc123", "replace");
      expect(loadRes.success).toBe(true);
      expect(loadRes.itemCount).toBe(1);
    });
  });

  describe("Integration with SocialClient", () => {
    it("attaches UserManager to SocialClient instance", () => {
      const socialClient = new SocialClient({
        user: userManager,
      });

      expect(socialClient.user).toBe(userManager);
      expect(socialClient.user.watchHistory).toBeDefined();
    });
  });
});
