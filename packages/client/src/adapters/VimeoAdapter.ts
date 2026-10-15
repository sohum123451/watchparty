import { PlayerAdapter, PlayerCapabilities, PlayerSource, PlayerState } from "./PlayerAdapter.js";

export interface VimeoAdapterOptions {
  containerId?: string;
  containerElement?: HTMLElement;
  playerVars?: Record<string, any>;
  mockPlayer?: any; // For headless/unit tests
}

export class VimeoAdapter implements PlayerAdapter {
  public readonly provider = "vimeo" as const;
  public readonly capabilities: PlayerCapabilities = {
    supportsPlaybackRate: true,
    supportsPreciseSeek: true,
    isLive: false,
    canAutoplay: true,
  };

  private player: any = null;
  private currentSource: PlayerSource | null = null;
  private currentState: PlayerState = "unstarted";
  private isBuffering = false;
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolver!: () => void;

  private readonly stateListeners: Set<(state: PlayerState) => void> = new Set();
  private readonly bufferListeners: Set<(buffering: boolean) => void> = new Set();
  private readonly endedListeners: Set<() => void> = new Set();
  private readonly errorListeners: Set<(error: any) => void> = new Set();
  private readonly seekListeners: Set<(positionMs: number) => void> = new Set();

  private container: HTMLElement | null = null;
  private containerId: string;
  private cachedCurrentTimeMs = 0;
  private cachedDurationMs = 0;
  private simulatedRate = 1.0;

  constructor(options: VimeoAdapterOptions = {}) {
    this.containerId = options.containerId || `vimeo_player_${Math.random().toString(36).slice(2, 9)}`;
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolver = resolve;
    });

    if (options.mockPlayer) {
      this.player = options.mockPlayer;
      this.isReady = true;
      this.readyResolver();
      this.attachMockListeners();
      return;
    }

    if (typeof document !== "undefined") {
      this.container = options.containerElement || document.getElementById(this.containerId);
      if (!this.container) {
        this.container = document.createElement("div");
        this.container.id = this.containerId;
      }
      this.initVimeoSdk();
    } else {
      this.isReady = true;
      this.readyResolver();
    }
  }

  private initVimeoSdk(): void {
    if (typeof window === "undefined") return;

    const onSdkLoaded = () => {
      this.isReady = true;
      this.readyResolver();
    };

    if ((window as any).Vimeo && (window as any).Vimeo.Player) {
      onSdkLoaded();
    } else {
      const existingScript = document.querySelector('script[src*="player.vimeo.com/api/player.js"]');
      if (!existingScript) {
        const tag = document.createElement("script");
        tag.src = "https://player.vimeo.com/api/player.js";
        tag.onload = onSdkLoaded;
        const firstScript = document.getElementsByTagName("script")[0];
        firstScript?.parentNode?.insertBefore(tag, firstScript);
      } else {
        existingScript.addEventListener("load", onSdkLoaded);
      }
    }
  }

  private attachMockListeners(): void {
    if (!this.player || typeof this.player.on !== "function") return;
    this.player.on("play", () => this.setState("playing"));
    this.player.on("pause", () => this.setState("paused"));
    this.player.on("bufferstart", () => {
      this.isBuffering = true;
      this.setState("buffering");
      for (const fn of this.bufferListeners) fn(true);
    });
    this.player.on("bufferend", () => {
      this.isBuffering = false;
      for (const fn of this.bufferListeners) fn(false);
      this.setState(this.player.paused ? "paused" : "playing");
    });
    this.player.on("ended", () => {
      this.setState("ended");
      for (const fn of this.endedListeners) fn();
    });
    this.player.on("error", (err: any) => {
      for (const fn of this.errorListeners) fn(err);
    });
    this.player.on("timeupdate", (data: { seconds: number; duration?: number }) => {
      if (data && typeof data.seconds === "number") {
        this.cachedCurrentTimeMs = Math.round(data.seconds * 1000);
      }
      if (data && typeof data.duration === "number") {
        this.cachedDurationMs = Math.round(data.duration * 1000);
      }
    });
    this.player.on("seeked", (data: { seconds: number }) => {
      const posMs = data && typeof data.seconds === "number" ? Math.round(data.seconds * 1000) : this.cachedCurrentTimeMs;
      this.cachedCurrentTimeMs = posMs;
      for (const fn of this.seekListeners) fn(posMs);
    });
  }

  private setState(state: PlayerState): void {
    if (this.currentState !== state) {
      this.currentState = state;
      for (const fn of this.stateListeners) fn(state);
    }
  }

  private extractVideoId(sourceRef: string): string {
    const trimmed = sourceRef.trim();
    const match = trimmed.match(/vimeo\.com\/(?:video\/)?([0-9]+)/);
    return match ? match[1] : trimmed;
  }

  public async load(source: PlayerSource | string): Promise<void> {
    const src: PlayerSource = typeof source === "string" ? { provider: "vimeo", sourceRef: source } : source;
    this.currentSource = src;
    await this.readyPromise;

    const videoId = this.extractVideoId(src.sourceRef);

    if (this.player) {
      if (typeof this.player.loadVideo === "function") {
        await this.player.loadVideo(videoId);
      }
    } else if (typeof window !== "undefined" && (window as any).Vimeo?.Player && this.container) {
      this.player = new (window as any).Vimeo.Player(this.container, {
        id: videoId,
        width: "100%",
        responsive: true,
      });
      this.attachMockListeners();
      await this.player.ready();
    }

    if (src.durationMs) {
      this.cachedDurationMs = src.durationMs;
    }

    this.setState("cued");
  }

  public async play(): Promise<void> {
    await this.readyPromise;
    if (this.player && typeof this.player.play === "function") {
      try {
        await this.player.play();
      } catch (err: any) {
        for (const fn of this.errorListeners) fn(err);
        throw err;
      }
    }
    this.setState("playing");
  }

  public async pause(): Promise<void> {
    if (this.player && typeof this.player.pause === "function") {
      try {
        await this.player.pause();
      } catch (err: any) {
        for (const fn of this.errorListeners) fn(err);
      }
    }
    this.setState("paused");
  }

  public async seek(positionMs: number): Promise<void> {
    this.cachedCurrentTimeMs = positionMs;
    const seconds = Math.max(0, positionMs / 1000);
    if (this.player && typeof this.player.setCurrentTime === "function") {
      try {
        await this.player.setCurrentTime(seconds);
      } catch (err) {
        // Fallback / ignore seek limits
      }
    }
    for (const fn of this.seekListeners) fn(positionMs);
  }

  public getCurrentTime(): number {
    if (this.player && typeof this.player.getCurrentTime === "function") {
      // If mock player or sync method available
      const maybeSync = this.player.getCurrentTime();
      if (typeof maybeSync === "number") {
        return Math.round(maybeSync * 1000);
      }
    }
    return this.cachedCurrentTimeMs;
  }

  public getState(): PlayerState {
    return this.currentState;
  }

  public setPlaybackRate(rate: number): void {
    this.simulatedRate = rate;
    if (this.player && typeof this.player.setPlaybackRate === "function") {
      try {
        this.player.setPlaybackRate(rate);
      } catch {}
    }
  }

  public getDuration(): number {
    if (this.cachedDurationMs > 0) return this.cachedDurationMs;
    if (this.player && typeof this.player.getDuration === "function") {
      const maybeSync = this.player.getDuration();
      if (typeof maybeSync === "number" && maybeSync > 0) {
        return Math.round(maybeSync * 1000);
      }
    }
    return this.currentSource?.durationMs || 0;
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
    if (this.player && typeof this.player.destroy === "function") {
      try {
        this.player.destroy();
      } catch {}
      this.player = null;
    }
    this.stateListeners.clear();
    this.bufferListeners.clear();
    this.endedListeners.clear();
    this.errorListeners.clear();
    this.seekListeners.clear();
  }
}
