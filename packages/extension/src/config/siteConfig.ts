export interface SiteRule {
  id: string;
  name: string;
  hostPatterns: RegExp[];
  videoSelector: string;
  containerSelector: string;
  titleSelector?: string;
  seekToleranceMs?: number;
  isSPA: boolean;
}

export const SITE_RULES: SiteRule[] = [
  {
    id: "netflix",
    name: "Netflix",
    hostPatterns: [/^(.+\.)?netflix\.com$/i],
    videoSelector: ".watch-video--player-view video, video",
    containerSelector: ".watch-video--player-view, .sizing-wrapper, body",
    titleSelector: ".video-title h4, [data-uia='video-title']",
    seekToleranceMs: 250,
    isSPA: true
  },
  {
    id: "disneyplus",
    name: "Disney+",
    hostPatterns: [/^(.+\.)?disneyplus\.com$/i],
    videoSelector: ".btm-media-client-element video, video",
    containerSelector: ".btm-media-client-element, .video-player-container, body",
    titleSelector: ".title-field, h1",
    seekToleranceMs: 200,
    isSPA: true
  },
  {
    id: "primevideo",
    name: "Prime Video",
    hostPatterns: [/^(.+\.)?primevideo\.com$/i, /^(.+\.)?amazon\.[a-z.]+\/gp\/video/i],
    videoSelector: ".webPlayerContainer video, .rendererContainer video, video",
    containerSelector: ".webPlayerContainer, .rendererContainer, body",
    titleSelector: ".fg74yhh, .atvwebplayersdk-title-text",
    seekToleranceMs: 200,
    isSPA: true
  },
  {
    id: "youtube",
    name: "YouTube",
    hostPatterns: [/^(.+\.)?youtube\.com$/i],
    videoSelector: "video.html5-main-video, #movie_player video, video",
    containerSelector: "#movie_player, #player, body",
    titleSelector: "h1.ytd-watch-metadata, #title h1",
    seekToleranceMs: 100,
    isSPA: true
  },
  {
    id: "hulu",
    name: "Hulu",
    hostPatterns: [/^(.+\.)?hulu\.com$/i],
    videoSelector: ".PlayerContainer video, video",
    containerSelector: ".PlayerContainer, .Player, body",
    titleSelector: ".player-meta-title",
    seekToleranceMs: 200,
    isSPA: true
  },
  {
    id: "max",
    name: "Max",
    hostPatterns: [/^(.+\.)?max\.com$/i, /^(.+\.)?hbomax\.com$/i],
    videoSelector: "[data-testid='player-container'] video, video",
    containerSelector: "[data-testid='player-container'], body",
    titleSelector: "[data-testid='player-title']",
    seekToleranceMs: 200,
    isSPA: true
  },
  {
    id: "generic",
    name: "Web Player",
    hostPatterns: [/.+/],
    videoSelector: "video",
    containerSelector: "body",
    seekToleranceMs: 150,
    isSPA: true
  }
];

export function getSiteRuleForUrl(url: string): SiteRule {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    for (const rule of SITE_RULES) {
      if (rule.hostPatterns.some((pattern) => pattern.test(hostname) || pattern.test(url))) {
        return rule;
      }
    }
  } catch {
    // ignore
  }
  return SITE_RULES[SITE_RULES.length - 1]; // Fallback generic
}
