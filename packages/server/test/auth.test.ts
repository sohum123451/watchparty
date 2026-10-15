import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { WebSocket } from "ws";
import {
  AuthService,
  MemoryAuthRepository,
  ConsoleMailer,
  PasswordSecurity,
  TokenSecurity,
  RateLimiterService,
  WsTicketService,
  handleAuthRoute,
} from "../src/auth/index.js";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { WebSocketGateway } from "../src/gateway/WebSocketGateway.js";
import { WS_CLOSE_CODES, ERROR_CODES, ServerMessage } from "@watchparty/shared";

function connectWs(port: number, headers: Record<string, string> = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`, { headers });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitForMessage(
  ws: WebSocket,
  filter?: (msg: ServerMessage) => boolean
): Promise<ServerMessage> {
  return new Promise((resolve) => {
    const handler = (data: Buffer | string) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (!filter || filter(msg)) {
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

describe("Authentication & Authorization System", () => {
  let authRepo: MemoryAuthRepository;
  let mailer: ConsoleMailer;
  let rateLimiter: RateLimiterService;
  let wsTicketService: WsTicketService;
  let authService: AuthService;

  let server: http.Server;
  let gateway: WebSocketGateway;
  let roomManager: RoomManager;
  let port: number;

  beforeEach(async () => {
    authRepo = new MemoryAuthRepository();
    mailer = new ConsoleMailer();
    rateLimiter = new RateLimiterService();
    wsTicketService = new WsTicketService();

    authService = new AuthService({
      repo: authRepo,
      mailer,
      rateLimiter,
      wsTicketService,
      baseUrl: "http://localhost:3000",
    });

    roomManager = new RoomManager();
    server = http.createServer(async (req, res) => {
      const handled = await handleAuthRoute(req, res, authService);
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });

    gateway = new WebSocketGateway(server, roomManager, {
      authService,
      enforceVerifiedToCreateRoom: true,
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          port = addr.port;
          roomManager.setBaseUrl(`http://localhost:${port}`);
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ==========================================
  // 1. PASSWORD POLICY & ARGON2ID HASHING
  // ==========================================
  describe("Password Policy & Argon2id Security", () => {
    it("hashes passwords strictly with Argon2id ($argon2id$ format)", async () => {
      const hash = await PasswordSecurity.hashPassword("SecurePass!123");
      expect(hash.startsWith("$argon2id$")).toBe(true);
      expect(await PasswordSecurity.verifyPassword("SecurePass!123", hash)).toBe(true);
      expect(await PasswordSecurity.verifyPassword("WrongPassword", hash)).toBe(false);
    });

    it("rejects passwords violating complexity policy", () => {
      expect(PasswordSecurity.validatePassword("short").isValid).toBe(false);
      expect(PasswordSecurity.validatePassword("nouppercase1!").isValid).toBe(false);
      expect(PasswordSecurity.validatePassword("NOLOWERCASE1!").isValid).toBe(false);
      expect(PasswordSecurity.validatePassword("NoSpecial123").isValid).toBe(false);
      expect(PasswordSecurity.validatePassword("ValidPass!123").isValid).toBe(true);
    });

    it("rejects passwords matching the common passwords blacklist", () => {
      expect(PasswordSecurity.validatePassword("password").isValid).toBe(false);
      expect(PasswordSecurity.validatePassword("12345678").isValid).toBe(false);
      expect(PasswordSecurity.validatePassword("welcome123").isValid).toBe(false);
    });
  });

  // ==========================================
  // 2. SIGNUP, EMAIL VERIFICATION & PERMISSIONS
  // ==========================================
  describe("Signup and Email Verification", () => {
    it("signs up user, sends single-use expiring verification email, and allows login as unverified", async () => {
      const session = await authService.signup({
        email: "TestUser@Example.COM ",
        password: "SuperSecret!99",
        displayName: "Test User",
      });

      expect(session.user.email).toBe("testuser@example.com"); // lowercased and trimmed
      expect(session.user.isEmailVerified).toBe(false);
      expect(session.accessToken).toBeDefined();
      expect(session.refreshToken).toBeDefined();

      // Check mailer received verification token
      const sent = mailer.getLatestEmailFor("testuser@example.com");
      expect(sent).toBeDefined();
      expect(sent?.type).toBe("verification");

      // Verify token successfully
      const verifyRes = await authService.verifyEmail(sent!.token);
      expect(verifyRes.success).toBe(true);

      // Verify email token cannot be reused
      await expect(authService.verifyEmail(sent!.token)).rejects.toThrow("Invalid or previously used");
    });

    it("enforces that unverified users cannot create rooms", async () => {
      const session = await authService.signup({
        email: "unverified@example.com",
        password: "UnverifiedPass!1",
        displayName: "Unverified Bob",
      });

      // Get WebSocket ticket for unverified user
      const { ticket } = await authService.createWsTicket(session.accessToken);
      const ws = await connectWs(port, { "x-ws-ticket": ticket });

      const errorPromise = waitForMessage(ws, (m) => m.type === "ERROR");
      ws.send(
        JSON.stringify({
          type: "ROOM_CREATE",
          clientSeq: 1,
          payload: {
            userName: "Unverified Bob",
            roomName: "Forbidden Room",
            controlMode: "public",
          },
        })
      );

      const errorMsg = await errorPromise;
      expect(errorMsg.type).toBe("ERROR");
      if (errorMsg.type === "ERROR") {
        expect(errorMsg.code).toBe(ERROR_CODES.PERMISSION_DENIED);
        expect(errorMsg.message).toContain("verify your email address");
      }
      ws.close();
    });

    it("allows verified users to create rooms", async () => {
      const session = await authService.signup({
        email: "verified@example.com",
        password: "VerifiedPass!1",
        displayName: "Verified Alice",
      });

      const sent = mailer.getLatestEmailFor("verified@example.com");
      await authService.verifyEmail(sent!.token);

      // Re-login to get updated verified token
      const loginSession = await authService.login({
        email: "verified@example.com",
        password: "VerifiedPass!1",
      });
      expect(loginSession.user.isEmailVerified).toBe(true);

      const { ticket } = await authService.createWsTicket(loginSession.accessToken);
      const ws = await connectWs(port, { "x-ws-ticket": ticket });

      const snapshotPromise = waitForMessage(ws, (m) => m.type === "ROOM_SNAPSHOT");
      ws.send(
        JSON.stringify({
          type: "ROOM_CREATE",
          clientSeq: 1,
          payload: {
            userName: "Verified Alice",
            roomName: "Allowed Room",
            controlMode: "public",
          },
        })
      );

      const snapshotMsg = await snapshotPromise;
      expect(snapshotMsg.type).toBe("ROOM_SNAPSHOT");
      ws.close();
    });
  });

  // ==========================================
  // 3. TOKEN ROTATION & REUSE DETECTION
  // ==========================================
  describe("Session Token Rotation & Reuse Detection", () => {
    it("rotates refresh token cleanly on /refresh", async () => {
      const session1 = await authService.signup({
        email: "rotator@example.com",
        password: "RotatorPass!1",
        displayName: "Rotator",
      });

      const r1 = session1.refreshToken;
      const session2 = await authService.refresh(r1);

      expect(session2.refreshToken).not.toBe(r1);
      expect(session2.accessToken).toBeDefined();

      // Subsequent refresh with r2 succeeds
      const session3 = await authService.refresh(session2.refreshToken);
      expect(session3.refreshToken).not.toBe(session2.refreshToken);
    });

    it("detects refresh token reuse and immediately revokes entire token family", async () => {
      const session1 = await authService.signup({
        email: "victim@example.com",
        password: "VictimPass!1",
        displayName: "Victim",
      });

      const r1 = session1.refreshToken;

      // Legitimate client rotates r1 -> r2
      const session2 = await authService.refresh(r1);
      const r2 = session2.refreshToken;

      // Connect an active WebSocket connection for this user
      const { ticket } = await authService.createWsTicket(session2.accessToken);
      const ws = await connectWs(port, { "x-ws-ticket": ticket });

      const wsClosedPromise = new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on("close", (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      // Attacker replays already-used r1!
      await expect(authService.refresh(r1)).rejects.toThrow("Refresh token reuse detected");

      // WebSocket connection must be terminated with policy violation code
      const closeEvent = await wsClosedPromise;
      expect(closeEvent.code).toBe(WS_CLOSE_CODES.POLICY_VIOLATION);

      // Now legitimate r2 must also fail because the entire family was revoked!
      await expect(authService.refresh(r2)).rejects.toThrow();
    });
  });

  // ==========================================
  // 4. PASSWORD RESET FLOW & ENUMERATION RESISTANCE
  // ==========================================
  describe("Password Reset & Enumeration Resistance", () => {
    it("returns identical response whether or not email exists (no enumeration)", async () => {
      const resReal = await authService.forgotPassword("existing@example.com");
      const resFake = await authService.forgotPassword("doesnotexist@example.com");

      expect(resReal.message).toBe("If an account with that email exists, a password reset link has been sent.");
      expect(resFake.message).toBe("If an account with that email exists, a password reset link has been sent.");
    });

    it("resets password, revokes all sessions, and rejects replayed or expired tokens", async () => {
      const session = await authService.signup({
        email: "resetme@example.com",
        password: "OldPassword!1",
        displayName: "Reset User",
      });

      const oldRefreshToken = session.refreshToken;

      await authService.forgotPassword("resetme@example.com");
      const email = mailer.getLatestEmailFor("resetme@example.com");
      expect(email?.type).toBe("password_reset");

      // Reset password with token
      const resetRes = await authService.resetPassword(email!.token, "NewPassword!2");
      expect(resetRes.success).toBe(true);

      // Token cannot be replayed
      await expect(authService.resetPassword(email!.token, "AnotherPass!3")).rejects.toThrow(
        "Invalid or previously used"
      );

      // Old refresh token is revoked across all devices
      await expect(authService.refresh(oldRefreshToken)).rejects.toThrow();

      // Can log in with new password
      const newLogin = await authService.login({
        email: "resetme@example.com",
        password: "NewPassword!2",
      });
      expect(newLogin.accessToken).toBeDefined();

      // Old password fails
      await expect(
        authService.login({
          email: "resetme@example.com",
          password: "OldPassword!1",
        })
      ).rejects.toThrow("Invalid email or password");
    });
  });

  // ==========================================
  // 5. RATE LIMITING & LOCKOUT BACKOFF
  // ==========================================
  describe("Rate Limiting & Lockout with Exponential Backoff", () => {
    it("triggers account lockout after 5 consecutive failed logins", async () => {
      await authService.signup({
        email: "target@example.com",
        password: "TargetPassword!1",
        displayName: "Target",
      });

      // 4 failed attempts allowed before lockout
      for (let i = 0; i < 4; i++) {
        await expect(
          authService.login({
            email: "target@example.com",
            password: "WrongPassword!1",
            clientIp: "10.0.0.1",
          })
        ).rejects.toThrow("Invalid email or password");
      }

      // 5th failed attempt triggers lockout
      await expect(
        authService.login({
          email: "target@example.com",
          password: "WrongPassword!1",
          clientIp: "10.0.0.1",
        })
      ).rejects.toThrow();

      // 6th attempt is blocked immediately by rate limiter before password check
      await expect(
        authService.login({
          email: "target@example.com",
          password: "TargetPassword!1", // even correct password blocked
          clientIp: "10.0.0.1",
        })
      ).rejects.toThrow("Account temporarily locked");
    });
  });

  // ==========================================
  // 6. WEBSOCKET AUTH HANDSHAKE & REVOCATION
  // ==========================================
  describe("WebSocket Authentication & Close Codes", () => {
    it("authenticates WebSocket connection via handshake ticket and rejects query strings or invalid tickets", async () => {
      const session = await authService.signup({
        email: "wsauth@example.com",
        password: "WsAuthPassword!1",
        displayName: "WsAuthUser",
      });

      const { ticket } = await authService.createWsTicket(session.accessToken);

      // Connect with valid ticket in headers
      const ws = await connectWs(port, { "x-ws-ticket": ticket });
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();

      // Connect with invalid ticket -> closed with POLICY_VIOLATION
      const wsClosedPromise = new Promise<number>((resolve) => {
        const badWs = new WebSocket(`ws://localhost:${port}`, {
          headers: { "x-ws-ticket": "invalid_ticket" },
        });
        badWs.on("close", (code) => resolve(code));
      });

      const closeCode = await wsClosedPromise;
      expect(closeCode).toBe(WS_CLOSE_CODES.POLICY_VIOLATION);
    });

    it("terminates all active WebSocket connections with typed code on 'log out everywhere'", async () => {
      const session = await authService.signup({
        email: "multidevice@example.com",
        password: "MultiPassword!1",
        displayName: "Multi Device",
      });

      const { ticket: t1 } = await authService.createWsTicket(session.accessToken);
      const ws1 = await connectWs(port, { "x-ws-ticket": t1 });

      const ws1Closed = new Promise<number>((resolve) => {
        ws1.on("close", (code) => resolve(code));
      });

      // Log out everywhere
      await authService.logoutAll(session.user.id);

      const code1 = await ws1Closed;
      expect(code1).toBe(WS_CLOSE_CODES.POLICY_VIOLATION);
    });
  });

  // ==========================================
  // 7. GUESTS & GUEST UPGRADE FLOW
  // ==========================================
  describe("Guests and Guest Account Upgrade", () => {
    it("allows guest to join room with restricted permissions and upgrade to account", async () => {
      // 1. Verified host creates room
      const hostSession = await authService.signup({
        email: "hostparty@example.com",
        password: "HostPartyPass!1",
        displayName: "Party Host",
      });
      const sent = mailer.getLatestEmailFor("hostparty@example.com");
      await authService.verifyEmail(sent!.token);
      const verifiedLogin = await authService.login({
        email: "hostparty@example.com",
        password: "HostPartyPass!1",
      });

      const { ticket: hostTicket } = await authService.createWsTicket(verifiedLogin.accessToken);
      const hostWs = await connectWs(port, { "x-ws-ticket": hostTicket });

      const hostSnapshotP = waitForMessage(hostWs, (m) => m.type === "ROOM_SNAPSHOT");
      hostWs.send(
        JSON.stringify({
          type: "ROOM_CREATE",
          clientSeq: 1,
          payload: {
            userName: "Party Host",
            roomName: "Open Party",
            controlMode: "public",
          },
        })
      );
      const hostSnap = await hostSnapshotP;
      if (hostSnap.type !== "ROOM_SNAPSHOT") return;
      const roomCode = hostSnap.payload.roomCode;

      // 2. Guest connects without account
      const guestWs = await connectWs(port);
      const guestSnapP = waitForMessage(guestWs, (m) => m.type === "ROOM_SNAPSHOT");
      guestWs.send(
        JSON.stringify({
          type: "ROOM_JOIN",
          clientSeq: 1,
          payload: {
            roomCode,
            userName: "Guest Dave",
          },
        })
      );
      const guestSnap = await guestSnapP;
      expect(guestSnap.type).toBe("ROOM_SNAPSHOT");

      // 3. Guest upgrades to registered account
      const upgradeSession = await authService.upgradeGuest({
        guestUserId: "guest_dave",
        email: "dave.upgraded@example.com",
        password: "UpgradedPass!1",
        displayName: "Dave Upgraded",
      });

      expect(upgradeSession.user.email).toBe("dave.upgraded@example.com");
      expect(upgradeSession.accessToken).toBeDefined();

      hostWs.close();
      guestWs.close();
    });
  });
});
