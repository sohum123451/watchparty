import http from "node:http";
import postgres from "postgres";
import {
  MOVIE_CATALOGUE,
  FREE_FILMS,
  MovieSearchEngine,
  computeRoomRecommendations,
  WS_CLOSE_CODES,
} from "@watchparty/shared";
import { RoomManager } from "./rooms/RoomManager.js";
import { WebSocketGateway } from "./gateway/WebSocketGateway.js";
import {
  AuthService,
  MemoryAuthRepository,
  ConsoleMailer,
  handleAuthRoute,
} from "./auth/index.js";
import {
  FriendsService,
  MemoryFriendsRepository,
  MemoryNotificationRepository,
  PresenceService,
  handleFriendsRoute,
} from "./friends/index.js";
import { defaultSecurityMiddleware } from "./security/headers.js";
import { MemoryUserDataRepository } from "./userdata/UserDataRepository.js";
import { UserDataService } from "./userdata/UserDataService.js";
import { handleUserDataRoute } from "./userdata/userRoutes.js";
import { createRedisService, type IRedisService } from "./redis/RedisService.js";
import { RedisRoomAdapter } from "./redis/RedisRoomAdapter.js";
import { MetricsCollector } from "./metrics/MetricsCollector.js";
import { getGrafanaDashboardJson, getDashboardHtml } from "./metrics/DashboardPage.js";
import { Logger, requestLoggingMiddleware } from "./utils/logger.js";
import { getAppHtml } from "./ui/AppPage.js";
import { getDesignSystemHtml } from "./ui/DesignSystemPage.js";
import { getTokensCss } from "./ui/tokensCss.js";
import { getManifestJson, getServiceWorkerJs, getOfflineHtml, getAppIconSvg } from "./ui/pwa.js";
import { SourceResolver, SecurityError } from "./services/SourceResolver.js";
import { defaultUrlSafetyChecker } from "./services/UrlSafetyChecker.js";
import { DurableRoomStorage } from "./storage/DurableRoomStorage.js";
import { WebPushService } from "./push/WebPushService.js";
import { ScheduledPartyService } from "./parties/ScheduledPartyService.js";
import { handleDailyRoutes } from "./parties/dailyRoutes.js";
import { validateEnv } from "./config/env.js";
import { runMigrations } from "./db/migrate.js";
import { createMailer } from "./auth/mailer/Mailer.js";
import { getStatusHtml, StatusDetails } from "./ui/StatusPage.js";
import { AdminService } from "./admin/AdminService.js";
import { handleAdminRoutes } from "./admin/adminRoutes.js";
import { globalSentry } from "./observability/SentryClient.js";
import { getPrivacyPolicyHtml, getTermsOfServiceHtml } from "./ui/LegalPages.js";
import { LiveKitMediaProvider } from "./media/LiveKitMediaProvider.js";
import { MockMediaProvider } from "./media/MockMediaProvider.js";
import { MediaService } from "./media/MediaService.js";
import { handleMediaRoute } from "./media/mediaRoutes.js";

// 1. Strict Fail-Fast Environment Validation
const env = validateEnv();
const PORT = env.PORT;
const HOST = env.HOST;
const BASE_URL = env.BASE_URL;
const NODE_ID = env.NODE_ID;

// Observability: Metrics and Structured JSON Logger
const metricsCollector = new MetricsCollector();
const logger = new Logger({ service: "watchparty-server", nodeId: NODE_ID });

// PostgreSQL Database Connection & Fail-Fast Startup Verification
let dbSql: postgres.Sql | undefined;
if (env.DATABASE_URL) {
  try {
    dbSql = postgres(env.DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {},
    });
    // Verify database connectivity immediately on startup
    await dbSql`SELECT 1`;
    logger.info("[Startup] PostgreSQL connection verified successfully");
  } catch (err: any) {
    logger.error(`[Startup] FATAL: Failed to connect to database at ${env.DATABASE_URL.replace(/:[^:@]+@/, ":****@")}: ${err.message}`);
    console.error("\n=======================================================");
    console.error("FATAL: DATABASE CONNECTION FAILED ON STARTUP");
    console.error("=======================================================");
    console.error(`Database URL: ${env.DATABASE_URL.replace(/:[^:@]+@/, ":****@")}`);
    console.error(`Error: ${err.message}`);
    console.error("=======================================================\n");
    process.exit(1);
  }
} else if (env.NODE_ENV === "production") {
  logger.error("[Startup] FATAL: Missing required DATABASE_URL environment variable in production.");
  console.error("\n=======================================================");
  console.error("FATAL: MISSING DATABASE_URL IN PRODUCTION ENVIRONMENT");
  console.error("=======================================================\n");
  process.exit(1);
}

let redis: IRedisService | undefined;
let redisAdapter: RedisRoomAdapter | undefined;
let gateway: WebSocketGateway;
let isDraining = false;

// Core Domain Managers & Zero-Ops Durable Storage
const durableRoomStorage = new DurableRoomStorage();
const roomManager = new RoomManager(BASE_URL);
roomManager.setRoomStorage(durableRoomStorage);
const movieSearchEngine = new MovieSearchEngine(MOVIE_CATALOGUE);
const authRepo = new MemoryAuthRepository();
const mailer = createMailer({
  provider: env.MAILER_PROVIDER,
  resendApiKey: env.RESEND_API_KEY,
  postmarkToken: env.POSTMARK_SERVER_TOKEN,
  from: env.MAIL_FROM,
  smtpHost: env.SMTP_HOST,
  smtpPort: env.SMTP_PORT,
  smtpUser: env.SMTP_USER,
  smtpPass: env.SMTP_PASS,
});

// Observability & Sentry Error Tracking Initialization
if (env.SENTRY_DSN) {
  globalSentry.setDsn(env.SENTRY_DSN);
}
globalSentry.installGlobalHandlers();

// Admin Service & Moderation Suite
const adminService = new AdminService({
  authRepo,
  roomManager,
  mailer,
  adminSecret: env.ADMIN_SECRET,
  initialRegistrationMode: env.REGISTRATION_MODE,
  masterInviteCode: env.REGISTRATION_INVITE_CODE,
  uptimeAlertWebhookUrl: env.UPTIME_ALERT_WEBHOOK_URL,
  usageAlertEmail: env.USAGE_ALERT_EMAIL,
  mailerProvider: env.MAILER_PROVIDER,
  dataDir: env.DATA_DIR,
});

const authService = new AuthService({
  repo: authRepo,
  mailer,
  baseUrl: BASE_URL,
  adminService,
});
authService.setAdminService(adminService);

const friendsRepo = new MemoryFriendsRepository();
const notificationRepo = new MemoryNotificationRepository();
const presenceService = new PresenceService(friendsRepo, authRepo);
const friendsService = new FriendsService({
  friendsRepo,
  notificationRepo,
  authRepo,
  presenceService,
  rateLimiter: authService.getRateLimiter(),
});

const userDataRepo = new MemoryUserDataRepository();
const userDataService = new UserDataService(
  userDataRepo,
  roomManager,
  authRepo,
  friendsRepo,
  notificationRepo
);

const webPushService = new WebPushService();
const scheduledPartyService = new ScheduledPartyService({
  roomManager,
  pushService: webPushService,
  baseUrl: BASE_URL,
});
scheduledPartyService.startSchedulerLoop(15000);
friendsService.setPushService(webPushService);

const sourceResolver = new SourceResolver();

const mediaProvider =
  env.MEDIA_PROVIDER === "mock"
    ? new MockMediaProvider()
    : new LiveKitMediaProvider({
        serverUrl: env.LIVEKIT_URL,
        apiKey: env.LIVEKIT_API_KEY,
        apiSecret: env.LIVEKIT_API_SECRET,
        coturnUrl: env.COTURN_URL,
        coturnSecret: env.COTURN_SECRET,
        coturnUsername: env.COTURN_USERNAME,
        coturnCredential: env.COTURN_CREDENTIAL,
      });
const mediaService = new MediaService({ provider: mediaProvider, roomManager });

// Production HTTP server with strict transport security, CSRF protection, and structured logging
const server = http.createServer(async (req, res) => {
  // 1. Structured JSON Request Logging
  requestLoggingMiddleware(req, res);

  // 2. Security Headers & CORS
  const handled = defaultSecurityMiddleware.handleRequest(req, res);
  if (handled) {
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // 3. Health & Readiness Observability Probes
  if ((url.pathname === "/health" || url.pathname === "/healthz") && (req.method === "GET" || req.method === "HEAD")) {
    metricsCollector.setActiveRooms(roomManager.getActiveRoomCount());

    let dbHealthy = true;
    let dbStatus = "not_configured";
    let dbError: string | undefined;

    if (dbSql) {
      try {
        await dbSql`SELECT 1`;
        dbStatus = "connected";
      } catch (err: any) {
        dbHealthy = false;
        dbStatus = "disconnected";
        dbError = err?.message || "Database connection error";
      }
    }

    const statusCode = dbHealthy ? 200 : 503;
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const proto = req.headers["x-forwarded-proto"] === "https" ? "wss" : (req.headers["x-forwarded-proto"] === "http" ? "ws" : undefined);
    const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
    const computedWsUrl = proto && host ? `${proto}://${host}` : undefined;
    const publicWs = env.PUBLIC_WS_URL || computedWsUrl || (BASE_URL ? BASE_URL.replace(/^http/, "ws") : `ws://localhost:${PORT}`);

    res.end(
      JSON.stringify({
        status: dbHealthy ? "healthy" : "unhealthy",
        nodeId: NODE_ID,
        uptimeSeconds: Math.floor(process.uptime()),
        database: {
          status: dbStatus,
          type: env.DATABASE_URL ? "postgresql" : "in_memory",
          ...(dbError ? { error: dbError } : {}),
        },
        activeRooms: roomManager.getActiveRoomCount(),
        connectedSockets: metricsCollector.getSummaryJson().connectedSockets,
        wsEndpoint: publicWs,
        protocol: req.headers["x-forwarded-proto"] || "http",
        host: host || "localhost",
        clientIp: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress,
        timestamp: Date.now(),
      })
    );
    return;
  }

  if (url.pathname === "/ready" && req.method === "GET") {
    if (isDraining) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "draining",
          ready: false,
          nodeId: NODE_ID,
          message: "Server is draining connections for shutdown",
        })
      );
      return;
    }

    // If Redis is explicitly configured, verify its connection health
    if (process.env.REDIS_URL && redis && !redis.isReady()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "unready",
          ready: false,
          nodeId: NODE_ID,
          error: "Configured Redis storage is not connected",
        })
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ready",
        ready: true,
        nodeId: NODE_ID,
        activeRooms: roomManager.getActiveRoomCount(),
        uptimeSeconds: Math.floor(process.uptime()),
      })
    );
    return;
  }

  // 4. Prometheus Metrics Plain-text Endpoint
  if (url.pathname === "/metrics" && req.method === "GET") {
    metricsCollector.setActiveRooms(roomManager.getActiveRoomCount());
    const text = metricsCollector.toPrometheusFormat();
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    res.end(text);
    return;
  }

  // 5. JSON Metrics Summary Endpoint
  if (url.pathname === "/api/metrics/summary" && req.method === "GET") {
    metricsCollector.setActiveRooms(roomManager.getActiveRoomCount());
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(metricsCollector.getSummaryJson(), null, 2));
    return;
  }

  // 6. Grafana-Compatible Dashboard JSON Export
  if (url.pathname === "/api/metrics/dashboard.json" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getGrafanaDashboardJson(), null, 2));
    return;
  }

  // 7. Interactive Modern Dark-Mode Glassmorphism Dashboard UI
  if (url.pathname === "/dashboard" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getDashboardHtml());
    return;
  }

  // 8. Public System Status Page & Health Probes (/status)
  if (url.pathname === "/status" && req.method === "GET") {
    const details: StatusDetails = {
      status: isDraining ? "draining" : "operational",
      nodeId: NODE_ID,
      uptimeSeconds: Math.floor(process.uptime()),
      activeRooms: roomManager.getActiveRoomCount(),
      connectedSockets: metricsCollector.getSummaryJson().connectedSockets,
      database: {
        status: env.DATABASE_URL ? "connected" : "in_memory",
        type: env.DATABASE_URL ? "postgresql" : "in_memory",
      },
      redis: {
        status: redis && redis.isReady() ? "connected" : "in_memory",
        type: redis ? "standalone_or_cluster" : "in_memory",
      },
      mailer: {
        provider: env.MAILER_PROVIDER,
      },
      registrationMode: adminService.getRegistrationMode(),
      sentry: {
        enabled: globalSentry.isEnabled(),
      },
      version: "1.0.0",
      timestamp: Date.now(),
    };

    const acceptsHtml = req.headers.accept?.includes("text/html");
    if (acceptsHtml) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getStatusHtml(details));
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(details, null, 2));
    }
    return;
  }

  // 8b. Plain-Language Privacy Policy & Terms of Service Pages
  if (url.pathname === "/privacy" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getPrivacyPolicyHtml());
    return;
  }
  if (url.pathname === "/terms" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getTermsOfServiceHtml());
    return;
  }

  // 8. Authentication Routes (/api/auth/*)
  const isAuth = await handleAuthRoute(req, res, authService);
  if (isAuth) {
    return;
  }

  // 9. Admin Suite, Dashboard UI & Error Telemetry (/admin, /api/admin/*, /api/observability/*)
  const isAdmin = await handleAdminRoutes(req, res, adminService, logger);
  if (isAdmin) {
    return;
  }

  // 9. Friends and Notifications Routes (/api/friends/*, /api/notifications/*)
  const isFriends = await handleFriendsRoute(req, res, friendsService);
  if (isFriends) {
    return;
  }

  // 10. User Data, Profile, Settings, and Storage Routes (/api/user/*, /api/storage/*)
  const isUserData = await handleUserDataRoute(req, res, userDataService, authService);
  if (isUserData) {
    return;
  }

  // 10b. Daily Delight Routes: Push, Scheduled Parties, Home Rooms, Friends Activity Feed
  const isDaily = await handleDailyRoutes(req, res, {
    pushService: webPushService,
    scheduledPartyService,
    friendsService,
    roomManager,
    authRepo,
    baseUrl: BASE_URL,
  });
  if (isDaily) {
    return;
  }

  // 10c. Voice & Video SFU Media Routes (/api/media/token, /api/media/ice-servers)
  const isMedia = await handleMediaRoute(req, res, mediaService, roomManager);
  if (isMedia) {
    return;
  }

  // 11. Room Discovery & Recommendations
  if (url.pathname.startsWith("/api/rooms/") && req.method === "GET") {
    const subpath = url.pathname.replace("/api/rooms/", "").trim();

    if (subpath.includes("/recommendations")) {
      const code = subpath.replace("/recommendations", "").trim();
      const room = roomManager.getRoomByCode(code);
      if (!room) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Room not found" }));
        return;
      }

      const recommendations = computeRoomRecommendations({
        catalogue: MOVIE_CATALOGUE,
        playlist: room.playlist,
        activePoll: room.activePoll,
        currentPlayingVideoId: room.playback.videoId,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ recommendations }));
      return;
    }

    const code = subpath;
    const room = roomManager.getRoomByCode(code);
    if (!room) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ exists: false, error: "Room not found" }));
      return;
    }
    const host = room.getMember(room.hostId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        exists: true,
        roomId: room.roomId,
        roomCode: room.roomCode,
        roomName: room.roomName,
        controlMode: room.controlMode,
        memberCount: room.getMemberCount(),
        hostUserName: host?.userName || "Host",
        mediaTitle: room.playback?.title || "",
      })
    );
    return;
  }

  // 11b. Public Rooms List for Lobby
  if (url.pathname === "/api/rooms" && req.method === "GET") {
    const rooms = roomManager
      .getAllRooms()
      .filter((r) => r.roomType !== "invite-only" && !r.isHomeRoom)
      .map((r) => {
        const host = r.getMember(r.hostId);
        return {
          roomId: r.roomId,
          roomCode: r.roomCode,
          roomName: r.roomName,
          hostUserName: host?.userName || "Host",
          memberCount: r.getMemberCount(),
          mediaTitle: r.playback?.title || "Screening",
          controlMode: r.controlMode,
        };
      });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ rooms }));
    return;
  }

  // Room Creation API
  if (url.pathname === "/api/rooms" && req.method === "POST") {
    try {
      const rawBody = await new Promise<string>((resolve) => {
        let b = "";
        req.on("data", (chunk) => {
          b += chunk.toString();
        });
        req.on("end", () => {
          resolve(b);
        });
      });
      const body = rawBody ? JSON.parse(rawBody) : {};
      const roomName = body.roomName || "WatchParty Room";
      const hostUserName = body.hostUserName || "Host";
      const initialVideoId = body.initialVideoId || "big_buck_bunny";
      const customCode = body.roomCode ? body.roomCode.trim().toUpperCase() : undefined;
      const { room, hostUserId, hostSessionToken } = roomManager.createRoom({
        hostUserName,
        roomName,
        initialVideoId,
        controlMode: body.controlMode || "public",
        roomCode: customCode,
      });

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          room: {
            roomId: room.roomId,
            roomCode: room.roomCode,
            roomName: room.roomName,
            controlMode: room.controlMode,
          },
          hostUserId,
          hostSessionToken,
        })
      );
    } catch (err: any) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err?.message || "Failed to create room" }));
    }
    return;
  }


  // Catalogue endpoint (free films for lobby and source picker)
  if (url.pathname === "/api/catalogue" && req.method === "GET") {
    const isFreeOnly = url.searchParams.get("free") !== "false";
    let films: any[] = [];

    if (dbSql) {
      try {
        const rows = await dbSql`
          SELECT * FROM films
          ${isFreeOnly ? dbSql`WHERE is_free = true` : dbSql``}
          ORDER BY year DESC, title ASC
        `;
        if (rows && rows.length > 0) {
          films = rows.map((r: any) => ({
            id: r.id,
            title: r.title,
            year: r.year,
            runtime: r.runtime,
            genres: Array.isArray(r.genres) ? r.genres : JSON.parse(r.genres || "[]"),
            genre: r.genre || (Array.isArray(r.genres) ? r.genres[0] : "Classic"),
            description: r.description,
            isFree: Boolean(r.is_free),
            license: r.license,
            attribution: r.attribution,
            poster: r.poster_url,
            posterUrl: r.poster_url,
            thumbnail: r.poster_url,
            thumbnailUrl: r.poster_url,
            playableUrl: r.video_url,
            videoUrl: r.video_url,
            provider: "html5",
            accentColor: r.accent_color,
            textColor: r.text_color,
          }));
        }
      } catch (err: any) {
        logger.warn(`[Catalogue] Database query failed, using static catalogue: ${err?.message}`);
      }
    }

    if (films.length === 0) {
      films = FREE_FILMS.map((m) => ({
        id: m.id,
        title: m.title,
        year: m.year,
        runtime: m.runtime,
        genres: m.genres || [m.genre || "Classic"],
        genre: m.genre || (m.genres ? m.genres[0] : "Classic"),
        description: m.description,
        isFree: true,
        license: m.license || "Public Domain",
        attribution: m.attribution || "Public Domain Archive",
        poster: m.posterUrl,
        posterUrl: m.posterUrl,
        thumbnail: m.thumbnailUrl || m.posterUrl,
        thumbnailUrl: m.thumbnailUrl || m.posterUrl,
        playableUrl: m.videoUrl,
        videoUrl: m.videoUrl,
        provider: m.provider || "html5",
        accentColor: m.accentColor,
        textColor: m.textColor,
      }));
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ films }));
    return;
  }


  // 12. Movie Discovery API
  if (url.pathname === "/api/movies" && req.method === "GET") {
    const q = url.searchParams.get("q") || "";
    const category = url.searchParams.get("category") as any;
    const isFree = url.searchParams.get("isFree") === "true" || category === "free_to_watch";
    const genres = url.searchParams.getAll("genres");
    const minRating = url.searchParams.get("minRating")
      ? Number(url.searchParams.get("minRating"))
      : undefined;
    const sort = (url.searchParams.get("sort") as any) || "relevance";

    const results = movieSearchEngine.search(q, { category, genres, minRating, isFree: isFree ? true : undefined }, sort);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ count: results.length, results }));
    return;
  }

  if (url.pathname.startsWith("/api/movies/") && req.method === "GET") {
    const id = url.pathname.replace("/api/movies/", "").trim();
    const movie = MOVIE_CATALOGUE.find((m) => m.id === id);
    if (!movie) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Movie not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ movie }));
    return;
  }

  // 13. Source Resolver Service API (/api/resolve)
  if (url.pathname === "/api/resolve" && (req.method === "POST" || req.method === "GET")) {
    const clientIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "anonymous";
    if (!sourceResolver.checkRateLimit(clientIp)) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Rate limit exceeded. Please wait before resolving more URLs.",
        })
      );
      return;
    }

    let targetUrl = "";
    if (req.method === "GET") {
      targetUrl = url.searchParams.get("url") || "";
    } else {
      try {
        const body: any = await new Promise((resolve) => {
          let b = "";
          req.on("data", (chunk) => {
            b += chunk.toString();
          });
          req.on("end", () => {
            try {
              resolve(b ? JSON.parse(b) : {});
            } catch {
              resolve({});
            }
          });
        });
        targetUrl = body.url || "";
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON request body" }));
        return;
      }
    }

    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "URL parameter is required" }));
      return;
    }

    try {
      const descriptor = await sourceResolver.resolve(targetUrl);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, descriptor }));
    } catch (err: any) {
      const isSecurity = err instanceof SecurityError;
      res.writeHead(isSecurity ? 403 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message, securityBlocked: isSecurity }));
    }
    return;
  }

  // 13b. URL Safety & Malicious Link Check API (/api/sources/safety-check)
  if (url.pathname === "/api/sources/safety-check" && (req.method === "POST" || req.method === "GET")) {
    let targetUrl = "";
    if (req.method === "GET") {
      targetUrl = url.searchParams.get("url") || "";
    } else {
      try {
        const body: any = await new Promise((resolve) => {
          let b = "";
          req.on("data", (chunk) => {
            b += chunk.toString();
          });
          req.on("end", () => {
            try {
              resolve(b ? JSON.parse(b) : {});
            } catch {
              resolve({});
            }
          });
        });
        targetUrl = body.url || "";
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON request body" }));
        return;
      }
    }

    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "URL parameter is required" }));
      return;
    }

    const report = await defaultUrlSafetyChecker.checkUrl(targetUrl);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, report }));
    return;
  }

  // 14. Podcast RSS Feed Proxy API (/api/podcast/feed)
  if (url.pathname === "/api/podcast/feed" && req.method === "GET") {
    const feedUrl = url.searchParams.get("url") || "";
    if (!feedUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "URL parameter is required" }));
      return;
    }

    try {
      const response = await sourceResolver.fetchSafe(feedUrl, {
        method: "GET",
        accept: "application/rss+xml,application/xml,text/xml,*/*",
      });
      res.writeHead(200, {
        "Content-Type": "application/xml; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(response.bodyText);
    } catch (err: any) {
      const isSecurity = err instanceof SecurityError;
      res.writeHead(isSecurity ? 403 : 502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message, securityBlocked: isSecurity }));
    }
    return;
  }

  // 14b. PWA Manifest, Service Worker, and App Icons
  if (url.pathname === "/manifest.json" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(getManifestJson());
    return;
  }

  if (url.pathname === "/sw.js" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": "/",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    res.end(getServiceWorkerJs());
    return;
  }

  if (url.pathname === "/offline.html" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getOfflineHtml());
    return;
  }

  if (
    (url.pathname === "/icon-192.svg" || url.pathname === "/icon-512.svg" || url.pathname === "/icon.svg") &&
    req.method === "GET"
  ) {
    res.writeHead(200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=604800, immutable",
    });
    res.end(getAppIconSvg());
    return;
  }

  // 14c. Design System Atelier & Tokens Routes
  if (url.pathname === "/design" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getDesignSystemHtml());
    return;
  }

  if (url.pathname === "/tokens.css" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(getTokensCss());
    return;
  }

  // 15. Web Application SPA Route
  if ((url.pathname === "/" || url.pathname === "/app" || url.pathname.startsWith("/join/")) && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    const proto = req.headers["x-forwarded-proto"] === "https" ? "wss" : (req.headers["x-forwarded-proto"] === "http" ? "ws" : undefined);
    const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
    const computedWsUrl = proto && host ? `${proto}://${host}` : undefined;
    const publicWs = env.PUBLIC_WS_URL || computedWsUrl || (BASE_URL ? BASE_URL.replace(/^http/, "ws") : "");
    res.end(getAppHtml({ wsUrl: publicWs, baseUrl: BASE_URL }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

// Startup initialization: database migrations, durable room persistence, optional cluster adapter, and HTTP/WS listen
async function bootstrap() {
  // 1. Run Automated Database Migrations on Deploy
  if (env.DATABASE_URL) {
    try {
      await runMigrations(env.DATABASE_URL);
    } catch (err: any) {
      logger.error("[WatchParty] Database migration failed on startup", { error: err.message });
      if (env.NODE_ENV === "production") {
        throw err;
      }
    }
  }

  // 2. Optional Redis Cluster Adapter (only active if REDIS_URL is configured)
  if (env.REDIS_URL && env.REDIS_URL !== "none") {
    try {
      redis = await createRedisService(env.REDIS_URL);
      if (redis.isReady()) {
        redisAdapter = new RedisRoomAdapter(redis, NODE_ID);
        roomManager.setRedisAdapter(redisAdapter);
        await redisAdapter.init();
        logger.info("[WatchParty] Redis cluster adapter initialized successfully");
      }
    } catch (err: any) {
      logger.warn("[WatchParty] Redis connection failed, running with local in-process event bus and durable storage", {
        error: err.message,
      });
    }
  } else {
    logger.info("[WatchParty] Operating in zero-dependency low-ops mode (durable storage, no Redis needed)");
  }

  // 2. Attach WebSocket Gateway with metrics & cluster routing
  gateway = new WebSocketGateway(server, roomManager, {
    authService,
    friendsService,
    metricsCollector,
    redisAdapter,
    logger,
  });
  adminService.setGateway(gateway);

  // 3. Restore all active rooms from durable storage and/or Redis
  const restoredDurable = await durableRoomStorage.restoreRooms(roomManager);
  let restoredRedis = 0;
  if (redisAdapter) {
    restoredRedis = await redisAdapter.restoreRooms(roomManager);
  }
  const restored = Math.max(restoredDurable, restoredRedis);
  if (restored > 0) {
    logger.info(`Restored ${restored} active rooms from durable snapshots`);
  }

  server.listen(PORT, HOST, () => {
    logger.info(`[WatchParty Server] Running on ${BASE_URL} (Bound to ${HOST}:${PORT})`, {
      nodeId: NODE_ID,
      port: PORT,
      host: HOST,
      restoredRooms: restored,
    });
  });
}

bootstrap().catch((err) => {
  logger.error("Failed to bootstrap server", { error: String(err) });
  process.exit(1);
});

// Graceful termination handling: zero state loss on server restart or redeploy
const shutdown = async (signal: string) => {
  if (isDraining) return;
  isDraining = true;
  scheduledPartyService.stopSchedulerLoop();
  logger.info(`Received ${signal}. Gracefully draining connections and persisting state...`);

  // 1. Drain WebSocket connections notifying clients with SERVICE_RESTART (1012)
  if (gateway) {
    try {
      await gateway.drainAndClose(WS_CLOSE_CODES.SERVICE_RESTART, "Server is restarting, please reconnect");
    } catch (err) {
      logger.error("Error draining WebSocket connections", { error: String(err) });
    }
  }

  // 2. Persist snapshots for all active rooms to durable storage
  const rooms = roomManager.getAllRooms();
  for (const r of rooms) {
    try {
      await durableRoomStorage.saveRoom(r);
    } catch (err) {
      logger.error("Error saving room snapshot to durable storage during shutdown", { roomId: r.roomId, error: String(err) });
    }
  }
  await durableRoomStorage.flush();

  // 3. Persist to Redis if cluster adapter is present
  if (redisAdapter) {
    for (const r of rooms) {
      try {
        await redisAdapter.saveRoomSnapshot(r);
      } catch (err) {
        logger.error("Error saving room snapshot to Redis during shutdown", { roomId: r.roomId, error: String(err) });
      }
    }

    // Release distributed ownership locks and disconnect Redis
    await redisAdapter.disconnect();
  }

  if (redis) {
    await redis.disconnect();
  }

  // 4. Close HTTP server
  server.close(() => {
    roomManager.cleanupAll();
    logger.info("WatchParty server shutdown complete.");
    process.exit(0);
  });

  // Force exit timeout after 10s if sockets or handles hang
  setTimeout(() => {
    logger.warn("Forcing shutdown after 10s drain timeout");
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
