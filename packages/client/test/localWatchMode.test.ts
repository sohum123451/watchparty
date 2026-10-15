import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeFileFingerprint,
  compareFingerprints,
  LocalOffsetStore,
  convertSrtToVtt,
  parseSubtitleTimestamp,
  parseSubtitleCues,
  LocalFileFingerprint,
} from "../src/features/LocalWatchManager.js";
import { LocalFileAdapter } from "../src/adapters/LocalFileAdapter.js";
import { PlaybackSyncEngine } from "../src/index.js";

// Mock localStorage for headless Node environment
const createMockLocalStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
};

describe("Local-File Watch Mode & Fingerprinting", () => {
  let mockStorage: ReturnType<typeof createMockLocalStorage>;

  beforeEach(() => {
    mockStorage = createMockLocalStorage();
    (globalThis as any).localStorage = mockStorage;
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
    vi.restoreAllMocks();
  });

  describe("1. Fast Fingerprint Computation & Privacy Guarantee", () => {
    it("computes fast fingerprint using duration, size, and SHA-256 of first and last 1 MB", async () => {
      // Create a 2.5 MB fake video buffer
      const totalSize = 2.5 * 1024 * 1024;
      const buffer = new Uint8Array(totalSize);
      // Put distinct bytes in head and tail
      buffer.fill(65, 0, 1024 * 1024); // 'A' in head
      buffer.fill(66, totalSize - 1024 * 1024, totalSize); // 'B' in tail

      const file = new File([buffer], "indie-movie-2026.mp4", { type: "video/mp4" });
      const durationMs = 125000; // 2 min 5 sec

      const fp = await computeFileFingerprint(file, durationMs);

      expect(fp.fileName).toBe("indie-movie-2026.mp4");
      expect(fp.fileSize).toBe(totalSize);
      expect(fp.fileType).toBe("video/mp4");
      expect(fp.durationMs).toBe(125000);
      expect(fp.headSha256).toBeDefined();
      expect(fp.headSha256.length).toBe(64);
      expect(fp.tailSha256).toBeDefined();
      expect(fp.tailSha256.length).toBe(64);
      expect(fp.combinedFingerprint).toMatch(/^v1:2621440:125000:[a-f0-9]{32}:[a-f0-9]{32}$/);

      // Verify privacy: The fingerprint structure does NOT contain video payload or raw buffer
      expect((fp as any).data).toBeUndefined();
      expect((fp as any).buffer).toBeUndefined();
    });

    it("handles files smaller than 1 MB safely without duplicating chunks", async () => {
      const smallSize = 512 * 1024; // 512 KB
      const buffer = new Uint8Array(smallSize);
      buffer.fill(42);

      const file = new File([buffer], "short-clip.mp4", { type: "video/mp4" });
      const fp = await computeFileFingerprint(file, 15000);

      expect(fp.fileSize).toBe(smallSize);
      expect(fp.durationMs).toBe(15000);
      expect(fp.combinedFingerprint).toContain(`v1:${smallSize}:15000:`);
    });
  });

  describe("2. Fingerprint Comparison (Match vs Different Version vs Mismatch)", () => {
    const baseHostFp: LocalFileFingerprint = {
      fileName: "classic-film.mp4",
      fileSize: 104857600, // 100 MB
      fileType: "video/mp4",
      durationMs: 7200000, // 2 hours
      headSha256: "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
      tailSha256: "f6e5d4c3b2a109876543210fedcba09876543210fedcba09876543210fedcba",
      combinedFingerprint: "v1:104857600:7200000:a1b2c3d4e5f678901234567890abcdef:f6e5d4c3b2a109876543210fedcba098",
    };

    it("returns 'match' when head, tail, file size, and duration match exactly", () => {
      const guestFp: LocalFileFingerprint = { ...baseHostFp, fileName: "my_copy.mp4" };
      const result = compareFingerprints(baseHostFp, guestFp);

      expect(result.status).toBe("match");
      expect(result.headMatched).toBe(true);
      expect(result.tailMatched).toBe(true);
      expect(result.sizeDiffBytes).toBe(0);
      expect(result.durationDiffMs).toBe(0);
      expect(result.suggestedOffsetMs).toBe(0);
    });

    it("returns 'different_version' when head matches but tail differs (extended cut / different outro)", () => {
      const guestFp: LocalFileFingerprint = {
        ...baseHostFp,
        fileSize: 108000000,
        durationMs: 7260000, // +60s
        tailSha256: "0000000000000000000000000000000000000000000000000000000000000000",
        combinedFingerprint: "v1:108000000:7260000:a1b2c3d4:00000000",
      };
      const result = compareFingerprints(baseHostFp, guestFp);

      expect(result.status).toBe("different_version");
      expect(result.headMatched).toBe(true);
      expect(result.tailMatched).toBe(false);
      expect(result.durationDiffMs).toBe(60000);
    });

    it("returns 'different_version' with suggested offset when tail matches but head differs (intro bumper cut)", () => {
      const guestFp: LocalFileFingerprint = {
        ...baseHostFp,
        fileSize: 102000000,
        durationMs: 7195000, // -5s (5000ms intro missing)
        headSha256: "9999999999999999999999999999999999999999999999999999999999999999",
        combinedFingerprint: "v1:102000000:7195000:99999999:f6e5d4c3",
      };
      const result = compareFingerprints(baseHostFp, guestFp);

      expect(result.status).toBe("different_version");
      expect(result.headMatched).toBe(false);
      expect(result.tailMatched).toBe(true);
      expect(result.suggestedOffsetMs).toBe(-5000);
    });

    it("returns 'different_version' when duration ratio is close (re-encode with different bitrates)", () => {
      const guestFp: LocalFileFingerprint = {
        fileName: "720p-encode.mp4",
        fileSize: 50000000, // 50 MB
        fileType: "video/mp4",
        durationMs: 7200500, // 500ms difference
        headSha256: "1111111111111111111111111111111111111111111111111111111111111111",
        tailSha256: "2222222222222222222222222222222222222222222222222222222222222222",
        combinedFingerprint: "v1:50000000:7200500:1111:2222",
      };
      const result = compareFingerprints(baseHostFp, guestFp);

      expect(result.status).toBe("different_version");
    });

    it("returns 'mismatch' when files are completely distinct movies", () => {
      const guestFp: LocalFileFingerprint = {
        fileName: "another-movie.mp4",
        fileSize: 20000000,
        fileType: "video/mp4",
        durationMs: 1800000, // 30 mins vs 2 hours
        headSha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        tailSha256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        combinedFingerprint: "v1:20000000:1800000:ffff:eeee",
      };
      const result = compareFingerprints(baseHostFp, guestFp);

      expect(result.status).toBe("mismatch");
      expect(result.headMatched).toBe(false);
      expect(result.tailMatched).toBe(false);
    });
  });

  describe("3. Local Time Offset Persistence (LocalOffsetStore)", () => {
    it("persists and retrieves manual time offsets per fingerprint", () => {
      const fp = "v1:1000:5000:abc:def";
      expect(LocalOffsetStore.getOffset(fp)).toBe(0);

      LocalOffsetStore.setOffset(fp, 1500);
      expect(LocalOffsetStore.getOffset(fp)).toBe(1500);

      LocalOffsetStore.setOffset(fp, -500);
      expect(LocalOffsetStore.getOffset(fp)).toBe(-500);

      LocalOffsetStore.clearOffset(fp);
      expect(LocalOffsetStore.getOffset(fp)).toBe(0);
    });

    it("gracefully returns 0 when localStorage is unavailable", () => {
      delete (globalThis as any).localStorage;
      expect(LocalOffsetStore.getOffset("v1:any")).toBe(0);
      expect(() => LocalOffsetStore.setOffset("v1:any", 1000)).not.toThrow();
    });
  });

  describe("4. Subtitles Parsing (.srt and .vtt)", () => {
    const sampleSrt = `1
00:00:01,000 --> 00:00:04,500
Hello, welcome to the watch party!

2
00:00:05,200 --> 00:00:08,000
Enjoy the show together in perfect sync.`;

    const sampleVtt = `WEBVTT

00:00:10.000 --> 00:00:13.500
Another scene begins here.

00:00:15.000 --> 00:00:18.000
The end of the chapter.`;

    it("parses timestamps in both SRT and VTT formats accurately", () => {
      expect(parseSubtitleTimestamp("00:01:23,456")).toBe(83456);
      expect(parseSubtitleTimestamp("00:01:23.456")).toBe(83456);
      expect(parseSubtitleTimestamp("01:23.456")).toBe(83456);
      expect(parseSubtitleTimestamp("00:00:00,000")).toBe(0);
    });

    it("converts SRT format to WebVTT format", () => {
      const converted = convertSrtToVtt(sampleSrt);
      expect(converted.startsWith("WEBVTT")).toBe(true);
      expect(converted).toContain("00:00:01.000 --> 00:00:04.500");
      expect(converted).toContain("00:00:05.200 --> 00:00:08.000");
    });

    it("parses SRT cues into structured cue items", () => {
      const cues = parseSubtitleCues(sampleSrt);
      expect(cues).toHaveLength(2);
      expect(cues[0].startMs).toBe(1000);
      expect(cues[0].endMs).toBe(4500);
      expect(cues[0].text).toBe("Hello, welcome to the watch party!");

      expect(cues[1].startMs).toBe(5200);
      expect(cues[1].endMs).toBe(8000);
      expect(cues[1].text).toBe("Enjoy the show together in perfect sync.");
    });

    it("parses WebVTT cues into structured cue items", () => {
      const cues = parseSubtitleCues(sampleVtt);
      expect(cues).toHaveLength(2);
      expect(cues[0].startMs).toBe(10000);
      expect(cues[0].endMs).toBe(13500);
      expect(cues[0].text).toBe("Another scene begins here.");
    });
  });

  describe("5. LocalFileAdapter Implementation & Manual Time Offset", () => {
    it("exposes correct provider and playback capabilities", () => {
      const adapter = new LocalFileAdapter();
      expect(adapter.provider).toBe("local");
      expect(adapter.capabilities.supportsPlaybackRate).toBe(true);
      expect(adapter.capabilities.supportsPreciseSeek).toBe(true);
      expect(adapter.capabilities.isLive).toBe(false);
      expect(adapter.capabilities.canAutoplay).toBe(true);
    });

    it("applies manual time offset inside seek() and getCurrentTime() transparently", async () => {
      const videoMock = {
        currentTime: 0,
        playbackRate: 1.0,
        paused: true,
        seeking: false,
        play: async () => { videoMock.paused = false; },
        pause: () => { videoMock.paused = true; },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };

      const adapter = new LocalFileAdapter(videoMock as any);
      await adapter.load({
        provider: "local",
        sourceRef: "fp_test123",
        title: "Test Cut",
        durationMs: 120000,
      });

      // User sets an intro offset of +2000 ms (guest file has 2 extra seconds of intro)
      adapter.setTimeOffsetMs(2000);
      expect(adapter.getTimeOffsetMs()).toBe(2000);

      // When sync engine seeks canonical room position to 10,000 ms:
      // Video element must be positioned at 12,000 ms (10,000 + 2,000)
      adapter.seek(10000);
      expect(videoMock.currentTime).toBe(12);

      // When reporting back to the sync engine:
      // Canonical time returned must be 10,000 ms (12,000 - 2,000)
      expect(adapter.getCurrentTime()).toBe(10000);

      // Test negative offset (guest file is missing 1000ms intro)
      adapter.setTimeOffsetMs(-1000);
      adapter.seek(5000);
      expect(videoMock.currentTime).toBe(4);
      expect(adapter.getCurrentTime()).toBe(5000);
    });

    it("automatically persists and restores offset for the loaded fingerprint", async () => {
      const fp = "v1:50000:60000:aabbcc:ddeeff";
      LocalOffsetStore.setOffset(fp, 3500);

      const adapter = new LocalFileAdapter();
      await adapter.load({
        provider: "local",
        sourceRef: fp,
        title: "Movie with saved offset",
        durationMs: 60000,
      });

      // Offset was automatically restored on load
      expect(adapter.getTimeOffsetMs()).toBe(3500);

      // Updating offset updates localStorage
      adapter.setTimeOffsetMs(4000);
      expect(LocalOffsetStore.getOffset(fp)).toBe(4000);
    });

    it("loads subtitles and returns active cues factoring in timeOffsetMs", async () => {
      const adapter = new LocalFileAdapter();
      const srt = `1
00:00:10,000 --> 00:00:15,000
Dialogue at ten seconds`;

      const result = await adapter.loadSubtitles(srt);
      expect(result.cueCount).toBe(1);

      // Canonical 12s -> in range [10s, 15s]
      expect(adapter.getActiveCue(12000)).toBe("Dialogue at ten seconds");
      expect(adapter.getActiveCue(20000)).toBeNull();

      // With +5s manual offset: canonical 7s -> video time 12s (matches cue!)
      adapter.setTimeOffsetMs(5000);
      expect(adapter.getActiveCue(7000)).toBe("Dialogue at ten seconds");
      expect(adapter.getActiveCue(12000)).toBeNull(); // video time is 17s (outside range)

      adapter.clearSubtitles();
      expect(adapter.getActiveCue(7000)).toBeNull();
    });

    it("compares guest copy with host metadata via compareWithHost()", async () => {
      const adapter = new LocalFileAdapter();
      const hostFp: LocalFileFingerprint = {
        fileName: "host.mp4",
        fileSize: 10000,
        fileType: "video/mp4",
        durationMs: 50000,
        headSha256: "head123",
        tailSha256: "tail123",
        combinedFingerprint: "v1:10000:50000:head123:tail123",
      };

      await adapter.load({
        provider: "local",
        sourceRef: "v1:10000:50000:head123:tail123",
        title: "My Copy",
        durationMs: 50000,
      });

      const comp = adapter.compareWithHost(hostFp);
      expect(comp.status).toBeDefined();
    });
  });

  describe("6. PlaybackSyncEngine Integration with LocalFileAdapter", () => {
    it("synchronizes playback state and applies seeking seamlessly with manual time offset", async () => {
      let currentTime = 0;
      let paused = true;
      const listeners: Record<string, Function[]> = {};

      const videoMock = {
        get currentTime() { return currentTime; },
        set currentTime(val: number) { currentTime = val; },
        playbackRate: 1.0,
        get paused() { return paused; },
        set paused(val: boolean) { paused = val; },
        seeking: false,
        play: async () => { paused = false; },
        pause: () => { paused = true; },
        addEventListener: (event: string, fn: Function) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(fn);
        },
        removeEventListener: (event: string, fn: Function) => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter(l => l !== fn);
          }
        },
      };

      const adapter = new LocalFileAdapter(videoMock as any);
      // User has a +1000 ms offset (local cut has 1s extra opening)
      adapter.setTimeOffsetMs(1000);

      const engine = new PlaybackSyncEngine({
        adapter,
        sendPing: vi.fn(),
        driftIntervalMs: 250,
      });

      const now = Date.now();
      engine.setPlaybackState({
        videoId: "v1:video",
        status: "playing",
        positionMs: 20000, // Room canonical time is 20,000 ms
        serverTimeMs: now,
        playbackRate: 1.0,
        provider: "local",
        sourceRef: "v1:video",
      });

      // Video element physically seeks to 20,000 + 1,000 = 21,000 ms (21 seconds)
      expect(videoMock.currentTime).toBeCloseTo(21, 1);
      // Canonical time reported back is 20,000 ms (matching canonical room time!)
      expect(Math.abs(adapter.getCurrentTime() - 20000)).toBeLessThanOrEqual(50);
      expect(videoMock.paused).toBe(false);

      // Verify that canonical room position matches target position
      expect(engine.getTargetPositionMs()).toBeGreaterThanOrEqual(20000);

      engine.destroy();
    });
  });
});
