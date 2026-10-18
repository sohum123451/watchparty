import http from "node:http";
import { FriendsService } from "../services/FriendsService.js";
import { TokenSecurity } from "../../auth/crypto/tokens.js";
import { defaultSecurityMiddleware } from "../../security/headers.js";
import { getClientIp } from "../../utils/ip.js";

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
  const origin = (res as any)._reqOrigin;
  const corsHeaders: Record<string, string> = {};
  if (origin) {
    corsHeaders["Access-Control-Allow-Origin"] = origin;
    corsHeaders["Access-Control-Allow-Credentials"] = "true";
    corsHeaders["Vary"] = "Origin";
  }
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...corsHeaders,
  });
  res.end(JSON.stringify(data));
}

async function getAuthenticatedUser(req: http.IncomingMessage) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  if (!token) return null;
  return TokenSecurity.verifyAccessToken(token);
}

export async function handleFriendsRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  friendsService: FriendsService
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const clientIp = getClientIp(req);

  // Check if request belongs to friends or notifications
  if (!url.pathname.startsWith("/api/friends") && !url.pathname.startsWith("/api/notifications")) {
    return false;
  }

  const origin = req.headers.origin;
  const hostHeader = (req.headers["x-forwarded-host"] as string) || req.headers.host;
  const isAllowed = origin ? defaultSecurityMiddleware.isOriginAllowed(origin, hostHeader) : false;
  (res as any)._reqOrigin = isAllowed ? origin : null;

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...(isAllowed ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
      } : {}),
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return true;
  }

  try {
    // Authenticate all friends and notification routes
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      sendJson(res, 401, { error: "Authentication required" });
      return true;
    }

    const userId = authUser.sub;

    // 1. GET /api/friends - retrieve friends list, requests, blocked
    if (url.pathname === "/api/friends" && req.method === "GET") {
      const data = await friendsService.getFriendsList(userId);
      sendJson(res, 200, data);
      return true;
    }

    // 2. GET /api/friends/search?q=... - search users
    if (url.pathname === "/api/friends/search" && req.method === "GET") {
      const q = url.searchParams.get("q") || "";
      const results = await friendsService.searchUsers(userId, q, clientIp);
      sendJson(res, 200, { results });
      return true;
    }

    // 3. POST /api/friends/request - send friend request (email, username, friendCode)
    if (url.pathname === "/api/friends/request" && req.method === "POST") {
      const body = await parseBody(req);
      const result = await friendsService.sendFriendRequest({
        fromUserId: userId,
        email: body.email,
        username: body.username,
        friendCode: body.friendCode,
        clientIp,
      });
      sendJson(res, 200, result);
      return true;
    }

    // 4. POST /api/friends/requests/:id/accept - accept request
    if (url.pathname.match(/^\/api\/friends\/requests\/([^/]+)\/accept$/) && req.method === "POST") {
      const match = url.pathname.match(/^\/api\/friends\/requests\/([^/]+)\/accept$/);
      const requestId = match![1];
      const result = await friendsService.acceptFriendRequest(userId, requestId);
      sendJson(res, 200, { success: true, friendship: result });
      return true;
    }

    // 5. POST /api/friends/requests/:id/decline - decline request
    if (url.pathname.match(/^\/api\/friends\/requests\/([^/]+)\/decline$/) && req.method === "POST") {
      const match = url.pathname.match(/^\/api\/friends\/requests\/([^/]+)\/decline$/);
      const requestId = match![1];
      const success = await friendsService.declineFriendRequest(userId, requestId);
      sendJson(res, 200, { success });
      return true;
    }

    // 6. POST /api/friends/requests/:id/cancel - cancel request
    if (url.pathname.match(/^\/api\/friends\/requests\/([^/]+)\/cancel$/) && req.method === "POST") {
      const match = url.pathname.match(/^\/api\/friends\/requests\/([^/]+)\/cancel$/);
      const requestId = match![1];
      const success = await friendsService.cancelFriendRequest(userId, requestId);
      sendJson(res, 200, { success });
      return true;
    }

    // 7. DELETE /api/friends/:friendId - remove friend (unfriend)
    if (url.pathname.match(/^\/api\/friends\/([^/]+)$/) && req.method === "DELETE") {
      const match = url.pathname.match(/^\/api\/friends\/([^/]+)$/);
      const friendId = match![1];
      const success = await friendsService.removeFriend(userId, friendId);
      sendJson(res, 200, { success });
      return true;
    }

    // 8. POST /api/friends/:friendId/block - block user
    if (url.pathname.match(/^\/api\/friends\/([^/]+)\/block$/) && req.method === "POST") {
      const match = url.pathname.match(/^\/api\/friends\/([^/]+)\/block$/);
      const targetUserId = match![1];
      const success = await friendsService.blockUser(userId, targetUserId);
      sendJson(res, 200, { success });
      return true;
    }

    // 9. POST /api/friends/:friendId/unblock - unblock user
    if (url.pathname.match(/^\/api\/friends\/([^/]+)\/unblock$/) && req.method === "POST") {
      const match = url.pathname.match(/^\/api\/friends\/([^/]+)\/unblock$/);
      const targetUserId = match![1];
      const success = await friendsService.unblockUser(userId, targetUserId);
      sendJson(res, 200, { success });
      return true;
    }

    // 10. POST /api/friends/invite - invite friend to current room
    if (url.pathname === "/api/friends/invite" && req.method === "POST") {
      const body = await parseBody(req);
      const invite = await friendsService.sendRoomInvite({
        fromUserId: userId,
        toUserId: body.friendUserId,
        roomCode: body.roomCode,
        roomName: body.roomName || "Watch Party Room",
        videoTitle: body.videoTitle,
      });
      sendJson(res, 200, { success: true, invite });
      return true;
    }

    // 11. PUT /api/friends/privacy - set presence privacy
    if (url.pathname === "/api/friends/privacy" && req.method === "PUT") {
      const body = await parseBody(req);
      if (!["everyone", "friends", "nobody"].includes(body.presencePrivacy)) {
        sendJson(res, 400, { error: "Invalid privacy setting. Must be 'everyone', 'friends', or 'nobody'" });
        return true;
      }
      await friendsService.updatePresencePrivacy(userId, body.presencePrivacy);
      sendJson(res, 200, { success: true, presencePrivacy: body.presencePrivacy });
      return true;
    }

    // ==========================================
    // NOTIFICATION ROUTES (/api/notifications/*)
    // ==========================================

    // 12. GET /api/notifications - get notifications and unread count
    if (url.pathname === "/api/notifications" && req.method === "GET") {
      const limit = Number(url.searchParams.get("limit")) || 50;
      const notifications = await friendsService.getNotificationRepo().getUserNotifications(userId, limit);
      const unreadCount = await friendsService.getNotificationRepo().getUnreadCount(userId);
      sendJson(res, 200, { notifications, unreadCount });
      return true;
    }

    // 13. POST /api/notifications/:id/read - mark single notification read
    if (url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/) && req.method === "POST") {
      const match = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
      const notifId = match![1];
      const success = await friendsService.getNotificationRepo().markAsRead(notifId, userId);
      const unreadCount = await friendsService.getNotificationRepo().getUnreadCount(userId);
      sendJson(res, 200, { success, unreadCount });
      return true;
    }

    // 14. POST /api/notifications/read-all - mark all read
    if (url.pathname === "/api/notifications/read-all" && req.method === "POST") {
      const updated = await friendsService.getNotificationRepo().markAllAsRead(userId);
      sendJson(res, 200, { success: true, count: updated, unreadCount: 0 });
      return true;
    }

    // 15. DELETE /api/notifications/:id - delete notification
    if (url.pathname.match(/^\/api\/notifications\/([^/]+)$/) && req.method === "DELETE") {
      const match = url.pathname.match(/^\/api\/notifications\/([^/]+)$/);
      const notifId = match![1];
      const success = await friendsService.getNotificationRepo().deleteNotification(notifId, userId);
      const unreadCount = await friendsService.getNotificationRepo().getUnreadCount(userId);
      sendJson(res, 200, { success, unreadCount });
      return true;
    }

    return false;
  } catch (error: any) {
    const status = error.status || 500;
    sendJson(res, status, { error: error.message || "An unexpected error occurred" });
    return true;
  }
}
