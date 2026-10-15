import { VideoProvider } from "@watchparty/shared";
import { ControllableLevel, PlayerCapabilities } from "../PlayerAdapter.js";

export type EmbedProtocol =
  | "player.js"
  | "soundcloud"
  | "spotify"
  | "vimeo"
  | "youtube"
  | "generic";

export interface EmbedCapabilities extends PlayerCapabilities {
  supportsPlaybackRate: boolean;
  supportsPreciseSeek: boolean;
  isLive: boolean;
  canAutoplay: boolean;
  reliableGetCurrentTime: boolean;
  controllable: ControllableLevel;
  isHostDrivenSoftSync: boolean;
  protocol: EmbedProtocol;
}

export interface EmbedAdapterOptions {
  /** Optional pre-existing iframe element */
  iframeElement?: HTMLIFrameElement | any;
  /** Optional container element where iframe will be attached */
  containerElement?: HTMLElement | any;
  /** Canonical source media or page URL */
  sourceUrl?: string;
  /** Direct embed iframe URL (e.g., from oEmbed or provider transform) */
  embedUrl?: string;
  /** Explicit protocol override */
  protocol?: EmbedProtocol;
  /** Media title if known from oEmbed or metadata */
  title?: string;
  /** Creator / author name if known */
  author?: string;
  /** Duration in milliseconds if known */
  durationMs?: number;
  /** Thumbnail image URL */
  thumbnailUrl?: string;
  /** Raw oEmbed payload if discovered */
  oembedData?: Record<string, any>;
  /** Controllability level override ("full" | "limited" | "none") */
  controllable?: ControllableLevel;
  /** Callback triggered when embed has limited control (e.g. no rate nudging) */
  onSyncApproximate?: (isApproximate: boolean, reason?: string) => void;
  /** Callback triggered when embed cannot report position (degraded to soft sync) */
  onSoftSyncDegraded?: (isDegraded: boolean, message?: string) => void;
}

export interface EmbedSyncConfig {
  driftIntervalMs: number;
  deadZoneMs: number;
  hysteresisZoneMs: number;
  hardSeekThresholdMs: number;
  maxRateAdjustment: number;
}

/**
 * Recommended drift engine configurations tailored per embed controllability.
 */
export const EMBED_SYNC_CONFIGS: Record<ControllableLevel, EmbedSyncConfig> = {
  full: {
    driftIntervalMs: 250,
    deadZoneMs: 40,
    hysteresisZoneMs: 20,
    hardSeekThresholdMs: 1000,
    maxRateAdjustment: 0.08,
  },
  limited: {
    // Limited embeds (e.g. SoundCloud / Spotify) do not support rate micro-nudges.
    // Use wider deadband (150ms) to avoid seek thrashing and hard seek only when needed.
    driftIntervalMs: 300,
    deadZoneMs: 150,
    hysteresisZoneMs: 75,
    hardSeekThresholdMs: 1500,
    maxRateAdjustment: 0,
  },
  none: {
    // Uncontrollable / soft-sync embeds do not seek on drift
    driftIntervalMs: 1000,
    deadZoneMs: 1000,
    hysteresisZoneMs: 500,
    hardSeekThresholdMs: 5000,
    maxRateAdjustment: 0,
  },
};
