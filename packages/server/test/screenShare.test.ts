import { describe, it, expect, vi, beforeEach } from "vitest";
import { Room, ActiveConnection } from "../src/rooms/Room.js";
import { ERROR_CODES, ServerMessage } from "@watchparty/shared";

function createMockConnection(): ActiveConnection {
  return {
    isAlive: true,
    send: vi.fn((_msg: ServerMessage) => {}),
    close: vi.fn(),
  };
}

describe("Screen Sharing Source & WebRTC Signalling", () => {
  let room: Room;
  const hostId = "user_host_1";
  let memberAliceId = "user_alice_2";
  let memberBobId = "user_bob_3";

  beforeEach(() => {
    room = new Room({
      roomId: "room_test_123",
      roomCode: "SCR123",
      roomName: "Screen Share Test Room",
      hostUserId: hostId,
      hostUserName: "Host User",
      controlMode: "host_only",
    });

    room.attachConnection(hostId, createMockConnection());

    const aliceRes = room.addMember("Alice", createMockConnection());
    if (aliceRes.success) {
      memberAliceId = aliceRes.member.userId;
    }

    const bobRes = room.addMember("Bob", createMockConnection());
    if (bobRes.success) {
      memberBobId = bobRes.member.userId;
    }
  });

  describe("1. Security & Permission Access Control", () => {
    it("allows the host to start screen share by default", () => {
      expect(room.canShareScreen(hostId)).toBe(true);

      const res = room.startScreenShare(hostId, 1, { title: "Host Presentation" });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.session.sharerUserId).toBe(hostId);
        expect(res.session.title).toBe("Host Presentation");
        expect(res.session.transportMode).toBe("mesh");
      }
    });

    it("rejects screen share from unapproved room members", () => {
      expect(room.canShareScreen(memberAliceId)).toBe(false);

      const res = room.startScreenShare(memberAliceId, 2, { title: "Alice Screen" });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe(ERROR_CODES.PERMISSION_DENIED);
        expect(res.message).toContain("Only the host or approved members");
      }
    });

    it("allows host to approve and revoke member screen sharing permissions", () => {
      // Non-host cannot approve permissions
      const unauthorizedApprove = room.approveScreenSharer(memberAliceId, 1, memberBobId);
      expect(unauthorizedApprove.success).toBe(false);
      if (!unauthorizedApprove.success) {
        expect(unauthorizedApprove.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      }

      // Host approves Alice
      const approveRes = room.approveScreenSharer(hostId, 2, memberAliceId);
      expect(approveRes.success).toBe(true);
      expect(room.canShareScreen(memberAliceId)).toBe(true);

      // Now Alice can start screen share
      const aliceStart = room.startScreenShare(memberAliceId, 3, { title: "Alice Demo" });
      expect(aliceStart.success).toBe(true);

      // Host revokes Alice's permission
      const revokeRes = room.revokeScreenSharer(hostId, 4, memberAliceId);
      expect(revokeRes.success).toBe(true);
      expect(room.canShareScreen(memberAliceId)).toBe(false);

      // Revoking actively sharing member automatically terminates the active session
      const snap = room.getSnapshot(memberAliceId);
      expect(snap.screenShare).toBeNull();
    });

    it("prevents viewers from sending WebRTC media offers (strictly recvonly)", () => {
      // Host starts sharing
      room.startScreenShare(hostId, 1);

      // Alice is a viewer and tries to send an offer (security violation)
      const viewerOffer = room.forwardWebRtcSignal(memberAliceId, hostId, "offer", { sdp: "dummy_sdp" });
      expect(viewerOffer.success).toBe(false);
      expect(viewerOffer.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      expect(viewerOffer.message).toContain("Viewers are not permitted to send media offers");

      // But Alice as a viewer can send an answer to the sharer
      const viewerAnswer = room.forwardWebRtcSignal(memberAliceId, hostId, "answer", { sdp: "answer_sdp" });
      expect(viewerAnswer.success).toBe(true);
    });
  });

  describe("2. Sharer is Clock & Live Edge Sync", () => {
    it("sets playback state to playing with live screenshare provider", () => {
      room.startScreenShare(hostId, 1, { title: "Live Streaming" });
      const snap = room.getSnapshot(hostId);

      expect(snap.playback.provider).toBe("screenshare");
      expect(snap.playback.status).toBe("playing");
      expect(snap.playback.positionMs).toBe(0);
      expect(snap.screenShare).not.toBeNull();
      expect(snap.screenShare?.title).toBe("Live Streaming");
    });

    it("resets playback to paused when screen share is stopped", () => {
      room.startScreenShare(hostId, 1);
      const stopRes = room.stopScreenShare(hostId, 2, "user_stopped");
      expect(stopRes.success).toBe(true);

      const snap = room.getSnapshot(hostId);
      expect(snap.screenShare).toBeNull();
      expect(snap.playback.status).toBe("paused");
    });
  });

  describe("3. Transport Mode Selection (Mesh vs SFU)", () => {
    it("selects mesh transport for rooms under 10 members", () => {
      expect(room.getSnapshot(hostId).members.length).toBeLessThan(10);
      const res = room.startScreenShare(hostId, 1);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.session.transportMode).toBe("mesh");
      }
    });

    it("selects SFU transport for rooms with 10 or more members", () => {
      // Add 8 more members to reach 11 total
      for (let i = 4; i <= 11; i++) {
        room.addMember(`User ${i}`, createMockConnection());
      }

      const res = room.startScreenShare(hostId, 1);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.session.transportMode).toBe("sfu");
      }
    });
  });

  describe("4. Disconnect Handling & Preemption", () => {
    it("automatically tears down active screen share if the sharer disconnects", () => {
      room.startScreenShare(hostId, 1);
      expect(room.getSnapshot(hostId).screenShare).not.toBeNull();

      // Sharer disconnects
      room.handleDisconnect(hostId);

      const snap = room.getSnapshot(memberAliceId);
      expect(snap.screenShare).toBeNull();
      expect(snap.playback.status).toBe("paused");
    });

    it("allows the host to preempt another member who is currently sharing", () => {
      // Host approves Alice
      room.approveScreenSharer(hostId, 1, memberAliceId);
      // Alice starts sharing
      room.startScreenShare(memberAliceId, 2, { title: "Alice's Screen" });
      expect(room.getSnapshot(hostId).screenShare?.sharerUserId).toBe(memberAliceId);

      // Bob tries to preempt Alice without being host
      room.approveScreenSharer(hostId, 3, memberBobId);
      const bobPreempt = room.startScreenShare(memberBobId, 4, { title: "Bob's Screen" });
      expect(bobPreempt.success).toBe(false);
      if (!bobPreempt.success) {
        expect(bobPreempt.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      }

      // Host can preempt Alice
      const hostPreempt = room.startScreenShare(hostId, 5, { title: "Host Takes Over" });
      expect(hostPreempt.success).toBe(true);
      expect(room.getSnapshot(hostId).screenShare?.sharerUserId).toBe(hostId);
    });
  });

  describe("5. Viewer Latency Metrics Tracking", () => {
    it("records and updates viewer latency metrics", () => {
      room.startScreenShare(hostId, 1);

      room.recordScreenShareMetrics(memberAliceId, {
        rttMs: 25,
        jitterMs: 1.8,
        packetLossPercent: 0.0,
        liveDelayMs: 38,
        bitrateBps: 2500000,
        fps: 30,
        resolution: "1920x1080",
      });

      const metrics = room.getScreenShareMetrics();
      expect(metrics.length).toBe(1);
      const aliceMetrics = metrics[0];
      expect(aliceMetrics?.rttMs).toBe(25);
      expect(aliceMetrics?.liveDelayMs).toBe(38);
    });
  });
});
