import { describe, it, expect, beforeEach, vi } from "vitest";
import { SentryClient } from "../src/observability/SentryClient.js";
import { Logger } from "../src/utils/logger.js";
import { AdminService } from "../src/admin/AdminService.js";
import { MemoryAuthRepository } from "../src/auth/db/AuthRepository.js";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { AuthService } from "../src/auth/services/AuthService.js";
import { ConsoleMailer } from "../src/auth/index.js";
import { validateEnv } from "../src/config/env.js";
import { getAdminDashboardHtml } from "../src/ui/AdminDashboardPage.js";
import http from "node:http";
import { handleAdminRoutes } from "../src/admin/adminRoutes.js";

describe("Lightweight Observability, Sentry & Admin Tooling Suite", () => {
  const TEST_ADMIN_SECRET = "test-admin-secret-password-32chars!";
  let authRepo: MemoryAuthRepository;
  let roomManager: RoomManager;
  let mailer: ConsoleMailer;
  let adminService: AdminService;
  let authService: AuthService;

  beforeEach(() => {
    authRepo = new MemoryAuthRepository();
    roomManager = new RoomManager("http://localhost:3001");
    mailer = new ConsoleMailer();
    adminService = new AdminService({
      authRepo,
      roomManager,
      mailer,
      adminSecret: TEST_ADMIN_SECRET,
      initialRegistrationMode: "invite_only",
      masterInviteCode: "FRIENDS2026",
    });
    authService = new AuthService({
      repo: authRepo,
      mailer,
      baseUrl: "http://localhost:3001",
      adminService,
    });
    authService.setAdminService(adminService);
  });

  // =========================================================================
  // 1. SENTRY ERROR TRACKING & STRUCTURED LOGGING
  // =========================================================================
  describe("Sentry Client & Structured Logging", () => {
    it("parses Sentry DSN and enables error capturing with room and user correlation", async () => {
      const client = new SentryClient({
        dsn: "https://abcdef123456@o12345.ingest.sentry.io/67890",
        environment: "test",
        release: "watchparty@1.0.0",
      });

      expect(client.isEnabled()).toBe(true);

      const eventId = await client.captureException(new Error("Test crash in video player"), {
        roomId: "room_movie_night",
        userId: "usr_alex_123",
        extra: { playbackPosition: 120 },
      });

      expect(eventId).toBeDefined();
      expect(typeof eventId).toBe("string");

      const recent = client.getRecentEvents();
      expect(recent.length).toBeGreaterThan(0);
      expect(recent[0].roomId).toBe("room_movie_night");
      expect(recent[0].userId).toBe("usr_alex_123");
      expect(recent[0].message).toContain("Test crash in video player");
    });

    it("captures structured messages and custom breadcrumbs", async () => {
      const client = new SentryClient();
      client.addBreadcrumb({ category: "auth", message: "User logged in", level: "info" });

      const msgId = await client.captureMessage("Rate limit exceeded for client", "warning", {
        roomId: "room_general",
        userId: "usr_guest_45",
      });

      expect(msgId).toBeDefined();
      const recent = client.getRecentEvents();
      expect(recent[0].level).toBe("warning");
      expect(recent[0].message).toBe("Rate limit exceeded for client");
    });

    it("creates child loggers with explicit room and user context", () => {
      const logger = new Logger({ service: "test-service" });
      const contextualLogger = logger.withRoomAndUser("room_alpha", "usr_beta", { action: "sync_state" });

      expect(contextualLogger).toBeInstanceOf(Logger);
    });
  });

  // =========================================================================
  // 2. INVITE-ONLY REGISTRATION & EMERGENCY KILL SWITCH
  // =========================================================================
  describe("Invite-Only Registration & Kill Switch", () => {
    it("rejects signups when invite-only mode is active and no invite code is provided", async () => {
      expect(adminService.getRegistrationMode()).toBe("invite_only");

      await expect(
        authService.signup({
          email: "stranger@example.com",
          password: "SuperPassword123!",
          displayName: "Stranger",
        })
      ).rejects.toThrow("Registration is currently invite-only");
    });

    it("allows signups with a valid master invite code in invite-only mode", async () => {
      const session = await authService.signup({
        email: "friend@example.com",
        password: "SuperPassword123!",
        displayName: "Best Friend",
        inviteCode: "FRIENDS2026",
      });

      expect(session.user).toBeDefined();
      expect(session.user.email).toBe("friend@example.com");
    });

    it("allows dynamic single-use and multi-use invite creation and enforces usage limits", async () => {
      const invite = adminService.createInvite({
        customCode: "VIP-PASS",
        maxUses: 2,
        note: "VIP Pass for test friends",
      });

      expect(invite.code).toBe("VIP-PASS");
      expect(invite.maxUses).toBe(2);

      // 1st signup -> Success
      const s1 = await authService.signup({
        email: "vip1@example.com",
        password: "SuperPassword123!",
        displayName: "VIP One",
        inviteCode: "VIP-PASS",
      });
      expect(s1.user.email).toBe("vip1@example.com");

      // 2nd signup -> Success
      const s2 = await authService.signup({
        email: "vip2@example.com",
        password: "SuperPassword123!",
        displayName: "VIP Two",
        inviteCode: "VIP-PASS",
      });
      expect(s2.user.email).toBe("vip2@example.com");

      // 3rd signup -> Reached usage limit
      await expect(
        authService.signup({
          email: "vip3@example.com",
          password: "SuperPassword123!",
          displayName: "VIP Three",
          inviteCode: "VIP-PASS",
        })
      ).rejects.toThrow("maximum usage limit");
    });

    it("rejects expired invite codes", async () => {
      const invite = adminService.createInvite({
        customCode: "EXPIRED-CODE",
        expiresInDays: -1, // in the past
      });

      await expect(
        authService.signup({
          email: "late@example.com",
          password: "SuperPassword123!",
          displayName: "Late Friend",
          inviteCode: "EXPIRED-CODE",
        })
      ).rejects.toThrow("invite code has expired");
    });

    it("enforces emergency kill switch to block all registrations immediately", async () => {
      adminService.setRegistrationMode("disabled");

      await expect(
        authService.signup({
          email: "panic@example.com",
          password: "SuperPassword123!",
          displayName: "Panic User",
          inviteCode: "FRIENDS2026",
        })
      ).rejects.toThrow("Registration is temporarily disabled by an administrator");
    });

    it("allows open registrations when set to public mode", async () => {
      adminService.setRegistrationMode("public");

      const session = await authService.signup({
        email: "public@example.com",
        password: "SuperPassword123!",
        displayName: "Public User",
      });

      expect(session.user.email).toBe("public@example.com");
    });
  });

  // =========================================================================
  // 3. USER MANAGEMENT & MODERATION (BAN, REVOKE, RESEND VERIFICATION)
  // =========================================================================
  describe("Admin User Controls & Moderation", () => {
    it("bans user, immediately blocks login, and revokes tokens", async () => {
      adminService.setRegistrationMode("public");
      const session = await authService.signup({
        email: "troll@example.com",
        password: "SuperPassword123!",
        displayName: "Troll User",
      });
      const userId = session.user.id;

      // Ban user via AdminService
      const banResult = await adminService.banUser(userId, "Spamming offensive comments");
      expect(banResult.success).toBe(true);

      // Verify user is marked as banned
      const user = await authRepo.findUserById(userId);
      expect(user?.isBanned).toBe(true);
      expect(user?.bannedReason).toContain("Spamming");

      // Attempting to log in as banned user -> Rejected with 403
      await expect(
        authService.login({
          email: "troll@example.com",
          password: "SuperPassword123!",
        })
      ).rejects.toThrow("account has been suspended");

      // Attempting to use refresh token after ban -> Rejected because tokens were revoked
      await expect(
        authService.refresh(session.refreshToken)
      ).rejects.toThrow(/revoked|suspended/i);

      // Unban user
      const unbanResult = await adminService.unbanUser(userId);
      expect(unbanResult.success).toBe(true);

      // Can log in again
      const relogin = await authService.login({
        email: "troll@example.com",
        password: "SuperPassword123!",
      });
      expect(relogin.user.id).toBe(userId);
    });

    it("revokes all active sessions for a user", async () => {
      adminService.setRegistrationMode("public");
      const session = await authService.signup({
        email: "multi@example.com",
        password: "SuperPassword123!",
        displayName: "Multi Device User",
      });

      const revokeRes = await adminService.revokeUserSessions(session.user.id);
      expect(revokeRes.success).toBe(true);
      expect(revokeRes.revokedCount).toBeGreaterThan(0);

      // Refresh token is now revoked and rejected
      await expect(
        authService.refresh(session.refreshToken)
      ).rejects.toThrow(/revoked|invalid/i);
    });

    it("resends verification email for unverified user", async () => {
      adminService.setRegistrationMode("public");
      const sendSpy = vi.spyOn(mailer, "sendVerificationEmail");

      const session = await authService.signup({
        email: "unverified@example.com",
        password: "SuperPassword123!",
        displayName: "Unverified User",
      });

      sendSpy.mockClear();

      const resendRes = await adminService.resendVerificationEmail(session.user.id);
      expect(resendRes.success).toBe(true);
      expect(sendSpy).toHaveBeenCalledWith(
        "unverified@example.com",
        expect.any(String),
        expect.stringContaining("verify-email?token=")
      );
    });
  });

  // =========================================================================
  // 4. ACTIVE ROOMS & FORCE CLOSE
  // =========================================================================
  describe("Active Rooms & Content Moderation", () => {
    it("lists active rooms and allows administrator to force close a room", () => {
      const { room } = roomManager.createRoom({
        hostUserName: "HostAlex",
        roomName: "Alex's Movie Hangout",
        roomCode: "ALEX01",
      });

      const rooms = adminService.listActiveRooms();
      expect(rooms.length).toBe(1);
      expect(rooms[0].roomCode).toBe("ALEX01");

      const closeRes = adminService.forceCloseRoom(room.roomId, "Content policy violation");
      expect(closeRes.success).toBe(true);

      // Room is closed
      expect(roomManager.getActiveRoomCount()).toBe(0);
    });

    it("allows locking and unlocking rooms from admin tooling", () => {
      const { room } = roomManager.createRoom({
        hostUserName: "HostSam",
        roomName: "Sam's Room",
        roomCode: "SAM001",
      });

      const lockRes = adminService.toggleRoomLock(room.roomId, true);
      expect(lockRes.success).toBe(true);
      expect(room.isLocked).toBe(true);

      const unlockRes = adminService.toggleRoomLock(room.roomId, false);
      expect(unlockRes.success).toBe(true);
      expect(room.isLocked).toBe(false);
    });
  });

  // =========================================================================
  // 5. USAGE, COST ALERTS & THRESHOLD WARNINGS
  // =========================================================================
  describe("Usage & Cost Guardrails", () => {
    it("tracks email quotas and calculates warning and critical thresholds", () => {
      // Simulate 85 emails sent today
      for (let i = 0; i < 85; i++) {
        adminService.recordEmailSent();
      }

      const report = adminService.getUsageReport();
      expect(report.email.sentToday).toBe(85);
      expect(report.email.percentDailyUsed).toBe(85);
      expect(report.email.status).toBe("warning");

      expect(report.alerts.some((a) => a.type === "email" && a.level === "warning")).toBe(true);

      // Push over 95%
      for (let i = 0; i < 11; i++) {
        adminService.recordEmailSent();
      }

      const criticalReport = adminService.getUsageReport();
      expect(criticalReport.email.percentDailyUsed).toBe(96);
      expect(criticalReport.email.status).toBe("critical");
      expect(criticalReport.alerts.some((a) => a.type === "email" && a.level === "critical")).toBe(true);
    });

    it("records bandwidth usage", () => {
      adminService.recordBandwidth(1024 * 1024 * 10, 1024 * 1024 * 20); // 10MB in, 20MB out
      const report = adminService.getUsageReport();

      expect(report.bandwidth.totalMB).toBe(30);
    });
  });

  // =========================================================================
  // 6. ADMIN DASHBOARD PAGE HTML & HTTP ROUTES
  // =========================================================================
  describe("Admin Dashboard UI & API Endpoints", () => {
    it("renders valid modern dark-mode admin dashboard HTML with all required controls", () => {
      const html = getAdminDashboardHtml();
      expect(html).toContain("WatchParty Admin Suite");
      expect(html).toContain("Transactional Email");
      expect(html).toContain("Persistent Storage");
      expect(html).toContain("Kill Switch");
      expect(html).toContain("Invite Codes");
      expect(html).toContain("Moderation Reports");
    });

    it("protects /api/admin/* endpoints with ADMIN_SECRET verification", async () => {
      // Create mock request and response
      const mockReq: any = {
        url: "/api/admin/stats",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      };

      let statusCode = 0;
      let responseBody = "";
      const mockRes: any = {
        writeHead: (code: number) => {
          statusCode = code;
        },
        end: (body: string) => {
          responseBody = body;
        },
      };

      // 1. Unauthenticated -> 401
      const handled = await handleAdminRoutes(mockReq, mockRes, adminService);
      expect(handled).toBe(true);
      expect(statusCode).toBe(401);

      // 2. Authenticated with Authorization Bearer header -> 200
      mockReq.headers["authorization"] = `Bearer ${TEST_ADMIN_SECRET}`;
      await handleAdminRoutes(mockReq, mockRes, adminService);
      expect(statusCode).toBe(200);
      expect(responseBody).toContain("dailyLimit");
    });

    it("handles client error telemetry endpoint /api/observability/client-errors", async () => {
      const mockReq: any = new (require("events").EventEmitter)();
      mockReq.url = "/api/observability/client-errors";
      mockReq.method = "POST";
      mockReq.headers = { "user-agent": "Mozilla/5.0" };
      mockReq.socket = { remoteAddress: "127.0.0.1" };

      let statusCode = 0;
      let responseBody = "";
      const mockRes: any = {
        writeHead: (code: number) => {
          statusCode = code;
        },
        end: (body: string) => {
          responseBody = body;
        },
      };

      const routePromise = handleAdminRoutes(mockReq, mockRes, adminService);

      // Emit client error payload
      mockReq.emit("data", Buffer.from(JSON.stringify({
        message: "Uncaught TypeError: Cannot read properties of undefined",
        roomId: "room_test_1",
        userId: "usr_client_2",
      })));
      mockReq.emit("end");

      await routePromise;

      expect(statusCode).toBe(200);
      expect(responseBody).toContain('"received":true');
    });
  });
});
