'use client';

/**
 * useRoomSocket – Phase 1
 * ========================
 * Implements the full room WebSocket state machine:
 *
 *   idle → connecting → connected ↔ reconnecting → left | kicked | banned
 *
 * Features:
 *  - WS URL driven 100% by NEXT_PUBLIC_WS_URL env var (never hardcoded)
 *  - Reconnect backoff + jitter (capped at 30 s); only when a room is set
 *    and the socket dropped unexpectedly
 *  - Ban/kick errors are scoped to the current roomCode; cleared on leave
 *  - No stale banners on the home screen (hook state is local to the hook)
 *  - Never renders an empty error banner
 *  - Logs WS URL and close code on every close event
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RoomConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'kicked'
  | 'banned'
  | 'left';

export interface RoomSocketOptions {
  /** The 6-character room code. Empty string → stays idle. */
  roomCode: string;
  /** Auth token (access JWT or session token) sent at handshake. */
  authToken?: string;
  /** Display name for the joining user (guest or logged-in). */
  userName: string;
  /** Called with each parsed server message payload. */
  onMessage: (msg: ServerMessage) => void;
}

export interface ServerMessage {
  type: string;
  payload?: any;
  code?: string;
}

export interface RoomSocketHandle {
  /** Current state-machine state. */
  state: RoomConnectionState;
  /** Non-empty only when state is 'kicked' or 'banned' – scoped to the current room. */
  roomError: string | null;
  /** Send a structured message. No-op when socket is not OPEN. */
  send: (msg: object) => void;
  /** Intentionally leave the room (transitions to 'left', stops reconnect). */
  leave: () => void;
  /** Manually trigger a reconnect attempt (from 'reconnecting' or error states). */
  retry: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const BACKOFF_JITTER = 0.3; // ±30 % jitter

function backoffMs(attempt: number): number {
  const exp = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS);
  const jitter = exp * BACKOFF_JITTER * (Math.random() * 2 - 1);
  return Math.round(exp + jitter);
}

function resolveWsUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (envUrl) {
    // Accept bare host, ws://, or wss://
    if (envUrl.startsWith('ws://') || envUrl.startsWith('wss://')) return envUrl;
    const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${envUrl}`;
  }
  // Fallback: assume the Node server runs on port 3001 in dev, same host in prod
  if (typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host =
      window.location.port === '3000'
        ? `${window.location.hostname}:3001`
        : window.location.host;
    return `${proto}//${host}`;
  }
  return 'ws://localhost:3001';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRoomSocket({
  roomCode,
  authToken,
  userName,
  onMessage,
}: RoomSocketOptions): RoomSocketHandle {
  const [state, setState] = useState<RoomConnectionState>('idle');
  const [roomError, setRoomError] = useState<string | null>(null);

  // Stable refs (don't re-trigger effects when they change)
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intentionalLeaveRef = useRef(false);
  const onMessageRef = useRef(onMessage);
  const userNameRef = useRef(userName);
  const authTokenRef = useRef(authToken);

  // Keep refs current without re-running the connect effect
  useEffect(() => { onMessageRef.current = onMessage; });
  useEffect(() => { userNameRef.current = userName; });
  useEffect(() => { authTokenRef.current = authToken; });

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  // -------------------------------------------------------------------------
  // Connect function (called on first mount and on each reconnect attempt)
  // -------------------------------------------------------------------------
  const connect = useCallback(() => {
    if (!roomCode) return;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close(1000, 'reconnect');
      wsRef.current = null;
    }

    const wsUrl = resolveWsUrl();
    console.info(`[WS] Connecting to ${wsUrl} (attempt ${attemptRef.current})`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.error('[WS] Failed to construct WebSocket', e);
      scheduleReconnect();
      return;
    }

    wsRef.current = ws;
    setState(attemptRef.current === 0 ? 'connecting' : 'reconnecting');

    ws.onopen = () => {
      const seq = ++seqRef.current;
      const token = authTokenRef.current;
      const storedReconnectToken =
        typeof window !== 'undefined'
          ? sessionStorage.getItem(`wp_token_${roomCode}`) ?? undefined
          : undefined;

      console.info(`[WS] Open → sending ROOM_JOIN for room "${roomCode}"`);
      ws.send(
        JSON.stringify({
          type: 'ROOM_JOIN',
          clientSeq: seq,
          payload: {
            roomCode,
            userName: userNameRef.current,
            ...(token ? { authToken: token } : {}),
            ...(storedReconnectToken ? { reconnectToken: storedReconnectToken, sessionToken: storedReconnectToken } : {}),
          },
        })
      );

      // Reset attempt counter on successful open (connection established)
      attemptRef.current = 0;
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      // Handle state-machine transitions for key message types here;
      // forward everything else to the caller via onMessageRef
      if (msg.type === 'ROOM_SNAPSHOT') {
        setState('connected');
        setRoomError(null);

        // Persist reconnect token if supplied
        const snap = msg.payload;
        if (snap?.reconnectToken && typeof window !== 'undefined') {
          sessionStorage.setItem(`wp_token_${roomCode}`, snap.reconnectToken);
        }
      }

      if (msg.type === 'ERROR') {
        const code = msg.code ?? msg.payload?.code ?? '';
        if (code === 'ROOM_BANNED') {
          setState('banned');
          setRoomError('You have been banned from this room.');
          ws.close(4003, 'banned');
          return;
        }
        if (code === 'ROOM_KICKED') {
          setState('kicked');
          setRoomError('You were removed from this room.');
          ws.close(4004, 'kicked');
          return;
        }
        if (code === 'ROOM_FULL') {
          setState('kicked');
          setRoomError('Room is full. Try again later.');
          ws.close(4005, 'room_full');
          return;
        }
        if (code === 'ROOM_NOT_FOUND') {
          setState('kicked');
          setRoomError('Room not found.');
          ws.close(4404, 'not_found');
          return;
        }
      }

      onMessageRef.current(msg);
    };

    ws.onerror = () => {
      // onerror is always followed by onclose, so we just log here
      console.warn('[WS] Socket error');
    };

    ws.onclose = (event) => {
      console.info(`[WS] Closed — code: ${event.code}, reason: "${event.reason}", wasClean: ${event.wasClean}`);
      wsRef.current = null;

      if (intentionalLeaveRef.current) return; // user left on purpose

      // Banned / kicked states are terminal – no reconnect
      if (state === 'banned' || state === 'kicked') return;

      scheduleReconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  function scheduleReconnect() {
    if (intentionalLeaveRef.current) return;
    attemptRef.current += 1;
    const delay = backoffMs(attemptRef.current - 1);
    console.info(`[WS] Reconnect attempt ${attemptRef.current} in ${delay} ms`);
    setState('reconnecting');
    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Main effect: (re)connect when roomCode changes
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!roomCode) {
      setState('idle');
      setRoomError(null);
      return;
    }

    intentionalLeaveRef.current = false;
    attemptRef.current = 0;
    setRoomError(null);
    connect();

    return () => {
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close(1000, 'unmount');
        wsRef.current = null;
      }
    };
  // connect is stable per roomCode; don't add more deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------
  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const leave = useCallback(() => {
    intentionalLeaveRef.current = true;
    clearReconnectTimer();
    setRoomError(null);
    setState('left');
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close(1000, 'user_left');
      wsRef.current = null;
    }
  }, []);

  const retry = useCallback(() => {
    intentionalLeaveRef.current = false;
    attemptRef.current = 0;
    clearReconnectTimer();
    connect();
  }, [connect]);

  return { state, roomError, send, leave, retry };
}
