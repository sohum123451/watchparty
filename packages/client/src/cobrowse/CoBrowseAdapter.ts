import { VideoProvider, RelativeReadingPosition, CoBrowseMediaState } from "@watchparty/shared";
import {
  PlayerAdapter,
  PlayerCapabilities,
  PlayerSource,
  PlayerState,
} from "../adapters/PlayerAdapter.js";
import { CoBrowseManager } from "./CoBrowseManager.js";
import { CoBrowseOptions } from "./CoBrowseTypes.js";

export interface CoBrowseAdapterOptions extends CoBrowseOptions {
  iframeElement?: HTMLIFrameElement | null;
  containerElement?: HTMLElement | null;
  onMediaStateChange?: (media: CoBrowseMediaState) => void;
}

export class CoBrowseAdapter implements PlayerAdapter {
  public readonly provider: VideoProvider = "co-browse";
  public readonly capabilities: PlayerCapabilities = {
    supportsPlaybackRate: true,
    supportsPreciseSeek: true,
    isLive: false,
    canAutoplay: true,
    reliableGetCurrentTime: true,
    controllable: "full",
    protocol: "generic",
  };

  private readonly manager: CoBrowseManager;
  private iframe: HTMLIFrameElement | null = null;
  private container: HTMLElement | null = null;
  private url: string = "";
  private state: PlayerState = "unstarted";
  private currentTimeMs: number = 0;
  private durationMs: number = 0;
  private playbackRate: number = 1.0;
  private lastPlayTimestamp: number = 0;

  // Listeners
  private stateListeners = new Set<(state: PlayerState) => void>();
  private bufferingListeners = new Set<(buffering: boolean) => void>();
  private endedListeners = new Set<() => void>();
  private errorListeners = new Set<(error: any) => void>();
  private seekListeners = new Set<(positionMs: number) => void>();

  constructor(options: CoBrowseAdapterOptions = {}) {
    this.iframe = options.iframeElement || null;
    this.container = options.containerElement || null;
    this.url = options.url || "";
    this.manager = new CoBrowseManager(options);
  }

  public getManager(): CoBrowseManager {
    return this.manager;
  }

  public getIframe(): HTMLIFrameElement | null {
    return this.iframe;
  }

  public setIframe(iframe: HTMLIFrameElement | null): void {
    this.iframe = iframe;
  }

  public isFramingAllowed(): boolean {
    return this.manager.isFramingAllowed();
  }

  public async load(source: PlayerSource | string): Promise<void> {
    const rawUrl = typeof source === "string" ? source : source.sourceRef || "";
    this.url = rawUrl;
    this.currentTimeMs = 0;
    this.durationMs = typeof source !== "string" && source.durationMs ? source.durationMs : 0;

    // Load iframe if provided and framing is permitted
    if (this.iframe && this.manager.isFramingAllowed() && this.url) {
      try {
        this.iframe.src = this.url;
      } catch (err) {
        this.emitError(err);
      }
    }

    this.setState("paused");
  }

  public async play(): Promise<void> {
    if (this.state === "playing") return;
    this.lastPlayTimestamp = Date.now();
    this.setState("playing");

    // Sync to active media if exists
    const activeMedia = this.manager.getActiveMedia();
    if (activeMedia) {
      this.manager.updateMediaSync({
        ...activeMedia,
        status: "playing",
        positionMs: this.currentTimeMs,
        serverTimeMs: Date.now(),
      });
    }
  }

  public pause(): void {
    if (this.state === "paused") return;
    this.updateCurrentTimeFromClock();
    this.setState("paused");

    const activeMedia = this.manager.getActiveMedia();
    if (activeMedia) {
      this.manager.updateMediaSync({
        ...activeMedia,
        status: "paused",
        positionMs: this.currentTimeMs,
        serverTimeMs: Date.now(),
      });
    }
  }

  public seek(positionMs: number): void {
    const clamped = Math.max(0, positionMs);
    this.currentTimeMs = clamped;
    this.lastPlayTimestamp = Date.now();

    for (const listener of this.seekListeners) {
      try {
        listener(clamped);
      } catch (err) {
        console.error("[CoBrowseAdapter] Seek listener error:", err);
      }
    }

    const activeMedia = this.manager.getActiveMedia();
    if (activeMedia) {
      this.manager.updateMediaSync({
        ...activeMedia,
        positionMs: clamped,
        serverTimeMs: Date.now(),
      });
    }
  }

  public getCurrentTime(): number {
    this.updateCurrentTimeFromClock();
    return Math.round(this.currentTimeMs);
  }

  public getState(): PlayerState {
    return this.state;
  }

  public setPlaybackRate(rate: number): void {
    if (rate <= 0) return;
    this.updateCurrentTimeFromClock();
    this.playbackRate = rate;

    const activeMedia = this.manager.getActiveMedia();
    if (activeMedia) {
      this.manager.updateMediaSync({
        ...activeMedia,
        playbackRate: rate,
        serverTimeMs: Date.now(),
      });
    }
  }

  public getPlaybackRate(): number {
    return this.playbackRate;
  }

  public getDuration(): number {
    const activeMedia = this.manager.getActiveMedia();
    if (activeMedia && typeof activeMedia.durationMs === "number" && activeMedia.durationMs > 0) {
      return activeMedia.durationMs;
    }
    return this.durationMs;
  }

  /**
   * Syncs media element from the content script or iframe
   */
  public handleMediaStateFromPage(mediaState: CoBrowseMediaState): void {
    this.currentTimeMs = mediaState.positionMs;
    if (typeof mediaState.durationMs === "number") {
      this.durationMs = mediaState.durationMs;
    }
    this.playbackRate = mediaState.playbackRate;
    this.lastPlayTimestamp = Date.now();

    this.manager.updateMediaSync(mediaState);

    const newState: PlayerState = mediaState.status === "paused" ? "paused" : "playing";
    if (this.state !== newState) {
      this.setState(newState);
    }
  }

  // --- Subscriptions ---

  public onStateChange(listener: (state: PlayerState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public onBuffering(listener: (buffering: boolean) => void): () => void {
    this.bufferingListeners.add(listener);
    return () => this.bufferingListeners.delete(listener);
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
    this.stateListeners.clear();
    this.bufferingListeners.clear();
    this.endedListeners.clear();
    this.errorListeners.clear();
    this.seekListeners.clear();
    if (this.iframe) {
      this.iframe.src = "about:blank";
      this.iframe = null;
    }
  }

  private setState(newState: PlayerState): void {
    if (this.state === newState) return;
    this.state = newState;
    for (const listener of this.stateListeners) {
      try {
        listener(newState);
      } catch (err) {
        console.error("[CoBrowseAdapter] StateChange listener error:", err);
      }
    }
  }

  private emitError(error: any): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch (err) {
        console.error("[CoBrowseAdapter] Error listener error:", err);
      }
    }
  }

  private updateCurrentTimeFromClock(): void {
    if (this.state === "playing" && this.lastPlayTimestamp > 0) {
      const elapsed = (Date.now() - this.lastPlayTimestamp) * this.playbackRate;
      this.currentTimeMs += elapsed;
      this.lastPlayTimestamp = Date.now();
      if (this.durationMs > 0 && this.currentTimeMs >= this.durationMs) {
        this.currentTimeMs = this.durationMs;
        this.setState("ended");
        for (const listener of this.endedListeners) listener();
      }
    }
  }
}
