import { describe, it, expect } from "vitest";
import { getSiteRuleForUrl, SITE_RULES } from "../src/config/siteConfig.js";

describe("Extension Site Configuration", () => {
  it("should match Netflix URL correctly", () => {
    const rule = getSiteRuleForUrl("https://www.netflix.com/watch/80057281");
    expect(rule.id).toBe("netflix");
    expect(rule.name).toBe("Netflix");
    expect(rule.videoSelector).toContain("video");
    expect(rule.isSPA).toBe(true);
  });

  it("should match Disney+ URL correctly", () => {
    const rule = getSiteRuleForUrl("https://www.disneyplus.com/video/12345");
    expect(rule.id).toBe("disneyplus");
    expect(rule.name).toBe("Disney+");
    expect(rule.videoSelector).toContain(".btm-media-client-element video");
  });

  it("should match Prime Video URLs correctly", () => {
    const rule1 = getSiteRuleForUrl("https://www.primevideo.com/detail/0S0M3EXAMPLE");
    expect(rule1.id).toBe("primevideo");

    const rule2 = getSiteRuleForUrl("https://www.amazon.com/gp/video/detail/B0EXAMPLE");
    expect(rule2.id).toBe("primevideo");
  });

  it("should match YouTube URL correctly", () => {
    const rule = getSiteRuleForUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(rule.id).toBe("youtube");
    expect(rule.name).toBe("YouTube");
    expect(rule.videoSelector).toContain("video.html5-main-video");
  });

  it("should match Hulu URL correctly", () => {
    const rule = getSiteRuleForUrl("https://www.hulu.com/watch/999888");
    expect(rule.id).toBe("hulu");
    expect(rule.name).toBe("Hulu");
  });

  it("should match Max (HBO) URL correctly", () => {
    const rule1 = getSiteRuleForUrl("https://play.max.com/video/watch/123");
    expect(rule1.id).toBe("max");

    const rule2 = getSiteRuleForUrl("https://play.hbomax.com/page/urn:hbo:page:home");
    expect(rule2.id).toBe("max");
  });

  it("should fallback to generic Web Player for other URLs", () => {
    const rule = getSiteRuleForUrl("https://my-custom-streaming.tv/play");
    expect(rule.id).toBe("generic");
    expect(rule.name).toBe("Web Player");
    expect(rule.videoSelector).toBe("video");
  });
});
