import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ChatManager,
  ReactionManager,
  PlaylistManager,
  PollManager,
  MemberManager,
  SocialClient,
} from "../src/index.js";
import { RoomSnapshot, ChatMessage, ReactionBurst, PlaylistItem, PollSummary } from "@watchparty/shared";

describe("Client Social Layer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ChatManager", () => {
    it("should retain only the latest 100 messages in history", () => {
      const chat = new ChatManager();
      const initial: ChatMessage[] = Array.from({ length: 120 }, (_, i) => ({
        id: `msg-${i}`,
        userId: "u1",
        userName: "Alice",
        text: `Message ${i}`,
        serverTimestampMs: 1000 + i,
      }));

      chat.initHistory(initial);
      const messages = chat.getMessages();
      expect(messages.length).toBe(100);
      expect(messages[0].text).toBe("Message 20");
      expect(messages[99].text).toBe("Message 119");
    });

    it("should clear typing indicator after 3 seconds of inactivity", () => {
      const chat = new ChatManager();
      let typingList: string[] = [];
      chat.subscribeTyping((users) => {
        typingList = users;
      });

      chat.handleIncomingTyping("user-2", "Bob", true);
      expect(typingList).toEqual(["Bob"]);

      // Advance by 2.9 seconds -> still typing
      vi.advanceTimersByTime(2900);
      expect(typingList).toEqual(["Bob"]);

      // Advance past 3 seconds -> cleared
      vi.advanceTimersByTime(200);
      expect(typingList).toEqual([]);
    });

    it("should throttle outgoing messages exceeding 5 per 3 seconds", async () => {
      const chat = new ChatManager();

      for (let i = 0; i < 5; i++) {
        const res = await chat.send(`Hello ${i}`);
        expect(res.success).toBe(true);
      }

      const res6 = await chat.send("Hello 6");
      expect(res6.success).toBe(false);
      expect(res6.error).toContain("too fast");

      // Advance time past 3 seconds window
      vi.advanceTimersByTime(3100);
      const res7 = await chat.send("Hello 7");
      expect(res7.success).toBe(true);
    });

    it("should safely render HTML without XSS injection vulnerabilities", () => {
      const maliciousMsg: ChatMessage = {
        id: "msg-bad",
        userId: "u2",
        userName: 'Eve<img src=x onerror="alert(1)">',
        text: 'Hello <script>alert("hacked")</script> <b>World</b>',
        serverTimestampMs: 1700000000000,
      };

      const html = ChatManager.renderSafeHtml(maliciousMsg);
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&lt;img");

      const systemMsg: ChatMessage = {
        id: "msg-sys",
        userId: "system",
        userName: "System",
        text: "Alice joined the party",
        serverTimestampMs: 1700000000000,
        isSystem: true,
      };
      const sysHtml = ChatManager.renderSafeHtml(systemMsg);
      expect(sysHtml).toContain("SYSTEM");
      expect(sysHtml).toContain("chat-system-message");
    });
  });

  describe("ReactionManager", () => {
    it("should throttle outgoing reaction bursts exceeding 5 per 2 seconds", () => {
      const reactions = new ReactionManager();
      for (let i = 0; i < 5; i++) {
        const ok = reactions.emit("🔥", 1000 * i);
        expect(ok).toBe(true);
      }

      const ok6 = reactions.emit("🔥", 6000);
      expect(ok6).toBe(false);

      vi.advanceTimersByTime(2100);
      const ok7 = reactions.emit("🔥", 7000);
      expect(ok7).toBe(true);
    });

    it("should simulate floating particle motion, scale pop-in, and opacity fade", () => {
      const reactions = new ReactionManager();
      const p = reactions.spawnParticle("🍿", "Alice", { lifetimeMs: 2000 });

      expect(p.yPercent).toBeGreaterThanOrEqual(90);
      expect(p.opacity).toBe(1.0);
      expect(p.scale).toBe(0.6);

      // Step physics by 0.5s (progress = 0.25)
      reactions.step(0.5);
      expect(p.yPercent).toBeLessThan(90); // Floated up
      expect(p.scale).toBeGreaterThan(0.6); // Popped in
      expect(p.opacity).toBe(1.0);

      // Step physics by 1.0s (total age = 1.5s, progress = 0.75 > 0.6)
      reactions.step(1.0);
      expect(p.opacity).toBeLessThan(1.0); // Fading out
      expect(p.opacity).toBeGreaterThan(0);

      // Step physics past end of lifetime (total age = 2.5s > 2.0s)
      reactions.step(1.0);
      expect(reactions.getActiveParticles().find((item) => item.id === p.id)).toBeUndefined();
    });

    it("should build accurate reaction timeline heatmap for scrubber bar", () => {
      const reactions = new ReactionManager();
      const bursts: ReactionBurst[] = [
        { id: "r1", userId: "u1", userName: "A", emoji: "❤️", videoTimestampMs: 2000 },
        { id: "r2", userId: "u2", userName: "B", emoji: "❤️", videoTimestampMs: 4000 },
        { id: "r3", userId: "u3", userName: "C", emoji: "🔥", videoTimestampMs: 4500 },
        { id: "r4", userId: "u1", userName: "A", emoji: "😂", videoTimestampMs: 12000 },
      ];

      reactions.initStoredReactions(bursts);
      // Video length 20s, bucket size 5s (0-5s, 5-10s, 10-15s, 15-20s)
      const heatmap = reactions.buildTimelineHeatmap(20000, 5000);

      expect(heatmap.length).toBe(4);
      // Bucket 0 (0-5s) has 3 reactions (peak)
      expect(heatmap[0].count).toBe(3);
      expect(heatmap[0].intensity).toBe(1.0);
      expect(heatmap[0].topEmoji).toBe("❤️");

      // Bucket 1 (5-10s) has 0 reactions
      expect(heatmap[1].count).toBe(0);
      expect(heatmap[1].intensity).toBe(0);

      // Bucket 2 (10-15s) has 1 reaction -> 1 / 3 intensity
      expect(heatmap[2].count).toBe(1);
      expect(heatmap[2].intensity).toBeCloseTo(0.333, 2);
      expect(heatmap[2].topEmoji).toBe("😂");
    });
  });

  describe("PlaylistManager", () => {
    it("should calculate fractional index when inserting at top, middle, and bottom", () => {
      const playlist = new PlaylistManager();
      const initial: PlaylistItem[] = [
        { id: "p1", videoId: "v1", title: "V1", durationMs: 1000, addedByUserId: "u1", addedByUserName: "A", order: 1000 },
        { id: "p2", videoId: "v2", title: "V2", durationMs: 1000, addedByUserId: "u1", addedByUserName: "A", order: 2000 },
        { id: "p3", videoId: "v3", title: "V3", durationMs: 1000, addedByUserId: "u1", addedByUserName: "A", order: 3000 },
      ];
      playlist.initPlaylist(initial, 1);

      // 1. Move p3 to top (index 0)
      const topRes = playlist.computeFractionalIndex("p3", 0);
      expect(topRes.order).toBe(500); // 1000 / 2

      // 2. Move p1 to bottom (after p3)
      const botRes = playlist.computeFractionalIndex("p1", 2);
      expect(botRes.order).toBe(4000); // 3000 + 1000

      // 3. Move p3 between p1 (1000) and p2 (2000)
      const midRes = playlist.computeFractionalIndex("p3", 1);
      expect(midRes.order).toBe(1500); // (1000 + 2000) / 2
    });

    it("should rollback optimistic reordering if server rejects", async () => {
      const playlist = new PlaylistManager({
        initialPlaylist: [
          { id: "p1", videoId: "v1", title: "V1", durationMs: 1000, addedByUserId: "u1", addedByUserName: "A", order: 1000 },
          { id: "p2", videoId: "v2", title: "V2", durationMs: 1000, addedByUserId: "u1", addedByUserName: "A", order: 2000 },
        ],
        handlers: {
          onReorder: () => Promise.resolve(false), // Rejection
        },
      });

      const res = await playlist.reorder("p2", 0);
      expect(res.success).toBe(false);
      // Playlist should have rolled back to initial order
      expect(playlist.getPlaylist().map((p) => p.id)).toEqual(["p1", "p2"]);
    });

    it("should identify next playlist item and trigger playback ended auto-advance", async () => {
      let endedReportedVideoId = "";
      const playlist = new PlaylistManager({
        initialPlaylist: [
          { id: "p1", videoId: "bunny", title: "Bunny", durationMs: 1000, addedByUserId: "u1", addedByUserName: "A", order: 1000 },
          { id: "p2", videoId: "sintel", title: "Sintel", durationMs: 1000, addedByUserId: "u1", addedByUserName: "A", order: 2000 },
        ],
        handlers: {
          onPlaybackEnded: (vid) => {
            endedReportedVideoId = vid;
            return true;
          },
        },
      });

      const next = playlist.getNextItem("bunny");
      expect(next?.videoId).toBe("sintel");

      await playlist.handlePlaybackEnded("bunny");
      expect(endedReportedVideoId).toBe("bunny");
    });
  });

  describe("PollManager", () => {
    it("should allow one vote per user and support changing vote before close", async () => {
      let votedOptionIndex = -1;
      const pollMgr = new PollManager({
        handlers: {
          onVote: (pollId, idx) => {
            votedOptionIndex = idx;
            return true;
          },
        },
      });

      const samplePoll: PollSummary = {
        id: "poll-1",
        question: "What next?",
        options: [
          { id: "opt-1", text: "Movie A", votes: 0 },
          { id: "opt-2", text: "Movie B", votes: 0 },
        ],
        expiresAtServerTimeMs: Date.now() + 10000,
        isClosed: false,
      };

      pollMgr.initPoll(samplePoll);

      // Vote Movie A (index 0)
      await pollMgr.vote(0);
      expect(pollMgr.getActivePoll()?.options[0].votes).toBe(1);
      expect(pollMgr.getActivePoll()?.userVotedOptionId).toBe("opt-1");
      expect(votedOptionIndex).toBe(0);

      // Switch vote to Movie B (index 1)
      await pollMgr.vote(1);
      expect(pollMgr.getActivePoll()?.options[0].votes).toBe(0);
      expect(pollMgr.getActivePoll()?.options[1].votes).toBe(1);
      expect(pollMgr.getActivePoll()?.userVotedOptionId).toBe("opt-2");
      expect(votedOptionIndex).toBe(1);
    });

    it("should prevent voting on closed polls", async () => {
      const pollMgr = new PollManager();
      pollMgr.initPoll({
        id: "poll-closed",
        question: "Done?",
        options: [{ id: "o1", text: "Yes", votes: 1 }],
        expiresAtServerTimeMs: Date.now() - 1000,
        isClosed: true,
      });

      const res = await pollMgr.vote(0);
      expect(res.success).toBe(false);
      expect(res.error).toContain("closed");
    });
  });

  describe("MemberManager", () => {
    it("should sort host first, then connected, then by joinedAt", () => {
      const members = new MemberManager();
      members.initMembers(
        [
          { userId: "u2", userName: "Bob", isHost: false, isConnected: true, isBuffering: false, joinedAt: 200 },
          { userId: "u1", userName: "Alice", isHost: true, isConnected: true, isBuffering: false, joinedAt: 100 },
          { userId: "u3", userName: "Charlie", isHost: false, isConnected: false, isBuffering: false, joinedAt: 150 },
        ],
        "u1"
      );

      const sorted = members.getMembers();
      expect(sorted[0].userId).toBe("u1"); // Host first
      expect(sorted[1].userId).toBe("u2"); // Connected second
      expect(sorted[2].userId).toBe("u3"); // Disconnected last
    });

    it("should detect buffering members and update host transfers", () => {
      const members = new MemberManager();
      members.initMembers(
        [
          { userId: "u1", userName: "Alice", isHost: true, isConnected: true, isBuffering: false, joinedAt: 100 },
          { userId: "u2", userName: "Bob", isHost: false, isConnected: true, isBuffering: false, joinedAt: 200 },
        ],
        "u1"
      );

      // Bob starts buffering
      members.handleBufferReport("u2", true);
      expect(members.getBufferingMembers().map((m) => m.userId)).toEqual(["u2"]);

      // Transfer host to Bob
      members.handleHostChanged("u2");
      expect(members.getHost()?.userId).toBe("u2");
      expect(members.getMember("u1")?.isHost).toBe(false);
      expect(members.getMember("u2")?.isHost).toBe(true);
    });
  });

  describe("SocialClient Unified Orchestration", () => {
    it("should restore full social state on snapshot (reconnect survival)", () => {
      let sentMessage: any = null;
      const client = new SocialClient({
        wsSender: (msg) => {
          sentMessage = msg;
        },
      });

      const snapshot: RoomSnapshot = {
        roomId: "room-123",
        roomCode: "XYZ987",
        roomName: "Reconnected Room",
        inviteUrl: "http://localhost:3000/join/XYZ987",
        hostId: "u-host",
        version: 42,
        controlMode: "public",
        members: [
          { userId: "u-host", userName: "HostUser", isHost: true, isConnected: true, isBuffering: false, joinedAt: 1000 },
          { userId: "u-self", userName: "Me", isHost: false, isConnected: true, isBuffering: true, joinedAt: 2000 },
        ],
        playback: { videoId: "bunny", status: "playing", positionMs: 15000, serverTimeMs: Date.now(), playbackRate: 1.0 },
        playlist: [
          { id: "pl-1", videoId: "bunny", title: "Bunny", durationMs: 60000, addedByUserId: "u-host", addedByUserName: "HostUser", order: 1000 },
        ],
        activePoll: {
          id: "poll-active",
          question: "Like it?",
          options: [{ id: "o1", text: "Yes", votes: 3 }],
          expiresAtServerTimeMs: Date.now() + 15000,
          isClosed: false,
        },
        chatHistory: [
          { id: "m1", userId: "u-host", userName: "HostUser", text: "Welcome back!", serverTimestampMs: Date.now() },
        ],
        storedReactions: [
          { id: "r1", userId: "u-host", userName: "HostUser", emoji: "👋", videoTimestampMs: 5000 },
        ],
        selfUserId: "u-self",
        reconnectToken: "token-secret-999",
        serverTimeMs: Date.now(),
      };

      // Apply snapshot (simulating reconnect)
      client.applySnapshot(snapshot);

      expect(client.roomId).toBe("room-123");
      expect(client.roomCode).toBe("XYZ987");
      expect(client.sessionToken).toBe("token-secret-999");
      expect(client.version).toBe(42);

      // Verify chat was hydrated
      expect(client.chat.getMessages().length).toBe(1);
      expect(client.chat.getMessages()[0].text).toBe("Welcome back!");

      // Verify stored reactions were hydrated
      expect(client.reactions.getStoredReactions().length).toBe(1);
      expect(client.reactions.getStoredReactions()[0].emoji).toBe("👋");

      // Verify playlist was hydrated
      expect(client.playlist.getPlaylist().length).toBe(1);
      expect(client.playlist.getPlaylist()[0].title).toBe("Bunny");

      // Verify poll was hydrated
      expect(client.polls.getActivePoll()?.question).toBe("Like it?");

      // Verify members was hydrated
      expect(client.members.getMembers().length).toBe(2);
      expect(client.members.getHost()?.userId).toBe("u-host");

      // Verify sending a reaction dispatches client message
      client.reactions.emit("🔥", 12000);
      expect(sentMessage.type).toBe("REACTION_EMIT");
      expect(sentMessage.payload.emoji).toBe("🔥");
      expect(sentMessage.payload.videoTimestampMs).toBe(12000);
    });
  });
});
