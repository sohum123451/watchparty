import { StreamingPageAdapter, PlayerState } from "../adapter/StreamingPageAdapter.js";
import { ExtensionSyncEngine, DriftMetrics, RoomPlaybackState } from "../sync/ExtensionSyncEngine.js";
import { getSiteRuleForUrl, SiteRule } from "../config/siteConfig.js";
import { CoBrowseContentScript } from "./CoBrowseContentScript.js";

class WatchPartyContentScript {
  private currentUrl: string = "";
  private currentRule: SiteRule;
  private currentVideo: HTMLVideoElement | null = null;
  private adapter: StreamingPageAdapter | null = null;
  private syncEngine: ExtensionSyncEngine | null = null;
  private port: chrome.runtime.Port | null = null;
  private isHost: boolean = false;
  private hudElement: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private checkInterval: any = null;

  constructor() {
    this.currentUrl = window.location.href;
    this.currentRule = getSiteRuleForUrl(this.currentUrl);
    this.init();
  }

  private init(): void {
    console.log(`[WatchParty] Initializing on ${this.currentRule.name} (${window.location.hostname})`);

    // Connect to background service worker
    this.connectBackground();

    // Setup SPA navigation detection
    this.observeNavigation();

    // Look for video element
    this.findAndAttachVideo();

    // Periodically verify video attachment in case of dynamic DOM replacement
    this.checkInterval = setInterval(() => {
      if (this.currentUrl !== window.location.href) {
        this.onUrlChanged();
      } else if (!this.currentVideo || !document.contains(this.currentVideo)) {
        this.findAndAttachVideo();
      }
    }, 1000);
  }

  private connectBackground(): void {
    try {
      this.port = chrome.runtime.connect({ name: "watchparty-content" });

      this.port.onMessage.addListener((msg: any) => {
        this.handleBackgroundMessage(msg);
      });

      this.port.onDisconnect.addListener(() => {
        console.warn("[WatchParty] Background service worker disconnected, reconnecting in 2s...");
        this.port = null;
        setTimeout(() => this.connectBackground(), 2000);
      });

      // Send initial handshake
      this.port.postMessage({
        type: "CONTENT_READY",
        url: window.location.href,
        siteName: this.currentRule.name
      });
    } catch (e) {
      console.warn("[WatchParty] Failed to connect to background:", e);
    }
  }

  private handleBackgroundMessage(msg: any): void {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case "ROOM_STATE_UPDATE": {
        const roomState: RoomPlaybackState = msg.payload;
        this.isHost = roomState.isHost;
        if (this.syncEngine) {
          this.syncEngine.setHost(this.isHost);
          this.syncEngine.updateRoomState(roomState);
        }
        this.updateHudState(roomState);
        break;
      }

      case "CLOCK_OFFSET_UPDATE": {
        const offset = msg.offsetMs || 0;
        if (this.syncEngine) {
          this.syncEngine.setClockOffset(offset);
        }
        break;
      }

      case "SET_HOST_STATUS": {
        this.isHost = !!msg.isHost;
        if (this.syncEngine) {
          this.syncEngine.setHost(this.isHost);
        }
        this.updateHudHostBadge();
        break;
      }

      case "DISCONNECTED_ROOM": {
        if (this.syncEngine) {
          this.syncEngine.stop();
        }
        this.removeHud();
        break;
      }
    }
  }

  private observeNavigation(): void {
    // Monitor URL changes in Single Page Apps (SPA)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = (...args: Parameters<History["pushState"]>) => {
      originalPushState.apply(history, args);
      this.onUrlChanged();
    };

    history.replaceState = (...args: Parameters<History["replaceState"]>) => {
      originalReplaceState.apply(history, args);
      this.onUrlChanged();
    };

    window.addEventListener("popstate", () => this.onUrlChanged());

    // MutationObserver to spot dynamic video additions
    this.observer = new MutationObserver(() => {
      if (!this.currentVideo || !document.contains(this.currentVideo)) {
        this.findAndAttachVideo();
      }
    });

    const targetNode = document.body || document.documentElement;
    if (targetNode) {
      this.observer.observe(targetNode, { childList: true, subtree: true });
    }
  }

  private onUrlChanged(): void {
    this.currentUrl = window.location.href;
    this.currentRule = getSiteRuleForUrl(this.currentUrl);
    console.log(`[WatchParty] SPA Navigation detected: ${this.currentUrl}`);
    this.detachVideo();
    this.findAndAttachVideo();

    if (this.port) {
      this.port.postMessage({
        type: "TAB_NAVIGATED",
        url: this.currentUrl,
        siteName: this.currentRule.name
      });
    }
  }

  private findAndAttachVideo(): void {
    const video = document.querySelector(this.currentRule.videoSelector) as HTMLVideoElement | null;
    if (!video || video === this.currentVideo) return;

    this.attachVideo(video);
  }

  private attachVideo(video: HTMLVideoElement): void {
    this.detachVideo();

    console.log("[WatchParty] Attached to <video> element:", video);
    this.currentVideo = video;
    const adapter = new StreamingPageAdapter(video);
    this.adapter = adapter;
    this.syncEngine = new ExtensionSyncEngine(this.adapter);

    this.syncEngine.setHost(this.isHost);
    this.syncEngine.start();

    // Hook adapter events to notify background when user controls playback (if host)
    adapter.onStateChange((state: PlayerState) => {
      if (!this.isHost || adapter.isSuppressed()) return;
      this.sendPlaybackCommand({
        action: state === "playing" ? "PLAY" : "PAUSE",
        positionMs: adapter.getCurrentTime(),
        playbackRate: adapter.getPlaybackRate()
      });
    });

    adapter.onSeek((positionMs: number) => {
      if (!this.isHost || adapter.isSuppressed()) return;
      this.sendPlaybackCommand({
        action: "SEEK",
        positionMs,
        playbackRate: adapter.getPlaybackRate()
      });
    });

    // Metrics updates for HUD readout
    this.syncEngine.onMetrics((metrics: DriftMetrics) => {
      this.updateHudMetrics(metrics);
    });

    this.injectHud();
  }

  private detachVideo(): void {
    if (this.syncEngine) {
      this.syncEngine.stop();
      this.syncEngine = null;
    }
    if (this.adapter) {
      this.adapter.destroy();
      this.adapter = null;
    }
    this.currentVideo = null;
    this.removeHud();
  }

  private sendPlaybackCommand(payload: { action: string; positionMs: number; playbackRate: number }): void {
    if (!this.port) return;
    this.port.postMessage({
      type: "USER_PLAYBACK_EVENT",
      payload: {
        ...payload,
        clientTimestamp: Date.now()
      }
    });
  }

  private injectHud(): void {
    if (this.hudElement) return;

    const hud = document.createElement("div");
    hud.id = "watchparty-hud-root";
    hud.innerHTML = `
      <div class="wp-hud-container">
        <div class="wp-hud-badge">
          <span class="wp-hud-dot"></span>
          <span class="wp-hud-title">WatchParty</span>
        </div>
        <div class="wp-hud-info">
          <span class="wp-hud-role">${this.isHost ? "Host" : "Member"}</span>
          <span class="wp-hud-drift">Syncing...</span>
        </div>
      </div>
    `;

    // Apply inline scoped styles so host page CSS does not break it
    const style = document.createElement("style");
    style.textContent = `
      #watchparty-hud-root {
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        color: #ffffff;
        pointer-events: auto;
        user-select: none;
      }
      .wp-hud-container {
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(15, 23, 42, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 9999px;
        padding: 6px 14px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(99, 102, 241, 0.3);
        transition: transform 0.2s ease, opacity 0.2s ease;
      }
      .wp-hud-container:hover {
        transform: scale(1.03);
      }
      .wp-hud-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        letter-spacing: 0.3px;
      }
      .wp-hud-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #10b981;
        box-shadow: 0 0 8px #10b981;
      }
      .wp-hud-info {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: #94a3b8;
      }
      .wp-hud-role {
        padding: 2px 7px;
        border-radius: 6px;
        background: rgba(99, 102, 241, 0.25);
        color: #c7d2fe;
        font-weight: 600;
        font-size: 11px;
      }
      .wp-hud-drift {
        color: #cbd5e1;
      }
    `;

    document.documentElement.appendChild(style);
    document.documentElement.appendChild(hud);
    this.hudElement = hud;
  }

  private updateHudHostBadge(): void {
    if (!this.hudElement) return;
    const roleEl = this.hudElement.querySelector(".wp-hud-role");
    if (roleEl) {
      roleEl.textContent = this.isHost ? "Host" : "Member";
    }
  }

  private updateHudState(roomState: RoomPlaybackState): void {
    if (!this.hudElement) return;
    this.updateHudHostBadge();
  }

  private updateHudMetrics(metrics: DriftMetrics): void {
    if (!this.hudElement) return;
    const driftEl = this.hudElement.querySelector(".wp-hud-drift");
    const dotEl = this.hudElement.querySelector(".wp-hud-dot") as HTMLElement | null;

    if (driftEl) {
      if (this.isHost) {
        driftEl.textContent = "Broadcasting";
      } else {
        const sign = metrics.driftMs > 0 ? "+" : "";
        driftEl.textContent = `${sign}${metrics.driftMs}ms (${metrics.mode})`;
      }
    }

    if (dotEl) {
      if (this.isHost) {
        dotEl.style.background = "#6366f1";
        dotEl.style.boxShadow = "0 0 8px #6366f1";
      } else if (metrics.mode === "in-sync") {
        dotEl.style.background = "#10b981";
        dotEl.style.boxShadow = "0 0 8px #10b981";
      } else if (metrics.mode === "nudging") {
        dotEl.style.background = "#f59e0b";
        dotEl.style.boxShadow = "0 0 8px #f59e0b";
      } else {
        dotEl.style.background = "#ef4444";
        dotEl.style.boxShadow = "0 0 8px #ef4444";
      }
    }
  }

  private removeHud(): void {
    if (this.hudElement && this.hudElement.parentNode) {
      this.hudElement.parentNode.removeChild(this.hudElement);
      this.hudElement = null;
    }
  }
}

// Instantiate content script
if (typeof window !== "undefined") {
  // Announce presence to WatchParty Web App & listen for web app bridge commands
  window.postMessage({ source: 'WATCHPARTY_EXTENSION', type: 'EXTENSION_INSTALLED', version: '1.0.0' }, '*');

  window.addEventListener('message', (event) => {
    if (event.data?.source === 'WATCHPARTY_WEB') {
      if (event.data?.type === 'PING_EXTENSION') {
        window.postMessage({ source: 'WATCHPARTY_EXTENSION', type: 'EXTENSION_INSTALLED', version: '1.0.0' }, '*');
      } else if (event.data?.type === 'WATCHPARTY_LAUNCH_STREAM') {
        try {
          chrome.runtime.sendMessage({
            type: 'WATCHPARTY_ATTACH_ROOM',
            payload: event.data.payload,
          });
        } catch (e) {
          console.warn('[WatchParty Content] Failed to relay stream launch to background:', e);
        }
      }
    }
  });

  const coBrowse = new CoBrowseContentScript();
  coBrowse.start().then((activated) => {
    if (!activated) {
      new WatchPartyContentScript();
    }
  }).catch(() => {
    new WatchPartyContentScript();
  });
}

