import http from "node:http";
import { AdminService } from "./AdminService.js";
import { globalSentry } from "../observability/SentryClient.js";
import { Logger, rootLogger } from "../utils/logger.js";
import { getAdminDashboardHtml } from "../ui/AdminDashboardPage.js";
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

function sendJson(res: http.ServerResponse, statusCode: number, data: any, headers: Record<string, string> = {}): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
    ...headers,
  });
  res.end(JSON.stringify(data));
}

export async function handleAdminRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  adminService: AdminService,
  logger: Logger = rootLogger
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // 1. Client-Side Sentry & Error Telemetry Endpoint
  if (url.pathname === "/api/observability/client-errors" && req.method === "POST") {
    const body = await parseBody(req);
    const clientIp = getClientIp(req);

    logger.withRoomAndUser(body.roomId, body.userId).error(`[CLIENT_ERROR] ${body.message}`, {
      stack: body.stack,
      url: body.url,
      userAgent: req.headers["user-agent"],
      ip: clientIp,
      clientSeq: body.clientSeq,
    });

    globalSentry.captureMessage(body.message || "Unknown client error", "error", {
      roomId: body.roomId,
      userId: body.userId,
      extra: { ...body, ip: clientIp, userAgent: req.headers["user-agent"] },
    }).catch(() => {});

    sendJson(res, 200, { received: true });
    return true;
  }

  // 2. Admin Dashboard HTML Page (/admin)
  if (url.pathname === "/admin" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getAdminDashboardHtml());
    return true;
  }

  // Check if route is an Admin API (/api/admin/*)
  if (!url.pathname.startsWith("/api/admin")) {
    return false;
  }

  // 3. Admin Authentication Verification
  // Check Authorization header (Bearer <ADMIN_SECRET>), X-Admin-Key, or cookie admin_session
  const authHeader = req.headers["authorization"] || req.headers["x-admin-key"] as string;
  const cookies = parseCookies(req);
  const candidateSecret = authHeader ? String(authHeader).replace(/^Bearer\s+/i, "").trim() : cookies["admin_session"];

  const isAuthorized = adminService.verifyAdminSecret(candidateSecret);

  // Allow login endpoint without prior authentication
  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    const body = await parseBody(req);
    const valid = adminService.verifyAdminSecret(body.secret);
    if (!valid) {
      sendJson(res, 401, { error: "Invalid admin secret" });
      return true;
    }

    const isProd = process.env.NODE_ENV === "production";
    res.setHeader("Set-Cookie", `admin_session=${encodeURIComponent(body.secret)}; Path=/; HttpOnly; SameSite=Lax${isProd ? "; Secure" : ""}`);
    sendJson(res, 200, { success: true, message: "Admin authenticated" });
    return true;
  }

  if (!isAuthorized) {
    sendJson(res, 401, { error: "Unauthorized: Valid ADMIN_SECRET required" });
    return true;
  }

  // =========================================================================
  // PROTECTED ADMIN ENDPOINTS
  // =========================================================================

  try {
    // GET /api/admin/stats
    if (url.pathname === "/api/admin/stats" && req.method === "GET") {
      const stats = adminService.getUsageReport();
      sendJson(res, 200, stats);
      return true;
    }

    // GET /api/admin/users
    if (url.pathname === "/api/admin/users" && req.method === "GET") {
      const query = url.searchParams.get("query") || undefined;
      const page = parseInt(url.searchParams.get("page") || "1", 10);
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);
      const result = await adminService.listUsers({ query, page, limit });
      sendJson(res, 200, result);
      return true;
    }

    // POST /api/admin/users/:id/ban
    const banMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/ban$/);
    if (banMatch && req.method === "POST") {
      const userId = banMatch[1];
      const body = await parseBody(req);
      const result = await adminService.banUser(userId, body.reason);
      sendJson(res, result.success ? 200 : 400, result);
      return true;
    }

    // POST /api/admin/users/:id/unban
    const unbanMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/unban$/);
    if (unbanMatch && req.method === "POST") {
      const userId = unbanMatch[1];
      const result = await adminService.unbanUser(userId);
      sendJson(res, result.success ? 200 : 400, result);
      return true;
    }

    // POST /api/admin/users/:id/revoke-sessions
    const revokeMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/revoke-sessions$/);
    if (revokeMatch && req.method === "POST") {
      const userId = revokeMatch[1];
      const result = await adminService.revokeUserSessions(userId);
      sendJson(res, 200, result);
      return true;
    }

    // POST /api/admin/users/:id/resend-verification
    const resendMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/resend-verification$/);
    if (resendMatch && req.method === "POST") {
      const userId = resendMatch[1];
      const baseUrl = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host || "localhost:3001"}`;
      const result = await adminService.resendVerificationEmail(userId, baseUrl);
      sendJson(res, result.success ? 200 : 400, result);
      return true;
    }

    // GET /api/admin/rooms
    if (url.pathname === "/api/admin/rooms" && req.method === "GET") {
      const rooms = adminService.listActiveRooms();
      sendJson(res, 200, rooms);
      return true;
    }

    // POST /api/admin/rooms/:id/close
    const closeRoomMatch = url.pathname.match(/^\/api\/admin\/rooms\/([^/]+)\/close$/);
    if (closeRoomMatch && req.method === "POST") {
      const roomId = closeRoomMatch[1];
      const body = await parseBody(req);
      const result = adminService.forceCloseRoom(roomId, body.reason);
      sendJson(res, result.success ? 200 : 404, result);
      return true;
    }

    // POST /api/admin/rooms/:id/lock
    const lockRoomMatch = url.pathname.match(/^\/api\/admin\/rooms\/([^/]+)\/lock$/);
    if (lockRoomMatch && req.method === "POST") {
      const roomId = lockRoomMatch[1];
      const body = await parseBody(req);
      const result = adminService.toggleRoomLock(roomId, Boolean(body.locked));
      sendJson(res, result.success ? 200 : 404, result);
      return true;
    }

    // GET /api/admin/reports
    if (url.pathname === "/api/admin/reports" && req.method === "GET") {
      const reports = adminService.listModerationReports();
      sendJson(res, 200, reports);
      return true;
    }

    // POST /api/admin/reports/:id/action
    const reportActionMatch = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)\/action$/);
    if (reportActionMatch && req.method === "POST") {
      const reportId = reportActionMatch[1];
      const body = await parseBody(req);
      const result = await adminService.actionReport(reportId, body.action, body.reason);
      sendJson(res, result.success ? 200 : 400, result);
      return true;
    }

    // GET /api/admin/invites
    if (url.pathname === "/api/admin/invites" && req.method === "GET") {
      const invites = adminService.listInvites();
      sendJson(res, 200, invites);
      return true;
    }

    // POST /api/admin/invites
    if (url.pathname === "/api/admin/invites" && req.method === "POST") {
      const body = await parseBody(req);
      const invite = adminService.createInvite({
        customCode: body.customCode,
        maxUses: body.maxUses,
        expiresInDays: body.expiresInDays,
        note: body.note,
      });
      sendJson(res, 201, invite);
      return true;
    }

    // DELETE /api/admin/invites/:code
    const revokeInviteMatch = url.pathname.match(/^\/api\/admin\/invites\/([^/]+)$/);
    if (revokeInviteMatch && req.method === "DELETE") {
      const code = decodeURIComponent(revokeInviteMatch[1]);
      const success = adminService.revokeInvite(code);
      sendJson(res, success ? 200 : 404, { success });
      return true;
    }

    // POST /api/admin/registration-mode
    if (url.pathname === "/api/admin/registration-mode" && req.method === "POST") {
      const body = await parseBody(req);
      if (!["public", "invite_only", "disabled"].includes(body.mode)) {
        sendJson(res, 400, { error: "Invalid registration mode" });
        return true;
      }
      adminService.setRegistrationMode(body.mode);
      sendJson(res, 200, { success: true, mode: body.mode });
      return true;
    }

    // GET /api/admin/errors
    if (url.pathname === "/api/admin/errors" && req.method === "GET") {
      const recentErrors = globalSentry.getRecentEvents();
      sendJson(res, 200, recentErrors);
      return true;
    }

    return false;
  } catch (err: any) {
    logger.error(`[AdminRoutes] Error handling route ${url.pathname}`, undefined, err);
    sendJson(res, 500, { error: err.message || "Internal admin error" });
    return true;
  }
}
