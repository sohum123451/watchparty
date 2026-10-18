import http from "node:http";
import { UserDataService } from "./UserDataService.js";
import { AuthService } from "../auth/services/AuthService.js";
import { TokenSecurity } from "../auth/crypto/tokens.js";
import { getClientIp } from "../utils/ip.js";

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const list: Record<string, string> = {};
  const rc = req.headers.cookie;
  if (!rc) return list;

  rc.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const key = parts.shift()?.trim();
    if (key) {
      list[key] = decodeURIComponent(parts.join("=").trim());
    }
  });

  return list;
}

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

function parseRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
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
    ...headers,
  });
  res.end(JSON.stringify(data));
}

async function getAuthenticatedUser(req: http.IncomingMessage) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  if (!token) return null;
  return TokenSecurity.verifyAccessToken(token);
}

export async function handleUserDataRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  userDataService: UserDataService,
  authService: AuthService
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const clientIp = getClientIp(req);

  // 1. Storage serving route: /api/storage/:bucket/:key
  if (url.pathname.startsWith("/api/storage/")) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      });
      res.end();
      return true;
    }

    if (req.method === "GET") {
      const parts = url.pathname.replace("/api/storage/", "").split("/");
      const bucket = parts[0];
      const key = parts.slice(1).join("/");

      if (!bucket || !key) {
        sendJson(res, 400, { error: "Bucket and object key are required" });
        return true;
      }

      const file = await authService.getObjectStorage().getFile(bucket, key);
      if (!file) {
        sendJson(res, 404, { error: "Object not found" });
        return true;
      }

      res.writeHead(200, {
        "Content-Type": file.contentType,
        "Content-Length": file.size,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(file.data);
      return true;
    }
  }

  // Check if request belongs to /api/user/*
  if (!url.pathname.startsWith("/api/user")) {
    return false;
  }

  // Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-refresh-token",
      "Access-Control-Allow-Credentials": "true",
    });
    res.end();
    return true;
  }

  try {
    // Public verification endpoints that do not require an access token
    if (url.pathname === "/api/user/email/confirm" && req.method === "POST") {
      const body = await parseBody(req);
      const token = body.token || url.searchParams.get("token") || "";
      const result = await authService.confirmEmailChange(token);
      sendJson(res, 200, result);
      return true;
    }

    // All remaining /api/user/* endpoints require an authenticated user
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      sendJson(res, 401, { error: "Authentication required", code: "UNAUTHORIZED" });
      return true;
    }
    const userId = authUser.sub;

    const cookies = parseCookies(req);
    const currentRefreshToken =
      (req.headers["x-refresh-token"] as string) || cookies.refreshToken || undefined;

    // ------------------------------------------
    // PROFILE & AVATAR
    // ------------------------------------------

    if (url.pathname === "/api/user/profile") {
      if (req.method === "GET") {
        const profile = await authService.getProfile(userId);
        sendJson(res, 200, { profile });
        return true;
      }
      if (req.method === "PUT") {
        const body = await parseBody(req);
        const profile = await authService.updateProfile(userId, body);
        sendJson(res, 200, { profile });
        return true;
      }
    }

    if (url.pathname === "/api/user/avatar" && req.method === "POST") {
      const contentType = req.headers["content-type"] || "";
      let buffer: Buffer;
      let mimeType: string | undefined;

      if (contentType.includes("application/json")) {
        const body = await parseBody(req);
        if (body.imageBase64) {
          buffer = Buffer.from(body.imageBase64, "base64");
          mimeType = body.mimeType;
        } else {
          sendJson(res, 400, { error: "imageBase64 is required in JSON payload" });
          return true;
        }
      } else {
        buffer = await parseRawBody(req);
        mimeType = contentType.split(";")[0].trim();
      }

      const uploadResult = await authService.uploadAvatar(userId, buffer, mimeType);
      sendJson(res, 200, uploadResult);
      return true;
    }

    // ------------------------------------------
    // ACCOUNT SETTINGS & SECURITY
    // ------------------------------------------

    if (url.pathname === "/api/user/email/change" && req.method === "POST") {
      const body = await parseBody(req);
      const result = await authService.requestEmailChange(userId, body, clientIp);
      sendJson(res, 200, result);
      return true;
    }

    if (url.pathname === "/api/user/password/change" && req.method === "POST") {
      const body = await parseBody(req);
      const result = await authService.changePassword(
        userId,
        currentRefreshToken || body.currentRefreshToken,
        body
      );
      sendJson(res, 200, result);
      return true;
    }

    if (url.pathname === "/api/user/sessions" && req.method === "GET") {
      const sessions = await authService.getActiveSessions(userId, currentRefreshToken);
      sendJson(res, 200, { sessions });
      return true;
    }

    if (url.pathname.startsWith("/api/user/sessions/") && req.method === "DELETE") {
      const sessionId = url.pathname.replace("/api/user/sessions/", "").trim();
      const revoked = await authService.revokeSession(userId, sessionId);
      if (!revoked) {
        sendJson(res, 404, { error: "Session not found" });
        return true;
      }
      sendJson(res, 200, { success: true, message: "Session revoked" });
      return true;
    }

    if (url.pathname === "/api/user/sessions/revoke-others" && req.method === "POST") {
      const body = await parseBody(req);
      const token = currentRefreshToken || body.refreshToken;
      if (!token) {
        sendJson(res, 400, { error: "Current refresh token is required to revoke other sessions" });
        return true;
      }
      const count = await authService.revokeOtherSessions(userId, token);
      sendJson(res, 200, { success: true, revokedCount: count });
      return true;
    }

    if (url.pathname === "/api/user/delete-account" && req.method === "POST") {
      const body = await parseBody(req);
      const result = await authService.deleteAccount(userId, body, userDataService);
      sendJson(res, 200, result);
      return true;
    }

    if (url.pathname === "/api/user/export-data" && req.method === "GET") {
      const exportBundle = await userDataService.exportUserData(userId);
      sendJson(res, 200, { data: exportBundle });
      return true;
    }

    // ------------------------------------------
    // WATCH HISTORY
    // ------------------------------------------

    if (url.pathname === "/api/user/history") {
      if (req.method === "GET") {
        const limit = Number(url.searchParams.get("limit")) || 50;
        const offset = Number(url.searchParams.get("offset")) || 0;
        const data = await userDataService.getWatchHistory(userId, limit, offset);
        sendJson(res, 200, data);
        return true;
      }
      if (req.method === "POST") {
        const body = await parseBody(req);
        const item = await userDataService.addWatchHistory(userId, body);
        sendJson(res, 201, { item });
        return true;
      }
      if (req.method === "DELETE") {
        const result = await userDataService.clearWatchHistory(userId);
        sendJson(res, 200, result);
        return true;
      }
    }

    if (url.pathname.startsWith("/api/user/history/") && req.method === "DELETE") {
      const id = url.pathname.replace("/api/user/history/", "").trim();
      const removed = await userDataService.removeWatchHistoryItem(userId, id);
      if (!removed) {
        sendJson(res, 404, { error: "Watch history item not found" });
        return true;
      }
      sendJson(res, 200, { success: true });
      return true;
    }

    // ------------------------------------------
    // FAVOURITES
    // ------------------------------------------

    if (url.pathname === "/api/user/favourites") {
      if (req.method === "GET") {
        const limit = Number(url.searchParams.get("limit")) || 50;
        const offset = Number(url.searchParams.get("offset")) || 0;
        const data = await userDataService.getFavourites(userId, limit, offset);
        sendJson(res, 200, data);
        return true;
      }
      if (req.method === "POST") {
        const body = await parseBody(req);
        const item = await userDataService.addFavourite(userId, body);
        sendJson(res, 201, { item });
        return true;
      }
    }

    if (url.pathname.startsWith("/api/user/favourites/") && req.method === "DELETE") {
      const videoId = decodeURIComponent(url.pathname.replace("/api/user/favourites/", "").trim());
      const removed = await userDataService.removeFavourite(userId, videoId);
      if (!removed) {
        sendJson(res, 404, { error: "Favourite not found" });
        return true;
      }
      sendJson(res, 200, { success: true });
      return true;
    }

    // ------------------------------------------
    // CO-WATCHING SESSIONS & STATS
    // ------------------------------------------

    if (url.pathname === "/api/user/co-watch/record" && req.method === "POST") {
      const body = await parseBody(req);
      await userDataService.recordCoWatchSession(userId, body);
      sendJson(res, 200, { success: true });
      return true;
    }

    if (url.pathname === "/api/user/stats/co-watch" && req.method === "GET") {
      const friendUserId = url.searchParams.get("friendUserId") || undefined;
      const stats = await userDataService.getCoWatchStats(userId, friendUserId);
      sendJson(res, 200, { stats });
      return true;
    }

    // ------------------------------------------
    // PERSONAL PLAYLISTS
    // ------------------------------------------

    if (url.pathname === "/api/user/playlists") {
      if (req.method === "GET") {
        const playlists = await userDataService.getUserPlaylists(userId);
        sendJson(res, 200, { playlists });
        return true;
      }
      if (req.method === "POST") {
        const body = await parseBody(req);
        const playlist = await userDataService.createPlaylist(userId, body);
        sendJson(res, 201, { playlist });
        return true;
      }
    }

    if (url.pathname.startsWith("/api/user/playlists/")) {
      const subpath = url.pathname.replace("/api/user/playlists/", "");

      // POST /api/user/playlists/:id/load-to-room
      if (subpath.includes("/load-to-room") && req.method === "POST") {
        const playlistId = subpath.replace("/load-to-room", "").trim();
        const body = await parseBody(req);
        const roomId = body.roomId;
        const mode = body.mode || "append";
        if (!roomId) {
          sendJson(res, 400, { error: "roomId is required" });
          return true;
        }
        const result = await userDataService.loadPlaylistIntoRoom(userId, playlistId, roomId, mode);
        sendJson(res, 200, result);
        return true;
      }

      const playlistId = subpath.trim();

      if (req.method === "GET") {
        const playlist = await userDataService.getPlaylistById(playlistId, userId);
        if (!playlist) {
          sendJson(res, 404, { error: "Playlist not found or access denied" });
          return true;
        }
        sendJson(res, 200, { playlist });
        return true;
      }

      if (req.method === "PUT") {
        const body = await parseBody(req);
        const playlist = await userDataService.updatePlaylist(userId, playlistId, body);
        if (!playlist) {
          sendJson(res, 404, { error: "Playlist not found or access denied" });
          return true;
        }
        sendJson(res, 200, { playlist });
        return true;
      }

      if (req.method === "DELETE") {
        const deleted = await userDataService.deletePlaylist(userId, playlistId);
        if (!deleted) {
          sendJson(res, 404, { error: "Playlist not found or access denied" });
          return true;
        }
        sendJson(res, 200, { success: true });
        return true;
      }
    }

    sendJson(res, 404, { error: "Endpoint not found" });
    return true;
  } catch (err: any) {
    const status = err.status || (err.name === "ZodError" ? 400 : 500);
    sendJson(res, status, {
      error: err.message || "An unexpected error occurred",
      details: err.errors || undefined,
    });
    return true;
  }
}
