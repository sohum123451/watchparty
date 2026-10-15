export type SourceKind = "video" | "audio" | "podcast" | "embed" | "co-browse";

export type ControllableLevel = "full" | "limited" | "none";

export interface PodcastEpisode {
  title: string;
  enclosureUrl: string;
  durationMs?: number;
  artwork?: string;
  description?: string;
  pubDate?: string;
}

export interface SourceDescriptor {
  kind: SourceKind;
  provider: string; // "youtube" | "vimeo" | "twitch" | "html5" | "podcast" | "embed" | "co-browse"
  sourceRef: string; // Canonical media URL or provider ID
  title: string;
  author?: string;
  durationMs?: number;
  thumbnail?: string;
  embedAllowed: boolean;
  controllable: ControllableLevel;
  warnings: string[];
  // Optional enriched metadata
  description?: string;
  favicon?: string;
  episodes?: PodcastEpisode[];
  domain?: string;
  safety?: any;
  termsNotice?: string;
}

export interface SourceResolverOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  userAgent?: string;
  cacheTtlMs?: number;
}
