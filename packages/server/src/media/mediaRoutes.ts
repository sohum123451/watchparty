import http from "node:http";
import { MediaService } from "./MediaService.js";
import { TokenSecurity } from "../auth/crypto/tokens.js";
import { RoomManager } from "../rooms/RoomManager.js";
import { auditLogger } from "../security/AuditLogger.js";
import { getClientIp } from "../utils/ip.js";

const tokenRateLimits = new Map<string, { count: number; resetAt: number }>();

function checkTokenRateLimit(key: string, limit = 30, windowMs = 60000): boolean {
  const now = Date.now();
  const record = tokenRateLimits.get(key);
  if (!record || now > record.resetAt) {
    tokenRateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (record.count >= limit) {
    return false;
  }
  record.count++;
  return true;
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        req.destroy();
        resolve({});
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  data: any,
  headers: Record<string, string> = {}
): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-room-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    ...headers,
  });
  res.end(JSON.stringify(data));
}

async function getAuthUser(req: http.IncomingMessage) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  if (!token) return null;
  return TokenSecurity.verifyAccessToken(token);
}

export async function handleMediaRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  mediaService: MediaService,
  roomManager: RoomManager
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (!url.pathname.startsWith("/api/media")) {
    return false;
  }

  // Preflight CORS
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-room-token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    res.end();
    return true;
  }

  try {
    // 1. POST /api/media/token or GET /api/media/token
    if (url.pathname === "/api/media/token" && (req.method === "POST" || req.method === "GET")) {
      let roomCode = url.searchParams.get("roomCode") || "";
      let guestUserId = url.searchParams.get("userId") || "";
      let guestName = url.searchParams.get("userName") || "";
      let sessionToken = (req.headers["x-room-token"] as string) || url.searchParams.get("sessionToken") || "";

      if (req.method === "POST") {
        const body = await parseJsonBody(req);
        if (body.roomCode) roomCode = body.roomCode;
        if (body.userId) guestUserId = body.userId;
        if (body.userName) guestName = body.userName;
        if (body.sessionToken) sessionToken = body.sessionToken;
      }

      // 0. Rate limiting on media token requests (max 30 requests/minute)
      const clientIp = getClientIp(req);
      const rateLimitKey = `${clientIp}_${url.searchParams.get("roomCode") || ""}`;
      if (!checkTokenRateLimit(rateLimitKey, 30, 60000)) {
        sendJson(res, 429, {
          error: "Too many media token requests. Please wait before retrying.",
          code: "RATE_LIMITED",
        });
        return true;
      }

      if (!roomCode) {
        sendJson(res, 400, { error: "roomCode is required", code: "BAD_REQUEST" });
        return true;
      }

      const room = roomManager.getRoomByCode(roomCode);
      if (!room) {
        sendJson(res, 404, { error: "Room not found", code: "ROOM_NOT_FOUND" });
        return true;
      }

      // Check authenticated user first
      const authUser = await getAuthUser(req);
      let userId = authUser ? authUser.sub : guestUserId;
      let displayName = authUser ? (authUser as any).displayName || "Member" : guestName || "Guest";

      // Check if user is banned or revoked from the room
      if (userId && (room.isBanned(userId, authUser?.sub) || mediaService.isUserRevoked(roomCode, userId))) {
        sendJson(res, 403, {
          error: "You are banned or revoked from media access in this room.",
          code: room.isBanned(userId, authUser?.sub) ? "USER_BANNED" : "TOKEN_REVOKED",
        });
        return true;
      }

      // If user not authenticated by JWT, verify room membership or session token
      if (!authUser) {
        const member = (sessionToken ? room.getMemberByToken(sessionToken) : null) || (userId ? room.getMember(userId) : null);
        if (!member) {
          sendJson(res, 401, {
            error: "You must be an authorized member in the room to request a media token",
            code: "UNAUTHORIZED",
          });
          return true;
        }
        userId = member.userId;
        displayName = member.userName;
      }

      const tokenResult = await mediaService.generateRoomToken(roomCode, {
        id: userId,
        displayName,
      });

      auditLogger.log({
        type: "MEDIA_TOKEN_ISSUED",
        actorId: userId,
        outcome: "SUCCESS",
        details: {
          roomCode,
          provider: tokenResult.provider,
          expiresAt: tokenResult.expiresAt,
        },
      });

      sendJson(res, 200, {
        success: true,
        ...tokenResult,
      });
      return true;
    }

    // 2. GET /api/media/ice-servers - Public STUN / TURN fallback configuration
    if (url.pathname === "/api/media/ice-servers" && req.method === "GET") {
      const authUser = await getAuthUser(req);
      const iceServers = mediaService.getProvider().getIceServers(authUser?.sub || "guest");
      sendJson(res, 200, { iceServers });
      return true;
    }

    sendJson(res, 404, { error: "Endpoint not found" });
    return true;
  } catch (err: any) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "Media service error", code: err.code || "INTERNAL_ERROR" });
    return true;
  }
}
