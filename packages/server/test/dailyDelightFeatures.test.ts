import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import webpush from "web-push";
import { WebPushService } from "../src/push/WebPushService.js";
import { ScheduledPartyService } from "../src/parties/ScheduledPartyService.js";
import { handleDailyRoutes } from "../src/parties/dailyRoutes.js";
import { RoomManager } from "../src/rooms/RoomManager.js";
import {
  DurableRoomStorage,
  serializeRoom,
  deserializeRoom,
} from "../src/storage/DurableRoomStorage.js";
import {
  FriendsService,
  MemoryFriendsRepository,
  MemoryNotificationRepository,
  PresenceService,
} from "../src/friends/index.js";
import { MemoryAuthRepository, PasswordSecurity } from "../src/auth/index.js";
import { RateLimiterService } from "../src/auth/services/RateLimiterService.js";
import { TokenSecurity } from "../src/auth/crypto/tokens.js";

describe("Daily Delight Features Test Suite", () => {
  let pushService: WebPushService;
  let scheduledPartyService: ScheduledPartyService;
  let roomManager: RoomManager;
  let authRepo: MemoryAuthRepository;
  let friendsRepo: MemoryFriendsRepository;
  let notificationRepo: MemoryNotificationRepository;
  let presenceService: PresenceService;
  let friendsService: FriendsService;
  let server: http.Server;
  let baseUrl: string;

  let alice: any;
  let bob: any;
  let charlie: any;
  let aliceToken: string;
  let bobToken: string;

  beforeEach(async () => {
    // 1. Auth & Repositories
    authRepo = new MemoryAuthRepository();
    friendsRepo = new MemoryFriendsRepository();
    notificationRepo = new MemoryNotificationRepository();
    presenceService = new PresenceService(friendsRepo, authRepo);
    const rateLimiter = new RateLimiterService();

    // 2. Web Push Service
    pushService = new WebPushService();

    // 3. Friends Service
    friendsService = new FriendsService({
      friendsRepo,
      notificationRepo,
      authRepo,
      presenceService,
      rateLimiter,
      pushService,
    });

    // 4. Room Manager
    roomManager = new RoomManager();

    // 5. Scheduled Party Service
    scheduledPartyService = new ScheduledPartyService({
      roomManager,
      pushService,
      baseUrl: "http://localhost:3001",
    });

    // 6. Test Users
    const dummyHash = await PasswordSecurity.hashPassword("SuperSecret123!");
    alice = await authRepo.createUser({
      email: "alice@example.com",
      displayName: "Alice",
      username: "alice",
      friendCode: "ALICE#1001",
      passwordHash: dummyHash,
      emailVerifiedAt: new Date(),
    });

    bob = await authRepo.createUser({
      email: "bob@example.com",
      displayName: "Bob",
      username: "bob",
      friendCode: "BOB#2002",
      passwordHash: dummyHash,
      emailVerifiedAt: new Date(),
    });

    charlie = await authRepo.createUser({
      email: "charlie@example.com",
      displayName: "Charlie",
      username: "charlie",
      friendCode: "CHARLIE#3003",
      passwordHash: dummyHash,
      emailVerifiedAt: new Date(),
    });

    aliceToken = await TokenSecurity.signAccessToken({
      userId: alice.id,
      email: alice.email,
      displayName: alice.displayName,
      isEmailVerified: true,
    });
    bobToken = await TokenSecurity.signAccessToken({
      userId: bob.id,
      email: bob.email,
      displayName: bob.displayName,
      isEmailVerified: true,
    });

    // Make Alice and Bob friends
    const friendReq = await friendsService.sendFriendRequest({
      fromUserId: alice.id,
      username: "bob",
    });
    if (friendReq.friendshipId) {
      await friendsService.acceptFriendRequest(bob.id, friendReq.friendshipId);
    }

    // 7. HTTP Test Server
    server = http.createServer(async (req, res) => {
      const handled = await handleDailyRoutes(req, res, {
        pushService,
        scheduledPartyService,
        friendsService,
        roomManager,
        authRepo,
        baseUrl,
      });

      if (!handled) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    scheduledPartyService = new ScheduledPartyService({
      roomManager,
      pushService,
      baseUrl,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    scheduledPartyService.stopSchedulerLoop();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // =========================================================================
  // 1. Web Push Notifications (VAPID) & Quiet Hours
  // =========================================================================
  describe("Web Push Notifications (VAPID) & Quiet Hours", () => {
    it("generates and exposes valid ECDSA P-256 public VAPID key", () => {
      const key = pushService.getPublicKey();
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(40);
    });

    it("registers subscriptions, manages preferences, and prunes on unsubscribe", () => {
      const sub = {
        endpoint: "https://push.example.com/sub/alice-phone",
        keys: {
          p256dh: "BM123fakeKeyAliceP256dhBase64StringForTestingPushSubscription",
          auth: "fakeAuthSecret12345==",
        },
      };

      pushService.subscribe(alice.id, sub);
      const subs = pushService.getSubscriptions(alice.id);
      expect(subs).toHaveLength(1);
      expect(subs[0].endpoint).toBe(sub.endpoint);

      // Default preferences
      const prefs = pushService.getPreferences(alice.id);
      expect(prefs.enabled).toBe(true);
      expect(prefs.partyStarted).toBe(true);
      expect(prefs.partyInvite).toBe(true);
      expect(prefs.friendRequest).toBe(true);
      expect(prefs.party10mReminder).toBe(true);

      // Update preferences
      pushService.updatePreferences(alice.id, {
        partyStarted: false,
        quietHoursEnabled: true,
        quietHoursStart: "23:00",
        quietHoursEnd: "07:00",
      });

      const updatedPrefs = pushService.getPreferences(alice.id);
      expect(updatedPrefs.partyStarted).toBe(false);
      expect(updatedPrefs.quietHoursEnabled).toBe(true);

      // Unsubscribe
      const removed = pushService.unsubscribe(alice.id, sub.endpoint);
      expect(removed).toBe(true);
      expect(pushService.getSubscriptions(alice.id)).toHaveLength(0);
    });

    it("evaluates quiet hours accurately across daytime and overnight windows", () => {
      const prefs = pushService.getDefaultPreferences();

      // Disabled quiet hours
      expect(pushService.isQuietHours(prefs)).toBe(false);

      // Overnight window: 22:00 to 08:00 (UTC)
      prefs.quietHoursEnabled = true;
      prefs.quietHoursStart = "22:00";
      prefs.quietHoursEnd = "08:00";
      prefs.timezoneOffsetMinutes = 0; // UTC

      // 23:30 UTC -> in quiet hours
      const nightTime = new Date("2026-10-15T23:30:00Z");
      expect(pushService.isQuietHours(prefs, nightTime)).toBe(true);

      // 03:00 UTC -> in quiet hours
      const earlyMorning = new Date("2026-10-15T03:00:00Z");
      expect(pushService.isQuietHours(prefs, earlyMorning)).toBe(true);

      // 12:00 UTC -> outside quiet hours
      const afternoon = new Date("2026-10-15T12:00:00Z");
      expect(pushService.isQuietHours(prefs, afternoon)).toBe(false);

      // Daytime window: 14:00 to 16:00
      prefs.quietHoursStart = "14:00";
      prefs.quietHoursEnd = "16:00";
      expect(pushService.isQuietHours(prefs, new Date("2026-10-15T15:00:00Z"))).toBe(true);
      expect(pushService.isQuietHours(prefs, new Date("2026-10-15T16:30:00Z"))).toBe(false);
    });

    it("suppresses push notifications when disabled or during quiet hours", async () => {
      const sub = {
        endpoint: "https://push.example.com/sub/alice",
        keys: { p256dh: "key", auth: "auth" },
      };
      pushService.subscribe(alice.id, sub);

      // 1. Globally disabled
      pushService.updatePreferences(alice.id, { enabled: false });
      const resDisabled = await pushService.sendNotification(alice.id, "partyStarted", {
        title: "Party Started",
        body: "Bob started a party",
      });
      expect(resDisabled.suppressedReason).toBe("disabled");
      expect(resDisabled.sent).toBe(0);

      // 2. Specific type disabled
      pushService.updatePreferences(alice.id, { enabled: true, partyStarted: false });
      const resTypeDisabled = await pushService.sendNotification(alice.id, "partyStarted", {
        title: "Party Started",
        body: "Bob started a party",
      });
      expect(resTypeDisabled.suppressedReason).toBe("type_disabled");

      // 3. Quiet hours active
      const sendSpy = vi.spyOn(webpush, "sendNotification").mockResolvedValue({} as any);
      pushService.updatePreferences(alice.id, {
        partyStarted: true,
        quietHoursEnabled: true,
        quietHoursStart: "00:00",
        quietHoursEnd: "23:59",
      });
      const resQuiet = await pushService.sendNotification(alice.id, "partyStarted", {
        title: "Party Started",
        body: "Bob started a party",
      });
      expect(resQuiet.suppressedReason).toBe("quiet_hours");
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("dispatches push notification and prunes HTTP 404/410 stale endpoints", async () => {
      const liveSub = {
        endpoint: "https://push.example.com/sub/live",
        keys: { p256dh: "liveKey", auth: "auth" },
      };
      const deadSub = {
        endpoint: "https://push.example.com/sub/dead",
        keys: { p256dh: "deadKey", auth: "auth" },
      };

      pushService.subscribe(alice.id, liveSub);
      pushService.subscribe(alice.id, deadSub);
      pushService.updatePreferences(alice.id, { quietHoursEnabled: false });

      vi.spyOn(webpush, "sendNotification").mockImplementation(async (target: any) => {
        if (target.endpoint === deadSub.endpoint) {
          const err: any = new Error("Subscription expired");
          err.statusCode = 410; // Gone
          throw err;
        }
        return {} as any;
      });

      const res = await pushService.sendNotification(alice.id, "partyInvite", {
        title: "Party Invitation",
        body: "Alice, you're invited!",
      });

      expect(res.sent).toBe(1);
      expect(res.failed).toBe(1);

      // Dead endpoint pruned automatically
      const remainingSubs = pushService.getSubscriptions(alice.id);
      expect(remainingSubs).toHaveLength(1);
      expect(remainingSubs[0].endpoint).toBe(liveSub.endpoint);
    });
  });

  // =========================================================================
  // 2. Scheduled Watch Parties & .ics Calendar Export
  // =========================================================================
  describe("Scheduled Watch Parties & Calendar Export", () => {
    it("creates scheduled party with creator RSVP defaulted to attending", () => {
      const now = Date.now();
      const party = scheduledPartyService.createParty({
        creatorUserId: alice.id,
        creatorDisplayName: "Alice",
        title: "Friday Movie Night: Interstellar",
        description: "Bring popcorn!",
        scheduledStartTimeMs: now + 3600 * 1000,
        sourceUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        sourceTitle: "Big Buck Bunny",
        invitedUserIds: [bob.id, charlie.id],
      });

      expect(party.id).toBeDefined();
      expect(party.roomCode).toBeDefined();
      expect(party.title).toBe("Friday Movie Night: Interstellar");
      expect(party.rsvps[alice.id]).toBe("attending");
      expect(party.invitedUserIds).toEqual([bob.id, charlie.id]);
      expect(party.roomOpened).toBe(false);
      expect(party.reminded10m).toBe(false);
    });

    it("updates attendee RSVPs accurately", () => {
      const party = scheduledPartyService.createParty({
        creatorUserId: alice.id,
        creatorDisplayName: "Alice",
        title: "Studio Ghibli Marathon",
        scheduledStartTimeMs: Date.now() + 7200 * 1000,
      });

      // Bob accepts
      scheduledPartyService.setRsvp(party.id, bob.id, "attending");
      // Charlie is maybe
      scheduledPartyService.setRsvp(party.id, charlie.id, "maybe");

      const fetched = scheduledPartyService.getParty(party.id)!;
      expect(fetched.rsvps[bob.id]).toBe("attending");
      expect(fetched.rsvps[charlie.id]).toBe("maybe");

      // Bob changes to declined
      scheduledPartyService.setRsvp(party.id, bob.id, "declined");
      const updated = scheduledPartyService.getParty(party.id)!;
      expect(updated.rsvps[bob.id]).toBe("declined");
    });

    it("generates RFC 5545 compliant iCalendar (.ics) export with 10-minute alarm", () => {
      const startTime = new Date("2026-10-20T18:00:00Z").getTime();
      const endTime = new Date("2026-10-20T20:30:00Z").getTime();

      const party = scheduledPartyService.createParty({
        creatorUserId: alice.id,
        creatorDisplayName: "Alice",
        title: "Anime Season Finale & Discussion",
        description: "Live sync watch party",
        scheduledStartTimeMs: startTime,
        scheduledEndTimeMs: endTime,
        roomCode: "anime-squad",
      });

      const ics = scheduledPartyService.generateIcsCalendar(party.id, "https://watchparty.app");

      expect(ics).toContain("BEGIN:VCALENDAR");
      expect(ics).toContain("VERSION:2.0");
      expect(ics).toContain("BEGIN:VEVENT");
      expect(ics).toContain(`UID:${party.id}@watchparty`);
      expect(ics).toContain("DTSTART:20261020T180000Z");
      expect(ics).toContain("DTEND:20261020T203000Z");
      expect(ics).toContain("SUMMARY:Anime Season Finale & Discussion");
      expect(ics).toContain("URL:https://watchparty.app/join/anime-squad");
      expect(ics).toContain("BEGIN:VALARM");
      expect(ics).toContain("TRIGGER:-PT10M");
      expect(ics).toContain("DESCRIPTION:WatchParty starts in 10 minutes");
      expect(ics).toContain("END:VALARM");
      expect(ics).toContain("END:VEVENT");
      expect(ics).toContain("END:VCALENDAR");
    });

    it("sends 10-minute push reminder and auto-opens room at scheduled start time", async () => {
      const pushSpy = vi.spyOn(pushService, "sendParty10mReminderNotification").mockResolvedValue({
        sent: 1,
        failed: 0,
      });

      const now = Date.now();
      // Party 1: Starting in 5 minutes (within 10m threshold)
      const party1 = scheduledPartyService.createParty({
        creatorUserId: alice.id,
        creatorDisplayName: "Alice",
        title: "Starting Soon Party",
        scheduledStartTimeMs: now + 5 * 60 * 1000,
        roomCode: "soon-party",
      });
      scheduledPartyService.setRsvp(party1.id, bob.id, "attending");

      // Trigger scheduler loop manually
      const tick1 = await scheduledPartyService.checkUpcomingParties();
      expect(tick1.remindedCount).toBe(1);
      expect(pushSpy).toHaveBeenCalled();

      const updatedParty1 = scheduledPartyService.getParty(party1.id)!;
      expect(updatedParty1.reminded10m).toBe(true);

      // Second tick should not re-remind
      const tick2 = await scheduledPartyService.checkUpcomingParties();
      expect(tick2.remindedCount).toBe(0);

      // Party 2: Start time has arrived (now or slightly past)
      const party2 = scheduledPartyService.createParty({
        creatorUserId: bob.id,
        creatorDisplayName: "Bob",
        title: "Live Game Stream",
        scheduledStartTimeMs: now - 1000, // already started
        sourceUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
        sourceTitle: "Tears of Steel",
        roomCode: "live-game",
      });

      expect(roomManager.getRoomByCode("live-game")).toBeFalsy();

      const tick3 = await scheduledPartyService.checkUpcomingParties();
      expect(tick3.openedCount).toBe(1);

      // Room should now be automatically created and open in RoomManager
      const openedRoom = roomManager.getRoomByCode("live-game");
      expect(openedRoom).toBeDefined();
      expect(openedRoom!.roomName).toBe("Live Game Stream");
      expect(openedRoom!.playback.title).toBe("Tears of Steel");

      const updatedParty2 = scheduledPartyService.getParty(party2.id)!;
      expect(updatedParty2.roomOpened).toBe(true);
      expect(updatedParty2.roomId).toBe(openedRoom!.roomId);
    });
  });

  // =========================================================================
  // 3. Persistent Home Rooms & Playback Memory ("Continue where we left off")
  // =========================================================================
  describe("Persistent Home Rooms & Playback Memory", () => {
    it("creates standing home rooms immune to idle cleanup timeout", () => {
      const { room } = roomManager.createRoom({
        hostUserId: alice.id,
        hostUserName: "Alice",
        roomName: "Anime Club Home",
        isHomeRoom: true,
        homeGroupName: "Anime Club",
        roomCode: "anime-home",
      });

      expect(room.isHomeRoom).toBe(true);
      expect(room.homeGroupName).toBe("Anime Club");
      expect(room.roomCode).toBe("anime-home");

      // Verify listHomeRooms returns this room
      const homeRooms = roomManager.listHomeRooms();
      expect(homeRooms.some((r) => r.roomCode === "anime-home")).toBe(true);

      // Calling startIdleTimer() on a home room does NOT set idle timer or destroy the room
      room.startIdleTimer();
      expect((room as any).idleCleanupTimer).toBeNull();
      expect(roomManager.getRoom(room.roomId)).toBeDefined();
    });

    it("remembers playback position across play, seek, and source changes", () => {
      const { room } = roomManager.createRoom({
        hostUserId: alice.id,
        hostUserName: "Alice",
        roomName: "Late Night Movies",
        isHomeRoom: true,
        initialVideoId: "video_ep_01",
      });

      // Play video at position 120,000 ms (2:00)
      room.applyPlay(alice.id, 1, 120000);
      expect(room.getRememberedPosition("video_ep_01")).toBe(120000);

      // Seek video to 450,000 ms (7:30)
      room.applySeek(alice.id, 2, 450000);
      expect(room.getRememberedPosition("video_ep_01")).toBe(450000);

      // Switch to Episode 2
      room.applyChangeVideo(alice.id, 3, "video_ep_02", 0);
      expect(room.playback.videoId).toBe("video_ep_02");

      // Verify Episode 1 position is still preserved in memory
      expect(Math.abs(room.getRememberedPosition("video_ep_01")! - 450000)).toBeLessThanOrEqual(50);

      // Play Episode 2 at 60,000 ms
      room.applyPlay(alice.id, 4, 60000);
      expect(room.getRememberedPosition("video_ep_02")).toBe(60000);
    });

    it("persists and restores isHomeRoom, homeGroupName, and playback memory durably", async () => {
      const storage = new DurableRoomStorage();
      const { room } = roomManager.createRoom({
        hostUserId: alice.id,
        hostUserName: "Alice",
        roomName: "Durable Home Room",
        isHomeRoom: true,
        homeGroupName: "Weekend Crew",
        initialVideoId: "movie_lotr",
      });

      room.rememberSourcePosition("movie_lotr", 845000, alice.id);
      room.rememberSourcePosition("movie_starwars", 123000, bob.id);

      // Export snapshot
      const snapshot = serializeRoom(room);
      expect(snapshot.isHomeRoom).toBe(true);
      expect(snapshot.homeGroupName).toBe("Weekend Crew");
      expect(snapshot.sourcePlaybackMemory).toBeDefined();
      expect(snapshot.sourcePlaybackMemory!["movie_lotr"].positionMs).toBe(845000);

      // Save to durable storage
      await storage.saveRoomSnapshot(snapshot);

      // Restore into a fresh Room instance
      const restoredRoom = deserializeRoom(snapshot, roomManager);
      expect(restoredRoom.isHomeRoom).toBe(true);
      expect(restoredRoom.homeGroupName).toBe("Weekend Crew");
      expect(restoredRoom.getRememberedPosition("movie_lotr")).toBe(845000);
      expect(restoredRoom.getRememberedPosition("movie_starwars")).toBe(123000);
    });
  });

  // =========================================================================
  // 4. Friends Activity Feed & Quick Share
  // =========================================================================
  describe("Friends Activity Feed & Quick Share", () => {
    it("aggregates active co-watching activity for friend groups", async () => {
      // Create room with Bob watching Big Buck Bunny
      const { room } = roomManager.createRoom({
        hostUserId: bob.id,
        hostUserName: "Bob",
        roomName: "Sci-Fi Saturdays",
        roomCode: "scifi-party",
        initialVideoId: "big_buck_bunny",
      });
      room.playback.title = "Big Buck Bunny HD";
      const bobMember = room.getMember(bob.id);
      if (bobMember) bobMember.isConnected = true;

      // Alice checks friends activity
      const activityAlice = await friendsService.getFriendsActivity(alice.id, roomManager);
      expect(activityAlice).toHaveLength(1);
      expect(activityAlice[0].roomCode).toBe("scifi-party");
      expect(activityAlice[0].sourceTitle).toBe("Big Buck Bunny HD");
      expect(activityAlice[0].friendParticipants[0].userId).toBe(bob.id);
      expect(activityAlice[0].friendParticipants[0].displayName).toBe("Bob");

      // Charlie is not friends with Bob, so Charlie sees empty feed
      const activityCharlie = await friendsService.getFriendsActivity(charlie.id, roomManager);
      expect(activityCharlie).toHaveLength(0);
    });

    it("respects presence privacy ('nobody') in activity feed", async () => {
      const { room } = roomManager.createRoom({
        hostUserId: bob.id,
        hostUserName: "Bob",
        roomName: "Secret Chill Room",
        roomCode: "secret-chill",
      });
      const bobMember = room.getMember(bob.id);
      if (bobMember) bobMember.isConnected = true;

      // Bob sets presence privacy to 'nobody'
      await friendsService.updatePresencePrivacy(bob.id, "nobody");

      const activityAlice = await friendsService.getFriendsActivity(alice.id, roomManager);
      expect(activityAlice).toHaveLength(0);
    });

    it("dispatches push notification when host notifies friends that watch party started", async () => {
      const pushSpy = vi.spyOn(pushService, "sendPartyStartedNotification").mockResolvedValue({
        sent: 1,
        failed: 0,
      });

      const { room } = roomManager.createRoom({
        hostUserId: alice.id,
        hostUserName: "Alice",
        roomName: "Friday Watch Party",
        roomCode: "friday-fun",
      });
      room.playback.title = "Epic Movie";

      // Alice notifies friends
      const count = await friendsService.notifyFriendsPartyStarted(alice.id, {
        code: room.roomCode,
        name: room.roomName,
        videoTitle: "Epic Movie",
      });

      // Bob is Alice's friend, so notification is sent to Bob
      expect(count).toBe(1);
      expect(pushSpy).toHaveBeenCalledWith(
        bob.id,
        expect.objectContaining({
          id: alice.id,
          displayName: "Alice",
        }),
        expect.objectContaining({
          code: "friday-fun",
          name: "Friday Watch Party",
          videoTitle: "Epic Movie",
        })
      );
    });
  });

  // =========================================================================
  // 5. Daily Delight HTTP API Routes
  // =========================================================================
  describe("Daily Delight HTTP API Routes", () => {
    it("GET /api/push/vapid-key returns public key", async () => {
      const res = await fetch(`${baseUrl}/api/push/vapid-key`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.publicKey).toBe(pushService.getPublicKey());
    });

    it("POST /api/push/subscribe and /preferences manages settings", async () => {
      const subPayload = {
        subscription: {
          endpoint: "https://push.client.example/token123",
          keys: {
            p256dh: "clientPublicKeyBase64",
            auth: "clientAuthSecretBase64",
          },
        },
      };

      // Subscribe
      const subRes = await fetch(`${baseUrl}/api/push/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify(subPayload),
      });
      expect(subRes.status).toBe(200);
      const subJson = await subRes.json();
      expect(subJson.success).toBe(true);

      // Update Preferences & Quiet Hours
      const prefRes = await fetch(`${baseUrl}/api/push/preferences`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          quietHoursEnabled: true,
          quietHoursStart: "22:30",
          quietHoursEnd: "07:30",
          partyInvite: false,
        }),
      });
      expect(prefRes.status).toBe(200);
      const prefJson = await prefRes.json();
      expect(prefJson.preferences.quietHoursEnabled).toBe(true);
      expect(prefJson.preferences.partyInvite).toBe(false);
    });

    it("POST & GET /api/scheduled-parties and .ics export route", async () => {
      const partyData = {
        title: "Saturday Premier Watch",
        description: "Join us on Saturday!",
        scheduledStartTimeMs: Date.now() + 86400 * 1000,
        sourceTitle: "Grand Premier",
        sourceUrl: "https://example.com/video.mp4",
      };

      // Create party
      const createRes = await fetch(`${baseUrl}/api/scheduled-parties`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify(partyData),
      });
      expect(createRes.status).toBe(201);
      const createJson = await createRes.json();
      expect(createJson.party.title).toBe("Saturday Premier Watch");
      const partyId = createJson.party.id;

      // Bob RSVPs
      const rsvpRes = await fetch(`${baseUrl}/api/scheduled-parties/${partyId}/rsvp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({ status: "attending" }),
      });
      expect(rsvpRes.status).toBe(200);
      const rsvpJson = await rsvpRes.json();
      expect(rsvpJson.party.rsvps[bob.id]).toBe("attending");

      // Export .ics calendar
      const icsRes = await fetch(`${baseUrl}/api/scheduled-parties/${partyId}/ics`);
      expect(icsRes.status).toBe(200);
      expect(icsRes.headers.get("content-type")).toContain("text/calendar");
      const icsText = await icsRes.text();
      expect(icsText).toContain("BEGIN:VCALENDAR");
      expect(icsText).toContain("SUMMARY:Saturday Premier Watch");
      expect(icsText).toContain("TRIGGER:-PT10M");
    });

    it("POST & GET /api/home-rooms creates and lists persistent rooms", async () => {
      // Create home room
      const createRes = await fetch(`${baseUrl}/api/home-rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          roomName: "Alice & Friends Lounge",
          homeGroupName: "The Squad",
          roomCode: "squad-lounge",
        }),
      });
      expect(createRes.status).toBe(201);
      const createJson = await createRes.json();
      expect(createJson.room.roomCode).toBe("squad-lounge");
      expect(createJson.room.isHomeRoom).toBe(true);

      // List home rooms
      const listRes = await fetch(`${baseUrl}/api/home-rooms`);
      expect(listRes.status).toBe(200);
      const listJson = await listRes.json();
      expect(listJson.count).toBeGreaterThanOrEqual(1);
      expect(listJson.homeRooms.some((r: any) => r.roomCode === "squad-lounge")).toBe(true);
    });

    it("GET /api/friends/activity and POST /api/rooms/:code/notify-started", async () => {
      // Create room with Bob
      const { room } = roomManager.createRoom({
        hostUserId: bob.id,
        hostUserName: "Bob",
        roomName: "Bob's Movie Theater",
        roomCode: "bobs-theater",
      });
      room.playback.title = "Action Hero 3";
      const bobMember = room.getMember(bob.id);
      if (bobMember) bobMember.isConnected = true;

      // Alice fetches friends activity
      const actRes = await fetch(`${baseUrl}/api/friends/activity`, {
        headers: {
          Authorization: `Bearer ${aliceToken}`,
        },
      });
      expect(actRes.status).toBe(200);
      const actJson = await actRes.json();
      expect(actJson.count).toBe(1);
      expect(actJson.activity[0].roomCode).toBe("bobs-theater");

      // Bob notifies friends that party started
      vi.spyOn(pushService, "sendPartyStartedNotification").mockResolvedValue({
        sent: 1,
        failed: 0,
      });

      const notifyRes = await fetch(`${baseUrl}/api/rooms/bobs-theater/notify-started`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bobToken}`,
        },
      });
      expect(notifyRes.status).toBe(200);
      const notifyJson = await notifyRes.json();
      expect(notifyJson.success).toBe(true);
      expect(notifyJson.notifiedCount).toBe(1);
    });
  });
});
