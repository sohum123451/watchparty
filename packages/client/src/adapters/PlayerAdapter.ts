import { VideoProvider } from "@watchparty/shared";

export type PlayerState =
  | "unstarted"
  | "playing"
  | "paused"
  | "buffering"
  | "ended"
  | "cued";

export interface PlayerSource {
  provider: VideoProvider;
  sourceRef: string;
  title?: string;
  durationMs?: number;
  thumbnailUrl?: string;
  file?: File | Blob;
  mediaStream?: MediaStream;
}

export type ControllableLevel = "full" | "limited" | "none";

export interface PlayerCapabilities {
  supportsPlaybackRate: boolean;
  supportsPreciseSeek: boolean;
  isLive: boolean;
  canAutoplay: boolean;
  reliableGetCurrentTime?: boolean;
  controllable?: ControllableLevel;
  isHostDrivenSoftSync?: boolean;
  protocol?: "player.js" | "soundcloud" | "spotify" | "vimeo" | "youtube" | "generic";
}

export interface PlayerAdapter {
  readonly provider: VideoProvider;
  readonly capabilities: PlayerCapabilities;

  load(source: PlayerSource | string): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void> | void;
  seek(positionMs: number): Promise<void> | void;
  getCurrentTime(): number; // Returns position in milliseconds
  getState(): PlayerState;
  setPlaybackRate(rate: number): void;
  getDuration(): number; // Returns duration in milliseconds

  // Event subscribers returning unsubscribe functions
  onStateChange(listener: (state: PlayerState) => void): () => void;
  onBuffering(listener: (buffering: boolean) => void): () => void;
  onEnded(listener: () => void): () => void;
  onError(listener: (error: any) => void): () => void;
  onSeek?(listener: (positionMs: number) => void): () => void;

  destroy?(): void;
}
