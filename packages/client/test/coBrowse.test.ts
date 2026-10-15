import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TextQuoteAnchor,
  CoBrowseManager,
  CoBrowseAdapter,
  AdapterFactory,
} from "../src/index.js";
import {
  RelativeReadingPosition,
  W3CTextQuoteSelector,
  SharedHighlight,
  StickyComment,
  MemberReadingPresence,
  CoBrowseMediaState,
} from "@watchparty/shared";

describe("Co-Browse Synchronization & Reading Engine", () => {
  describe("TextQuoteAnchor & W3C Text Quote Selectors", () => {
    it("should compute relative reading position against DOM elements", () => {
      // Mock DOM document
      const mockH1 = {
        tagName: "H1",
        id: "intro-heading",
        offsetTop: 100,
        offsetHeight: 40,
        textContent: "Introduction to Distributed Systems",
        parentElement: null,
      };

      const mockP = {
        tagName: "P",
        id: "",
        offsetTop: 180,
        offsetHeight: 120,
        textContent: "Modern web applications require clock synchronization...",
        parentElement: {
          children: [
            mockH1,
            { tagName: "P" },
            { tagName: "P" },
          ],
        },
      };
      (mockP.parentElement.children as any)[1] = mockP;

      const mockDoc: any = {
        querySelectorAll: (selector: string) => {
          if (selector.includes("h1")) return [mockH1, mockP];
          return [];
        },
        querySelector: (selector: string) => {
          if (selector === "#intro-heading") return mockH1;
          return null;
        },
      };

      // Test scroll top near heading
      const pos1 = TextQuoteAnchor.computeRelativePosition(110, mockDoc);
      expect(pos1.anchorSelector).toBe("#intro-heading");
      expect(pos1.anchorTextSnippet).toBe("Introduction to Distributed Systems");
      expect(pos1.offsetPx).toBe(10);
      expect(pos1.percentageWithinAnchor).toBe(0.25);

      // Re-calculate target scroll top on a different client device
      const targetY = TextQuoteAnchor.calculateTargetScrollTop(pos1, mockDoc);
      expect(targetY).toBe(110);
    });

    it("should fallback gracefully if DOM has no anchor elements", () => {
      const mockDoc: any = {
        querySelectorAll: () => [],
      };
      const pos = TextQuoteAnchor.computeRelativePosition(350, mockDoc);
      expect(pos.anchorSelector).toBe("body");
      expect(pos.offsetPx).toBe(350);
      expect(pos.percentageWithinAnchor).toBe(0);
    });

    it("should generate and resolve W3C TextQuoteSelectors disambiguating duplicates", () => {
      const fullArticle =
        "The quick brown fox jumps over the lazy dog. The quick brown fox sleeps under the tall tree.";

      // First occurrence of "quick brown fox"
      const matchIndex1 = fullArticle.indexOf("quick brown fox");
      const selector1 = TextQuoteAnchor.createTextQuoteSelector(
        "quick brown fox",
        fullArticle,
        matchIndex1,
        15,
        15
      );

      expect(selector1.exact).toBe("quick brown fox");
      expect(selector1.prefix).toBe("The ");
      expect(selector1.suffix).toBe(" jumps over the");

      const matchResult1 = TextQuoteAnchor.findTextQuoteMatch(fullArticle, selector1);
      expect(matchResult1).not.toBeNull();
      expect(matchResult1!.startIndex).toBe(matchIndex1);
      expect(matchResult1!.endIndex).toBe(matchIndex1 + "quick brown fox".length);

      // Second occurrence of "quick brown fox"
      const matchIndex2 = fullArticle.lastIndexOf("quick brown fox");
      const selector2 = TextQuoteAnchor.createTextQuoteSelector(
        "quick brown fox",
        fullArticle,
        matchIndex2,
        15,
        15
      );

      expect(selector2.exact).toBe("quick brown fox");
      expect(selector2.suffix).toBe(" sleeps under t");

      const matchResult2 = TextQuoteAnchor.findTextQuoteMatch(fullArticle, selector2);
      expect(matchResult2).not.toBeNull();
      expect(matchResult2!.startIndex).toBe(matchIndex2);
      expect(matchResult2!.endIndex).toBe(matchIndex2 + "quick brown fox".length);
    });

    it("should return null for non-matching W3C TextQuoteSelector", () => {
      const fullText = "Some short text.";
      const match = TextQuoteAnchor.findTextQuoteMatch(fullText, {
        exact: "nonexistent text",
      });
      expect(match).toBeNull();
    });
  });

  describe("CoBrowseManager State Engine", () => {
    let manager: CoBrowseManager;

    beforeEach(() => {
      manager = new CoBrowseManager({
        url: "https://example.com/blog/distributed-sync",
        title: "Distributed Sync in Practice",
        frameAllowed: false,
        isHost: true,
      });
    });

    it("should manage follow host toggle and relative scroll broadcasts", () => {
      const onScrollSpy = vi.fn();
      const onFollowSpy = vi.fn();

      const listenerManager = new CoBrowseManager({
        url: "https://example.com/blog",
        isHost: false,
        onScrollChange: onScrollSpy,
        onFollowHostChange: onFollowSpy,
      });

      expect(listenerManager.isFollowingHost()).toBe(true);

      const hostPos: RelativeReadingPosition = {
        anchorSelector: "#section-2",
        anchorTextSnippet: "Architecture Overview",
        offsetPx: 45,
        percentageWithinAnchor: 0.15,
      };

      listenerManager.applyHostScroll(hostPos);
      expect(onScrollSpy).toHaveBeenCalledWith(hostPos);

      // Toggle follow host off
      listenerManager.setFollowHost(false);
      expect(onFollowSpy).toHaveBeenCalledWith(false);
      expect(listenerManager.isFollowingHost()).toBe(false);

      // Subsequent host scroll should not trigger scroll change when not following
      onScrollSpy.mockClear();
      listenerManager.applyHostScroll({
        anchorSelector: "#section-3",
        offsetPx: 0,
        percentageWithinAnchor: 0,
      });
      expect(onScrollSpy).not.toHaveBeenCalled();
    });

    it("should manage shared highlights and sticky comments", () => {
      const highlight: SharedHighlight = {
        id: "hl_1",
        userId: "user_alice",
        userName: "Alice",
        color: "#fef08a",
        target: { exact: "important quote" },
        createdAt: 1000,
      };

      manager.addHighlight(highlight);
      expect(manager.getHighlights()).toHaveLength(1);
      expect(manager.getHighlights()[0].id).toBe("hl_1");

      const comment: StickyComment = {
        id: "cmt_1",
        highlightId: "hl_1",
        userId: "user_bob",
        userName: "Bob",
        target: { exact: "important quote" },
        commentText: "Great point regarding drift tolerance!",
        createdAt: 1050,
      };

      manager.addStickyComment(comment);
      expect(manager.getStickyComments()).toHaveLength(1);
      expect(manager.getStickyComments()[0].commentText).toBe("Great point regarding drift tolerance!");

      // Remove highlight and comment
      manager.removeHighlight("hl_1");
      expect(manager.getHighlights()).toHaveLength(0);

      manager.deleteStickyComment("cmt_1");
      expect(manager.getStickyComments()).toHaveLength(0);
    });

    it("should record section pings with FIFO ring buffer limit", () => {
      const onPingSpy = vi.fn();
      const pingManager = new CoBrowseManager({ onSectionPing: onPingSpy });

      const ping = pingManager.postSectionPing("Chapter 1: Intro", "#chap1", {
        userId: "u1",
        userName: "Host",
      });

      expect(ping.sectionTitle).toBe("Chapter 1: Intro");
      expect(onPingSpy).toHaveBeenCalledWith(ping);
      expect(pingManager.getSectionPings()).toHaveLength(1);

      // Test limit of 50 pings
      for (let i = 2; i <= 60; i++) {
        pingManager.postSectionPing(`Section ${i}`, `#sec${i}`, {
          userId: "u1",
          userName: "Host",
        });
      }
      expect(pingManager.getSectionPings().length).toBeLessThanOrEqual(50);
    });

    it("should synchronize collaborative shared notes with version tracking", () => {
      const onNotesSpy = vi.fn();
      const notesManager = new CoBrowseManager({ onNotesUpdate: onNotesSpy });

      notesManager.updateNotes("Initial team notes", 1);
      expect(notesManager.getSharedNotes()).toEqual({
        text: "Initial team notes",
        version: 1,
      });
      expect(onNotesSpy).toHaveBeenCalledWith("Initial team notes", 1);

      notesManager.updateNotes("Updated team notes with action items");
      expect(notesManager.getSharedNotes().version).toBe(2);
    });

    it("should update and return presence cursors", () => {
      const presence: MemberReadingPresence = {
        userId: "u_alice",
        userName: "Alice",
        userColor: "#6366f1",
        anchorSelector: "#methods",
        anchorTextSnippet: "Methods & Benchmarks",
        lastUpdated: Date.now(),
      };

      manager.updatePresence(presence);
      expect(manager.getPresenceList()).toHaveLength(1);
      expect(manager.getPresenceList()[0].anchorSelector).toBe("#methods");

      manager.removePresence("u_alice");
      expect(manager.getPresenceList()).toHaveLength(0);
    });

    it("should serialize and restore full session snapshots", () => {
      manager.updateNotes("Session notes", 3);
      manager.postSectionPing("Conclusion", "#conclusion", {
        userId: "u_host",
        userName: "Host",
      });

      const session = manager.getSession();
      expect(session.url).toBe("https://example.com/blog/distributed-sync");
      expect(session.frameAllowed).toBe(false);
      expect(session.sharedNotes).toBe("Session notes");
      expect(session.notesVersion).toBe(3);

      const newManager = new CoBrowseManager();
      newManager.setSession(session);
      expect(newManager.getUrl()).toBe("https://example.com/blog/distributed-sync");
      expect(newManager.isFramingAllowed()).toBe(false);
      expect(newManager.getSharedNotes().text).toBe("Session notes");
    });
  });

  describe("CoBrowseAdapter Implementation on PlayerAdapter", () => {
    it("should create adapter via AdapterFactory and expose capabilities", () => {
      const adapter = AdapterFactory.createAdapter("co-browse", {
        url: "https://blog.cloudflare.com/clock-sync",
        frameAllowed: false,
      });

      expect(adapter.provider).toBe("co-browse");
      expect(adapter.capabilities.supportsPlaybackRate).toBe(true);
      expect(adapter.capabilities.controllable).toBe("full");
      expect((adapter as CoBrowseAdapter).isFramingAllowed()).toBe(false);
    });

    it("should manage playback state, seek, and clock progress", async () => {
      const adapter = new CoBrowseAdapter({
        url: "https://example.com/page-with-media",
        frameAllowed: true,
      });

      const stateSpy = vi.fn();
      adapter.onStateChange(stateSpy);

      await adapter.load({
        provider: "co-browse",
        sourceRef: "https://example.com/page-with-media",
        durationMs: 60000,
      });

      expect(adapter.getState()).toBe("paused");

      await adapter.play();
      expect(adapter.getState()).toBe("playing");

      adapter.seek(15000);
      expect(adapter.getCurrentTime()).toBeGreaterThanOrEqual(15000);
      expect(adapter.getCurrentTime()).toBeLessThan(15200);

      adapter.setPlaybackRate(1.5);
      expect(adapter.getPlaybackRate()).toBe(1.5);

      adapter.pause();
      expect(adapter.getState()).toBe("paused");

      adapter.destroy();
    });

    it("should synchronize embedded media from content script", () => {
      const adapter = new CoBrowseAdapter();

      const mediaState: CoBrowseMediaState = {
        mediaId: "tutorial-video",
        tagName: "video",
        status: "playing",
        positionMs: 32000,
        serverTimeMs: Date.now(),
        playbackRate: 1.25,
        durationMs: 120000,
      };

      adapter.handleMediaStateFromPage(mediaState);

      expect(adapter.getState()).toBe("playing");
      expect(Math.abs(adapter.getCurrentTime() - 32000)).toBeLessThanOrEqual(50);
      expect(adapter.getDuration()).toBe(120000);
      expect(adapter.getPlaybackRate()).toBe(1.25);
    });
  });
});
