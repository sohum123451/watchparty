import dns from "node:dns/promises";
import net from "node:net";
import {
  SourceDescriptor,
  SourceKind,
  ControllableLevel,
  PodcastEpisode,
  SourceResolverOptions,
} from "@watchparty/shared";
import { UrlSafetyChecker, defaultUrlSafetyChecker } from "./UrlSafetyChecker.js";

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

interface CacheEntry {
  descriptor: SourceDescriptor;
  expiresAt: number;
}

interface RobotsCacheEntry {
  disallowedPaths: string[];
  expiresAt: number;
}

export class SourceResolver {
  private cache = new Map<string, CacheEntry>();
  private robotsCache = new Map<string, RobotsCacheEntry>();
  private rateLimits = new Map<string, { count: number; resetAt: number }>();

  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly userAgent: string;
  private readonly cacheTtlMs: number;
  public readonly urlSafetyChecker: UrlSafetyChecker;

  constructor(options: SourceResolverOptions & { urlSafetyChecker?: UrlSafetyChecker } = {}) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxRedirects = options.maxRedirects ?? 3;
    this.maxResponseBytes = options.maxResponseBytes ?? 2 * 1024 * 1024; // 2MB
    this.userAgent =
      options.userAgent ??
      "WatchParty-SourceResolver/1.0 (+https://watchparty.live/bot; bot@watchparty.live)";
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60 * 1000; // 10 minutes
    this.urlSafetyChecker = options.urlSafetyChecker ?? defaultUrlSafetyChecker;
  }

  // --- Rate Limiting ---
  public checkRateLimit(userKey: string, maxRequestsPerMinute: number = 30): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(userKey);

    if (!entry || now > entry.resetAt) {
      this.rateLimits.set(userKey, { count: 1, resetAt: now + 60000 });
      return true;
    }

    if (entry.count >= maxRequestsPerMinute) {
      return false;
    }

    entry.count++;
    return true;
  }

  // --- SSRF & IP Validation ---
  public static isIpBlocked(ip: string): boolean {
    const isV4 = net.isIPv4(ip);
    const isV6 = net.isIPv6(ip);

    if (!isV4 && !isV6) return true; // not valid IP

    if (isV4) {
      const parts = ip.split(".").map(Number);
      const [a, b, c, d] = parts;

      // 0.0.0.0/8
      if (a === 0) return true;
      // 10.0.0.0/8 (Private)
      if (a === 10) return true;
      // 127.0.0.0/8 (Loopback)
      if (a === 127) return true;
      // 100.64.0.0/10 (Shared address space / CGNAT)
      if (a === 100 && b >= 64 && b <= 127) return true;
      // 169.254.0.0/16 (Link-local / Cloud metadata, e.g. AWS 169.254.169.254)
      if (a === 169 && b === 254) return true;
      // 172.16.0.0/12 (Private)
      if (a === 172 && b >= 16 && b <= 31) return true;
      // 192.0.0.0/24 (IETF Protocol Assignments)
      if (a === 192 && b === 0 && c === 0) return true;
      // 192.0.2.0/24 (TEST-NET-1)
      if (a === 192 && b === 0 && c === 2) return true;
      // 192.168.0.0/16 (Private)
      if (a === 192 && b === 168) return true;
      // 198.18.0.0/15 (Network benchmark testing)
      if (a === 198 && (b === 18 || b === 19)) return true;
      // 198.51.100.0/24 (TEST-NET-2)
      if (a === 198 && b === 51 && c === 100) return true;
      // 203.0.113.0/24 (TEST-NET-3)
      if (a === 203 && b === 0 && c === 113) return true;
      // 224.0.0.0/4 (Multicast)
      if (a >= 224 && a <= 239) return true;
      // 240.0.0.0/4 (Reserved / Future use)
      if (a >= 240) return true;

      return false;
    }

    if (isV6) {
      const lower = ip.toLowerCase();
      // Loopback
      if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
      // Unspecified
      if (lower === "::" || lower === "0:0:0:0:0:0:0:0") return true;
      // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
      if (lower.startsWith("::ffff:") || lower.includes(":ffff:")) {
        const lastPart = lower.split(":").pop() || "";
        if (net.isIPv4(lastPart)) {
          return SourceResolver.isIpBlocked(lastPart);
        }
        return true;
      }
      // Unique Local Addresses (fc00::/7 -> fc.. or fd..)
      if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
      // Link-Local (fe80::/10)
      if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
        return true;
      }
      // Documentation (2001:db8::/32)
      if (lower.startsWith("2001:db8") || lower.startsWith("2001:0db8")) return true;
      // Discard prefix (100::/64)
      if (lower.startsWith("100:")) return true;

      return false;
    }

    return true;
  }

  public async validateUrlSecurity(urlString: string): Promise<URL> {
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch {
      throw new SecurityError(`Malformed URL: ${urlString}`);
    }

    // Protocol check: Only http: and https: allowed
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new SecurityError(
        `Forbidden protocol '${parsed.protocol}'. Only http: and https: are permitted.`
      );
    }

    // Malicious URL & Blocklist Check
    const safety = await this.urlSafetyChecker.checkUrl(urlString);
    if (!safety.isSafe && (safety.safetyLevel === "blocked" || safety.safetyLevel === "malicious")) {
      throw new SecurityError(`Blocked by safety filter: ${safety.warning || "Malicious domain"}`);
    }

    const hostname = parsed.hostname.toLowerCase().trim();

    // Block localhost, .local, .internal, .localhost
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      throw new SecurityError(`Forbidden hostname '${hostname}': Internal host resolution blocked.`);
    }

    // Block numeric / hex integer IP obfuscations (e.g. 2130706433, 0x7f000001, 017700000001)
    if (/^\d+$/.test(hostname) || /^0x[0-9a-fA-F]+$/.test(hostname) || /^0[0-7]+$/.test(hostname)) {
      throw new SecurityError(`Obfuscated numeric IP representation blocked: ${hostname}`);
    }

    const cleanHost =
      hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1)
        : hostname;

    // Direct IP address check
    if (net.isIP(cleanHost)) {
      if (SourceResolver.isIpBlocked(cleanHost)) {
        throw new SecurityError(`Direct private or loopback IP range blocked: ${hostname}`);
      }
      return parsed;
    }

    // DNS Resolution check (protect against DNS rebinding & local resolution)
    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = await dns.lookup(cleanHost, { all: true });
    } catch (err: any) {
      throw new SecurityError(`DNS lookup failed for host '${cleanHost}': ${err.message}`);
    }

    if (!addresses || addresses.length === 0) {
      throw new SecurityError(`No IP address resolved for host '${hostname}'.`);
    }

    for (const record of addresses) {
      if (SourceResolver.isIpBlocked(record.address)) {
        throw new SecurityError(
          `Host '${hostname}' resolved to blocked private/loopback/link-local address ${record.address}`
        );
      }
    }

    return parsed;
  }

  // --- Safe HTTP Fetch with Redirect Validation and Size Cap ---
  public async fetchSafe(
    url: string,
    options: {
      method?: "GET" | "HEAD";
      accept?: string;
      redirectCount?: number;
    } = {}
  ): Promise<{
    status: number;
    headers: Headers;
    bodyText: string;
    finalUrl: string;
  }> {
    const redirectCount = options.redirectCount ?? 0;
    if (redirectCount > this.maxRedirects) {
      throw new SecurityError(`Too many redirects (max ${this.maxRedirects} allowed).`);
    }

    const validatedUrl = await this.validateUrlSecurity(url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(validatedUrl.toString(), {
        method: options.method ?? "GET",
        headers: {
          "User-Agent": this.userAgent,
          Accept: options.accept ?? "*/*",
          "Accept-Encoding": "gzip, deflate, br",
        },
        redirect: "manual", // MUST handle manually to validate every redirect target
        signal: controller.signal,
      });

      // Handle Redirects manually with SSRF re-check
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new SecurityError(`Redirect status ${response.status} with missing Location header.`);
        }
        const nextUrl = new URL(location, validatedUrl).toString();
        return await this.fetchSafe(nextUrl, {
          ...options,
          redirectCount: redirectCount + 1,
        });
      }

      let bodyText = "";
      if (options.method !== "HEAD" && response.body) {
        const reader = response.body.getReader();
        let totalBytes = 0;
        const chunks: Uint8Array[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.length;
            if (totalBytes > this.maxResponseBytes) {
              reader.cancel();
              throw new SecurityError(
                `Response body size exceeded maximum limit of ${Math.round(this.maxResponseBytes / 1024 / 1024)}MB.`
              );
            }
            chunks.push(value);
          }
        }

        const fullBuffer = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          fullBuffer.set(chunk, offset);
          offset += chunk.length;
        }

        bodyText = new TextDecoder("utf-8", { fatal: false }).decode(fullBuffer);
      }

      return {
        status: response.status,
        headers: response.headers,
        bodyText,
        finalUrl: validatedUrl.toString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // --- Respect robots.txt ---
  public async checkRobotsTxt(targetUrl: URL): Promise<{ allowed: boolean; warning?: string }> {
    const origin = targetUrl.origin;
    const now = Date.now();

    let entry = this.robotsCache.get(origin);
    if (!entry || now > entry.expiresAt) {
      try {
        const robotsUrl = `${origin}/robots.txt`;
        const res = await this.fetchSafe(robotsUrl, { method: "GET" });
        const disallowedPaths: string[] = [];

        if (res.status === 200) {
          const lines = res.bodyText.split("\n");
          let appliesToBot = false;

          for (const line of lines) {
            const clean = line.split("#")[0].trim();
            const lower = clean.toLowerCase();

            if (lower.startsWith("user-agent:")) {
              const agent = clean.slice(11).trim().toLowerCase();
              appliesToBot = agent === "*" || agent.includes("watchparty");
            } else if (appliesToBot && lower.startsWith("disallow:")) {
              const disPath = clean.slice(9).trim();
              if (disPath) {
                disallowedPaths.push(disPath);
              }
            }
          }
        }

        entry = { disallowedPaths, expiresAt: now + 60 * 60 * 1000 };
        this.robotsCache.set(origin, entry);
      } catch {
        entry = { disallowedPaths: [], expiresAt: now + 15 * 60 * 1000 };
        this.robotsCache.set(origin, entry);
      }
    }

    const path = targetUrl.pathname;
    for (const dis of entry.disallowedPaths) {
      if (dis === "/" || path.startsWith(dis)) {
        return {
          allowed: false,
          warning: `Path '${path}' is marked Disallow in ${origin}/robots.txt`,
        };
      }
    }

    return { allowed: true };
  }

  // --- Check Framing Permissions (X-Frame-Options & CSP) ---
  public checkFrameAncestors(headers: Headers): { allowed: boolean; warning?: string } {
    const xfo = headers.get("x-frame-options")?.toUpperCase();
    if (xfo === "DENY" || xfo === "SAMEORIGIN") {
      return {
        allowed: false,
        warning: `Embedding prohibited by header X-Frame-Options: ${xfo}`,
      };
    }

    const csp = headers.get("content-security-policy");
    if (csp) {
      const match = csp.match(/frame-ancestors\s+([^;]+)/i);
      if (match) {
        const policy = match[1].trim();
        if (policy === "'none'" || policy === "'self'") {
          return {
            allowed: false,
            warning: `Embedding prohibited by Content-Security-Policy: frame-ancestors ${policy}`,
          };
        }
      }
    }

    return { allowed: true };
  }

  // --- String Sanitizer ---
  public static sanitize(text?: string): string {
    if (!text) return "";
    return text
      .replace(/<[^>]*>/g, "") // strip html tags
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .trim();
  }

  // --- Main Source Resolution Pipeline ---
  public async resolve(rawUrl: string): Promise<SourceDescriptor> {
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      throw new Error("URL is empty");
    }

    // Check in-memory cache
    const cached = this.cache.get(trimmed);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.descriptor;
    }

    // SSRF validation
    const parsedUrl = await this.validateUrlSecurity(trimmed);

    // Pipeline Step 1: Known Providers (YouTube, Vimeo, Twitch, SoundCloud)
    const known = this.resolveKnownProviders(parsedUrl);
    if (known) {
      this.cacheResult(trimmed, known);
      return known;
    }

    // Pipeline Step 2: Direct media URL by file extension
    const directExt = this.resolveDirectExtension(parsedUrl);
    if (directExt) {
      this.cacheResult(trimmed, directExt);
      return directExt;
    }

    // Pipeline Step 2 (cont): Direct media URL by HEAD Content-Type
    const directHead = await this.probeHeadMedia(parsedUrl);
    if (directHead) {
      this.cacheResult(trimmed, directHead);
      return directHead;
    }

    // Check robots.txt before fetching HTML
    const robots = await this.checkRobotsTxt(parsedUrl);
    const warnings: string[] = [];
    if (!robots.allowed && robots.warning) {
      warnings.push(robots.warning);
    }

    // Fetch the HTML document safely
    const pageResponse = await this.fetchSafe(parsedUrl.toString(), {
      method: "GET",
      accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*",
    });

    const framePerm = this.checkFrameAncestors(pageResponse.headers);
    if (!framePerm.allowed && framePerm.warning) {
      warnings.push(framePerm.warning);
    }

    const html = pageResponse.bodyText;
    const finalUrl = new URL(pageResponse.finalUrl);

    // Pipeline Step 3: Podcast Feed (direct RSS feed or linked alternate)
    const podcast = await this.resolvePodcastFeed(html, finalUrl, warnings);
    if (podcast) {
      this.cacheResult(trimmed, podcast);
      return podcast;
    }

    // Pipeline Step 4: oEmbed Discovery & Open Graph / Twitter Player
    const embed = await this.resolveEmbed(html, finalUrl, framePerm.allowed, warnings);
    if (embed) {
      this.cacheResult(trimmed, embed);
      return embed;
    }

    // Pipeline Step 5: Media tags in HTML & JSON-LD
    const mediaTags = this.resolveHtmlMediaTags(html, finalUrl, warnings);
    if (mediaTags) {
      this.cacheResult(trimmed, mediaTags);
      return mediaTags;
    }

    // Pipeline Step 6: Fallback -> "co-browse" source type
    const fallback = this.resolveCoBrowse(html, finalUrl, framePerm.allowed, warnings);
    this.cacheResult(trimmed, fallback);
    return fallback;
  }

  private cacheResult(url: string, descriptor: SourceDescriptor): void {
    const domain = this.urlSafetyChecker.extractDomain(url);
    descriptor.domain = descriptor.domain || domain;
    descriptor.termsNotice =
      "Content Rights & Terms: Users are responsible for having the right to view what they add. WatchParty does not host, cache, or re-encode third-party media; all media streams directly from origin.";
    this.cache.set(url, {
      descriptor,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }

  // --- Step 1: Known Providers ---
  private resolveKnownProviders(url: URL): SourceDescriptor | null {
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname;

    // YouTube
    if (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be"
    ) {
      let videoId = "";
      if (host === "youtu.be") {
        videoId = pathname.slice(1);
      } else if (pathname.startsWith("/watch")) {
        videoId = url.searchParams.get("v") || "";
      } else if (pathname.startsWith("/embed/")) {
        videoId = pathname.replace("/embed/", "").split("/")[0];
      } else if (pathname.startsWith("/shorts/")) {
        videoId = pathname.replace("/shorts/", "").split("/")[0];
      }

      if (videoId) {
        return {
          kind: "video",
          provider: "youtube",
          sourceRef: videoId,
          title: `YouTube: ${videoId}`,
          author: "YouTube Creator",
          durationMs: 0,
          thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          embedAllowed: true,
          controllable: "full",
          warnings: [],
        };
      }
    }

    // Vimeo
    if (host === "vimeo.com" || host.endsWith(".vimeo.com")) {
      const match = pathname.match(/\/(\d+)/);
      if (match) {
        const vimeoId = match[1];
        return {
          kind: "video",
          provider: "vimeo",
          sourceRef: vimeoId,
          title: `Vimeo: ${vimeoId}`,
          author: "Vimeo Creator",
          durationMs: 0,
          embedAllowed: true,
          controllable: "full",
          warnings: [],
        };
      }
    }

    // Twitch
    if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
      const channel = pathname.slice(1).split("/")[0];
      if (channel && channel !== "directory") {
        return {
          kind: "video",
          provider: "twitch",
          sourceRef: channel,
          title: `Twitch: ${channel}`,
          author: channel,
          durationMs: 0,
          embedAllowed: true,
          controllable: "limited",
          warnings: ["Twitch live sync relies on live edge latency."],
        };
      }
    }

    // SoundCloud
    if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) {
      return {
        kind: "audio",
        provider: "soundcloud",
        sourceRef: url.toString(),
        title: "SoundCloud Audio Track",
        author: "SoundCloud Artist",
        embedAllowed: true,
        controllable: "limited",
        warnings: [],
      };
    }

    // Spotify
    if (host === "spotify.com" || host.endsWith(".spotify.com")) {
      const segs = pathname.split("/").filter(Boolean);
      const type = segs[0] || "track";
      return {
        kind: "audio",
        provider: "spotify",
        sourceRef: url.toString(),
        title: `Spotify: ${type}`,
        author: "Spotify Creator",
        embedAllowed: true,
        controllable: "limited",
        warnings: [],
      };
    }

    return null;
  }

  // --- Step 2: Direct Media URL by extension ---
  private resolveDirectExtension(url: URL): SourceDescriptor | null {
    const path = url.pathname.toLowerCase();
    const videoExts = [".mp4", ".webm", ".m3u8"];
    const audioExts = [".mp3", ".m4a", ".ogg", ".wav", ".aac", ".flac"];

    const isVideo = videoExts.some((ext) => path.endsWith(ext));
    const isAudio = audioExts.some((ext) => path.endsWith(ext));

    if (isVideo || isAudio) {
      const filename = url.pathname.split("/").pop() || "Media File";
      return {
        kind: isVideo ? "video" : "audio",
        provider: "html5",
        sourceRef: url.toString(),
        title: SourceResolver.sanitize(decodeURIComponent(filename)),
        embedAllowed: true,
        controllable: "full",
        warnings: [],
      };
    }

    return null;
  }

  // --- Step 2 (cont): Direct media URL by HEAD Content-Type ---
  private async probeHeadMedia(url: URL): Promise<SourceDescriptor | null> {
    try {
      const res = await this.fetchSafe(url.toString(), { method: "HEAD" });
      const contentType = res.headers.get("content-type")?.toLowerCase() || "";

      const videoTypes = [
        "video/mp4",
        "video/webm",
        "application/x-mpegurl",
        "application/vnd.apple.mpegurl",
      ];
      const audioTypes = [
        "audio/mpeg",
        "audio/mp4",
        "audio/ogg",
        "audio/wav",
        "audio/aac",
        "audio/x-m4a",
      ];

      const isVideo = videoTypes.some((t) => contentType.includes(t));
      const isAudio = audioTypes.some((t) => contentType.includes(t));

      if (isVideo || isAudio) {
        const filename = url.pathname.split("/").pop() || (isVideo ? "Video Stream" : "Audio Stream");
        return {
          kind: isVideo ? "video" : "audio",
          provider: "html5",
          sourceRef: url.toString(),
          title: SourceResolver.sanitize(decodeURIComponent(filename)),
          embedAllowed: true,
          controllable: "full",
          warnings: [],
        };
      }
    } catch {
      // ignore probe failures and continue in pipeline
    }
    return null;
  }

  // --- Step 3: Podcast Feed ---
  private async resolvePodcastFeed(
    html: string,
    baseUrl: URL,
    warnings: string[]
  ): Promise<SourceDescriptor | null> {
    // 1. Is the current response already an RSS / Atom podcast feed?
    const isRss = /<rss[\s>]/i.test(html) || /<feed[\s>]/i.test(html);
    if (isRss && (html.includes("<enclosure") || html.includes("<itunes:duration>"))) {
      return this.parseRssPodcast(html, baseUrl.toString(), warnings);
    }

    // 2. Discover <link rel="alternate" type="application/rss+xml">
    const linkMatch = html.match(
      /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/(rss\+xml|atom\+xml)["'][^>]+href=["']([^"']+)["']/i
    ) || html.match(
      /<link[^>]+type=["']application\/(rss\+xml|atom\+xml)["'][^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["']/i
    ) || html.match(
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']alternate["'][^>]+type=["']application\/(rss\+xml|atom\+xml)["']/i
    );

    if (linkMatch) {
      const feedHref = linkMatch[2] || linkMatch[1];
      const feedUrl = new URL(feedHref, baseUrl);
      try {
        const feedRes = await this.fetchSafe(feedUrl.toString(), { method: "GET" });
        return this.parseRssPodcast(feedRes.bodyText, feedUrl.toString(), warnings);
      } catch (err: any) {
        warnings.push(`Podcast feed discovered at ${feedHref} could not be retrieved: ${err.message}`);
      }
    }

    return null;
  }

  private parseRssPodcast(xml: string, feedUrl: string, warnings: string[]): SourceDescriptor | null {
    const channelTitleMatch = xml.match(/<channel>[\s\S]*?<title[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/title>/i);
    const feedTitle = channelTitleMatch ? (channelTitleMatch[1] || channelTitleMatch[2] || "Podcast").trim() : "Podcast";

    const authorMatch = xml.match(/<itunes:author>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/itunes:author>/i) ||
      xml.match(/<author>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/author>/i);
    const author = authorMatch ? (authorMatch[1] || authorMatch[2] || "").trim() : undefined;

    const artworkMatch = xml.match(/<itunes:image\s+href=["']([^"']+)["']/i) ||
      xml.match(/<image>[\s\S]*?<url>(.*?)<\/url>/i);
    const thumbnail = artworkMatch ? artworkMatch[1].trim() : undefined;

    // Parse items & enclosures
    const episodes: PodcastEpisode[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let itemMatch: RegExpExecArray | null;

    while ((itemMatch = itemRegex.exec(xml)) !== null) {
      const itemXml = itemMatch[1];
      const encMatch = itemXml.match(/<enclosure\s+[^>]*url=["']([^"']+)["'][^>]*>/i);
      if (encMatch) {
        const enclosureUrl = encMatch[1].trim();

        const titleMatch = itemXml.match(/<title[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/title>/i);
        const epTitle = titleMatch ? (titleMatch[1] || titleMatch[2] || "Episode").trim() : "Episode";

        const durMatch = itemXml.match(/<itunes:duration>(.*?)<\/itunes:duration>/i);
        let durationMs: number | undefined;
        if (durMatch) {
          const rawDur = durMatch[1].trim();
          if (/^\d+$/.test(rawDur)) {
            durationMs = parseInt(rawDur, 10) * 1000;
          } else if (rawDur.includes(":")) {
            const parts = rawDur.split(":").map(Number);
            if (parts.length === 3) durationMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
            else if (parts.length === 2) durationMs = (parts[0] * 60 + parts[1]) * 1000;
          }
        }

        const epArtMatch = itemXml.match(/<itunes:image\s+href=["']([^"']+)["']/i);
        const epArtwork = epArtMatch ? epArtMatch[1].trim() : thumbnail;

        episodes.push({
          title: SourceResolver.sanitize(epTitle),
          enclosureUrl,
          durationMs,
          artwork: epArtwork,
        });
      }
    }

    if (episodes.length > 0) {
      return {
        kind: "podcast",
        provider: "podcast",
        sourceRef: episodes[0].enclosureUrl,
        title: SourceResolver.sanitize(feedTitle),
        author: author ? SourceResolver.sanitize(author) : undefined,
        thumbnail,
        durationMs: episodes[0].durationMs,
        embedAllowed: true,
        controllable: "full",
        warnings,
        episodes,
      };
    }

    return null;
  }

  // --- Step 4: oEmbed Discovery & Open Graph / Twitter Player ---
  private async resolveEmbed(
    html: string,
    baseUrl: URL,
    frameAllowed: boolean,
    warnings: string[]
  ): Promise<SourceDescriptor | null> {
    // 1. oEmbed discovery
    const oembedMatch = html.match(
      /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/json\+oembed["'][^>]+href=["']([^"']+)["']/i
    ) || html.match(
      /<link[^>]+type=["']application\/json\+oembed["'][^>]+href=["']([^"']+)["']/i
    );

    if (oembedMatch) {
      const oembedUrl = new URL(oembedMatch[1], baseUrl);
      try {
        const oembedRes = await this.fetchSafe(oembedUrl.toString(), {
          method: "GET",
          accept: "application/json",
        });
        const oembedData = JSON.parse(oembedRes.bodyText);

        const title = oembedData.title || baseUrl.hostname;
        const author = oembedData.author_name;
        const thumbnail = oembedData.thumbnail_url;
        let embedSrc = oembedUrl.toString();

        // Extract iframe src if present
        if (oembedData.html) {
          const iframeSrcMatch = oembedData.html.match(/src=["']([^"']+)["']/i);
          if (iframeSrcMatch) {
            embedSrc = iframeSrcMatch[1];
          }
        }

        return {
          kind: "embed",
          provider: "embed",
          sourceRef: embedSrc,
          title: SourceResolver.sanitize(title),
          author: author ? SourceResolver.sanitize(author) : undefined,
          thumbnail,
          embedAllowed: frameAllowed,
          controllable: "limited",
          warnings,
        };
      } catch (err: any) {
        warnings.push(`oEmbed discovery failed at ${oembedUrl.toString()}: ${err.message}`);
      }
    }

    // 2. Open Graph & Twitter Player tags
    const ogVideo = this.getMetaTag(html, "property", "og:video") ||
      this.getMetaTag(html, "property", "og:video:url") ||
      this.getMetaTag(html, "property", "og:video:secure_url");
    const ogAudio = this.getMetaTag(html, "property", "og:audio") ||
      this.getMetaTag(html, "property", "og:audio:url");
    const twitterPlayer = this.getMetaTag(html, "name", "twitter:player");

    const embedUrl = ogVideo || twitterPlayer || ogAudio;
    if (embedUrl) {
      const title = this.getMetaTag(html, "property", "og:title") ||
        this.getMetaTag(html, "name", "twitter:title") ||
        this.getTitleTag(html) ||
        baseUrl.hostname;
      const thumbnail = this.getMetaTag(html, "property", "og:image") ||
        this.getMetaTag(html, "name", "twitter:image");

      return {
        kind: ogAudio ? "audio" : "embed",
        provider: "embed",
        sourceRef: new URL(embedUrl, baseUrl).toString(),
        title: SourceResolver.sanitize(title),
        thumbnail: thumbnail || undefined,
        embedAllowed: frameAllowed,
        controllable: "limited",
        warnings,
      };
    }

    return null;
  }

  // --- Step 5: Media tags in HTML & JSON-LD ---
  private resolveHtmlMediaTags(
    html: string,
    baseUrl: URL,
    warnings: string[]
  ): SourceDescriptor | null {
    // 1. JSON-LD Structured Data
    const jsonLdRegex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let jsonMatch: RegExpExecArray | null;

    while ((jsonMatch = jsonLdRegex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        const items = Array.isArray(parsed) ? parsed : [parsed];

        for (const item of items) {
          const type = item["@type"];
          if (type === "VideoObject" || type === "AudioObject" || type === "PodcastEpisode") {
            const mediaUrl = item.contentUrl || item.embedUrl;
            if (mediaUrl) {
              const fullMediaUrl = new URL(mediaUrl, baseUrl).toString();
              return {
                kind: type === "AudioObject" ? "audio" : "video",
                provider: "html5",
                sourceRef: fullMediaUrl,
                title: SourceResolver.sanitize(item.name || item.headline || baseUrl.hostname),
                author: item.author?.name ? SourceResolver.sanitize(item.author.name) : undefined,
                thumbnail: item.thumbnailUrl || (Array.isArray(item.thumbnail) ? item.thumbnail[0] : item.thumbnail),
                embedAllowed: true,
                controllable: "full",
                warnings,
              };
            }
          }
        }
      } catch {}
    }

    // 2. Direct <video> or <audio> tags
    const videoTag = html.match(/<video[^>]*src=["']([^"']+)["']/i) ||
      html.match(/<video[^>]*>[\s\S]*?<source[^>]*src=["']([^"']+)["']/i);
    const audioTag = html.match(/<audio[^>]*src=["']([^"']+)["']/i) ||
      html.match(/<audio[^>]*>[\s\S]*?<source[^>]*src=["']([^"']+)["']/i);

    const mediaSrc = videoTag ? videoTag[1] : (audioTag ? audioTag[1] : null);
    if (mediaSrc) {
      const fullUrl = new URL(mediaSrc, baseUrl).toString();
      const title = this.getTitleTag(html) || baseUrl.hostname;
      return {
        kind: videoTag ? "video" : "audio",
        provider: "html5",
        sourceRef: fullUrl,
        title: SourceResolver.sanitize(title),
        embedAllowed: true,
        controllable: "full",
        warnings,
      };
    }

    return null;
  }

  // --- Step 6: Fallback -> "co-browse" Source Type ---
  private resolveCoBrowse(
    html: string,
    baseUrl: URL,
    frameAllowed: boolean,
    warnings: string[]
  ): SourceDescriptor {
    const title = this.getTitleTag(html) ||
      this.getMetaTag(html, "property", "og:title") ||
      baseUrl.hostname;

    const description = this.getMetaTag(html, "name", "description") ||
      this.getMetaTag(html, "property", "og:description");

    const thumbnail = this.getMetaTag(html, "property", "og:image") ||
      this.getMetaTag(html, "name", "twitter:image");

    const iconMatch = html.match(/<link[^>]+rel=["'](?:shortcut\s+)?icon["'][^>]+href=["']([^"']+)["']/i);
    const favicon = iconMatch ? new URL(iconMatch[1], baseUrl).toString() : `${baseUrl.origin}/favicon.ico`;

    const allWarnings = [...warnings];
    allWarnings.push("Site does not provide programmatic media stream. Fallback to co-browse mode.");
    if (!frameAllowed) {
      allWarnings.push("Embedding in iframe forbidden by site headers. Members must browse together externally.");
    }

    return {
      kind: "co-browse",
      provider: "co-browse",
      sourceRef: baseUrl.toString(),
      title: SourceResolver.sanitize(title),
      description: description ? SourceResolver.sanitize(description) : undefined,
      thumbnail: thumbnail || undefined,
      favicon,
      embedAllowed: frameAllowed,
      controllable: "none",
      warnings: allWarnings,
    };
  }

  // --- Helper metadata extractors ---
  private getMetaTag(html: string, keyAttr: "name" | "property", val: string): string | null {
    const regex1 = new RegExp(`<meta[^>]+${keyAttr}=["']${val}["'][^>]+content=["']([^"']+)["']`, "i");
    const regex2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${keyAttr}=["']${val}["']`, "i");

    const match = html.match(regex1) || html.match(regex2);
    return match ? match[1].trim() : null;
  }

  private getTitleTag(html: string): string | null {
    const match = html.match(/<title[^>]*>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/title>/i);
    return match ? (match[1] || match[2] || "").trim() : null;
  }
}
