import { PlayerAdapter, PlayerCapabilities, PlayerSource, PlayerState } from "./PlayerAdapter.js";
import { SyncVideoElement } from "../sync/types.js";

export interface ScreenShareAdapterOptions {
  videoElement?: HTMLVideoElement | SyncVideoElement;
  mediaStream?: MediaStream;
}

export class ScreenShareAdapter implements PlayerAdapter {
  public readonly provider = "screenshare" as const;
  public readonly capabilities: PlayerCapabilities = {
    supportsPlaybackRate: false,
    supportsPreciseSeek: false,
    isLive: true,
    canAutoplay: true,
  };

  private readonly video: SyncVideoElement | HTMLVideoElement;
  private mediaStream: MediaStream | null = null;
  private currentSource: PlayerSource | null = null;
  private currentState: PlayerState = "unstarted";
  private isBuffering = false;
  private captureStartTimeMs = 0;

  private readonly stateListeners: Set<(state: PlayerState) => void> = new Set();
  private readonly bufferListeners: Set<(buffering: boolean) => void> = new Set();
  private readonly endedListeners: Set<() => void> = new Set();
  private readonly errorListeners: Set<(error: any) => void> = new Set();
  private readonly seekListeners: Set<(positionMs: number) => void> = new Set();

  private readonly boundOnPlay: () => void;
  private readonly boundOnPause: () => void;
  private readonly boundOnWaiting: () => void;
  private readonly boundOnPlaying: () => void;
  private readonly boundOnError: (e?: any) => void;
  private boundTrackEndedListener: (() => void) | null = null;

  constructor(videoOrOptions?: HTMLVideoElement | SyncVideoElement | ScreenShareAdapterOptions) {
    if (videoOrOptions && "videoElement" in videoOrOptions) {
      this.video = (videoOrOptions as ScreenShareAdapterOptions).videoElement || this.createDefaultVideoElement();
      if ((videoOrOptions as ScreenShareAdapterOptions).mediaStream) {
        this.setMediaStream((videoOrOptions as ScreenShareAdapterOptions).mediaStream!);
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
    this.boundOnError = (e) => {
      for (const fn of this.errorListeners) fn(e);
    };

    this.attachEvents();
  }

  private createDefaultVideoElement(): SyncVideoElement {
    if (typeof document !== "undefined") {
      const v = document.createElement("video");
      v.autoplay = true;
      v.playsInline = true;
      return v;
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
    this.video.addEventListener("error", this.boundOnError);
  }

  private detachEvents(): void {
    this.video.removeEventListener("play", this.boundOnPlay);
    this.video.removeEventListener("pause", this.boundOnPause);
    this.video.removeEventListener("waiting", this.boundOnWaiting);
    this.video.removeEventListener("playing", this.boundOnPlaying);
    this.video.removeEventListener("error", this.boundOnError);
  }

  private setState(state: PlayerState): void {
    if (this.currentState !== state) {
      this.currentState = state;
      for (const fn of this.stateListeners) fn(state);
    }
  }

  public setMediaStream(stream: MediaStream, isLocalSharer = false): void {
    this.stopExistingStream();
    this.mediaStream = stream;
    this.captureStartTimeMs = Date.now();

    const videoEl = this.video as any;
    if ("srcObject" in videoEl) {
      videoEl.srcObject = stream;
    }

    // Critical feedback loop prevention: If this is the local sharer, mute local playback
    // because the user already hears their own desktop/tab audio directly from their OS.
    if ("muted" in videoEl) {
      videoEl.muted = isLocalSharer;
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      this.boundTrackEndedListener = () => {
        this.setState("ended");
        for (const fn of this.endedListeners) fn();
      };
      videoTrack.addEventListener("ended", this.boundTrackEndedListener);
    }

    this.setState("cued");
  }

  public async startCapture(displayMediaOptions: DisplayMediaStreamOptions = { video: true, audio: true }): Promise<MediaStream> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("Screen sharing getDisplayMedia API is not supported in this environment");
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      this.setMediaStream(stream);
      return stream;
    } catch (err: any) {
      for (const fn of this.errorListeners) fn(err);
      throw err;
    }
  }

  public stopExistingStream(): void {
    if (this.mediaStream) {
      const videoTrack = this.mediaStream.getVideoTracks()[0];
      if (videoTrack && this.boundTrackEndedListener) {
        videoTrack.removeEventListener("ended", this.boundTrackEndedListener);
      }
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    const videoEl = this.video as any;
    if ("srcObject" in videoEl) {
      videoEl.srcObject = null;
    }
  }

  public async load(source: PlayerSource | string): Promise<void> {
    const src: PlayerSource = typeof source === "string" ? { provider: "screenshare", sourceRef: source } : source;
    this.currentSource = src;

    if (src.mediaStream) {
      this.setMediaStream(src.mediaStream);
    } else {
      this.setState("cued");
    }
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

  public seek(positionMs: number): void {
    // Screen share is a live media stream - precise seeking is not supported.
    // Degrades gracefully without throwing or mutating live stream time.
  }

  public getCurrentTime(): number {
    if (this.captureStartTimeMs > 0) {
      return Date.now() - this.captureStartTimeMs;
    }
    return Math.round((this.video.currentTime || 0) * 1000);
  }

  public getState(): PlayerState {
    if (this.currentState === "ended") return "ended";
    if (this.isBuffering) return "buffering";
    if (this.video.paused) return "paused";
    return this.currentState || "playing";
  }

  public setPlaybackRate(rate: number): void {
    // Screen share is a live stream - playback rate is locked to 1.0.
    // Graceful no-op.
  }

  public getDuration(): number {
    return Infinity;
  }

  public getMediaStream(): MediaStream | null {
    return this.mediaStream;
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
    this.stopExistingStream();
    this.detachEvents();
    this.stateListeners.clear();
    this.bufferListeners.clear();
    this.endedListeners.clear();
    this.errorListeners.clear();
    this.seekListeners.clear();
  }
}
