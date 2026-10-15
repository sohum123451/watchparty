import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import WebSocket from "ws";
import { getManifestJson, getServiceWorkerJs, getOfflineHtml, getAppIconSvg } from "../src/ui/pwa.js";
import { getAppHtml } from "../src/ui/AppPage.js";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { WebSocketGateway } from "../src/gateway/WebSocketGateway.js";

describe("Mobile Experience & PWA Suite", () => {
  describe("PWA Assets & Shell", () => {
    it("generates valid Web App Manifest with required PWA metadata", () => {
      const manifestStr = getManifestJson();
      const manifest = JSON.parse(manifestStr);

      expect(manifest.name).toBe("WatchParty - Synchronized Video & Co-Watching");
      expect(manifest.short_name).toBe("WatchParty");
      expect(manifest.display).toBe("standalone");
      expect(manifest.start_url).toBe("/app");
      expect(manifest.theme_color).toBe("#090d16");
      expect(manifest.background_color).toBe("#090d16");
      expect(manifest.icons).toHaveLength(3);
      expect(manifest.icons[0].sizes).toBe("192x192");
      expect(manifest.icons[1].sizes).toBe("512x512");
      expect(manifest.icons[0].type).toBe("image/svg+xml");
    });

    it("generates Service Worker with offline shell caching and fetch interception", () => {
      const swJs = getServiceWorkerJs();
      expect(swJs).toContain("const CACHE_NAME");
      expect(swJs).toContain("self.addEventListener('install'");
      expect(swJs).toContain("self.addEventListener('activate'");
      expect(swJs).toContain("self.addEventListener('fetch'");
      expect(swJs).toContain("/offline.html");
      expect(swJs).toContain("caches.match(OFFLINE_URL)");
    });

    it("generates offline fallback HTML with retry button", () => {
      const html = getOfflineHtml();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("You are Offline");
      expect(html).toContain("window.location.reload()");
      expect(html).toContain("WatchParty requires an active internet connection");
    });

    it("generates crisp SVG app icons for both small and large sizes", () => {
      const icon192 = getAppIconSvg(192);
      const icon512 = getAppIconSvg(512);

      expect(icon192).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(icon192).toContain('viewBox="0 0 512 512"');
      expect(icon512).toContain('viewBox="0 0 512 512"');
    });
  });

  describe("HTML & CSS Mobile Hardening in getAppHtml()", () => {
    const html = getAppHtml();

    it("includes safe-area insets and modern viewport meta tag", () => {
      expect(html).toContain("viewport-fit=cover");
      expect(html).toContain("interactive-widget=resizes-content");
      expect(html).toContain("--sat: env(safe-area-inset-top");
      expect(html).toContain("--sab: env(safe-area-inset-bottom");
      expect(html).toContain("--sal: env(safe-area-inset-left");
      expect(html).toContain("--sar: env(safe-area-inset-right");
      expect(html).toContain("padding-top: var(--sat)");
      expect(html).toContain("padding-bottom: var(--sab)");
    });

    it("includes tabbed bottom sheet layout for mobile", () => {
      expect(html).toContain('class="bottom-sheet-handle-wrap"');
      expect(html).toContain('class="bottom-sheet-handle"');
      expect(html).toContain('id="sidePanel"');
      expect(html).toContain("toggleBottomSheet()");
      expect(html).toContain("switchTab('chatTab')");
      expect(html).toContain("switchTab('playlistTab')");
      expect(html).toContain("switchTab('pollsTab')");
      expect(html).toContain("switchTab('membersTab')");
    });

    it("includes landscape fullscreen with floating reactions and collapsible chat overlay", () => {
      expect(html).toContain('id="floatingReactionsContainer"');
      expect(html).toContain('id="landscapeReactionsBar"');
      expect(html).toContain('id="btnToggleLandscapeChat"');
      expect(html).toContain('id="landscapeChatOverlay"');
      expect(html).toContain("emitReaction('❤️')");
      expect(html).toContain("toggleLandscapeChat()");
      expect(html).toContain("sendLandscapeChat()");
      expect(html).toContain("@media (orientation: landscape) and (max-height: 550px)");
    });

    it("includes In-App Browser (IAB) detection banner with copy link action", () => {
      expect(html).toContain('id="iabWarningBanner"');
      expect(html).toContain("In-App Browser Detected");
      expect(html).toContain("copyCurrentRoomUrl(this)");
      expect(html).toContain("/Instagram|FBAN|FBAV|WhatsApp|Telegram|Line|Twitter|MicroMessenger/i");
    });

    it("includes PWA install prompt banner", () => {
      expect(html).toContain('id="pwaInstallBanner"');
      expect(html).toContain("Install WatchParty App");
      expect(html).toContain("triggerPwaInstall()");
      expect(html).toContain("dismissPwaInstall()");
      expect(html).toContain("beforeinstallprompt");
    });

    it("includes deep link parser supporting paths, search params, and hash fragments", () => {
      expect(html).toContain("new RegExp('/join/([A-Za-z0-9_-]+)')");
      expect(html).toContain("urlParams.get('room')");
      expect(html).toContain("new RegExp('(?:#room=|^#)([A-Za-z0-9_-]{4,10})')");
      expect(html).toContain("submitJoinRoom(deepRoomCode, savedName)");
    });

    it("includes screen lock recovery, network switch handling, and keyboard awareness", () => {
      expect(html).toContain("document.addEventListener('visibilitychange'");
      expect(html).toContain("window.addEventListener('online'");
      expect(html).toContain("window.addEventListener('offline'");
      expect(html).toContain("window.visualViewport");
      expect(html).toContain("keyboardOffset");
      expect(html).toContain("@media (prefers-reduced-motion: reduce)");
    });

    it("includes Polls UI and Create Poll modal", () => {
      expect(html).toContain('id="pollsTab"');
      expect(html).toContain('id="activePollCard"');
      expect(html).toContain('id="noPollCard"');
      expect(html).toContain('id="createPollModal"');
      expect(html).toContain("openCreatePollModal()");
      expect(html).toContain("submitCreatePoll()");
      expect(html).toContain("submitVotePoll");
    });
  });

  describe("Polls WebSocket Lifecycle", () => {
    let server: http.Server;
    let gateway: WebSocketGateway;
    let roomManager: RoomManager;
    let port: number;

    beforeEach(async () => {
      server = http.createServer();
      roomManager = new RoomManager();
      gateway = new WebSocketGateway(server, roomManager, { enforceVerifiedToCreateRoom: false });
      await new Promise<void>((resolve) => {
        server.listen(0, () => {
          port = (server.address() as any).port;
          roomManager.setBaseUrl(`http://127.0.0.1:${port}`);
          resolve();
        });
      });
    });

    afterEach(async () => {
      gateway.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    function connectWs(): Promise<WebSocket> {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.on("open", () => resolve(ws));
        ws.on("error", reject);
      });
    }

    function waitForMessage(ws: WebSocket, type: string, predicate?: (msg: any) => boolean): Promise<any> {
      return new Promise((resolve) => {
        const handler = (data: WebSocket.Data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === type && (!predicate || predicate(msg))) {
            ws.off("message", handler);
            resolve(msg);
          }
        };
        ws.on("message", handler);
      });
    }

    it("creates, votes on, and closes a poll with broadcast updates", async () => {
      const hostWs = await connectWs();
      const guestWs = await connectWs();

      // Host creates room
      const hostSnapshotPromise = waitForMessage(hostWs, "ROOM_SNAPSHOT");
      hostWs.send(JSON.stringify({
        type: "ROOM_CREATE",
        clientSeq: 1,
        payload: { roomName: "Movie Night", userName: "HostUser" }
      }));
      const createdMsg = await hostSnapshotPromise;
      const roomCode = createdMsg.payload.roomCode;

      // Guest joins room
      const guestSnapshotPromise = waitForMessage(guestWs, "ROOM_SNAPSHOT");
      guestWs.send(JSON.stringify({
        type: "ROOM_JOIN",
        clientSeq: 1,
        payload: { roomCode, userName: "GuestUser" }
      }));
      await guestSnapshotPromise;

      // Host launches a poll
      const hostPollUpdatePromise = waitForMessage(hostWs, "POLL_UPDATED");
      const guestPollUpdatePromise = waitForMessage(guestWs, "POLL_UPDATED");

      hostWs.send(JSON.stringify({
        type: "POLL_CREATE",
        clientSeq: 2,
        payload: {
          question: "Which movie next?",
          options: ["Inception", "Interstellar"],
          durationSeconds: 15,
          autoQueueWinner: false,
        }
      }));

      const hostPollUpdate = await hostPollUpdatePromise;
      const guestPollUpdate = await guestPollUpdatePromise;

      expect(hostPollUpdate.payload.poll.question).toBe("Which movie next?");
      expect(guestPollUpdate.payload.poll.options).toHaveLength(2);
      expect(guestPollUpdate.payload.poll.isClosed).toBe(false);

      const pollId = hostPollUpdate.payload.poll.id;

      // Guest votes for option 1 (Interstellar)
      const voteUpdatePromise = waitForMessage(hostWs, "POLL_UPDATED");
      guestWs.send(JSON.stringify({
        type: "POLL_VOTE",
        clientSeq: 2,
        payload: {
          pollId,
          optionIndex: 1,
        }
      }));

      const votedPoll = await voteUpdatePromise;
      expect(votedPoll.payload.poll.options[1].votes).toBe(1);

      // Host closes poll early
      const closedUpdatePromise = waitForMessage(guestWs, "POLL_UPDATED", (m) => m.payload?.poll?.isClosed === true);
      hostWs.send(JSON.stringify({
        type: "POLL_CLOSE",
        clientSeq: 3,
        payload: { pollId }
      }));

      const closedPoll = await closedUpdatePromise;
      expect(closedPoll.payload.poll.isClosed).toBe(true);
      expect(closedPoll.payload.poll.winnerOptionText).toBe("Interstellar");

      hostWs.close();
      guestWs.close();
    });
  });
});
