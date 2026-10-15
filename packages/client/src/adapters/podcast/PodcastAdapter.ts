import {
  PlayerAdapter,
  PlayerCapabilities,
  PlayerSource,
  PlayerState,
} from "../PlayerAdapter.js";
import { SyncVideoElement, SyncEngineConfig } from "../../sync/types.js";
import {
  PodcastEpisode,
  PodcastFeed,
  PodcastChapter,
  PodcastTranscriptCue,
  PodcastAdapterOptions,
} from "./PodcastTypes.js";
import { PodcastFeedParser } from "./PodcastFeedParser.js";
import { PODCAST_SYNC_CONFIG } from "./PodcastSyncConfig.js";

export class PodcastAdapter implements PlayerAdapter {
  public readonly provider = "podcast" as const;
  public readonly capabilities: PlayerCapabilities = {
    supportsPlaybackRate: true,
    supportsPreciseSeek: true,
    isLive: false,
    canAutoplay: true,
  };

  private readonly audio: HTMLAudioElement | any;
  private feed: PodcastFeed | null = null;
  private currentEpisode: PodcastEpisode | null = null;
  private currentState: PlayerState = "unstarted";
  private isBuffering = false;
  private isCorsRestricted = false;
  private hasTriedWithoutCors = false;

  // Active track navigation
  private activeChapter: PodcastChapter | null = null;
  private activeTranscriptCue: PodcastTranscriptCue | null = null;

  // Event Listeners
  private readonly stateListeners: Set<(state: PlayerState) => void> = new Set();
  private readonly bufferListeners: Set<(buffering: boolean) => void> = new Set();
  private readonly endedListeners: Set<() => void> = new Set();
  private readonly errorListeners: Set<(error: any) => void> = new Set();
  private readonly seekListeners: Set<(positionMs: number) => void> = new Set();

  // Podcast-specific listeners
  private readonly episodeListeners: Set<(ep: PodcastEpisode | null) => void> = new Set();
  private readonly chapterListeners: Set<(chapter: PodcastChapter | null) => void> = new Set();
  private readonly transcriptListeners: Set<(cue: PodcastTranscriptCue | null) => void> = new Set();

  // Bound DOM handlers
  private readonly boundOnPlay: () => void;
  private readonly boundOnPause: () => void;
  private readonly boundOnWaiting: () => void;
  private readonly boundOnPlaying: () => void;
  private readonly boundOnCanPlay: () => void;
  private readonly boundOnSeeked: () => void;
  private readonly boundOnEnded: () => void;
  private readonly boundOnError: (e?: any) => void;
  private readonly boundOnTimeUpdate: () => void;

  constructor(options: PodcastAdapterOptions = {}) {
    if (options.audioElement) {
      this.audio = options.audioElement;
    } else if (typeof document !== "undefined") {
      this.audio = document.createElement("audio");
    } else {
      this.audio = this.createMockAudioElement();
    }

    // Always preserve pitch during rate adjustments to prevent vocal pitch distortion
    this.enforcePreservePitch();
    try {
      this.audio.crossOrigin = "anonymous";
    } catch {}

    this.boundOnPlay = () => this.setState("playing");
    this.boundOnPause = () => this.setState("paused");
    this.boundOnWaiting = () => {
      this.isBuffering = true;
      this.setState("buffering");
      this.notifyBuffering(true);
    };
    this.boundOnPlaying = () => {
      if (this.isBuffering) {
        this.isBuffering = false;
        this.notifyBuffering(false);
      }
      this.setState("playing");
    };
    this.boundOnCanPlay = () => {
      if (this.isBuffering) {
        this.isBuffering = false;
        this.notifyBuffering(false);
      }
    };
    this.boundOnSeeked = () => {
      const posMs = this.getCurrentTime();
      for (const fn of this.seekListeners) fn(posMs);
      this.updateActiveChapterAndTranscript(posMs);
    };
    this.boundOnEnded = () => {
      this.setState("ended");
      for (const fn of this.endedListeners) fn();
    };
    this.boundOnError = (e) => {
      // Graceful CORS fallback:
      // If error occurred while trying crossOrigin = "anonymous", remove crossOrigin and retry!
      if (!this.hasTriedWithoutCors && this.audio) {
        this.isCorsRestricted = true;
        this.hasTriedWithoutCors = true;
        try {
          if (typeof this.audio.removeAttribute === "function") {
            this.audio.removeAttribute("crossOrigin");
          }
          this.audio.crossOrigin = null;
          if (this.currentEpisode) {
            this.audio.src = this.currentEpisode.enclosureUrl;
            if (typeof this.audio.load === "function") this.audio.load();
          }
          return;
        } catch (retryErr) {
          // Continue to error notification
        }
      }

      for (const fn of this.errorListeners) fn(e);
    };

    this.boundOnTimeUpdate = () => {
      const posMs = this.getCurrentTime();
      this.updateActiveChapterAndTranscript(posMs);
    };

    this.attachEvents();

    if (options.initialEpisode) {
      this.selectEpisode(options.initialEpisode);
    }
  }

  private enforcePreservePitch(): void {
    if (!this.audio) return;
    try {
      this.audio.preservesPitch = true;
      if ("mozPreservesPitch" in this.audio) (this.audio as any).mozPreservesPitch = true;
      if ("webkitPreservesPitch" in this.audio) (this.audio as any).webkitPreservesPitch = true;
    } catch {
      // Safe ignore in environments without pitch preservation
    }
  }

  private createMockAudioElement(): any {
    return {
      currentTime: 0,
      playbackRate: 1.0,
      paused: true,
      seeking: false,
      duration: 0,
      src: "",
      crossOrigin: "anonymous",
      preservesPitch: true,
      play: async () => {},
      pause: () => {},
      load: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      removeAttribute: () => {},
    };
  }

  private attachEvents(): void {
    if (!this.audio || typeof this.audio.addEventListener !== "function") return;
    this.audio.addEventListener("play", this.boundOnPlay);
    this.audio.addEventListener("pause", this.boundOnPause);
    this.audio.addEventListener("waiting", this.boundOnWaiting);
    this.audio.addEventListener("playing", this.boundOnPlaying);
    this.audio.addEventListener("canplay", this.boundOnCanPlay);
    this.audio.addEventListener("seeked", this.boundOnSeeked);
    this.audio.addEventListener("ended", this.boundOnEnded);
    this.audio.addEventListener("error", this.boundOnError);
    this.audio.addEventListener("timeupdate", this.boundOnTimeUpdate);
  }

  private detachEvents(): void {
    if (!this.audio || typeof this.audio.removeEventListener !== "function") return;
    this.audio.removeEventListener("play", this.boundOnPlay);
    this.audio.removeEventListener("pause", this.boundOnPause);
    this.audio.removeEventListener("waiting", this.boundOnWaiting);
    this.audio.removeEventListener("playing", this.boundOnPlaying);
    this.audio.removeEventListener("canplay", this.boundOnCanPlay);
    this.audio.removeEventListener("seeked", this.boundOnSeeked);
    this.audio.removeEventListener("ended", this.boundOnEnded);
    this.audio.removeEventListener("error", this.boundOnError);
    this.audio.removeEventListener("timeupdate", this.boundOnTimeUpdate);
  }

  private setState(state: PlayerState): void {
    if (this.currentState !== state) {
      this.currentState = state;
      for (const fn of this.stateListeners) fn(state);
    }
  }

  private notifyBuffering(buffering: boolean): void {
    for (const fn of this.bufferListeners) fn(buffering);
  }

  /**
   * Loads an RSS Feed XML or URL string, populating feed and episodes.
   */
  public async loadFeed(xmlOrUrl: string): Promise<PodcastFeed> {
    const trimmed = (xmlOrUrl || "").trim();
    let xmlContent = trimmed;

    // Check if it's a URL or raw XML
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("podcast://")) {
      const cleanUrl = trimmed.replace(/^podcast:\/\//, "https://");
      try {
        const res = await fetch(cleanUrl);
        if (!res.ok) {
          throw new Error(`Failed to fetch podcast feed: HTTP ${res.status}`);
        }
        xmlContent = await res.text();
      } catch (err) {
        // If browser CORS blocked direct RSS fetch, try internal proxy if in browser
        if (typeof window !== "undefined") {
          try {
            const proxyRes = await fetch(`/api/podcast/feed?url=${encodeURIComponent(cleanUrl)}`);
            if (proxyRes.ok) {
              xmlContent = await proxyRes.text();
            } else {
              throw err;
            }
          } catch {
            throw err;
          }
        } else {
          throw err;
        }
      }
    }

    const parsedFeed = PodcastFeedParser.parseFeed(xmlContent);
    this.feed = parsedFeed;

    // If no episode is currently selected, select the first available episode
    if (!this.currentEpisode && parsedFeed.episodes.length > 0) {
      await this.selectEpisode(parsedFeed.episodes[0]);
    }

    return parsedFeed;
  }

  /**
   * Selects an episode by entity or GUID and loads its direct enclosure audio stream.
   */
  public async selectEpisode(episodeOrGuid: PodcastEpisode | string): Promise<void> {
    let ep: PodcastEpisode | undefined;

    if (typeof episodeOrGuid === "string") {
      ep = this.feed?.episodes.find((e) => e.guid === episodeOrGuid || e.enclosureUrl === episodeOrGuid);
      if (!ep) {
        // Treat as standalone direct enclosure URL
        ep = {
          guid: episodeOrGuid,
          title: "Podcast Audio",
          enclosureUrl: episodeOrGuid,
          enclosureType: "audio/mpeg",
          durationMs: 0,
        };
      }
    } else {
      ep = episodeOrGuid;
    }

    this.currentEpisode = ep;
    this.hasTriedWithoutCors = false;
    this.isCorsRestricted = false;

    // Check if audio needs Podcasting 2.0 remote chapters fetched
    if (ep.chaptersUrl && (!ep.chapters || ep.chapters.length === 0)) {
      this.fetchRemoteChapters(ep.chaptersUrl).catch(() => {});
    }

    // Check if audio needs Podcasting 2.0 remote transcript fetched
    if (ep.transcriptUrl && (!ep.transcript || ep.transcript.length === 0)) {
      this.fetchRemoteTranscript(ep.transcriptUrl, ep.transcriptType).catch(() => {});
    }

    // Load audio stream directly from creator's host enclosure URL
    await this.loadEnclosureStream(ep.enclosureUrl);

    for (const fn of this.episodeListeners) fn(ep);
  }

  private async fetchRemoteChapters(url: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        const chapters = PodcastFeedParser.parseChaptersJson(text);
        if (this.currentEpisode && chapters.length > 0) {
          this.currentEpisode.chapters = chapters;
          this.updateActiveChapterAndTranscript(this.getCurrentTime());
        }
      }
    } catch {
      // Non-fatal, show notes timestamp fallback will be used
    }
  }

  private async fetchRemoteTranscript(url: string, type?: string): Promise<void> {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        const cues = PodcastFeedParser.parseTranscript(text, type);
        if (this.currentEpisode && cues.length > 0) {
          this.currentEpisode.transcript = cues;
          this.updateActiveChapterAndTranscript(this.getCurrentTime());
        }
      }
    } catch {
      // Non-fatal
    }
  }

  private async loadEnclosureStream(enclosureUrl: string): Promise<void> {
    if (!this.audio) return;

    // Set anonymous crossOrigin to attempt Web Audio visualizer integration
    try {
      this.audio.crossOrigin = "anonymous";
    } catch {
      // Ignore if not supported
    }

    this.audio.src = enclosureUrl;
    this.enforcePreservePitch();

    if (typeof this.audio.load === "function") {
      this.audio.load();
    }

    this.setState("cued");
    this.setState("paused");
  }

  // ==========================================
  // PLAYER ADAPTER INTERFACE IMPLEMENTATION
  // ==========================================

  public async load(source: PlayerSource | string | PodcastEpisode): Promise<void> {
    if (typeof source === "string") {
      // Check if it's an RSS feed XML or URL vs direct audio enclosure
      const isXmlOrFeed =
        source.includes("<rss") ||
        source.includes("<channel") ||
        source.endsWith(".xml") ||
        source.endsWith(".rss") ||
        source.includes("/feed");

      if (isXmlOrFeed) {
        await this.loadFeed(source);
      } else {
        await this.selectEpisode(source);
      }
    } else if ("enclosureUrl" in source) {
      await this.selectEpisode(source as PodcastEpisode);
    } else {
      // PlayerSource
      const srcRef = source.sourceRef;
      if (
        srcRef.includes("<rss") ||
        srcRef.endsWith(".xml") ||
        srcRef.endsWith(".rss") ||
        srcRef.includes("/feed")
      ) {
        await this.loadFeed(srcRef);
      } else {
        await this.selectEpisode(srcRef);
      }
    }
  }

  public async play(): Promise<void> {
    this.enforcePreservePitch();
    if (this.audio && typeof this.audio.play === "function") {
      await this.audio.play();
    }
    this.setState("playing");
  }

  public pause(): void {
    if (this.audio && typeof this.audio.pause === "function") {
      this.audio.pause();
    }
    this.setState("paused");
  }

  public seek(positionMs: number): void {
    const seconds = Math.max(0, positionMs / 1000);
    if (this.audio) {
      this.audio.currentTime = seconds;
    }
    this.updateActiveChapterAndTranscript(positionMs);
  }

  public getCurrentTime(): number {
    if (!this.audio) return 0;
    return Math.round((this.audio.currentTime || 0) * 1000);
  }

  public getState(): PlayerState {
    return this.currentState;
  }

  public setPlaybackRate(rate: number): void {
    this.enforcePreservePitch();
    if (this.audio) {
      this.audio.playbackRate = rate;
      this.enforcePreservePitch();
    }
  }

  public getDuration(): number {
    if (this.audio && !isNaN(this.audio.duration) && this.audio.duration > 0) {
      return Math.round(this.audio.duration * 1000);
    }
    if (this.currentEpisode && this.currentEpisode.durationMs > 0) {
      return this.currentEpisode.durationMs;
    }
    return 0;
  }

  // ==========================================
  // EVENT SUBSCRIPTIONS
  // ==========================================

  public onStateChange(listener: (state: PlayerState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public onBuffering(listener: (buffering: boolean) => void): () => void {
    this.bufferListeners.add(listener);
    return () => this.bufferListeners.delete(listener);
  }

  public onEnded(listener: () => void): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  public onError(listener: (error: any) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  public onSeek(listener: (positionMs: number) => void): () => void {
    this.seekListeners.add(listener);
    return () => this.seekListeners.delete(listener);
  }

  public onEpisodeChange(listener: (episode: PodcastEpisode | null) => void): () => void {
    this.episodeListeners.add(listener);
    return () => this.episodeListeners.delete(listener);
  }

  public onChapterChange(listener: (chapter: PodcastChapter | null) => void): () => void {
    this.chapterListeners.add(listener);
    return () => this.chapterListeners.delete(listener);
  }

  public onTranscriptCueChange(listener: (cue: PodcastTranscriptCue | null) => void): () => void {
    this.transcriptListeners.add(listener);
    return () => this.transcriptListeners.delete(listener);
  }

  // ==========================================
  // CHAPTER & TRANSCRIPT TIME-SYNC LOGIC
  // ==========================================

  private updateActiveChapterAndTranscript(positionMs: number): void {
    // 1. Chapters
    const chapters = this.getChapters();
    if (chapters.length > 0) {
      let matchedChapter: PodcastChapter | null = null;
      for (let i = chapters.length - 1; i >= 0; i--) {
        if (positionMs >= chapters[i].startTimeMs) {
          if (chapters[i].endTimeMs == null || positionMs < chapters[i].endTimeMs!) {
            matchedChapter = chapters[i];
            break;
          }
        }
      }
      if (this.activeChapter !== matchedChapter) {
        this.activeChapter = matchedChapter;
        for (const fn of this.chapterListeners) fn(matchedChapter);
      }
    }

    // 2. Transcript
    const transcript = this.getTranscript();
    if (transcript.length > 0) {
      const matchedCue =
        transcript.find((c) => positionMs >= c.startTimeMs && positionMs <= c.endTimeMs) || null;
      if (this.activeTranscriptCue !== matchedCue) {
        this.activeTranscriptCue = matchedCue;
        for (const fn of this.transcriptListeners) fn(matchedCue);
      }
    }
  }

  // ==========================================
  // PODCAST PLAYLIST & METADATA HELPERS
  // ==========================================

  public getAudioElement(): HTMLAudioElement | any {
    return this.audio;
  }

  public getVideoElement(): SyncVideoElement {
    return {
      currentTime: (this.audio.currentTime || 0),
      playbackRate: (this.audio.playbackRate || 1.0),
      paused: this.audio.paused ?? true,
      seeking: this.audio.seeking ?? false,
      play: () => this.play(),
      pause: () => this.pause(),
      addEventListener: (type: string, fn: any) => this.audio.addEventListener?.(type, fn),
      removeEventListener: (type: string, fn: any) => this.audio.removeEventListener?.(type, fn),
    };
  }

  public getRecommendedSyncConfig(): Partial<SyncEngineConfig> {
    return PODCAST_SYNC_CONFIG;
  }

  public getCurrentEpisode(): PodcastEpisode | null {
    return this.currentEpisode;
  }

  public getPodcastFeed(): PodcastFeed | null {
    return this.feed;
  }

  public getEpisodes(): PodcastEpisode[] {
    return this.feed ? [...this.feed.episodes] : [];
  }

  public getChapters(): PodcastChapter[] {
    return this.currentEpisode?.chapters ? [...this.currentEpisode.chapters] : [];
  }

  public getCurrentChapter(): PodcastChapter | null {
    return this.activeChapter;
  }

  public getTranscript(): PodcastTranscriptCue[] {
    return this.currentEpisode?.transcript ? [...this.currentEpisode.transcript] : [];
  }

  public getCurrentTranscriptCue(): PodcastTranscriptCue | null {
    return this.activeTranscriptCue;
  }

  public isCorsRestrictedAudio(): boolean {
    return this.isCorsRestricted;
  }

  public setCorsRestricted(restricted: boolean): void {
    this.isCorsRestricted = restricted;
  }

  /**
   * Returns the next episode in the feed, allowing the host or room playlist
   * to queue or advance into the shared playlist.
   */
  public getNextEpisode(): PodcastEpisode | null {
    if (!this.feed || !this.currentEpisode) return null;
    const episodes = this.feed.episodes;
    const curIdx = episodes.findIndex((e) => e.guid === this.currentEpisode!.guid);
    if (curIdx !== -1 && curIdx + 1 < episodes.length) {
      return episodes[curIdx + 1];
    }
    return null;
  }

  public destroy(): void {
    this.detachEvents();
    if (this.audio && typeof this.audio.pause === "function") {
      this.audio.pause();
    }
    this.stateListeners.clear();
    this.bufferListeners.clear();
    this.endedListeners.clear();
    this.errorListeners.clear();
    this.seekListeners.clear();
    this.episodeListeners.clear();
    this.chapterListeners.clear();
    this.transcriptListeners.clear();
  }
}
