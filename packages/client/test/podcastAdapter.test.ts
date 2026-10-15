import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PodcastAdapter,
  PodcastFeedParser,
  PODCAST_SYNC_CONFIG,
  PodcastEpisode,
  PodcastChapter,
  PodcastTranscriptCue,
  AdapterFactory,
  PlaybackSyncEngine,
} from "../src/index.js";
import { SourceDetector } from "@watchparty/shared";

// Mock plain HTML Audio Element
class MockAudioElement {
  private _currentTime = 0;
  public playbackRate = 1.0;
  public paused = true;
  public seeking = false;
  public duration = 1800; // 30 minutes in seconds
  public src = "";
  public crossOrigin: string | null = "anonymous";
  public preservesPitch = true;
  public mozPreservesPitch = true;
  public webkitPreservesPitch = true;

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

  public removeAttribute(attr: string): void {
    if (attr === "crossOrigin") {
      this.crossOrigin = null;
    }
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

  public load(): void {
    this.emit("canplay");
  }
}

// Sample RSS Feed with Podcasting 2.0 tags and show notes
const SAMPLE_PODCAST_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://podcastindex.org/namespace/1.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>The Synchronized Web Show</title>
    <link>https://creator.example.com/show</link>
    <description>Exploring real-time distributed web media and shared listening.</description>
    <itunes:author>Alice &amp; Bob</itunes:author>
    <itunes:image href="https://creator.example.com/art.jpg"/>
    <language>en-us</language>

    <item>
      <title>Episode 42: Clock-Sync and Audio Drift Engines</title>
      <link>https://creator.example.com/ep42</link>
      <guid>ep_42_sync_engine</guid>
      <pubDate>Wed, 14 Oct 2026 12:00:00 GMT</pubDate>
      <itunes:duration>00:45:30</itunes:duration>
      <itunes:image href="https://creator.example.com/ep42.jpg"/>
      <enclosure url="https://cdn.podcasthost.example/audio/ep42.mp3" type="audio/mpeg" length="43690666"/>
      <description><![CDATA[
        In this episode, we dive deep into NTP clock synchronization and audio drift correction!
        00:00 - Introduction &amp; News
        03:15 - Why Audio Offsets Sound Worse Than Video
        14:30 - Pitch Preservation and Micro-Nudging
        32:00 - Live Q&amp;A
      ]]></description>
      <podcast:chapters url="https://creator.example.com/ep42-chapters.json" type="application/json"/>
      <podcast:transcript url="https://creator.example.com/ep42.vtt" type="text/vtt"/>
    </item>

    <item>
      <title>Episode 43: Next Episode: Building Distributed Watch Parties</title>
      <link>https://creator.example.com/ep43</link>
      <guid>ep_43_watch_parties</guid>
      <pubDate>Wed, 21 Oct 2026 12:00:00 GMT</pubDate>
      <itunes:duration>3600</itunes:duration>
      <enclosure url="https://cdn.podcasthost.example/audio/ep43.mp3" type="audio/mpeg" length="50000000"/>
      <description>Continuous playlist playback across the room!</description>
    </item>
  </channel>
</rss>`;

const SAMPLE_VTT_TRANSCRIPT = `WEBVTT

00:00:01.000 --> 00:00:04.500
<v Alice>Welcome everyone to the Synchronized Web Show!</v>

00:00:05.000 --> 00:00:09.200
<v Bob>Today we are talking about distributed audio sync and drift engines.</v>

00:00:10.000 --> 00:00:15.000
<v Alice>Because human ears are extremely sensitive to phase offsets!</v>
`;

describe("PodcastAdapter, Audio-Specific Sync & Listening Room", () => {
  let mockAudio: MockAudioElement;
  let adapter: PodcastAdapter;

  beforeEach(() => {
    mockAudio = new MockAudioElement();
    adapter = new PodcastAdapter({ audioElement: mockAudio });
  });

  afterEach(() => {
    adapter.destroy();
  });

  describe("1. PlayerAdapter Interface & Audio Element Implementation", () => {
    it("conforms to PlayerAdapter interface with correct provider and capabilities", () => {
      expect(adapter.provider).toBe("podcast");
      expect(adapter.capabilities.supportsPlaybackRate).toBe(true);
      expect(adapter.capabilities.supportsPreciseSeek).toBe(true);
      expect(adapter.capabilities.isLive).toBe(false);
      expect(adapter.capabilities.canAutoplay).toBe(true);
    });

    it("enforces preservesPitch = true on audio element across all playback rate adjustments", () => {
      expect(mockAudio.preservesPitch).toBe(true);
      expect(mockAudio.mozPreservesPitch).toBe(true);
      expect(mockAudio.webkitPreservesPitch).toBe(true);

      adapter.setPlaybackRate(1.05);
      expect(mockAudio.playbackRate).toBe(1.05);
      expect(mockAudio.preservesPitch).toBe(true);

      adapter.setPlaybackRate(0.95);
      expect(mockAudio.playbackRate).toBe(0.95);
      expect(mockAudio.preservesPitch).toBe(true);
    });

    it("controls playback: play, pause, seek, getCurrentTime, getDuration", async () => {
      const stateChanges: string[] = [];
      adapter.onStateChange((s) => stateChanges.push(s));

      await adapter.play();
      expect(mockAudio.paused).toBe(false);
      expect(adapter.getState()).toBe("playing");
      expect(stateChanges).toContain("playing");

      adapter.pause();
      expect(mockAudio.paused).toBe(true);
      expect(adapter.getState()).toBe("paused");

      adapter.seek(45000); // 45 seconds
      expect(mockAudio.currentTime).toBe(45);
      expect(adapter.getCurrentTime()).toBe(45000);

      expect(adapter.getDuration()).toBe(1800000); // 1800s * 1000
    });

    it("instantiates cleanly via AdapterFactory", () => {
      const factoryAdapter = AdapterFactory.createAdapter("podcast", {
        audioElement: mockAudio,
      });
      expect(factoryAdapter.provider).toBe("podcast");
      expect(factoryAdapter.capabilities.supportsPlaybackRate).toBe(true);
      factoryAdapter.destroy?.();
    });
  });

  describe("2. Source: Direct Enclosure Streaming & Creator Attribution", () => {
    it("streams directly from creator's enclosure URL without re-hosting", async () => {
      const feed = await adapter.loadFeed(SAMPLE_PODCAST_RSS);
      expect(feed.title).toBe("The Synchronized Web Show");
      expect(feed.author).toBe("Alice & Bob");
      expect(feed.link).toBe("https://creator.example.com/show");
      expect(feed.episodes.length).toBe(2);

      const ep1 = adapter.getCurrentEpisode();
      expect(ep1).toBeDefined();
      expect(ep1?.title).toBe("Episode 42: Clock-Sync and Audio Drift Engines");
      // Direct stream enclosure URL from creator's CDN
      expect(ep1?.enclosureUrl).toBe("https://cdn.podcasthost.example/audio/ep42.mp3");
      expect(mockAudio.src).toBe("https://cdn.podcasthost.example/audio/ep42.mp3");

      // Creator attribution and link back to original page
      expect(ep1?.podcastAuthor).toBe("Alice & Bob");
      expect(ep1?.podcastLink).toBe("https://creator.example.com/show");
      expect(ep1?.episodeLink).toBe("https://creator.example.com/ep42");
    });

    it("gracefully falls back when audio host is CORS-less without breaking playback", async () => {
      await adapter.loadFeed(SAMPLE_PODCAST_RSS);
      expect(mockAudio.src).toBe("https://cdn.podcasthost.example/audio/ep42.mp3");

      // In constructor or load, crossOrigin is initially attempted for Web Audio
      expect(mockAudio.crossOrigin).toBe("anonymous");

      // Simulate browser throwing an error due to CORS-less audio CDN
      mockAudio.emit("error", new Error("Cross-origin request blocked"));

      // Adapter catches error, strips crossOrigin, and reloads direct audio stream!
      expect(mockAudio.crossOrigin).toBeNull();
      expect(adapter.isCorsRestrictedAudio()).toBe(true);
      // Playback works without crossOrigin requirement
      expect(mockAudio.src).toBe("https://cdn.podcasthost.example/audio/ep42.mp3");
    });
  });

  describe("3. Podcasting 2.0 Chapters & Show Notes Timestamp Extraction", () => {
    it("extracts timestamped chapters from show notes when external JSON chapters are pending", async () => {
      await adapter.loadFeed(SAMPLE_PODCAST_RSS);
      const chapters = adapter.getChapters();

      expect(chapters.length).toBe(4);
      expect(chapters[0]).toEqual({
        startTimeMs: 0,
        endTimeMs: 195000,
        title: "Introduction & News",
      });
      expect(chapters[1]).toEqual({
        startTimeMs: 195000, // 03:15 = 195s
        endTimeMs: 870000,   // 14:30 = 870s
        title: "Why Audio Offsets Sound Worse Than Video",
      });
      expect(chapters[2]).toEqual({
        startTimeMs: 870000,
        endTimeMs: 1920000,  // 32:00 = 1920s
        title: "Pitch Preservation and Micro-Nudging",
      });
      expect(chapters[3]).toEqual({
        startTimeMs: 1920000,
        endTimeMs: undefined,
        title: "Live Q&A",
      });
    });

    it("tracks live active chapter when seeking and playing", async () => {
      await adapter.loadFeed(SAMPLE_PODCAST_RSS);

      let currentActiveChap: PodcastChapter | null = null;
      adapter.onChapterChange((c) => {
        currentActiveChap = c;
      });

      // Seek into chapter 1 (03:15 - 14:30)
      adapter.seek(200000); // 200s (inside chapter 1)
      expect(currentActiveChap).not.toBeNull();
      expect((currentActiveChap as any)?.title).toBe("Why Audio Offsets Sound Worse Than Video");

      // Seek into chapter 2 (14:30 - 32:00)
      adapter.seek(900000);
      expect((currentActiveChap as any)?.title).toBe("Pitch Preservation and Micro-Nudging");
    });

    it("parses Podcasting 2.0 JSON chapters specification accurately", () => {
      const jsonChapters = JSON.stringify({
        version: "1.2.0",
        chapters: [
          { startTime: 0, title: "Intro", img: "https://example.com/ch1.png" },
          { startTime: 120, title: "WebSockets vs WebRTC", img: "https://example.com/ch2.png" },
          { startTime: 300, endTime: 600, title: "Conclusion" },
        ],
      });

      const parsed = PodcastFeedParser.parseChaptersJson(jsonChapters);
      expect(parsed.length).toBe(3);
      expect(parsed[0].startTimeMs).toBe(0);
      expect(parsed[0].endTimeMs).toBe(120000);
      expect(parsed[0].title).toBe("Intro");
      expect(parsed[0].img).toBe("https://example.com/ch1.png");

      expect(parsed[1].startTimeMs).toBe(120000);
      expect(parsed[1].endTimeMs).toBe(300000);

      expect(parsed[2].startTimeMs).toBe(300000);
      expect(parsed[2].endTimeMs).toBe(600000);
    });
  });

  describe("4. Synced Transcript Parsing & Active Cue Tracking", () => {
    it("parses WebVTT transcripts and extracts speaker voices", () => {
      const cues = PodcastFeedParser.parseTranscript(SAMPLE_VTT_TRANSCRIPT, "text/vtt");
      expect(cues.length).toBe(3);

      expect(cues[0].startTimeMs).toBe(1000);
      expect(cues[0].endTimeMs).toBe(4500);
      expect(cues[0].speaker).toBe("Alice");
      expect(cues[0].text).toBe("Welcome everyone to the Synchronized Web Show!");

      expect(cues[1].startTimeMs).toBe(5000);
      expect(cues[1].endTimeMs).toBe(9200);
      expect(cues[1].speaker).toBe("Bob");

      expect(cues[2].startTimeMs).toBe(10000);
      expect(cues[2].endTimeMs).toBe(15000);
      expect(cues[2].speaker).toBe("Alice");
    });

    it("tracks live transcript active cue as audio progresses", async () => {
      await adapter.loadFeed(SAMPLE_PODCAST_RSS);
      const ep = adapter.getCurrentEpisode()!;
      ep.transcript = PodcastFeedParser.parseTranscript(SAMPLE_VTT_TRANSCRIPT, "text/vtt");

      let activeCue: PodcastTranscriptCue | null = null;
      adapter.onTranscriptCueChange((cue) => {
        activeCue = cue;
      });

      adapter.seek(2000); // 2s -> matches cue 0 (1s - 4.5s)
      expect(activeCue).not.toBeNull();
      expect((activeCue as any)?.speaker).toBe("Alice");
      expect((activeCue as any)?.text).toContain("Welcome everyone");

      adapter.seek(7000); // 7s -> matches cue 1 (5s - 9.2s)
      expect((activeCue as any)?.speaker).toBe("Bob");
    });
  });

  describe("5. Episode Picker & Shared Room Playlist Feeder", () => {
    it("host selects an episode from feed and loads audio enclosure", async () => {
      const feed = await adapter.loadFeed(SAMPLE_PODCAST_RSS);
      expect(feed.episodes.length).toBe(2);

      // Host chooses Episode 43
      await adapter.selectEpisode(feed.episodes[1]);
      expect(adapter.getCurrentEpisode()?.title).toBe(
        "Episode 43: Next Episode: Building Distributed Watch Parties"
      );
      expect(mockAudio.src).toBe("https://cdn.podcasthost.example/audio/ep43.mp3");
    });

    it("getNextEpisode() identifies the next episode to feed into the shared playlist", async () => {
      await adapter.loadFeed(SAMPLE_PODCAST_RSS);
      expect(adapter.getCurrentEpisode()?.title).toBe(
        "Episode 42: Clock-Sync and Audio Drift Engines"
      );

      const nextEp = adapter.getNextEpisode();
      expect(nextEp).not.toBeNull();
      expect(nextEp?.title).toBe(
        "Episode 43: Next Episode: Building Distributed Watch Parties"
      );
      expect(nextEp?.enclosureUrl).toBe("https://cdn.podcasthost.example/audio/ep43.mp3");

      // Advance to next episode
      await adapter.selectEpisode(nextEp!);
      expect(adapter.getNextEpisode()).toBeNull(); // No further episode
    });
  });

  describe("6. Audio-Specific Sync Engine & Drift Tuning", () => {
    it("exposes tight audio-specific sync configuration", () => {
      expect(PODCAST_SYNC_CONFIG.deadZoneMs).toBe(20); // Tighter than video (40ms)
      expect(PODCAST_SYNC_CONFIG.hysteresisZoneMs).toBe(10);
      expect(PODCAST_SYNC_CONFIG.hardSeekThresholdMs).toBe(1500); // Higher threshold to avoid seek pops
      expect(PODCAST_SYNC_CONFIG.maxRateAdjustment).toBe(0.05); // Smooth unnoticeable pitch-preserved nudging
      expect(PODCAST_SYNC_CONFIG.driftIntervalMs).toBe(150);

      expect(adapter.getRecommendedSyncConfig()).toEqual(PODCAST_SYNC_CONFIG);
    });

    it("PlaybackSyncEngine automatically adopts PodcastAdapter recommended thresholds", () => {
      const syncEngine = new PlaybackSyncEngine({
        adapter,
        sendPing: () => {},
      });

      // Initial state
      mockAudio.currentTime = 10.0;
      syncEngine.setPlaybackState({
        videoId: "ep42",
        status: "playing",
        positionMs: 10000,
        serverTimeMs: syncEngine.serverNow(),
        playbackRate: 1.0,
      });

      // Test 1: In deadband (15ms drift <= 20ms deadZoneMs) -> in_sync, rate stays 1.0
      mockAudio.currentTime = 10.015; // +15ms drift
      syncEngine.evaluateDrift();
      expect(syncEngine.getMetrics().syncStatus).toBe("in_sync");
      expect(mockAudio.playbackRate).toBe(1.0);

      // Test 2: Drift of 200ms (> 20ms deadzone, but < 1500ms hardSeekThreshold)
      // Drift engine PREFERS playbackRate nudging with preservesPitch = true instead of hard seek!
      mockAudio.currentTime = 9.800; // -200ms behind
      syncEngine.evaluateDrift();
      expect(syncEngine.getMetrics().syncStatus).toBe("adjusting");
      // Behind -> gently speeds up (e.g. > 1.0x)
      expect(mockAudio.playbackRate).toBeGreaterThan(1.0);
      expect(mockAudio.preservesPitch).toBe(true);

      // Test 3: Large jump of 2000ms (> 1500ms hard seek threshold) -> performs hard seek
      mockAudio.currentTime = 8.000; // -2000ms behind
      const seekSpy = vi.spyOn(adapter, "seek");
      syncEngine.evaluateDrift();
      expect(seekSpy).toHaveBeenCalledWith(expect.closeTo(10000, -2));

      syncEngine.destroy();
    });
  });

  describe("7. SourceDetector Podcast Recognition", () => {
    it("detects podcast RSS feeds as provider 'podcast'", () => {
      const feed1 = SourceDetector.detect("https://feeds.buzzsprout.com/12345.rss");
      expect(feed1.valid).toBe(true);
      expect(feed1.provider).toBe("podcast");

      const feed2 = SourceDetector.detect("https://anchor.fm/s/12345/podcast/rss");
      expect(feed2.valid).toBe(true);
      expect(feed2.provider).toBe("podcast");

      const feed3 = SourceDetector.detect("https://creator.example.com/show/feed.xml");
      expect(feed3.valid).toBe(true);
      expect(feed3.provider).toBe("podcast");
    });

    it("detects direct audio enclosures as provider 'podcast'", () => {
      const audio1 = SourceDetector.detect("https://cdn.example.com/podcasts/episode1.mp3");
      expect(audio1.valid).toBe(true);
      expect(audio1.provider).toBe("podcast");

      const audio2 = SourceDetector.detect("https://cdn.example.com/podcasts/episode2.m4a");
      expect(audio2.valid).toBe(true);
      expect(audio2.provider).toBe("podcast");
    });

    it("detects podcast pseudo-scheme", () => {
      const explicit = SourceDetector.detect("podcast://creator.example.com/feed.xml");
      expect(explicit.valid).toBe(true);
      expect(explicit.provider).toBe("podcast");
    });
  });
});
