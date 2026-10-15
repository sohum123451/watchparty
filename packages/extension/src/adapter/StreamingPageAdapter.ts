export type PlayerState =
  | "unstarted"
  | "playing"
  | "paused"
  | "buffering"
  | "ended"
  | "cued";

export interface PlayerCapabilities {
  supportsPlaybackRate: boolean;
  supportsPreciseSeek: boolean;
  isLive: boolean;
  canAutoplay: boolean;
}

export interface PlayerAdapter {
  readonly provider: string;
  readonly capabilities: PlayerCapabilities;

  load(source: any): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void> | void;
  seek(positionMs: number): Promise<void> | void;
  getCurrentTime(): number;
  getState(): PlayerState;
  setPlaybackRate(rate: number): void;
  getDuration(): number;

  onStateChange(listener: (state: PlayerState) => void): () => void;
  onBuffering(listener: (buffering: boolean) => void): () => void;
  onEnded(listener: () => void): () => void;
  onError(listener: (error: any) => void): () => void;
  onSeek?(listener: (positionMs: number) => void): () => void;
  destroy?(): void;
}

export class StreamingPageAdapter implements PlayerAdapter {
  public readonly provider: string = "extension";
  public readonly capabilities: PlayerCapabilities = {
    supportsPlaybackRate: true,
    supportsPreciseSeek: true,
    isLive: false,
    canAutoplay: true
  };

  private media: HTMLMediaElement;
  private stateChangeListeners: Set<(state: PlayerState) => void> = new Set();
  private bufferingListeners: Set<(buffering: boolean) => void> = new Set();
  private endedListeners: Set<() => void> = new Set();
  private errorListeners: Set<(error: any) => void> = new Set();
  private seekListeners: Set<(positionMs: number) => void> = new Set();

  private isProgrammaticAction: boolean = false;
  private programmaticActionTimeout: any = null;
  private boundHandlers: Record<string, EventListener> = {};

  constructor(mediaElement: HTMLMediaElement) {
    this.media = mediaElement;
    this.setupListeners();
  }

  public getMediaElement(): HTMLMediaElement {
    return this.media;
  }

  public getVideoElement(): HTMLVideoElement {
    return this.media as HTMLVideoElement;
  }

  public async load(_source: any): Promise<void> {
    // In the extension, the user navigates directly on the streaming site.
    // The extension attaches to the video already loaded in the page session.
  }

  public async play(): Promise<void> {
    this.markProgrammaticAction();
    try {
      await this.media.play();
    } catch (err) {
      this.onErrorInternal(err);
    }
  }

  public pause(): void {
    this.markProgrammaticAction();
    this.media.pause();
  }

  public seek(positionMs: number): void {
    this.markProgrammaticAction();
    const targetSeconds = Math.max(0, positionMs / 1000);
    this.media.currentTime = targetSeconds;
  }

  public getCurrentTime(): number {
    return Math.round(this.media.currentTime * 1000);
  }

  public getDuration(): number {
    const d = this.media.duration;
    return Number.isFinite(d) ? Math.round(d * 1000) : 0;
  }

  public getState(): PlayerState {
    if (this.media.ended) return "ended";
    if (this.media.seeking || (this.media.readyState < 3 && !this.media.paused)) return "buffering";
    if (this.media.paused) return "paused";
    return "playing";
  }

  public setPlaybackRate(rate: number): void {
    this.markProgrammaticAction();
    const clamped = Math.max(0.25, Math.min(4.0, rate));
    this.media.playbackRate = clamped;
  }

  public getPlaybackRate(): number {
    return this.media.playbackRate;
  }

  public onStateChange(listener: (state: PlayerState) => void): () => void {
    this.stateChangeListeners.add(listener);
    return () => this.stateChangeListeners.delete(listener);
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

  public isSuppressed(): boolean {
    return this.isProgrammaticAction;
  }

  private markProgrammaticAction(): void {
    this.isProgrammaticAction = true;
    if (this.programmaticActionTimeout) {
      clearTimeout(this.programmaticActionTimeout);
    }
    this.programmaticActionTimeout = setTimeout(() => {
      this.isProgrammaticAction = false;
      this.programmaticActionTimeout = null;
    }, 350);
  }

  private setupListeners(): void {
    this.boundHandlers = {
      play: () => {
        if (!this.isProgrammaticAction) {
          this.emitStateChange("playing");
        }
      },
      pause: () => {
        if (!this.isProgrammaticAction && !this.media.ended) {
          this.emitStateChange("paused");
        }
      },
      seeking: () => {
        if (!this.isProgrammaticAction) {
          const posMs = this.getCurrentTime();
          this.seekListeners.forEach((fn) => fn(posMs));
        }
      },
      seeked: () => {
        if (!this.isProgrammaticAction) {
          const state = this.getState();
          this.emitStateChange(state);
        }
      },
      waiting: () => {
        this.bufferingListeners.forEach((fn) => fn(true));
        this.emitStateChange("buffering");
      },
      playing: () => {
        this.bufferingListeners.forEach((fn) => fn(false));
        if (!this.isProgrammaticAction) {
          this.emitStateChange("playing");
        }
      },
      ended: () => {
        this.endedListeners.forEach((fn) => fn());
        this.emitStateChange("ended");
      },
      error: (e: any) => {
        this.onErrorInternal(e);
      }
    };

    for (const [eventName, handler] of Object.entries(this.boundHandlers)) {
      this.media.addEventListener(eventName, handler);
    }
  }

  private emitStateChange(state: PlayerState): void {
    this.stateChangeListeners.forEach((fn) => fn(state));
  }

  private onErrorInternal(err: any): void {
    this.errorListeners.forEach((fn) => fn(err));
  }

  public destroy(): void {
    if (this.programmaticActionTimeout) {
      clearTimeout(this.programmaticActionTimeout);
    }
    for (const [eventName, handler] of Object.entries(this.boundHandlers)) {
      this.media.removeEventListener(eventName, handler);
    }
    this.stateChangeListeners.clear();
    this.bufferingListeners.clear();
    this.endedListeners.clear();
    this.errorListeners.clear();
    this.seekListeners.clear();
  }
}
