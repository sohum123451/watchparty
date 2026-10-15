import {
  PodcastFeed,
  PodcastEpisode,
  PodcastChapter,
  PodcastTranscriptCue,
} from "./PodcastTypes.js";

export class PodcastFeedParser {
  /**
   * Parses an RSS feed XML string into a structured PodcastFeed object.
   * Works in both browser (DOMParser) and Node.js environments (regex fallback).
   */
  public static parseFeed(xml: string, feedUrl?: string): PodcastFeed {
    const isBrowser = typeof window !== "undefined" && typeof (window as any).DOMParser !== "undefined";
    if (isBrowser) {
      try {
        return this.parseFeedWithDomParser(xml, feedUrl);
      } catch (err) {
        // Fall back to regex parser if DOMParser fails or produces an error document
      }
    }
    return this.parseFeedWithRegex(xml, feedUrl);
  }

  private static parseFeedWithDomParser(xml: string, feedUrl?: string): PodcastFeed {
    const parser = new (window as any).DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      throw new Error(`XML parsing error: ${parserError.textContent}`);
    }

    const channel = doc.querySelector("channel") || doc;
    const feedTitle = this.getElementText(channel, "title") || "Untitled Podcast";
    const feedDesc = this.getElementText(channel, "description") || "";
    const feedAuthor =
      this.getElementText(channel, "itunes\\:author, author, dc\\:creator") || "";
    const feedLink = this.getElementText(channel, "link") || "";
    const feedArtwork =
      this.getElementAttribute(channel, "itunes\\:image", "href") ||
      this.getElementText(channel, "image > url") ||
      "";
    const feedLang = this.getElementText(channel, "language") || "en";

    const itemNodes = doc.querySelectorAll("item");
    const episodes: PodcastEpisode[] = [];

    itemNodes.forEach((item: Element, index: number) => {
      const enclosure = item.querySelector("enclosure");
      const enclosureUrl = enclosure ? enclosure.getAttribute("url") || "" : "";
      if (!enclosureUrl) {
        return; // Skip items with no audio enclosure
      }

      const enclosureType = enclosure ? enclosure.getAttribute("type") || "audio/mpeg" : "audio/mpeg";
      const lengthAttr = enclosure ? enclosure.getAttribute("length") : null;
      const enclosureLength = lengthAttr ? parseInt(lengthAttr, 10) : undefined;

      const title = this.getElementText(item, "title") || `Episode ${index + 1}`;
      const guid = this.getElementText(item, "guid") || enclosureUrl;
      const pubDate = this.getElementText(item, "pubDate") || "";
      const description =
        this.getElementText(item, "content\\:encoded") ||
        this.getElementText(item, "description") ||
        this.getElementText(item, "itunes\\:summary") ||
        "";
      const episodeLink = this.getElementText(item, "link") || feedLink;
      const artworkUrl =
        this.getElementAttribute(item, "itunes\\:image", "href") || feedArtwork;

      const durationStr = this.getElementText(item, "itunes\\:duration") || "";
      const durationMs = this.parseDurationToMs(durationStr);

      // Podcasting 2.0 Tags
      const chaptersNode = item.querySelector("podcast\\:chapters, chapters");
      const chaptersUrl = chaptersNode ? chaptersNode.getAttribute("url") || undefined : undefined;

      const transcriptNode = item.querySelector("podcast\\:transcript, transcript");
      const transcriptUrl = transcriptNode ? transcriptNode.getAttribute("url") || undefined : undefined;
      const transcriptType = transcriptNode ? transcriptNode.getAttribute("type") || "text/vtt" : undefined;

      // Extract show notes timestamped chapters if no external chapters URL
      const chapters = this.extractTimestampedChaptersFromText(description);

      episodes.push({
        guid,
        title,
        enclosureUrl,
        enclosureType,
        enclosureLength,
        durationMs,
        pubDate,
        description,
        episodeLink,
        artworkUrl,
        chaptersUrl,
        transcriptUrl,
        transcriptType,
        chapters: chapters.length > 0 ? chapters : undefined,
        podcastTitle: feedTitle,
        podcastAuthor: feedAuthor,
        podcastLink: feedLink,
      });
    });

    return {
      title: feedTitle,
      description: feedDesc,
      author: feedAuthor,
      link: feedLink,
      feedUrl,
      artworkUrl: feedArtwork,
      language: feedLang,
      episodes,
    };
  }

  private static getElementText(parent: Element, selector: string): string {
    const el = parent.querySelector(selector);
    return el ? (el.textContent || "").trim() : "";
  }

  private static getElementAttribute(parent: Element, selector: string, attr: string): string {
    const el = parent.querySelector(selector);
    return el ? (el.getAttribute(attr) || "").trim() : "";
  }

  /**
   * Pure regex-based parser for Node.js / unit tests without DOMParser.
   */
  public static parseFeedWithRegex(xml: string, feedUrl?: string): PodcastFeed {
    const channelMatch = xml.match(/<channel[\s\S]*?<\/channel>/i);
    const channelContent = channelMatch ? channelMatch[0] : xml;

    // Channel metadata
    const feedTitle = this.extractXmlTag(channelContent, "title") || "Untitled Podcast";
    const feedDesc = this.extractXmlTag(channelContent, "description") || "";
    const feedAuthor =
      this.extractXmlTag(channelContent, "itunes:author") ||
      this.extractXmlTag(channelContent, "author") ||
      this.extractXmlTag(channelContent, "dc:creator") ||
      "";
    const feedLink = this.extractXmlTag(channelContent, "link") || "";
    const itunesImgMatch = channelContent.match(/<itunes:image[^>]*href=["']([^"']+)["']/i);
    const imgUrlMatch = channelContent.match(/<image>[\s\S]*?<url>([^<]+)<\/url>[\s\S]*?<\/image>/i);
    const feedArtwork = itunesImgMatch ? itunesImgMatch[1] : imgUrlMatch ? imgUrlMatch[1].trim() : "";
    const feedLang = this.extractXmlTag(channelContent, "language") || "en";

    // Episodes (<item>...</item>)
    const episodes: PodcastEpisode[] = [];
    const itemRegex = /<item[\s\S]*?<\/item>/gi;
    let match: RegExpExecArray | null;
    let index = 1;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[0];

      // Enclosure
      const encMatch = itemXml.match(/<enclosure([^>]+)\/?>/i);
      if (!encMatch) continue;

      const encAttrs = encMatch[1];
      const urlMatch = encAttrs.match(/url=["']([^"']+)["']/i);
      if (!urlMatch) continue;
      const enclosureUrl = urlMatch[1];

      const typeMatch = encAttrs.match(/type=["']([^"']+)["']/i);
      const enclosureType = typeMatch ? typeMatch[1] : "audio/mpeg";

      const lenMatch = encAttrs.match(/length=["']([^"']+)["']/i);
      const enclosureLength = lenMatch ? parseInt(lenMatch[1], 10) : undefined;

      const title = this.extractXmlTag(itemXml, "title") || `Episode ${index}`;
      const guid = this.extractXmlTag(itemXml, "guid") || enclosureUrl;
      const pubDate = this.extractXmlTag(itemXml, "pubDate") || "";
      const description =
        this.extractXmlTag(itemXml, "content:encoded") ||
        this.extractXmlTag(itemXml, "description") ||
        this.extractXmlTag(itemXml, "itunes:summary") ||
        "";
      const episodeLink = this.extractXmlTag(itemXml, "link") || feedLink;

      const epImgMatch = itemXml.match(/<itunes:image[^>]*href=["']([^"']+)["']/i);
      const artworkUrl = epImgMatch ? epImgMatch[1] : feedArtwork;

      const durationStr = this.extractXmlTag(itemXml, "itunes:duration") || "";
      const durationMs = this.parseDurationToMs(durationStr);

      // Podcasting 2.0 chapters tag: <podcast:chapters url="..." type="application/json"/>
      const chapMatch = itemXml.match(/<podcast:chapters[^>]*url=["']([^"']+)["'][^>]*>/i);
      const chaptersUrl = chapMatch ? chapMatch[1] : undefined;

      // Podcasting 2.0 transcript tag: <podcast:transcript url="..." type="..."/>
      const transMatch = itemXml.match(/<podcast:transcript[^>]*url=["']([^"']+)["'][^>]*>/i);
      const transcriptUrl = transMatch ? transMatch[1] : undefined;
      const typeTransMatch = itemXml.match(/<podcast:transcript[^>]*type=["']([^"']+)["'][^>]*>/i);
      const transcriptType = typeTransMatch ? typeTransMatch[1] : "text/vtt";

      const chapters = this.extractTimestampedChaptersFromText(description);

      episodes.push({
        guid,
        title,
        enclosureUrl,
        enclosureType,
        enclosureLength,
        durationMs,
        pubDate,
        description,
        episodeLink,
        artworkUrl,
        chaptersUrl,
        transcriptUrl,
        transcriptType,
        chapters: chapters.length > 0 ? chapters : undefined,
        podcastTitle: feedTitle,
        podcastAuthor: feedAuthor,
        podcastLink: feedLink,
      });

      index++;
    }

    return {
      title: feedTitle,
      description: feedDesc,
      author: feedAuthor,
      link: feedLink,
      feedUrl,
      artworkUrl: feedArtwork,
      language: feedLang,
      episodes,
    };
  }

  public static decodeHtmlEntities(str: string): string {
    if (!str) return "";
    return str
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");
  }

  private static extractXmlTag(xml: string, tag: string): string {
    const escapedTag = tag.replace(":", "\\:");
    // Match CDATA or plain text
    const cdataRegex = new RegExp(`<${escapedTag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${escapedTag}>`, "i");
    const cdataMatch = xml.match(cdataRegex);
    if (cdataMatch) {
      return this.decodeHtmlEntities(cdataMatch[1].trim());
    }

    const plainRegex = new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i");
    const plainMatch = xml.match(plainRegex);
    if (plainMatch) {
      return this.decodeHtmlEntities(plainMatch[1].trim());
    }
    return "";
  }

  /**
   * Converts duration string (seconds, MM:SS, HH:MM:SS) to milliseconds.
   */
  public static parseDurationToMs(durationStr: string): number {
    const str = (durationStr || "").trim();
    if (!str) return 0;

    // Check if integer seconds
    if (/^\d+$/.test(str)) {
      return parseInt(str, 10) * 1000;
    }

    // HH:MM:SS or MM:SS or HH:MM:SS.mmm
    const parts = str.split(":");
    if (parts.length === 3) {
      const hours = parseFloat(parts[0]) || 0;
      const minutes = parseFloat(parts[1]) || 0;
      const seconds = parseFloat(parts[2]) || 0;
      return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
    } else if (parts.length === 2) {
      const minutes = parseFloat(parts[0]) || 0;
      const seconds = parseFloat(parts[1]) || 0;
      return Math.round((minutes * 60 + seconds) * 1000);
    }

    const num = parseFloat(str);
    return isNaN(num) ? 0 : Math.round(num * 1000);
  }

  /**
   * Parses Podcasting 2.0 JSON chapters specification.
   * Specification: { version: "1.2.0", chapters: [ { startTime: 0, title: "Intro", img?: "...", url?: "..." } ] }
   */
  public static parseChaptersJson(jsonStr: string): PodcastChapter[] {
    try {
      const data = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
      const rawChapters: any[] = Array.isArray(data) ? data : data.chapters || [];
      const result: PodcastChapter[] = [];

      for (let i = 0; i < rawChapters.length; i++) {
        const item = rawChapters[i];
        const rawStart = item.startTime ?? item.start ?? 0;
        const startTimeMs = typeof rawStart === "string" ? this.parseDurationToMs(rawStart) : Math.round(rawStart * 1000);
        const title = item.title || `Chapter ${i + 1}`;
        const img = item.img || item.image || undefined;
        const url = item.url || undefined;

        let endTimeMs: number | undefined;
        if (item.endTime != null) {
          endTimeMs = typeof item.endTime === "string" ? this.parseDurationToMs(item.endTime) : Math.round(item.endTime * 1000);
        } else if (i + 1 < rawChapters.length) {
          const nextStart = rawChapters[i + 1].startTime ?? rawChapters[i + 1].start ?? 0;
          endTimeMs = typeof nextStart === "string" ? this.parseDurationToMs(nextStart) : Math.round(nextStart * 1000);
        }

        result.push({
          startTimeMs,
          endTimeMs,
          title,
          img,
          url,
        });
      }

      return result.sort((a, b) => a.startTimeMs - b.startTimeMs);
    } catch (err) {
      console.warn("[PodcastFeedParser] Failed to parse chapters JSON:", err);
      return [];
    }
  }

  /**
   * Extracts timestamped chapters from show notes/description text.
   * Matches lines like:
   * "00:00 - Introduction"
   * "(04:15) Architecture Deep Dive"
   * "[12:30] Web Audio API and Visualizers"
   * "1:05:00 Wrap up"
   */
  public static extractTimestampedChaptersFromText(text: string): PodcastChapter[] {
    if (!text) return [];

    // Strip HTML tags for clean text extraction
    const cleanText = text.replace(/<[^>]+>/g, "\n");
    const lines = cleanText.split(/\r?\n/);
    const parsed: Array<{ startTimeMs: number; title: string }> = [];

    // Regex for: optional brackets/parens, timestamp (MM:SS or HH:MM:SS), optional separator (- : —), chapter title
    const lineRegex = /^\s*[\(\[]?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[\)\]]?\s*[-–—:]?\s*(.+)$/i;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const match = line.match(lineRegex);
      if (match) {
        const timeStr = match[1];
        const rawTitle = match[2].trim();
        // Clean up title (remove trailing markdown/links or tags) and unescape entities
        const title = this.decodeHtmlEntities(rawTitle.replace(/^[-–—:]\s*/, "").replace(/[<\[\(].*$/, "").trim());
        if (title.length > 0) {
          const startTimeMs = this.parseDurationToMs(timeStr);
          parsed.push({ startTimeMs, title });
        }
      }
    }

    if (parsed.length === 0) {
      return [];
    }

    // Sort by timestamp
    parsed.sort((a, b) => a.startTimeMs - b.startTimeMs);

    // Build final chapters with endTimeMs set to next chapter's start
    const chapters: PodcastChapter[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const cur = parsed[i];
      const next = parsed[i + 1];
      chapters.push({
        startTimeMs: cur.startTimeMs,
        endTimeMs: next ? next.startTimeMs : undefined,
        title: cur.title,
      });
    }

    return chapters;
  }

  /**
   * Parses transcripts in WebVTT, SRT, or JSON format.
   */
  public static parseTranscript(content: string, mimeOrType?: string): PodcastTranscriptCue[] {
    if (!content) return [];
    const trimmed = content.trim();

    // JSON Transcript
    if (
      (mimeOrType && mimeOrType.includes("json")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const data = JSON.parse(trimmed);
        const cues: PodcastTranscriptCue[] = [];
        const rawList = Array.isArray(data) ? data : data.segments || data.cues || data.transcripts || [];

        for (const item of rawList) {
          const rawStart = item.startTime ?? item.start ?? item.start_time ?? 0;
          const rawEnd = item.endTime ?? item.end ?? item.end_time ?? rawStart + 3;
          const startTimeMs = typeof rawStart === "string" ? this.parseDurationToMs(rawStart) : Math.round(rawStart * 1000);
          const endTimeMs = typeof rawEnd === "string" ? this.parseDurationToMs(rawEnd) : Math.round(rawEnd * 1000);
          const text = (item.text || item.body || item.content || "").trim();
          const speaker = item.speaker || item.voice || undefined;

          if (text) {
            cues.push({ startTimeMs, endTimeMs, text, speaker });
          }
        }
        return cues.sort((a, b) => a.startTimeMs - b.startTimeMs);
      } catch (e) {
        // Fall back to text parsing if JSON parse failed
      }
    }

    // WebVTT or SRT Parser
    return this.parseVttOrSrt(trimmed);
  }

  private static parseVttOrSrt(text: string): PodcastTranscriptCue[] {
    const cues: PodcastTranscriptCue[] = [];
    // Normalize newlines
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    // Split into cue blocks separated by blank lines
    const blocks = normalized.split(/\n\s*\n/);

    // Timestamp line regex:
    // e.g. "00:01:20.000 --> 00:01:24.500" or "01:20.000 --> 01:24.500" or "00:01:20,000 --> 00:01:24,500"
    const timeRegex = /((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{2,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{2,3})/;

    for (const block of blocks) {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      let timeLineIdx = -1;
      let match: RegExpMatchArray | null = null;

      for (let i = 0; i < lines.length; i++) {
        match = lines[i].match(timeRegex);
        if (match) {
          timeLineIdx = i;
          break;
        }
      }

      if (timeLineIdx === -1 || !match) continue;

      const startTimeMs = this.parseVttTimestampToMs(match[1]);
      const endTimeMs = this.parseVttTimestampToMs(match[2]);

      const textLines = lines.slice(timeLineIdx + 1);
      if (textLines.length === 0) continue;

      let rawText = textLines.join(" ");
      // Check for voice/speaker tags like <v Alice>Hello</v> or Alice: Hello
      let speaker: string | undefined;
      const vTagMatch = rawText.match(/<v\s+([^>]+)>(.*?)<\/v>/i);
      if (vTagMatch) {
        speaker = vTagMatch[1].trim();
        rawText = vTagMatch[2].trim();
      } else {
        const speakerColonMatch = rawText.match(/^([A-Z][a-zA-Z0-9\s]{1,20}):\s+(.*)$/);
        if (speakerColonMatch) {
          speaker = speakerColonMatch[1].trim();
          rawText = speakerColonMatch[2].trim();
        }
      }

      // Strip any other HTML tags
      const cleanText = rawText.replace(/<[^>]+>/g, "").trim();
      if (cleanText) {
        cues.push({
          startTimeMs,
          endTimeMs,
          text: cleanText,
          speaker,
        });
      }
    }

    return cues.sort((a, b) => a.startTimeMs - b.startTimeMs);
  }

  private static parseVttTimestampToMs(timeStr: string): number {
    const cleaned = timeStr.replace(",", ".");
    const parts = cleaned.split(":");
    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    if (parts.length === 3) {
      hours = parseFloat(parts[0]) || 0;
      minutes = parseFloat(parts[1]) || 0;
      seconds = parseFloat(parts[2]) || 0;
    } else if (parts.length === 2) {
      minutes = parseFloat(parts[0]) || 0;
      seconds = parseFloat(parts[1]) || 0;
    }

    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  }
}
