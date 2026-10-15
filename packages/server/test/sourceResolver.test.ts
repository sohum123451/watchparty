import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import dns from "node:dns/promises";
import { SourceResolver, SecurityError } from "../src/services/SourceResolver.js";

describe("SourceResolver Service", () => {
  let resolver: SourceResolver;

  beforeEach(() => {
    resolver = new SourceResolver({
      timeoutMs: 1000,
      maxRedirects: 3,
      maxResponseBytes: 2 * 1024 * 1024,
    });

    vi.spyOn(dns, "lookup").mockImplementation(async (hostname: string) => {
      if (hostname.includes("rebind") || hostname.includes("localhost") || hostname === "127.0.0.1") {
        return [{ address: "127.0.0.1", family: 4 }];
      }
      if (hostname.includes("metadata") || hostname === "169.254.169.254") {
        return [{ address: "169.254.169.254", family: 4 }];
      }
      if (hostname.includes("internal") || hostname.includes("private") || hostname.includes("local")) {
        return [{ address: "192.168.1.1", family: 4 }];
      }
      return [{ address: "93.184.216.34", family: 4 }];
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("SSRF Protection & Protocol Validation", () => {
    it("should reject non-HTTP protocols", async () => {
      await expect(resolver.resolve("file:///etc/passwd")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("gopher://127.0.0.1:70/")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("ftp://example.com/video.mp4")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("javascript:alert(1)")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("data:text/html,<html></html>")).rejects.toThrow(SecurityError);
    });

    it("should reject loopback address 127.0.0.1 and ::1", async () => {
      await expect(resolver.resolve("http://127.0.0.1/video.mp4")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://127.0.0.2:8080/stream.m3u8")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://[::1]/video.mp4")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://localhost/video.mp4")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://sub.localhost:3000/")).rejects.toThrow(SecurityError);
    });

    it("should reject AWS/Cloud metadata service 169.254.169.254", async () => {
      await expect(resolver.resolve("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://169.254.1.1/video.mp4")).rejects.toThrow(SecurityError);
    });

    it("should reject private RFC 1918 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)", async () => {
      await expect(resolver.resolve("http://10.0.0.1/video.mp4")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://10.254.254.254/video.mp4")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://172.16.0.1/video.mp4")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://172.31.255.255/video.mp4")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://192.168.1.1/video.mp4")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://192.168.0.254/video.mp4")).rejects.toThrow(SecurityError);
    });

    it("should reject IPv6 unique local and link-local addresses", async () => {
      await expect(resolver.resolve("http://[fc00::1]/video.mp4")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://[fd12:3456:789a::1]/")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://[fe80::1]/video.mp4")).rejects.toThrow(SecurityError);
    });

    it("should reject obfuscated numeric and hex IP encodings", async () => {
      // 2130706433 is 127.0.0.1 in decimal integer format
      await expect(resolver.resolve("http://2130706433/video.mp4")).rejects.toThrow(SecurityError);
      // 0x7f000001 is 127.0.0.1 in hex format
      await expect(resolver.resolve("http://0x7f000001/video.mp4")).rejects.toThrow(SecurityError);
      // 017700000001 is octal representation
      await expect(resolver.resolve("http://017700000001/video.mp4")).rejects.toThrow(SecurityError);
    });

    it("should reject internal and local hostnames", async () => {
      await expect(resolver.resolve("http://myhost.local/video.mp4")).rejects.toThrow(SecurityError);
      await expect(resolver.resolve("http://service.internal/video.mp4")).rejects.toThrow(SecurityError);
    });

    it("should block DNS resolution if domain resolves to a private IP (DNS rebinding)", async () => {
      await expect(resolver.resolve("http://rebind.attacker.com/video.mp4")).rejects.toThrow(
        "resolved to blocked private/loopback/link-local address 127.0.0.1"
      );
    });

    it("should block redirects that bounce to internal networks", async () => {
      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response("", {
            status: 302,
            headers: { location: "http://127.0.0.1:8080/secret" },
          });
        }
        return new Response("OK", { status: 200 });
      });

      await expect(resolver.fetchSafe("https://example.com/redirect")).rejects.toThrow(SecurityError);
      fetchSpy.mockRestore();
    });

    it("should enforce a maximum redirect limit of 3", async () => {
      await expect(
        resolver.fetchSafe("https://example.com/loop", { redirectCount: 4 })
      ).rejects.toThrow("Too many redirects");
    });

    it("should cap response size and throw error on responses exceeding maxResponseBytes (2MB)", async () => {
      const hugeBuffer = new Uint8Array(2 * 1024 * 1024 + 1024); // > 2MB
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return new Response(hugeBuffer, { status: 200 });
      });

      await expect(resolver.fetchSafe("https://example.com/huge.html")).rejects.toThrow(
        "Response body size exceeded maximum limit of 2MB"
      );
      fetchSpy.mockRestore();
    });

    it("should handle malformed HTML gracefully without crashing", async () => {
      const malformed = `<<>>>html><<title><<broken <<meta title="xyz"><body><<<broken tags<video src="clip.mp4"`;
      const fetchSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url) => {
        return {
          status: 200,
          headers: new Headers(),
          bodyText: malformed,
          finalUrl: url,
        };
      });

      const res = await resolver.resolve("https://example.com/malformed");
      expect(res).toBeDefined();
      expect(res.provider).toBe("html5"); // discovered video tag
      fetchSpy.mockRestore();
    });
  });

  describe("Pipeline Stage 1: Known Providers", () => {
    it("should resolve YouTube URLs without network requests", async () => {
      const res = await resolver.resolve("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(res.kind).toBe("video");
      expect(res.provider).toBe("youtube");
      expect(res.sourceRef).toBe("dQw4w9WgXcQ");
      expect(res.embedAllowed).toBe(true);
      expect(res.controllable).toBe("full");
      expect(res.thumbnail).toContain("dQw4w9WgXcQ");

      // Short URL
      const shortRes = await resolver.resolve("https://youtu.be/aqz-KE-bpKQ");
      expect(shortRes.provider).toBe("youtube");
      expect(shortRes.sourceRef).toBe("aqz-KE-bpKQ");

      // Embed URL
      const embedRes = await resolver.resolve("https://www.youtube.com/embed/SintelVideoId");
      expect(embedRes.provider).toBe("youtube");
      expect(embedRes.sourceRef).toBe("SintelVideoId");
    });

    it("should resolve Vimeo URLs directly", async () => {
      const res = await resolver.resolve("https://vimeo.com/1084537");
      expect(res.kind).toBe("video");
      expect(res.provider).toBe("vimeo");
      expect(res.sourceRef).toBe("1084537");
      expect(res.embedAllowed).toBe(true);
      expect(res.controllable).toBe("full");
    });

    it("should resolve Twitch channels with limited control", async () => {
      const res = await resolver.resolve("https://twitch.tv/shroud");
      expect(res.kind).toBe("video");
      expect(res.provider).toBe("twitch");
      expect(res.sourceRef).toBe("shroud");
      expect(res.controllable).toBe("limited");
    });

    it("should resolve SoundCloud tracks", async () => {
      const res = await resolver.resolve("https://soundcloud.com/artist/great-track");
      expect(res.kind).toBe("audio");
      expect(res.provider).toBe("soundcloud");
      expect(res.controllable).toBe("limited");
    });
  });

  describe("Pipeline Stage 2: Direct Media URL", () => {
    it("should resolve direct MP4, WebM, and M3U8 files by extension", async () => {
      const mp4Res = await resolver.resolve("https://media.example.com/sample/BigBuckBunny.mp4");
      expect(mp4Res.kind).toBe("video");
      expect(mp4Res.provider).toBe("html5");
      expect(mp4Res.sourceRef).toBe("https://media.example.com/sample/BigBuckBunny.mp4");
      expect(mp4Res.title).toBe("BigBuckBunny.mp4");
      expect(mp4Res.controllable).toBe("full");

      const hlsRes = await resolver.resolve("https://cdn.example.com/live/master.m3u8");
      expect(hlsRes.kind).toBe("video");
      expect(hlsRes.provider).toBe("html5");
    });

    it("should resolve direct MP3 and M4A audio files by extension", async () => {
      const audioRes = await resolver.resolve("https://audio.example.com/episodes/podcast_ep1.mp3");
      expect(audioRes.kind).toBe("audio");
      expect(audioRes.provider).toBe("html5");
      expect(audioRes.sourceRef).toBe("https://audio.example.com/episodes/podcast_ep1.mp3");
      expect(audioRes.controllable).toBe("full");
    });

    it("should resolve direct media via HEAD Content-Type probing", async () => {
      const fetchSafeSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url, opts) => {
        if (opts?.method === "HEAD") {
          const headers = new Headers();
          headers.set("content-type", "video/mp4");
          return {
            status: 200,
            headers,
            bodyText: "",
            finalUrl: url,
          };
        }
        throw new Error("Unexpected call");
      });

      const res = await resolver.resolve("https://stream.example.com/get-stream-blob?token=abc");
      expect(res.kind).toBe("video");
      expect(res.provider).toBe("html5");
      expect(res.controllable).toBe("full");
      fetchSafeSpy.mockRestore();
    });
  });

  describe("Pipeline Stage 3: Podcast Feed Discovery & Parsing", () => {
    it("should discover and parse RSS/Atom podcast feeds with enclosure items", async () => {
      const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>The Tech Watchparty Podcast</title>
    <itunes:author>Jane Doe</itunes:author>
    <itunes:image href="https://example.com/podcast-art.jpg"/>
    <item>
      <title>Episode 1: The Future of Co-Watching</title>
      <enclosure url="https://cdn.example.com/podcasts/ep1.mp3" type="audio/mpeg" length="15420000"/>
      <itunes:duration>00:45:30</itunes:duration>
      <pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Episode 2: Deep Dive into NTP Drift</title>
      <enclosure url="https://cdn.example.com/podcasts/ep2.mp3" type="audio/mpeg" length="18200000"/>
      <itunes:duration>00:52:10</itunes:duration>
    </item>
  </channel>
</rss>`;

      const fetchSafeSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url) => {
        const headers = new Headers();
        headers.set("content-type", "application/rss+xml");
        return {
          status: 200,
          headers,
          bodyText: sampleRss,
          finalUrl: url,
        };
      });

      const res = await resolver.resolve("https://example.com/feed.xml");
      expect(res.kind).toBe("podcast");
      expect(res.provider).toBe("podcast");
      expect(res.title).toBe("The Tech Watchparty Podcast");
      expect(res.author).toBe("Jane Doe");
      expect(res.thumbnail).toBe("https://example.com/podcast-art.jpg");
      expect(res.sourceRef).toBe("https://cdn.example.com/podcasts/ep1.mp3");
      expect(res.episodes).toBeDefined();
      expect(res.episodes?.length).toBe(2);
      expect(res.episodes?.[0].title).toBe("Episode 1: The Future of Co-Watching");
      expect(res.episodes?.[0].durationMs).toBe(2730000); // 45m 30s
      expect(res.controllable).toBe("full");

      fetchSafeSpy.mockRestore();
    });

    it("should discover podcast feed via HTML <link rel='alternate'>", async () => {
      const pageHtml = `<!DOCTYPE html>
<html>
<head>
  <title>My Show Site</title>
  <link rel="alternate" type="application/rss+xml" href="https://example.com/rss.xml" />
</head>
<body><h1>Welcome</h1></body>
</html>`;

      const feedXml = `<rss><channel><title>Alternate Show</title>
        <item><title>Ep 1</title><enclosure url="https://cdn.example.com/show1.mp3" type="audio/mpeg"/></item>
      </channel></rss>`;

      const fetchSafeSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url) => {
        const headers = new Headers();
        if (url.includes("rss.xml")) {
          return { status: 200, headers, bodyText: feedXml, finalUrl: url };
        }
        return { status: 200, headers, bodyText: pageHtml, finalUrl: url };
      });

      const res = await resolver.resolve("https://example.com/my-show");
      expect(res.kind).toBe("podcast");
      expect(res.title).toBe("Alternate Show");
      expect(res.sourceRef).toBe("https://cdn.example.com/show1.mp3");
      fetchSafeSpy.mockRestore();
    });
  });

  describe("Pipeline Stage 4: oEmbed & Open Graph / Twitter Player", () => {
    it("should discover oEmbed and extract rich iframe and title", async () => {
      const pageHtml = `<html><head>
        <title>Article with Embed</title>
        <link rel="alternate" type="application/json+oembed" href="https://example.com/api/oembed" />
      </head><body>Content</body></html>`;

      const oembedJson = JSON.stringify({
        title: "Exclusive Video Feature",
        author_name: "News Studio",
        thumbnail_url: "https://example.com/thumb.jpg",
        html: '<iframe src="https://player.example.com/embed/12345" width="640" height="360"></iframe>',
      });

      const fetchSafeSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url) => {
        const headers = new Headers();
        if (url.includes("oembed")) {
          return { status: 200, headers, bodyText: oembedJson, finalUrl: url };
        }
        return { status: 200, headers, bodyText: pageHtml, finalUrl: url };
      });

      const res = await resolver.resolve("https://example.com/story/123");
      expect(res.kind).toBe("embed");
      expect(res.provider).toBe("embed");
      expect(res.title).toBe("Exclusive Video Feature");
      expect(res.author).toBe("News Studio");
      expect(res.sourceRef).toBe("https://player.example.com/embed/12345");
      expect(res.thumbnail).toBe("https://example.com/thumb.jpg");
      expect(res.controllable).toBe("limited");
      fetchSafeSpy.mockRestore();
    });

    it("should discover Open Graph og:video and twitter:player tags", async () => {
      const pageHtml = `<html><head>
        <meta property="og:title" content="Viral Video Clip" />
        <meta property="og:video" content="https://media.example.com/embed/clip-789" />
        <meta property="og:image" content="https://media.example.com/thumb-789.jpg" />
      </head><body><div>Clip</div></body></html>`;

      const fetchSafeSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url) => {
        return { status: 200, headers: new Headers(), bodyText: pageHtml, finalUrl: url };
      });

      const res = await resolver.resolve("https://example.com/watch-clip");
      expect(res.kind).toBe("embed");
      expect(res.provider).toBe("embed");
      expect(res.title).toBe("Viral Video Clip");
      expect(res.sourceRef).toBe("https://media.example.com/embed/clip-789");
      expect(res.thumbnail).toBe("https://media.example.com/thumb-789.jpg");
      fetchSafeSpy.mockRestore();
    });
  });

  describe("Pipeline Stage 5: Media Tags & JSON-LD VideoObject", () => {
    it("should extract VideoObject from JSON-LD schema", async () => {
      const pageHtml = `<html><head>
        <title>Movie Review Site</title>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "VideoObject",
          "name": "Cinematic Short Trailer",
          "contentUrl": "https://cdn.example.com/trailers/short.mp4",
          "thumbnailUrl": "https://cdn.example.com/trailers/thumb.jpg",
          "author": { "@type": "Person", "name": "Film Director" }
        }
        </script>
      </head><body>Review content</body></html>`;

      const fetchSafeSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url) => {
        return { status: 200, headers: new Headers(), bodyText: pageHtml, finalUrl: url };
      });

      const res = await resolver.resolve("https://example.com/review/short");
      expect(res.kind).toBe("video");
      expect(res.provider).toBe("html5");
      expect(res.title).toBe("Cinematic Short Trailer");
      expect(res.sourceRef).toBe("https://cdn.example.com/trailers/short.mp4");
      expect(res.thumbnail).toBe("https://cdn.example.com/trailers/thumb.jpg");
      expect(res.author).toBe("Film Director");
      expect(res.controllable).toBe("full");
      fetchSafeSpy.mockRestore();
    });

    it("should extract direct HTML5 <video> tags in document", async () => {
      const pageHtml = `<html><head><title>Direct Player Page</title></head>
      <body>
        <video src="https://cdn.example.com/hosted/movie.mp4" controls></video>
      </body></html>`;

      const fetchSafeSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url) => {
        return { status: 200, headers: new Headers(), bodyText: pageHtml, finalUrl: url };
      });

      const res = await resolver.resolve("https://example.com/player");
      expect(res.kind).toBe("video");
      expect(res.provider).toBe("html5");
      expect(res.sourceRef).toBe("https://cdn.example.com/hosted/movie.mp4");
      expect(res.title).toBe("Direct Player Page");
      expect(res.controllable).toBe("full");
      fetchSafeSpy.mockRestore();
    });
  });

  describe("Pipeline Stage 6: Fallback Co-Browse", () => {
    it("should fallback to co-browse with title, description, and favicon", async () => {
      const pageHtml = `<html><head>
        <title>Read Together Article</title>
        <meta name="description" content="An in-depth article on web synchronization." />
        <link rel="icon" href="/assets/favicon.ico" />
        <meta property="og:image" content="https://example.com/hero.jpg" />
      </head><body><p>Article body...</p></body></html>`;

      const fetchSafeSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url) => {
        return { status: 200, headers: new Headers(), bodyText: pageHtml, finalUrl: url };
      });

      const res = await resolver.resolve("https://example.com/article/1");
      expect(res.kind).toBe("co-browse");
      expect(res.provider).toBe("co-browse");
      expect(res.title).toBe("Read Together Article");
      expect(res.description).toContain("An in-depth article");
      expect(res.thumbnail).toBe("https://example.com/hero.jpg");
      expect(res.favicon).toBe("https://example.com/assets/favicon.ico");
      expect(res.controllable).toBe("none");
      expect(res.warnings[0]).toContain("Fallback to co-browse mode");
      fetchSafeSpy.mockRestore();
    });
  });

  describe("Security Headers & Framing Prohibitions", () => {
    it("should mark embedAllowed: false when X-Frame-Options: DENY is returned", async () => {
      const pageHtml = `<html><head><title>Secure Portal</title></head><body>Portal</body></html>`;
      const fetchSafeSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url) => {
        const headers = new Headers();
        headers.set("x-frame-options", "DENY");
        return { status: 200, headers, bodyText: pageHtml, finalUrl: url };
      });

      const res = await resolver.resolve("https://secure.example.com/dashboard");
      expect(res.embedAllowed).toBe(false);
      expect(res.warnings.some((w) => w.includes("X-Frame-Options: DENY"))).toBe(true);
      fetchSafeSpy.mockRestore();
    });

    it("should mark embedAllowed: false when CSP frame-ancestors is 'none'", async () => {
      const pageHtml = `<html><head><title>Restricted Frame</title></head><body>No frame</body></html>`;
      const fetchSafeSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url) => {
        const headers = new Headers();
        headers.set("content-security-policy", "default-src 'self'; frame-ancestors 'none'");
        return { status: 200, headers, bodyText: pageHtml, finalUrl: url };
      });

      const res = await resolver.resolve("https://bank.example.com/account");
      expect(res.embedAllowed).toBe(false);
      expect(res.warnings.some((w) => w.includes("frame-ancestors 'none'"))).toBe(true);
      fetchSafeSpy.mockRestore();
    });

    it("should sanitize untrusted HTML/XSS inside scraped titles and metadata", async () => {
      const maliciousHtml = `<html><head>
        <title><script>alert("pwned")</script>Dangerous & Special "Movie"</title>
        <meta name="description" content="<img src=x onerror=alert(1)>Malicious description">
      </head><body>Body</body></html>`;

      const fetchSafeSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url) => {
        return { status: 200, headers: new Headers(), bodyText: maliciousHtml, finalUrl: url };
      });

      const res = await resolver.resolve("https://example.com/xss");
      expect(res.title).not.toContain("<script>");
      expect(res.title).toContain("&quot;Movie&quot;");
      expect(res.description).not.toContain("<img");
      fetchSafeSpy.mockRestore();
    });
  });

  describe("Robots.txt & Rate Limiting", () => {
    it("should flag warnings when robots.txt disallows crawler path", async () => {
      const targetUrl = new URL("https://example.com/private/vault");
      const checkSpy = vi.spyOn(resolver, "checkRobotsTxt").mockResolvedValue({
        allowed: false,
        warning: "Path '/private/vault' is marked Disallow in https://example.com/robots.txt",
      });

      const pageHtml = `<html><head><title>Private Vault</title></head><body>Vault</body></html>`;
      const fetchSafeSpy = vi.spyOn(resolver, "fetchSafe").mockImplementation(async (url) => {
        return { status: 200, headers: new Headers(), bodyText: pageHtml, finalUrl: url };
      });

      const res = await resolver.resolve(targetUrl.toString());
      expect(res.warnings.some((w) => w.includes("robots.txt"))).toBe(true);

      checkSpy.mockRestore();
      fetchSafeSpy.mockRestore();
    });

    it("should enforce per-user request rate limits", () => {
      const user = "test-user-ip-1";
      for (let i = 0; i < 5; i++) {
        expect(resolver.checkRateLimit(user, 5)).toBe(true);
      }
      // 6th request exceeds limit of 5
      expect(resolver.checkRateLimit(user, 5)).toBe(false);
    });
  });
});
