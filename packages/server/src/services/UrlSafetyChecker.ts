import {
  UrlSafetyReport,
  UrlSafetyLevel,
  SourceBlocklistRule,
} from "@watchparty/shared";

export interface UrlSafetyCheckerOptions {
  googleSafeBrowsingApiKey?: string;
  enableGoogleSafeBrowsing?: boolean;
  timeoutMs?: number;
}

export class UrlSafetyChecker {
  private googleSafeBrowsingApiKey?: string;
  private enableGoogleSafeBrowsing: boolean;
  private timeoutMs: number;

  // Platform-level global blocklist of known phishing, malware, scam domains
  private platformBlocklist: Set<string> = new Set([
    "malware.wicar.org",
    "testsafebrowsing.appspot.com",
    "ianfette.org",
    "phishing-test-bank.com",
    "crypto-drainer.xyz",
    "free-nitro-scam.info",
    "bad-malware-site.com",
    "malicious-domain.test",
    "known-exploit-kit.com",
    "phishingsite.example.com",
  ]);

  // Verified trusted media origin domains (always safe unless explicitly blocked)
  private verifiedOrigins: Set<string> = new Set([
    "youtube.com",
    "youtu.be",
    "vimeo.com",
    "soundcloud.com",
    "twitch.tv",
    "spotify.com",
    "archive.org",
    "wikimedia.org",
    "blender.org",
    "commondatastorage.googleapis.com",
  ]);

  // In-memory mock threat registry for unit/integration testing
  private mockThreats: Map<string, string[]> = new Map();

  constructor(options: UrlSafetyCheckerOptions = {}) {
    this.googleSafeBrowsingApiKey =
      options.googleSafeBrowsingApiKey || process.env.GOOGLE_SAFE_BROWSING_API_KEY;
    this.enableGoogleSafeBrowsing =
      options.enableGoogleSafeBrowsing ?? Boolean(this.googleSafeBrowsingApiKey);
    this.timeoutMs = options.timeoutMs ?? 4000;
  }

  /**
   * Normalize and extract canonical hostname/domain from a URL string
   */
  public extractDomain(urlString: string): string {
    try {
      const parsed = new URL(urlString);
      let host = parsed.hostname.toLowerCase().trim();
      if (host.startsWith("www.")) {
        host = host.slice(4);
      }
      return host;
    } catch {
      return urlString.toLowerCase().trim();
    }
  }

  /**
   * Check if a domain or URL matches a blocklist pattern (exact or wildcard *.example.com)
   */
  public matchesPattern(domain: string, pattern: string): boolean {
    const cleanPattern = pattern.toLowerCase().trim().replace(/^https?:\/\//, "");
    const cleanDomain = domain.toLowerCase().trim();

    // Exact domain match
    if (cleanDomain === cleanPattern) return true;

    // Wildcard match, e.g. *.malicious.com or .malicious.com
    if (cleanPattern.startsWith("*.")) {
      const base = cleanPattern.slice(2);
      return cleanDomain === base || cleanDomain.endsWith("." + base);
    }
    if (cleanPattern.startsWith(".")) {
      const base = cleanPattern.slice(1);
      return cleanDomain === base || cleanDomain.endsWith("." + base);
    }

    // Subdomain match: e.g. pattern "malicious.com" matches "sub.malicious.com"
    if (cleanDomain.endsWith("." + cleanPattern)) return true;

    return false;
  }

  /**
   * Add a pattern to the platform-wide blocklist
   */
  public addPlatformBlockedPattern(pattern: string): void {
    this.platformBlocklist.add(pattern.toLowerCase().trim());
  }

  /**
   * Remove a pattern from the platform-wide blocklist
   */
  public removePlatformBlockedPattern(pattern: string): void {
    this.platformBlocklist.delete(pattern.toLowerCase().trim());
  }

  /**
   * Retrieve all platform blocked patterns
   */
  public getPlatformBlocklist(): string[] {
    return Array.from(this.platformBlocklist);
  }

  /**
   * Set mock Safe Browsing threat responses for testing
   */
  public setMockThreat(urlOrDomain: string, threats: string[]): void {
    this.mockThreats.set(urlOrDomain.toLowerCase().trim(), threats);
  }

  /**
   * Clear mock Safe Browsing threat responses
   */
  public clearMockThreats(): void {
    this.mockThreats.clear();
  }

  /**
   * Query Google Safe Browsing API v4
   */
  public async queryGoogleSafeBrowsing(url: string): Promise<string[] | null> {
    const domain = this.extractDomain(url);

    // Check mock threats first (for testing or offline environments)
    if (this.mockThreats.has(url.toLowerCase().trim())) {
      return this.mockThreats.get(url.toLowerCase().trim())!;
    }
    if (this.mockThreats.has(domain)) {
      return this.mockThreats.get(domain)!;
    }

    if (!this.enableGoogleSafeBrowsing || !this.googleSafeBrowsingApiKey) {
      return null;
    }

    try {
      const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(
        this.googleSafeBrowsingApiKey
      )}`;

      const body = {
        client: {
          clientId: "watchparty-platform",
          clientVersion: "1.0.0",
        },
        threatInfo: {
          threatTypes: [
            "MALWARE",
            "SOCIAL_ENGINEERING",
            "UNWANTED_SOFTWARE",
            "POTENTIALLY_HARMFUL_APPLICATION",
          ],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url }],
        },
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        return null;
      }

      const data: any = await res.json();
      if (data && data.matches && Array.isArray(data.matches) && data.matches.length > 0) {
        return data.matches.map((m: any) => m.threatType || "MALWARE");
      }

      return [];
    } catch {
      // Fail open to local check on network or API error
      return null;
    }
  }

  /**
   * Run full malicious URL & blocklist check
   */
  public async checkUrl(
    urlString: string,
    roomBlocklist?: SourceBlocklistRule[]
  ): Promise<UrlSafetyReport> {
    const now = Date.now();
    let parsed: URL;

    try {
      parsed = new URL(urlString);
    } catch {
      return {
        url: urlString,
        domain: urlString,
        safetyLevel: "blocked",
        threatTypes: ["MALFORMED_URL"],
        isSafe: false,
        warning: "Invalid or malformed URL syntax",
        sourceCheck: "local_blocklist",
        scannedAt: now,
      };
    }

    const domain = this.extractDomain(urlString);

    // 1. Check Room-Level Custom Blocklist
    if (roomBlocklist && roomBlocklist.length > 0) {
      for (const rule of roomBlocklist) {
        if (this.matchesPattern(domain, rule.pattern) || urlString.includes(rule.pattern)) {
          return {
            url: urlString,
            domain,
            safetyLevel: "blocked",
            threatTypes: ["ROOM_BLOCKLIST"],
            isSafe: false,
            warning: rule.reason || "This domain is on the room host's blocklist.",
            sourceCheck: "room_blocklist",
            scannedAt: now,
          };
        }
      }
    }

    // 2. Check Platform-Level Global Blocklist
    for (const pattern of this.platformBlocklist) {
      if (this.matchesPattern(domain, pattern) || urlString.includes(pattern)) {
        return {
          url: urlString,
          domain,
          safetyLevel: "malicious",
          threatTypes: ["PLATFORM_BLOCKLIST", "KNOWN_MALWARE_OR_PHISHING"],
          isSafe: false,
          warning: "Domain is flagged on the platform security blocklist for malicious content.",
          sourceCheck: "local_blocklist",
          scannedAt: now,
        };
      }
    }

    // 3. Query Google Safe Browsing (or Mock)
    const gsbThreats = await this.queryGoogleSafeBrowsing(urlString);
    if (gsbThreats && gsbThreats.length > 0) {
      return {
        url: urlString,
        domain,
        safetyLevel: "malicious",
        threatTypes: gsbThreats,
        isSafe: false,
        warning: `Flagged by Google Safe Browsing: ${gsbThreats.join(", ")}`,
        sourceCheck: "google_safe_browsing",
        scannedAt: now,
      };
    }

    // 4. Check for Verified Known Safe Origins
    for (const origin of this.verifiedOrigins) {
      if (domain === origin || domain.endsWith("." + origin)) {
        return {
          url: urlString,
          domain,
          safetyLevel: "safe",
          threatTypes: [],
          isSafe: true,
          sourceCheck: "verified_origin",
          scannedAt: now,
        };
      }
    }

    // 5. Heuristic checks for unencrypted HTTP or suspicious patterns
    if (parsed.protocol === "http:") {
      return {
        url: urlString,
        domain,
        safetyLevel: "suspicious",
        threatTypes: ["UNENCRYPTED_HTTP"],
        isSafe: true,
        warning: "This URL uses unencrypted plain HTTP. Exercise caution.",
        sourceCheck: "heuristics",
        scannedAt: now,
      };
    }

    // Clean, verified TLS external URL
    return {
      url: urlString,
      domain,
      safetyLevel: "safe",
      threatTypes: [],
      isSafe: true,
      sourceCheck: gsbThreats !== null ? "google_safe_browsing" : "local_blocklist",
      scannedAt: now,
    };
  }
}

export const defaultUrlSafetyChecker = new UrlSafetyChecker();
