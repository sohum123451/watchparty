import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlaybackState } from "@watchparty/shared";
import {
  PlaybackSyncEngine,
  SyncVideoElement,
  UserPlaybackAction,
  SyncMetrics,
} from "../src/index.js";

// ==========================================
// FAKE HTML5 VIDEO ELEMENT
// ==========================================
class FakeVideoElement implements SyncVideoElement {
  private _currentTime = 0;
  public playbackRate = 1.0;
  public paused = true;
  public seeking = false;

  public shouldBlockAutoplay = false;
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
    if (this.shouldBlockAutoplay) {
      const error = new Error("play() failed because user didn't interact first.");
      error.name = "NotAllowedError";
      throw error;
    }
    this.paused = false;
    this.emit("play");
    this.emit("playing");
  }

  public pause(): void {
    this.paused = true;
    this.emit("pause");
  }

  public simulateUserPlay(): void {
    this.paused = false;
    this.emit("play");
  }

  public simulateUserPause(): void {
    this.paused = true;
    this.emit("pause");
  }

  public simulateUserSeek(targetSeconds: number): void {
    this.seeking = true;
    this._currentTime = targetSeconds;
    this.emit("seeking");
    this.seeking = false;
    this.emit("seeked");
  }

  public advanceTime(deltaSeconds: number): void {
    if (!this.paused && !this.seeking) {
      this._currentTime += deltaSeconds * this.playbackRate;
    }
  }
}

// ==========================================
// SIMULATED NETWORK & SERVER
// ==========================================
class SimulatedNetwork {
  public serverClockOffsetMs: number; // ground truth: serverTime - clientTime
  public minOneWayDelayMs: number;
  public jitterMs: number;
  public packetLossRate: number; // 0.0 to 1.0

  constructor(serverClockOffsetMs = 500, minOneWayDelayMs = 20, jitterMs = 15, packetLossRate = 0) {
    this.serverClockOffsetMs = serverClockOffsetMs;
    this.minOneWayDelayMs = minOneWayDelayMs;
    this.jitterMs = jitterMs;
    this.packetLossRate = packetLossRate;
  }

  public handlePing(
    clientSendTimeMs: number,
    onPong: (t0: number, t1: number, t2: number, t3: number) => void
  ): void {
    if (Math.random() < this.packetLossRate) {
      return; // Dropped ping
    }

    const uplinkDelay = this.minOneWayDelayMs + Math.random() * this.jitterMs;
    const downlinkDelay = this.minOneWayDelayMs + Math.random() * this.jitterMs;
    const serverProcessingDelay = 1;

    setTimeout(() => {
      const serverReceiveTimeMs = clientSendTimeMs + uplinkDelay + this.serverClockOffsetMs;
      const serverSendTimeMs = serverReceiveTimeMs + serverProcessingDelay;

      setTimeout(() => {
        if (Math.random() >= this.packetLossRate) {
          const clientReceiveTimeMs = clientSendTimeMs + uplinkDelay + serverProcessingDelay + downlinkDelay;
          onPong(clientSendTimeMs, serverReceiveTimeMs, serverSendTimeMs, clientReceiveTimeMs);
        }
      }, downlinkDelay);
    }, uplinkDelay);
  }
}

describe("Client PlaybackSyncEngine", () => {
  let fakeVideo: FakeVideoElement;
  let userActions: UserPlaybackAction[];
  let bufferReports: { isBuffering: boolean; bufferedUpToMs?: number }[];
  let autoplayBlockedEvents: boolean[];
  let latestMetrics: SyncMetrics | null;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeVideo = new FakeVideoElement();
    userActions = [];
    bufferReports = [];
    autoplayBlockedEvents = [];
    latestMetrics = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createEngine(network?: SimulatedNetwork, overrides?: any) {
    const net = network || new SimulatedNetwork(500, 20, 10, 0);
    const engine = new PlaybackSyncEngine({
      video: fakeVideo,
      sendPing: (t0) => {
        net.handlePing(t0, (t0, t1, t2, t3) => {
          engine.handleSyncPong(t0, t1, t2, t3);
        });
      },
      onUserAction: (action) => userActions.push(action),
      onBufferReport: (report) => bufferReports.push(report),
      onAutoplayBlocked: (blocked) => autoplayBlockedEvents.push(blocked),
      onMetricsUpdate: (m) => {
        latestMetrics = m;
      },
      driftIntervalMs: 250,
      pingIntervalMs: 5000,
      ...overrides,
    });
    return { engine, net };
  }

  describe("1. Clock Synchronization & NTP Estimation", () => {
    it("converges on server clock offset accurately under network jitter", () => {
      const groundTruthOffset = 750;
      const net = new SimulatedNetwork(groundTruthOffset, 30, 10, 0);
      const { engine } = createEngine(net);

      engine.start();

      for (let i = 0; i < 8; i++) {
        vi.advanceTimersByTime(500);
      }

      const estimatedOffset = engine.getClockOffset();
      expect(Math.abs(estimatedOffset - groundTruthOffset)).toBeLessThan(15);
      expect(engine.getLatestRtt()).toBeGreaterThan(0);

      const now = Date.now();
      expect(engine.serverNow()).toBe(now + estimatedOffset);

      engine.destroy();
    });

    it("withstands 20% packet loss and still converges smoothly", () => {
      const groundTruthOffset = -300;
      const net = new SimulatedNetwork(groundTruthOffset, 25, 5, 0.2);
      const { engine } = createEngine(net);

      engine.start();

      for (let i = 0; i < 50; i++) {
        vi.advanceTimersByTime(1000);
      }

      const estimatedOffset = engine.getClockOffset();
      expect(Math.abs(estimatedOffset - groundTruthOffset)).toBeLessThan(15);

      engine.destroy();
    });
  });

  describe("2. Target Position Derivation", () => {
    it("derives target position when playing based on server elapsed time", () => {
      const { engine } = createEngine(new SimulatedNetwork(0, 5, 0, 0));
      engine.start();
      vi.advanceTimersByTime(100);

      const serverNow = engine.serverNow();
      const state: PlaybackState = {
        videoId: "v1",
        status: "playing",
        positionMs: 30000,
        serverTimeMs: serverNow - 5000,
        playbackRate: 1.0,
      };

      engine.setPlaybackState(state);

      const target = engine.getTargetPositionMs();
      expect(target).toBe(35000);

      engine.destroy();
    });

    it("returns static position when paused regardless of server elapsed time", () => {
      const { engine } = createEngine();
      engine.start();

      const state: PlaybackState = {
        videoId: "v1",
        status: "paused",
        positionMs: 42000,
        serverTimeMs: engine.serverNow() - 60000,
        playbackRate: 1.0,
      };

      engine.setPlaybackState(state);
      expect(engine.getTargetPositionMs()).toBe(42000);

      engine.destroy();
    });
  });

  describe("3. Drift Loop & Hysteresis", () => {
    it("dead zone (< 40ms): does nothing, keeps rate at 1.0, marks in_sync", () => {
      const { engine } = createEngine();
      engine.start();

      const serverNow = engine.serverNow();
      fakeVideo.currentTime = 10.02;

      engine.setPlaybackState({
        videoId: "v1",
        status: "playing",
        positionMs: 10000,
        serverTimeMs: serverNow,
        playbackRate: 1.0,
      });

      engine.evaluateDrift();

      expect(fakeVideo.playbackRate).toBe(1.0);
      expect(latestMetrics?.syncStatus).toBe("in_sync");
      expect(latestMetrics?.hardSeekCount).toBe(0);
      expect(latestMetrics?.softCorrectionCount).toBe(0);

      engine.destroy();
    });

    it("smooth nudging (40ms - 1000ms): nudges rate down when client is ahead", () => {
      const { engine } = createEngine();
      engine.start();

      const serverNow = engine.serverNow();
      fakeVideo.currentTime = 10.25; // 250ms ahead

      engine.setPlaybackState({
        videoId: "v1",
        status: "playing",
        positionMs: 10000,
        serverTimeMs: serverNow,
        playbackRate: 1.0,
      });

      engine.evaluateDrift();

      expect(fakeVideo.playbackRate).toBeLessThan(1.0);
      expect(fakeVideo.playbackRate).toBeGreaterThanOrEqual(0.92);
      expect(latestMetrics?.syncStatus).toBe("adjusting");
      expect(latestMetrics?.softCorrectionCount).toBe(1);

      engine.destroy();
    });

    it("smooth nudging (40ms - 1000ms): nudges rate up when client is behind", () => {
      const { engine } = createEngine();
      engine.start();

      const serverNow = engine.serverNow();
      fakeVideo.currentTime = 9.75; // 250ms behind

      engine.setPlaybackState({
        videoId: "v1",
        status: "playing",
        positionMs: 10000,
        serverTimeMs: serverNow,
        playbackRate: 1.0,
      });

      engine.evaluateDrift();

      expect(fakeVideo.playbackRate).toBeGreaterThan(1.0);
      expect(fakeVideo.playbackRate).toBeLessThanOrEqual(1.08);
      expect(latestMetrics?.syncStatus).toBe("adjusting");
      expect(latestMetrics?.softCorrectionCount).toBe(1);

      engine.destroy();
    });

    it("hysteresis: stays in nudging mode until drift drops below 20ms inner deadband", () => {
      const { engine } = createEngine();
      engine.start();

      const serverNow = engine.serverNow();
      fakeVideo.currentTime = 10.15;

      engine.setPlaybackState({
        videoId: "v1",
        status: "playing",
        positionMs: 10000,
        serverTimeMs: serverNow,
        playbackRate: 1.0,
      });

      engine.evaluateDrift();
      expect(fakeVideo.playbackRate).toBeLessThan(1.0);

      // Falls to 35ms (below outer 40ms, but above inner 20ms hysteresis zone)
      fakeVideo.currentTime = 10.035;
      engine.evaluateDrift();
      expect(fakeVideo.playbackRate).toBeLessThan(1.0);
      expect(latestMetrics?.syncStatus).toBe("adjusting");

      // Falls inside inner 20ms deadband
      fakeVideo.currentTime = 10.01;
      engine.evaluateDrift();
      expect(fakeVideo.playbackRate).toBe(1.0);
      expect(latestMetrics?.syncStatus).toBe("in_sync");

      engine.destroy();
    });

    it("hard seek (> 1000ms): immediately seeks video to target and restores rate 1.0", () => {
      const { engine } = createEngine();
      engine.start();

      const serverNow = engine.serverNow();
      fakeVideo.currentTime = 5.0;

      // Server is at 15,000 ms (gap of 10,000ms)
      engine.setPlaybackState({
        videoId: "v1",
        status: "playing",
        positionMs: 15000,
        serverTimeMs: serverNow,
        playbackRate: 1.0,
      });

      expect(fakeVideo.currentTime).toBe(15);
      expect(fakeVideo.playbackRate).toBe(1.0);
      expect(latestMetrics?.hardSeekCount).toBe(1);

      engine.destroy();
    });
  });

  describe("4. Edge Cases: Buffering, Autoplay, Backgrounding", () => {
    it("reports buffering and pauses drift corrections while video is stalled", () => {
      const { engine } = createEngine();
      engine.start();

      fakeVideo.currentTime = 10;
      engine.setPlaybackState({
        videoId: "v1",
        status: "playing",
        positionMs: 10000,
        serverTimeMs: engine.serverNow(),
        playbackRate: 1.0,
      });

      // Video stalls
      fakeVideo.emit("waiting");

      expect(bufferReports).toHaveLength(1);
      expect(bufferReports[0]).toEqual({ isBuffering: true });
      expect(latestMetrics?.syncStatus).toBe("buffering");

      // While buffering, evaluateDrift should not perform hard seeks
      fakeVideo.currentTime = 0;
      engine.evaluateDrift();
      expect(latestMetrics?.hardSeekCount).toBe(0);

      // Video recovers
      fakeVideo.emit("canplay");
      expect(bufferReports).toHaveLength(2);
      expect(bufferReports[1]).toEqual({ isBuffering: false });

      engine.destroy();
    });

    it("detects browser autoplay blocking and exposes resolveAutoplayBlock()", async () => {
      fakeVideo.shouldBlockAutoplay = true;
      const { engine } = createEngine();
      engine.start();

      engine.setPlaybackState({
        videoId: "v1",
        status: "playing",
        positionMs: 10000,
        serverTimeMs: engine.serverNow(),
        playbackRate: 1.0,
      });

      await Promise.resolve();

      expect(autoplayBlockedEvents).toContain(true);
      expect(latestMetrics?.autoplayBlocked).toBe(true);

      // User interacts
      fakeVideo.shouldBlockAutoplay = false;
      await engine.resolveAutoplayBlock();

      expect(fakeVideo.paused).toBe(false);
      expect(autoplayBlockedEvents).toContain(false);
      expect(latestMetrics?.autoplayBlocked).toBe(false);

      engine.destroy();
    });

    it("resyncs accurately when tab was throttled in background", () => {
      const net = new SimulatedNetwork(0, 5, 0, 0);
      const { engine } = createEngine(net);
      engine.start();
      vi.advanceTimersByTime(500);

      const serverNow = engine.serverNow();
      fakeVideo.currentTime = 10;
      fakeVideo.paused = false;

      engine.setPlaybackState({
        videoId: "v1",
        status: "playing",
        positionMs: 10000,
        serverTimeMs: serverNow,
        playbackRate: 1.0,
      });

      // Advance clock by 5s to simulate tab wake-up
      vi.advanceTimersByTime(5000);
      engine.evaluateDrift(true);

      expect(fakeVideo.currentTime).toBeCloseTo(15, 0);
      expect(latestMetrics?.hardSeekCount).toBeGreaterThanOrEqual(1);

      engine.destroy();
    });
  });

  describe("5. Echo Suppression", () => {
    it("suppresses programmatic play/pause/seek from emitting onUserAction back to server", async () => {
      const { engine } = createEngine();
      engine.start();

      const serverNow = engine.serverNow();

      // Programmatic Seek + Play
      engine.setPlaybackState({
        videoId: "v1",
        status: "playing",
        positionMs: 25000,
        serverTimeMs: serverNow,
        playbackRate: 1.0,
      });

      await Promise.resolve();
      expect(userActions).toHaveLength(0);

      // Programmatic Pause
      engine.setPlaybackState({
        videoId: "v1",
        status: "paused",
        positionMs: 25000,
        serverTimeMs: serverNow,
        playbackRate: 1.0,
      });

      expect(userActions).toHaveLength(0);

      // User interaction on video element
      fakeVideo.simulateUserSeek(50);
      expect(userActions).toHaveLength(1);
      expect(userActions[0]).toEqual({ type: "SEEK", targetPositionMs: 50000 });

      fakeVideo.simulateUserPlay();
      expect(userActions).toHaveLength(2);
      expect(userActions[1].type).toBe("PLAY");

      fakeVideo.simulateUserPause();
      expect(userActions).toHaveLength(3);
      expect(userActions[2].type).toBe("PAUSE");

      engine.destroy();
    });
  });

  describe("6. Export Metrics & Telemetry", () => {
    it("computes accurate time-in-sync percentage and correction counters", () => {
      const net = new SimulatedNetwork(0, 0, 0, 0);
      const { engine } = createEngine(net);
      engine.start();
      vi.advanceTimersByTime(500); // Wait for initial burst pings to settle

      const serverNow = engine.serverNow();
      fakeVideo.paused = false;
      fakeVideo.currentTime = 10;

      engine.setPlaybackState({
        videoId: "v1",
        status: "playing",
        positionMs: 10000,
        serverTimeMs: serverNow,
        playbackRate: 1.0,
      });

      // Keep pace in dead zone for 10 ticks
      for (let i = 0; i < 10; i++) {
        fakeVideo.advanceTime(0.25);
        vi.advanceTimersByTime(250);
      }

      const metrics = engine.getMetrics();
      expect(metrics.timeInSyncPercent).toBe(100);
      expect(metrics.hardSeekCount).toBe(0);

      // Induce lag
      fakeVideo.advanceTime(0);
      for (let i = 0; i < 4; i++) {
        vi.advanceTimersByTime(250);
      }

      const laggyMetrics = engine.getMetrics();
      expect(laggyMetrics.softCorrectionCount).toBeGreaterThanOrEqual(1);

      engine.destroy();
    });
  });
});
