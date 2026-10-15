import { PlayerAdapter, PlayerCapabilities, PlayerSource, PlayerState } from "./PlayerAdapter.js";
import { SyncVideoElement } from "../sync/types.js";

export interface HTML5AdapterOptions {
  videoElement?: HTMLVideoElement | SyncVideoElement;
  hlsJsInstance?: any;
}

export class HTML5Adapter implements PlayerAdapter {
  public readonly provider = "html5" as const;
  public readonly capabilities: PlayerCapabilities = {
    supportsPlaybackRate: true,
    supportsPreciseSeek: true,
    isLive: false,
    canAutoplay: true,
  };

  private readonly video: SyncVideoElement | HTMLVideoElement;
  private currentSource: PlayerSource | null = null;
  private hls: any = null;
  private currentState: PlayerState = "unstarted";
  private isBuffering = false;

  private readonly stateListeners: Set<(state: PlayerState) => void> = new Set();
  private readonly bufferListeners: Set<(buffering: boolean) => void> = new Set();
  private readonly endedListeners: Set<() => void> = new Set();
  private readonly errorListeners: Set<(error: any) => void> = new Set();
  private readonly seekListeners: Set<(positionMs: number) => void> = new Set();

  private readonly boundOnPlay: () => void;
  private readonly boundOnPause: () => void;
  private readonly boundOnWaiting: () => void;
  private readonly boundOnPlaying: () => void;
  private readonly boundOnCanPlay: () => void;
  private readonly boundOnSeeked: () => void;
  private readonly boundOnEnded: () => void;
  private readonly boundOnError: (e?: any) => void;

  constructor(videoOrOptions?: HTMLVideoElement | SyncVideoElement | HTML5AdapterOptions) {
    if (videoOrOptions && ("videoElement" in videoOrOptions || "hlsJsInstance" in videoOrOptions)) {
      this.video = (videoOrOptions as HTML5AdapterOptions).videoElement || this.createDefaultVideoElement();
      this.hls = (videoOrOptions as HTML5AdapterOptions).hlsJsInstance || null;
    } else if (videoOrOptions) {
      this.video = videoOrOptions as HTMLVideoElement | SyncVideoElement;
    } else {
      this.video = this.createDefaultVideoElement();
    }

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
    // Minimal fallback object
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
    this.video.addEventListener("canplay", this.boundOnCanPlay);
    this.video.addEventListener("seeked", this.boundOnSeeked);
    this.video.addEventListener("ended", this.boundOnEnded);
    this.video.addEventListener("error", this.boundOnError);
  }

  private detachEvents(): void {
    this.video.removeEventListener("play", this.boundOnPlay);
    this.video.removeEventListener("pause", this.boundOnPause);
    this.video.removeEventListener("waiting", this.boundOnWaiting);
    this.video.removeEventListener("playing", this.boundOnPlaying);
    this.video.removeEventListener("canplay", this.boundOnCanPlay);
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

  private notifyBuffering(buffering: boolean): void {
    for (const fn of this.bufferListeners) fn(buffering);
  }

  public async load(source: PlayerSource | string): Promise<void> {
    const src: PlayerSource = typeof source === "string" ? { provider: "html5", sourceRef: source } : source;
    this.currentSource = src;
    const url = src.sourceRef;

    // Check HLS (.m3u8)
    const isHls = url.includes(".m3u8");
    const videoEl = this.video as any;

    if (isHls) {
      // 1. Check if hls.js is available in window or injected
      const Hls = (typeof window !== "undefined" ? (window as any).Hls : null) || this.hls?.constructor;
      if (Hls && Hls.isSupported && Hls.isSupported()) {
        if (this.hls) {
          this.hls.destroy();
        }
        this.hls = new Hls({ enableWorker: true });
        this.hls.loadSource(url);
        this.hls.attachMedia(videoEl);
      } else if (videoEl.canPlayType && videoEl.canPlayType("application/vnd.apple.mpegurl")) {
        // Native Safari HLS
        videoEl.src = url;
      } else {
        videoEl.src = url;
      }
    } else {
      if (this.hls) {
        this.hls.destroy();
        this.hls = null;
      }
      videoEl.src = url;
    }

    this.setState("cued");
  }

  public async play(): Promise<void> {
    try {
      await this.video.play();
      this.setState("playing");
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        for (const fn of this.errorListeners) fn(err);
      }
      throw err;
    }
  }

  public pause(): void {
    this.video.pause();
    this.setState("paused");
  }

  public seek(positionMs: number): void {
    const seconds = Math.max(0, positionMs / 1000);
    this.video.currentTime = seconds;
  }

  public getCurrentTime(): number {
    return Math.round((this.video.currentTime || 0) * 1000);
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
    return this.currentSource?.durationMs || 0;
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
    if (this.hls) {
      try {
        this.hls.destroy();
      } catch {}
      this.hls = null;
    }
    this.stateListeners.clear();
    this.bufferListeners.clear();
    this.endedListeners.clear();
    this.errorListeners.clear();
    this.seekListeners.clear();
  }
}
