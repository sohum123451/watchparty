import { VideoProvider } from "../models.js";

export interface DetectedSource {
  valid: boolean;
  error?: string;
  provider?: VideoProvider;
  sourceRef?: string;
  title?: string;
  thumbnailUrl?: string;
  durationMs?: number;
  normalizedUrl?: string;
}

export class SourceDetector {
  /**
   * Allowed provider list
   */
  public static readonly ALLOWED_PROVIDERS: readonly VideoProvider[] = [
    "html5",
    "youtube",
    "vimeo",
    "local",
    "screenshare",
    "podcast",
    "embed",
    "soundcloud",
    "spotify",
    "co-browse",
  ];

  /**
   * Evaluates if a given URL or input targets a private IP, loopback, or metadata service.
   * Protects against SSRF attacks (Server-Side Request Forgery).
   */
  public static isPrivateOrLoopbackHost(hostname: string): boolean {
    const host = hostname.toLowerCase().trim();

    // 1. Literal hostnames
    if (
      host === "localhost" ||
      host === "localhost.localdomain" ||
      host.endsWith(".localhost") ||
      host === "0.0.0.0" ||
      host === "::" ||
      host === "[::]"
    ) {
      return true;
    }

    // 2. Strip brackets for IPv6
    const cleanHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

    // 3. IPv6 Loopback and Unique Local / Link Local
    if (cleanHost === "::1" || cleanHost.startsWith("fe80:") || cleanHost.startsWith("fc00:") || cleanHost.startsWith("fd")) {
      return true;
    }

    // 4. IPv4-mapped IPv6 (e.g., ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (cleanHost.startsWith("::ffff:")) {
      const v4Part = cleanHost.replace("::ffff:", "");
      if (this.isPrivateOrLoopbackHost(v4Part)) return true;
    }

    // 5. Handle Decimal / Octal / Hex encoded integer IPs (e.g., 2130706433 for 127.0.0.1)
    if (/^\d+$/.test(cleanHost)) {
      const num = parseInt(cleanHost, 10);
      if (num >= 0 && num <= 0xffffffff) {
        const p1 = (num >>> 24) & 255;
        const p2 = (num >>> 16) & 255;
        const p3 = (num >>> 8) & 255;
        const p4 = num & 255;
        return this.isPrivateIpParts(p1, p2, p3, p4);
      }
    }

    // 6. IPv4 Dotted Quad
    const v4Match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(cleanHost);
    if (v4Match) {
      const [p1, p2, p3, p4] = [
        parseInt(v4Match[1], 10),
        parseInt(v4Match[2], 10),
        parseInt(v4Match[3], 10),
        parseInt(v4Match[4], 10),
      ];
      return this.isPrivateIpParts(p1, p2, p3, p4);
    }

    return false;
  }

  private static isPrivateIpParts(p1: number, p2: number, p3: number, p4: number): boolean {
    // 0.0.0.0/8 (Broadcast/source)
    if (p1 === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (p1 === 127) return true;
    // 10.0.0.0/8 (Private RFC 1918)
    if (p1 === 10) return true;
    // 172.16.0.0/12 (Private RFC 1918)
    if (p1 === 172 && p2 >= 16 && p2 <= 31) return true;
    // 192.168.0.0/16 (Private RFC 1918)
    if (p1 === 192 && p2 === 168) return true;
    // 169.254.0.0/16 (Link-local / AWS & GCP Metadata Service 169.254.169.254)
    if (p1 === 169 && p2 === 254) return true;
    // 100.64.0.0/10 (Shared address space / CGNAT)
    if (p1 === 100 && p2 >= 64 && p2 <= 127) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (p1 === 192 && p2 === 0 && p3 === 0) return true;
    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (Test networks)
    if (p1 === 192 && p2 === 0 && p3 === 2) return true;
    if (p1 === 198 && p2 === 51 && p3 === 100) return true;
    if (p1 === 203 && p2 === 0 && p3 === 113) return true;
    // 198.18.0.0/15 (Benchmarking)
    if (p1 === 198 && (p2 === 18 || p2 === 19)) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (p1 >= 224) return true;

    return false;
  }

  /**
   * Validates a URL string for safety (protocol whitelist, no private IPs, well-formed).
   */
  public static validateUrl(urlStr: string): { valid: boolean; error?: string; url?: URL } {
    const trimmed = (urlStr || "").trim();
    if (!trimmed) {
      return { valid: false, error: "URL cannot be empty." };
    }

    // Special pseudo-schemes
    if (trimmed.startsWith("local://") || trimmed === "local" || trimmed.startsWith("local:")) {
      return { valid: true };
    }
    if (trimmed.startsWith("screenshare://") || trimmed === "screenshare" || trimmed.startsWith("screenshare:")) {
      return { valid: true };
    }
    if (trimmed.startsWith("podcast://") || trimmed.startsWith("podcast:")) {
      const stripped = trimmed.replace(/^podcast:\/\//, "https://").replace(/^podcast:/, "https://");
      return this.validateUrl(stripped);
    }
    if (trimmed.startsWith("embed://") || trimmed.startsWith("embed:")) {
      const stripped = trimmed.replace(/^embed:\/\//, "https://").replace(/^embed:/, "https://");
      return this.validateUrl(stripped);
    }
    if (trimmed.startsWith("soundcloud://") || trimmed.startsWith("soundcloud:")) {
      const stripped = trimmed.replace(/^soundcloud:\/\//, "https://").replace(/^soundcloud:/, "https://");
      return this.validateUrl(stripped);
    }
    if (trimmed.startsWith("spotify://") || trimmed.startsWith("spotify:")) {
      const stripped = trimmed.replace(/^spotify:\/\//, "https://").replace(/^spotify:/, "https://");
      return this.validateUrl(stripped);
    }
    if (trimmed.startsWith("cobrowse://") || trimmed.startsWith("cobrowse:")) {
      const stripped = trimmed.replace(/^cobrowse:\/\//, "https://").replace(/^cobrowse:/, "https://");
      return this.validateUrl(stripped);
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { valid: false, error: "Invalid URL format." };
    }

    // Protocol check: only http and https allowed
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        valid: false,
        error: `Prohibited protocol '${parsed.protocol}'. Only HTTPS and HTTP are allowed.`,
      };
    }

    // SSRF / Private IP check
    if (this.isPrivateOrLoopbackHost(parsed.hostname)) {
      return {
        valid: false,
        error: "Access to private network or loopback addresses is strictly forbidden (SSRF protection).",
      };
    }

    return { valid: true, url: parsed };
  }

  /**
   * Alias for detectSource
   */
  public static detect(input: string): DetectedSource {
    return this.detectSource(input);
  }

  /**
   * Detects the video provider, extracts the normalized source reference,
   * title, and thumbnail preview.
   */
  public static detectSource(input: string): DetectedSource {
    const raw = (input || "").trim();
    if (!raw) {
      return { valid: false, error: "Input is empty." };
    }

    // 1. Check Screen Share
    if (raw === "screenshare" || raw === "screenshare://live" || raw.startsWith("screenshare:")) {
      return {
        valid: true,
        provider: "screenshare",
        sourceRef: "live_screen",
        title: "Live Screen Share",
        durationMs: 0,
      };
    }

    // 2. Check Local File
    if (raw.startsWith("local://") || raw === "local" || raw.startsWith("local:")) {
      const fileName = raw.replace(/^local:\/\//, "").replace(/^local:/, "") || "Local Video";
      return {
        valid: true,
        provider: "local",
        sourceRef: fileName,
        title: fileName,
        durationMs: 0,
      };
    }

    // 3. URL Safety Validation
    const validation = this.validateUrl(raw);
    if (!validation.valid || !validation.url) {
      return { valid: false, error: validation.error || "Invalid URL" };
    }

    const url = validation.url;
    const host = url.hostname.toLowerCase();

    // 4. YouTube Detection
    if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtu.be"
    ) {
      let videoId: string | null = null;

      if (host === "youtu.be") {
        videoId = url.pathname.slice(1).split("/")[0] || null;
      } else if (url.pathname.startsWith("/watch")) {
        videoId = url.searchParams.get("v");
      } else if (url.pathname.startsWith("/embed/")) {
        videoId = url.pathname.replace("/embed/", "").split("/")[0] || null;
      } else if (url.pathname.startsWith("/shorts/")) {
        videoId = url.pathname.replace("/shorts/", "").split("/")[0] || null;
      } else if (url.pathname.startsWith("/v/")) {
        videoId = url.pathname.replace("/v/", "").split("/")[0] || null;
      }

      // YouTube Video IDs are typically 11 alphanumeric characters, dashes, or underscores
      if (videoId && /^[\w-]{11}$/.test(videoId)) {
        return {
          valid: true,
          provider: "youtube",
          sourceRef: videoId,
          title: `YouTube (${videoId})`,
          thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          durationMs: 0,
          normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`,
        };
      } else {
        return { valid: false, error: "Could not extract a valid 11-character YouTube video ID." };
      }
    }

    // 5. Vimeo Detection
    if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
      let vimeoId: string | null = null;

      if (host === "player.vimeo.com" && url.pathname.startsWith("/video/")) {
        vimeoId = url.pathname.replace("/video/", "").split("/")[0] || null;
      } else {
        const segments = url.pathname.split("/").filter(Boolean);
        const lastSegment = segments[segments.length - 1];
        if (lastSegment && /^\d+$/.test(lastSegment)) {
          vimeoId = lastSegment;
        }
      }

      if (vimeoId) {
        return {
          valid: true,
          provider: "vimeo",
          sourceRef: vimeoId,
          title: `Vimeo (${vimeoId})`,
          thumbnailUrl: `https://vumbnail.com/${vimeoId}.jpg`,
          durationMs: 0,
          normalizedUrl: `https://vimeo.com/${vimeoId}`,
        };
      } else {
        return { valid: false, error: "Could not extract numeric Vimeo video ID." };
      }
    }

    // 6. HTML5 Direct Video / HLS Stream (.mp4, .webm, .m3u8, .ogg, .mov)
    const cleanPath = url.pathname.toLowerCase();
    const isDirectMedia =
      cleanPath.endsWith(".mp4") ||
      cleanPath.endsWith(".webm") ||
      cleanPath.endsWith(".m3u8") ||
      cleanPath.endsWith(".ogg") ||
      cleanPath.endsWith(".mov");

    if (isDirectMedia) {
      const fileName = url.pathname.split("/").filter(Boolean).pop() || "Direct Video Stream";
      return {
        valid: true,
        provider: "html5",
        sourceRef: url.href,
        title: decodeURIComponent(fileName),
        thumbnailUrl: undefined,
        durationMs: 0,
        normalizedUrl: url.href,
      };
    }

    // 7. Podcast RSS Feed or Direct Audio Enclosure (.mp3, .m4a, .aac, .wav, .rss, .xml, /feed)
    const isExplicitPodcast = raw.startsWith("podcast://") || raw.startsWith("podcast:");
    const isAudioEnclosure =
      cleanPath.endsWith(".mp3") ||
      cleanPath.endsWith(".m4a") ||
      cleanPath.endsWith(".aac") ||
      cleanPath.endsWith(".wav") ||
      cleanPath.endsWith(".flac");
    const isPodcastFeed =
      cleanPath.endsWith(".rss") ||
      cleanPath.endsWith(".xml") ||
      cleanPath.endsWith(".atom") ||
      cleanPath.includes("/feed") ||
      cleanPath.includes("/rss") ||
      cleanPath.includes("/podcast") ||
      host.includes("podcast") ||
      host.endsWith("anchor.fm") ||
      host.endsWith("megaphone.fm") ||
      host.endsWith("podbean.com") ||
      host.endsWith("buzzsprout.com") ||
      host.endsWith("libsyn.com") ||
      host.endsWith("transistor.fm") ||
      host.endsWith("simplecast.com");

    if (isExplicitPodcast || isAudioEnclosure || isPodcastFeed) {
      const fileName = url.pathname.split("/").filter(Boolean).pop() || "Podcast Episode";
      return {
        valid: true,
        provider: "podcast",
        sourceRef: url.href,
        title: decodeURIComponent(fileName).replace(/\.[a-z0-9]+$/i, ""),
        thumbnailUrl: undefined,
        durationMs: 0,
        normalizedUrl: url.href,
      };
    }

    // 8. SoundCloud Audio Track / Set
    const isExplicitSoundCloud = raw.startsWith("soundcloud://") || raw.startsWith("soundcloud:");
    const isSoundCloudHost =
      host === "soundcloud.com" ||
      host.endsWith(".soundcloud.com") ||
      host === "on.soundcloud.com";

    if (isExplicitSoundCloud || isSoundCloudHost) {
      const trackSlug = url.pathname.split("/").filter(Boolean).pop() || "SoundCloud Track";
      return {
        valid: true,
        provider: "soundcloud",
        sourceRef: url.href,
        title: decodeURIComponent(trackSlug).replace(/[-_]/g, " "),
        durationMs: 0,
        normalizedUrl: url.href,
      };
    }

    // 9. Spotify Embed Track / Album / Playlist
    const isExplicitSpotify = raw.startsWith("spotify://") || raw.startsWith("spotify:");
    const isSpotifyHost = host === "spotify.com" || host.endsWith(".spotify.com");

    if (isExplicitSpotify || isSpotifyHost) {
      const segs = url.pathname.split("/").filter(Boolean);
      const titleHint = segs.length >= 2 ? `Spotify ${segs[0]}` : "Spotify Track";
      return {
        valid: true,
        provider: "spotify",
        sourceRef: url.href,
        title: titleHint,
        durationMs: 0,
        normalizedUrl: url.href,
      };
    }

    // 10. Generic Embed / player.js compatible embed
    const isExplicitEmbed = raw.startsWith("embed://") || raw.startsWith("embed:");
    const isEmbedPath =
      cleanPath.includes("/embed") ||
      cleanPath.includes("/player") ||
      url.searchParams.has("embed") ||
      host.includes("playerjs") ||
      host.includes("embedly.com") ||
      host.includes("dailymotion.com") ||
      host.includes("wistia.com");

    if (isExplicitEmbed || isEmbedPath) {
      return {
        valid: true,
        provider: "embed",
        sourceRef: url.href,
        title: "Third-Party Media Embed",
        durationMs: 0,
        normalizedUrl: url.href,
      };
    }

    // 11. Co-Browse Web Page / Article
    const isExplicitCoBrowse = raw.startsWith("cobrowse://") || raw.startsWith("cobrowse:");
    if (isExplicitCoBrowse) {
      return {
        valid: true,
        provider: "co-browse",
        sourceRef: url.href,
        title: "Co-Browse Web Page",
        durationMs: 0,
        normalizedUrl: url.href,
      };
    }

    return {
      valid: false,
      error: "Unsupported media provider or unrecognized media file extension. Supported: YouTube, Vimeo, direct MP4/WebM/HLS, Podcasts/RSS audio feeds, SoundCloud, Spotify, Third-Party Embeds, Co-Browse Pages, Local Files, and Screen Sharing.",
    };
  }
}
