import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HTML5Adapter,
  YouTubeAdapter,
  VimeoAdapter,
  LocalFileAdapter,
  ScreenShareAdapter,
  AdapterFactory,
  PlayerAdapter,
  PlaybackSyncEngine,
  SyncVideoElement,
} from "../src/index.js";
import { SourceDetector } from "@watchparty/shared";

// Mock HTML5 Video Element for unit testing
class MockVideoElement implements SyncVideoElement {
  public currentTime = 0;
  public playbackRate = 1.0;
  public paused = true;
  public seeking = false;
  public duration = 120;
  public src = "";
  public srcObject: any = null;
  private listeners: Map<string, Set<(e?: any) => void>> = new Map();

  public addEventListener(type: string, listener: (e?: any) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  public removeEventListener(type: string, listener: (e?: any) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public emit(type: string, event?: any): void {
    const set = this.listeners.get(type);
    if (set) {
      for (const fn of set) fn(event);
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
}

describe("Player Adapters & Provider Architecture", () => {
  describe("1. HTML5Adapter", () => {
    let mockVideo: MockVideoElement;
    let adapter: HTML5Adapter;

    beforeEach(() => {
      mockVideo = new MockVideoElement();
      adapter = new HTML5Adapter(mockVideo);
    });

    afterEach(() => {
      adapter.destroy();
    });

    it("has correct provider and capabilities", () => {
      expect(adapter.provider).toBe("html5");
      expect(adapter.capabilities.supportsPlaybackRate).toBe(true);
      expect(adapter.capabilities.supportsPreciseSeek).toBe(true);
      expect(adapter.capabilities.isLive).toBe(false);
    });

    it("loads direct MP4 video and updates state to cued", async () => {
      const stateChanges: string[] = [];
      adapter.onStateChange((s) => stateChanges.push(s));

      await adapter.load("https://cdn.example.com/movie.mp4");
      expect((mockVideo as any).src).toBe("https://cdn.example.com/movie.mp4");
      expect(adapter.getState()).toBe("paused");
      expect(stateChanges).toContain("cued");
    });

    it("controls playback: play, pause, seek, setPlaybackRate", async () => {
      await adapter.play();
      expect(mockVideo.paused).toBe(false);
      expect(adapter.getState()).toBe("playing");

      adapter.seek(45000); // 45 seconds in ms
      expect(mockVideo.currentTime).toBe(45);
      expect(adapter.getCurrentTime()).toBe(45000);

      adapter.setPlaybackRate(1.25);
      expect(mockVideo.playbackRate).toBe(1.25);

      adapter.pause();
      expect(mockVideo.paused).toBe(true);
      expect(adapter.getState()).toBe("paused");
    });

    it("notifies buffering events on waiting and playing", () => {
      const bufferLog: boolean[] = [];
      adapter.onBuffering((b) => bufferLog.push(b));

      mockVideo.emit("waiting");
      expect(bufferLog).toEqual([true]);
      expect(adapter.getState()).toBe("buffering");

      mockVideo.paused = false;
      mockVideo.emit("playing");
      expect(bufferLog).toEqual([true, false]);
      expect(adapter.getState()).toBe("playing");
    });

    it("notifies ended event", () => {
      let ended = false;
      adapter.onEnded(() => {
        ended = true;
      });

      mockVideo.emit("ended");
      expect(ended).toBe(true);
      expect(adapter.getState()).toBe("ended");
    });
  });

  describe("2. YouTubeAdapter", () => {
    let mockYtPlayer: any;
    let adapter: YouTubeAdapter;

    beforeEach(() => {
      mockYtPlayer = {
        currentTime: 0,
        rate: 1.0,
        playerState: -1, // UNSTARTED
        cueVideoById: vi.fn((id: string) => {
          mockYtPlayer.videoId = id;
          mockYtPlayer.playerState = 5; // CUED
        }),
        playVideo: vi.fn(() => {
          mockYtPlayer.playerState = 1; // PLAYING
        }),
        pauseVideo: vi.fn(() => {
          mockYtPlayer.playerState = 2; // PAUSED
        }),
        seekTo: vi.fn((sec: number) => {
          mockYtPlayer.currentTime = sec;
        }),
        getCurrentTime: vi.fn(() => mockYtPlayer.currentTime),
        getPlayerState: vi.fn(() => mockYtPlayer.playerState),
        setPlaybackRate: vi.fn((r: number) => {
          mockYtPlayer.rate = r;
        }),
        getDuration: vi.fn(() => 300),
        destroy: vi.fn(),
      };

      adapter = new YouTubeAdapter({ mockPlayer: mockYtPlayer });
    });

    afterEach(() => {
      adapter.destroy();
    });

    it("has correct provider and capabilities", () => {
      expect(adapter.provider).toBe("youtube");
      expect(adapter.capabilities.supportsPlaybackRate).toBe(true);
      expect(adapter.capabilities.supportsPreciseSeek).toBe(true);
      expect(adapter.capabilities.isLive).toBe(false);
    });

    it("cues video by ID and tracks duration", async () => {
      await adapter.load("dQw4w9WgXcQ");
      expect(mockYtPlayer.cueVideoById).toHaveBeenCalledWith("dQw4w9WgXcQ");
      expect(adapter.getDuration()).toBe(300000); // 300s -> 300,000ms
    });

    it("delegates play, pause, seek, setPlaybackRate to YT Player API", async () => {
      await adapter.load("dQw4w9WgXcQ");

      await adapter.play();
      expect(mockYtPlayer.playVideo).toHaveBeenCalled();
      expect(adapter.getState()).toBe("playing");

      adapter.seek(75000); // 75s
      expect(mockYtPlayer.seekTo).toHaveBeenCalledWith(75, true);
      expect(adapter.getCurrentTime()).toBe(75000);

      adapter.setPlaybackRate(1.5);
      expect(mockYtPlayer.setPlaybackRate).toHaveBeenCalledWith(1.5);

      adapter.pause();
      expect(mockYtPlayer.pauseVideo).toHaveBeenCalled();
      expect(adapter.getState()).toBe("paused");
    });
  });

  describe("3. VimeoAdapter", () => {
    let mockVimeoPlayer: any;
    let adapter: VimeoAdapter;
    let eventHandlers: Map<string, (data?: any) => void>;

    beforeEach(() => {
      eventHandlers = new Map();
      mockVimeoPlayer = {
        currentTime: 0,
        rate: 1.0,
        paused: true,
        loadVideo: vi.fn(async (id: string) => {
          mockVimeoPlayer.videoId = id;
        }),
        play: vi.fn(async () => {
          mockVimeoPlayer.paused = false;
          eventHandlers.get("play")?.();
        }),
        pause: vi.fn(async () => {
          mockVimeoPlayer.paused = true;
          eventHandlers.get("pause")?.();
        }),
        setCurrentTime: vi.fn(async (s: number) => {
          mockVimeoPlayer.currentTime = s;
          eventHandlers.get("seeked")?.({ seconds: s });
        }),
        getCurrentTime: vi.fn(() => mockVimeoPlayer.currentTime),
        setPlaybackRate: vi.fn(async (r: number) => {
          mockVimeoPlayer.rate = r;
        }),
        getDuration: vi.fn(() => 180),
        on: vi.fn((event: string, fn: (data?: any) => void) => {
          eventHandlers.set(event, fn);
        }),
        destroy: vi.fn(),
      };

      adapter = new VimeoAdapter({ mockPlayer: mockVimeoPlayer });
    });

    afterEach(() => {
      adapter.destroy();
    });

    it("has correct provider and capabilities", () => {
      expect(adapter.provider).toBe("vimeo");
      expect(adapter.capabilities.supportsPlaybackRate).toBe(true);
      expect(adapter.capabilities.supportsPreciseSeek).toBe(true);
      expect(adapter.capabilities.isLive).toBe(false);
    });

    it("extracts ID from URL and loads video", async () => {
      await adapter.load("https://vimeo.com/76979871");
      expect(mockVimeoPlayer.loadVideo).toHaveBeenCalledWith("76979871");
      expect(adapter.getDuration()).toBe(180000);
    });

    it("controls play, pause, seek and emits events", async () => {
      const stateHistory: string[] = [];
      adapter.onStateChange((s) => stateHistory.push(s));

      await adapter.play();
      expect(mockVimeoPlayer.play).toHaveBeenCalled();
      expect(stateHistory).toContain("playing");

      await adapter.seek(60000); // 60s
      expect(mockVimeoPlayer.setCurrentTime).toHaveBeenCalledWith(60);
      expect(adapter.getCurrentTime()).toBe(60000);

      await adapter.pause();
      expect(mockVimeoPlayer.pause).toHaveBeenCalled();
      expect(stateHistory).toContain("paused");
    });
  });

  describe("4. LocalFileAdapter (Prompt 16)", () => {
    let mockVideo: MockVideoElement;
    let adapter: LocalFileAdapter;

    beforeEach(() => {
      mockVideo = new MockVideoElement();
      adapter = new LocalFileAdapter(mockVideo);
    });

    afterEach(() => {
      adapter.destroy();
    });

    it("has correct provider and full playback capabilities", () => {
      expect(adapter.provider).toBe("local");
      expect(adapter.capabilities.supportsPlaybackRate).toBe(true);
      expect(adapter.capabilities.supportsPreciseSeek).toBe(true);
      expect(adapter.capabilities.isLive).toBe(false);
    });

    it("loads local file, extracts metadata, and computes deterministic fingerprint", async () => {
      const fakeBlob = new Blob(["video data bytes"], { type: "video/mp4" });
      Object.defineProperty(fakeBlob, "name", { value: "my-family-vacation.mp4" });

      await adapter.load({
        provider: "local",
        sourceRef: "my-family-vacation.mp4",
        file: fakeBlob,
        durationMs: 90000,
      });

      const meta = adapter.getMetadata();
      expect(meta).toBeDefined();
      expect(meta?.fileName).toBe("my-family-vacation.mp4");
      expect(meta?.fileType).toBe("video/mp4");
      expect(meta?.fingerprint).toBeDefined();
      expect(adapter.verifyMatch(meta!.fingerprint)).toBe(true);
      expect(adapter.verifyMatch("wrong-hash")).toBe(false);
    });

    it("controls local video playback seamlessly", async () => {
      await adapter.play();
      expect(mockVideo.paused).toBe(false);
      expect(adapter.getState()).toBe("playing");

      adapter.seek(15000);
      expect(mockVideo.currentTime).toBe(15);
      expect(adapter.getCurrentTime()).toBe(15000);

      adapter.setPlaybackRate(1.1);
      expect(mockVideo.playbackRate).toBe(1.1);

      adapter.pause();
      expect(mockVideo.paused).toBe(true);
    });
  });

  describe("5. ScreenShareAdapter (Prompt 17)", () => {
    let mockVideo: MockVideoElement;
    let adapter: ScreenShareAdapter;
    let mockStream: any;
    let trackEndedHandler: (() => void) | null = null;

    beforeEach(() => {
      mockVideo = new MockVideoElement();
      trackEndedHandler = null;

      mockStream = {
        getVideoTracks: () => [
          {
            addEventListener: (ev: string, fn: () => void) => {
              if (ev === "ended") trackEndedHandler = fn;
            },
            removeEventListener: vi.fn(),
            stop: vi.fn(),
          },
        ],
        getTracks: () => [
          {
            stop: vi.fn(),
          },
        ],
      };

      adapter = new ScreenShareAdapter({
        videoElement: mockVideo,
        mediaStream: mockStream,
      });
    });

    afterEach(() => {
      adapter.destroy();
    });

    it("has live stream capabilities and lacks seeking / rate control", () => {
      expect(adapter.provider).toBe("screenshare");
      expect(adapter.capabilities.isLive).toBe(true);
      expect(adapter.capabilities.supportsPlaybackRate).toBe(false);
      expect(adapter.capabilities.supportsPreciseSeek).toBe(false);
    });

    it("binds media stream to video element", () => {
      expect(mockVideo.srcObject).toBe(mockStream);
    });

    it("gracefully ignores seek and playbackRate calls on live stream", () => {
      // Must not throw or corrupt time
      expect(() => adapter.seek(50000)).not.toThrow();
      expect(() => adapter.setPlaybackRate(1.5)).not.toThrow();
      expect(mockVideo.playbackRate).toBe(1.0); // Remains untouched
    });

    it("detects when screen sharing track ends", () => {
      let ended = false;
      adapter.onEnded(() => {
        ended = true;
      });

      expect(trackEndedHandler).toBeDefined();
      trackEndedHandler!();

      expect(ended).toBe(true);
      expect(adapter.getState()).toBe("ended");
    });
  });

  describe("6. AdapterFactory", () => {
    it("instantiates the appropriate adapter based on provider", () => {
      const html5 = AdapterFactory.createAdapter("html5", { videoElement: new MockVideoElement() });
      expect(html5.provider).toBe("html5");

      const yt = AdapterFactory.createAdapter("youtube", { mockPlayer: {} });
      expect(yt.provider).toBe("youtube");

      const vimeo = AdapterFactory.createAdapter("vimeo", { mockPlayer: {} });
      expect(vimeo.provider).toBe("vimeo");

      const local = AdapterFactory.createAdapter("local", { videoElement: new MockVideoElement() });
      expect(local.provider).toBe("local");

      const screenshare = AdapterFactory.createAdapter("screenshare", { videoElement: new MockVideoElement() });
      expect(screenshare.provider).toBe("screenshare");
    });
  });

  describe("7. Sync Engine Graceful Degradation & Adapter Swapping", () => {
    let mockVideo: MockVideoElement;

    beforeEach(() => {
      mockVideo = new MockVideoElement();
    });

    it("gracefully degrades when adapter does not support playbackRate, falling back to hard seek only", () => {
      // Create custom adapter that lacks playbackRate support
      const limitedAdapter: PlayerAdapter = {
        provider: "html5",
        capabilities: {
          supportsPlaybackRate: false, // Limited control!
          supportsPreciseSeek: true,
          isLive: false,
          canAutoplay: true,
        },
        load: async () => {},
        play: async () => {},
        pause: () => {},
        seek: vi.fn(),
        getCurrentTime: () => 10000,
        getState: () => "playing",
        setPlaybackRate: vi.fn(),
        getDuration: () => 100000,
        onStateChange: () => () => {},
        onBuffering: () => () => {},
        onEnded: () => () => {},
        onError: () => () => {},
      };

      const engine = new PlaybackSyncEngine({
        adapter: limitedAdapter,
        sendPing: () => {},
      });

      engine.setPlaybackState({
        videoId: "v1",
        status: "playing",
        positionMs: 10200, // drift = -200ms (Zone 2 for normal adapters)
        serverTimeMs: engine.serverNow(),
        playbackRate: 1.0,
      });

      engine.evaluateDrift();

      // Because supportsPlaybackRate is false, Zone 2 rate-nudging is skipped,
      // and drift engine immediately falls back to hard seek!
      expect(limitedAdapter.setPlaybackRate).not.toHaveBeenCalled();
      expect(limitedAdapter.seek).toHaveBeenCalledWith(expect.closeTo(10200, -2));

      engine.destroy();
    });

    it("gracefully handles live stream mode (ScreenShareAdapter) without seeking or rate adjustments", () => {
      const liveAdapter: PlayerAdapter = {
        provider: "screenshare",
        capabilities: {
          supportsPlaybackRate: false,
          supportsPreciseSeek: false,
          isLive: true,
          canAutoplay: true,
        },
        load: async () => {},
        play: async () => {},
        pause: () => {},
        seek: vi.fn(),
        getCurrentTime: () => 50000,
        getState: () => "playing",
        setPlaybackRate: vi.fn(),
        getDuration: () => Infinity,
        onStateChange: () => () => {},
        onBuffering: () => () => {},
        onEnded: () => () => {},
        onError: () => () => {},
      };

      const engine = new PlaybackSyncEngine({
        adapter: liveAdapter,
        sendPing: () => {},
      });

      engine.setPlaybackState({
        videoId: "live-screen",
        status: "playing",
        positionMs: 10000,
        serverTimeMs: engine.serverNow(),
        playbackRate: 1.0,
      });

      engine.evaluateDrift();

      // Screen share is live: no seeks, no rate adjustments, reports in_sync
      expect(liveAdapter.seek).not.toHaveBeenCalled();
      expect(liveAdapter.setPlaybackRate).not.toHaveBeenCalled();
      expect(engine.getMetrics().syncStatus).toBe("in_sync");

      engine.destroy();
    });

    it("supports dynamic adapter swapping via setAdapter()", () => {
      const adapter1 = new HTML5Adapter(mockVideo);
      const engine = new PlaybackSyncEngine({
        adapter: adapter1,
        sendPing: () => {},
      });

      expect(engine.getAdapter().provider).toBe("html5");

      const adapter2 = new ScreenShareAdapter({ videoElement: mockVideo });
      engine.setAdapter(adapter2);

      expect(engine.getAdapter().provider).toBe("screenshare");
      expect(engine.getAdapter().capabilities.isLive).toBe(true);

      engine.destroy();
    });
  });

  describe("8. SourceDetector & SSRF Security Validation", () => {
    it("blocks private IPv4 and loopback addresses (SSRF)", () => {
      const blockedUrls = [
        "http://127.0.0.1/video.mp4",
        "http://localhost/video.mp4",
        "http://10.0.0.1/stream.m3u8",
        "http://192.168.1.50/movie.mp4",
        "http://172.16.0.1/video.webm",
        "http://172.31.255.255/video.mp4",
        "http://169.254.169.254/latest/meta-data", // Cloud metadata
        "http://0.0.0.0/test.mp4",
        "http://2130706433/test.mp4", // Decimal 127.0.0.1
        "http://0x7f000001/test.mp4", // Hex 127.0.0.1
      ];

      for (const url of blockedUrls) {
        const result = SourceDetector.detect(url);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/SSRF|private|loopback/i);
      }
    });

    it("blocks IPv6 loopback and private ranges", () => {
      const blockedIpv6 = [
        "http://[::1]/video.mp4",
        "http://[fc00::1]/video.mp4",
        "http://[fe80::1]/video.mp4",
      ];

      for (const url of blockedIpv6) {
        const result = SourceDetector.detect(url);
        expect(result.valid).toBe(false);
      }
    });

    it("rejects unsafe non-HTTP protocols", () => {
      const unsafe = [
        "file:///etc/passwd",
        "ftp://example.com/video.mp4",
        "gopher://example.com/",
        "javascript:alert(1)",
      ];

      for (const url of unsafe) {
        const result = SourceDetector.detect(url);
        expect(result.valid).toBe(false);
      }
    });

    it("detects YouTube URLs accurately", () => {
      const yt1 = SourceDetector.detect("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(yt1.valid).toBe(true);
      expect(yt1.provider).toBe("youtube");
      expect(yt1.sourceRef).toBe("dQw4w9WgXcQ");

      const yt2 = SourceDetector.detect("https://youtu.be/dQw4w9WgXcQ");
      expect(yt2.valid).toBe(true);
      expect(yt2.provider).toBe("youtube");
      expect(yt2.sourceRef).toBe("dQw4w9WgXcQ");
    });

    it("detects Vimeo URLs accurately", () => {
      const vimeo = SourceDetector.detect("https://vimeo.com/76979871");
      expect(vimeo.valid).toBe(true);
      expect(vimeo.provider).toBe("vimeo");
      expect(vimeo.sourceRef).toBe("76979871");
    });

    it("detects Direct HTML5 media URLs accurately", () => {
      const mp4 = SourceDetector.detect("https://cdn.example.com/videos/bunny.mp4");
      expect(mp4.valid).toBe(true);
      expect(mp4.provider).toBe("html5");
      expect(mp4.sourceRef).toBe("https://cdn.example.com/videos/bunny.mp4");

      const hls = SourceDetector.detect("https://cdn.example.com/live/stream.m3u8");
      expect(hls.valid).toBe(true);
      expect(hls.provider).toBe("html5");
    });

    it("detects Local File and Screen Share references", () => {
      const local = SourceDetector.detect("local://video.mp4");
      expect(local.valid).toBe(true);
      expect(local.provider).toBe("local");

      const screenshare = SourceDetector.detect("screenshare://display");
      expect(screenshare.valid).toBe(true);
      expect(screenshare.provider).toBe("screenshare");
    });
  });
});
