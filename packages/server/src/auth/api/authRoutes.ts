import http from "node:http";
import { AuthService } from "../services/AuthService.js";
import { TokenSecurity } from "../crypto/tokens.js";
import { defaultSecurityMiddleware } from "../../security/headers.js";
import { getClientIp } from "../../utils/ip.js";

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
    ...headers,
  });
  res.end(JSON.stringify(data));
}

function setRefreshTokenCookie(res: http.ServerResponse, token: string, maxAgeSeconds = 30 * 24 * 60 * 60): void {
  const isProd = process.env.NODE_ENV === "production";
  const cookieStr = `refreshToken=${encodeURIComponent(token)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${isProd ? "; Secure" : ""}`;
  res.setHeader("Set-Cookie", cookieStr);
}

function clearRefreshTokenCookie(res: http.ServerResponse): void {
  const isProd = process.env.NODE_ENV === "production";
  const cookieStr = `refreshToken=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${isProd ? "; Secure" : ""}`;
  res.setHeader("Set-Cookie", cookieStr);
}

export async function handleAuthRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  authService: AuthService
): Promise<boolean> {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (!url.pathname.startsWith("/api/auth")) {
    return false;
  }

  const origin = req.headers.origin;
  const hostHeader = (req.headers["x-forwarded-host"] as string) || req.headers.host;
  const isAllowed = origin ? defaultSecurityMiddleware.isOriginAllowed(origin, hostHeader) : false;
  (res as any)._reqOrigin = isAllowed ? origin : null;

  const clientIp = getClientIp(req);
  const deviceInfo = (req.headers["user-agent"] as string) || "Unknown client";

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...(isAllowed ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
      } : {}),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    });
    res.end();
    return true;
  }

  try {
    // 0. POST /api/auth/guest
    if (url.pathname === "/api/auth/guest" && req.method === "POST") {
      const body = await parseBody(req);
      const name = (body.displayName as string)?.trim() || `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
      const guestId = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      sendJson(res, 200, {
        user: { id: guestId, displayName: name, isGuest: true },
        accessToken: null,
      });
      return true;
    }

    // 1. POST /api/auth/signup (or /api/auth/register)
    if ((url.pathname === "/api/auth/signup" || url.pathname === "/api/auth/register") && req.method === "POST") {
      const body = await parseBody(req);
      const session = await authService.signup({
        email: body.email,
        password: body.password,
        displayName: body.displayName,
        avatar: body.avatar,
        deviceInfo,
        clientIp,
        inviteCode: body.inviteCode || url.searchParams.get("invite") || undefined,
      });

      setRefreshTokenCookie(res, session.refreshToken);
      sendJson(res, 201, {
        user: session.user,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      });
      return true;
    }

    // Google Identity / OAuth endpoint: POST /api/auth/google
    if (url.pathname === "/api/auth/google" && req.method === "POST") {
      const body = await parseBody(req);
      let googleId = body.googleId;
      let email = body.email;
      let displayName = body.displayName;
      let avatar = body.avatar;

      // Decode Google Identity Services (GIS) credential token if supplied
      if (body.credential && typeof body.credential === "string") {
        try {
          const parts = body.credential.split(".");
          if (parts.length >= 2) {
            const rawPayload = Buffer.from(parts[1], "base64").toString("utf8");
            const parsed = JSON.parse(rawPayload);
            googleId = parsed.sub || googleId;
            email = parsed.email || email;
            displayName = parsed.name || displayName;
            avatar = parsed.picture || avatar;
          }
        } catch {
          // Proceed with explicit parameters
        }
      }

      if (!googleId || !email) {
        sendJson(res, 400, { error: "Google identification (googleId and email) is required" });
        return true;
      }

      const session = await authService.loginWithGoogle({
        googleId,
        email,
        displayName,
        avatar,
        deviceInfo,
        clientIp,
      });

      setRefreshTokenCookie(res, session.refreshToken);
      sendJson(res, 200, {
        user: session.user,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      });
      return true;
    }

    // 2. POST /api/auth/login
    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const body = await parseBody(req);
      const session = await authService.login({
        email: body.email,
        password: body.password,
        deviceInfo,
        clientIp,
      });

      setRefreshTokenCookie(res, session.refreshToken);
      sendJson(res, 200, {
        user: session.user,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      });
      return true;
    }

    // 3. POST /api/auth/refresh
    if (url.pathname === "/api/auth/refresh" && req.method === "POST") {
      const cookies = parseCookies(req);
      const body = await parseBody(req);
      const rawToken = cookies.refreshToken || body.refreshToken;

      const session = await authService.refresh(rawToken, deviceInfo);
      setRefreshTokenCookie(res, session.refreshToken);
      sendJson(res, 200, {
        user: session.user,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      });
      return true;
    }

    // 4. POST /api/auth/logout
    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      const cookies = parseCookies(req);
      const body = await parseBody(req);
      const rawToken = cookies.refreshToken || body.refreshToken;

      if (rawToken) {
        await authService.logout(rawToken);
      }
      clearRefreshTokenCookie(res);
      sendJson(res, 200, { message: "Logged out successfully" });
      return true;
    }

    // 5. POST /api/auth/logout-all
    if (url.pathname === "/api/auth/logout-all" && req.method === "POST") {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
      if (!token) {
        sendJson(res, 401, { error: "Authentication token required" });
        return true;
      }

      const payload = await TokenSecurity.verifyAccessToken(token);
      if (!payload) {
        sendJson(res, 401, { error: "Invalid or expired token" });
        return true;
      }

      const revokedCount = await authService.logoutAll(payload.sub);
      clearRefreshTokenCookie(res);
      sendJson(res, 200, {
        message: "Successfully logged out from all devices",
        sessionsRevoked: revokedCount,
      });
      return true;
    }

    // 6. POST /api/auth/forgot-password
    if (url.pathname === "/api/auth/forgot-password" && req.method === "POST") {
      const body = await parseBody(req);
      const result = await authService.forgotPassword(body.email || "", clientIp);
      sendJson(res, 200, result);
      return true;
    }

    // 7. POST /api/auth/reset-password
    if (url.pathname === "/api/auth/reset-password" && req.method === "POST") {
      const body = await parseBody(req);
      const result = await authService.resetPassword(body.token, body.newPassword);
      sendJson(res, 200, result);
      return true;
    }

    // 8. POST or GET /api/auth/verify-email
    if (url.pathname === "/api/auth/verify-email" && (req.method === "POST" || req.method === "GET")) {
      let token = url.searchParams.get("token") || "";
      if (req.method === "POST") {
        const body = await parseBody(req);
        token = body.token || token;
      }
      const result = await authService.verifyEmail(token);
      sendJson(res, 200, result);
      return true;
    }

    // 9. POST /api/auth/ws-ticket
    if (url.pathname === "/api/auth/ws-ticket" && req.method === "POST") {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
      if (!token) {
        sendJson(res, 401, { error: "Authorization header required" });
        return true;
      }

      const ticket = await authService.createWsTicket(token, deviceInfo);
      sendJson(res, 200, ticket);
      return true;
    }

    // 10. GET /api/auth/me
    if (url.pathname === "/api/auth/me" && req.method === "GET") {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
      if (!token) {
        sendJson(res, 401, { error: "Authorization header required" });
        return true;
      }

      const payload = await TokenSecurity.verifyAccessToken(token);
      if (!payload) {
        sendJson(res, 401, { error: "Invalid or expired token" });
        return true;
      }

      const user = await authService.getRepo().findUserById(payload.sub);
      if (!user) {
        sendJson(res, 404, { error: "User not found" });
        return true;
      }

      sendJson(res, 200, {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          username: user.username,
          friendCode: user.friendCode,
          presencePrivacy: user.presencePrivacy,
          avatar: user.avatar,
          isEmailVerified: user.emailVerifiedAt !== null,
        },
      });
      return true;
    }

    // 11. POST /api/auth/upgrade-guest
    if (url.pathname === "/api/auth/upgrade-guest" && req.method === "POST") {
      const body = await parseBody(req);
      const session = await authService.upgradeGuest({
        guestUserId: body.guestUserId,
        email: body.email,
        password: body.password,
        displayName: body.displayName,
        deviceInfo,
      });

      setRefreshTokenCookie(res, session.refreshToken);
      sendJson(res, 200, session);
      return true;
    }
  } catch (err: any) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || "Internal server error" });
    return true;
  }

  sendJson(res, 404, { error: "Auth route not found" });
  return true;
}
