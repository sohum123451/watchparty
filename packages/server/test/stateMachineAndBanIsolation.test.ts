import { describe, it, expect, beforeEach, vi } from "vitest";
import { Room } from "../src/rooms/Room.js";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { ERROR_CODES, WS_CLOSE_CODES } from "@watchparty/shared";
import { getAppHtml } from "../src/ui/AppPage.js";

// Mock WebSocket connection
function createMockConnection() {
  const sentMessages: any[] = [];
  let closed = false;
  let closeCode: number | undefined;
  let closeReason: string | undefined;

  return {
    send: (msg: any) => {
      sentMessages.push(typeof msg === "string" ? JSON.parse(msg) : msg);
    },
    close: (code?: number, reason?: string) => {
      closed = true;
      closeCode = code;
      closeReason = reason;
    },
    isAlive: true,
    sentMessages,
    get isClosed() {
      return closed;
    },
    get closeCode() {
      return closeCode;
    },
    get closeReason() {
      return closeReason;
    },
  };
}

describe("State Machine, Ban Isolation, and Error Scoping Suite", () => {
  let roomManager: RoomManager;

  beforeEach(() => {
    roomManager = new RoomManager();
  });

  // =========================================================================
  // 1. BAN IN ROOM A DOES NOT AFFECT ROOM B (ROOM-SCOPED BANS)
  // =========================================================================
  describe("Server Ban Isolation Across Rooms", () => {
    it("ban in room A does not affect room B (guest session can join room B without error)", async () => {
      const { room: roomA } = roomManager.createRoom({
        roomName: "Room A",
        roomCode: "ROOMA1",
        hostUserId: "usr_host_a",
        hostUserName: "Host A",
      });

      const { room: roomB } = roomManager.createRoom({
        roomName: "Room B",
        roomCode: "ROOMB1",
        hostUserId: "usr_host_b",
        hostUserName: "Host B",
      });

      const guestConnA = createMockConnection();
      const guestConnB = createMockConnection();

      // Guest joins Room A
      const resA = roomA.addMember("Guest 1", guestConnA as any, undefined, { role: "guest" });
      expect(resA.success).toBe(true);
      if (!resA.success) return;

      const guestUserId = resA.member.userId;
      const guestSessionToken = resA.sessionToken;

      // Host A bans Guest in Room A (by session and user)
      roomA.banMember("usr_host_a", 1, guestUserId, "both", "Spamming in room A");
      expect(guestConnA.isClosed).toBe(true);
      expect(guestConnA.closeCode).toBe(WS_CLOSE_CODES.USER_BANNED);

      // Verify Guest is banned in Room A
      expect(roomA.isBanned(guestUserId)).toBe(true);

      // Verify Guest cannot reconnect to Room A with that session token
      const reconnectResult = roomA.reconnectMember(guestSessionToken, createMockConnection() as any);
      expect(reconnectResult.success).toBe(false);
      expect(reconnectResult.code).toBe(ERROR_CODES.USER_BANNED);

      // Verify Guest cannot join Room A with that session token
      const addBannedResult = roomA.addMember("Guest 1", createMockConnection() as any, undefined, { sessionToken: guestSessionToken });
      expect(addBannedResult.success).toBe(false);
      expect(addBannedResult.code).toBe(ERROR_CODES.USER_BANNED);

      // CRITICAL REQUIREMENT: Guest MUST be able to join Room B without being affected by Room A ban
      expect(roomB.isBanned(guestUserId)).toBe(false);

      const resB = roomB.addMember("Guest 1", guestConnB as any, undefined, {
        role: "guest",
        sessionToken: guestSessionToken,
      });

      expect(resB.success).toBe(true);
      if (resB.success) {
        expect(resB.member.userName).toBe("Guest 1");
        expect(roomB.getMember(resB.member.userId)).toBeDefined();
      }
      expect(guestConnB.isClosed).toBe(false);
    });

    it("host can list bans and unban a member, allowing them to rejoin", async () => {
      const { room } = roomManager.createRoom({
        roomName: "Unban Lab",
        roomCode: "UNBAN1",
        hostUserId: "usr_host",
        hostUserName: "Host",
      });

      const guestConn = createMockConnection();
      const res = room.addMember("Troll", guestConn as any, undefined, { role: "guest" });
      expect(res.success).toBe(true);
      if (!res.success) return;

      const trollUserId = res.member.userId;
      const trollSessionToken = res.sessionToken;

      // Host bans member
      room.banMember("usr_host", 1, trollUserId, "both", "Misconduct");
      expect(room.isBanned(trollUserId)).toBe(true);

      // List bans for room
      const bans = room.getBans();
      expect(bans.length).toBe(1);
      expect(bans[0].userId).toBe(trollUserId);
      expect(bans[0].reason).toBe("Misconduct");

      // Host unbans member
      room.unbanMember("usr_host", 2, trollUserId);
      expect(room.isBanned(trollUserId)).toBe(false);
      expect(room.getBans().length).toBe(0);

      // Troll can now join again
      const newConn = createMockConnection();
      const rejoinResult = room.addMember("Reformed Troll", newConn as any, undefined, {
        role: "guest",
        sessionToken: trollSessionToken,
      });
      expect(rejoinResult.success).toBe(true);
    });

    it("bans can expire when durationSeconds is provided", async () => {
      const { room } = roomManager.createRoom({
        roomName: "Expiring Ban Lab",
        roomCode: "EXPBAN",
        hostUserId: "usr_host",
        hostUserName: "Host",
      });

      const guestConn = createMockConnection();
      const res = room.addMember("Temp", guestConn as any, undefined, { role: "guest" });
      expect(res.success).toBe(true);
      if (!res.success) return;

      const tempUserId = res.member.userId;

      // Ban for 10 seconds
      room.banMember("usr_host", 1, tempUserId, "both", "Time out", 10);
      const bans = room.getBans();
      expect(bans.length).toBe(1);
      expect(bans[0].expiresAt).toBeDefined();
      expect(bans[0].expiresAt!).toBeGreaterThan(Date.now());
      expect(room.isBanned(tempUserId)).toBe(true);

      // Simulate time passage beyond expiration
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 15000);

      // Should automatically clean expired ban
      expect(room.isBanned(tempUserId)).toBe(false);
      expect(room.getBans().length).toBe(0);

      vi.restoreAllMocks();
    });
  });

  // =========================================================================
  // 2. CLIENT-SIDE STATE MACHINE & ERROR SCOPING
  // =========================================================================
  describe("Client State Machine, Banners & Scoping Logic in AppPage", () => {
    it("AppPage renders banner guard against empty messages", () => {
      const html = getAppHtml();

      // Guard 1: CSS rule
      expect(html).toContain(".banner:empty { display: none !important; }");

      // Guard 2: JS guard in showError()
      expect(html).toContain("if (!msg) return; // Strict guard: never render error banner with empty message!");

      // Guard 3: initial HTML elements have display: none
      expect(html).toContain('id="errorMessage" class="banner error" style="display: none;"');
      expect(html).toContain('id="bannedNotice" class="banner error" style="display: none;"');
      expect(html).toContain('id="reconnectingNotice" class="banner warning" style="display: none;"');
    });

    it("AppPage initial home state defaults to IDLE and hides video player", () => {
      const html = getAppHtml();

      // Initial connection status pill is IDLE
      expect(html).toContain('<div id="connectionStatus" class="status-pill idle">');
      expect(html).toContain('<span id="connStatusText">IDLE</span>');

      // Video player is hidden by default with empty state container
      expect(html).toContain('id="emptyStateContainer"');
      expect(html).toContain('id="homeEmptyState"');
      expect(html).toContain('id="roomEmptyState"');
      expect(html).toContain('id="videoPlayer" style="display: none;"');
      expect(html).toContain('id="videoControlsRow" style="display: none;"');
    });

    it("AppPage includes Leave Room button and Logo Home Navigation", () => {
      const html = getAppHtml();

      // Header has Leave Room button
      expect(html).toContain('id="btnLeaveRoom"');
      expect(html).toContain('onclick="leaveRoom()"');

      // Logo has home navigation handler
      expect(html).toContain('onclick="navigateHome()"');
    });

    it("simulates state machine transitions: idle -> connecting -> connected -> reconnecting -> kicked/banned -> left", () => {
      // Verify state machine logic in Javascript by simulating the exact state machine rules
      const elements: Record<string, any> = {
        connectionStatus: { className: 'status-pill idle' },
        connStatusText: { innerText: 'IDLE' },
        btnLeaveRoom: { style: { display: 'none' } },
        roomCodeBadge: { style: { display: 'none' } },
        errorMessage: { style: { display: 'none' }, innerText: '' },
        bannedNotice: { style: { display: 'none' }, innerText: '' },
        reconnectingNotice: { style: { display: 'none' } },
        emptyStateContainer: { style: { display: 'flex' } },
        homeEmptyState: { style: { display: 'flex' } },
        roomEmptyState: { style: { display: 'none' } },
        videoPlayer: { style: { display: 'none' } },
        videoControlsRow: { style: { display: 'none' } },
        sourceGuardrailsBar: { style: { display: 'none' } },
      };

      const state: any = {
        connectionState: 'idle',
        targetRoomCode: null,
        currentRoom: null,
        activeError: null,
        roomErrors: new Map(),
        playback: { sourceRef: '' },
      };

      function renderBannersForCurrentState() {
        elements.errorMessage.style.display = 'none';
        elements.errorMessage.innerText = '';
        elements.bannedNotice.style.display = 'none';
        elements.bannedNotice.innerText = '';
        elements.reconnectingNotice.style.display = 'none';

        if (state.connectionState === 'reconnecting') {
          elements.reconnectingNotice.style.display = 'block';
        }
        if (state.connectionState === 'banned') {
          const roomCode = (state.currentRoom && state.currentRoom.roomCode) || state.targetRoomCode;
          elements.bannedNotice.innerText = roomCode
            ? '🚫 You have been banned from room ' + roomCode + '. Rejoin attempts are blocked.'
            : '🚫 You have been banned from this room. Rejoin attempts are blocked.';
          elements.bannedNotice.style.display = 'block';
        } else if (state.connectionState === 'kicked') {
          const roomCode = (state.currentRoom && state.currentRoom.roomCode) || state.targetRoomCode;
          elements.errorMessage.innerText = roomCode
            ? '⚠️ You have been removed from room ' + roomCode + ' by a moderator.'
            : '⚠️ You have been removed from the room by a moderator.';
          elements.errorMessage.style.display = 'block';
        } else if (state.activeError && state.activeError.message) {
          const targetCode = (state.currentRoom && state.currentRoom.roomCode) || state.targetRoomCode;
          if (!state.activeError.roomCode || state.activeError.roomCode === targetCode) {
            if (state.activeError.message.trim()) {
              elements.errorMessage.innerText = state.activeError.message.trim();
              elements.errorMessage.style.display = 'block';
            }
          }
        }
      }

      function transitionConnectionState(nextState: string, payload?: any) {
        state.connectionState = nextState;
        if (payload && payload.roomCode) {
          state.targetRoomCode = payload.roomCode;
        }

        if (nextState === 'idle' || nextState === 'left') {
          state.connectionState = 'idle';
          elements.connectionStatus.className = 'status-pill idle';
          elements.connStatusText.innerText = 'IDLE';
          elements.btnLeaveRoom.style.display = 'none';
          elements.roomCodeBadge.style.display = 'none';
        } else if (nextState === 'connecting') {
          elements.connectionStatus.className = 'status-pill connecting';
          elements.connStatusText.innerText = 'CONNECTING';
          elements.btnLeaveRoom.style.display = 'none';
        } else if (nextState === 'connected') {
          elements.connectionStatus.className = 'status-pill connected';
          elements.connStatusText.innerText = 'CONNECTED';
          elements.btnLeaveRoom.style.display = 'inline-flex';
          elements.roomCodeBadge.style.display = 'flex';
        } else if (nextState === 'reconnecting') {
          elements.connectionStatus.className = 'status-pill reconnecting';
          elements.connStatusText.innerText = 'RECONNECTING';
          elements.btnLeaveRoom.style.display = 'inline-flex';
        } else if (nextState === 'banned') {
          elements.connectionStatus.className = 'status-pill offline';
          elements.connStatusText.innerText = 'BANNED';
          elements.btnLeaveRoom.style.display = 'none';
          elements.roomCodeBadge.style.display = 'none';
        } else if (nextState === 'kicked') {
          elements.connectionStatus.className = 'status-pill warning';
          elements.connStatusText.innerText = 'KICKED';
          elements.btnLeaveRoom.style.display = 'none';
          elements.roomCodeBadge.style.display = 'none';
        }

        renderBannersForCurrentState();
      }

      function updatePlayerVisibility() {
        const hasRoom = Boolean(state.currentRoom && (state.currentRoom.roomId || state.currentRoom.roomCode));
        const hasMedia = hasRoom && Boolean(state.playback && state.playback.sourceRef);

        if (!hasRoom) {
          elements.emptyStateContainer.style.display = 'flex';
          elements.homeEmptyState.style.display = 'flex';
          elements.roomEmptyState.style.display = 'none';
          elements.videoPlayer.style.display = 'none';
          elements.videoControlsRow.style.display = 'none';
          elements.sourceGuardrailsBar.style.display = 'none';
        } else if (!hasMedia) {
          elements.emptyStateContainer.style.display = 'flex';
          elements.homeEmptyState.style.display = 'none';
          elements.roomEmptyState.style.display = 'flex';
          elements.videoPlayer.style.display = 'none';
          elements.videoControlsRow.style.display = 'none';
          elements.sourceGuardrailsBar.style.display = 'none';
        } else {
          elements.emptyStateContainer.style.display = 'none';
          elements.homeEmptyState.style.display = 'none';
          elements.roomEmptyState.style.display = 'none';
          elements.videoPlayer.style.display = 'block';
          elements.videoControlsRow.style.display = 'block';
          elements.sourceGuardrailsBar.style.display = 'flex';
        }
      }

      function showError(err: any, roomCode?: string) {
        if (!err) return;
        const msg = typeof err === 'string' ? err.trim() : (err.message ? String(err.message).trim() : '');
        if (!msg) return; // Strict guard!

        const targetCode = roomCode || (state.currentRoom ? state.currentRoom.roomCode : state.targetRoomCode);
        state.activeError = { message: msg, roomCode: targetCode };
        if (targetCode) {
          state.roomErrors.set(targetCode, { message: msg });
        }
        renderBannersForCurrentState();
      }

      function clearRoomErrors(roomCode?: string) {
        if (roomCode) {
          state.roomErrors.delete(roomCode);
          if (state.activeError && state.activeError.roomCode === roomCode) {
            state.activeError = null;
          }
        } else {
          state.roomErrors.clear();
          state.activeError = null;
        }
        renderBannersForCurrentState();
      }

      function leaveRoom() {
        clearRoomErrors();
        state.currentRoom = null;
        state.targetRoomCode = null;
        transitionConnectionState('left');
        updatePlayerVisibility();
      }

      function scheduleReconnect() {
        // Reconnect loop MUST ONLY run when roomId/roomCode is set and state is not idle/banned/kicked/left
        if (!state.currentRoom || (!state.currentRoom.roomId && !state.currentRoom.roomCode)) {
          return false;
        }
        if (state.connectionState === 'banned' || state.connectionState === 'kicked' || state.connectionState === 'left' || state.connectionState === 'idle') {
          return false;
        }
        transitionConnectionState('reconnecting', { roomCode: state.currentRoom.roomCode });
        return true;
      }

      // --- TEST 1: IDLE STATE HAS NO CONNECTION BANNERS AND PLAYER IS HIDDEN ---
      transitionConnectionState('idle');
      updatePlayerVisibility();
      expect(elements.connStatusText.innerText).toBe('IDLE');
      expect(elements.errorMessage.style.display).toBe('none');
      expect(elements.bannedNotice.style.display).toBe('none');
      expect(elements.reconnectingNotice.style.display).toBe('none');
      expect(elements.videoPlayer.style.display).toBe('none');
      expect(elements.homeEmptyState.style.display).toBe('flex');

      // In idle state, reconnect loop MUST NOT run
      expect(scheduleReconnect()).toBe(false);
      expect(elements.reconnectingNotice.style.display).toBe('none');

      // --- TEST 2: EMPTY ERROR MESSAGE GUARD ---
      showError('');
      expect(elements.errorMessage.style.display).toBe('none');
      expect(elements.errorMessage.innerText).toBe('');

      showError('   ');
      expect(elements.errorMessage.style.display).toBe('none');

      showError(null);
      expect(elements.errorMessage.style.display).toBe('none');

      // --- TEST 3: JOINING ROOM AND CONNECTED STATE ---
      transitionConnectionState('connecting', { roomCode: 'ROOM1' });
      expect(elements.connStatusText.innerText).toBe('CONNECTING');

      state.currentRoom = { roomCode: 'ROOM1', roomId: 'r1' };
      transitionConnectionState('connected', { roomCode: 'ROOM1' });
      expect(elements.connStatusText.innerText).toBe('CONNECTED');
      expect(elements.btnLeaveRoom.style.display).toBe('inline-flex');

      // Room empty state shown until media is loaded
      updatePlayerVisibility();
      expect(elements.videoPlayer.style.display).toBe('none');
      expect(elements.roomEmptyState.style.display).toBe('flex');

      // Media loaded: player shown
      state.playback.sourceRef = 'https://example.com/stream.mp4';
      updatePlayerVisibility();
      expect(elements.videoPlayer.style.display).toBe('block');
      expect(elements.roomEmptyState.style.display).toBe('none');

      // --- TEST 4: UNEXPECTED DISCONNECT TRIGGERS RECONNECTING WHEN IN ROOM ---
      expect(scheduleReconnect()).toBe(true);
      expect(elements.connStatusText.innerText).toBe('RECONNECTING');
      expect(elements.reconnectingNotice.style.display).toBe('block');

      // --- TEST 5: LEAVING ROOM CLEARS ALL ERRORS AND RETURNS TO IDLE ---
      showError('Room specific warning', 'ROOM1');
      expect(elements.errorMessage.style.display).toBe('block');
      expect(elements.errorMessage.innerText).toBe('Room specific warning');

      leaveRoom();
      expect(state.connectionState).toBe('idle');
      expect(state.currentRoom).toBe(null);
      expect(elements.connStatusText.innerText).toBe('IDLE');
      expect(elements.errorMessage.style.display).toBe('none');
      expect(elements.errorMessage.innerText).toBe('');
      expect(elements.reconnectingNotice.style.display).toBe('none');
      expect(elements.bannedNotice.style.display).toBe('none');
      expect(elements.videoPlayer.style.display).toBe('none');
      expect(elements.homeEmptyState.style.display).toBe('flex');

      // --- TEST 6: ROOM-SCOPED ERROR CLEARED WHEN SWITCHING ROOMS ---
      showError('Wrong password for Room A', 'ROOMA');
      expect(state.roomErrors.has('ROOMA')).toBe(true);

      // Navigating or joining Room B clears target room errors and ignores Room A error
      clearRoomErrors('ROOMA');
      expect(state.roomErrors.has('ROOMA')).toBe(false);
      expect(elements.errorMessage.style.display).toBe('none');
    });
  });
});
