import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ROOM_CONSTANTS,
  ERROR_CODES,
  derivePlaybackPositionMs,
  ServerMessage,
} from "@watchparty/shared";
import { Room, ActiveConnection } from "../src/rooms/Room.js";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { generateRoomCode } from "../src/utils/crypto.js";

// Mock connection helper
function createMockConnection(): { connection: ActiveConnection; messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  const connection: ActiveConnection = {
    isAlive: true,
    send: (msg: ServerMessage) => {
      messages.push(msg);
    },
    close: vi.fn(),
  };
  return { connection, messages };
}

describe("Room State Machine & Synchronization Engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Room Creation & Codes", () => {
    it("generates unambiguous 6-character codes without 0, O, 1, I, L", () => {
      for (let i = 0; i < 50; i++) {
        const code = generateRoomCode();
        expect(code).toHaveLength(6);
        expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
        expect(code).not.toMatch(/[01OIL]/);
      }
    });

    it("initializes room with host, paused state, version 1, and invite URL", () => {
      const room = new Room({
        roomId: "room_test1",
        roomCode: "ABCDEF",
        roomName: "Movie Night",
        hostUserId: "usr_host",
        hostUserName: "Alice",
        baseUrl: "http://localhost:3000",
      });

      expect(room.roomId).toBe("room_test1");
      expect(room.roomCode).toBe("ABCDEF");
      expect(room.hostId).toBe("usr_host");
      expect(room.version).toBe(1);
      expect(room.playback.status).toBe("paused");
      expect(room.playback.positionMs).toBe(0);
      expect(room.inviteUrl).toBe("http://localhost:3000/join/ABCDEF");

      const host = room.getMember("usr_host");
      expect(host).toBeDefined();
      expect(host?.isHost).toBe(true);
      expect(host?.sessionToken).toBeTruthy();
    });
  });

  describe("Playback Commands & State Snapshotting", () => {
    it("applies play, bumps version, stamps serverTimeMs, and broadcasts snapshot", async () => {
      const room = new Room({
        roomId: "room_test2",
        roomCode: "XYZ987",
        roomName: "Sci-Fi Club",
        hostUserId: "usr_host",
        hostUserName: "Bob",
      });

      const { connection: hostConn, messages: hostMsgs } = createMockConnection();
      room.attachConnection("usr_host", hostConn);

      const playRes = room.applyPlay("usr_host", 10, 15000);
      expect(playRes.success).toBe(true);
      if (playRes.success) {
        expect(playRes.version).toBe(2);
      }

      expect(room.version).toBe(2);
      expect(room.playback.status).toBe("playing");
      expect(room.playback.positionMs).toBe(15000);
      expect(room.playback.serverTimeMs).toBeGreaterThan(0);

      // Verify broadcast snapshot
      const updateMsg = hostMsgs.find((m) => m.type === "PLAYBACK_UPDATE");
      expect(updateMsg).toBeDefined();
      if (updateMsg && updateMsg.type === "PLAYBACK_UPDATE") {
        expect(updateMsg.version).toBe(2);
        expect(updateMsg.payload.playback.status).toBe("playing");
        expect(updateMsg.payload.playback.positionMs).toBe(15000);
        expect(updateMsg.payload.causedBy).toEqual({ userId: "usr_host", clientSeq: 10 });
      }
    });

    it("applies pause and derives position correctly from elapsed playing time", () => {
      const room = new Room({
        roomId: "room_test3",
        roomCode: "XYZ123",
        roomName: "Action Hub",
        hostUserId: "usr_host",
        hostUserName: "Charlie",
      });

      // Start playing at t = 0
      room.applyPlay("usr_host", 1, 0);
      expect(room.playback.status).toBe("playing");

      // Advance time by 4,500ms
      vi.advanceTimersByTime(4500);

      // Pause without passing explicit position -> should derive position automatically
      const pauseRes = room.applyPause("usr_host", 2);
      expect(pauseRes.success).toBe(true);
      expect(room.playback.status).toBe("paused");
      expect(room.playback.positionMs).toBe(4500);
      expect(room.version).toBe(3);
    });

    it("applies seek and maintains consistent version monotonicity", () => {
      const room = new Room({
        roomId: "room_test4",
        roomCode: "SEEK01",
        roomName: "Seek Test",
        hostUserId: "usr_host",
        hostUserName: "Dave",
      });

      const seekRes = room.applySeek("usr_host", 5, 120000, true);
      expect(seekRes.success).toBe(true);
      expect(room.playback.positionMs).toBe(120000);
      expect(room.playback.status).toBe("playing");
      expect(room.version).toBe(2);
    });

    it("applies change video and resets position", () => {
      const room = new Room({
        roomId: "room_test5",
        roomCode: "VID001",
        roomName: "Video Switch",
        hostUserId: "usr_host",
        hostUserName: "Eve",
      });

      const res = room.applyChangeVideo("usr_host", 12, "interstellar_trailer", 5000, false);
      expect(res.success).toBe(true);
      expect(room.playback.videoId).toBe("interstellar_trailer");
      expect(room.playback.positionMs).toBe(5000);
      expect(room.playback.status).toBe("paused");
    });
  });

  describe("Permission Model (Host-Only vs Public)", () => {
    it("rejects non-host playback commands when controlMode is host_only", () => {
      const room = new Room({
        roomId: "room_perm",
        roomCode: "PERM01",
        roomName: "Strict Room",
        hostUserId: "usr_host",
        hostUserName: "Host",
        controlMode: "host_only",
      });

      const { member: guest } = room.addMember("Guest");

      // Guest attempts to play
      const playRes = room.applyPlay(guest.userId, 1, 1000);
      expect(playRes.success).toBe(false);
      if (!playRes.success) {
        expect(playRes.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      }

      // Guest attempts to seek
      const seekRes = room.applySeek(guest.userId, 2, 5000);
      expect(seekRes.success).toBe(false);

      // Host can play without issues
      const hostPlayRes = room.applyPlay("usr_host", 3, 1000);
      expect(hostPlayRes.success).toBe(true);
    });

    it("allows non-host playback when controlMode is toggled to public", () => {
      const room = new Room({
        roomId: "room_perm2",
        roomCode: "PERM02",
        roomName: "Collaborative Room",
        hostUserId: "usr_host",
        hostUserName: "Host",
        controlMode: "host_only",
      });

      const { member: guest } = room.addMember("Guest");

      // Non-host attempts to toggle setting -> rejected
      const guestToggle = room.updateSettings(guest.userId, 1, "public");
      expect(guestToggle.success).toBe(false);

      // Host toggles setting to public
      const hostToggle = room.updateSettings("usr_host", 2, "public");
      expect(hostToggle.success).toBe(true);
      expect(room.controlMode).toBe("public");

      // Guest can now play
      const guestPlay = room.applyPlay(guest.userId, 3, 2000);
      expect(guestPlay.success).toBe(true);
    });
  });

  describe("Concurrency & Total Order by Arrival", () => {
    it("processes simultaneous seek and play commands deterministically in FIFO order", async () => {
      const room = new Room({
        roomId: "room_concurrency",
        roomCode: "CONCUR",
        roomName: "Race Condition Lab",
        hostUserId: "usr_host",
        hostUserName: "Host",
        controlMode: "public",
      });

      const { member: userA } = room.addMember("UserA");
      const { member: userB } = room.addMember("UserB");
      const { member: userC } = room.addMember("UserC");

      // Trigger 10 simultaneous actions asynchronously from different users
      const actions = [
        () => room.applySeek(userA.userId, 1, 10000),
        () => room.applyPlay(userB.userId, 2),
        () => room.applySeek(userC.userId, 3, 25000),
        () => room.applyPause(userA.userId, 4),
        () => room.applyPlay(userB.userId, 5),
        () => room.applySeek(userC.userId, 6, 40000),
        () => room.applyPause(userA.userId, 7),
        () => room.applyPlay(userB.userId, 8),
        () => room.applySeek(userC.userId, 9, 60000),
        () => room.applyPause(userA.userId, 10, 60000),
      ];

      const initialVersion = room.version;
      const results = await Promise.all(actions.map((act) => room.enqueueAction(act)));

      expect(results).toHaveLength(10);
      // Room version must increment by exactly 10
      expect(room.version).toBe(initialVersion + 10);
      expect(room.playback.status).toBe("paused");
      expect(room.playback.positionMs).toBe(60000);
    });
  });

  describe("Late Join Flow", () => {
    it("provides late joiner with snapshot allowing immediate derivation of playing position", () => {
      const room = new Room({
        roomId: "room_late",
        roomCode: "LATE01",
        roomName: "Late Join Room",
        hostUserId: "usr_host",
        hostUserName: "Host",
      });

      // Play started at position 10,000ms
      room.applyPlay("usr_host", 1, 10000);
      const playStartServerTime = room.playback.serverTimeMs;

      // 15 seconds pass
      vi.advanceTimersByTime(15000);
      const currentServerTime = playStartServerTime + 15000;

      // Late joiner arrives
      const { member: lateJoiner, sessionToken } = room.addMember("LateJoiner");
      const snapshot = room.getSnapshot(lateJoiner.userId, sessionToken);

      expect(snapshot.playback.status).toBe("playing");
      expect(snapshot.playback.positionMs).toBe(10000);
      expect(snapshot.playback.serverTimeMs).toBe(playStartServerTime);

      // Client computes derived position using snapshot:
      const derived = derivePlaybackPositionMs(snapshot.playback, currentServerTime);
      expect(derived).toBe(25000); // 10000 + 15000
    });
  });

  describe("Reconnection & Ring Buffer Replay", () => {
    it("reconnects a member using sessionToken and replays missed events from ring buffer", () => {
      const room = new Room({
        roomId: "room_recon",
        roomCode: "RECON1",
        roomName: "Reconnection Room",
        hostUserId: "usr_host",
        hostUserName: "Host",
      });

      const { member: bob, sessionToken } = room.addMember("Bob");
      const versionBeforeDisconnect = room.version;

      // Bob disconnects
      room.handleDisconnect(bob.userId);
      expect(room.getMember(bob.userId)?.isConnected).toBe(false);

      // While Bob is disconnected, 3 events occur
      room.applyPlay("usr_host", 10, 0);
      room.applySeek("usr_host", 11, 45000);
      room.applyPause("usr_host", 12, 45000);

      const { connection: newConn } = createMockConnection();

      // Bob reconnects with lastKnownVersion
      const reconResult = room.reconnectMember(sessionToken, newConn, versionBeforeDisconnect);
      expect(reconResult.success).toBe(true);
      if (reconResult.success) {
        expect(reconResult.member.userId).toBe(bob.userId);
        expect(reconResult.member.isConnected).toBe(true);
        expect(reconResult.missedEvents).not.toBeNull();
        expect(reconResult.missedEvents?.length).toBeGreaterThanOrEqual(3);
      }
    });

    it("rejects invalid session tokens", () => {
      const room = new Room({
        roomId: "room_recon2",
        roomCode: "RECON2",
        roomName: "Bad Token Test",
        hostUserId: "usr_host",
        hostUserName: "Host",
      });

      const res = room.reconnectMember("completely_bogus_token");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe(ERROR_CODES.INVALID_TOKEN);
      }
    });
  });

  describe("Host Transfer (Manual & Automatic)", () => {
    it("allows manual host transfer by current host", () => {
      const room = new Room({
        roomId: "room_ht1",
        roomCode: "HOST01",
        roomName: "Host Transfer",
        hostUserId: "usr_host",
        hostUserName: "Alice",
      });

      const { member: bob } = room.addMember("Bob");

      const transferRes = room.manualTransferHost("usr_host", 1, bob.userId);
      expect(transferRes.success).toBe(true);
      expect(room.hostId).toBe(bob.userId);
      expect(room.getMember("usr_host")?.isHost).toBe(false);
      expect(room.getMember(bob.userId)?.isHost).toBe(true);
    });

    it("automatically promotes longest-present member when host disconnects past grace period", () => {
      const room = new Room({
        roomId: "room_ht2",
        roomCode: "HOST02",
        roomName: "Auto Host",
        hostUserId: "usr_host",
        hostUserName: "Alice",
        hostGraceMs: 5000,
      });

      // Member 1 joins at t = 100
      vi.advanceTimersByTime(100);
      const { member: memberOldest } = room.addMember("Bob_Oldest");

      // Member 2 joins at t = 300
      vi.advanceTimersByTime(200);
      const { member: memberNewer } = room.addMember("Charlie_Newer");

      const { connection: c1 } = createMockConnection();
      const { connection: c2 } = createMockConnection();
      room.attachConnection(memberOldest.userId, c1);
      room.attachConnection(memberNewer.userId, c2);

      // Host disconnects
      room.handleDisconnect("usr_host");
      expect(room.hostId).toBe("usr_host"); // Still host during grace period

      // Advance time beyond grace period (5000ms)
      vi.advanceTimersByTime(5100);

      // Longest present member (Bob_Oldest) must now be promoted
      expect(room.hostId).toBe(memberOldest.userId);
      expect(room.getMember(memberOldest.userId)?.isHost).toBe(true);
      expect(room.getMember("usr_host")?.isHost).toBe(false);
    });

    it("cancels automatic promotion if host reconnects within grace period", () => {
      const room = new Room({
        roomId: "room_ht3",
        roomCode: "HOST03",
        roomName: "Grace Test",
        hostUserId: "usr_host",
        hostUserName: "Alice",
        hostGraceMs: 10000,
      });

      const hostSessionToken = room.getMember("usr_host")!.sessionToken;
      const { member: bob } = room.addMember("Bob");
      const { connection: c1 } = createMockConnection();
      room.attachConnection(bob.userId, c1);

      // Host disconnects
      room.handleDisconnect("usr_host");

      // Advance 5 seconds (halfway through 10s grace period)
      vi.advanceTimersByTime(5000);

      // Host reconnects
      const recon = room.reconnectMember(hostSessionToken);
      expect(recon.success).toBe(true);

      // Advance remaining time past original 10s
      vi.advanceTimersByTime(6000);

      // Alice remains host!
      expect(room.hostId).toBe("usr_host");
      expect(room.getMember("usr_host")?.isHost).toBe(true);
      expect(room.getMember(bob.userId)?.isHost).toBe(false);
    });
  });

  describe("Room Cleanup on Idle TTL", () => {
    it("destroys room and cleans up after idle TTL when all members disconnect", () => {
      const onDestroy = vi.fn();
      const room = new Room({
        roomId: "room_idle",
        roomCode: "IDLE01",
        roomName: "Idle Room",
        hostUserId: "usr_host",
        hostUserName: "Alice",
        idleTtlMs: 20000,
        onDestroy,
      });

      // Member joins and connects
      const { member: bob } = room.addMember("Bob");
      const { connection: c1 } = createMockConnection();
      room.attachConnection(bob.userId, c1);

      // Bob disconnects -> 0 connected members
      room.handleDisconnect(bob.userId);
      expect(onDestroy).not.toHaveBeenCalled();

      // Fast-forward past idle TTL
      vi.advanceTimersByTime(21000);
      expect(onDestroy).toHaveBeenCalledWith("room_idle");
    });
  });

  describe("RoomManager Operations", () => {
    it("creates unique rooms, resolves by code, and cleans up on demand", () => {
      const manager = new RoomManager();
      const r1 = manager.createRoom("Alice", "Movie Night 1");
      const r2 = manager.createRoom("Bob", "Movie Night 2");

      expect(r1.room.roomCode).not.toBe(r2.room.roomCode);
      expect(manager.getActiveRoomCount()).toBe(2);

      const found = manager.getRoomByCode(r1.room.roomCode);
      expect(found).toBeDefined();
      expect(found?.roomId).toBe(r1.room.roomId);

      manager.removeRoom(r1.room.roomId);
      expect(manager.getActiveRoomCount()).toBe(1);
      expect(manager.getRoomByCode(r1.room.roomCode)).toBeUndefined();
    });
  });
});
