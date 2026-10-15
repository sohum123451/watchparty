import { PlayerAdapter, PlayerCapabilities, PlayerSource, PlayerState } from "./PlayerAdapter.js";
import { SyncVideoElement } from "../sync/types.js";
import {
  LocalFileFingerprint,
  FingerprintComparisonResult,
  SubtitleCue,
  computeFileFingerprint,
  compareFingerprints,
  LocalOffsetStore,
  convertSrtToVtt,
  parseSubtitleCues,
} from "../features/LocalWatchManager.js";

export interface LocalFileMetadata extends LocalFileFingerprint {}

export interface LocalFileAdapterOptions {
  videoElement?: HTMLVideoElement | SyncVideoElement;
  initialOffsetMs?: number;
}

export class LocalFileAdapter implements PlayerAdapter {
  public readonly provider = "local" as const;
  public readonly capabilities: PlayerCapabilities = {
    supportsPlaybackRate: true,
    supportsPreciseSeek: true,
    isLive: false,
    canAutoplay: true,
  };

  private readonly video: SyncVideoElement | HTMLVideoElement;
  private currentSource: PlayerSource | null = null;
  private currentObjectUrl: string | null = null;
  private metadata: LocalFileFingerprint | null = null;
  private currentState: PlayerState = "unstarted";
  private isBuffering = false;

  // Manual time offset (in milliseconds) for differing cuts/editions
  private timeOffsetMs = 0;

  // Subtitle cues & track management
  private subtitleCues: SubtitleCue[] = [];
  private activeSubtitleTrack: any = null;
  private activeSubtitleUrl: string | null = null;

  private readonly stateListeners: Set<(state: PlayerState) => void> = new Set();
  private readonly bufferListeners: Set<(buffering: boolean) => void> = new Set();
  private readonly endedListeners: Set<() => void> = new Set();
  private readonly errorListeners: Set<(error: any) => void> = new Set();
  private readonly seekListeners: Set<(positionMs: number) => void> = new Set();
  private readonly offsetListeners: Set<(offsetMs: number) => void> = new Set();
  private readonly subtitleListeners: Set<(cues: SubtitleCue[]) => void> = new Set();

  private readonly boundOnPlay: () => void;
  private readonly boundOnPause: () => void;
  private readonly boundOnWaiting: () => void;
  private readonly boundOnPlaying: () => void;
  private readonly boundOnSeeked: () => void;
  private readonly boundOnEnded: () => void;
  private readonly boundOnError: (e?: any) => void;

  constructor(videoOrOptions?: HTMLVideoElement | SyncVideoElement | LocalFileAdapterOptions) {
    if (videoOrOptions && "videoElement" in videoOrOptions) {
      this.video = (videoOrOptions as LocalFileAdapterOptions).videoElement || this.createDefaultVideoElement();
      if (typeof (videoOrOptions as LocalFileAdapterOptions).initialOffsetMs === "number") {
        this.timeOffsetMs = (videoOrOptions as LocalFileAdapterOptions).initialOffsetMs!;
      }
    } else if (videoOrOptions && "addEventListener" in videoOrOptions) {
      this.video = videoOrOptions as HTMLVideoElement | SyncVideoElement;
    } else {
      this.video = this.createDefaultVideoElement();
    }

    this.boundOnPlay = () => this.setState("playing");
    this.boundOnPause = () => this.setState("paused");
    this.boundOnWaiting = () => {
      this.isBuffering = true;
      this.setState("buffering");
      for (const fn of this.bufferListeners) fn(true);
    };
    this.boundOnPlaying = () => {
      if (this.isBuffering) {
        this.isBuffering = false;
        for (const fn of this.bufferListeners) fn(false);
      }
      this.setState("playing");
    };
    this.boundOnSeeked = () => {
      if (this.isBuffering) {
        this.isBuffering = false;
        for (const fn of this.bufferListeners) fn(false);
      }
      const canonicalPosMs = this.getCurrentTime();
      for (const fn of this.seekListeners) fn(canonicalPosMs);
    };
    this.boundOnEnded = () => {
      this.setState("ended");
      for (const fn of this.endedListeners) fn();
    };
    this.boundOnError = (e) => {
      for (const fn of this.errorListeners) fn(e);
    };

    this.attachEvents();
  }

  private createDefaultVideoElement(): SyncVideoElement {
    if (typeof document !== "undefined") {
      return document.createElement("video");
    }
    return {
      currentTime: 0,
      playbackRate: 1.0,
      paused: true,
      seeking: false,
      play: async () => {},
      pause: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }

  private attachEvents(): void {
    this.video.addEventListener("play", this.boundOnPlay);
    this.video.addEventListener("pause", this.boundOnPause);
    this.video.addEventListener("waiting", this.boundOnWaiting);
    this.video.addEventListener("playing", this.boundOnPlaying);
    this.video.addEventListener("seeked", this.boundOnSeeked);
    this.video.addEventListener("ended", this.boundOnEnded);
    this.video.addEventListener("error", this.boundOnError);
  }

  private detachEvents(): void {
    this.video.removeEventListener("play", this.boundOnPlay);
    this.video.removeEventListener("pause", this.boundOnPause);
    this.video.removeEventListener("waiting", this.boundOnWaiting);
    this.video.removeEventListener("playing", this.boundOnPlaying);
    this.video.removeEventListener("seeked", this.boundOnSeeked);
    this.video.removeEventListener("ended", this.boundOnEnded);
    this.video.removeEventListener("error", this.boundOnError);
  }

  private setState(state: PlayerState): void {
    if (this.currentState !== state) {
      this.currentState = state;
      for (const fn of this.stateListeners) fn(state);
    }
  }

  /**
   * Fast fingerprint computation (delegates to LocalWatchManager)
   */
  public async computeFingerprint(file: File | Blob): Promise<string> {
    const fp = await computeFileFingerprint(file);
    return fp.combinedFingerprint;
  }

  public async load(source: PlayerSource | string): Promise<void> {
    const src: PlayerSource = typeof source === "string" ? { provider: "local", sourceRef: source } : source;
    this.currentSource = src;

    // Revoke previous object URL if any
    if (this.currentObjectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }

    let videoUrl = src.sourceRef;

    if (src.file) {
      const file = src.file;
      const fp = await computeFileFingerprint(file, src.durationMs);
      this.metadata = fp;

      // Auto-load persisted offset for this specific fingerprint
      const persistedOffset = LocalOffsetStore.getOffset(fp.combinedFingerprint);
      if (persistedOffset !== 0) {
        this.timeOffsetMs = persistedOffset;
      }

      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        this.currentObjectUrl = URL.createObjectURL(file);
        videoUrl = this.currentObjectUrl;
      }
    } else {
      const fileName = src.title || "local-video";
      const fingerprint = src.sourceRef.startsWith("v1:") || src.sourceRef.startsWith("fp_")
        ? src.sourceRef
        : `fp_${src.sourceRef}`;

      this.metadata = {
        fileName,
        fileSize: 0,
        fileType: "video/mp4",
        durationMs: src.durationMs || 0,
        headSha256: "0".repeat(64),
        tailSha256: "0".repeat(64),
        combinedFingerprint: fingerprint,
        fingerprint: fingerprint,
      };

      const persistedOffset = LocalOffsetStore.getOffset(fingerprint);
      if (persistedOffset !== 0) {
        this.timeOffsetMs = persistedOffset;
      }
    }

    (this.video as any).src = videoUrl;
    this.setState("cued");
  }

  public async play(): Promise<void> {
    try {
      await this.video.play();
      this.setState("playing");
    } catch (err: any) {
      for (const fn of this.errorListeners) fn(err);
      throw err;
    }
  }

  public pause(): void {
    this.video.pause();
    this.setState("paused");
  }

  /**
   * Applies seek on the canonical timeline, transparently shifted by timeOffsetMs
   */
  public seek(canonicalPositionMs: number): void {
    const targetVideoMs = Math.max(0, canonicalPositionMs + this.timeOffsetMs);
    this.video.currentTime = targetVideoMs / 1000;
  }

  /**
   * Returns canonical timeline position (adjusted for user's manual time offset)
   */
  public getCurrentTime(): number {
    const rawVideoMs = Math.round((this.video.currentTime || 0) * 1000);
    return Math.max(0, rawVideoMs - this.timeOffsetMs);
  }

  public getState(): PlayerState {
    if (this.currentState === "ended") return "ended";
    if (this.isBuffering) return "buffering";
    if (this.video.paused) return "paused";
    return this.currentState || "playing";
  }

  public setPlaybackRate(rate: number): void {
    this.video.playbackRate = rate;
  }

  public getDuration(): number {
    const d = (this.video as any).duration;
    if (typeof d === "number" && !isNaN(d) && isFinite(d)) {
      return Math.round(d * 1000);
    }
    return this.metadata?.durationMs || this.currentSource?.durationMs || 0;
  }

  // ==========================================
  // MANUAL TIME OFFSET (PERSISTED PER FINGERPRINT)
  // ==========================================

  public setTimeOffsetMs(offsetMs: number, persist = true): void {
    this.timeOffsetMs = Math.round(offsetMs);
    if (persist && this.metadata?.combinedFingerprint) {
      LocalOffsetStore.setOffset(this.metadata.combinedFingerprint, this.timeOffsetMs);
    }
    for (const fn of this.offsetListeners) fn(this.timeOffsetMs);
  }

  public getTimeOffsetMs(): number {
    return this.timeOffsetMs;
  }

  public onOffsetChange(listener: (offsetMs: number) => void): () => void {
    this.offsetListeners.add(listener);
    return () => this.offsetListeners.delete(listener);
  }

  // ==========================================
  // SUBTITLES (.SRT / .VTT) SUPPORT
  // ==========================================

  public async loadSubtitles(fileOrContent: File | Blob | string, label = "Local Subtitles"): Promise<{ cueCount: number }> {
    let rawText = "";
    if (typeof fileOrContent === "string") {
      rawText = fileOrContent;
    } else if (fileOrContent && typeof fileOrContent.text === "function") {
      rawText = await fileOrContent.text();
    } else {
      throw new Error("Invalid subtitle input: must be File, Blob, or string content.");
    }

    // Convert SRT to WebVTT format if needed
    const vttContent = convertSrtToVtt(rawText);
    this.subtitleCues = parseSubtitleCues(rawText);

    // If browser environment with HTML5 video, attach native TextTrack
    if (typeof document !== "undefined" && typeof URL !== "undefined" && "appendChild" in this.video) {
      this.clearSubtitleTrack();
      const vttBlob = new Blob([vttContent], { type: "text/vtt" });
      this.activeSubtitleUrl = URL.createObjectURL(vttBlob);

      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = label;
      track.srclang = "en";
      track.src = this.activeSubtitleUrl;
      track.default = true;

      (this.video as any).appendChild(track);
      if ((track as any).track) {
        (track as any).track.mode = "showing";
      } else {
        (track as any).mode = "showing";
      }
      this.activeSubtitleTrack = track;
    }

    for (const fn of this.subtitleListeners) fn(this.subtitleCues);
    return { cueCount: this.subtitleCues.length };
  }

  public clearSubtitles(): void {
    this.clearSubtitleTrack();
    this.subtitleCues = [];
    for (const fn of this.subtitleListeners) fn([]);
  }

  private clearSubtitleTrack(): void {
    if (this.activeSubtitleTrack && this.activeSubtitleTrack.parentNode) {
      this.activeSubtitleTrack.parentNode.removeChild(this.activeSubtitleTrack);
      this.activeSubtitleTrack = null;
    }
    if (this.activeSubtitleUrl && typeof URL !== "undefined") {
      URL.revokeObjectURL(this.activeSubtitleUrl);
      this.activeSubtitleUrl = null;
    }
  }

  /**
   * Retrieves active subtitle cue text for the given canonical time (or current video position)
   */
  public getActiveCue(canonicalTimeMs?: number): string | null {
    if (this.subtitleCues.length === 0) return null;
    const canTime = typeof canonicalTimeMs === "number" ? canonicalTimeMs : this.getCurrentTime();
    // Video time includes manual offset
    const videoTimeMs = canTime + this.timeOffsetMs;

    const cue = this.subtitleCues.find((c) => videoTimeMs >= c.startMs && videoTimeMs <= c.endMs);
    return cue ? cue.text : null;
  }

  public getSubtitleCues(): SubtitleCue[] {
    return [...this.subtitleCues];
  }

  public onSubtitlesChange(listener: (cues: SubtitleCue[]) => void): () => void {
    this.subtitleListeners.add(listener);
    return () => this.subtitleListeners.delete(listener);
  }

  // ==========================================
  // FINGERPRINT COMPARISON & METADATA
  // ==========================================

  public getMetadata(): LocalFileMetadata | null {
    return this.metadata;
  }

  public getFingerprintData(): LocalFileFingerprint | null {
    return this.metadata;
  }

  public verifyMatch(expectedFingerprint: string): boolean {
    if (!this.metadata) return false;
    return (
      this.metadata.combinedFingerprint === expectedFingerprint ||
      this.metadata.fingerprint === expectedFingerprint
    );
  }

  public compareWithHost(hostMeta: LocalFileFingerprint): FingerprintComparisonResult {
    if (!this.metadata) {
      return {
        status: "mismatch",
        message: "No local file loaded to compare.",
        durationDiffMs: 0,
        sizeDiffBytes: 0,
        headMatched: false,
        tailMatched: false,
      };
    }
    return compareFingerprints(hostMeta, this.metadata);
  }

  public getVideoElement(): SyncVideoElement | HTMLVideoElement {
    return this.video;
  }

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

  public destroy(): void {
    this.detachEvents();
    this.clearSubtitleTrack();

    if (this.currentObjectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }

    this.stateListeners.clear();
    this.bufferListeners.clear();
    this.endedListeners.clear();
    this.errorListeners.clear();
    this.seekListeners.clear();
    this.offsetListeners.clear();
    this.subtitleListeners.clear();
  }
}
