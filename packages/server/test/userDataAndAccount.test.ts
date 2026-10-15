import { describe, it, expect, beforeEach } from "vitest";
import { MemoryAuthRepository } from "../src/auth/db/AuthRepository.js";
import { ConsoleMailer } from "../src/auth/mailer/Mailer.js";
import { AuthService } from "../src/auth/services/AuthService.js";
import { MemoryUserDataRepository } from "../src/userdata/UserDataRepository.js";
import { UserDataService } from "../src/userdata/UserDataService.js";
import { MemoryFriendsRepository } from "../src/friends/db/FriendsRepository.js";
import { MemoryNotificationRepository } from "../src/friends/db/NotificationRepository.js";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { TokenSecurity } from "../src/auth/crypto/tokens.js";
import {
  validateImageSignature,
  sanitizeAndReencodeImage,
  MAX_AVATAR_SIZE_BYTES,
} from "../src/storage/ObjectStorageService.js";

describe("User Profile, Account Management, and Co-Watching System", () => {
  let authRepo: MemoryAuthRepository;
  let userDataRepo: MemoryUserDataRepository;
  let friendsRepo: MemoryFriendsRepository;
  let notifRepo: MemoryNotificationRepository;
  let mailer: ConsoleMailer;
  let roomManager: RoomManager;
  let authService: AuthService;
  let userDataService: UserDataService;

  beforeEach(() => {
    authRepo = new MemoryAuthRepository();
    userDataRepo = new MemoryUserDataRepository();
    friendsRepo = new MemoryFriendsRepository();
    notifRepo = new MemoryNotificationRepository();
    mailer = new ConsoleMailer();
    roomManager = new RoomManager("http://localhost:3000");

    authService = new AuthService({
      repo: authRepo,
      mailer,
      baseUrl: "http://localhost:3000",
    });

    userDataService = new UserDataService(
      userDataRepo,
      roomManager,
      authRepo,
      friendsRepo,
      notifRepo
    );
  });

  // Helper to create a valid minimal PNG image buffer
  function createValidPngBuffer(): Buffer {
    // PNG 8-byte header: 89 50 4E 47 0D 0A 1A 0A followed by IHDR chunk
    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const rest = Buffer.from("IHDR000000000000IDATx563456IEND");
    return Buffer.concat([header, rest]);
  }

  // Helper to create a valid minimal JPEG image buffer
  function createValidJpegBuffer(): Buffer {
    // JPEG header: FF D8 FF E0 00 10 4A 46 49 46 00 01
    return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  }

  describe("1. Profile & Avatar Upload", () => {
    it("updates display name, bio, privacy settings, and notification preferences", async () => {
      const session = await authService.signup({
        email: "alice@example.com",
        password: "Password123!",
        displayName: "Alice",
      });

      const initialProfile = await authService.getProfile(session.user.id);
      expect(initialProfile.displayName).toBe("Alice");
      expect(initialProfile.privacySettings.presence).toBe("friends");
      expect(initialProfile.privacySettings.whoCanFriendMe).toBe("everyone");
      expect(initialProfile.privacySettings.whoCanInviteMe).toBe("everyone");

      const updated = await authService.updateProfile(session.user.id, {
        displayName: "Alice In Wonderland",
        bio: "Movie buff and anime fan!",
        privacySettings: {
          presence: "nobody",
          whoCanFriendMe: "friends_of_friends",
          whoCanInviteMe: "friends_only",
        },
        notificationPreferences: {
          inApp: {
            friendRequests: true,
            roomInvites: false,
            chatMentions: true,
            coWatchMilestones: false,
          },
          emailDigest: "daily",
        },
      });

      expect(updated.displayName).toBe("Alice In Wonderland");
      expect(updated.bio).toBe("Movie buff and anime fan!");
      expect(updated.privacySettings.presence).toBe("nobody");
      expect(updated.privacySettings.whoCanFriendMe).toBe("friends_of_friends");
      expect(updated.privacySettings.whoCanInviteMe).toBe("friends_only");
      expect(updated.notificationPreferences.emailDigest).toBe("daily");
      expect(updated.notificationPreferences.inApp.roomInvites).toBe(false);
      expect(updated.notificationPreferences.inApp.coWatchMilestones).toBe(false);
    });

    it("validates avatar MIME type and signature, re-encodes, and stores in object storage", async () => {
      const session = await authService.signup({
        email: "bob@example.com",
        password: "Password123!",
        displayName: "Bob",
      });

      const pngBuffer = createValidPngBuffer();
      const uploadResult = await authService.uploadAvatar(session.user.id, pngBuffer, "image/png");

      expect(uploadResult.avatarUrl).toContain("/api/storage/avatars/");
      expect(uploadResult.mimeType).toBe("image/png");

      // Verify file is readable from object storage
      const storage = authService.getObjectStorage();
      const filename = uploadResult.avatarUrl.split("/").pop()!;
      const stored = await storage.getFile("avatars", filename);
      expect(stored).not.toBeNull();
      expect(stored?.contentType).toBe("image/png");

      // Verify profile has updated avatar URL
      const profile = await authService.getProfile(session.user.id);
      expect(profile.avatar).toBe(uploadResult.avatarUrl);
    });

    it("rejects avatar exceeding size limit (5MB)", async () => {
      const session = await authService.signup({
        email: "heavy@example.com",
        password: "Password123!",
        displayName: "Heavy",
      });

      const oversizedBuffer = Buffer.alloc(MAX_AVATAR_SIZE_BYTES + 1024, 0xff);
      await expect(
        authService.uploadAvatar(session.user.id, oversizedBuffer, "image/jpeg")
      ).rejects.toThrow(/exceeds/);
    });

    it("rejects invalid MIME types and spoofed magic bytes", async () => {
      const session = await authService.signup({
        email: "hacker@example.com",
        password: "Password123!",
        displayName: "Hacker",
      });

      // Text file masquerading as image
      const textBuffer = Buffer.from("Hello world, I am not an image file");
      await expect(
        authService.uploadAvatar(session.user.id, textBuffer, "image/png")
      ).rejects.toThrow(/Invalid image format/);
    });

    it("detects and strips malicious embedded script/XSS payloads in image buffers", async () => {
      const session = await authService.signup({
        email: "xss@example.com",
        password: "Password123!",
        displayName: "XSS",
      });

      const evilJpeg = Buffer.concat([
        createValidJpegBuffer(),
        Buffer.from("<script>alert('pwned')</script>"),
      ]);

      await expect(
        authService.uploadAvatar(session.user.id, evilJpeg, "image/jpeg")
      ).rejects.toThrow(/Malicious script or HTML payload/);
    });
  });

  describe("2. Watch History and Favourites", () => {
    it("tracks watch history with completion tracking and pagination", async () => {
      const session = await authService.signup({
        email: "watcher@example.com",
        password: "Password123!",
        displayName: "Watcher",
      });

      await userDataService.addWatchHistory(session.user.id, {
        videoId: "vid_inception",
        title: "Inception",
        durationMs: 8880000,
        durationWatchedMs: 8880000,
        completed: true,
        thumbnailUrl: "https://example.com/inception.jpg",
        roomId: "room_123",
      });

      await userDataService.addWatchHistory(session.user.id, {
        videoId: "vid_interstellar",
        title: "Interstellar",
        durationMs: 10140000,
        durationWatchedMs: 5000000,
        completed: false,
      });

      const history = await userDataService.getWatchHistory(session.user.id, 10, 0);
      expect(history.total).toBe(2);
      const inception = history.items.find((i) => i.videoId === "vid_inception");
      const interstellar = history.items.find((i) => i.videoId === "vid_interstellar");
      expect(inception?.completed).toBe(true);
      expect(interstellar?.completed).toBe(false);

      // Remove specific history item
      await userDataService.removeWatchHistoryItem(session.user.id, interstellar!.id);
      const afterDelete = await userDataService.getWatchHistory(session.user.id);
      expect(afterDelete.total).toBe(1);
      expect(afterDelete.items[0].videoId).toBe("vid_inception");

      // Clear all history
      await userDataService.clearWatchHistory(session.user.id);
      const cleared = await userDataService.getWatchHistory(session.user.id);
      expect(cleared.total).toBe(0);
    });

    it("manages user favourites list", async () => {
      const session = await authService.signup({
        email: "favs@example.com",
        password: "Password123!",
        displayName: "Favs",
      });

      await userDataService.addFavourite(session.user.id, {
        videoId: "vid_matrix",
        title: "The Matrix",
        durationMs: 8160000,
      });

      expect(await userDataService.isFavourite(session.user.id, "vid_matrix")).toBe(true);
      expect(await userDataService.isFavourite(session.user.id, "vid_avatar")).toBe(false);

      const favs = await userDataService.getFavourites(session.user.id);
      expect(favs.total).toBe(1);
      expect(favs.items[0].title).toBe("The Matrix");

      // Remove from favourites
      await userDataService.removeFavourite(session.user.id, "vid_matrix");
      expect(await userDataService.isFavourite(session.user.id, "vid_matrix")).toBe(false);
    });
  });

  describe("3. Watched Together with <friend> Stats", () => {
    it("aggregates co-watching duration, sessions count, and video breakdown for friends", async () => {
      const userA = await authService.signup({
        email: "usera@example.com",
        password: "Password123!",
        displayName: "UserA",
      });

      const userB = await authService.signup({
        email: "userb@example.com",
        password: "Password123!",
        displayName: "UserB",
      });

      const userC = await authService.signup({
        email: "userc@example.com",
        password: "Password123!",
        displayName: "UserC",
      });

      // Session 1: A and B watch Pulp Fiction for 30 mins
      await userDataService.recordCoWatchSession(userA.user.id, {
        friendUserId: userB.user.id,
        friendDisplayName: "UserB",
        videoId: "vid_pulp_fiction",
        videoTitle: "Pulp Fiction",
        durationWatchedMs: 1800000,
        roomId: "room_cult_classics",
      });

      // Session 2: A and B watch Pulp Fiction again for 20 mins
      await userDataService.recordCoWatchSession(userA.user.id, {
        friendUserId: userB.user.id,
        friendDisplayName: "UserB",
        videoId: "vid_pulp_fiction",
        videoTitle: "Pulp Fiction",
        durationWatchedMs: 1200000,
        roomId: "room_cult_classics",
      });

      // Session 3: A and B watch Fight Club for 60 mins
      await userDataService.recordCoWatchSession(userA.user.id, {
        friendUserId: userB.user.id,
        friendDisplayName: "UserB",
        videoId: "vid_fight_club",
        videoTitle: "Fight Club",
        durationWatchedMs: 3600000,
        roomId: "room_cult_classics",
      });

      // Session 4: A and C watch Dune for 45 mins
      await userDataService.recordCoWatchSession(userA.user.id, {
        friendUserId: userC.user.id,
        friendDisplayName: "UserC",
        videoId: "vid_dune",
        videoTitle: "Dune",
        durationWatchedMs: 2700000,
      });

      // Get all friend co-watch stats for UserA
      const allStats = await userDataService.getCoWatchStats(userA.user.id);
      expect(allStats.length).toBe(2);

      // Top friend should be UserB (6600000 ms total watch time)
      const bStats = allStats[0];
      expect(bStats.friendUserId).toBe(userB.user.id);
      expect(bStats.totalCoWatchDurationMs).toBe(6600000);
      expect(bStats.totalSessionsCount).toBe(3);
      expect(bStats.videosWatchedTogether.length).toBe(2);

      // Pulp Fiction watched twice for 3000000ms
      const pulpSummary = bStats.videosWatchedTogether.find((v) => v.videoId === "vid_pulp_fiction");
      expect(pulpSummary).toBeDefined();
      expect(pulpSummary?.sessionsCount).toBe(2);
      expect(pulpSummary?.totalDurationWatchedMs).toBe(3000000);

      // Query single friend directly
      const specificStats = await userDataService.getCoWatchStats(userA.user.id, userC.user.id);
      expect(specificStats.length).toBe(1);
      expect(specificStats[0].totalCoWatchDurationMs).toBe(2700000);
      expect(specificStats[0].videosWatchedTogether[0].title).toBe("Dune");
    });
  });

  describe("4. Saved Personal Playlists and Loading Into Room", () => {
    it("creates, retrieves, updates, and deletes personal playlists", async () => {
      const session = await authService.signup({
        email: "curator@example.com",
        password: "Password123!",
        displayName: "Curator",
      });

      const playlist = await userDataService.createPlaylist(session.user.id, {
        title: "Sci-Fi Weekend",
        description: "Best mind-bending movies",
        isPublic: true,
        items: [
          { videoId: "v1", title: "Blade Runner 2049", durationMs: 9800000 },
          { videoId: "v2", title: "Arrival", durationMs: 6960000 },
        ],
      });

      expect(playlist.id).toBeDefined();
      expect(playlist.items.length).toBe(2);

      const userPlaylists = await userDataService.getUserPlaylists(session.user.id);
      expect(userPlaylists.length).toBe(1);
      expect(userPlaylists[0].title).toBe("Sci-Fi Weekend");

      // Update playlist
      const updated = await userDataService.updatePlaylist(session.user.id, playlist.id, {
        title: "Ultimate Sci-Fi Weekend",
        items: [
          { videoId: "v1", title: "Blade Runner 2049", durationMs: 9800000 },
          { videoId: "v2", title: "Arrival", durationMs: 6960000 },
          { videoId: "v3", title: "Interstellar", durationMs: 10140000 },
        ],
      });
      expect(updated?.title).toBe("Ultimate Sci-Fi Weekend");
      expect(updated?.items.length).toBe(3);

      // Delete playlist
      const deleted = await userDataService.deletePlaylist(session.user.id, playlist.id);
      expect(deleted).toBe(true);
      expect(await userDataService.getUserPlaylists(session.user.id)).toHaveLength(0);
    });

    it("loads personal playlist directly into an active room in both append and replace modes", async () => {
      const session = await authService.signup({
        email: "dj@example.com",
        password: "Password123!",
        displayName: "DJ",
      });

      // Create playlist
      const playlist = await userDataService.createPlaylist(session.user.id, {
        title: "Anime Night",
        items: [
          { videoId: "vid_spirited_away", title: "Spirited Away", durationMs: 7500000 },
          { videoId: "vid_mononoke", title: "Princess Mononoke", durationMs: 8040000 },
        ],
      });

      // Create an active room where DJ is host
      const { room } = roomManager.createRoom({
        hostUserName: "DJ",
        roomName: "Ghibli Marathon",
        hostAccountId: session.user.id,
      });

      // 1. Load playlist in replace mode
      const loadResult = await userDataService.loadPlaylistIntoRoom(
        session.user.id,
        playlist.id,
        room.roomId,
        "replace"
      );
      expect(loadResult.success).toBe(true);
      expect(loadResult.itemCount).toBe(2);
      expect(room.playlist.length).toBe(2);
      expect(room.playlist[0].videoId).toBe("vid_spirited_away");
      expect(room.playlist[1].videoId).toBe("vid_mononoke");

      // 2. Create another playlist and append it
      const extraPlaylist = await userDataService.createPlaylist(session.user.id, {
        title: "More Anime",
        items: [{ videoId: "vid_howl", title: "Howl's Moving Castle", durationMs: 7140000 }],
      });

      const appendResult = await userDataService.loadPlaylistIntoRoom(
        session.user.id,
        extraPlaylist.id,
        room.roomId,
        "append"
      );
      expect(appendResult.success).toBe(true);
      expect(room.playlist.length).toBe(3);
      expect(room.playlist[2].videoId).toBe("vid_howl");
    });
  });

  describe("5. Account Settings & Security Lifecycle", () => {
    it("handles email change with re-verification flow", async () => {
      const session = await authService.signup({
        email: "oldemail@example.com",
        password: "Password123!",
        displayName: "EmailChanger",
      });

      // Request email change
      const reqResult = await authService.requestEmailChange(session.user.id, {
        newEmail: "newemail@example.com",
        password: "Password123!",
      });
      expect(reqResult.message).toContain("newemail@example.com");

      // Inspect sent verification email
      const latestEmail = mailer.getLatestEmailFor("newemail@example.com");
      expect(latestEmail).toBeDefined();
      expect(latestEmail?.url).toContain("token=");

      // Extract raw token from URL
      const url = new URL(latestEmail!.url);
      const rawToken = url.searchParams.get("token")!;

      // Confirm change
      const confirmResult = await authService.confirmEmailChange(rawToken);
      expect(confirmResult.success).toBe(true);
      expect(confirmResult.user.email).toBe("newemail@example.com");

      // Verify database updated
      const profile = await authService.getProfile(session.user.id);
      expect(profile.email).toBe("newemail@example.com");
      expect(profile.isEmailVerified).toBe(true);
    });

    it("changes password with Argon2id and revokes other sessions while keeping current session active", async () => {
      // 1. User signs up on Laptop (Session 1)
      const laptopSession = await authService.signup({
        email: "security@example.com",
        password: "OldPassword123!",
        displayName: "SecurityFan",
        deviceInfo: "Chrome on macOS Laptop",
      });

      // 2. User logs in on Phone (Session 2)
      const phoneSession = await authService.login({
        email: "security@example.com",
        password: "OldPassword123!",
        deviceInfo: "Safari on iPhone",
      });

      // 3. User logs in on Tablet (Session 3)
      const tabletSession = await authService.login({
        email: "security@example.com",
        password: "OldPassword123!",
        deviceInfo: "Firefox on iPad",
      });

      const initialSessions = await authService.getActiveSessions(
        laptopSession.user.id,
        laptopSession.refreshToken
      );
      expect(initialSessions.length).toBe(3);
      expect(initialSessions.find((s) => s.isCurrent)?.deviceInfo).toBe("Chrome on macOS Laptop");

      // 4. User changes password on Laptop, providing Laptop refresh token
      const changeRes = await authService.changePassword(
        laptopSession.user.id,
        laptopSession.refreshToken,
        {
          currentPassword: "OldPassword123!",
          newPassword: "NewSuperPassword999!",
        }
      );

      expect(changeRes.success).toBe(true);
      expect(changeRes.revokedSessionsCount).toBe(2); // Phone and Tablet revoked

      // 5. Verify Phone & Tablet sessions can no longer refresh
      await expect(authService.refresh(phoneSession.refreshToken)).rejects.toThrow();
      await expect(authService.refresh(tabletSession.refreshToken)).rejects.toThrow();

      // 6. Verify Laptop session is still valid
      const laptopRefreshed = await authService.refresh(laptopSession.refreshToken);
      expect(laptopRefreshed.accessToken).toBeDefined();

      // 7. Verify new password works for login
      const newLogin = await authService.login({
        email: "security@example.com",
        password: "NewSuperPassword999!",
      });
      expect(newLogin.accessToken).toBeDefined();
    });

    it("allows listing active sessions and revoking an individual session", async () => {
      const session1 = await authService.signup({
        email: "multidevice@example.com",
        password: "Password123!",
        displayName: "MultiDevice",
        deviceInfo: "Desktop PC",
      });

      const session2 = await authService.login({
        email: "multidevice@example.com",
        password: "Password123!",
        deviceInfo: "Work Laptop",
      });

      const sessions = await authService.getActiveSessions(session1.user.id, session1.refreshToken);
      expect(sessions.length).toBe(2);

      const workLaptopSession = sessions.find((s) => s.deviceInfo === "Work Laptop")!;
      await authService.revokeSession(session1.user.id, workLaptopSession.id);

      // Verify work laptop can't refresh
      await expect(authService.refresh(session2.refreshToken)).rejects.toThrow();

      // Desktop PC still active
      const remainingSessions = await authService.getActiveSessions(session1.user.id);
      expect(remainingSessions.length).toBe(1);
      expect(remainingSessions[0].deviceInfo).toBe("Desktop PC");
    });

    it("exports complete user data bundle (GDPR / Takeout)", async () => {
      const user = await authService.signup({
        email: "exportme@example.com",
        password: "Password123!",
        displayName: "ExportMe",
      });

      // Add watch history, favourite, and playlist
      await userDataService.addWatchHistory(user.user.id, {
        videoId: "v_101",
        title: "Test Movie",
        durationMs: 5000,
        completed: true,
      });

      await userDataService.addFavourite(user.user.id, {
        videoId: "v_101",
        title: "Test Movie",
      });

      await userDataService.createPlaylist(user.user.id, {
        title: "My Takeout List",
        items: [{ videoId: "v_101", title: "Test Movie", durationMs: 5000 }],
      });

      const exportBundle = await userDataService.exportUserData(user.user.id);
      expect(exportBundle.exportedAt).toBeDefined();
      expect(exportBundle.profile.email).toBe("exportme@example.com");
      expect(exportBundle.watchHistory.length).toBe(1);
      expect(exportBundle.favourites.length).toBe(1);
      expect(exportBundle.personalPlaylists.length).toBe(1);
      expect(exportBundle.activeSessions.length).toBe(1);
    });

    it("deletes account: cascades all data, anonymizes chat in active rooms to [Deleted User], and removes credentials", async () => {
      const user = await authService.signup({
        email: "deletevictim@example.com",
        password: "DeleteMePassword123!",
        displayName: "GoodbyeFriend",
      });

      // Populate history, playlist, favourite
      await userDataService.addWatchHistory(user.user.id, {
        videoId: "v_del",
        title: "Farewell Film",
      });
      await userDataService.addFavourite(user.user.id, {
        videoId: "v_del",
        title: "Farewell Film",
      });
      await userDataService.createPlaylist(user.user.id, {
        title: "Goodbye Playlist",
        items: [],
      });

      // Create an active room with chat messages from this user
      const { room } = roomManager.createRoom({
        hostUserName: "HostUser",
        roomName: "Active Lounge",
      });

      // Join user to room and post a chat message
      const joinRes = room.addMember("GoodbyeFriend", undefined, undefined, {
        accountId: user.user.id,
      }) as { success: true; member: any; sessionToken: string };

      const postRes = room.broadcastChat(joinRes.member.userId, 1, "Hey everyone, was nice watching with you!");
      expect(postRes.success).toBe(true);

      // Verify message author in room is GoodbyeFriend
      const userMsg = room.chatHistory.find((m) => m.userId === joinRes.member.userId);
      expect(userMsg).toBeDefined();
      expect(userMsg?.userName).toBe("GoodbyeFriend");

      // Delete account
      const delResult = await authService.deleteAccount(
        user.user.id,
        { password: "DeleteMePassword123!" },
        userDataService
      );
      expect(delResult.success).toBe(true);

      // 1. Room message author must be anonymized to "[Deleted User]"
      expect(userMsg?.userName).toBe("[Deleted User]");

      // 2. Member must be removed from room
      expect(room.getMember(joinRes.member.userId)).toBeUndefined();

      // 3. Cascaded user records must be cleared
      const history = await userDataService.getWatchHistory(user.user.id);
      expect(history.total).toBe(0);

      const favs = await userDataService.getFavourites(user.user.id);
      expect(favs.total).toBe(0);

      const playlists = await userDataService.getUserPlaylists(user.user.id);
      expect(playlists.length).toBe(0);

      // 4. User cannot log in anymore
      await expect(
        authService.login({
          email: "deletevictim@example.com",
          password: "DeleteMePassword123!",
        })
      ).rejects.toThrow(/Invalid email or password/);
    });
  });
});
