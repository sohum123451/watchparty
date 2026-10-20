import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer, IncomingMessage } from "node:http";
import {
  ClientMessage,
  ClientMessageSchema,
  ERROR_CODES,
  WS_CLOSE_CODES,
  ROOM_CONSTANTS,
  safeJsonParse,
} from "@watchparty/shared";
import { RoomManager } from "../rooms/RoomManager.js";
import { Connection } from "./Connection.js";
import { AuthService } from "../auth/services/AuthService.js";
import { TokenSecurity } from "../auth/crypto/tokens.js";
import { FriendsService } from "../friends/services/FriendsService.js";
import { auditLogger } from "../security/AuditLogger.js";
import { defaultSecurityMiddleware } from "../security/headers.js";
import { MetricsCollector } from "../metrics/MetricsCollector.js";
import type { RedisRoomAdapter } from "../redis/RedisRoomAdapter.js";
import { Logger, rootLogger } from "../utils/logger.js";

export interface WebSocketGatewayOptions {
  authService?: AuthService;
  friendsService?: FriendsService;
  enforceVerifiedToCreateRoom?: boolean;
  metricsCollector?: MetricsCollector;
  redisAdapter?: RedisRoomAdapter;
  logger?: Logger;
}

export class WebSocketGateway {
  private wss: WebSocketServer;
  private roomManager: RoomManager;
  private connections: Set<Connection>;
  private heartbeatInterval: NodeJS.Timeout | null;
  private authService?: AuthService;
  private friendsService?: FriendsService;
  private enforceVerifiedToCreateRoom: boolean;
  private metricsCollector?: MetricsCollector;
  private redisAdapter?: RedisRoomAdapter;
  private logger: Logger;

  constructor(
    server: HttpServer,
    roomManager: RoomManager,
    options: WebSocketGatewayOptions = {}
  ) {
    this.wss = new WebSocketServer({ server });
    this.roomManager = roomManager;
    this.connections = new Set();
    this.heartbeatInterval = null;
    this.authService = options.authService;
    this.friendsService = options.friendsService;
    this.enforceVerifiedToCreateRoom = options.enforceVerifiedToCreateRoom ?? false;
    this.metricsCollector = options.metricsCollector;
    this.redisAdapter = options.redisAdapter;
    this.logger = options.logger || rootLogger;

    if (this.redisAdapter) {
      this.redisAdapter.setRemoteBroadcastHandler((roomId, message) => {
        const room = this.roomManager.getRoomById(roomId);
        if (room) {
          room.broadcastLocal(message);
        }
      });
    }

    this.wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    this.startHeartbeat();
  }

  private async handleConnection(ws: WebSocket, req?: IncomingMessage): Promise<void> {
    // Validate handshake origin if provided (browser WebSocket client)
    if (req && req.headers.origin) {
      const origin = req.headers.origin;
      const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
      if (!defaultSecurityMiddleware.isOriginAllowed(origin, host)) {
        this.logger.warn(`[WS_SECURITY] Rejected WebSocket connection from untrusted origin: ${origin} (Host: ${host})`);
        ws.close(WS_CLOSE_CODES.POLICY_VIOLATION || 1008, "Untrusted Origin");
        return;
      }
    }

    const conn = new Connection(ws);
    this.connections.add(conn);
    this.metricsCollector?.incrementConnectedSockets();
    this.metricsCollector?.setActiveRooms(this.roomManager.getActiveRoomCount());

    const origSend = conn.send.bind(conn);
    conn.send = (message) => {
      this.metricsCollector?.recordOutboundMessage();
      origSend(message);
    };

    const origSendError = conn.sendError.bind(conn);
    conn.sendError = (code, msg, clientSeq, details) => {
      this.metricsCollector?.recordError(code);
      this.logger.withRoomAndUser(conn.roomId, conn.userId).warn(`[WS_ERROR] ${code}: ${msg}`, {
        errorCode: code,
        clientSeq,
        details,
      });
      origSendError(code, msg, clientSeq, details);
    };

    // ==========================================
    // WEBSOCKET HANDSHAKE AUTHENTICATION
    // ==========================================
    if (req && this.authService) {
      // 1. Check ticket in headers, query string, or sec-websocket-protocol
      let ticket = (req.headers["x-ws-ticket"] as string) || undefined;
      const reqUrl = req.url ? new URL(req.url, "http://localhost") : null;
      if (!ticket && reqUrl) {
        ticket = reqUrl.searchParams.get("ticket") || undefined;
      }
      const protocolHeader = req.headers["sec-websocket-protocol"];
      if (!ticket && protocolHeader) {
        const protocols = protocolHeader.split(",").map((p) => p.trim());
        const ticketProto = protocols.find((p) => p.startsWith("wst_"));
        if (ticketProto) {
          ticket = ticketProto;
        }
      }

      // 2. Check Bearer token in authorization header or query string
      const authHeader = req.headers["authorization"];
      let bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : undefined;
      if (!bearerToken && reqUrl) {
        bearerToken = reqUrl.searchParams.get("token") || undefined;
      }

      if (ticket) {
        const user = this.authService.getWsTicketService().redeemTicket(ticket);
        if (!user) {
          // Typed close: invalid ticket
          conn.close(WS_CLOSE_CODES.POLICY_VIOLATION, "Invalid or expired WebSocket ticket");
          return;
        }
        conn.authUser = user;
        conn.userId = user.id;
        conn.isGuest = false;
        this.authService.getWsTicketService().registerSocket(user.id, ws);
      } else if (bearerToken) {
        const payload = await TokenSecurity.verifyAccessToken(bearerToken);
        if (!payload) {
          conn.close(WS_CLOSE_CODES.POLICY_VIOLATION, "Invalid or expired access token");
          return;
        }
        conn.authUser = {
          id: payload.sub,
          email: payload.email,
          displayName: payload.displayName,
          avatar: null,
          isEmailVerified: payload.isEmailVerified,
        };
        conn.userId = payload.sub;
        conn.isGuest = false;
        this.authService.getWsTicketService().registerSocket(payload.sub, ws);
      } else {
        // Connected as guest
        conn.isGuest = true;
      }

      // Register presence for authenticated connection
      if (conn.authUser && this.friendsService) {
        const fullUser = await this.authService.getRepo().findUserById(conn.authUser.id);
        await this.friendsService.getPresenceService().registerSocket(
          {
            id: conn.authUser.id,
            displayName: conn.authUser.displayName,
            username: fullUser?.username || undefined,
            friendCode: fullUser?.friendCode,
            avatar: conn.authUser.avatar,
            presencePrivacy: (fullUser?.presencePrivacy as any) || "friends",
          },
          ws
        );

        const unreadCount = await this.friendsService.getNotificationRepo().getUnreadCount(conn.authUser.id);
        conn.send({
          type: "NOTIFICATIONS_COUNT",
          payload: { unreadCount },
        });
      }
    } else {
      conn.isGuest = true;
    }

    ws.on("pong", () => {
      conn.isAlive = true;
    });

    ws.on("message", async (data: Buffer | string) => {
      const byteLength = typeof data === "string" ? Buffer.byteLength(data) : data.length;
      if (byteLength > 65536) {
        // Enforce 64KB max frame size limit against buffer overflow/DoS
        conn.close(1009, "Message too large (max 64KB)");
        return;
      }
      await this.handleMessage(conn, data.toString());
    });

    ws.on("close", () => {
      this.handleClose(conn);
    });

    ws.on("error", () => {
      this.handleClose(conn);
    });
  }

  private async handleMessage(conn: Connection, rawMessage: string): Promise<void> {
    const receiveTimeMs = Date.now();
    this.metricsCollector?.recordInboundMessage();
    const cmdStartTime = performance.now();
    let messageType = "UNKNOWN";

    try {
      await this.processMessage(conn, rawMessage, receiveTimeMs, (type) => {
        messageType = type;
      });
    } finally {
      const durationSeconds = (performance.now() - cmdStartTime) / 1000;
      this.metricsCollector?.recordCommandLatency(messageType, durationSeconds);
    }
  }

  private async processMessage(
    conn: Connection,
    rawMessage: string,
    receiveTimeMs: number,
    onMessageType: (type: string) => void
  ): Promise<void> {
    // 1. Rate Limiting Check
    if (!conn.rateLimiter.consume()) {
      conn.sendError(
        ERROR_CODES.RATE_LIMITED,
        "Too many requests. Please slow down."
      );
      return;
    }

    // 2. Safe JSON Deserialization with Prototype Pollution Guard
    const jsonResult = safeJsonParse(rawMessage);
    if (!jsonResult.success) {
      conn.sendError(ERROR_CODES.INVALID_MESSAGE, "Malformed JSON or prototype pollution detected");
      return;
    }
    const parsedJson = jsonResult.data;

    // 3. Schema Validation
    const parseResult = ClientMessageSchema.safeParse(parsedJson);
    if (!parseResult.success) {
      const clientSeq =
        typeof parsedJson === "object" && parsedJson !== null && "clientSeq" in parsedJson
          ? Number((parsedJson as { clientSeq: unknown }).clientSeq)
          : undefined;

      conn.sendError(
        ERROR_CODES.INVALID_MESSAGE,
        "Invalid message structure",
        clientSeq,
        parseResult.error.format()
      );
      return;
    }

    const message: ClientMessage = parseResult.data;
    onMessageType(message.type);

    // 4. NTP Clock Sync (bypasses room queue for minimal latency)
    if (message.type === "SYNC_PING") {
      conn.send({
        type: "SYNC_PONG",
        payload: {
          clientSendTimeMs: message.payload.clientSendTimeMs,
          serverReceiveTimeMs: receiveTimeMs,
          serverSendTimeMs: Date.now(),
        },
      });
      return;
    }

    // 5. Room Create
    if (message.type === "ROOM_CREATE") {
      // Verification check: unverified users cannot create rooms
      if (conn.authUser && !conn.authUser.isEmailVerified) {
        conn.sendError(
          ERROR_CODES.PERMISSION_DENIED,
          "Please verify your email address to create rooms",
          message.clientSeq
        );
        return;
      }

      // Guest check if room creation requires verified account
      if (this.enforceVerifiedToCreateRoom && conn.isGuest) {
        conn.sendError(
          ERROR_CODES.PERMISSION_DENIED,
          "An account with verified email is required to create rooms",
          message.clientSeq
        );
        return;
      }

      const effectiveUserName = conn.authUser?.displayName || message.payload.userName;
      const {
        roomName,
        controlMode,
        roomType,
        roomPassword,
        maxMembers,
        waitingRoomEnabled,
        autoApproveFriends,
        profanityFilterEnabled,
        slowModeSeconds,
        initialVideoId,
        e2eeEnabled,
        e2eePublicKey,
        chatRetentionDays,
        roomRules,
      } = message.payload;

      const { room, hostUserId, hostSessionToken } = this.roomManager.createRoom({
        hostUserName: effectiveUserName,
        hostAccountId: conn.authUser?.id,
        roomName,
        controlMode,
        roomType,
        roomPassword,
        maxMembers,
        waitingRoomEnabled,
        autoApproveFriends,
        profanityFilterEnabled,
        slowModeSeconds,
        initialVideoId,
        e2eeEnabled,
        e2eeHostPublicKey: e2eePublicKey,
        chatRetentionDays,
        roomRules,
        friendsService: this.friendsService,
      });

      conn.roomId = room.roomId;
      conn.userId = hostUserId;
      room.attachConnection(hostUserId, conn);

      auditLogger.log({
        type: "ROOM_CREATED",
        outcome: "SUCCESS",
        actorId: hostUserId,
        details: { roomId: room.roomId, roomCode: room.roomCode, e2eeEnabled: Boolean(e2eeEnabled) },
      });

      if (conn.authUser && this.friendsService) {
        await this.friendsService.getPresenceService().setRoomActivity(conn.authUser.id, {
          roomCode: room.roomCode,
          roomName: room.roomName,
          videoTitle: room.playback.videoId,
          isPublic: room.controlMode === "public",
        });
      }

      conn.sendAck(message.clientSeq, room.version);
      conn.send({
        type: "ROOM_SNAPSHOT",
        version: room.version,
        payload: room.getSnapshot(hostUserId, hostSessionToken),
      });
      return;
    }

    // 6. Room Join (New or Reconnect)
    if (message.type === "ROOM_JOIN") {
      const { roomCode, userName, password, inviteToken, reconnectToken, lastKnownVersion, e2eePublicKey } = message.payload;
      let room = this.roomManager.getRoomByCode(roomCode);

      if (!room) {
        // Auto-create room on demand so direct links, refreshed rooms, or custom codes always work seamlessly!
        const effectiveName = conn.authUser?.displayName || userName || "Host";
        const targetCode = (roomCode || "CINEMA").toUpperCase().trim();
        const { room: newRoom, hostUserId, hostSessionToken } = this.roomManager.createRoom({
          hostUserName: effectiveName,
          hostAccountId: conn.authUser?.id,
          roomName: `${targetCode} Screening Suite`,
          roomCode: targetCode,
          initialVideoId: "YE7VzlLtp-4",
          controlMode: "public",
        });

        conn.roomId = newRoom.roomId;
        conn.userId = hostUserId;
        newRoom.attachConnection(hostUserId, conn);

        conn.sendAck(message.clientSeq, newRoom.version);
        conn.send({
          type: "ROOM_SNAPSHOT",
          version: newRoom.version,
          payload: newRoom.getSnapshot(hostUserId, hostSessionToken),
        });
        return;
      }

      const effectiveUserName = conn.authUser?.displayName || userName;

      if (reconnectToken) {
        // Reconnect flow with ban evasion check
        const result = room.reconnectMember(reconnectToken, conn, lastKnownVersion, conn.authUser?.id);
        this.metricsCollector?.recordReconnect(result.success);
        if (!result.success) {
          conn.sendError(result.code, result.message, message.clientSeq);
          return;
        }

        conn.roomId = room.roomId;
        conn.userId = result.member.userId;

        conn.sendAck(message.clientSeq, room.version);

        if (result.missedEvents && result.missedEvents.length > 0) {
          conn.send({
            type: "MISSED_EVENTS",
            payload: {
              fromVersion: (lastKnownVersion ?? 0) + 1,
              toVersion: room.version,
              events: result.missedEvents,
            },
          });
        } else {
          // Gap too large or no version provided: full snapshot
          conn.send({
            type: "ROOM_SNAPSHOT",
            version: room.version,
            payload: room.getSnapshot(result.member.userId, result.member.sessionToken),
          });
        }
        return;
      }

      // Check friend of host status
      const isFriend = await room.isFriendOfHost(conn.authUser?.id);

      // New member join flow
      const result = room.addMember(effectiveUserName, conn, e2eePublicKey, {
        accountId: conn.authUser?.id,
        password,
        inviteToken,
        isFriendOfHost: isFriend,
        role: conn.authUser ? "member" : "guest",
      });

      if (!result.success) {
        if (result.waiting) {
          conn.roomId = room.roomId;
          return;
        }
        conn.sendError(result.code, result.message, message.clientSeq);
        return;
      }

      const { member, sessionToken } = result;
      conn.roomId = room.roomId;
      conn.userId = member.userId;

      if (conn.authUser && this.friendsService) {
        await this.friendsService.getPresenceService().setRoomActivity(conn.authUser.id, {
          roomCode: room.roomCode,
          roomName: room.roomName,
          videoTitle: room.playback.videoId,
          isPublic: room.controlMode === "public",
        });
      }

      conn.sendAck(message.clientSeq, room.version);
      conn.send({
        type: "ROOM_SNAPSHOT",
        version: room.version,
        payload: room.getSnapshot(member.userId, sessionToken),
      });
      return;
    }

    // Friends, Presence & Notifications Messages (Can execute in or out of room)
    if (message.type === "FRIEND_PRESENCE_QUERY") {
      if (conn.authUser && this.friendsService) {
        await this.friendsService.getPresenceService().sendFriendsPresenceSync(conn.authUser.id, conn.ws);
      }
      return;
    }

    if (message.type === "FRIEND_INVITE_SEND") {
      if (!conn.authUser) {
        conn.sendError(ERROR_CODES.PERMISSION_DENIED, "Authentication required to invite friends", message.clientSeq);
        return;
      }
      if (!conn.roomId) {
        conn.sendError(ERROR_CODES.NOT_IN_ROOM, "You must be in a room to send an invite", message.clientSeq);
        return;
      }
      const currentRoom = this.roomManager.getRoomById(conn.roomId);
      if (!currentRoom) {
        conn.sendError(ERROR_CODES.ROOM_NOT_FOUND, "Room not found", message.clientSeq);
        return;
      }
      if (this.friendsService) {
        try {
          await this.friendsService.sendRoomInvite({
            fromUserId: conn.authUser.id,
            toUserId: message.payload.friendUserId,
            roomCode: currentRoom.roomCode,
            roomName: currentRoom.roomName,
            videoTitle: currentRoom.playback.videoId,
          });
          if (message.clientSeq) {
            conn.sendAck(message.clientSeq, currentRoom.version);
          }
        } catch (err: any) {
          conn.sendError(ERROR_CODES.INVALID_ACTION, err.message, message.clientSeq);
        }
      }
      return;
    }

    if (message.type === "NOTIFICATIONS_MARK_READ") {
      if (conn.authUser && this.friendsService) {
        if (message.payload.all) {
          await this.friendsService.getNotificationRepo().markAllAsRead(conn.authUser.id);
        } else if (message.payload.notificationId) {
          await this.friendsService.getNotificationRepo().markAsRead(message.payload.notificationId, conn.authUser.id);
        }
        const unreadCount = await this.friendsService.getNotificationRepo().getUnreadCount(conn.authUser.id);
        conn.send({
          type: "NOTIFICATIONS_COUNT",
          payload: { unreadCount },
        });
      }
      return;
    }

    // For all remaining actions, the connection must be bound to a room and member
    if (!conn.roomId || !conn.userId) {
      const clientSeq = "clientSeq" in message ? message.clientSeq : undefined;
      conn.sendError(
        ERROR_CODES.NOT_IN_ROOM,
        "You must join a room before executing this action",
        clientSeq
      );
      return;
    }

    const room = this.roomManager.getRoomById(conn.roomId);
    if (!room) {
      const clientSeq = "clientSeq" in message ? message.clientSeq : undefined;
      conn.sendError(
        ERROR_CODES.ROOM_NOT_FOUND,
        "The room is no longer active",
        clientSeq
      );
      return;
    }

    // 7. Enqueue in Room's serialized total-order queue
    await room.enqueueAction(async () => {
      switch (message.type) {
        case "ROOM_LEAVE": {
          room.removeMember(conn.userId!);
          conn.roomId = undefined;
          conn.userId = undefined;
          conn.sendAck(message.clientSeq, room.version);
          if (conn.authUser && this.friendsService) {
            await this.friendsService.getPresenceService().setRoomActivity(conn.authUser.id, undefined);
          }
          break;
        }

        case "ROOM_TRANSFER_HOST": {
          const res = room.manualTransferHost(
            conn.userId!,
            message.clientSeq,
            message.payload.targetUserId
          );
          if (res.success) {
            auditLogger.log({
              type: "ROOM_HOST_TRANSFERRED",
              outcome: "SUCCESS",
              actorId: conn.userId,
              targetId: message.payload.targetUserId,
              details: { roomId: room.roomId },
            });
            conn.sendAck(message.clientSeq, room.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "ROOM_UPDATE_SETTINGS": {
          const res = room.updateSettings(
            conn.userId!,
            message.clientSeq,
            message.payload
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, room.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "PLAYBACK_PLAY": {
          const res = room.applyPlay(
            conn.userId!,
            message.clientSeq,
            message.payload.positionMs
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "PLAYBACK_PAUSE": {
          const res = room.applyPause(
            conn.userId!,
            message.clientSeq,
            message.payload.positionMs
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "PLAYBACK_SEEK": {
          const res = room.applySeek(
            conn.userId!,
            message.clientSeq,
            message.payload.targetPositionMs,
            message.payload.autoPlay
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "PLAYBACK_CHANGE_VIDEO": {
          const res = room.applyChangeVideo(
            conn.userId!,
            message.clientSeq,
            message.payload.videoId,
            message.payload.startPositionMs,
            message.payload.autoPlay,
            message.payload.provider,
            message.payload.sourceRef
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
            if (conn.authUser && this.friendsService) {
              await this.friendsService.getPresenceService().setRoomActivity(conn.authUser.id, {
                roomCode: room.roomCode,
                roomName: room.roomName,
                videoTitle: message.payload.title || message.payload.videoId,
                isPublic: room.controlMode === "public",
              });
            }
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "PLAYBACK_BUFFER_REPORT": {
          room.applyBufferReport(conn.userId!, message.payload.isBuffering);
          conn.sendAck(message.clientSeq, room.version);
          break;
        }

        case "PLAYLIST_ADD": {
          const res = room.addPlaylistItem(
            conn.userId!,
            message.clientSeq,
            message.payload.videoId,
            message.payload.title,
            message.payload.durationMs,
            message.payload.thumbnailUrl,
            message.payload.provider,
            message.payload.sourceRef
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "PLAYLIST_REMOVE": {
          const res = room.removePlaylistItem(
            conn.userId!,
            message.clientSeq,
            message.payload.playlistItemId
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "PLAYLIST_REORDER": {
          const res = room.reorderPlaylistItem(
            conn.userId!,
            message.clientSeq,
            message.payload.playlistItemId,
            message.payload.newIndex,
            message.payload.order,
            message.payload.expectedVersion
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "PLAYBACK_ENDED": {
          const res = room.advancePlaylist(
            conn.userId!,
            message.clientSeq,
            message.payload.videoId
          );
          conn.sendAck(message.clientSeq, room.version);
          break;
        }

        case "POLL_CREATE": {
          const res = room.createPoll(
            conn.userId!,
            message.clientSeq,
            message.payload.question,
            message.payload.options,
            message.payload.durationSeconds,
            message.payload.autoQueueWinner
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "POLL_VOTE": {
          const res = room.votePoll(
            conn.userId!,
            message.clientSeq,
            message.payload.pollId,
            message.payload.optionIndex
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "POLL_CLOSE": {
          if (room.hasPermission(conn.userId!, "create_polls")) {
            room.closePoll(message.payload.pollId);
            conn.sendAck(message.clientSeq, room.version);
          } else {
            conn.sendError(ERROR_CODES.PERMISSION_DENIED, "Not authorized to close poll", message.clientSeq);
          }
          break;
        }

        case "CHAT_SEND": {
          const res = room.broadcastChat(
            conn.userId!,
            message.clientSeq,
            message.payload.text
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "CHAT_TYPING": {
          room.broadcastTyping(conn.userId!, message.payload.isTyping);
          break;
        }

        case "REACTION_EMIT": {
          room.broadcastReaction(
            conn.userId!,
            message.payload.emoji,
            message.payload.videoTimestampMs
          );
          break;
        }

        case "BOOKMARK_CREATE": {
          const res = room.addBookmark(
            conn.userId!,
            message.clientSeq,
            message.payload.videoId,
            message.payload.timestampMs,
            message.payload.text,
            message.payload.color
          );
          conn.sendAck(message.clientSeq, res.version);
          break;
        }

        case "BOOKMARK_REMOVE": {
          const res = room.removeBookmark(
            conn.userId!,
            message.clientSeq,
            message.payload.bookmarkId
          );
          conn.sendAck(message.clientSeq, res.version);
          break;
        }

        case "READY_CHECK_START": {
          const res = room.startReadyCheck(
            conn.userId!,
            message.clientSeq,
            message.payload.countdownMs,
            message.payload.startPositionMs
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "ROOM_KICK_MEMBER": {
          const res = room.kickMember(
            conn.userId!,
            message.clientSeq,
            message.payload.targetUserId,
            message.payload.reason
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "ROOM_BAN_MEMBER": {
          const res = room.banMember(
            conn.userId!,
            message.clientSeq,
            message.payload.targetUserId,
            message.payload.banType,
            message.payload.reason,
            message.payload.durationSeconds
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "ROOM_GET_BANS": {
          if (!room.hasPermission(conn.userId!, "ban")) {
            conn.sendError(ERROR_CODES.PERMISSION_DENIED, "You do not have permission to list bans", message.clientSeq);
            break;
          }
          conn.sendAck(message.clientSeq, room.version);
          conn.send({
            type: "ROOM_BANS_LIST",
            payload: { bans: room.getBans() },
          });
          break;
        }

        case "ROOM_UNBAN": {
          const res = room.unbanMember(
            conn.userId!,
            message.clientSeq,
            message.payload.targetIdentifier
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "ROOM_MUTE_MEMBER": {
          const res = room.muteMember(
            conn.userId!,
            message.clientSeq,
            message.payload.targetUserId,
            message.payload.durationSeconds,
            message.payload.reason
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "ROOM_UNMUTE_MEMBER": {
          const res = room.unmuteMember(
            conn.userId!,
            message.clientSeq,
            message.payload.targetUserId
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "ROOM_ASSIGN_ROLE": {
          const res = room.assignRole(
            conn.userId!,
            message.clientSeq,
            message.payload.targetUserId,
            message.payload.role
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "CHAT_MESSAGE_DELETE": {
          const res = room.deleteChatMessage(
            conn.userId!,
            message.clientSeq,
            message.payload.messageId
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "ROOM_LOCK_TOGGLE": {
          const res = room.toggleRoomLock(
            conn.userId!,
            message.clientSeq,
            message.payload.isLocked
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "WAITING_ROOM_APPROVE": {
          const res = room.approveWaitingRequest(
            conn.userId!,
            message.clientSeq,
            message.payload.requestId
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "WAITING_ROOM_DENY": {
          const res = room.denyWaitingRequest(
            conn.userId!,
            message.clientSeq,
            message.payload.requestId,
            message.payload.reason
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "MODERATION_REPORT_CREATE": {
          const res = room.createModerationReport(
            conn.userId!,
            message.payload
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, room.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "INVITE_LINK_CREATE": {
          const res = room.createInviteLink(
            conn.userId!,
            message.payload
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, room.version);
            conn.send({
              type: "INVITE_LINK_CREATED",
              version: room.version,
              payload: { inviteLink: res.inviteLink },
            });
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "INVITE_LINK_REVOKE": {
          const res = room.revokeInviteLink(
            conn.userId!,
            message.payload.inviteId
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, room.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "INVITE_LINK_REGENERATE": {
          const res = room.regenerateInviteLink(
            conn.userId!,
            message.payload.inviteId,
            message.payload
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, room.version);
            conn.send({
              type: "INVITE_LINK_CREATED",
              version: room.version,
              payload: { inviteLink: res.inviteLink },
            });
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "ROOM_E2EE_KEY_DISTRIBUTE": {
          const res = room.distributeE2eeKeyPackages(
            conn.userId!,
            message.payload.keyVersion,
            message.payload.packages
          );
          if (res.success) {
            if (message.clientSeq) {
              conn.sendAck(message.clientSeq, room.version);
            }
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "CHAT_SEND_ENCRYPTED": {
          const res = room.broadcastEncryptedChat(
            conn.userId!,
            message.clientSeq || 0,
            message.payload.ciphertext,
            message.payload.iv,
            message.payload.keyVersion
          );
          if (res.success) {
            if (message.clientSeq) {
              conn.sendAck(message.clientSeq, res.version);
            }
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "SYNC_METRICS_REPORT": {
          this.metricsCollector?.recordDrift(Math.abs(message.payload.driftMs));
          room.recordMemberMetrics(conn.userId!, message.payload);
          break;
        }

        case "SCREEN_SHARE_START": {
          const res = room.startScreenShare(
            conn.userId!,
            message.clientSeq,
            message.payload
          );
          if (res.success) {
            if (message.clientSeq) {
              conn.sendAck(message.clientSeq, res.version);
            }
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "SCREEN_SHARE_STOP": {
          const res = room.stopScreenShare(
            conn.userId!,
            message.clientSeq,
            message.payload?.reason
          );
          if (res.success) {
            if (message.clientSeq) {
              conn.sendAck(message.clientSeq, res.version);
            }
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "ROOM_SCREEN_SHARE_PERMIT": {
          const res = room.approveScreenSharer(
            conn.userId!,
            message.clientSeq,
            message.payload.targetUserId
          );
          if (res.success) {
            if (message.clientSeq) {
              conn.sendAck(message.clientSeq, res.version);
            }
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "ROOM_SCREEN_SHARE_REVOKE": {
          const res = room.revokeScreenSharer(
            conn.userId!,
            message.clientSeq,
            message.payload.targetUserId
          );
          if (res.success) {
            if (message.clientSeq) {
              conn.sendAck(message.clientSeq, res.version);
            }
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "WEBRTC_SIGNAL": {
          const res = room.forwardWebRtcSignal(
            conn.userId!,
            message.payload.targetUserId,
            message.payload.signalType,
            message.payload.signalData,
            message.payload.screenShareSessionId
          );
          if (!res.success) {
            conn.sendError(res.code || ERROR_CODES.INVALID_ACTION, res.message || "Failed to forward WebRTC signal", message.clientSeq);
          }
          break;
        }

        case "SCREEN_SHARE_METRICS_REPORT": {
          room.recordScreenShareMetrics(conn.userId!, message.payload);
          break;
        }

        case "CO_BROWSE_SCROLL": {
          const pos = "position" in (message.payload as any) ? (message.payload as any).position : message.payload;
          room.broadcastExcept(conn.userId!, {
            type: "CO_BROWSE_SCROLL",
            payload: pos,
          });
          break;
        }

        case "CO_BROWSE_PRESENCE": {
          room.broadcastExcept(conn.userId!, {
            type: "CO_BROWSE_PRESENCE",
            payload: message.payload,
          });
          break;
        }

        case "CO_BROWSE_HIGHLIGHT_ADD": {
          room.broadcast({
            type: "CO_BROWSE_HIGHLIGHT_ADD",
            payload: message.payload,
          });
          break;
        }

        case "CO_BROWSE_HIGHLIGHT_REMOVE": {
          room.broadcast({
            type: "CO_BROWSE_HIGHLIGHT_REMOVE",
            payload: message.payload,
          });
          break;
        }

        case "CO_BROWSE_COMMENT_ADD": {
          room.broadcast({
            type: "CO_BROWSE_COMMENT_ADD",
            payload: message.payload,
          });
          break;
        }

        case "CO_BROWSE_COMMENT_DELETE": {
          room.broadcast({
            type: "CO_BROWSE_COMMENT_DELETE",
            payload: message.payload,
          });
          break;
        }

        case "CO_BROWSE_NOTES_UPDATE": {
          room.broadcastExcept(conn.userId!, {
            type: "CO_BROWSE_NOTES_UPDATE",
            payload: message.payload,
          });
          break;
        }

        case "CO_BROWSE_SECTION_PING": {
          room.broadcast({
            type: "CO_BROWSE_SECTION_PING",
            payload: message.payload,
          });
          break;
        }

        case "CO_BROWSE_MEDIA_SYNC": {
          room.broadcastExcept(conn.userId!, {
            type: "CO_BROWSE_MEDIA_SYNC",
            payload: message.payload,
          });
          break;
        }

        case "SOURCE_SUBMIT": {
          const res = await room.submitSource(
            conn.userId!,
            message.clientSeq,
            message.payload
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "SOURCE_APPROVE": {
          const res = room.approveSourceSubmission(
            conn.userId!,
            message.clientSeq,
            message.payload.submissionId
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "SOURCE_REJECT": {
          const res = room.rejectSourceSubmission(
            conn.userId!,
            message.clientSeq,
            message.payload.submissionId,
            message.payload.reason
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "SOURCE_PERMIT_USER": {
          const res = room.permitSourceAdder(
            conn.userId!,
            message.clientSeq,
            message.payload.targetUserId,
            message.payload.permit
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "SOURCE_BLOCKLIST_ADD": {
          const res = room.addSourceBlocklistRule(
            conn.userId!,
            message.clientSeq,
            message.payload.pattern,
            message.payload.reason
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "SOURCE_BLOCKLIST_REMOVE": {
          const res = room.removeSourceBlocklistRule(
            conn.userId!,
            message.clientSeq,
            message.payload.ruleId
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "SOURCE_REPORT": {
          const res = room.reportSource(
            conn.userId!,
            message.clientSeq,
            message.payload.sourceUrl,
            message.payload.reason,
            message.payload.description
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "SOURCE_UPDATE_SETTINGS": {
          const res = room.updateSourceSettings(
            conn.userId!,
            message.clientSeq,
            message.payload
          );
          if (res.success) {
            conn.sendAck(message.clientSeq, res.version);
          } else {
            conn.sendError(res.code, res.message, message.clientSeq);
          }
          break;
        }

        case "VOICE_STATE_UPDATE": {
          room.updateVoiceState(conn.userId!, message.payload);
          if (message.clientSeq) {
            conn.sendAck(message.clientSeq, room.version);
          }
          break;
        }

        case "ROOM_MOD_MUTE_VOICE": {
          if (!room.hasPermission(conn.userId!, "mute")) {
            conn.sendError(ERROR_CODES.PERMISSION_DENIED, "You do not have permission to mute participant voice", message.clientSeq);
            break;
          }
          room.muteVoiceParticipant(conn.userId!, message.payload.targetUserId);
          if (message.clientSeq) {
            conn.sendAck(message.clientSeq, room.version);
          }
          break;
        }

        case "ROOM_MOD_REMOVE_VOICE": {
          if (!room.hasPermission(conn.userId!, "kick")) {
            conn.sendError(ERROR_CODES.PERMISSION_DENIED, "You do not have permission to remove participant from voice", message.clientSeq);
            break;
          }
          room.removeVoiceParticipant(conn.userId!, message.payload.targetUserId);
          if (message.clientSeq) {
            conn.sendAck(message.clientSeq, room.version);
          }
          break;
        }

        case "ROOM_MOD_DISABLE_ROOM_VIDEO": {
          if (!room.hasPermission(conn.userId!, "manage_settings")) {
            conn.sendError(ERROR_CODES.PERMISSION_DENIED, "You do not have permission to manage room video settings", message.clientSeq);
            break;
          }
          room.setRoomVideoDisabled(conn.userId!, message.payload.disabled);
          if (message.clientSeq) {
            conn.sendAck(message.clientSeq, room.version);
          }
          break;
        }

        case "ROOM_RECORDING_REQUEST": {
          const res = room.requestRecording(conn.userId!);
          if (!res.success) {
            conn.sendError(ERROR_CODES.PERMISSION_DENIED, res.error || "Unable to request room recording", message.clientSeq);
          } else if (message.clientSeq) {
            conn.sendAck(message.clientSeq, room.version);
          }
          break;
        }

        case "ROOM_RECORDING_CONSENT": {
          room.submitRecordingConsent(conn.userId!, message.payload.consentGranted);
          if (message.clientSeq) {
            conn.sendAck(message.clientSeq, room.version);
          }
          break;
        }

        case "ROOM_RECORDING_STOP": {
          room.stopRecording(conn.userId!);
          if (message.clientSeq) {
            conn.sendAck(message.clientSeq, room.version);
          }
          break;
        }
      }
    });

    room.notifyStateChanged();
  }

  private handleClose(conn: Connection): void {
    this.connections.delete(conn);
    this.metricsCollector?.decrementConnectedSockets();
    this.metricsCollector?.setActiveRooms(this.roomManager.getActiveRoomCount());
    if (conn.roomId && conn.userId) {
      const room = this.roomManager.getRoomById(conn.roomId);
      if (room) {
        room.handleDisconnect(conn.userId);
      }
    }
    if (conn.authUser && this.friendsService) {
      this.friendsService.getPresenceService().setRoomActivity(conn.authUser.id, undefined);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const conn of this.connections) {
        if (!conn.isAlive) {
          // Client did not reply to previous ping; terminate connection gracefully
          conn.close(WS_CLOSE_CODES.HEARTBEAT_TIMEOUT, "Heartbeat timeout");
          this.handleClose(conn);
          continue;
        }

        conn.isAlive = false;
        try {
          conn.ws.ping();
          // Also send server timestamp for lightweight background time tracking
          conn.send({
            type: "HEARTBEAT",
            payload: {
              serverTimeMs: Date.now(),
            },
          });
        } catch {
          conn.close(WS_CLOSE_CODES.HEARTBEAT_TIMEOUT, "Ping failed");
          this.handleClose(conn);
        }
      }
    }, ROOM_CONSTANTS.HEARTBEAT_INTERVAL_MS);
  }

  public async drainAndClose(
    code: number = WS_CLOSE_CODES.SERVICE_RESTART,
    reason = "Server restarting, please reconnect"
  ): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const conn of this.connections) {
      try {
        conn.close(code, reason);
      } catch {
        // ignore
      }
    }
    this.connections.clear();

    await new Promise<void>((resolve) => {
      this.wss.close(() => resolve());
    });
  }

  public close(): void {
    this.drainAndClose(WS_CLOSE_CODES.GOING_AWAY, "Server shutting down").catch(console.error);
  }

  public getConnectedSocketCount(): number {
    return this.connections.size;
  }

  public disconnectUser(
    userId: string,
    code: number = WS_CLOSE_CODES.POLICY_VIOLATION,
    reason = "Session revoked by administrator"
  ): number {
    let disconnectedCount = 0;
    for (const conn of this.connections) {
      if (conn.userId === userId || conn.authUser?.id === userId) {
        try {
          conn.sendError(ERROR_CODES.PERMISSION_DENIED, reason);
          conn.close(code, reason);
          disconnectedCount++;
        } catch {
          // ignore
        }
      }
    }
    return disconnectedCount;
  }
}
