import { VideoProvider } from "@watchparty/shared";
import {
  PlayerAdapter,
  PlayerCapabilities,
  PlayerSource,
  PlayerState,
  ControllableLevel,
} from "../PlayerAdapter.js";
import {
  EmbedAdapterOptions,
  EmbedCapabilities,
  EmbedProtocol,
  EMBED_SYNC_CONFIGS,
  EmbedSyncConfig,
} from "./EmbedTypes.js";
import { EmbedSecurity } from "./EmbedSecurity.js";

// Safe import of player.js for generic embeds
let playerjsLib: any = null;
try {
  // @ts-ignore
  import("player.js")
    .then((mod) => {
      playerjsLib = mod.default || mod;
    })
    .catch(() => {});
} catch {
  // Ignore in environments without dynamic import
}

export class EmbedAdapter implements PlayerAdapter {
  public readonly provider: VideoProvider;
  public readonly capabilities: EmbedCapabilities;

  private iframe: HTMLIFrameElement | any;
  private container: HTMLElement | any;
  private options: EmbedAdapterOptions;

  private currentState: PlayerState = "unstarted";
  private currentRate = 1.0;
  private durationMs = 0;
  private lastReportedPositionMs = 0;

  // Soft Sync wall-clock tracking
  private basePositionMs = 0;
  private playbackStartTimeMs = 0;
  private hasReceivedTimeUpdate = false;
  private softSyncDegraded = false;
  private syncApproximate = false;

  private expectedOrigin = "";
  private currentProtocol: EmbedProtocol = "generic";
  private sourceUrl = "";
  private embedUrl = "";
  private isDestroyed = false;

  private playerjsInstance: any = null;

  // Event subscribers
  private readonly stateListeners: Set<(state: PlayerState) => void> = new Set();
  private readonly bufferListeners: Set<(buffering: boolean) => void> = new Set();
  private readonly endedListeners: Set<() => void> = new Set();
  private readonly errorListeners: Set<(err: any) => void> = new Set();
  private readonly seekListeners: Set<(posMs: number) => void> = new Set();

  private readonly boundOnMessage: (event: MessageEvent) => void;

  constructor(options: EmbedAdapterOptions = {}) {
    this.options = options;
    this.provider = (options.protocol as VideoProvider) || "embed";
    this.sourceUrl = options.sourceUrl || "";
    this.embedUrl = options.embedUrl || "";
    this.durationMs = options.durationMs || 0;

    // Detect protocol
    this.currentProtocol = options.protocol || this.detectProtocol(this.embedUrl || this.sourceUrl);

    // Initial capabilities based on detected protocol
    this.capabilities = this.createInitialCapabilities(this.currentProtocol, options.controllable);

    // Setup DOM Iframe
    if (options.iframeElement) {
      this.iframe = options.iframeElement;
    } else if (typeof document !== "undefined") {
      this.iframe = document.createElement("iframe");
    } else {
      this.iframe = this.createMockIframe();
    }

    // Apply strict sandboxing and feature policies
    EmbedSecurity.configureSandbox(this.iframe);

    if (options.containerElement && this.iframe.parentNode !== options.containerElement) {
      this.container = options.containerElement;
      try {
        this.container.appendChild(this.iframe);
      } catch {}
    }

    this.boundOnMessage = (e: MessageEvent) => this.handleWindowMessage(e);

    if (typeof window !== "undefined") {
      window.addEventListener("message", this.boundOnMessage);
    }

    if (this.embedUrl || this.sourceUrl) {
      this.initEmbed(this.embedUrl || this.sourceUrl);
    }
  }

  // ==========================================
  // PROTOCOL DETECTION & CAPABILITY MODELING
  // ==========================================

  private detectProtocol(url: string): EmbedProtocol {
    if (!url) return "generic";
    const lower = url.toLowerCase();

    if (lower.includes("soundcloud.com") || lower.includes("w.soundcloud.com")) {
      return "soundcloud";
    }
    if (lower.includes("spotify.com") || lower.includes("open.spotify.com")) {
      return "spotify";
    }
    if (lower.includes("vimeo.com") || lower.includes("player.vimeo.com")) {
      return "vimeo";
    }
    if (
      lower.includes("youtube.com") ||
      lower.includes("youtu.be") ||
      lower.includes("youtube-nocookie.com")
    ) {
      return "youtube";
    }
    return "player.js";
  }

  private createInitialCapabilities(
    protocol: EmbedProtocol,
    explicitControllable?: ControllableLevel
  ): EmbedCapabilities {
    switch (protocol) {
      case "vimeo":
      case "youtube":
        return {
          supportsPlaybackRate: true,
          supportsPreciseSeek: true,
          isLive: false,
          canAutoplay: true,
          reliableGetCurrentTime: true,
          controllable: explicitControllable || "full",
          isHostDrivenSoftSync: false,
          protocol,
        };

      case "soundcloud":
        // SoundCloud Widget API: supports play, pause, seek, time reporting, but NO variable rate
        return {
          supportsPlaybackRate: false,
          supportsPreciseSeek: true,
          isLive: false,
          canAutoplay: true,
          reliableGetCurrentTime: true,
          controllable: explicitControllable || "limited",
          isHostDrivenSoftSync: false,
          protocol,
        };

      case "spotify":
        // Spotify iFrame API: supports play, pause, seek (in sec), NO rate control
        return {
          supportsPlaybackRate: false,
          supportsPreciseSeek: true,
          isLive: false,
          canAutoplay: true,
          reliableGetCurrentTime: true,
          controllable: explicitControllable || "limited",
          isHostDrivenSoftSync: false,
          protocol,
        };

      case "player.js":
      case "generic":
      default:
        return {
          supportsPlaybackRate: false,
          supportsPreciseSeek: true,
          isLive: false,
          canAutoplay: true,
          reliableGetCurrentTime: true,
          controllable: explicitControllable || "limited",
          isHostDrivenSoftSync: false,
          protocol,
        };
    }
  }

  // ==========================================
  // EMBED INITIALIZATION & URL NORMALIZATION
  // ==========================================

  public async initEmbed(rawUrl: string): Promise<void> {
    const url = (rawUrl || "").trim();
    if (!url) return;

    this.sourceUrl = url;
    this.currentProtocol = this.options.protocol || this.detectProtocol(url);

    // Transform raw URLs to authoritative embed URLs if needed
    const normalizedEmbedUrl = this.normalizeEmbedUrl(url, this.currentProtocol);
    this.embedUrl = normalizedEmbedUrl;
    this.expectedOrigin = EmbedSecurity.extractOrigin(normalizedEmbedUrl);

    // Update iframe source
    if (this.iframe) {
      this.iframe.src = normalizedEmbedUrl;
    }

    // Check if controllability triggers "sync is approximate"
    if (this.capabilities.controllable === "limited") {
      this.syncApproximate = true;
      const reason = !this.capabilities.supportsPlaybackRate
        ? `${this.currentProtocol.toUpperCase()} embed does not support playback rate micro-adjustments; synchronization uses precise seeks.`
        : "Third-party embed has limited rate controllability.";
      this.options.onSyncApproximate?.(true, reason);
    }

    // Initialize player.js library for player.js / generic protocol
    if (this.currentProtocol === "player.js" || this.currentProtocol === "generic") {
      this.setupPlayerJs();
    }

    this.setState("cued");
  }

  private normalizeEmbedUrl(url: string, protocol: EmbedProtocol): string {
    try {
      const parsed = new URL(url);

      if (protocol === "soundcloud") {
        if (!url.includes("w.soundcloud.com/player")) {
          return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false&buying=false&sharing=false&download=false&show_artwork=true`;
        }
        return url;
      }

      if (protocol === "spotify") {
        if (!url.includes("open.spotify.com/embed")) {
          // Convert https://open.spotify.com/track/ID to https://open.spotify.com/embed/track/ID
          const path = parsed.pathname.startsWith("/embed") ? parsed.pathname : `/embed${parsed.pathname}`;
          return `https://open.spotify.com${path}?utm_source=generator`;
        }
        return url;
      }

      if (protocol === "youtube") {
        let videoId = "";
        if (parsed.hostname === "youtu.be") {
          videoId = parsed.pathname.slice(1);
        } else if (parsed.pathname.startsWith("/watch")) {
          videoId = parsed.searchParams.get("v") || "";
        } else if (parsed.pathname.startsWith("/embed/")) {
          videoId = parsed.pathname.replace("/embed/", "").split("/")[0];
        }
        if (videoId) {
          return `https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&autoplay=0`;
        }
        return url;
      }

      if (protocol === "vimeo") {
        const match = parsed.pathname.match(/\/(\d+)/);
        if (match && !url.includes("player.vimeo.com")) {
          return `https://player.vimeo.com/video/${match[1]}?api=1`;
        }
        return url;
      }

      return url;
    } catch {
      return url;
    }
  }

  // ==========================================
  // PLAYER.JS LIBRARY INTEGRATION
  // ==========================================

  private setupPlayerJs(): void {
    const P = playerjsLib?.Player || (playerjsLib as any)?.default?.Player || (typeof window !== "undefined" && (window as any).playerjs?.Player);
    if (!P || !this.iframe) return;

    try {
      this.playerjsInstance = new P(this.iframe);

      this.playerjsInstance.on("ready", () => {
        // Inspect capabilities exposed by Player.js spec
        if (typeof this.playerjsInstance.supports === "function") {
          const supportsRate = this.playerjsInstance.supports("method", "setPlaybackRate");
          const supportsSeek = this.playerjsInstance.supports("method", "setCurrentTime");
          const supportsGetTime =
            this.playerjsInstance.supports("method", "getCurrentTime") ||
            this.playerjsInstance.supports("event", "timeupdate");

          this.capabilities.supportsPlaybackRate = supportsRate;
          this.capabilities.supportsPreciseSeek = supportsSeek;
          this.capabilities.reliableGetCurrentTime = supportsGetTime;

          if (!supportsGetTime) {
            this.degradeToSoftSync("Player.js embed does not support getCurrentTime or timeupdate events.");
          }

          if (!supportsRate && supportsSeek) {
            this.capabilities.controllable = "limited";
            this.options.onSyncApproximate?.(true, "Embed does not support playback rate adjustment.");
          }
        }

        this.playerjsInstance.getDuration?.((dur: number) => {
          if (dur > 0) this.durationMs = Math.round(dur * 1000);
        });
      });

      this.playerjsInstance.on("play", () => this.setState("playing"));
      this.playerjsInstance.on("pause", () => this.setState("paused"));
      this.playerjsInstance.on("ended", () => {
        this.setState("ended");
        for (const fn of this.endedListeners) fn();
      });
      this.playerjsInstance.on("timeupdate", (data: any) => {
        const seconds = typeof data === "number" ? data : data?.seconds;
        if (typeof seconds === "number" && !isNaN(seconds)) {
          this.hasReceivedTimeUpdate = true;
          this.lastReportedPositionMs = Math.round(seconds * 1000);
          if (data?.duration) this.durationMs = Math.round(data.duration * 1000);
        }
      });
      this.playerjsInstance.on("error", (err: any) => {
        for (const fn of this.errorListeners) fn(err);
      });
    } catch (err) {
      console.warn("[EmbedAdapter] player.js init error:", err);
    }
  }

  // ==========================================
  // POSTMESSAGE COMMUNICATION & ORIGIN SECURITY
  // ==========================================

  private postToIframe(payload: any): void {
    if (!this.iframe) return;
    const targetWin = this.iframe.contentWindow;
    if (!targetWin) return;

    const targetOrigin = this.expectedOrigin || "*";
    const msg = typeof payload === "string" ? payload : JSON.stringify(payload);

    try {
      targetWin.postMessage(msg, targetOrigin);
    } catch (err) {
      // In tests or mock environments
      try {
        targetWin.postMessage(payload, targetOrigin);
      } catch {}
    }
  }

  public handleWindowMessage(event: MessageEvent): void {
    if (this.isDestroyed) return;

    const iframeWin = this.iframe?.contentWindow;

    // Strict origin validation against embed's origin
    if (!EmbedSecurity.isOriginTrusted(event, this.expectedOrigin, iframeWin)) {
      return;
    }

    let data: any = event.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }

    if (!data || typeof data !== "object") return;

    // Dispatch to protocol-specific handler
    switch (this.currentProtocol) {
      case "soundcloud":
        this.handleSoundCloudMessage(data);
        break;
      case "spotify":
        this.handleSpotifyMessage(data);
        break;
      case "vimeo":
        this.handleVimeoMessage(data);
        break;
      case "youtube":
        this.handleYouTubeMessage(data);
        break;
      case "player.js":
      case "generic":
      default:
        this.handlePlayerJsMessage(data);
        break;
    }
  }

  private handleSoundCloudMessage(data: any): void {
    // SoundCloud Widget sends: { method: '...', value: ... } or { event: '...', data: ... }
    const evt = data.event || data.method;

    if (evt === "ready" || data.event === "ready") {
      // Subscribe to events
      this.postToIframe({ method: "addEventListener", value: "play" });
      this.postToIframe({ method: "addEventListener", value: "pause" });
      this.postToIframe({ method: "addEventListener", value: "finish" });
      this.postToIframe({ method: "addEventListener", value: "playProgress" });
      this.postToIframe({ method: "getDuration" });
    } else if (evt === "play") {
      this.setState("playing");
    } else if (evt === "pause") {
      this.setState("paused");
    } else if (evt === "finish") {
      this.setState("ended");
      for (const fn of this.endedListeners) fn();
    } else if (evt === "playProgress" && data.data) {
      this.hasReceivedTimeUpdate = true;
      if (typeof data.data.currentPosition === "number") {
        this.lastReportedPositionMs = Math.round(data.data.currentPosition);
      }
    } else if (evt === "getDuration" && typeof data.value === "number") {
      this.durationMs = Math.round(data.value);
    } else if (evt === "getPosition" && typeof data.value === "number") {
      this.lastReportedPositionMs = Math.round(data.value);
    }
  }

  private handleSpotifyMessage(data: any): void {
    // Spotify iframe messages: { type: 'playback_update', data: { position, duration, isPaused } }
    if (data.type === "ready") {
      // Ready
    } else if (data.type === "playback_update" && data.data) {
      this.hasReceivedTimeUpdate = true;
      const posSec = data.data.position;
      const isPaused = data.data.isPaused;
      if (typeof posSec === "number") {
        this.lastReportedPositionMs = Math.round(posSec * 1000);
      }
      if (typeof data.data.duration === "number") {
        this.durationMs = Math.round(data.data.duration * 1000);
      }
      this.setState(isPaused ? "paused" : "playing");
    }
  }

  private handleVimeoMessage(data: any): void {
    const evt = data.event;
    if (evt === "ready") {
      this.postToIframe({ method: "addEventListener", value: "play" });
      this.postToIframe({ method: "addEventListener", value: "pause" });
      this.postToIframe({ method: "addEventListener", value: "timeupdate" });
      this.postToIframe({ method: "addEventListener", value: "ended" });
    } else if (evt === "play") {
      this.setState("playing");
    } else if (evt === "pause") {
      this.setState("paused");
    } else if (evt === "ended") {
      this.setState("ended");
      for (const fn of this.endedListeners) fn();
    } else if (evt === "timeupdate" && data.data) {
      this.hasReceivedTimeUpdate = true;
      const sec = data.data.seconds;
      if (typeof sec === "number") {
        this.lastReportedPositionMs = Math.round(sec * 1000);
      }
      if (data.data.duration) {
        this.durationMs = Math.round(data.data.duration * 1000);
      }
    }
  }

  private handleYouTubeMessage(data: any): void {
    if (data.event === "onReady") {
      this.postToIframe({ event: "listening" });
    } else if (data.event === "onStateChange") {
      switch (data.info) {
        case 1:
          this.setState("playing");
          break;
        case 2:
          this.setState("paused");
          break;
        case 3:
          this.setState("buffering");
          break;
        case 0:
          this.setState("ended");
          for (const fn of this.endedListeners) fn();
          break;
      }
    } else if (data.event === "infoDelivery" && data.info) {
      if (typeof data.info.currentTime === "number") {
        this.hasReceivedTimeUpdate = true;
        this.lastReportedPositionMs = Math.round(data.info.currentTime * 1000);
      }
      if (typeof data.info.duration === "number") {
        this.durationMs = Math.round(data.info.duration * 1000);
      }
    }
  }

  private handlePlayerJsMessage(data: any): void {
    if (data.context === "player.js" && data.event) {
      const evt = data.event;
      if (evt === "play") this.setState("playing");
      else if (evt === "pause") this.setState("paused");
      else if (evt === "ended") {
        this.setState("ended");
        for (const fn of this.endedListeners) fn();
      } else if (evt === "timeupdate" && data.value) {
        this.hasReceivedTimeUpdate = true;
        const s = typeof data.value === "number" ? data.value : data.value.seconds;
        if (typeof s === "number") this.lastReportedPositionMs = Math.round(s * 1000);
      }
    }
  }

  // ==========================================
  // SOFT SYNC DEGRADATION
  // ==========================================

  public degradeToSoftSync(reason: string): void {
    this.softSyncDegraded = true;
    this.capabilities.reliableGetCurrentTime = false;
    this.capabilities.isHostDrivenSoftSync = true;
    this.capabilities.controllable = "limited";

    const notice = `Host-driven soft sync active: ${reason}`;
    this.options.onSoftSyncDegraded?.(true, notice);
  }

  public isSoftSyncActive(): boolean {
    return this.softSyncDegraded || this.capabilities.isHostDrivenSoftSync;
  }

  public isApproximateSync(): boolean {
    return this.syncApproximate || this.capabilities.controllable === "limited";
  }

  // ==========================================
  // PLAYER ADAPTER INTERFACE IMPLEMENTATION
  // ==========================================

  public async load(source: PlayerSource | string): Promise<void> {
    const src = typeof source === "string" ? source : source.sourceRef;
    if (typeof source !== "string") {
      if (source.durationMs) this.durationMs = source.durationMs;
    }
    await this.initEmbed(src);
  }

  public async play(): Promise<void> {
    this.playbackStartTimeMs = Date.now();
    this.setState("playing");

    switch (this.currentProtocol) {
      case "soundcloud":
        this.postToIframe({ method: "play" });
        break;
      case "spotify":
        this.postToIframe({ command: "play" });
        break;
      case "vimeo":
        this.postToIframe({ method: "play" });
        break;
      case "youtube":
        this.postToIframe({ event: "command", func: "playVideo", args: [] });
        break;
      case "player.js":
      case "generic":
      default:
        if (this.playerjsInstance && typeof this.playerjsInstance.play === "function") {
          this.playerjsInstance.play();
        } else {
          this.postToIframe({ context: "player.js", method: "play" });
        }
        break;
    }

    // If after 2 seconds no time updates have been received, verify if soft-sync is required
    if (typeof setTimeout !== "undefined") {
      setTimeout(() => {
        if (!this.hasReceivedTimeUpdate && !this.softSyncDegraded && this.currentState === "playing") {
          // If the embed cannot report its position at all, degrade to host-driven soft sync
          this.degradeToSoftSync("Embed does not report position updates via postMessage.");
        }
      }, 2000);
    }
  }

  public pause(): void {
    if (this.currentState === "playing") {
      this.basePositionMs = this.getCurrentTime();
    }
    this.setState("paused");

    switch (this.currentProtocol) {
      case "soundcloud":
        this.postToIframe({ method: "pause" });
        break;
      case "spotify":
        this.postToIframe({ command: "pause" });
        break;
      case "vimeo":
        this.postToIframe({ method: "pause" });
        break;
      case "youtube":
        this.postToIframe({ event: "command", func: "pauseVideo", args: [] });
        break;
      case "player.js":
      case "generic":
      default:
        if (this.playerjsInstance && typeof this.playerjsInstance.pause === "function") {
          this.playerjsInstance.pause();
        } else {
          this.postToIframe({ context: "player.js", method: "pause" });
        }
        break;
    }
  }

  public seek(positionMs: number): void {
    const targetMs = Math.max(0, positionMs);
    this.lastReportedPositionMs = targetMs;
    this.basePositionMs = targetMs;
    this.playbackStartTimeMs = Date.now();

    const seconds = targetMs / 1000;

    switch (this.currentProtocol) {
      case "soundcloud":
        // SoundCloud expects milliseconds
        this.postToIframe({ method: "seekTo", value: targetMs });
        break;
      case "spotify":
        this.postToIframe({ command: "seek", value: Math.round(seconds) });
        break;
      case "vimeo":
        this.postToIframe({ method: "seekTo", value: seconds });
        break;
      case "youtube":
        this.postToIframe({ event: "command", func: "seekTo", args: [seconds, true] });
        break;
      case "player.js":
      case "generic":
      default:
        if (this.playerjsInstance && typeof this.playerjsInstance.setCurrentTime === "function") {
          this.playerjsInstance.setCurrentTime(seconds);
        } else {
          this.postToIframe({ context: "player.js", method: "setCurrentTime", value: seconds });
        }
        break;
    }

    for (const fn of this.seekListeners) fn(targetMs);
  }

  public getCurrentTime(): number {
    // If embed reliably reports position, return it
    if (this.capabilities.reliableGetCurrentTime && !this.softSyncDegraded) {
      return this.lastReportedPositionMs;
    }

    // Host-driven soft sync calculation based on wall clock
    if (this.currentState === "playing") {
      const elapsed = Date.now() - this.playbackStartTimeMs;
      return Math.max(0, Math.round(this.basePositionMs + elapsed * this.currentRate));
    }
    return this.basePositionMs;
  }

  public getState(): PlayerState {
    return this.currentState;
  }

  public setPlaybackRate(rate: number): void {
    this.currentRate = rate;

    if (!this.capabilities.supportsPlaybackRate) {
      return;
    }

    switch (this.currentProtocol) {
      case "vimeo":
        this.postToIframe({ method: "setPlaybackRate", value: rate });
        break;
      case "youtube":
        this.postToIframe({ event: "command", func: "setPlaybackRate", args: [rate] });
        break;
      case "player.js":
        if (this.playerjsInstance && typeof this.playerjsInstance.setPlaybackRate === "function") {
          this.playerjsInstance.setPlaybackRate(rate);
        } else {
          this.postToIframe({ context: "player.js", method: "setPlaybackRate", value: rate });
        }
        break;
      default:
        break;
    }
  }

  public getDuration(): number {
    return this.durationMs;
  }

  public getRecommendedSyncConfig(): EmbedSyncConfig {
    return EMBED_SYNC_CONFIGS[this.capabilities.controllable] || EMBED_SYNC_CONFIGS.limited;
  }

  public getIframeElement(): HTMLIFrameElement {
    return this.iframe;
  }

  public getExpectedOrigin(): string {
    return this.expectedOrigin;
  }

  public getEmbedUrl(): string {
    return this.embedUrl;
  }

  private setState(state: PlayerState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const fn of this.stateListeners) fn(state);
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

  private createMockIframe(): any {
    const postMessages: any[] = [];
    const mockWin = {
      postMessage: (msg: any, origin: string) => {
        postMessages.push({ msg, origin });
      },
    };
    return {
      src: "",
      contentWindow: mockWin,
      _postMessages: postMessages,
      setAttribute: () => {},
      getAttribute: () => null,
      removeAttribute: () => {},
    };
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (typeof window !== "undefined") {
      window.removeEventListener("message", this.boundOnMessage);
    }
    this.stateListeners.clear();
    this.bufferListeners.clear();
    this.endedListeners.clear();
    this.errorListeners.clear();
    this.seekListeners.clear();
  }
}
