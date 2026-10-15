import { describe, it, expect, beforeEach, vi } from "vitest";
import { Room } from "../src/rooms/Room.js";
import {
  ERROR_CODES,
  WS_CLOSE_CODES,
  DEFAULT_PERMISSION_MATRIX,
  Role,
  RoomPermission,
} from "@watchparty/shared";
import { auditLogger } from "../src/security/AuditLogger.js";

// Mock WebSocket connection
function createMockConnection() {
  const sentMessages: any[] = [];
  let closed = false;
  let closeCode: number | undefined;
  let closeReason: string | undefined;

  return {
    send: (msg: any) => {
      sentMessages.push(msg);
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

describe("Room Access Control and Moderation Suite", () => {
  let auditSpy: any;

  beforeEach(() => {
    auditSpy = vi.spyOn(auditLogger, "log").mockImplementation(() => {});
  });

  // =========================================================================
  // 1. PERMISSION MATRIX AND ROLE HIERARCHY
  // =========================================================================
  describe("Role & Permission Matrix Enforcement", () => {
    let room: Room;

    beforeEach(() => {
      room = new Room({
        roomId: "room_perm_test",
        roomCode: "PERM01",
        roomName: "Permission Lab",
        hostUserId: "usr_host",
        hostUserName: "HostUser",
        controlMode: "public",
      });
    });

    it("enforces permission defaults across host, moderator, member, and guest", () => {
      const { member: mod } = room.addMember("ModeratorUser", undefined, undefined, {
        role: "moderator",
      });
      const { member: mem } = room.addMember("MemberUser", undefined, undefined, {
        role: "member",
      });
      const { member: gst } = room.addMember("GuestUser", undefined, undefined, {
        role: "guest",
      });

      // Host has all permissions
      expect(room.hasPermission("usr_host", "control_playback")).toBe(true);
      expect(room.hasPermission("usr_host", "edit_playlist")).toBe(true);
      expect(room.hasPermission("usr_host", "create_polls")).toBe(true);
      expect(room.hasPermission("usr_host", "kick")).toBe(true);
      expect(room.hasPermission("usr_host", "ban")).toBe(true);
      expect(room.hasPermission("usr_host", "mute")).toBe(true);
      expect(room.hasPermission("usr_host", "manage_roles")).toBe(true);
      expect(room.hasPermission("usr_host", "lock_room")).toBe(true);
      expect(room.hasPermission("usr_host", "delete_message")).toBe(true);

      // Moderator has playback, playlist, poll, kick, ban, mute, lock, delete, but NOT manage_roles
      expect(room.hasPermission(mod.userId, "control_playback")).toBe(true);
      expect(room.hasPermission(mod.userId, "edit_playlist")).toBe(true);
      expect(room.hasPermission(mod.userId, "create_polls")).toBe(true);
      expect(room.hasPermission(mod.userId, "kick")).toBe(true);
      expect(room.hasPermission(mod.userId, "ban")).toBe(true);
      expect(room.hasPermission(mod.userId, "mute")).toBe(true);
      expect(room.hasPermission(mod.userId, "lock_room")).toBe(true);
      expect(room.hasPermission(mod.userId, "delete_message")).toBe(true);
      expect(room.hasPermission(mod.userId, "manage_roles")).toBe(false);

      // Member can control playback, edit playlist, create polls, but CANNOT kick, ban, mute, lock
      expect(room.hasPermission(mem.userId, "control_playback")).toBe(true);
      expect(room.hasPermission(mem.userId, "edit_playlist")).toBe(true);
      expect(room.hasPermission(mem.userId, "create_polls")).toBe(true);
      expect(room.hasPermission(mem.userId, "kick")).toBe(false);
      expect(room.hasPermission(mem.userId, "ban")).toBe(false);
      expect(room.hasPermission(mem.userId, "mute")).toBe(false);
      expect(room.hasPermission(mem.userId, "lock_room")).toBe(false);

      // Guest CANNOT control playback, edit playlist, create polls, kick, ban, mute
      expect(room.hasPermission(gst.userId, "control_playback")).toBe(false);
      expect(room.hasPermission(gst.userId, "edit_playlist")).toBe(false);
      expect(room.hasPermission(gst.userId, "create_polls")).toBe(false);
      expect(room.hasPermission(gst.userId, "kick")).toBe(false);
      expect(room.hasPermission(gst.userId, "ban")).toBe(false);
      expect(room.hasPermission(gst.userId, "mute")).toBe(false);
    });

    it("enforces role moderation hierarchy: moderator cannot kick/mute/ban host or other moderators", () => {
      const { member: mod1 } = room.addMember("Mod1", undefined, undefined, { role: "moderator" });
      const { member: mod2 } = room.addMember("Mod2", undefined, undefined, { role: "moderator" });
      const { member: mem } = room.addMember("TargetMember", undefined, undefined, { role: "member" });

      // Host can moderate everyone except self
      expect(room.canModerateTarget("usr_host", "usr_host")).toBe(false);
      expect(room.canModerateTarget("usr_host", mod1.userId)).toBe(true);
      expect(room.canModerateTarget("usr_host", mem.userId)).toBe(true);

      // Moderator cannot moderate host
      expect(room.canModerateTarget(mod1.userId, "usr_host")).toBe(false);
      const kickHostAttempt = room.kickMember(mod1.userId, 1, "usr_host");
      expect(kickHostAttempt.success).toBe(false);
      expect(kickHostAttempt.code).toBe(ERROR_CODES.PERMISSION_DENIED);

      // Moderator cannot moderate another moderator
      expect(room.canModerateTarget(mod1.userId, mod2.userId)).toBe(false);
      const banModAttempt = room.banMember(mod1.userId, 2, mod2.userId);
      expect(banModAttempt.success).toBe(false);
      expect(banModAttempt.code).toBe(ERROR_CODES.PERMISSION_DENIED);

      // Moderator CAN moderate regular member
      expect(room.canModerateTarget(mod1.userId, mem.userId)).toBe(true);
      const muteMemAttempt = room.muteMember(mod1.userId, 3, mem.userId);
      expect(muteMemAttempt.success).toBe(true);
    });

    it("allows dynamic role promotion and demotion with immediate permission update", () => {
      const { member: mem } = room.addMember("PromotableUser", undefined, undefined, { role: "member" });
      expect(room.hasPermission(mem.userId, "kick")).toBe(false);

      // Non-host attempts to promote -> denied
      const illegalPromo = room.setMemberRole(mem.userId, 1, mem.userId, "moderator");
      expect(illegalPromo.success).toBe(false);
      expect(illegalPromo.code).toBe(ERROR_CODES.PERMISSION_DENIED);

      // Host promotes Member to Moderator
      const promo = room.setMemberRole("usr_host", 2, mem.userId, "moderator");
      expect(promo.success).toBe(true);
      expect(room.hasPermission(mem.userId, "kick")).toBe(true);

      // Host demotes Moderator to Guest
      const demote = room.setMemberRole("usr_host", 3, mem.userId, "guest");
      expect(demote.success).toBe(true);
      expect(room.hasPermission(mem.userId, "kick")).toBe(false);
      expect(room.hasPermission(mem.userId, "control_playback")).toBe(false);
    });

    it("prevents guest from editing playlist, controlling playback, or creating polls", () => {
      const { member: guest } = room.addMember("GuestOne", undefined, undefined, { role: "guest" });

      const playRes = room.applyPlay(guest.userId, 1);
      expect(playRes.success).toBe(false);
      expect(playRes.code).toBe(ERROR_CODES.PERMISSION_DENIED);

      const playlistRes = room.addPlaylistItem(guest.userId, 2, "video_123", "Video Title", 1000);
      expect(playlistRes.success).toBe(false);
      expect(playlistRes.code).toBe(ERROR_CODES.PERMISSION_DENIED);

      const pollRes = room.createPoll(guest.userId, 3, "Vote?", ["Yes", "No"]);
      expect(pollRes.success).toBe(false);
      expect(pollRes.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    });
  });

  // =========================================================================
  // 2. BAN EVASION VIA REJOIN OR RECONNECT
  // =========================================================================
  describe("Ban Enforcement and Evasion Prevention", () => {
    let room: Room;

    beforeEach(() => {
      room = new Room({
        roomId: "room_ban_test",
        roomCode: "BAN001",
        roomName: "Ban Evasion Lab",
        hostUserId: "usr_host",
        hostUserName: "HostUser",
        controlMode: "public",
      });
    });

    it("terminates connection and evicts user when banned", () => {
      const mockConn = createMockConnection();
      const joinRes = room.addMember("BadActor", mockConn as any, undefined, {
        accountId: "acc_bad_actor_01",
      });
      expect(joinRes.success).toBe(true);
      const targetUser = (joinRes as any).member;

      // Ban member
      const banRes = room.banMember("usr_host", 1, targetUser.userId, "Trolling and harassment");
      expect(banRes.success).toBe(true);

      // Connection must be closed with USER_BANNED code
      expect(mockConn.isClosed).toBe(true);
      expect(mockConn.closeCode).toBe(WS_CLOSE_CODES.USER_BANNED);

      // User must be removed from room
      expect(room.getMember(targetUser.userId)).toBeUndefined();
    });

    it("prevents ban evasion via rejoin with the same account ID", () => {
      const joinRes = room.addMember("BadActor", undefined, undefined, {
        accountId: "acc_bad_actor_99",
      });
      expect(joinRes.success).toBe(true);
      const targetUser = (joinRes as any).member;

      // Ban by host
      room.banMember("usr_host", 1, targetUser.userId, "Terms violation");

      // Attempt to rejoin using a new connection and new display name, but same account ID
      const evasionAttempt = room.addMember("InnocentLookingAlts", undefined, undefined, {
        accountId: "acc_bad_actor_99",
      });

      expect(evasionAttempt.success).toBe(false);
      expect(evasionAttempt.code).toBe(ERROR_CODES.USER_BANNED);
      expect(evasionAttempt.message).toContain("banned");
    });

    it("prevents ban evasion via reconnectMember using banned session token", () => {
      const joinRes = room.addMember("TrollUser", undefined, undefined, {
        accountId: "acc_troll",
      });
      expect(joinRes.success).toBe(true);
      const { member, sessionToken } = joinRes as any;

      // Ban member
      room.banMember("usr_host", 1, member.userId, "Spamming");

      // Attempt reconnect with the saved session token
      const mockConn = createMockConnection();
      const reconnectResult = room.reconnectMember(sessionToken, mockConn as any);

      expect(reconnectResult.success).toBe(false);
      expect(reconnectResult.code).toBe(ERROR_CODES.USER_BANNED);
    });

    it("allows clean rejoin after host unbans the account ID or user", () => {
      const joinRes = room.addMember("RepentantUser", undefined, undefined, {
        accountId: "acc_reformed",
      });
      const { member } = joinRes as any;

      // Ban then unban
      room.banMember("usr_host", 1, member.userId, "Temporary penalty");
      const unbanRes = room.unbanUser("usr_host", 2, "acc_reformed");
      expect(unbanRes.success).toBe(true);

      // Rejoin succeeds now
      const secondJoin = room.addMember("RepentantUser", undefined, undefined, {
        accountId: "acc_reformed",
      });
      expect(secondJoin.success).toBe(true);
    });

    it("kicks a member closing their connection with USER_KICKED without permanently banning", () => {
      const mockConn = createMockConnection();
      const joinRes = room.addMember("RowdyUser", mockConn as any);
      expect(joinRes.success).toBe(true);
      const { member } = joinRes as any;

      const kickRes = room.kickMember("usr_host", 1, member.userId, "Be civil");
      expect(kickRes.success).toBe(true);
      expect(mockConn.isClosed).toBe(true);
      expect(mockConn.closeCode).toBe(WS_CLOSE_CODES.USER_KICKED);

      // Kicked user can rejoin (kick is non-permanent)
      const rejoinRes = room.addMember("RowdyUser");
      expect(rejoinRes.success).toBe(true);
    });
  });

  // =========================================================================
  // 3. ROOM TYPES, PASSWORDS AND MAX MEMBERS
  // =========================================================================
  describe("Room Types, Passwords, and Max Members Enforcement", () => {
    it("enforces max-members limit strictly", () => {
      const room = new Room({
        roomId: "room_cap_test",
        roomCode: "CAP001",
        roomName: "Capacity Room",
        hostUserId: "usr_host",
        hostUserName: "Host",
        maxMembers: 3, // Host + 2 members
      });

      const m1 = room.addMember("User1");
      const m2 = room.addMember("User2");
      expect(m1.success).toBe(true);
      expect(m2.success).toBe(true);

      // 4th member exceeds capacity (3 max)
      const m3 = room.addMember("User3");
      expect(m3.success).toBe(false);
      expect(m3.code).toBe(ERROR_CODES.ROOM_FULL);
    });

    it("enforces room password authentication with PBKDF2 hashing", () => {
      const room = new Room({
        roomId: "room_pwd_test",
        roomCode: "PWD001",
        roomName: "Secret Club",
        hostUserId: "usr_host",
        hostUserName: "Host",
        roomType: "public",
        roomPassword: "SuperSecretPassword123!",
      });

      // Join without password -> rejected
      const noPwd = room.addMember("Alice");
      expect(noPwd.success).toBe(false);
      expect(noPwd.code).toBe(ERROR_CODES.ROOM_PASSWORD_REQUIRED);

      // Join with incorrect password -> rejected
      const wrongPwd = room.addMember("Alice", undefined, undefined, {
        password: "WrongPassword",
      });
      expect(wrongPwd.success).toBe(false);
      expect(wrongPwd.code).toBe(ERROR_CODES.INVALID_PASSWORD);

      // Join with correct password -> admitted
      const correctPwd = room.addMember("Alice", undefined, undefined, {
        password: "SuperSecretPassword123!",
      });
      expect(correctPwd.success).toBe(true);
    });

    it("enforces friends-only room type access", async () => {
      const mockFriendsRepo = {
        getRelationship: vi.fn().mockImplementation((acc1: string, acc2: string) => {
          if (acc1 === "host_acc" && acc2 === "friend_acc") {
            return Promise.resolve({ status: "accepted" });
          }
          return Promise.resolve(null);
        }),
      };
      const mockFriendsService = {
        getFriendsRepo: () => mockFriendsRepo,
      };

      const room = new Room({
        roomId: "room_friends_test",
        roomCode: "FRND01",
        roomName: "Friends Only Room",
        hostUserId: "usr_host",
        hostUserName: "Host",
        hostAccountId: "host_acc",
        roomType: "friends-only",
        waitingRoomEnabled: false,
        friendsService: mockFriendsService,
      });

      // Non-friend joins -> denied
      const strangerJoin = room.addMember("Stranger", undefined, undefined, {
        accountId: "stranger_acc",
        isFriendOfHost: false,
      });
      expect(strangerJoin.success).toBe(false);
      expect(strangerJoin.code).toBe(ERROR_CODES.PERMISSION_DENIED);

      // Friend joins -> admitted
      const friendJoin = room.addMember("BestFriend", undefined, undefined, {
        accountId: "friend_acc",
        isFriendOfHost: true,
      });
      expect(friendJoin.success).toBe(true);
    });

    it("enforces invite-only room type access", () => {
      const room = new Room({
        roomId: "room_invite_test",
        roomCode: "INVT01",
        roomName: "VIP Lounge",
        hostUserId: "usr_host",
        hostUserName: "Host",
        roomType: "invite-only",
        waitingRoomEnabled: false,
      });

      // Attempt to join without invite token -> denied
      const noInvite = room.addMember("UninvitedGuest");
      expect(noInvite.success).toBe(false);
      expect(noInvite.code).toBe(ERROR_CODES.PERMISSION_DENIED);

      // Create an invite link
      const inviteLink = room.createInviteLink("usr_host", { role: "member" });
      expect(inviteLink.success).toBe(true);
      const token = (inviteLink as any).inviteLink.id;

      // Join with valid invite token -> admitted
      const withInvite = room.addMember("InvitedGuest", undefined, undefined, {
        inviteToken: token,
      });
      expect(withInvite.success).toBe(true);
    });
  });

  // =========================================================================
  // 4. WAITING ROOM / LOBBY & AUTO-APPROVE FRIENDS
  // =========================================================================
  describe("Waiting Room / Lobby & Auto-Approve Flow", () => {
    let room: Room;

    beforeEach(() => {
      room = new Room({
        roomId: "room_waiting_test",
        roomCode: "WAIT01",
        roomName: "Screening Room",
        hostUserId: "usr_host",
        hostUserName: "Host",
        waitingRoomEnabled: true,
        autoApproveFriends: true,
      });
    });

    it("places non-friend join requests in the lobby queue and allows host approval", () => {
      const mockConn = createMockConnection();
      const joinReq = room.addMember("PendingUser", mockConn as any, undefined, {
        accountId: "acc_pending",
        isFriendOfHost: false,
      });

      expect(joinReq.success).toBe(false);
      expect((joinReq as any).waiting).toBe(true);
      const reqId = (joinReq as any).requestId;
      expect(reqId).toBeDefined();

      // Ensure request is in waiting queue
      const queue = room.getWaitingRequests();
      expect(queue.some((r) => r.requestId === reqId)).toBe(true);

      // Host approves request
      const approveRes = room.approveWaitingRequest("usr_host", 1, reqId);
      expect(approveRes.success).toBe(true);

      // Member should now be fully registered in the room
      const member = room.getMember(joinReq.requestId ? queue[0]?.userId : "");
      expect(room.getWaitingRequests()).toHaveLength(0);
      expect(mockConn.sentMessages.some((m) => m.type === "ROOM_SNAPSHOT")).toBe(true);
    });

    it("allows host or moderator to deny a join request", () => {
      const mockConn = createMockConnection();
      const joinReq = room.addMember("DeniedUser", mockConn as any, undefined, {
        isFriendOfHost: false,
      });
      const reqId = (joinReq as any).requestId;

      // Host denies request
      const denyRes = room.denyWaitingRequest("usr_host", 1, reqId);
      expect(denyRes.success).toBe(true);
      expect(room.getWaitingRequests()).toHaveLength(0);

      // Connection receives denial error message
      expect(mockConn.sentMessages.some((m) => m.type === "ERROR" && m.code === ERROR_CODES.JOIN_REQUEST_DENIED)).toBe(true);
    });

    it("auto-approves friends when autoApproveFriends is enabled", () => {
      // Friend bypasses waiting room directly
      const friendJoin = room.addMember("HostFriend", undefined, undefined, {
        accountId: "acc_friend",
        isFriendOfHost: true,
      });
      expect(friendJoin.success).toBe(true);
      expect((friendJoin as any).waiting).toBeUndefined();
    });

    it("queues friends when autoApproveFriends toggle is disabled", () => {
      room.updateSettings("usr_host", 1, { autoApproveFriends: false }); // autoApproveFriends = false
      expect(room.autoApproveFriends).toBe(false);

      const friendJoin = room.addMember("HostFriend", undefined, undefined, {
        accountId: "acc_friend",
        isFriendOfHost: true,
      });
      expect(friendJoin.success).toBe(false);
      expect((friendJoin as any).waiting).toBe(true);
    });
  });

  // =========================================================================
  // 5. INVITE LINKS LIFECYCLE
  // =========================================================================
  describe("Invite Links Lifecycle: Expiring, Revocable, Limited, Regenerable", () => {
    let room: Room;

    beforeEach(() => {
      room = new Room({
        roomId: "room_invites_test",
        roomCode: "INV001",
        roomName: "Invite Room",
        hostUserId: "usr_host",
        hostUserName: "Host",
        roomType: "invite-only",
      });
    });

    it("enforces usage limits on invite links", () => {
      const linkRes = room.createInviteLink("usr_host", {
        role: "member",
        maxUses: 2,
      });
      expect(linkRes.success).toBe(true);
      const token = (linkRes as any).inviteLink.id;

      // 1st join succeeds
      const j1 = room.addMember("UserA", undefined, undefined, { inviteToken: token });
      expect(j1.success).toBe(true);

      // 2nd join succeeds
      const j2 = room.addMember("UserB", undefined, undefined, { inviteToken: token });
      expect(j2.success).toBe(true);

      // 3rd join exceeds limit
      const j3 = room.addMember("UserC", undefined, undefined, { inviteToken: token });
      expect(j3.success).toBe(false);
      expect(j3.code).toBe(ERROR_CODES.INVITE_MAX_USES_REACHED);
    });

    it("enforces expiration on invite links", () => {
      const linkRes = room.createInviteLink("usr_host", {
        expiresInSeconds: -1, // already expired
      });
      expect(linkRes.success).toBe(true);
      const token = (linkRes as any).inviteLink.id;

      const joinAttempt = room.addMember("LateUser", undefined, undefined, { inviteToken: token });
      expect(joinAttempt.success).toBe(false);
      expect(joinAttempt.code).toBe(ERROR_CODES.INVITE_EXPIRED);
    });

    it("allows host to revoke an active invite link immediately", () => {
      const linkRes = room.createInviteLink("usr_host", { role: "member" });
      expect(linkRes.success).toBe(true);
      const inviteId = (linkRes as any).inviteLink.id;
      const token = inviteId;

      // Revoke link
      const revRes = room.revokeInviteLink("usr_host", inviteId);
      expect(revRes.success).toBe(true);

      // Attempt to join with revoked link
      const joinAttempt = room.addMember("Intruder", undefined, undefined, { inviteToken: token });
      expect(joinAttempt.success).toBe(false);
      expect(joinAttempt.code).toBe(ERROR_CODES.INVITE_INVALID);
    });

    it("regenerates an invite link to kill a leaked URL and replace it with a fresh token", () => {
      const linkRes = room.createInviteLink("usr_host", {
        role: "moderator",
        maxUses: 5,
      });
      expect(linkRes.success).toBe(true);
      const originalInvite = (linkRes as any).inviteLink;

      // Regenerate the leaked link
      const regenRes = room.regenerateInviteLink("usr_host", originalInvite.id);
      expect(regenRes.success).toBe(true);
      const newInvite = (regenRes as any).inviteLink;

      // The old token is invalidated
      const oldJoin = room.addMember("Leaker", undefined, undefined, {
        inviteToken: originalInvite.id,
      });
      expect(oldJoin.success).toBe(false);
      expect(oldJoin.code).toBe(ERROR_CODES.INVITE_INVALID);

      // The new token succeeds and retains role settings
      const newJoin = room.addMember("AuthorizedUser", undefined, undefined, {
        inviteToken: newInvite.id,
      });
      expect(newJoin.success).toBe(true);
      expect((newJoin as any).member.role).toBe("moderator");
    });
  });

  // =========================================================================
  // 6. MODERATION ACTIONS (MUTE, SLOW MODE, PROFANITY, REPORTS, LOCK)
  // =========================================================================
  describe("Moderation Actions and Controls", () => {
    let room: Room;

    beforeEach(() => {
      room = new Room({
        roomId: "room_mod_actions",
        roomCode: "MOD001",
        roomName: "Moderation Test Lab",
        hostUserId: "usr_host",
        hostUserName: "Host",
        profanityFilterEnabled: true,
        slowModeSeconds: 0,
      });
    });

    it("enforces chat mute and unmute controls", () => {
      const { member } = room.addMember("Chatter");

      // Chat allowed before mute
      const c1 = room.broadcastChat(member.userId, 1, "Hello everyone!");
      expect(c1.success).toBe(true);

      // Mute chatter
      const muteRes = room.muteMember("usr_host", 2, member.userId, 60000, "Spam");
      expect(muteRes.success).toBe(true);

      // Chat rejected while muted
      const c2 = room.broadcastChat(member.userId, 3, "Can you hear me?");
      expect(c2.success).toBe(false);
      expect(c2.code).toBe(ERROR_CODES.USER_MUTED);

      // Unmute chatter
      const unmuteRes = room.unmuteMember("usr_host", 4, member.userId);
      expect(unmuteRes.success).toBe(true);

      // Chat allowed again
      const c3 = room.broadcastChat(member.userId, 5, "I am back!");
      expect(c3.success).toBe(true);
    });

    it("enforces chat slow mode interval", () => {
      const slowRoom = new Room({
        roomId: "room_slow_mode",
        roomCode: "SLOW01",
        roomName: "Slow Mode Room",
        hostUserId: "usr_host",
        hostUserName: "Host",
        slowModeSeconds: 2,
      });
      const { member } = slowRoom.addMember("SpeedyChatter");

      // 1st message passes
      const msg1 = slowRoom.broadcastChat(member.userId, 1, "First message");
      expect(msg1.success).toBe(true);

      // Immediate 2nd message (< 2s) rejected by slow mode
      const msg2 = slowRoom.broadcastChat(member.userId, 2, "Too fast message");
      expect(msg2.success).toBe(false);
      expect(msg2.code).toBe(ERROR_CODES.SLOW_MODE_ACTIVE);
    });

    it("filters and masks profanity when profanity filter is enabled", () => {
      const { member } = room.addMember("ProfaneUser");

      room.broadcastChat(member.userId, 1, "What the fuck is this shit?");
      const lastMessage = room.chatHistory[room.chatHistory.length - 1];

      expect(lastMessage.text).not.toContain("fuck");
      expect(lastMessage.text).not.toContain("shit");
      expect(lastMessage.text).toBe("What the **** is this ****?");
    });

    it("allows host/moderator to delete abusive messages and sanitizes history", () => {
      const { member: troll } = room.addMember("TrollUser");
      const { member: bystander } = room.addMember("BystanderUser");
      const { member: mod } = room.addMember("ModUser", undefined, undefined, { role: "moderator" });

      room.broadcastChat(troll.userId, 1, "Abusive offensive content");
      const targetMessage = room.chatHistory[room.chatHistory.length - 1];

      // Non-author regular member attempts to delete -> denied
      const illegalDelete = room.deleteChatMessage(bystander.userId, 2, targetMessage.id);
      expect(illegalDelete.success).toBe(false);
      expect(illegalDelete.code).toBe(ERROR_CODES.PERMISSION_DENIED);

      // Moderator deletes message -> approved
      const modDelete = room.deleteChatMessage(mod.userId, 3, targetMessage.id);
      expect(modDelete.success).toBe(true);

      const deletedMsg = room.chatHistory.find((m) => m.id === targetMessage.id);
      expect(deletedMsg!.isDeleted).toBe(true);
      expect(deletedMsg!.text).toBe("[Message deleted by moderator]");
    });

    it("locks room to prevent any new connections until unlocked", () => {
      // Host locks room
      const lockRes = room.lockRoom("usr_host", 1, true);
      expect(lockRes.success).toBe(true);
      expect(room.isLocked).toBe(true);

      // Attempt to join locked room -> rejected
      const joinAttempt = room.addMember("LateComer");
      expect(joinAttempt.success).toBe(false);
      expect(joinAttempt.code).toBe(ERROR_CODES.ROOM_LOCKED);

      // Unlock room
      room.lockRoom("usr_host", 2, false);
      expect(room.isLocked).toBe(false);

      // Can join now
      const unlockedJoin = room.addMember("LateComer");
      expect(unlockedJoin.success).toBe(true);
    });

    it("stores moderation reports with surrounding context for audit review", () => {
      const { member: target } = room.addMember("TargetTroll");
      const { member: reporter } = room.addMember("GoodCitizen");

      room.broadcastChat(target.userId, 1, "Spam message 1");
      room.broadcastChat(target.userId, 2, "Harassing message 2");

      const reportedMsg = room.chatHistory[room.chatHistory.length - 1];

      const reportRes = room.createModerationReport(reporter.userId, {
        targetType: "message",
        targetUserId: target.userId,
        targetMessageId: reportedMsg.id,
        reason: "Harassment in chat",
      });

      expect(reportRes.success).toBe(true);
      const report = (reportRes as any).report;
      expect(report.targetUserId).toBe(target.userId);
      expect(report.reporterUserId).toBe(reporter.userId);
      expect(report.reason).toBe("Harassment in chat");
      expect(report.chatContext.length).toBeGreaterThanOrEqual(2);
      expect(report.reportedMessageText).toBe("Harassing message 2");
    });

    it("validates that moderation actions trigger server-side audit logs", () => {
      const { member: mKick } = room.addMember("AuditKickTarget");
      const { member: mBan } = room.addMember("AuditBanTarget");

      room.kickMember("usr_host", 1, mKick.userId, "Audit kick test");
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ROOM_MEMBER_KICKED",
          actorId: "usr_host",
        })
      );

      room.banMember("usr_host", 2, mBan.userId, "Audit ban test");
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ROOM_MEMBER_BANNED",
          actorId: "usr_host",
        })
      );

      room.lockRoom("usr_host", 3, true);
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ROOM_LOCKED",
          actorId: "usr_host",
        })
      );
    });
  });
});
