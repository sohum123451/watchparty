import { describe, it, expect, beforeEach, vi } from "vitest";
import { Room } from "../src/rooms/Room.js";
import { ERROR_CODES, ChatMessage, ReactionBurst, PlaylistItem, PollSummary } from "@watchparty/shared";

describe("Room Social Layer (Server)", () => {
  let room: Room;
  const hostUserId = "user-host-1";
  const guestUserId = "user-guest-2";

  beforeEach(() => {
    room = new Room({
      roomId: "room-social-1",
      roomCode: "ABC234",
      roomName: "Social Test Room",
      hostUserId,
      hostUserName: "HostAlice",
      baseUrl: "http://localhost:3000",
    });
  });

  describe("Emoji Reactions", () => {
    it("should broadcast reactions and store them with video timestamp", () => {
      let broadcastCount = 0;
      let lastBroadcastMessage: any = null;
      const fakeConn = {
        send: (msg: any) => {
          broadcastCount++;
          lastBroadcastMessage = msg;
        },
        close: () => {},
        isAlive: true,
      };

      const { member } = room.addMember("Bob", fakeConn);
      const bobId = member.userId;

      const ok = room.broadcastReaction(bobId, "🔥", 45200);
      expect(ok).toBe(true);

      expect(room.storedReactions.length).toBe(1);
      expect(room.storedReactions[0].emoji).toBe("🔥");
      expect(room.storedReactions[0].videoTimestampMs).toBe(45200);
      expect(room.storedReactions[0].userId).toBe(bobId);
      expect(room.storedReactions[0].userName).toBe("Bob");

      expect(lastBroadcastMessage.type).toBe("REACTION_BROADCAST");
      expect(lastBroadcastMessage.payload.reaction.emoji).toBe("🔥");
    });

    it("should throttle reactions exceeding 5 per 2 seconds per user", () => {
      const { member } = room.addMember("Charlie");
      const charlieId = member.userId;

      // First 5 should succeed
      for (let i = 0; i < 5; i++) {
        const ok = room.broadcastReaction(charlieId, "❤️", 1000 * i);
        expect(ok).toBe(true);
      }

      // 6th should be throttled
      const throttled = room.broadcastReaction(charlieId, "❤️", 6000);
      expect(throttled).toBe(false);
      expect(room.storedReactions.length).toBe(5);
    });

    it("should persist stored reactions into room snapshot for reconnects", () => {
      const { member, sessionToken } = room.addMember("Dave");
      room.broadcastReaction(member.userId, "🎉", 12000);
      room.broadcastReaction(member.userId, "🚀", 15000);

      const snapshot = room.getSnapshot(member.userId, sessionToken);
      expect(snapshot.storedReactions.length).toBe(2);
      expect(snapshot.storedReactions[0].emoji).toBe("🎉");
      expect(snapshot.storedReactions[1].emoji).toBe("🚀");
    });
  });

  describe("Live Chat & System Messages", () => {
    it("should record message history up to 100 messages", () => {
      for (let i = 1; i <= 105; i++) {
        const { member } = room.addMember(`User_${i}`);
        const res = room.broadcastChat(member.userId, 1, `Message ${i}`);
        expect(res.success).toBe(true);
      }

      expect(room.chatHistory.length).toBe(100);
      expect(room.chatHistory[99].text).toBe("Message 105");
    });

    it("should rate limit chat messages if user exceeds burst threshold", () => {
      const { member } = room.addMember("Frank");

      for (let i = 1; i <= 5; i++) {
        const res = room.broadcastChat(member.userId, i, `Burst ${i}`);
        expect(res.success).toBe(true);
      }

      const res6 = room.broadcastChat(member.userId, 6, "Burst 6");
      expect(res6.success).toBe(false);
      if (!res6.success) {
        expect(res6.code).toBe(ERROR_CODES.RATE_LIMITED);
      }
    });

    it("should sanitize chat text against XSS attacks", () => {
      const { member } = room.addMember("Grace");
      const malicious = '<script>alert("hack")</script><img src=x onerror=alert(1)>';

      const res = room.broadcastChat(member.userId, 1, malicious);
      expect(res.success).toBe(true);

      const saved = room.chatHistory[room.chatHistory.length - 1];
      expect(saved.text).not.toContain("<script>");
      expect(saved.text).toContain("&lt;script&gt;");
    });

    it("should emit system messages for join, leave, and host transfer", () => {
      const initialCount = room.chatHistory.length;

      // 1. Join
      const { member } = room.addMember("Heidi");
      expect(room.chatHistory.some((m) => m.isSystem && m.text.includes("Heidi joined the party"))).toBe(true);

      // 2. Transfer host
      room.manualTransferHost(hostUserId, 1, member.userId);
      expect(room.chatHistory.some((m) => m.isSystem && m.text.includes("transferred host controls to Heidi"))).toBe(true);

      // 3. Leave
      room.removeMember(member.userId);
      expect(room.chatHistory.some((m) => m.isSystem && m.text.includes("Heidi left the party"))).toBe(true);
    });

    it("should broadcast typing indicators to other members", () => {
      let receivedTyping: any = null;
      const fakeConn = {
        send: (msg: any) => {
          if (msg.type === "CHAT_TYPING_BROADCAST") {
            receivedTyping = msg;
          }
        },
        close: () => {},
        isAlive: true,
      };

      const { member: member1 } = room.addMember("Ivan", fakeConn);
      const { member: member2 } = room.addMember("Judy");

      room.broadcastTyping(member2.userId, true);
      expect(receivedTyping).not.toBeNull();
      expect(receivedTyping.payload.userId).toBe(member2.userId);
      expect(receivedTyping.payload.userName).toBe("Judy");
      expect(receivedTyping.payload.isTyping).toBe(true);
    });
  });

  describe("Shared Playlist & Auto-Advance", () => {
    it("should add playlist items with monotonic fractional index order", () => {
      const res1 = room.addPlaylistItem(hostUserId, 1, "video-1", "Video One", 120000);
      const res2 = room.addPlaylistItem(hostUserId, 2, "video-2", "Video Two", 180000);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(room.playlist.length).toBe(3); // Initial demo item + 2

      const item1 = room.playlist[1];
      const item2 = room.playlist[2];
      expect(item1.order).toBeDefined();
      expect(item2.order).toBeDefined();
      expect(item2.order!).toBeGreaterThan(item1.order!);
    });

    it("should handle simultaneous reorders deterministically using fractional indexing", () => {
      room.playlist = [
        { id: "pl-1", videoId: "v1", title: "Item 1", durationMs: 1000, addedByUserId: "u1", addedByUserName: "U1", order: 1000 },
        { id: "pl-2", videoId: "v2", title: "Item 2", durationMs: 1000, addedByUserId: "u1", addedByUserName: "U1", order: 2000 },
        { id: "pl-3", videoId: "v3", title: "Item 3", durationMs: 1000, addedByUserId: "u1", addedByUserName: "U1", order: 3000 },
      ];

      // User A moves Item 3 between Item 1 and Item 2 -> order = 1500
      room.reorderPlaylistItem(hostUserId, 10, "pl-3", 1, 1500);

      expect(room.playlist.map((p) => p.id)).toEqual(["pl-1", "pl-3", "pl-2"]);

      // User B simultaneously moves Item 2 before Item 1 -> order = 500
      room.reorderPlaylistItem(hostUserId, 11, "pl-2", 0, 500);

      expect(room.playlist.map((p) => p.id)).toEqual(["pl-2", "pl-1", "pl-3"]);
    });

    it("should reject reorder when expectedVersion does not match and no fractional index provided", () => {
      room.playlist = [
        { id: "pl-1", videoId: "v1", title: "Item 1", durationMs: 1000, addedByUserId: "u1", addedByUserName: "U1", order: 1000 },
        { id: "pl-2", videoId: "v2", title: "Item 2", durationMs: 1000, addedByUserId: "u1", addedByUserName: "U1", order: 2000 },
      ];

      const res = room.reorderPlaylistItem(hostUserId, 1, "pl-2", 0, undefined, 9999);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.code).toBe(ERROR_CODES.INVALID_ACTION);
      }
    });

    it("should auto-advance to next playlist item when playback ends", () => {
      room.playlist = [
        { id: "pl-1", videoId: "bunny", title: "Bunny", durationMs: 10000, addedByUserId: "u1", addedByUserName: "U1", order: 1000 },
        { id: "pl-2", videoId: "sintel", title: "Sintel", durationMs: 20000, addedByUserId: "u1", addedByUserName: "U1", order: 2000 },
      ];
      room.playback.videoId = "bunny";
      room.playback.status = "playing";

      const res = room.advancePlaylist(hostUserId, 20, "bunny");
      expect(res.success).toBe(true);
      expect(res.nextVideoId).toBe("sintel");
      expect(room.playback.videoId).toBe("sintel");
      expect(room.playback.status).toBe("playing");
      expect(room.playback.positionMs).toBe(0);

      // System message emitted for Up Next
      expect(room.chatHistory.some((m) => m.isSystem && m.text.includes('Up next: "Sintel"'))).toBe(true);
    });
  });

  describe("Group Polls & Auto-Queue", () => {
    it("should create poll and allow one vote per user (changeable until close)", () => {
      const { member: m1 } = room.addMember("Voter1");
      const { member: m2 } = room.addMember("Voter2");

      const res = room.createPoll(
        m1.userId,
        1,
        "What to watch next?",
        ["Inception", "Interstellar"],
        30,
        false
      );
      expect(res.success).toBe(true);
      expect(room.activePoll).not.toBeNull();

      const pollId = room.activePoll!.id;

      // Voter 2 votes for Inception (index 0)
      const v1 = room.votePoll(m2.userId, 1, pollId, 0);
      expect(v1.success).toBe(true);
      expect(room.activePoll!.options[0].votes).toBe(1);

      // Voter 2 changes vote to Interstellar (index 1)
      const v2 = room.votePoll(m2.userId, 2, pollId, 1);
      expect(v2.success).toBe(true);
      expect(room.activePoll!.options[0].votes).toBe(0);
      expect(room.activePoll!.options[1].votes).toBe(1);
    });

    it("should close poll and auto-queue winner when autoQueueWinner is enabled", () => {
      const { member: m1 } = room.addMember("PollCreator");

      // We use a movie title that exists in MOVIE_CATALOGUE
      room.createPoll(
        m1.userId,
        1,
        "Next movie?",
        ["Inception", "Fake Movie"],
        30,
        true
      );
      const pollId = room.activePoll!.id;

      // Vote for Inception
      room.votePoll(m1.userId, 2, pollId, 0);

      const initialPlaylistCount = room.playlist.length;

      // Close poll
      room.closePoll(pollId);

      expect(room.activePoll!.isClosed).toBe(true);
      expect(room.chatHistory.some((m) => m.isSystem && m.text.includes('"Inception" won'))).toBe(true);

      // Should auto-queue Inception into playlist
      expect(room.playlist.length).toBe(initialPlaylistCount + 1);
      expect(room.playlist[room.playlist.length - 1].title).toBe("Inception");
    });
  });

  describe("Member List & Snapshots", () => {
    it("should track member roles, ready/buffering status, and host badge", () => {
      const { member: m1 } = room.addMember("Member1");
      expect(m1.isHost).toBe(false);

      // Start playback first so buffering stalls room
      room.applyPlay(hostUserId, 1, 1000);
      // Buffering update
      room.applyBufferReport(m1.userId, true);
      expect(room.playback.status).toBe("buffering");

      // Reconnect snapshot test
      const snapshot = room.getSnapshot(m1.userId, m1.sessionToken);
      expect(snapshot.hostId).toBe(hostUserId);
      const hostMember = snapshot.members.find((m) => m.userId === hostUserId);
      expect(hostMember?.isHost).toBe(true);

      const guestMember = snapshot.members.find((m) => m.userId === m1.userId);
      expect(guestMember?.isBuffering).toBe(true);
      expect(guestMember?.isHost).toBe(false);
    });
  });
});
