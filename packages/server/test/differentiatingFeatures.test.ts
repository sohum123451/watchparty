import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Room } from "../src/rooms/Room.js";
import { ERROR_CODES, MomentBookmark, ReadyCheck } from "@watchparty/shared";

describe("Differentiating Features (Server)", () => {
  let room: Room;
  const hostUserId = "user-host-1";

  beforeEach(() => {
    vi.useFakeTimers();
    room = new Room({
      roomId: "room-diff-1",
      roomCode: "DIFF99",
      roomName: "Differentiating Features Room",
      hostUserId,
      hostUserName: "AliceHost",
      baseUrl: "http://localhost:3000",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Feature 2: Ready-check Synchronized Countdown Start", () => {
    it("should initiate ready-check countdown and trigger synchronized playback at target time", () => {
      let countdownBroadcast: any = null;
      let playUpdateBroadcast: any = null;
      const fakeConn = {
        send: (msg: any) => {
          if (msg.type === "READY_CHECK_COUNTDOWN") {
            countdownBroadcast = msg;
          }
          if (msg.type === "PLAYBACK_UPDATE") {
            playUpdateBroadcast = msg;
          }
        },
        close: () => {},
        isAlive: true,
      };

      const { member } = room.addMember("Bob", fakeConn);
      const res = room.startReadyCheck(hostUserId, 1, 3000, 45000);

      expect(res.success).toBe(true);
      expect(room.readyCheck).not.toBeNull();
      expect(room.readyCheck?.active).toBe(true);
      expect(room.readyCheck?.countdownMs).toBe(3000);
      expect(room.readyCheck?.startPositionMs).toBe(45000);

      expect(countdownBroadcast).not.toBeNull();
      expect(countdownBroadcast.payload.countdownMs).toBe(3000);

      // System message emitted
      expect(
        room.chatHistory.some((m) => m.isSystem && m.text.includes("Synchronized start in 3s"))
      ).toBe(true);

      // Advance time by 3 seconds
      vi.advanceTimersByTime(3000);

      // Ready check completed and triggered play
      expect(room.readyCheck?.active).toBe(false);
      expect(room.playback.status).toBe("playing");
      expect(room.playback.positionMs).toBe(45000);
      expect(
        room.chatHistory.some((m) => m.isSystem && m.text.includes("Playback synchronized for everyone"))
      ).toBe(true);
    });

    it("should allow cancelling an active ready check", () => {
      let cancelBroadcast: any = null;
      const fakeConn = {
        send: (msg: any) => {
          if (msg.type === "READY_CHECK_CANCEL") {
            cancelBroadcast = msg;
          }
        },
        close: () => {},
        isAlive: true,
      };

      room.addMember("Charlie", fakeConn);
      room.startReadyCheck(hostUserId, 1, 3000, 10000);
      expect(room.readyCheck?.active).toBe(true);

      room.cancelReadyCheck(hostUserId, "Host paused countdown");
      expect(room.readyCheck).toBeNull();
      expect(cancelBroadcast).not.toBeNull();
      expect(cancelBroadcast.payload.reason).toBe("Host paused countdown");

      // Verify timer does not fire play
      vi.advanceTimersByTime(3000);
      expect(room.playback.status).toBe("paused");
    });
  });

  describe("Feature 3: Shared Moment Bookmarks", () => {
    it("should pin notes at timestamps, persist in snapshot, and format system notifications", () => {
      const { member, sessionToken } = room.addMember("Dave");

      const res = room.addBookmark(
        member.userId,
        1,
        "video-1",
        75400, // 01:15
        "Awesome plot twist right here!",
        "#ec4899"
      );

      expect(res.success).toBe(true);
      expect(room.bookmarks.length).toBe(1);

      const bmk = room.bookmarks[0];
      expect(bmk.timestampMs).toBe(75400);
      expect(bmk.text).toBe("Awesome plot twist right here!");
      expect(bmk.userName).toBe("Dave");
      expect(bmk.color).toBe("#ec4899");

      // Formatted timestamp in system message: 01:15
      expect(
        room.chatHistory.some((m) => m.isSystem && m.text.includes("pinned a moment at 1:15"))
      ).toBe(true);

      // Verify snapshot persistence for reconnects
      const snapshot = room.getSnapshot(member.userId, sessionToken);
      expect(snapshot.bookmarks.length).toBe(1);
      expect(snapshot.bookmarks[0].id).toBe(bmk.id);

      // Remove bookmark
      const removeRes = room.removeBookmark(member.userId, 2, bmk.id);
      expect(removeRes.success).toBe(true);
      expect(room.bookmarks.length).toBe(0);
    });
  });

  describe("Feature 5: Live Sync-Health Telemetry Panel", () => {
    it("should aggregate member metrics and compute p50, p95 drift, RTT and coherence score", () => {
      const fakeConn = { send: () => {}, close: () => {}, isAlive: true };
      room.attachConnection(hostUserId, fakeConn);
      const { member: m1 } = room.addMember("Peer1", fakeConn);
      const { member: m2 } = room.addMember("Peer2", fakeConn);
      const { member: m3 } = room.addMember("Peer3", fakeConn);

      // Peer 1: drift 20ms, RTT 30ms
      room.recordMemberMetrics(m1.userId, {
        rttMs: 30,
        clockOffsetMs: 5,
        driftMs: 20,
        playbackRate: 1.0,
        isBuffering: false,
      });

      // Peer 2: drift 45ms, RTT 50ms
      room.recordMemberMetrics(m2.userId, {
        rttMs: 50,
        clockOffsetMs: -10,
        driftMs: 45,
        playbackRate: 1.02,
        isBuffering: false,
      });

      // Peer 3: drift 110ms, RTT 80ms
      room.recordMemberMetrics(m3.userId, {
        rttMs: 80,
        clockOffsetMs: 15,
        driftMs: 110,
        playbackRate: 0.95,
        isBuffering: false,
      });

      const summary = room.getSyncHealthSummary();

      expect(summary.totalMembers).toBe(4); // Host + 3 peers
      expect(summary.maxDriftMs).toBe(110);
      expect(summary.p50DriftMs).toBeGreaterThanOrEqual(0);
      expect(summary.p95DriftMs).toBeGreaterThanOrEqual(45);
      expect(summary.averageRttMs).toBeGreaterThan(0);
      expect(summary.syncCoherenceScore).toBeGreaterThan(80);
      expect(summary.bufferingCount).toBe(0);
    });
  });
});
