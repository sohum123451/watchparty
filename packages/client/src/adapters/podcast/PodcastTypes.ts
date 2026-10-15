export interface PodcastChapter {
  startTimeMs: number;
  endTimeMs?: number;
  title: string;
  img?: string;
  url?: string;
}

export interface PodcastTranscriptCue {
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  speaker?: string;
}

export interface PodcastEpisode {
  guid: string;
  title: string;
  enclosureUrl: string; // The audio streams directly from creator's host
  enclosureType: string;
  enclosureLength?: number;
  durationMs: number;
  pubDate?: string;
  description?: string;
  episodeLink?: string;
  artworkUrl?: string;
  season?: number;
  episode?: number;
  chaptersUrl?: string; // Podcasting 2.0 chapters JSON URL
  transcriptUrl?: string; // Podcasting 2.0 transcript URL
  transcriptType?: string; // e.g. "application/json", "text/vtt", "application/srt"
  chapters?: PodcastChapter[];
  transcript?: PodcastTranscriptCue[];
  podcastTitle?: string;
  podcastAuthor?: string;
  podcastLink?: string; // Link back to the original page
}

export interface PodcastFeed {
  title: string;
  description?: string;
  author?: string;
  link?: string; // Link back to original podcast page
  feedUrl?: string;
  artworkUrl?: string;
  language?: string;
  categories?: string[];
  episodes: PodcastEpisode[];
}

export interface PodcastAdapterOptions {
  audioElement?: HTMLAudioElement | any;
  feedUrl?: string;
  feedXml?: string;
  initialEpisode?: PodcastEpisode;
  corsFallbackMode?: "auto" | "css-only" | "webaudio";
}
