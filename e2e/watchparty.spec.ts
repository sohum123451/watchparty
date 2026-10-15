import { test, expect, Browser, BrowserContext, Page } from "@playwright/test";
import http from "node:http";
import { WebSocket } from "ws";
import { RoomManager } from "../packages/server/dist/rooms/RoomManager.js";
import { WebSocketGateway } from "../packages/server/dist/gateway/WebSocketGateway.js";
import { MemoryRedisService } from "../packages/server/dist/redis/RedisService.js";
import { RedisRoomAdapter } from "../packages/server/dist/redis/RedisRoomAdapter.js";
import {
  AuthService,
  MemoryAuthRepository,
  ConsoleMailer,
  handleAuthRoute,
} from "../packages/server/dist/auth/index.js";
import {
  FriendsService,
  MemoryFriendsRepository,
  MemoryNotificationRepository,
  PresenceService,
  handleFriendsRoute,
} from "../packages/server/dist/friends/index.js";
import { getAppHtml } from "../packages/server/dist/ui/AppPage.js";
import { defaultSecurityMiddleware } from "../packages/server/dist/security/headers.js";
import { WS_CLOSE_CODES } from "@watchparty/shared";

let server: http.Server;
let port: number;
let baseUrl: string;
let roomManager: RoomManager;
let gateway: WebSocketGateway;
let redis: MemoryRedisService;
let redisAdapter: RedisRoomAdapter;
let authRepo: MemoryAuthRepository;
let authService: AuthService;
let friendsRepo: MemoryFriendsRepository;
let notificationRepo: MemoryNotificationRepository;
let presenceService: PresenceService;
let friendsService: FriendsService;

test.beforeAll(async () => {
  // 1. Initialize In-Memory Infrastructure
  redis = new MemoryRedisService();
  redisAdapter = new RedisRoomAdapter(redis, "e2e_node_1");
  await redisAdapter.init();

  roomManager = new RoomManager();
  roomManager.setRedisAdapter(redisAdapter);

  authRepo = new MemoryAuthRepository();
  const mailer = new ConsoleMailer();
  authService = new AuthService({
    repo: authRepo,
    mailer,
    baseUrl: "http://localhost:3000",
  });

  friendsRepo = new MemoryFriendsRepository();
  notificationRepo = new MemoryNotificationRepository();
  presenceService = new PresenceService(friendsRepo, authRepo);
  friendsService = new FriendsService({
    friendsRepo,
    notificationRepo,
    authRepo,
    presenceService,
    rateLimiter: authService.getRateLimiter(),
  });

  // 2. Spin up HTTP Server on dynamic port
  server = http.createServer(async (req, res) => {
    if (defaultSecurityMiddleware.handleRequest(req, res)) return;

    const isAuth = await handleAuthRoute(req, res, authService);
    if (isAuth) return;

    const isFriends = await handleFriendsRoute(req, res, friendsService);
    if (isFriends) return;

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/" || url.pathname === "/app" || url.pathname.startsWith("/join/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getAppHtml());
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  gateway = new WebSocketGateway(server, roomManager, {
    authService,
    friendsService,
    redisAdapter,
    enforceVerifiedToCreateRoom: true, // Enforce email verification for room creation
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        port = addr.port;
        baseUrl = `http://localhost:${port}`;
        roomManager.setBaseUrl(baseUrl);
      }
      resolve();
    });
  });
});

test.afterAll(async () => {
  if (gateway) gateway.close();
  if (redisAdapter) await redisAdapter.disconnect();
  if (redis) await redis.disconnect();
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// Helper: Signs up, verifies email in repo, and logs in user in the browser UI
async function signupAndLogin(
  page: Page,
  displayName: string,
  email: string,
  password = "Password123!"
): Promise<void> {
  await page.click("#btnShowAuth");
  await page.click("#btnTabSignup");
  await page.fill("#signupDisplayName", displayName);
  await page.fill("#signupEmail", email);
  await page.fill("#signupPassword", password);
  await page.click("#btnSubmitSignup");

  // Wait for verification alert indicating registration response received
  await expect(page.locator("#verificationAlert")).toBeVisible();

  // Verify email directly in repo
  const user = await authRepo.findUserByEmail(email.toLowerCase().trim());
  expect(user).toBeDefined();
  await authRepo.updateUser(user!.id, { emailVerifiedAt: new Date() });

  // Switch to login tab and log in
  await page.click("#btnTabLogin");
  await page.fill("#loginEmail", email);
  await page.fill("#loginPassword", password);
  await page.click("#btnSubmitLogin");

  // Confirm user pill is active
  await expect(page.locator("#userPill")).toBeVisible();
  await expect(page.locator("#currentUserDisplayName")).toHaveText(displayName);
  // Allow authenticated WebSocket to establish
  await page.waitForTimeout(200);
}

// ==============================================================================
// TEST 1: Full Social Co-Watching Flow with Multiple Browser Contexts
// Signup -> Verify Email -> Login -> Create Room -> Friend Invite -> Sync Play/Seek
// ==============================================================================
test("Flow 1: Signup -> verify email -> login -> create room -> friend invites friend -> friend joins -> sync play/seek verified on both", async ({
  browser,
}) => {
  // 1. Host Context (Alice)
  const contextAlice = await browser.newContext();
  const pageAlice = await contextAlice.newPage();

  await pageAlice.goto(baseUrl);
  await expect(pageAlice.locator(".logo")).toContainText("WatchParty");

  // Alice Signs Up, Verifies Email, and Logs In
  await signupAndLogin(pageAlice, "Alice", "alice@test.com");

  // Alice Creates Room
  await pageAlice.click("#btnShowCreateRoom");
  await pageAlice.fill("#createRoomName", "Alice Theater");
  await pageAlice.selectOption("#createRoomType", "public");
  await pageAlice.click("#btnSubmitCreateRoom");

  // Verify Room is created on Alice's page
  await expect(pageAlice.locator("#roomCodeBadge")).toBeVisible();
  const roomCode = (await pageAlice.locator("#roomCodeVal").innerText()).trim();
  expect(roomCode.length).toBe(6);
  await expect(pageAlice.locator("#roleBadge")).toHaveText("HOST");
  await expect(pageAlice.locator("#connectionStatus")).toContainText("CONNECTED");

  // 2. Friend Context (Bob)
  const contextBob = await browser.newContext();
  const pageBob = await contextBob.newPage();

  await pageBob.goto(baseUrl);

  // Bob Signs Up, Verifies Email, and Logs In
  await signupAndLogin(pageBob, "Bob", "bob@test.com");

  // Friend Relationship: Bob adds Alice via Alice's friend code
  const aliceUser = await authRepo.findUserByEmail("alice@test.com");
  const bobUser = await authRepo.findUserByEmail("bob@test.com");
  const fullAlice = await authRepo.findUserById(aliceUser!.id);
  expect(fullAlice?.friendCode).toBeDefined();

  await friendsService.sendFriendRequest({
    fromUserId: bobUser!.id,
    friendCode: fullAlice!.friendCode!,
  });

  // Alice accepts friend request
  const friendships = await friendsRepo.getUserFriendships(aliceUser!.id);
  const incomingReq = friendships.find((f) => f.status === "pending");
  expect(incomingReq).toBeDefined();
  await friendsService.acceptFriendRequest(aliceUser!.id, incomingReq!.id);

  // Bob Joins Alice's Room via Room Code
  await pageBob.click("#btnShowJoinRoom");
  await pageBob.fill("#joinRoomCode", roomCode);
  await pageBob.click("#btnSubmitJoinRoom");

  // Verify Bob is in room as MEMBER
  await expect(pageBob.locator("#roomCodeBadge")).toBeVisible();
  await expect(pageBob.locator("#roomCodeVal")).toHaveText(roomCode);
  await expect(pageBob.locator("#roleBadge")).toHaveText("MEMBER");

  // 3. Synchronized Video Playback: Play & Seek Verification
  // Alice (Host) clicks Play
  await pageAlice.click("#btnPlayPause");

  // Verify BOTH Alice and Bob reflect PLAYING status
  await expect(pageAlice.locator("#playbackStatus")).toHaveText("PLAYING");
  await expect(pageBob.locator("#playbackStatus")).toHaveText("PLAYING");

  // Alice Seeks to 30s Mark
  await pageAlice.click("#btnSeek30");

  // Verify BOTH Alice and Bob time displays reach 00:30
  await expect(pageAlice.locator("#currentTime")).toHaveText("00:30");
  await expect(pageBob.locator("#currentTime")).toHaveText("00:30");

  await contextAlice.close();
  await contextBob.close();
});

// ==============================================================================
// TEST 2: Network Offline / Online Reconnection Lifecycle
// Reconnect restores state, role, and playback position
// ==============================================================================
test("Flow 2: Reconnect (network offline then online) restores state and role", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(baseUrl);
  await signupAndLogin(page, "Dave", "dave@test.com");

  // Create room as host
  await page.click("#btnShowCreateRoom");
  await page.fill("#createRoomName", "Resilience Lab");
  await page.click("#btnSubmitCreateRoom");

  await expect(page.locator("#roleBadge")).toHaveText("HOST");
  await expect(page.locator("#connectionStatus")).toContainText("CONNECTED");

  // Play and seek to 30s
  await page.click("#btnPlayPause");
  await page.click("#btnSeek30");
  await expect(page.locator("#currentTime")).toHaveText("00:30");

  // 1. Simulate Network Drop (Offline)
  await context.setOffline(true);
  await expect(page.locator("#connectionStatus")).toContainText("OFFLINE");
  await expect(page.locator("#reconnectingNotice")).toBeVisible();

  // 2. Simulate Network Recovery (Online)
  await context.setOffline(false);

  // Client must automatically reconnect via session token
  await expect(page.locator("#connectionStatus")).toContainText("CONNECTED");
  await expect(page.locator("#reconnectingNotice")).not.toBeVisible();

  // Role must remain HOST and position restored
  await expect(page.locator("#roleBadge")).toHaveText("HOST");
  await expect(page.locator("#currentTime")).toHaveText("00:30");

  await context.close();
});

// ==============================================================================
// TEST 3: Access Control & Moderation Enforcement
// Banned user cannot rejoin, expired invite rejected, unverified user blocked
// ==============================================================================
test("Flow 3: Banned user cannot rejoin; expired invite is rejected; unverified user is blocked from room creation", async ({
  browser,
}) => {
  // --- 1. Unverified user is blocked from creating a room ---
  const contextUnverified = await browser.newContext();
  const pageUnverified = await contextUnverified.newPage();
  await pageUnverified.goto(baseUrl);

  await pageUnverified.click("#btnShowAuth");
  await pageUnverified.click("#btnTabSignup");
  await pageUnverified.fill("#signupDisplayName", "Unverified User");
  await pageUnverified.fill("#signupEmail", "unverified@test.com");
  await pageUnverified.fill("#signupPassword", "Password123!");
  await pageUnverified.click("#btnSubmitSignup");
  await expect(pageUnverified.locator("#verificationAlert")).toBeVisible();

  // Log in as unverified user (without verifying email)
  await pageUnverified.click("#btnTabLogin");
  await pageUnverified.fill("#loginEmail", "unverified@test.com");
  await pageUnverified.fill("#loginPassword", "Password123!");
  await pageUnverified.click("#btnSubmitLogin");
  await expect(pageUnverified.locator("#userPill")).toBeVisible();
  await pageUnverified.waitForTimeout(200);

  // Attempt to create room without verifying email -> Rejected
  await pageUnverified.click("#btnShowCreateRoom");
  await pageUnverified.click("#btnSubmitCreateRoom");
  await expect(pageUnverified.locator("#createRoomError")).toContainText(
    "Please verify your email address to create rooms"
  );
  await contextUnverified.close();

  // --- 2. Banned user cannot rejoin room ---
  const contextHost = await browser.newContext();
  const pageHost = await contextHost.newPage();
  await pageHost.goto(baseUrl);

  // Host signs up and verifies email
  await signupAndLogin(pageHost, "AdminHost", "admin@test.com");

  // Host creates room
  await pageHost.click("#btnShowCreateRoom");
  await pageHost.fill("#createRoomName", "Strict Room");
  await pageHost.click("#btnSubmitCreateRoom");
  await expect(pageHost.locator("#roomCodeBadge")).toBeVisible();
  const roomCode = (await pageHost.locator("#roomCodeVal").innerText()).trim();

  // User B joins
  const contextUserB = await browser.newContext();
  const pageUserB = await contextUserB.newPage();
  await pageUserB.goto(baseUrl);
  await pageUserB.click("#btnShowJoinRoom");
  await pageUserB.fill("#joinRoomCode", roomCode);
  await pageUserB.fill("#joinGuestName", "Troublemaker");
  await pageUserB.click("#btnSubmitJoinRoom");
  await expect(pageUserB.locator("#roleBadge")).toHaveText("GUEST");

  // Host bans User B
  const room = roomManager.getRoomByCode(roomCode);
  expect(room).toBeDefined();
  const troublemaker = room!.getAllMembers().find((m) => m.userName === "Troublemaker");
  expect(troublemaker).toBeDefined();

  // Execute ban
  await pageHost.evaluate((uid) => (window as any).banMember(uid), troublemaker!.userId);

  // User B's socket is severed with 4006 USER_BANNED and banned notice shown
  await expect(pageUserB.locator("#bannedNotice")).toBeVisible();

  // User B attempts to rejoin -> Rejected with USER_BANNED
  await pageUserB.click("#btnShowJoinRoom");
  await pageUserB.fill("#joinRoomCode", roomCode);
  await pageUserB.click("#btnSubmitJoinRoom");
  await expect(pageUserB.locator("#joinRoomError")).toContainText("banned");

  await contextUserB.close();

  // --- 3. Expired invite token is rejected ---
  const contextGuest = await browser.newContext();
  const pageGuest = await contextGuest.newPage();
  await pageGuest.goto(baseUrl);

  // Generate an expired invite token on the room
  const inviteResult = (room as any).createInviteLink(room!.hostId, {
    expiresInSeconds: -1, // Expired immediately
    maxUses: 1,
  });
  expect(inviteResult.success).toBe(true);
  const expiredToken = inviteResult.inviteLink!.id;

  // Attempt to join with expired token
  const joinWithExpired = room!.addMember("Guest_Late", {} as any, undefined, {
    inviteToken: expiredToken,
  });
  expect(joinWithExpired.success).toBe(false);
  expect(joinWithExpired.code).toBe("INVITE_EXPIRED");

  await contextGuest.close();
  await contextHost.close();
});

// ==============================================================================
// TEST 4: End-to-End Encrypted (E2EE) Chat & Key Rotation
// Ciphertext only visible in WebSocket frames; key rotates on kick
// ==============================================================================
test("Flow 4: E2EE chat: ciphertext only is visible in the WebSocket frames, and the key rotates after a kick", async ({
  browser,
}) => {
  const secretMessage = "TopSecretPopcornRecipe_AlphaOmega_99!";
  const postKickSecret = "PostKickKeyRotatedSecret_100!";

  // Capture raw WebSocket frames on Host page
  const sentFrames: string[] = [];
  const receivedFrames: string[] = [];

  const contextHost = await browser.newContext();
  const pageHost = await contextHost.newPage();

  // Setup WebSocket frame tap
  pageHost.on("websocket", (ws) => {
    ws.on("framesent", (f) => {
      if (typeof f.payload === "string") sentFrames.push(f.payload);
    });
    ws.on("framereceived", (f) => {
      if (typeof f.payload === "string") receivedFrames.push(f.payload);
    });
  });

  await pageHost.goto(baseUrl);
  await signupAndLogin(pageHost, "CryptoHost", "crypto@test.com");

  // Host creates E2EE room
  await pageHost.click("#btnShowCreateRoom");
  await pageHost.fill("#createRoomName", "Cryptographic Vault");
  await pageHost.check("#createRoomE2ee");
  await pageHost.click("#btnSubmitCreateRoom");

  await expect(pageHost.locator("#e2eeBadge")).toBeVisible();
  await expect(pageHost.locator("#keyVersionBadge")).toHaveText("1");
  const roomCode = (await pageHost.locator("#roomCodeVal").innerText()).trim();

  // Member joins E2EE room
  const contextMember = await browser.newContext();
  const pageMember = await contextMember.newPage();
  await pageMember.goto(baseUrl);
  await pageMember.click("#btnShowJoinRoom");
  await pageMember.fill("#joinRoomCode", roomCode);
  await pageMember.fill("#joinGuestName", "Eve");
  await pageMember.click("#btnSubmitJoinRoom");

  await expect(pageMember.locator("#roleBadge")).toHaveText("GUEST");

  // Host sends confidential message
  await pageHost.fill("#chatInput", secretMessage);
  await pageHost.click("#btnSendChat");

  // Verify message is visible in UI with E2EE tag
  await expect(pageHost.locator("#chatMessages")).toContainText("🔒 E2EE");

  // Verify RAW WEBSOCKET FRAMES: Plaintext MUST NEVER appear in any frame!
  const allWirePayloads = [...sentFrames, ...receivedFrames];
  const leakedPlaintext = allWirePayloads.some((frame) => frame.includes(secretMessage));
  expect(leakedPlaintext).toBe(false);

  // Verify encrypted frame structure was transmitted
  const encryptedFrame = sentFrames.find(
    (f) => f.includes("CHAT_SEND_ENCRYPTED") || (f.includes("ciphertext") && f.includes("iv"))
  );
  expect(encryptedFrame).toBeDefined();
  expect(encryptedFrame).toContain("ciphertext");
  expect(encryptedFrame).toContain("iv");
  expect(encryptedFrame).toContain("keyVersion");

  // Host kicks Eve -> Triggers E2EE Key Rotation
  const room = roomManager.getRoomByCode(roomCode);
  const eveMember = room!.getAllMembers().find((m) => m.userName === "Eve");
  expect(eveMember).toBeDefined();

  // Host kicks member
  await pageHost.evaluate((uid) => (window as any).kickMember(uid), eveMember!.userId);

  // Key Version increments from 1 to 2
  await expect(pageHost.locator("#keyVersionBadge")).toHaveText("2");

  // Send new secret after rotation
  await pageHost.fill("#chatInput", postKickSecret);
  await pageHost.click("#btnSendChat");

  // Verify post-kick plaintext does NOT leak over the wire and is encrypted with keyVersion 2
  const postKickWire = sentFrames[sentFrames.length - 1];
  expect(postKickWire.includes(postKickSecret)).toBe(false);
  expect(postKickWire).toContain('"keyVersion":2');

  await contextMember.close();
  await contextHost.close();
});
