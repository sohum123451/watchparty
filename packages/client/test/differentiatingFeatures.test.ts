import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ReactionManager,
  ReactionHeatmapTimeline,
  ReadyCheckManager,
  BookmarkManager,
  VirtualCouchManager,
  SyncHealthMonitor,
  ChaosSimulator,
  ClockSync,
  PlaybackSyncEngine,
} from "../src/index.js";
import { MomentBookmark, ReadyCheck, RoomSyncHealthSummary } from "@watchparty/shared";

describe("Differentiating Features (Client)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Feature 1: Reaction Heatmap Timeline & Hotspot Sync", () => {
    it("should detect hotspot peaks and trigger synced seek jump", () => {
      const rxMgr = new ReactionManager();
      // Inject bursts clustered at 30s
      rxMgr.initStoredReactions([
        { id: "1", userId: "u1", userName: "A", emoji: "🔥", videoTimestampMs: 30000 },
        { id: "2", userId: "u2", userName: "B", emoji: "🔥", videoTimestampMs: 31000 },
        { id: "3", userId: "u3", userName: "C", emoji: "❤️", videoTimestampMs: 32000 },
        { id: "4", userId: "u4", userName: "D", emoji: "🔥", videoTimestampMs: 33000 },
      ]);

      let jumpedTarget = -1;
      const timeline = new ReactionHeatmapTimeline({
        reactionManager: rxMgr,
        onJump: (t) => {
          jumpedTarget = t;
        },
      });

      const hotspots = timeline.getHotspots(60000, 0.4);
      expect(hotspots.length).toBeGreaterThan(0);
      expect(hotspots[0].topEmoji).toBe("🔥");
      expect(hotspots[0].reactionCount).toBe(4);

      // Clicking hotspot triggers synced seek
      timeline.jumpToHotspot(hotspots[0].timeMs);
      expect(jumpedTarget).toBe(hotspots[0].timeMs);

      // Seek bar gradient generation
      const gradient = timeline.generateSeekBarGradient(60000);
      expect(gradient).toContain("linear-gradient");
      expect(gradient).toContain("rgba");
    });
  });

  describe("Feature 2: Ready-check Synchronized Countdown Showcase", () => {
    it("should countdown using serverNow and fire onComplete with start position", () => {
      const clockSync = new ClockSync();
      // Mock clockSync.serverNow
      let mockServerTime = 100000;
      vi.spyOn(clockSync, "serverNow").mockImplementation(() => mockServerTime);

      let completedPosition = -1;
      const readyCheck = new ReadyCheckManager({
        clockSync,
        onComplete: (pos) => {
          completedPosition = pos;
        },
      });

      let latestState: any = null;
      readyCheck.subscribe((state) => {
        latestState = state;
      });

      readyCheck.handleCountdownStart({
        id: "rc-1",
        initiatedByUserId: "host-1",
        initiatedByUserName: "Alice",
        countdownMs: 3000,
        targetServerTimeMs: 103000,
        startPositionMs: 50000,
        active: true,
      });

      expect(latestState?.active).toBe(true);
      expect(latestState?.secondsRemaining).toBe(3);

      // Advance by 1 second
      mockServerTime += 1000;
      vi.advanceTimersByTime(1000);
      expect(latestState?.secondsRemaining).toBe(2);

      // Advance to target
      mockServerTime += 2050;
      vi.advanceTimersByTime(2050);

      expect(completedPosition).toBe(50000);
      expect(readyCheck.getActiveReadyCheck()?.active).toBe(false);
    });
  });

  describe("Feature 3: Shared Moment Bookmarks", () => {
    it("should surface bookmarks live when video playback crosses timestamp", () => {
      const reached: MomentBookmark[] = [];
      const manager = new BookmarkManager({
        initialBookmarks: [
          {
            id: "b1",
            userId: "u1",
            userName: "Alice",
            videoId: "bunny",
            timestampMs: 15000,
            text: "Funny scene!",
            createdAtMs: Date.now(),
          },
          {
            id: "b2",
            userId: "u2",
            userName: "Bob",
            videoId: "bunny",
            timestampMs: 30000,
            text: "Plot twist!",
            createdAtMs: Date.now(),
          },
        ],
      });

      manager.subscribeReached((bmk) => {
        reached.push(bmk);
      });

      // Playback at 5s -> no triggers
      manager.checkPlaybackCrossing(5000);
      expect(reached.length).toBe(0);

      // Playback advances to 16s -> crosses 15s bookmark
      manager.checkPlaybackCrossing(16000);
      expect(reached.length).toBe(1);
      expect(reached[0].text).toBe("Funny scene!");

      // Playback at 17s -> doesn't re-trigger
      manager.checkPlaybackCrossing(17000);
      expect(reached.length).toBe(1);

      // Playback advances to 31s -> crosses 30s bookmark
      manager.checkPlaybackCrossing(31000);
      expect(reached.length).toBe(2);
      expect(reached[1].text).toBe("Plot twist!");
    });
  });

  describe("Feature 4: Spatial Virtual Couch", () => {
    it("should assign seats, animate reactions, and reflect buffering states", () => {
      const couch = new VirtualCouchManager({ maxSeats: 8 });

      couch.syncMembers([
        { userId: "u1", userName: "Alice", isHost: true, isConnected: true, isBuffering: false, joinedAt: 100 },
        { userId: "u2", userName: "Bob", isHost: false, isConnected: true, isBuffering: false, joinedAt: 200 },
      ]);

      const seats = couch.getSeats();
      expect(seats.length).toBe(2);
      expect(seats[0].isHost).toBe(true);
      expect(seats[0].avatarColor).toBeDefined();

      // Bob reacts with popcorn
      couch.triggerMemberReaction("u2", "🍿", 2000);
      const bobSeat = couch.getSeats().find((s) => s.userId === "u2");
      expect(bobSeat?.status).toBe("reacting");
      expect(bobSeat?.lastReactionEmoji).toBe("🍿");

      // After 2s timeout, reaction returns to watching
      vi.advanceTimersByTime(2100);
      expect(couch.getSeats().find((s) => s.userId === "u2")?.status).toBe("watching");

      // Alice starts buffering
      couch.updateMemberBuffering("u1", true);
      expect(couch.getSeats().find((s) => s.userId === "u1")?.status).toBe("buffering");
    });
  });

  describe("Feature 5: Live Sync-Health Diagnostics & Grading", () => {
    it("should compute accurate reliability grades matching <= 500ms constraint", () => {
      const clockSync = new ClockSync();
      const engine = {
        getMetrics: () => ({
          driftMs: 35,
          currentRate: 1.0,
          isBuffering: false,
          effectiveState: "playing",
          targetPosMs: 1000,
        }),
      } as any;

      let reported: any = null;
      const monitor = new SyncHealthMonitor({
        clockSync,
        syncEngine: engine,
        reporter: (m) => {
          reported = m;
        },
      });

      monitor.reportCurrentMetrics();
      expect(reported).not.toBeNull();
      expect(reported.driftMs).toBe(35);

      // Grade A+ when p95 < 50ms and 0 buffering
      monitor.handleServerBroadcast({
        p50DriftMs: 20,
        p95DriftMs: 40,
        maxDriftMs: 60,
        averageRttMs: 25,
        bufferingCount: 0,
        totalMembers: 5,
        syncCoherenceScore: 98,
        memberMetrics: [],
      });

      const gradeAPlus = monitor.getReliabilityGrade();
      expect(gradeAPlus.grade).toBe("A+");

      // Grade C when p95 <= 500ms
      monitor.handleServerBroadcast({
        p50DriftMs: 200,
        p95DriftMs: 480,
        maxDriftMs: 495,
        averageRttMs: 90,
        bufferingCount: 0,
        totalMembers: 5,
        syncCoherenceScore: 65,
        memberMetrics: [],
      });

      const gradeC = monitor.getReliabilityGrade();
      expect(gradeC.grade).toBe("C");
    });
  });

  describe("Feature 6: Chaos Mode Simulator (Dev Testing)", () => {
    it("should inject latency, jitter, and drop packets when enabled", () => {
      const chaos = new ChaosSimulator({
        initialConfig: {
          enabled: true,
          latencyMs: 200,
          jitterMs: 0,
          packetLossRate: 0.0, // No drop for this test
        },
      });

      let sent = false;
      chaos.interceptOutgoing({ type: "ROOM_LEAVE", clientSeq: 1 }, () => {
        sent = true;
      });

      // Initially not sent due to 200ms injected delay
      expect(sent).toBe(false);

      // Advance by 200ms
      vi.advanceTimersByTime(200);
      expect(sent).toBe(true);

      expect(chaos.getStats().packetsDelayed).toBe(1);
    });

    it("should simulate packet drops based on packetLossRate", () => {
      const chaos = new ChaosSimulator({
        initialConfig: {
          enabled: true,
          packetLossRate: 1.0, // 100% drop rate
        },
      });

      let sent = false;
      const ok = chaos.interceptOutgoing({ type: "ROOM_LEAVE", clientSeq: 2 }, () => {
        sent = true;
      });

      expect(ok).toBe(false);
      expect(sent).toBe(false);
      expect(chaos.getStats().packetsDropped).toBe(1);
    });
  });
});
