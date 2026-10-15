import { describe, it, expect, beforeEach, vi } from "vitest";
import { getPrivacyPolicyHtml, getTermsOfServiceHtml } from "../src/ui/LegalPages.js";
import { Room } from "../src/rooms/Room.js";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { AuthService } from "../src/auth/services/AuthService.js";
import { MemoryAuthRepository } from "../src/auth/db/AuthRepository.js";
import { ConsoleMailer } from "../src/auth/mailer/Mailer.js";
import { UserDataService } from "../src/userdata/UserDataService.js";
import { MemoryUserDataRepository } from "../src/userdata/UserDataRepository.js";
import { MemoryFriendsRepository } from "../src/friends/db/FriendsRepository.js";
import { MemoryNotificationRepository } from "../src/friends/db/NotificationRepository.js";
import { FriendsService } from "../src/friends/services/FriendsService.js";
import { PresenceService } from "../src/friends/services/PresenceService.js";
import { WS_CLOSE_CODES, ERROR_CODES } from "@watchparty/shared";

// Mock WebSocket connection
function createMockWsConnection(userId: string) {
  const sentMessages: any[] = [];
  let closed = false;
  let closeCode: number | undefined;
  let closeReason: string | undefined;

  return {
    userId,
    readyState: 1, // WebSocket.OPEN
    once: (_event: string, _cb: () => void) => {},
    send: (data: string) => {
      try {
        sentMessages.push(JSON.parse(data));
      } catch {
        sentMessages.push(data);
      }
    },
    close: (code?: number, reason?: string) => {
      closed = true;
      closeCode = code;
      closeReason = reason;
    },
    isAlive: true,
    sentMessages,
    get isClosed() {
      return closed;
    },
    get closeCode() {
      return closeCode;
    },
    get closeReason() {
      return closeReason;
    },
  };
}

describe("Privacy Policy, Terms, Retention, and Moderation Suite", () => {
  // =========================================================================
  // 1. PLAIN-LANGUAGE PRIVACY POLICY & TERMS PAGES
  // =========================================================================
  describe("Plain-Language Legal Transparency Pages", () => {
    it("renders Privacy Policy with human-readable storage, zero-data guarantees, and deletion guides", () => {
      const html = getPrivacyPolicyHtml();

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<title>Privacy Policy - WatchParty</title>");

      // 1. What we store
      expect(html).toContain("What We Store");
      expect(html).toContain("Account Credentials");
      expect(html).toContain("Argon2id");
      expect(html).toContain("Room Chat");
      expect(html).toContain("Watch History");
      expect(html).toContain("Session Tokens");

      // 2. What we don't store (Zero-data guarantees)
      expect(html).toContain("What We DO NOT Store");
      expect(html).toContain("No Video/Audio Rehosting");
      expect(html).toContain("No Streaming Service Credentials");
      expect(html).toContain("No Advertising Trackers");
      expect(html).toContain("No Keystroke or Web Scraping");

      // 3. Retention settings
      expect(html).toContain("Chat Retention");
      expect(html).toContain("1 day, 7 days (default), 30 days, or 90 days");

      // 4. Deletion flow
      expect(html).toContain("How to Delete Your Account");
      expect(html).toContain("100% Self-Service One-Click Account Deletion");
      expect(html).toContain("[Deleted User]");
    });

    it("renders Terms of Service with community standards, room rules, and zero-rehosting architecture", () => {
      const html = getTermsOfServiceHtml();

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<title>Terms of Service - WatchParty</title>");

      // 1. Respectful community & room rules
      expect(html).toContain("Respectful Co-Watching Community");
      expect(html).toContain("Follow Room Rules");
      expect(html).toContain("Zero Tolerance for Abuse");
      expect(html).toContain("Use Moderation Tools Responsibly");

      // 2. Content rights & zero rehosting
      expect(html).toContain("Content Rights & Zero-Rehosting Architecture");
      expect(html).toContain("strictly operates as an ephemeral synchronization coordinator");

      // 3. Safety & kill switch
      expect(html).toContain("Account Safety");
      expect(html).toContain("Emergency Kill Switch");
      expect(html).toContain("Invite-Only Instances");

      // 4. Account termination
      expect(html).toContain("Termination");
      expect(html).toContain("Self-Service Account Removal");
    });
  });

  // =========================================================================
  // 2. ROOM CHAT RETENTION & AUTO-DELETION ENGINE
  // =========================================================================
  describe("Room Chat Retention Engine & Auto-Pruning", () => {
    let room: Room;
    const ONE_DAY_MS = 86400 * 1000;

    beforeEach(() => {
      room = new Room({
        roomId: "room_retention_test",
        roomCode: "RETENT",
        roomName: "Retention Test Room",
        hostUserId: "usr_host",
        hostUserName: "HostUser",
        chatRetentionDays: 7, // 7 days retention
      });
    });

    it("initializes room with default or specified chatRetentionDays", () => {
      expect(room.chatRetentionDays).toBe(7);
      const snap = room.getSnapshot();
      expect(snap.chatRetentionDays).toBe(7);

      const defaultRoom = new Room({
        roomId: "room_default_retention",
        roomCode: "DEFRET",
        roomName: "Default Retention Room",
        hostUserId: "usr_host",
        hostUserName: "HostUser",
      });
      expect(defaultRoom.chatRetentionDays).toBe(7);
    });

    it("prunes messages older than chatRetentionDays and retains newer messages", () => {
      const now = Date.now();
      room.chatHistory = [
        {
          id: "msg_old_10d",
          userId: "usr_alice",
          userName: "Alice",
          text: "Message from 10 days ago",
          serverTimestampMs: now - 10 * ONE_DAY_MS,
        },
        {
          id: "msg_old_8d",
          userId: "usr_bob",
          userName: "Bob",
          text: "Message from 8 days ago",
          serverTimestampMs: now - 8 * ONE_DAY_MS,
        },
        {
          id: "msg_recent_3d",
          userId: "usr_alice",
          userName: "Alice",
          text: "Message from 3 days ago",
          serverTimestampMs: now - 3 * ONE_DAY_MS,
        },
        {
          id: "msg_today",
          userId: "usr_charlie",
          userName: "Charlie",
          text: "Message from 1 hour ago",
          serverTimestampMs: now - 3600 * 1000,
        },
      ];

      expect(room.chatHistory.length).toBe(4);

      // Prune at reference time `now`
      const prunedCount = room.pruneExpiredChat(now);
      expect(prunedCount).toBe(2);
      expect(room.chatHistory.length).toBe(2);

      expect(room.chatHistory.map((m) => m.id)).toEqual(["msg_recent_3d", "msg_today"]);

      // Verify snapshot returns remaining messages
      const snap = room.getSnapshot();
      expect(snap.chatHistory.length).toBe(2);
      expect(snap.chatHistory.map((m) => m.id)).toEqual(["msg_recent_3d", "msg_today"]);
    });

    it("does not prune messages when chatRetentionDays is set to 0 (retention disabled / persistent)", () => {
      const now = Date.now();
      room.chatRetentionDays = 0;
      room.chatHistory = [
        {
          id: "msg_ancient",
          userId: "usr_alice",
          userName: "Alice",
          text: "Ancient chat message",
          serverTimestampMs: now - 365 * ONE_DAY_MS,
        },
      ];

      const prunedCount = room.pruneExpiredChat(now);
      expect(prunedCount).toBe(0);
      expect(room.chatHistory.length).toBe(1);
    });

    it("updates chatRetentionDays dynamically and immediately prunes newly out-of-bounds messages", () => {
      // Connect host ws to receive broadcast
      const hostWs = createMockWsConnection("usr_host");
      const host = room.getMember("usr_host");
      if (host) {
        host.connection = hostWs as any;
        host.isConnected = true;
      }

      const now = Date.now();
      room.chatHistory = [
        {
          id: "msg_5d_ago",
          userId: "usr_bob",
          userName: "Bob",
          text: "Message from 5 days ago",
          serverTimestampMs: now - 5 * ONE_DAY_MS,
        },
        {
          id: "msg_just_now",
          userId: "usr_alice",
          userName: "Alice",
          text: "Just now message",
          serverTimestampMs: now - 1000,
        },
      ];

      // Update retention from 7 days down to 1 day
      const result = room.updateSettings("usr_host", 1, { chatRetentionDays: 1 });
      expect(result.success).toBe(true);
      expect(room.chatRetentionDays).toBe(1);

      // 5-day-old message must have been pruned immediately
      expect(room.chatHistory.length).toBe(1);
      expect(room.chatHistory[0].id).toBe("msg_just_now");

      // Verify broadcast was emitted
      const settingsUpdatedMsg = hostWs.sentMessages.find(
        (m) => m.type === "ROOM_SETTINGS_UPDATED"
      );
      expect(settingsUpdatedMsg).toBeDefined();
      expect(settingsUpdatedMsg.payload.chatRetentionDays).toBe(1);
    });
  });

  // =========================================================================
  // 3. ROOM RULES CONFIGURATION & BROADCAST
  // =========================================================================
  describe("Room Rules Configuration & Broadcast", () => {
    let room: Room;

    beforeEach(() => {
      room = new Room({
        roomId: "room_rules_test",
        roomCode: "RULES1",
        roomName: "Rules Test Room",
        hostUserId: "usr_host",
        hostUserName: "HostUser",
        roomRules: "1. Respect everyone\n2. No spoilers\n3. Push to talk in Discord",
      });
    });

    it("initializes room with custom roomRules and exposes it in snapshots", () => {
      expect(room.roomRules).toBe("1. Respect everyone\n2. No spoilers\n3. Push to talk in Discord");
      const snap = room.getSnapshot();
      expect(snap.roomRules).toBe("1. Respect everyone\n2. No spoilers\n3. Push to talk in Discord");
    });

    it("allows host to update room rules and broadcasts to all connected members", () => {
      const hostWs = createMockWsConnection("usr_host");
      const memberWs = createMockWsConnection("usr_member");
      const host = room.getMember("usr_host");
      if (host) {
        host.connection = hostWs as any;
        host.isConnected = true;
      }
      room.addMember("MemberUser", memberWs as any, undefined, { role: "member" });

      const newRules = "Updated Rules: Relax and have fun watching anime!";
      const res = room.updateSettings("usr_host", 1, { roomRules: newRules });
      expect(res.success).toBe(true);
      expect(room.roomRules).toBe(newRules);

      // Verify member received update
      const memberSettingsMsg = memberWs.sentMessages.find(
        (m) => m.type === "ROOM_SETTINGS_UPDATED"
      );
      expect(memberSettingsMsg).toBeDefined();
      expect(memberSettingsMsg.payload.roomRules).toBe(newRules);
    });

    it("rejects room rules update by non-host member", () => {
      const res = room.updateSettings("usr_random_intruder", 1, { roomRules: "Hacked rules!" });
      expect(res.success).toBe(false);
      expect(res.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      expect(room.roomRules).toContain("1. Respect everyone");
    });

    it("clears room rules when set to null or empty string", () => {
      const res = room.updateSettings("usr_host", 1, { roomRules: null });
      expect(res.success).toBe(true);
      expect(room.roomRules).toBeUndefined();
      expect(room.getSnapshot().roomRules).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. END-TO-END DELETE-MY-ACCOUNT LIFECYCLE
  // =========================================================================
  describe("End-to-End Delete-My-Account Flow (Prompt 12)", () => {
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

    it("fails account deletion if the user provides an incorrect password", async () => {
      const signupRes = await authService.signup({
        email: "delete-fail@example.com",
        password: "CorrectPassword123!",
        displayName: "TargetUser",
      });
      const user = signupRes.user;

      await expect(
        authService.deleteAccount(
          user.id,
          { password: "WrongPassword999!" },
          userDataService
        )
      ).rejects.toThrow("Incorrect password. Account deletion aborted.");

      // Verify user still exists
      const found = await authRepo.findUserById(user.id);
      expect(found).not.toBeNull();
    });

    it("executes full cascade deletion: wipes user, anonymizes room chat to [Deleted User], revokes tokens and locks out login", async () => {
      // 1. Signup and verify user
      const signupRes = await authService.signup({
        email: "delete-success@example.com",
        password: "SuperSecretKey456!",
        displayName: "AlexCoWatcher",
      });
      const user = signupRes.user;
      await authRepo.updateUser(user.id, { emailVerifiedAt: new Date() });

      // 2. Seed watch history and favorite item
      await userDataService.addWatchHistory(user.id, {
        videoId: "dQw4w9WgXcQ",
        sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        sourceType: "youtube",
        title: "Never Gonna Give You Up",
        positionMs: 45000,
        durationMs: 213000,
      });
      const historyBefore = await userDataService.getWatchHistory(user.id);
      expect(historyBefore.items.length).toBe(1);

      // 3. Create active room and add user chat message
      const { room } = roomManager.createRoom({
        roomName: "Movie Lounge",
        hostUserId: "usr_host_other",
        hostUserName: "HostOther",
      });

      // User sends chat in room
      room.chatHistory.push({
        id: "msg_alex_01",
        userId: user.id,
        userName: "AlexCoWatcher",
        text: "Hey everyone, love this scene!",
        serverTimestampMs: Date.now(),
      });
      const foundMsgBefore = room.chatHistory.find((m) => m.id === "msg_alex_01");
      expect(foundMsgBefore).toBeDefined();
      expect(foundMsgBefore?.userName).toBe("AlexCoWatcher");
      expect(foundMsgBefore?.userId).toBe(user.id);

      // 4. Connect a simulated WebSocket for this user
      const mockWs = createMockWsConnection(user.id);
      authService.getWsTicketService().registerSocket(user.id, mockWs as any);

      // 5. Execute account deletion with valid password
      const deletionResult = await authService.deleteAccount(
        user.id,
        { password: "SuperSecretKey456!" },
        userDataService
      );

      expect(deletionResult.success).toBe(true);
      expect(deletionResult.message).toContain("deleted successfully");

      // 6. Verify User record is deleted from DB
      const userAfter = await authRepo.findUserById(user.id);
      expect(userAfter).toBeNull();

      // 7. Subsequent login attempts fail
      await expect(
        authService.login({
          email: "delete-success@example.com",
          password: "SuperSecretKey456!",
        })
      ).rejects.toThrow("Invalid email or password");

      // 8. Active WebSocket terminated with POLICY_VIOLATION
      expect(mockWs.isClosed).toBe(true);
      expect(mockWs.closeCode).toBe(WS_CLOSE_CODES.POLICY_VIOLATION);

      // 9. Active room chat messages anonymized to [Deleted User]
      const foundMsgAfter = room.chatHistory.find((m) => m.id === "msg_alex_01");
      expect(foundMsgAfter).toBeDefined();
      expect(foundMsgAfter?.userName).toBe("[Deleted User]");

      // 10. User watch history completely purged
      const historyAfter = await userDataService.getWatchHistory(user.id);
      expect(historyAfter.items.length).toBe(0);
    });
  });

  // =========================================================================
  // 5. PER-USER BLOCK/MUTE & MODERATION REPORTING FLOW
  // =========================================================================
  describe("Per-User Block / Mute & Moderation Report Flow", () => {
    let friendsRepo: MemoryFriendsRepository;
    let notifRepo: MemoryNotificationRepository;
    let authRepo: MemoryAuthRepository;
    let friendsService: FriendsService;

    beforeEach(async () => {
      friendsRepo = new MemoryFriendsRepository();
      notifRepo = new MemoryNotificationRepository();
      authRepo = new MemoryAuthRepository();
      friendsService = new FriendsService({
        friendsRepo,
        notificationRepo: notifRepo,
        authRepo,
        presenceService: new PresenceService(),
      });

      // Seed two users
      await authRepo.createUser({
        id: "usr_alice",
        email: "alice@example.com",
        passwordHash: "hashA",
        displayName: "Alice",
        emailVerified: true,
      });
      await authRepo.createUser({
        id: "usr_bob",
        email: "bob@example.com",
        passwordHash: "hashB",
        displayName: "Bob",
        emailVerified: true,
      });
    });

    it("blocks a user, unlinks friendship, and lists in blocked users list", async () => {
      // First create friendship directly in repository
      await friendsRepo.createOrUpdateFriendship({
        user1Id: "usr_alice",
        user2Id: "usr_bob",
        requesterId: "usr_alice",
        addresseeId: "usr_bob",
        status: "accepted",
      });

      const initialList = await friendsService.getFriendsList("usr_alice");
      expect(initialList.friends.length).toBe(1);

      // Block Bob
      const blocked = await friendsService.blockUser("usr_alice", "usr_bob");
      expect(blocked).toBe(true);

      // Friends list should no longer contain Bob
      const listAfterBlock = await friendsService.getFriendsList("usr_alice");
      expect(listAfterBlock.friends.length).toBe(0);
      expect(listAfterBlock.blockedUsers.length).toBe(1);
      expect(listAfterBlock.blockedUsers[0].blockedBy).toBe("usr_alice");

      // Unblock Bob
      const unblocked = await friendsService.unblockUser("usr_alice", "usr_bob");
      expect(unblocked).toBe(true);

      const listAfterUnblock = await friendsService.getFriendsList("usr_alice");
      expect(listAfterUnblock.blockedUsers.length).toBe(0);
    });

    it("creates a moderation report for a user with recent surrounding chat context", () => {
      const room = new Room({
        roomId: "room_report_test",
        roomCode: "REPRT1",
        roomName: "Report Test Room",
        hostUserId: "usr_host",
        hostUserName: "HostUser",
      });

      // Connect staff and members
      const hostWs = createMockWsConnection("usr_host");
      const host = room.getMember("usr_host");
      if (host) {
        host.connection = hostWs as any;
        host.isConnected = true;
      }
      const aliceJoin = room.addMember("Alice", undefined, undefined, { role: "member" });
      const aliceId = (aliceJoin as any).member.userId;

      // Seed chat messages
      const now = Date.now();
      room.chatHistory = [
        { id: "msg_1", userId: aliceId, userName: "Alice", text: "Nice video", serverTimestampMs: now - 3000 },
        { id: "msg_2", userId: "usr_bad_actor", userName: "Troll", text: "Spam link http://bad.com", serverTimestampMs: now - 2000 },
        { id: "msg_3", userId: "usr_bob", userName: "Bob", text: "Please stop spamming", serverTimestampMs: now - 1000 },
      ];

      const targetMsgId = room.chatHistory[1].id;

      // Alice reports the specific spam message
      const reportRes = room.createModerationReport(aliceId, {
        targetType: "message",
        targetUserId: "usr_bad_actor",
        targetMessageId: targetMsgId,
        reason: "spam",
        description: "Posting phishing links repeatedly",
      });

      expect(reportRes.success).toBe(true);
      const report = (reportRes as any).report;
      expect(report.reporterUserId).toBe(aliceId);
      expect(report.targetUserId).toBe("usr_bad_actor");
      expect(report.targetMessageId).toBe(targetMsgId);
      expect(report.reportedMessageText).toBe("Spam link http://bad.com");
      expect(report.reason).toBe("spam");
      expect(report.status).toBe("pending");

      // Chat context captured surrounding window
      expect(report.chatContext.length).toBe(3);

      // Staff (host) received the report broadcast
      const staffMsg = hostWs.sentMessages.find((m) => m.type === "MODERATION_REPORT_CREATED");
      expect(staffMsg).toBeDefined();
      expect(staffMsg.payload.report.id).toBe(report.id);
    });
  });
});
