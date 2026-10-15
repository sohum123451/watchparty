import {
  RelativeReadingPosition,
  W3CTextQuoteSelector,
  SharedHighlight,
  StickyComment,
  MemberReadingPresence,
  SectionPing,
  CoBrowseMediaState,
} from "@watchparty/shared";
import { TextQuoteAnchor } from "./TextQuoteAnchor.js";
import { StreamingPageAdapter, PlayerState } from "../adapter/StreamingPageAdapter.js";
import { ExtensionSyncEngine } from "../sync/ExtensionSyncEngine.js";

export interface StoredRoomData {
  roomId?: string;
  coBrowseUrl?: string;
  isHost?: boolean;
  username?: string;
  userId?: string;
  followHost?: boolean;
}

export class CoBrowseContentScript {
  private active = false;
  private currentUrl = "";
  private roomId = "";
  private isHost = false;
  private userId = "";
  private username = "";
  private followHost = true;

  private port: chrome.runtime.Port | null = null;
  private badgeElement: HTMLElement | null = null;
  private selectionToolbar: HTMLElement | null = null;
  private commentsContainer: HTMLElement | null = null;

  private mediaAdapter: StreamingPageAdapter | null = null;
  private mediaSyncEngine: ExtensionSyncEngine | null = null;
  private boundMediaElement: HTMLMediaElement | null = null;

  private isProgrammaticScroll = false;
  private scrollDebounceTimer: any = null;
  private currentSectionTitle = "";
  private presenceMap = new Map<string, MemberReadingPresence>();
  private presenceBadgeContainer: HTMLElement | null = null;

  constructor() {
    this.currentUrl = window.location.href;
  }

  public async start(): Promise<boolean> {
    const data: StoredRoomData = await chrome.storage.local.get([
      "roomId",
      "coBrowseUrl",
      "isHost",
      "username",
      "userId",
      "followHost",
    ]);

    if (!data.roomId || !data.coBrowseUrl) {
      return false;
    }

    if (!this.matchesUrl(this.currentUrl, data.coBrowseUrl)) {
      return false;
    }

    this.active = true;
    this.roomId = data.roomId;
    this.isHost = !!data.isHost;
    this.userId = data.userId || `user_${Math.random().toString(36).slice(2, 8)}`;
    this.username = data.username || "Anonymous";
    this.followHost = data.followHost ?? true;

    console.log(`[WatchParty Co-Browse] Activated for room "${this.roomId}" (Host: ${this.isHost})`);

    this.connectBackground();
    this.injectStyles();
    this.createBadge();
    this.setupScrollSync();
    this.setupSelectionToolbar();
    this.setupMediaSync();
    this.setupPresenceContainer();

    // Broadcast initial presence
    this.reportPresence();

    return true;
  }

  private matchesUrl(current: string, target: string): boolean {
    try {
      const u1 = new URL(current);
      const u2 = new URL(target);
      return u1.origin === u2.origin && u1.pathname.replace(/\/$/, "") === u2.pathname.replace(/\/$/, "");
    } catch {
      return false;
    }
  }

  private connectBackground(): void {
    try {
      this.port = chrome.runtime.connect({ name: "watchparty-cobrowse" });
      this.port.onMessage.addListener((msg) => this.handleMessage(msg));
      this.port.onDisconnect.addListener(() => {
        this.port = null;
      });

      this.port.postMessage({
        type: "CO_BROWSE_INIT",
        roomId: this.roomId,
        url: this.currentUrl,
        isHost: this.isHost,
      });
    } catch (e) {
      console.warn("[WatchParty Co-Browse] Could not connect to background:", e);
    }
  }

  private handleMessage(msg: any): void {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case "CO_BROWSE_SCROLL": {
        if (!this.isHost && this.followHost && msg.payload) {
          this.applyHostScroll(msg.payload);
        }
        break;
      }

      case "CO_BROWSE_HIGHLIGHT_ADD": {
        if (msg.payload) {
          this.renderHighlight(msg.payload);
        }
        break;
      }

      case "CO_BROWSE_COMMENT_ADD": {
        if (msg.payload) {
          this.renderStickyComment(msg.payload);
        }
        break;
      }

      case "CO_BROWSE_PRESENCE": {
        if (msg.payload) {
          this.updateMemberPresence(msg.payload);
        }
        break;
      }

      case "CO_BROWSE_MEDIA_SYNC": {
        if (msg.payload) {
          this.handleRemoteMediaSync(msg.payload);
        }
        break;
      }

      case "CO_BROWSE_SET_HOST": {
        this.isHost = !!msg.isHost;
        this.updateBadge();
        break;
      }
    }
  }

  // ==========================================
  // FLOATING "SYNCED" BADGE
  // ==========================================

  private createBadge(): void {
    if (this.badgeElement) return;

    const badge = document.createElement("div");
    badge.id = "watchparty-cobrowse-badge";
    badge.className = "wp-cb-badge";
    this.updateBadgeContent(badge);
    document.body.appendChild(badge);
    this.badgeElement = badge;
  }

  private updateBadge(): void {
    if (this.badgeElement) {
      this.updateBadgeContent(this.badgeElement);
    }
  }

  private updateBadgeContent(badge: HTMLElement): void {
    badge.innerHTML = `
      <div class="wp-cb-inner">
        <div class="wp-cb-header">
          <span class="wp-cb-dot"></span>
          <span class="wp-cb-title">Co-Browse Synced</span>
          <span class="wp-cb-room">#${this.roomId}</span>
          <span class="wp-cb-role">${this.isHost ? "HOST" : "MEMBER"}</span>
        </div>
        <div class="wp-cb-body">
          <div class="wp-cb-section-info">
            <span class="wp-cb-label">Reading:</span>
            <span class="wp-cb-section-name" id="wpCbCurrentSection">${this.currentSectionTitle || "Overview"}</span>
          </div>
          ${
            !this.isHost
              ? `<div class="wp-cb-toggle-row">
                  <label class="wp-cb-switch">
                    <input type="checkbox" id="wpCbFollowToggle" ${this.followHost ? "checked" : ""}>
                    <span class="wp-cb-slider"></span>
                  </label>
                  <span class="wp-cb-toggle-label">Follow Host</span>
                </div>`
              : `<div class="wp-cb-host-indicator">You are guiding this session</div>`
          }
          <div class="wp-cb-actions">
            <button type="button" class="wp-cb-btn" id="wpCbBtnPing">📍 Ping Section</button>
          </div>
        </div>
      </div>
    `;

    const followToggle = badge.querySelector("#wpCbFollowToggle") as HTMLInputElement | null;
    if (followToggle) {
      followToggle.addEventListener("change", (e) => {
        this.followHost = (e.target as HTMLInputElement).checked;
        chrome.storage.local.set({ followHost: this.followHost });
      });
    }

    const pingBtn = badge.querySelector("#wpCbBtnPing");
    if (pingBtn) {
      pingBtn.addEventListener("click", () => this.pingCurrentSection());
    }
  }

  // ==========================================
  // RELATIVE READING SCROLL SYNC
  // ==========================================

  private setupScrollSync(): void {
    window.addEventListener(
      "scroll",
      () => {
        if (this.isProgrammaticScroll) return;

        if (this.scrollDebounceTimer) {
          clearTimeout(this.scrollDebounceTimer);
        }

        this.scrollDebounceTimer = setTimeout(() => {
          const position = TextQuoteAnchor.computeRelativePosition(window.scrollY, document);
          this.currentSectionTitle = position.anchorTextSnippet || "Reading passage";

          const secEl = document.getElementById("wpCbCurrentSection");
          if (secEl) {
            secEl.textContent = this.currentSectionTitle.slice(0, 32);
          }

          if (this.isHost) {
            this.broadcast("CO_BROWSE_SCROLL", position);
          }

          this.reportPresence(position);
        }, 150);
      },
      { passive: true }
    );
  }

  private applyHostScroll(position: RelativeReadingPosition): void {
    const targetY = TextQuoteAnchor.calculateTargetScrollTop(position, document);
    this.isProgrammaticScroll = true;

    window.scrollTo({
      top: targetY,
      behavior: "smooth",
    });

    if (position.anchorTextSnippet) {
      this.currentSectionTitle = position.anchorTextSnippet;
      const secEl = document.getElementById("wpCbCurrentSection");
      if (secEl) {
        secEl.textContent = this.currentSectionTitle.slice(0, 32);
      }
    }

    setTimeout(() => {
      this.isProgrammaticScroll = false;
    }, 400);
  }

  private pingCurrentSection(): void {
    const position = TextQuoteAnchor.computeRelativePosition(window.scrollY, document);
    const title = position.anchorTextSnippet || "Section";

    const ping: SectionPing = {
      id: `ping_${Date.now()}`,
      userId: this.userId,
      userName: this.username,
      sectionTitle: title,
      anchorSelector: position.anchorSelector,
      timestamp: Date.now(),
    };

    this.broadcast("CO_BROWSE_SECTION_PING", ping);
  }

  // ==========================================
  // SHARED HIGHLIGHTS & STICKY COMMENTS
  // ==========================================

  private setupSelectionToolbar(): void {
    const toolbar = document.createElement("div");
    toolbar.id = "wp-selection-toolbar";
    toolbar.className = "wp-sel-toolbar";
    toolbar.style.display = "none";
    toolbar.innerHTML = `
      <button type="button" class="wp-sel-btn" data-color="#fef08a" title="Highlight Yellow">🟡</button>
      <button type="button" class="wp-sel-btn" data-color="#a7f3d0" title="Highlight Green">🟢</button>
      <button type="button" class="wp-sel-btn" data-color="#bae6fd" title="Highlight Blue">🔵</button>
      <button type="button" class="wp-sel-btn" data-color="#fbcfe8" title="Highlight Pink">🟣</button>
      <span class="wp-sel-divider"></span>
      <button type="button" class="wp-sel-btn wp-sel-comment-btn" id="wpSelBtnComment">💬 Comment</button>
    `;

    document.body.appendChild(toolbar);
    this.selectionToolbar = toolbar;

    document.addEventListener("mouseup", () => this.handleSelectionChange());
    document.addEventListener("keyup", () => this.handleSelectionChange());

    toolbar.querySelectorAll(".wp-sel-btn[data-color]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const color = (e.currentTarget as HTMLElement).getAttribute("data-color") || "#fef08a";
        this.createHighlightFromSelection(color);
      });
    });

    const commentBtn = toolbar.querySelector("#wpSelBtnComment");
    if (commentBtn) {
      commentBtn.addEventListener("click", () => {
        this.promptCommentFromSelection();
      });
    }

    // Setup comments container in right margin
    const commentsWrap = document.createElement("div");
    commentsWrap.id = "wp-comments-container";
    commentsWrap.className = "wp-comments-wrap";
    document.body.appendChild(commentsWrap);
    this.commentsContainer = commentsWrap;
  }

  private handleSelectionChange(): void {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      if (this.selectionToolbar) this.selectionToolbar.style.display = "none";
      return;
    }

    const text = sel.toString().trim();
    if (text.length < 3) {
      if (this.selectionToolbar) this.selectionToolbar.style.display = "none";
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (this.selectionToolbar) {
      this.selectionToolbar.style.display = "flex";
      this.selectionToolbar.style.top = `${window.scrollY + rect.top - 44}px`;
      this.selectionToolbar.style.left = `${Math.max(10, window.scrollX + rect.left + rect.width / 2 - 100)}px`;
    }
  }

  private createHighlightFromSelection(color: string): void {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const exact = sel.toString().trim();
    if (!exact) return;

    const bodyText = document.body.innerText || "";
    const matchIndex = bodyText.indexOf(exact);
    const selector = TextQuoteAnchor.createTextQuoteSelector(exact, bodyText, matchIndex);

    const highlight: SharedHighlight = {
      id: `hl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: this.userId,
      userName: this.username,
      color,
      target: selector,
      createdAt: Date.now(),
    };

    if (this.selectionToolbar) this.selectionToolbar.style.display = "none";
    sel.removeAllRanges();

    this.renderHighlight(highlight);
    this.broadcast("CO_BROWSE_HIGHLIGHT_ADD", highlight);
  }

  private promptCommentFromSelection(): void {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const exact = sel.toString().trim();
    const commentText = window.prompt(`Add sticky note on "${exact.slice(0, 30)}...":`);
    if (!commentText || !commentText.trim()) return;

    const bodyText = document.body.innerText || "";
    const matchIndex = bodyText.indexOf(exact);
    const selector = TextQuoteAnchor.createTextQuoteSelector(exact, bodyText, matchIndex);

    const comment: StickyComment = {
      id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: this.userId,
      userName: this.username,
      commentText: commentText.trim(),
      target: selector,
      createdAt: Date.now(),
    };

    if (this.selectionToolbar) this.selectionToolbar.style.display = "none";
    sel.removeAllRanges();

    this.renderStickyComment(comment);
    this.broadcast("CO_BROWSE_COMMENT_ADD", comment);
  }

  private renderHighlight(highlight: SharedHighlight): void {
    if (document.getElementById(`wp-hl-${highlight.id}`)) return;

    const mark = document.createElement("mark");
    mark.id = `wp-hl-${highlight.id}`;
    mark.className = "wp-inline-highlight";
    mark.style.backgroundColor = highlight.color || "#fef08a";
    mark.title = `Highlighted by ${highlight.userName}`;
    mark.textContent = highlight.target.exact;

    // Disambiguate and attach in DOM
    const matchEl = TextQuoteAnchor.resolveAnchorElement("body", highlight.target.exact, document);
    if (matchEl) {
      matchEl.style.position = "relative";
      const tag = document.createElement("span");
      tag.className = "wp-hl-author-badge";
      tag.textContent = highlight.userName;
      matchEl.appendChild(tag);
    }
  }

  private renderStickyComment(comment: StickyComment): void {
    if (!this.commentsContainer) return;
    if (document.getElementById(`wp-cmt-${comment.id}`)) return;

    const card = document.createElement("div");
    card.id = `wp-cmt-${comment.id}`;
    card.className = "wp-sticky-card";
    card.innerHTML = `
      <div class="wp-sticky-header">
        <span class="wp-sticky-author">${comment.userName}</span>
        <span class="wp-sticky-time">just now</span>
      </div>
      <div class="wp-sticky-quote">"${comment.target.exact.slice(0, 40)}..."</div>
      <div class="wp-sticky-text">${comment.commentText}</div>
    `;

    this.commentsContainer.appendChild(card);
  }

  // ==========================================
  // PRESENCE CURSORS & SECTION READOUTS
  // ==========================================

  private setupPresenceContainer(): void {
    const wrap = document.createElement("div");
    wrap.id = "wp-presence-wrap";
    wrap.className = "wp-presence-container";
    document.body.appendChild(wrap);
    this.presenceBadgeContainer = wrap;
  }

  private reportPresence(pos?: RelativeReadingPosition): void {
    const position = pos || TextQuoteAnchor.computeRelativePosition(window.scrollY, document);
    const presence: MemberReadingPresence = {
      userId: this.userId,
      userName: this.username,
      userColor: "#6366f1",
      anchorSelector: position.anchorSelector,
      anchorTextSnippet: position.anchorTextSnippet,
      lastUpdated: Date.now(),
    };

    this.broadcast("CO_BROWSE_PRESENCE", presence);
  }

  private updateMemberPresence(presence: MemberReadingPresence): void {
    if (presence.userId === this.userId) return;
    this.presenceMap.set(presence.userId, presence);
    this.renderPresenceBadges();
  }

  private renderPresenceBadges(): void {
    if (!this.presenceBadgeContainer) return;

    this.presenceBadgeContainer.innerHTML = "";
    for (const p of this.presenceMap.values()) {
      const anchor = TextQuoteAnchor.resolveAnchorElement(
        p.anchorSelector,
        p.anchorTextSnippet,
        document
      );

      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        const badge = document.createElement("div");
        badge.className = "wp-presence-pill";
        badge.style.top = `${window.scrollY + rect.top + 5}px`;
        badge.style.left = `${Math.max(10, rect.right + 10)}px`;
        badge.innerHTML = `<span>👀 ${p.userName}</span>`;
        this.presenceBadgeContainer.appendChild(badge);
      }
    }
  }

  // ==========================================
  // EMBEDDED MEDIA SYNC (<audio> & <video>)
  // ==========================================

  private setupMediaSync(): void {
    const media = document.querySelector("video, audio") as HTMLMediaElement | null;
    if (!media) return;

    this.boundMediaElement = media;
    this.mediaAdapter = new StreamingPageAdapter(media);
    this.mediaSyncEngine = new ExtensionSyncEngine(this.mediaAdapter);
    this.mediaSyncEngine.setHost(this.isHost);
    this.mediaSyncEngine.start();

    if (this.isHost) {
      this.mediaAdapter.onStateChange((state: PlayerState) => {
        if (!this.mediaAdapter || this.mediaAdapter.isSuppressed()) return;
        this.broadcastMediaSync(state === "playing" ? "playing" : "paused");
      });

      this.mediaAdapter.onSeek?.((_posMs: number) => {
        if (!this.mediaAdapter || this.mediaAdapter.isSuppressed()) return;
        this.broadcastMediaSync(this.mediaAdapter.getState() === "playing" ? "playing" : "paused");
      });
    }
  }

  private broadcastMediaSync(status: "playing" | "paused"): void {
    if (!this.mediaAdapter || !this.boundMediaElement) return;

    const payload: CoBrowseMediaState = {
      mediaId: this.boundMediaElement.id || "primary-media",
      tagName: this.boundMediaElement.tagName.toLowerCase() === "video" ? "video" : "audio",
      status,
      positionMs: this.mediaAdapter.getCurrentTime(),
      serverTimeMs: Date.now(),
      playbackRate: this.mediaAdapter.getPlaybackRate(),
      durationMs: this.mediaAdapter.getDuration(),
    };

    this.broadcast("CO_BROWSE_MEDIA_SYNC", payload);
  }

  private handleRemoteMediaSync(state: CoBrowseMediaState): void {
    if (this.isHost || !this.mediaAdapter) return;

    if (this.mediaSyncEngine) {
      this.mediaSyncEngine.updateRoomState({
        roomId: this.roomId,
        state: state.status === "playing" ? "playing" : "paused",
        positionMs: state.positionMs,
        playbackRate: state.playbackRate,
        updatedAtServerMs: state.serverTimeMs,
        isHost: false,
      });
    }
  }

  private broadcast(type: string, payload: any): void {
    if (this.port) {
      try {
        this.port.postMessage({ type, roomId: this.roomId, payload });
      } catch (err) {
        console.warn("[WatchParty Co-Browse] Broadcast failed:", err);
      }
    }
  }

  private injectStyles(): void {
    if (document.getElementById("watchparty-cobrowse-styles")) return;

    const style = document.createElement("style");
    style.id = "watchparty-cobrowse-styles";
    style.textContent = `
      .wp-cb-badge {
        position: fixed;
        bottom: 1.5rem;
        right: 1.5rem;
        z-index: 2147483640;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        background: rgba(18, 24, 38, 0.9);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        color: #f3f4f6;
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 1px 1px rgba(99, 102, 241, 0.3);
        border-radius: 12px;
        width: 260px;
        user-select: none;
      }
      .wp-cb-inner { padding: 12px; }
      .wp-cb-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-weight: 600; font-size: 12px; }
      .wp-cb-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981; display: inline-block; }
      .wp-cb-title { color: #f3f4f6; }
      .wp-cb-room { color: #9ca3af; font-size: 11px; margin-left: auto; }
      .wp-cb-role { font-size: 9px; font-weight: 700; background: rgba(99, 102, 241, 0.25); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.4); padding: 1px 4px; border-radius: 4px; }
      .wp-cb-body { display: flex; flex-direction: column; gap: 6px; }
      .wp-cb-section-info { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #d1d5db; overflow: hidden; }
      .wp-cb-label { color: #9ca3af; }
      .wp-cb-section-name { font-weight: 600; color: #6ee7b7; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }
      .wp-cb-toggle-row { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
      .wp-cb-switch { position: relative; display: inline-block; width: 34px; height: 18px; }
      .wp-cb-switch input { opacity: 0; width: 0; height: 0; }
      .wp-cb-slider { position: absolute; cursor: pointer; inset: 0; background-color: #374151; transition: .2s; border-radius: 18px; }
      .wp-cb-slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background-color: white; transition: .2s; border-radius: 50%; }
      .wp-cb-switch input:checked + .wp-cb-slider { background-color: #6366f1; }
      .wp-cb-switch input:checked + .wp-cb-slider:before { transform: translateX(16px); }
      .wp-cb-toggle-label { font-size: 11px; color: #e5e7eb; }
      .wp-cb-host-indicator { font-size: 11px; color: #93c5fd; }
      .wp-cb-actions { margin-top: 6px; display: flex; gap: 6px; }
      .wp-cb-btn { flex: 1; font-size: 11px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); color: #f3f4f6; padding: 4px 8px; border-radius: 6px; cursor: pointer; transition: background 0.15s; }
      .wp-cb-btn:hover { background: rgba(255, 255, 255, 0.15); }

      /* Selection Toolbar */
      .wp-sel-toolbar {
        position: absolute;
        z-index: 2147483642;
        background: #1e293b;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        padding: 4px 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .wp-sel-btn { background: none; border: none; font-size: 14px; cursor: pointer; padding: 2px 4px; border-radius: 4px; transition: transform 0.1s; }
      .wp-sel-btn:hover { transform: scale(1.15); }
      .wp-sel-divider { width: 1px; height: 16px; background: rgba(255, 255, 255, 0.2); margin: 0 2px; }
      .wp-sel-comment-btn { font-size: 11px; color: #f3f4f6; font-weight: 600; padding: 2px 6px; }

      /* Sticky Comments in Margin */
      .wp-comments-wrap {
        position: fixed;
        right: 1.5rem;
        bottom: 12rem;
        width: 260px;
        max-height: 50vh;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 2147483630;
        pointer-events: auto;
      }
      .wp-sticky-card {
        background: rgba(30, 41, 59, 0.95);
        border-left: 3px solid #6366f1;
        border-radius: 6px;
        padding: 8px;
        font-size: 11px;
        color: #f3f4f6;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
      .wp-sticky-header { display: flex; justify-content: space-between; color: #9ca3af; font-size: 10px; margin-bottom: 2px; }
      .wp-sticky-author { font-weight: 700; color: #a5b4fc; }
      .wp-sticky-quote { font-style: italic; color: #94a3b8; margin-bottom: 4px; font-size: 10px; border-left: 2px solid rgba(255,255,255,0.2); padding-left: 4px; }

      /* Presence Avatars */
      .wp-presence-pill {
        position: absolute;
        z-index: 2147483620;
        background: #4f46e5;
        color: white;
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 12px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        pointer-events: none;
        white-space: nowrap;
      }
      .wp-inline-highlight {
        color: #000;
        padding: 0 2px;
        border-radius: 2px;
      }
      .wp-hl-author-badge {
        font-size: 9px;
        background: #1e293b;
        color: #93c5fd;
        border: 1px solid #3b82f6;
        border-radius: 3px;
        padding: 0 3px;
        margin-left: 4px;
        vertical-align: middle;
      }
    `;
    document.head.appendChild(style);
  }
}
