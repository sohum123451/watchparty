import http from "node:http";
import type { WebPushService } from "../push/WebPushService.js";
import type { ScheduledPartyService } from "./ScheduledPartyService.js";
import type { FriendsService } from "../friends/services/FriendsService.js";
import type { RoomManager } from "../rooms/RoomManager.js";
import type { IAuthRepository } from "../auth/db/AuthRepository.js";
import { TokenSecurity } from "../auth/crypto/tokens.js";

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

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  data: any,
  headers: Record<string, string> = {}
): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-user-id, x-user-name",
    ...headers,
  });
  res.end(JSON.stringify(data));
}

async function resolveUser(
  req: http.IncomingMessage,
  authRepo?: IAuthRepository
): Promise<{ userId: string; displayName: string } | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  if (token) {
    try {
      const payload = await TokenSecurity.verifyAccessToken(token);
      if (payload?.sub) {
        let name = (payload as any).name || "User";
        if (authRepo) {
          const u = await authRepo.findUserById(payload.sub);
          if (u) name = u.displayName;
        }
        return { userId: payload.sub, displayName: name };
      }
    } catch {
      // Ignore token verification errors and fallback
    }
  }

  const xUserId = req.headers["x-user-id"] as string;
  if (xUserId) {
    let name = (req.headers["x-user-name"] as string) || "Friend";
    if (authRepo) {
      const u = await authRepo.findUserById(xUserId);
      if (u) name = u.displayName;
    }
    return { userId: xUserId, displayName: name };
  }

  return null;
}

export async function handleDailyRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: {
    pushService: WebPushService;
    scheduledPartyService: ScheduledPartyService;
    friendsService: FriendsService;
    roomManager: RoomManager;
    authRepo?: IAuthRepository;
    baseUrl?: string;
  }
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const { pushService, scheduledPartyService, friendsService, roomManager, authRepo, baseUrl } = options;

  // Handle CORS preflight
  if (
    req.method === "OPTIONS" &&
    (url.pathname.startsWith("/api/push") ||
      url.pathname.startsWith("/api/scheduled-parties") ||
      url.pathname.startsWith("/api/home-rooms") ||
      url.pathname.startsWith("/api/friends/activity") ||
      url.pathname.includes("/notify-started"))
  ) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-user-id, x-user-name",
    });
    res.end();
    return true;
  }

  // 1. WEB PUSH ENDPOINTS (/api/push/*)
  if (url.pathname === "/api/push/vapid-key" && req.method === "GET") {
    sendJson(res, 200, { publicKey: pushService.getPublicKey() });
    return true;
  }

  if (url.pathname === "/api/push/subscribe" && req.method === "POST") {
    const user = await resolveUser(req, authRepo);
    if (!user) {
      sendJson(res, 401, { error: "Authentication required to subscribe to push notifications" });
      return true;
    }
    const body = await parseBody(req);
    if (!body || !body.subscription) {
      sendJson(res, 400, { error: "Push subscription payload is required" });
      return true;
    }
    try {
      pushService.subscribe(user.userId, body.subscription);
      sendJson(res, 200, { success: true, message: "Push notification subscription registered" });
    } catch (err: any) {
      sendJson(res, 400, { error: err.message });
    }
    return true;
  }

  if (url.pathname === "/api/push/unsubscribe" && (req.method === "POST" || req.method === "DELETE")) {
    const user = await resolveUser(req, authRepo);
    if (!user) {
      sendJson(res, 401, { error: "Authentication required" });
      return true;
    }
    const body = await parseBody(req);
    const endpoint = body.endpoint || url.searchParams.get("endpoint");
    if (!endpoint) {
      sendJson(res, 400, { error: "Endpoint parameter is required" });
      return true;
    }
    const removed = pushService.unsubscribe(user.userId, endpoint);
    sendJson(res, 200, { success: true, removed });
    return true;
  }

  if (url.pathname === "/api/push/preferences" && req.method === "GET") {
    const user = await resolveUser(req, authRepo);
    if (!user) {
      sendJson(res, 401, { error: "Authentication required" });
      return true;
    }
    const prefs = pushService.getPreferences(user.userId);
    sendJson(res, 200, { preferences: prefs });
    return true;
  }

  if (url.pathname === "/api/push/preferences" && (req.method === "PUT" || req.method === "POST")) {
    const user = await resolveUser(req, authRepo);
    if (!user) {
      sendJson(res, 401, { error: "Authentication required" });
      return true;
    }
    const body = await parseBody(req);
    const updated = pushService.updatePreferences(user.userId, body);
    sendJson(res, 200, { success: true, preferences: updated });
    return true;
  }

  if (url.pathname === "/api/push/test" && req.method === "POST") {
    const user = await resolveUser(req, authRepo);
    if (!user) {
      sendJson(res, 401, { error: "Authentication required" });
      return true;
    }
    const result = await pushService.sendNotification(user.userId, "partyStarted", {
      title: "WatchParty Notification Test",
      body: "Web Push notifications are working perfectly!",
      url: "/app",
    });
    sendJson(res, 200, { result });
    return true;
  }

  // 2. SCHEDULED WATCH PARTIES (/api/scheduled-parties/*)
  if (url.pathname === "/api/scheduled-parties" && req.method === "POST") {
    const user = await resolveUser(req, authRepo);
    if (!user) {
      sendJson(res, 401, { error: "Authentication required to schedule a party" });
      return true;
    }
    const body = await parseBody(req);
    if (!body.title || !body.scheduledStartTimeMs) {
      sendJson(res, 400, { error: "Title and scheduledStartTimeMs are required" });
      return true;
    }

    const party = scheduledPartyService.createParty({
      creatorUserId: user.userId,
      creatorDisplayName: user.displayName,
      title: body.title,
      description: body.description,
      scheduledStartTimeMs: Number(body.scheduledStartTimeMs),
      scheduledEndTimeMs: body.scheduledEndTimeMs ? Number(body.scheduledEndTimeMs) : undefined,
      sourceUrl: body.sourceUrl,
      sourceTitle: body.sourceTitle,
      invitedUserIds: Array.isArray(body.invitedUserIds) ? body.invitedUserIds : [],
      roomCode: body.roomCode,
      isHomeRoom: Boolean(body.isHomeRoom),
    });

    sendJson(res, 201, { success: true, party });
    return true;
  }

  if (url.pathname === "/api/scheduled-parties" && req.method === "GET") {
    const user = await resolveUser(req, authRepo);
    if (!user) {
      sendJson(res, 401, { error: "Authentication required" });
      return true;
    }
    const parties = scheduledPartyService.getUserParties(user.userId);
    sendJson(res, 200, { count: parties.length, parties });
    return true;
  }

  // Calendar (.ics) export
  if (url.pathname.match(/^\/api\/scheduled-parties\/[^/]+\/ics$/) && req.method === "GET") {
    const partyId = url.pathname.split("/")[3];
    try {
      const ics = scheduledPartyService.generateIcsCalendar(partyId, baseUrl);
      res.writeHead(200, {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="watchparty-${partyId}.ics"`,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(ics);
      return true;
    } catch (err: any) {
      sendJson(res, 404, { error: err.message || "Scheduled party not found" });
      return true;
    }
  }

  // RSVP update
  if (url.pathname.match(/^\/api\/scheduled-parties\/[^/]+\/rsvp$/) && req.method === "POST") {
    const user = await resolveUser(req, authRepo);
    if (!user) {
      sendJson(res, 401, { error: "Authentication required" });
      return true;
    }
    const partyId = url.pathname.split("/")[3];
    const body = await parseBody(req);
    const status = body.status;
    if (!status || !["attending", "maybe", "declined"].includes(status)) {
      sendJson(res, 400, { error: "Status must be 'attending', 'maybe', or 'declined'" });
      return true;
    }
    try {
      const updated = scheduledPartyService.setRsvp(partyId, user.userId, status);
      sendJson(res, 200, { success: true, party: updated });
      return true;
    } catch (err: any) {
      sendJson(res, 404, { error: err.message || "Scheduled party not found" });
      return true;
    }
  }

  if (url.pathname.startsWith("/api/scheduled-parties/") && req.method === "GET") {
    const partyId = url.pathname.replace("/api/scheduled-parties/", "").trim();
    const party = scheduledPartyService.getParty(partyId);
    if (!party) {
      sendJson(res, 404, { error: "Scheduled party not found" });
      return true;
    }
    sendJson(res, 200, { party });
    return true;
  }

  // 3. PERSISTENT HOME ROOMS (/api/home-rooms)
  if (url.pathname === "/api/home-rooms" && req.method === "POST") {
    const user = await resolveUser(req, authRepo);
    if (!user) {
      sendJson(res, 401, { error: "Authentication required to create a home room" });
      return true;
    }
    const body = await parseBody(req);
    const roomName = body.roomName || `${user.displayName}'s Home Room`;
    const homeGroupName = body.homeGroupName || "Friend Group";
    const customCode = body.roomCode;

    const { room, hostSessionToken } = roomManager.createRoom({
      hostUserId: user.userId,
      hostUserName: user.displayName,
      roomName,
      isHomeRoom: true,
      homeGroupName,
      roomCode: customCode,
      initialVideoId: body.initialVideoId || "big_buck_bunny",
    });

    sendJson(res, 201, {
      success: true,
      room: {
        roomId: room.roomId,
        roomCode: room.roomCode,
        roomName: room.roomName,
        isHomeRoom: room.isHomeRoom,
        homeGroupName: room.homeGroupName,
        joinUrl: `${baseUrl || "http://localhost:3001"}/join/${room.roomCode}`,
      },
      hostSessionToken,
    });
    return true;
  }

  if (url.pathname === "/api/home-rooms" && req.method === "GET") {
    const homeRooms = roomManager
      .getAllRooms()
      .filter((r) => r.isHomeRoom)
      .map((r) => ({
        roomId: r.roomId,
        roomCode: r.roomCode,
        roomName: r.roomName,
        homeGroupName: r.homeGroupName,
        memberCount: r.getAllMembers().filter((m) => m.isConnected).length,
        currentVideoTitle: r.playback.title || r.playback.videoId,
        joinUrl: `${baseUrl || "http://localhost:3001"}/join/${r.roomCode}`,
      }));

    sendJson(res, 200, { count: homeRooms.length, homeRooms });
    return true;
  }

  // 4. FRIENDS ACTIVITY FEED (/api/friends/activity)
  if (url.pathname === "/api/friends/activity" && req.method === "GET") {
    const user = await resolveUser(req, authRepo);
    if (!user) {
      sendJson(res, 401, { error: "Authentication required to view friends activity" });
      return true;
    }

    const activity = await friendsService.getFriendsActivity(user.userId, roomManager);
    sendJson(res, 200, { count: activity.length, activity });
    return true;
  }

  // 5. NOTIFY FRIENDS WATCH PARTY STARTED (/api/rooms/:code/notify-started)
  if (url.pathname.match(/^\/api\/rooms\/[^/]+\/notify-started$/) && req.method === "POST") {
    const user = await resolveUser(req, authRepo);
    if (!user) {
      sendJson(res, 401, { error: "Authentication required" });
      return true;
    }
    const code = url.pathname.split("/")[3];
    const room = roomManager.getRoomByCode(code);
    if (!room) {
      sendJson(res, 404, { error: "Room not found" });
      return true;
    }

    const notifiedCount = await friendsService.notifyFriendsPartyStarted(user.userId, {
      code: room.roomCode,
      name: room.roomName,
      videoTitle: room.playback.title || room.playback.videoId,
    });

    sendJson(res, 200, { success: true, notifiedCount });
    return true;
  }

  return false;
}
