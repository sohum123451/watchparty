import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CallQualityManager,
  ParticipantCallStats,
  CallQualitySummary,
} from "../src/features/CallQualityManager.js";
import {
  PlaybackSyncEngine,
  SyncVideoElement,
} from "../src/index.js";
import { PlaybackState } from "@watchparty/shared";

// ==========================================
// FAKE HTML5 VIDEO ELEMENT FOR SYNC TESTING
// ==========================================
class FakeVideoElement implements SyncVideoElement {
  private _currentTime = 0;
  public playbackRate = 1.0;
  public paused = true;
  public seeking = false;
  private listeners: Map<string, Set<(e?: any) => void>> = new Map();

  get currentTime(): number {
    return this._currentTime;
  }

  set currentTime(val: number) {
    this._currentTime = Math.max(0, val);
    this.seeking = true;
    this.emit("seeking");
    this.seeking = false;
    this.emit("seeked");
  }

  public addEventListener(type: string, listener: (e?: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: (e?: any) => void): void {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(listener);
    }
  }

  public emit(type: string, event?: any): void {
    const set = this.listeners.get(type);
    if (set) {
      for (const listener of set) {
        listener(event);
      }
    }
  }

  public async play(): Promise<void> {
    this.paused = false;
    this.emit("play");
    this.emit("playing");
  }

  public pause(): void {
    this.paused = true;
    this.emit("pause");
  }

  public fastSeek(time: number): void {
    this.currentTime = time;
  }
}

describe("Call Quality Diagnostics & Sync Invariance Suite", () => {
  let callQualityMgr: CallQualityManager;
  let lastStats: ParticipantCallStats[] = [];
  let lastSummary: CallQualitySummary | null = null;
  let degradedEvents: Array<{ userId: string; tier: string; reason: string }> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    lastStats = [];
    lastSummary = null;
    degradedEvents = [];

    callQualityMgr = new CallQualityManager({
      localUserId: "user_host",
      localUserName: "Host User",
      pollIntervalMs: 1000,
      onStatsUpdated: (stats, summary) => {
        lastStats = stats;
        lastSummary = summary;
      },
      onQualityDegraded: (userId, tier, reason) => {
        degradedEvents.push({ userId, tier, reason });
      },
    });
  });

  afterEach(() => {
    callQualityMgr.destroy();
    vi.useRealTimers();
  });

  describe("Per-Participant Metrics Tracking", () => {
    it("tracks RTT, packet loss, jitter, bitrate, and active codecs for local user", () => {
      const local = callQualityMgr.getParticipantStats("user_host");
      expect(local).toBeDefined();
      expect(local!.userId).toBe("user_host");
      expect(local!.userName).toBe("Host User");
      expect(local!.rttMs).toBe(18);
      expect(local!.packetLossPercent).toBe(0.1);
      expect(local!.jitterMs).toBe(3.2);
      expect(local!.audioBitrateKbps).toBe(48);
      expect(local!.videoBitrateKbps).toBe(920);
      expect(local!.bitrateKbps).toBe(968);
      expect(local!.audioCodec).toContain("Opus");
      expect(local!.videoCodec).toContain("VP8");
      expect(local!.qualityTier).toBe("good");
      expect(local!.isLocal).toBe(true);
    });

    it("polls metrics from WebRTC getStats() when peer connections are registered", async () => {
      const mockReport = new Map<string, any>();
      mockReport.set("candidate", {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.024, // 24ms
      });
      mockReport.set("inbound", {
        type: "inbound-rtp",
        jitter: 0.0035, // 3.5ms
        packetsLost: 2,
        packetsReceived: 98, // total 100 => 2.0% loss
      });

      const mockPc = {
        getStats: vi.fn().mockResolvedValue(mockReport),
      } as unknown as RTCPeerConnection;

      callQualityMgr.trackParticipant("peer_1", "Remote Peer 1");
      callQualityMgr.registerPeerConnection("peer_1", mockPc);

      // Advance timer to trigger pollStats
      await vi.advanceTimersByTimeAsync(1100);

      const stats = callQualityMgr.getParticipantStats("peer_1");
      expect(stats).toBeDefined();
      expect(stats!.rttMs).toBe(24);
      expect(stats!.jitterMs).toBe(3.5);
      expect(stats!.packetLossPercent).toBe(2.0);
    });
  });

  describe("Test Matrices: Scale & Network Profiles", () => {
    it("handles 2-participant matrix on high-speed Wi-Fi with excellent health", () => {
      callQualityMgr.trackParticipant("peer_2", "Alice (Wi-Fi)", {
        networkProfile: "wifi",
      });

      const all = callQualityMgr.getAllStats();
      expect(all.length).toBe(2);

      const summary = callQualityMgr.getSummary();
      expect(summary.participantCount).toBe(2);
      expect(summary.averageRttMs).toBeLessThan(30);
      expect(summary.averagePacketLossPercent).toBeLessThan(0.5);
      expect(summary.averageJitterMs).toBeLessThan(5);
      expect(summary.overallHealth).toBe("excellent");
    });

    it("handles 5-participant mixed matrix (Wi-Fi and 4G/5G mobile data)", () => {
      // 3 Wi-Fi, 2 Mobile
      callQualityMgr.trackParticipant("user_2", "Bob (Wi-Fi)", { networkProfile: "wifi" });
      callQualityMgr.trackParticipant("user_3", "Charlie (Mobile)", { networkProfile: "mobile" });
      callQualityMgr.trackParticipant("user_4", "Diana (Wi-Fi)", { networkProfile: "wifi" });
      callQualityMgr.trackParticipant("user_5", "Evan (Mobile)", { networkProfile: "mobile" });

      const all = callQualityMgr.getAllStats();
      expect(all.length).toBe(5);

      const mobileUser = callQualityMgr.getParticipantStats("user_3")!;
      expect(mobileUser.networkProfile).toBe("mobile");
      expect(mobileUser.rttMs).toBe(65);
      expect(mobileUser.packetLossPercent).toBe(1.2);
      expect(mobileUser.jitterMs).toBe(14.8);
      expect(mobileUser.resolution).toBe("640x480");
      expect(mobileUser.framerate).toBe(24);

      const wifiUser = callQualityMgr.getParticipantStats("user_2")!;
      expect(wifiUser.networkProfile).toBe("wifi");
      expect(wifiUser.rttMs).toBe(18);
      expect(wifiUser.resolution).toBe("1280x720");
      expect(wifiUser.framerate).toBe(30);

      const summary = callQualityMgr.getSummary();
      expect(summary.participantCount).toBe(5);
      expect(summary.overallHealth).toBe("good");
      expect(summary.totalBitrateKbps).toBeGreaterThan(3000);
    });

    it("handles 10-participant stress scale matrix seamlessly", () => {
      for (let i = 2; i <= 10; i++) {
        const isMobile = i % 2 === 0;
        callQualityMgr.trackParticipant(`user_${i}`, `User ${i}`, {
          networkProfile: isMobile ? "mobile" : "wifi",
        });
      }

      const all = callQualityMgr.getAllStats();
      expect(all.length).toBe(10);

      const summary = callQualityMgr.getSummary();
      expect(summary.participantCount).toBe(10);
      expect(summary.overallHealth).toBe("good");
      expect(summary.totalBitrateKbps).toBeGreaterThan(6000);
    });
  });

  describe("Graceful Degradation: Chrome DevTools Throttled Connection", () => {
    it("degrades throttled participant to audio-only with Opus FEC without degrading others", () => {
      // Setup 5 participants
      callQualityMgr.trackParticipant("user_2", "Bob (Wi-Fi)", { networkProfile: "wifi" });
      callQualityMgr.trackParticipant("user_3", "Charlie (Throttled Target)", { networkProfile: "wifi" });
      callQualityMgr.trackParticipant("user_4", "Diana (Wi-Fi)", { networkProfile: "wifi" });
      callQualityMgr.trackParticipant("user_5", "Evan (Mobile)", { networkProfile: "mobile" });

      // Apply Chrome DevTools 3G throttling to Charlie
      callQualityMgr.setParticipantNetworkProfile("user_3", "throttled");

      // Verify degradation callback fired for Charlie
      expect(degradedEvents.length).toBe(1);
      expect(degradedEvents[0].userId).toBe("user_3");
      expect(degradedEvents[0].tier).toBe("audio-only");
      expect(degradedEvents[0].reason).toContain("High packet loss and latency detected");

      const throttledUser = callQualityMgr.getParticipantStats("user_3")!;
      expect(throttledUser.networkProfile).toBe("throttled");
      expect(throttledUser.qualityTier).toBe("audio-only");
      expect(throttledUser.rttMs).toBe(280);
      expect(throttledUser.packetLossPercent).toBe(8.5);
      expect(throttledUser.jitterMs).toBe(45.2);
      expect(throttledUser.audioBitrateKbps).toBe(48);
      expect(throttledUser.videoBitrateKbps).toBe(0);
      expect(throttledUser.resolution).toContain("Disabled (Audio Only)");
      expect(throttledUser.framerate).toBe(0);
      expect(throttledUser.audioCodec).toContain("FEC enabled");

      // CRITICAL REQUIREMENT: Confirm unthrottled participants remain completely unaffected
      const bob = callQualityMgr.getParticipantStats("user_2")!;
      expect(bob.qualityTier).toBe("good");
      expect(bob.videoBitrateKbps).toBe(920);
      expect(bob.resolution).toBe("1280x720");
      expect(bob.framerate).toBe(30);

      const evan = callQualityMgr.getParticipantStats("user_5")!;
      expect(evan.qualityTier).toBe("good");
      expect(evan.videoBitrateKbps).toBe(550);
      expect(evan.resolution).toBe("640x480");

      const host = callQualityMgr.getParticipantStats("user_host")!;
      expect(host.qualityTier).toBe("good");
      expect(host.videoBitrateKbps).toBe(920);
    });
  });

  describe("Background Tab Throttling (Page Visibility API)", () => {
    it("lowers local video framerate to 15fps while backgrounded to conserve CPU", () => {
      const local = callQualityMgr.getParticipantStats("user_host")!;
      expect(local.framerate).toBe(30);
      expect(local.isBackgroundTab).toBe(false);

      // Tab moves to background
      callQualityMgr.handleVisibilityChange(true);

      expect(local.isBackgroundTab).toBe(true);
      expect(local.framerate).toBe(15);
      // Audio stream bitrate remains intact
      expect(local.audioBitrateKbps).toBe(48);

      // Tab returned to foreground
      callQualityMgr.handleVisibilityChange(false);
      expect(local.isBackgroundTab).toBe(false);
      expect(local.framerate).toBe(30);
    });
  });

  describe("Mid-Call Device Switching", () => {
    it("hot swaps audio input device without dropping call or tearing down session", () => {
      const result = callQualityMgr.handleDeviceSwitch("audioinput", "bluetooth_airpods_pro");
      expect(result.success).toBe(true);
      expect(result.newDeviceId).toBe("bluetooth_airpods_pro");

      // Verify participant still active with zero interruption
      const local = callQualityMgr.getParticipantStats("user_host")!;
      expect(local.qualityTier).toBe("good");
      expect(local.audioBitrateKbps).toBe(48);
    });
  });

  describe("Playback Sync Invariance: Decoupled Sync & Media Planes", () => {
    let video: FakeVideoElement;
    let syncEngine: PlaybackSyncEngine;
    let latestMetrics: any = null;

    beforeEach(() => {
      video = new FakeVideoElement();
      latestMetrics = null;
      syncEngine = new PlaybackSyncEngine({
        video: video,
        sendPing: vi.fn(),
        onUserAction: vi.fn(),
        onBufferReport: vi.fn(),
        onMetricsUpdate: (m) => {
          latestMetrics = m;
        },
        driftIntervalMs: 250,
        pingIntervalMs: 5000,
      });

      // Start movie playing at position 120s (120,000 ms)
      video.currentTime = 120;
      video.paused = false;

      const activeMovieState: PlaybackState = {
        videoId: "movie_interstellar",
        status: "playing",
        positionMs: 120000,
        serverTimeMs: syncEngine.serverNow(),
        playbackRate: 1.0,
      };

      syncEngine.setPlaybackState(activeMovieState);
      syncEngine.evaluateDrift();
    });

    afterEach(() => {
      syncEngine.destroy();
    });

    it("joining voice mid-movie causes 0ms playback desync and no hitch in sync engine", () => {
      const initialPos = video.currentTime;
      expect(initialPos).toBe(120);
      expect(video.playbackRate).toBe(1.0);
      expect(video.paused).toBe(false);

      // Simulate a user joining voice mid-movie
      callQualityMgr.trackParticipant("voice_joiner_1", "Sarah", {
        networkProfile: "wifi",
      });
      callQualityMgr.updateParticipantMediaState("voice_joiner_1", {
        inVoice: true,
        audioMuted: false,
        videoEnabled: true,
      });

      // Advance drift evaluation loop in sync engine
      syncEngine.evaluateDrift();

      // Assert video position was NOT hard-seeked, jittered, or hitched
      expect(video.currentTime).toBe(120);
      expect(video.playbackRate).toBe(1.0);
      expect(video.seeking).toBe(false);
      expect(video.paused).toBe(false);
      expect(latestMetrics?.syncStatus).toBe("in_sync");
      expect(latestMetrics?.hardSeekCount).toBe(0);
      expect(latestMetrics?.softCorrectionCount).toBe(0);
    });

    it("leaving voice mid-movie causes zero hitch or playback rate adjustment", () => {
      // User is in voice
      callQualityMgr.trackParticipant("voice_user", "Tom");
      callQualityMgr.updateParticipantMediaState("voice_user", {
        inVoice: true,
        audioMuted: false,
        videoEnabled: true,
      });

      // User leaves voice mid-movie
      callQualityMgr.untrackParticipant("voice_user");

      // Verify video player remains perfectly locked to sync clock
      syncEngine.evaluateDrift();
      expect(video.currentTime).toBe(120);
      expect(video.playbackRate).toBe(1.0);
      expect(video.paused).toBe(false);
      expect(latestMetrics?.syncStatus).toBe("in_sync");
      expect(latestMetrics?.hardSeekCount).toBe(0);
      expect(latestMetrics?.softCorrectionCount).toBe(0);
    });

    it("a participant degrading to throttled 3G mid-movie has zero impact on movie sync", () => {
      callQualityMgr.trackParticipant("peer_3g", "Dave", { networkProfile: "wifi" });
      
      // Dave throttles mid-movie
      callQualityMgr.setParticipantNetworkProfile("peer_3g", "throttled");

      // Verify Dave's call degraded to audio-only
      const dave = callQualityMgr.getParticipantStats("peer_3g")!;
      expect(dave.qualityTier).toBe("audio-only");

      // Verify movie sync engine is 100% invariant
      syncEngine.evaluateDrift();
      expect(video.currentTime).toBe(120);
      expect(video.playbackRate).toBe(1.0);
      expect(video.paused).toBe(false);
      expect(latestMetrics?.syncStatus).toBe("in_sync");
      expect(latestMetrics?.hardSeekCount).toBe(0);
      expect(latestMetrics?.softCorrectionCount).toBe(0);
    });
  });
});
