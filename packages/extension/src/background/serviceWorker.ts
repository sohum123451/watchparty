// WatchParty Manifest V3 Background Service Worker

interface StoredSession {
  serverUrl?: string;
  roomId?: string;
  isHost?: boolean;
  username?: string;
  connected?: boolean;
}

const DEFAULT_SERVER_URL = "ws://localhost:3000/ws";

class WatchPartyServiceWorker {
  private ws: WebSocket | null = null;
  private ports: Set<chrome.runtime.Port> = new Set();
  private clockOffsetMs: number = 0;
  private pingInterval: any = null;

  constructor() {
    this.init();
  }

  private init(): void {
    console.log("[WatchParty SW] Service Worker initialized");

    // Listen for long-lived content script connections
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name === "watchparty-content" || port.name === "watchparty-cobrowse") {
        this.handlePortConnect(port);
      }
    });

    // Listen for one-shot messages from popup or options
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      this.handleMessage(message).then(sendResponse);
      return true; // Keep channel open for async response
    });

    // Handle alarms for keepalive/clock sync
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === "watchparty-clock-sync") {
        this.performClockSync();
      }
    });

    // Restore existing session if room was saved
    this.restoreSession();
  }

  private async restoreSession(): Promise<void> {
    const data = await chrome.storage.local.get(["roomId", "serverUrl", "isHost", "connected"]);
    if (data.connected && data.roomId) {
      console.log(`[WatchParty SW] Restoring session for room: ${data.roomId}`);
      await this.connectWebSocket(data.serverUrl || DEFAULT_SERVER_URL, data.roomId, !!data.isHost);
    }
  }

  private handlePortConnect(port: chrome.runtime.Port): void {
    this.ports.add(port);
    console.log(`[WatchParty SW] Script port connected [${port.name}] (total ports: ${this.ports.size})`);

    // Immediately inform the port of current clock offset
    port.postMessage({
      type: "CLOCK_OFFSET_UPDATE",
      offsetMs: this.clockOffsetMs
    });

    port.onMessage.addListener(async (msg) => {
      if (!msg) return;

      if (msg.type === "CONTENT_READY" || msg.type === "TAB_NAVIGATED" || msg.type === "CO_BROWSE_INIT") {
        // Send latest room state if active
        const { roomId, isHost } = await chrome.storage.local.get(["roomId", "isHost"]);
        if (roomId && this.ws && this.ws.readyState === WebSocket.OPEN) {
          port.postMessage({
            type: msg.type === "CO_BROWSE_INIT" ? "CO_BROWSE_SET_HOST" : "SET_HOST_STATUS",
            isHost: !!isHost
          });
        }
      } else if (msg.type === "USER_PLAYBACK_EVENT") {
        const { isHost } = await chrome.storage.local.get("isHost");
        if (isHost && this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.relayPlaybackToServer(msg.payload);
        }
      } else if (typeof msg.type === "string" && msg.type.startsWith("CO_BROWSE_")) {
        // Relay co-browse events (scroll, presence, highlights, comments, media sync) to server
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(msg));
        }
      }
    });

    port.onDisconnect.addListener(() => {
      this.ports.delete(port);
      console.log(`[WatchParty SW] Port disconnected (remaining: ${this.ports.size})`);
    });
  }

  private async handleMessage(msg: any): Promise<any> {
    if (!msg || !msg.action) return { success: false, error: "Invalid action" };

    switch (msg.action) {
      case "GET_STATUS": {
        const stored = await chrome.storage.local.get(["roomId", "serverUrl", "isHost", "connected", "lastMetrics"]);
        return {
          success: true,
          connected: !!stored.connected && this.ws?.readyState === WebSocket.OPEN,
          roomId: stored.roomId || null,
          serverUrl: stored.serverUrl || DEFAULT_SERVER_URL,
          isHost: !!stored.isHost,
          clockOffsetMs: this.clockOffsetMs,
          connectedTabs: this.ports.size
        };
      }

      case "JOIN_ROOM": {
        const { roomId, serverUrl, isHost } = msg;
        if (!roomId) return { success: false, error: "Room ID required" };
        const url = serverUrl || DEFAULT_SERVER_URL;
        await this.connectWebSocket(url, roomId, !!isHost);
        return { success: true };
      }

      case "LEAVE_ROOM": {
        await this.disconnectWebSocket();
        return { success: true };
      }

      case "SET_HOST_MODE": {
        const isHost = !!msg.isHost;
        await chrome.storage.local.set({ isHost });
        this.broadcastToPorts({ type: "SET_HOST_STATUS", isHost });
        this.broadcastToPorts({ type: "CO_BROWSE_SET_HOST", isHost });
        return { success: true, isHost };
      }

      case "SET_COBROWSE_TARGET": {
        const { coBrowseUrl, roomId, isHost, username, userId } = msg;
        await chrome.storage.local.set({
          coBrowseUrl,
          roomId,
          isHost: !!isHost,
          username: username || "Guest",
          userId: userId || `user_${Date.now()}`,
          followHost: true,
        });
        return { success: true };
      }

      default:
        return { success: false, error: "Unknown action" };
    }
  }

  private async connectWebSocket(serverUrl: string, roomId: string, isHost: boolean): Promise<void> {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    const wsUrl = `${serverUrl.replace(/^http/, "ws")}?roomId=${encodeURIComponent(roomId)}&role=${isHost ? "host" : "member"}`;
    console.log(`[WatchParty SW] Connecting WebSocket: ${wsUrl}`);

    try {
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = async () => {
        console.log(`[WatchParty SW] Connected to room ${roomId}`);
        await chrome.storage.local.set({
          roomId,
          serverUrl,
          isHost,
          connected: true
        });

        await chrome.action.setBadgeText({ text: isHost ? "HOST" : "SYNC" });
        await chrome.action.setBadgeBackgroundColor({ color: isHost ? "#6366F1" : "#10B981" });

        // Start clock sync
        this.performClockSync();
        chrome.alarms.create("watchparty-clock-sync", { periodInMinutes: 1 });
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleServerMessage(data);
        } catch (e) {
          console.error("[WatchParty SW] Failed to parse message:", e);
        }
      };

      socket.onclose = async () => {
        console.log("[WatchParty SW] WebSocket closed");
        await chrome.action.setBadgeText({ text: "" });
        this.broadcastToPorts({ type: "DISCONNECTED_ROOM" });
      };

      socket.onerror = (err) => {
        console.warn("[WatchParty SW] WebSocket error:", err);
      };
    } catch (err: any) {
      console.error("[WatchParty SW] Connection error:", err);
      await chrome.storage.local.set({ connected: false });
    }
  }

  private async disconnectWebSocket(): Promise<void> {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    chrome.alarms.clear("watchparty-clock-sync");
    await chrome.storage.local.set({ connected: false, roomId: null });
    await chrome.action.setBadgeText({ text: "" });
    this.broadcastToPorts({ type: "DISCONNECTED_ROOM" });
  }

  private performClockSync(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const clientTime = Date.now();
    this.ws.send(JSON.stringify({
      type: "SYNC_CLOCK_PING",
      clientTime
    }));
  }

  private handleServerMessage(msg: any): void {
    if (!msg || !msg.type) return;

    if (typeof msg.type === "string" && msg.type.startsWith("CO_BROWSE_")) {
      this.broadcastToPorts(msg);
      return;
    }

    if (msg.type === "SYNC_CLOCK_PONG") {
      const now = Date.now();
      const rtt = now - msg.clientTime;
      const serverEstimated = msg.serverTime + (rtt / 2);
      this.clockOffsetMs = serverEstimated - now;

      this.broadcastToPorts({
        type: "CLOCK_OFFSET_UPDATE",
        offsetMs: this.clockOffsetMs
      });
      return;
    }

    if (msg.type === "ROOM_STATE" || msg.type === "PLAYBACK_STATE_CHANGED") {
      const roomPayload = msg.payload || msg;
      chrome.storage.local.get("isHost").then(({ isHost }) => {
        this.broadcastToPorts({
          type: "ROOM_STATE_UPDATE",
          payload: {
            roomId: roomPayload.roomId,
            state: roomPayload.state || (roomPayload.isPlaying ? "playing" : "paused"),
            positionMs: roomPayload.positionMs || 0,
            playbackRate: roomPayload.playbackRate || 1.0,
            updatedAtServerMs: roomPayload.updatedAt || Date.now(),
            isHost: !!isHost
          }
        });
      });
    }
  }

  private relayPlaybackToServer(payload: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    let eventType = "ROOM_PLAY";
    if (payload.action === "PAUSE") eventType = "ROOM_PAUSE";
    if (payload.action === "SEEK") eventType = "ROOM_SEEK";

    this.ws.send(JSON.stringify({
      type: eventType,
      positionMs: payload.positionMs,
      playbackRate: payload.playbackRate,
      clientTimestamp: payload.clientTimestamp
    }));
  }

  private broadcastToPorts(message: any): void {
    for (const port of this.ports) {
      try {
        port.postMessage(message);
      } catch (e) {
        this.ports.delete(port);
      }
    }
  }
}

// Start service worker
new WatchPartyServiceWorker();
