import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  EmbedAdapter,
  EmbedSecurity,
  SANDBOX_PERMISSIONS,
  FEATURE_POLICY_ALLOW,
  EMBED_SYNC_CONFIGS,
  AdapterFactory,
  PlaybackSyncEngine,
} from "../src/index.js";
import { SourceDetector } from "@watchparty/shared";

// Mock IFrame and Window for testing
class MockIFrameWindow {
  public postMessages: Array<{ message: any; targetOrigin: string }> = [];

  public postMessage(message: any, targetOrigin: string): void {
    this.postMessages.push({ message, targetOrigin });
  }
}

class MockIFrameElement {
  public src = "";
  public contentWindow = new MockIFrameWindow();
  public attributes: Map<string, string> = new Map();
  public parentNode: any = null;

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

describe("EmbedAdapter, Control Protocols & Sandboxed Iframe", () => {
  let mockIframe: MockIFrameElement;
  let adapter: EmbedAdapter;

  beforeEach(() => {
    mockIframe = new MockIFrameElement();
  });

  afterEach(() => {
    adapter?.destroy();
  });

  describe("1. PlayerAdapter Interface & Sandboxed Iframe Security", () => {
    it("conforms to PlayerAdapter interface with embed provider and default capabilities", () => {
      adapter = new EmbedAdapter({ iframeElement: mockIframe as any });
      expect(adapter.provider).toBe("embed");
      expect(adapter.capabilities).toBeDefined();
      expect(typeof adapter.play).toBe("function");
      expect(typeof adapter.pause).toBe("function");
      expect(typeof adapter.seek).toBe("function");
      expect(typeof adapter.getCurrentTime).toBe("function");
      expect(typeof adapter.getState).toBe("function");
      expect(typeof adapter.setPlaybackRate).toBe("function");
      expect(typeof adapter.getDuration).toBe("function");
    });

    it("enforces strict sandboxing and minimal feature policy permissions on the iframe", () => {
      adapter = new EmbedAdapter({ iframeElement: mockIframe as any });
      // sandbox="allow-scripts allow-same-origin allow-presentation"
      expect(mockIframe.getAttribute("sandbox")).toBe(SANDBOX_PERMISSIONS);
      expect(mockIframe.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-presentation");

      // allow="autoplay; fullscreen"
      expect(mockIframe.getAttribute("allow")).toBe(FEATURE_POLICY_ALLOW);
      expect(mockIframe.getAttribute("allow")).toBe("autoplay; fullscreen");
      expect(mockIframe.getAttribute("loading")).toBe("lazy");
    });

    it("strictly validates postMessage origins and rejects malicious or foreign sources", () => {
      adapter = new EmbedAdapter({
        iframeElement: mockIframe as any,
        embedUrl: "https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F12345",
        protocol: "soundcloud",
      });

      const expectedOrigin = "https://w.soundcloud.com";
      expect(adapter.getExpectedOrigin()).toBe(expectedOrigin);

      // Test A: Untrusted attacker origin -> rejected
      const maliciousEvent = {
        origin: "https://evil-attacker.example",
        source: mockIframe.contentWindow,
        data: JSON.stringify({ event: "play" }),
      } as any;
      expect(EmbedSecurity.isOriginTrusted(maliciousEvent, expectedOrigin, mockIframe.contentWindow as any)).toBe(false);

      // Test B: Null or opaque origin without verification -> rejected
      const nullOriginEvent = {
        origin: "null",
        source: mockIframe.contentWindow,
        data: JSON.stringify({ event: "play" }),
      } as any;
      expect(EmbedSecurity.isOriginTrusted(nullOriginEvent, expectedOrigin, mockIframe.contentWindow as any)).toBe(false);

      // Test C: Foreign window (not our iframe) -> rejected
      const foreignWindowEvent = {
        origin: expectedOrigin,
        source: {} as any, // foreign window
        data: JSON.stringify({ event: "play" }),
      } as any;
      expect(EmbedSecurity.isOriginTrusted(foreignWindowEvent, expectedOrigin, mockIframe.contentWindow as any)).toBe(false);

      // Test D: Trusted expected origin and verified iframe contentWindow -> accepted
      const trustedEvent = {
        origin: expectedOrigin,
        source: mockIframe.contentWindow,
        data: JSON.stringify({ event: "play" }),
      } as any;
      expect(EmbedSecurity.isOriginTrusted(trustedEvent, expectedOrigin, mockIframe.contentWindow as any)).toBe(true);
    });

    it("instantiates cleanly via AdapterFactory for 'embed', 'soundcloud', and 'spotify'", () => {
      const embedInst = AdapterFactory.createAdapter("embed", { iframeElement: mockIframe as any });
      expect(embedInst).toBeInstanceOf(EmbedAdapter);

      const scInst = AdapterFactory.createAdapter("soundcloud", { iframeElement: mockIframe as any });
      expect(scInst).toBeInstanceOf(EmbedAdapter);

      const spInst = AdapterFactory.createAdapter("spotify", { iframeElement: mockIframe as any });
      expect(spInst).toBeInstanceOf(EmbedAdapter);
    });
  });

  describe("2. SoundCloud Widget API Protocol", () => {
    it("transforms SoundCloud URLs, establishes Widget protocol, and sends control commands", async () => {
      let approximateNotified = false;
      let approximateReason = "";

      adapter = new EmbedAdapter({
        iframeElement: mockIframe as any,
        sourceUrl: "https://soundcloud.com/artist/track-name",
        onSyncApproximate: (isApprox, reason) => {
          approximateNotified = isApprox;
          approximateReason = reason || "";
        },
      });

      // Validates SoundCloud embed URL transformation
      expect(adapter.getEmbedUrl()).toContain("https://w.soundcloud.com/player/?url=");
      expect(mockIframe.src).toContain("https://w.soundcloud.com/player/?url=");

      // SoundCloud capabilities
      expect(adapter.capabilities.protocol).toBe("soundcloud");
      expect(adapter.capabilities.supportsPlaybackRate).toBe(false); // Widget API does not support variable rate
      expect(adapter.capabilities.supportsPreciseSeek).toBe(true);
      expect(adapter.capabilities.controllable).toBe("limited");
      expect(approximateNotified).toBe(true);
      expect(approximateReason).toContain("SOUNDCLOUD embed does not support playback rate micro-adjustments");

      // Play command: postMessage { method: "play" }
      await adapter.play();
      const lastPlayMsg = mockIframe.contentWindow.postMessages.find((m) =>
        typeof m.message === "string" ? m.message.includes('"method":"play"') : m.message.method === "play"
      );
      expect(lastPlayMsg).toBeDefined();
      expect(lastPlayMsg?.targetOrigin).toBe("https://w.soundcloud.com");

      // Seek command: postMessage { method: "seekTo", value: 45000 }
      adapter.seek(45000);
      const lastSeekMsg = mockIframe.contentWindow.postMessages.find((m) =>
        typeof m.message === "string" ? m.message.includes('"method":"seekTo"') : m.message.method === "seekTo"
      );
      expect(lastSeekMsg).toBeDefined();

      // Receive ready event: widget registers listeners
      adapter.handleWindowMessage({
        origin: "https://w.soundcloud.com",
        source: mockIframe.contentWindow,
        data: JSON.stringify({ event: "ready" }),
      } as any);

      // Verify listeners for play, pause, finish, and playProgress were registered
      const addListenerMsgs = mockIframe.contentWindow.postMessages.filter((m) =>
        typeof m.message === "string" ? m.message.includes("addEventListener") : m.message.method === "addEventListener"
      );
      expect(addListenerMsgs.length).toBeGreaterThanOrEqual(4);

      // Receive playProgress event: updates position in milliseconds
      adapter.handleWindowMessage({
        origin: "https://w.soundcloud.com",
        source: mockIframe.contentWindow,
        data: JSON.stringify({
          event: "playProgress",
          data: { currentPosition: 32450, relativePosition: 0.25 },
        }),
      } as any);

      expect(adapter.getCurrentTime()).toBe(32450);
    });
  });

  describe("3. Spotify iFrame API Protocol", () => {
    it("converts Spotify URLs, sends command messages, and tracks playback updates", async () => {
      let approximateNotified = false;

      adapter = new EmbedAdapter({
        iframeElement: mockIframe as any,
        sourceUrl: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
        onSyncApproximate: (isApprox) => {
          approximateNotified = isApprox;
        },
      });

      expect(adapter.getEmbedUrl()).toContain("https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT");
      expect(adapter.capabilities.protocol).toBe("spotify");
      expect(adapter.capabilities.supportsPlaybackRate).toBe(false);
      expect(adapter.capabilities.controllable).toBe("limited");
      expect(approximateNotified).toBe(true);

      // Play & Seek commands
      await adapter.play();
      const playMsg = mockIframe.contentWindow.postMessages.find((m) =>
        typeof m.message === "string" ? m.message.includes('"command":"play"') : m.message.command === "play"
      );
      expect(playMsg).toBeDefined();
      expect(playMsg?.targetOrigin).toBe("https://open.spotify.com");

      // Spotify seeks in seconds
      adapter.seek(60000);
      const seekMsg = mockIframe.contentWindow.postMessages.find((m) =>
        typeof m.message === "string" ? m.message.includes('"command":"seek"') : m.message.command === "seek"
      );
      expect(seekMsg).toBeDefined();

      // Receive playback_update event from Spotify
      adapter.handleWindowMessage({
        origin: "https://open.spotify.com",
        source: mockIframe.contentWindow,
        data: JSON.stringify({
          type: "playback_update",
          data: {
            position: 60.5,
            duration: 180.0,
            isPaused: false,
          },
        }),
      } as any);

      expect(adapter.getCurrentTime()).toBe(60500);
      expect(adapter.getDuration()).toBe(180000);
      expect(adapter.getState()).toBe("playing");
    });
  });

  describe("4. Vimeo & YouTube Embed Control", () => {
    it("supports Vimeo with full rate control and precise seeking", async () => {
      adapter = new EmbedAdapter({
        iframeElement: mockIframe as any,
        sourceUrl: "https://vimeo.com/76979871",
      });

      expect(adapter.getEmbedUrl()).toBe("https://player.vimeo.com/video/76979871?api=1");
      expect(adapter.capabilities.supportsPlaybackRate).toBe(true);
      expect(adapter.capabilities.controllable).toBe("full");

      // Rate control
      adapter.setPlaybackRate(1.25);
      const rateMsg = mockIframe.contentWindow.postMessages.find((m) =>
        typeof m.message === "string" ? m.message.includes('"method":"setPlaybackRate"') : m.message.method === "setPlaybackRate"
      );
      expect(rateMsg).toBeDefined();

      // Receive timeupdate in seconds
      adapter.handleWindowMessage({
        origin: "https://player.vimeo.com",
        source: mockIframe.contentWindow,
        data: JSON.stringify({
          event: "timeupdate",
          data: { seconds: 12.34, duration: 120.0 },
        }),
      } as any);

      expect(adapter.getCurrentTime()).toBe(12340);
      expect(adapter.getDuration()).toBe(120000);
    });

    it("supports YouTube postMessage API with enablejsapi", async () => {
      adapter = new EmbedAdapter({
        iframeElement: mockIframe as any,
        sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      });

      expect(adapter.getEmbedUrl()).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1");
      expect(adapter.capabilities.supportsPlaybackRate).toBe(true);
      expect(adapter.capabilities.controllable).toBe("full");

      // Play command
      await adapter.play();
      const playMsg = mockIframe.contentWindow.postMessages.find((m) =>
        typeof m.message === "string" ? m.message.includes('"func":"playVideo"') : m.message.func === "playVideo"
      );
      expect(playMsg).toBeDefined();

      // Info delivery event
      adapter.handleWindowMessage({
        origin: "https://www.youtube-nocookie.com",
        source: mockIframe.contentWindow,
        data: JSON.stringify({
          event: "infoDelivery",
          info: { currentTime: 45.67, duration: 212.0, playerState: 1 },
        }),
      } as any);

      expect(adapter.getCurrentTime()).toBe(45670);
      expect(adapter.getDuration()).toBe(212000);
    });
  });

  describe("5. Generic Player.js Protocol & Unknown Compatible Embeds", () => {
    it("falls back to Player.js postMessage format for third-party embeds", async () => {
      adapter = new EmbedAdapter({
        iframeElement: mockIframe as any,
        embedUrl: "https://video.customhost.example/embed/101",
        protocol: "player.js",
      });

      expect(adapter.capabilities.protocol).toBe("player.js");

      // Sends player.js method: "play"
      await adapter.play();
      const playMsg = mockIframe.contentWindow.postMessages.find((m) =>
        typeof m.message === "string" ? m.message.includes('"context":"player.js"') : m.message.context === "player.js"
      );
      expect(playMsg).toBeDefined();

      // Handles player.js timeupdate
      adapter.handleWindowMessage({
        origin: "https://video.customhost.example",
        source: mockIframe.contentWindow,
        data: JSON.stringify({
          context: "player.js",
          event: "timeupdate",
          value: { seconds: 18.5, duration: 90.0 },
        }),
      } as any);

      expect(adapter.getCurrentTime()).toBe(18500);
    });
  });

  describe("6. Host-Driven Soft Sync Degradation", () => {
    it("degrades to host-driven soft sync when embed cannot report live position", () => {
      let softSyncDegraded = false;
      let degradedMessage = "";

      adapter = new EmbedAdapter({
        iframeElement: mockIframe as any,
        embedUrl: "https://restricted-embed.example/player",
        onSoftSyncDegraded: (isDegraded, msg) => {
          softSyncDegraded = isDegraded;
          degradedMessage = msg || "";
        },
      });

      // Explicitly trigger degradation or test automatic fallback
      adapter.degradeToSoftSync("Embed does not expose position telemetry");

      expect(adapter.isSoftSyncActive()).toBe(true);
      expect(adapter.capabilities.reliableGetCurrentTime).toBe(false);
      expect(adapter.capabilities.isHostDrivenSoftSync).toBe(true);
      expect(softSyncDegraded).toBe(true);
      expect(degradedMessage).toContain("Host-driven soft sync active");

      // While in soft-sync, getCurrentTime() computes wall-clock elapsed time from play start
      adapter.seek(10000);
      expect(adapter.getCurrentTime()).toBe(10000);
    });

    it("PlaybackSyncEngine adopts EmbedAdapter recommended configuration without thrashing soft-sync", () => {
      adapter = new EmbedAdapter({
        iframeElement: mockIframe as any,
        sourceUrl: "https://soundcloud.com/artist/demo",
        protocol: "soundcloud",
      });

      expect(adapter.getRecommendedSyncConfig()).toEqual(EMBED_SYNC_CONFIGS.limited);
      expect(adapter.getRecommendedSyncConfig().deadZoneMs).toBe(150);

      const syncEngine = new PlaybackSyncEngine({
        adapter,
        sendPing: () => {},
      });

      // Degrade to soft sync
      adapter.degradeToSoftSync("Testing soft sync stability");

      syncEngine.setPlaybackState({
        videoId: "sc_track",
        status: "playing",
        positionMs: 10000,
        serverTimeMs: syncEngine.serverNow(),
        playbackRate: 1.0,
      });

      // Drift engine respects isHostDrivenSoftSync / reliableGetCurrentTime === false
      // and does NOT attempt erratic hard seeking
      syncEngine.evaluateDrift();
      expect(syncEngine.getMetrics().syncStatus).toBe("in_sync");
      expect(syncEngine.getMetrics().hardSeekCount).toBe(0);

      syncEngine.destroy();
    });
  });

  describe("7. SourceDetector Provider Recognition", () => {
    it("detects SoundCloud URLs as provider 'soundcloud'", () => {
      const res = SourceDetector.detect("https://soundcloud.com/user-12345/summer-remix");
      expect(res.valid).toBe(true);
      expect(res.provider).toBe("soundcloud");
    });

    it("detects Spotify URLs as provider 'spotify'", () => {
      const res = SourceDetector.detect("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT");
      expect(res.valid).toBe(true);
      expect(res.provider).toBe("spotify");
    });

    it("detects generic third-party embed URLs as provider 'embed'", () => {
      const res = SourceDetector.detect("https://www.dailymotion.com/embed/video/x7tgad0");
      expect(res.valid).toBe(true);
      expect(res.provider).toBe("embed");

      const res2 = SourceDetector.detect("embed://custom-video-platform.example/embed/101");
      expect(res2.valid).toBe(true);
      expect(res2.provider).toBe("embed");
    });
  });
});
