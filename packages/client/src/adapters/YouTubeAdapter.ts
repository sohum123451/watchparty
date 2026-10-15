import { PlayerAdapter, PlayerCapabilities, PlayerSource, PlayerState } from "./PlayerAdapter.js";

export interface YouTubeAdapterOptions {
  containerId?: string;
  containerElement?: HTMLElement;
  playerVars?: Record<string, any>;
  mockPlayer?: any; // For headless/unit tests
}

export class YouTubeAdapter implements PlayerAdapter {
  public readonly provider = "youtube" as const;
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
  private simulatedCurrentTimeMs = 0;
  private simulatedRate = 1.0;

  constructor(options: YouTubeAdapterOptions = {}) {
    this.containerId = options.containerId || `yt_player_${Math.random().toString(36).slice(2, 9)}`;
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolver = resolve;
    });

    if (options.mockPlayer) {
      this.player = options.mockPlayer;
      this.isReady = true;
      this.readyResolver();
      return;
    }

    if (typeof document !== "undefined") {
      this.container = options.containerElement || document.getElementById(this.containerId);
      if (!this.container) {
        this.container = document.createElement("div");
        this.container.id = this.containerId;
      }
      this.initIframeApi(options.playerVars);
    } else {
      this.isReady = true;
      this.readyResolver();
    }
  }

  private initIframeApi(playerVars?: Record<string, any>): void {
    if (typeof window === "undefined") return;

    const onApiReady = () => {
      const YT = (window as any).YT;
      if (!YT || !YT.Player) return;

      this.player = new YT.Player(this.containerId, {
        height: "100%",
        width: "100%",
        playerVars: {
          autoplay: 0,
          controls: 1,
          disablekb: 0,
          enablejsapi: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin,
          ...playerVars,
        },
        events: {
          onReady: () => {
            this.isReady = true;
            this.readyResolver();
          },
          onStateChange: (event: any) => this.handleYtStateChange(event.data),
          onError: (event: any) => {
            for (const fn of this.errorListeners) fn(event.data);
          },
        },
      });
    };

    if ((window as any).YT && (window as any).YT.Player) {
      onApiReady();
    } else {
      const existingScript = document.querySelector('script[src*="youtube.com/iframe_api"]');
      if (!existingScript) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScript = document.getElementsByTagName("script")[0];
        firstScript?.parentNode?.insertBefore(tag, firstScript);
      }

      const prevCallback = (window as any).onYouTubeIframeAPIReady;
      (window as any).onYouTubeIframeAPIReady = () => {
        if (typeof prevCallback === "function") prevCallback();
        onApiReady();
      };
    }
  }

  private handleYtStateChange(ytState: number): void {
    // YT.PlayerState: -1 (UNSTARTED), 0 (ENDED), 1 (PLAYING), 2 (PAUSED), 3 (BUFFERING), 5 (CUED)
    let state: PlayerState = "unstarted";
    let buffering = false;

    switch (ytState) {
      case -1:
        state = "unstarted";
        break;
      case 0:
        state = "ended";
        for (const fn of this.endedListeners) fn();
        break;
      case 1:
        state = "playing";
        break;
      case 2:
        state = "paused";
        break;
      case 3:
        state = "buffering";
        buffering = true;
        break;
      case 5:
        state = "cued";
        break;
    }

    if (this.isBuffering !== buffering) {
      this.isBuffering = buffering;
      for (const fn of this.bufferListeners) fn(buffering);
    }

    if (this.currentState !== state) {
      this.currentState = state;
      for (const fn of this.stateListeners) fn(state);
    }
  }

  public async load(source: PlayerSource | string): Promise<void> {
    const src: PlayerSource = typeof source === "string" ? { provider: "youtube", sourceRef: source } : source;
    this.currentSource = src;
    await this.readyPromise;

    if (this.player) {
      if (typeof this.player.cueVideoById === "function") {
        this.player.cueVideoById(src.sourceRef);
      } else if (typeof this.player.loadVideoById === "function") {
        this.player.loadVideoById(src.sourceRef);
      }
    }

    this.currentState = "cued";
    for (const fn of this.stateListeners) fn("cued");
  }

  public async play(): Promise<void> {
    await this.readyPromise;
    if (this.player && typeof this.player.playVideo === "function") {
      this.player.playVideo();
    }
    this.currentState = "playing";
    for (const fn of this.stateListeners) fn("playing");
  }

  public pause(): void {
    if (this.player && typeof this.player.pauseVideo === "function") {
      this.player.pauseVideo();
    }
    this.currentState = "paused";
    for (const fn of this.stateListeners) fn("paused");
  }

  public seek(positionMs: number): void {
    this.simulatedCurrentTimeMs = positionMs;
    const seconds = Math.max(0, positionMs / 1000);
    if (this.player && typeof this.player.seekTo === "function") {
      this.player.seekTo(seconds, true);
    }
    for (const fn of this.seekListeners) fn(positionMs);
  }

  public getCurrentTime(): number {
    if (this.player && typeof this.player.getCurrentTime === "function") {
      const s = this.player.getCurrentTime();
      if (typeof s === "number" && !isNaN(s)) {
        return Math.round(s * 1000);
      }
    }
    return this.simulatedCurrentTimeMs;
  }

  public getState(): PlayerState {
    if (this.player && typeof this.player.getPlayerState === "function") {
      const ytState = this.player.getPlayerState();
      switch (ytState) {
        case 1:
          return "playing";
        case 2:
          return "paused";
        case 3:
          return "buffering";
        case 0:
          return "ended";
        case 5:
          return "cued";
        default:
          return "unstarted";
      }
    }
    return this.currentState;
  }

  public setPlaybackRate(rate: number): void {
    this.simulatedRate = rate;
    if (this.player && typeof this.player.setPlaybackRate === "function") {
      this.player.setPlaybackRate(rate);
    }
  }

  public getDuration(): number {
    if (this.player && typeof this.player.getDuration === "function") {
      const s = this.player.getDuration();
      if (typeof s === "number" && s > 0) return Math.round(s * 1000);
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
