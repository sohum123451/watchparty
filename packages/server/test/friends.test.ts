import { describe, it, expect, beforeEach } from "vitest";
import { WebSocket } from "ws";
import {
  MemoryAuthRepository,
  PasswordSecurity,
} from "../src/auth/index.js";
import {
  FriendsService,
  MemoryFriendsRepository,
  MemoryNotificationRepository,
  PresenceService,
} from "../src/friends/index.js";
import { RateLimiterService } from "../src/auth/services/RateLimiterService.js";

describe("Friends System (Server)", () => {
  let authRepo: MemoryAuthRepository;
  let friendsRepo: MemoryFriendsRepository;
  let notificationRepo: MemoryNotificationRepository;
  let presenceService: PresenceService;
  let rateLimiter: RateLimiterService;
  let friendsService: FriendsService;

  let alice: any;
  let bob: any;
  let charlie: any;
  let unverifiedDave: any;

  beforeEach(async () => {
    authRepo = new MemoryAuthRepository();
    friendsRepo = new MemoryFriendsRepository();
    notificationRepo = new MemoryNotificationRepository();
    presenceService = new PresenceService(friendsRepo, authRepo);
    rateLimiter = new RateLimiterService();

    friendsService = new FriendsService({
      friendsRepo,
      notificationRepo,
      authRepo,
      presenceService,
      rateLimiter,
    });

    const dummyHash = await PasswordSecurity.hashPassword("SuperSecure123!");

    // Create test users
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

    unverifiedDave = await authRepo.createUser({
      email: "dave@example.com",
      displayName: "Dave",
      username: "dave",
      friendCode: "DAVE#4004",
      passwordHash: dummyHash,
      emailVerifiedAt: null, // Unverified
    });
  });

  describe("Friend Requests & Mutual Request Resolution", () => {
    it("should allow Alice to send a friend request by username", async () => {
      const res = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        username: "bob",
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe("pending");

      const relationship = await friendsRepo.getRelationship(alice.id, bob.id);
      expect(relationship).not.toBeNull();
      expect(relationship?.status).toBe("pending");
      expect(relationship?.requesterId).toBe(alice.id);
      expect(relationship?.addresseeId).toBe(bob.id);

      // Check notification created for Bob
      const notifs = await notificationRepo.getUserNotifications(bob.id);
      expect(notifs.length).toBe(1);
      expect(notifs[0].type).toBe("friend_request_received");
      expect(notifs[0].actorId).toBe(alice.id);
    });

    it("should allow Alice to send a friend request by friendCode", async () => {
      const res = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        friendCode: "BOB#2002",
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe("pending");
    });

    it("should auto-resolve mutual requests to accepted when both users send requests to each other", async () => {
      // 1. Alice sends request to Bob
      const res1 = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        username: "bob",
      });
      expect(res1.status).toBe("pending");

      // 2. Bob sends request to Alice (mutual!)
      const res2 = await friendsService.sendFriendRequest({
        fromUserId: bob.id,
        username: "alice",
      });

      expect(res2.success).toBe(true);
      expect(res2.status).toBe("accepted");
      expect(res2.message).toContain("accepted");

      // Verify DB relationship is now accepted
      const relationship = await friendsRepo.getRelationship(alice.id, bob.id);
      expect(relationship?.status).toBe("accepted");

      // Verify (Bob, Alice) lookup yields the exact same accepted relationship
      const reverseLookup = await friendsRepo.getRelationship(bob.id, alice.id);
      expect(reverseLookup?.id).toBe(relationship?.id);
      expect(reverseLookup?.status).toBe("accepted");

      // Verify both have accepted notifications
      const aliceNotifs = await notificationRepo.getUserNotifications(alice.id);
      expect(aliceNotifs.some((n) => n.type === "friend_request_accepted")).toBe(true);

      const bobNotifs = await notificationRepo.getUserNotifications(bob.id);
      expect(bobNotifs.some((n) => n.type === "friend_request_accepted")).toBe(true);
    });

    it("should handle duplicate requests idempotently without errors", async () => {
      // Alice sends to Bob
      await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        username: "bob",
      });

      // Alice sends to Bob again
      const dup = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        username: "bob",
      });

      expect(dup.success).toBe(true);
      expect(dup.status).toBe("pending");
      expect(dup.message).toContain("already pending");
    });

    it("should report already friends if request is sent to an existing friend", async () => {
      // Make them friends
      await friendsService.sendFriendRequest({ fromUserId: alice.id, username: "bob" });
      await friendsService.sendFriendRequest({ fromUserId: bob.id, username: "alice" });

      // Alice tries to send again
      const res = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        username: "bob",
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe("accepted");
      expect(res.message).toContain("already friends");
    });

    it("should reject unverified users from adding friends", async () => {
      await expect(
        friendsService.sendFriendRequest({
          fromUserId: unverifiedDave.id,
          username: "alice",
        })
      ).rejects.toThrow("verify your email address to add friends");
    });

    it("should reject adding self as friend", async () => {
      await expect(
        friendsService.sendFriendRequest({
          fromUserId: alice.id,
          username: "alice",
        })
      ).rejects.toThrow("Cannot add yourself as a friend");
    });
  });

  describe("Anti-Enumeration on Email Lookups", () => {
    it("should return identical generic success response when email does not exist", async () => {
      const nonExistentEmail = "ghost_user_999@notfound.org";

      const res = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        email: nonExistentEmail,
      });

      // No error thrown, returns generic success
      expect(res.success).toBe(true);
      expect(res.message).toBe("If an account with that email exists, a friend request has been sent.");

      // No relationship created
      const all = await friendsRepo.getUserFriendships(alice.id);
      expect(all.length).toBe(0);
    });

    it("should return generic success message when email exists", async () => {
      const res = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        email: "bob@example.com",
      });

      expect(res.success).toBe(true);
      expect(res.message).toBe("If an account with that email exists, a friend request has been sent.");

      // Relationship created in background
      const rel = await friendsRepo.getRelationship(alice.id, bob.id);
      expect(rel?.status).toBe("pending");
    });
  });

  describe("Authorization Checks", () => {
    it("should not allow Charlie to accept a friend request sent from Alice to Bob", async () => {
      const sent = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        username: "bob",
      });

      await expect(
        friendsService.acceptFriendRequest(charlie.id, sent.friendshipId!)
      ).rejects.toThrow("not authorized to accept this friend request");
    });

    it("should not allow Charlie to decline a friend request sent from Alice to Bob", async () => {
      const sent = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        username: "bob",
      });

      await expect(
        friendsService.declineFriendRequest(charlie.id, sent.friendshipId!)
      ).rejects.toThrow("not authorized to decline this friend request");
    });

    it("should not allow Bob to cancel a request sent by Alice", async () => {
      const sent = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        username: "bob",
      });

      await expect(
        friendsService.cancelFriendRequest(bob.id, sent.friendshipId!)
      ).rejects.toThrow("not authorized to cancel this friend request");
    });

    it("should allow Alice to cancel her own sent request", async () => {
      const sent = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        username: "bob",
      });

      const cancelled = await friendsService.cancelFriendRequest(alice.id, sent.friendshipId!);
      expect(cancelled).toBe(true);

      const rel = await friendsRepo.getRelationship(alice.id, bob.id);
      expect(rel).toBeNull();
    });

    it("should allow Bob to accept Alice's request", async () => {
      const sent = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        username: "bob",
      });

      const accepted = await friendsService.acceptFriendRequest(bob.id, sent.friendshipId!);
      expect(accepted.status).toBe("accepted");
      expect(accepted.friend?.id).toBe(alice.id);
    });

    it("should allow Bob to decline Alice's request", async () => {
      const sent = await friendsService.sendFriendRequest({
        fromUserId: alice.id,
        username: "bob",
      });

      const declined = await friendsService.declineFriendRequest(bob.id, sent.friendshipId!);
      expect(declined).toBe(true);

      const rel = await friendsRepo.getRelationship(alice.id, bob.id);
      expect(rel).toBeNull();
    });
  });

  describe("Blocking & Edge Cases", () => {
    it("blocking should remove active friendship, hide presence, and stop invites", async () => {
      // 1. Establish friendship
      await friendsService.sendFriendRequest({ fromUserId: alice.id, username: "bob" });
      await friendsService.sendFriendRequest({ fromUserId: bob.id, username: "alice" });

      let list = await friendsService.getFriendsList(alice.id);
      expect(list.friends.length).toBe(1);

      // 2. Alice blocks Bob
      await friendsService.blockUser(alice.id, bob.id);

      // 3. Friendship is removed from friends list
      list = await friendsService.getFriendsList(alice.id);
      expect(list.friends.length).toBe(0);
      expect(list.blockedUsers.length).toBe(1);
      expect(list.blockedUsers[0].friend?.id).toBe(bob.id);

      // 4. Bob's friend list should not show Alice
      const bobList = await friendsService.getFriendsList(bob.id);
      expect(bobList.friends.length).toBe(0);

      // 5. Bob cannot invite Alice to a room
      await expect(
        friendsService.sendRoomInvite({
          fromUserId: bob.id,
          toUserId: alice.id,
          roomCode: "XYZ123",
          roomName: "Test Room",
        })
      ).rejects.toThrow("only invite accepted friends");

      // 6. Bob cannot find Alice in search
      const searchRes = await friendsService.searchUsers(bob.id, "alice");
      expect(searchRes.length).toBe(0);

      // 7. Bob cannot send friend request to Alice
      await expect(
        friendsService.sendFriendRequest({
          fromUserId: bob.id,
          username: "alice",
        })
      ).rejects.toThrow();
    });

    it("should only allow the blocker to unblock, returning to a clean state", async () => {
      await friendsService.blockUser(alice.id, bob.id);

      // Bob tries to unblock Alice -> rejected!
      await expect(
        friendsService.unblockUser(bob.id, alice.id)
      ).rejects.toThrow("You cannot unblock this user");

      // Alice unblocks Bob -> succeeds!
      const unblocked = await friendsService.unblockUser(alice.id, bob.id);
      expect(unblocked).toBe(true);

      const rel = await friendsRepo.getRelationship(alice.id, bob.id);
      expect(rel).toBeNull();

      // Bob can now find Alice in search again
      const searchRes = await friendsService.searchUsers(bob.id, "alice");
      expect(searchRes.length).toBe(1);
      expect(searchRes[0].id).toBe(alice.id);
    });
  });

  describe("Real-time Presence & Privacy Settings", () => {
    it("should send presence updates to friends when user goes online or changes activity", async () => {
      // Make Alice and Bob friends
      await friendsService.sendFriendRequest({ fromUserId: alice.id, username: "bob" });
      await friendsService.sendFriendRequest({ fromUserId: bob.id, username: "alice" });

      const receivedBobMessages: any[] = [];
      const fakeBobSocket: any = {
        readyState: WebSocket.OPEN,
        send: (data: string) => {
          receivedBobMessages.push(JSON.parse(data));
        },
        once: () => {},
      };

      // Bob connects
      await presenceService.registerSocket(
        {
          id: bob.id,
          displayName: bob.displayName,
          username: bob.username,
          friendCode: bob.friendCode,
        },
        fakeBobSocket
      );

      // Alice connects
      const fakeAliceSocket: any = {
        readyState: WebSocket.OPEN,
        send: () => {},
        once: () => {},
      };
      await presenceService.registerSocket(
        {
          id: alice.id,
          displayName: alice.displayName,
          username: alice.username,
          friendCode: alice.friendCode,
        },
        fakeAliceSocket
      );

      // Bob should have received Alice's "online" presence
      const aliceOnlineMsg = receivedBobMessages.find(
        (m) => m.type === "FRIEND_PRESENCE_UPDATE" && m.payload.userId === alice.id
      );
      expect(aliceOnlineMsg).toBeDefined();
      expect(aliceOnlineMsg.payload.status).toBe("online");

      // Alice joins a room and starts watching
      receivedBobMessages.length = 0;
      await presenceService.setRoomActivity(alice.id, {
        roomCode: "ROOM99",
        roomName: "Cinema Lounge",
        videoTitle: "Inception",
        isPublic: true,
      });

      const watchingMsg = receivedBobMessages.find(
        (m) => m.type === "FRIEND_PRESENCE_UPDATE" && m.payload.userId === alice.id
      );
      expect(watchingMsg).toBeDefined();
      expect(watchingMsg.payload.status).toBe("watching");
      expect(watchingMsg.payload.activity?.roomCode).toBe("ROOM99");
      expect(watchingMsg.payload.activity?.videoTitle).toBe("Inception");
    });

    it("should respect privacy settings: 'nobody' hides presence and sends offline", async () => {
      await friendsService.sendFriendRequest({ fromUserId: alice.id, username: "bob" });
      await friendsService.sendFriendRequest({ fromUserId: bob.id, username: "alice" });

      const bobMsgs: any[] = [];
      const fakeBobSocket: any = {
        readyState: WebSocket.OPEN,
        send: (d: string) => bobMsgs.push(JSON.parse(d)),
        once: () => {},
      };
      await presenceService.registerSocket(
        {
          id: bob.id,
          displayName: bob.displayName,
          username: bob.username,
          friendCode: bob.friendCode,
        },
        fakeBobSocket
      );

      // Alice sets privacy to "nobody"
      await friendsService.updatePresencePrivacy(alice.id, "nobody");

      // Bob receives Alice's offline presence
      const offlineMsg = bobMsgs.find(
        (m) => m.type === "FRIEND_PRESENCE_UPDATE" && m.payload.userId === alice.id
      );
      expect(offlineMsg).toBeDefined();
      expect(offlineMsg.payload.status).toBe("offline");

      // Now if Alice changes room activity, no update is leaked
      bobMsgs.length = 0;
      await presenceService.setRoomActivity(alice.id, {
        roomCode: "SECRET",
        roomName: "Private Cinema",
        videoTitle: "Top Secret",
      });

      expect(bobMsgs.length).toBe(0);
    });
  });

  describe("Room Invites & Notification Persistence", () => {
    it("should deliver room invites in real-time and store persistent notifications", async () => {
      // Alice and Bob are friends
      await friendsService.sendFriendRequest({ fromUserId: alice.id, username: "bob" });
      await friendsService.sendFriendRequest({ fromUserId: bob.id, username: "alice" });

      const bobMsgs: any[] = [];
      const fakeBobSocket: any = {
        readyState: WebSocket.OPEN,
        send: (d: string) => bobMsgs.push(JSON.parse(d)),
        once: () => {},
      };
      await presenceService.registerSocket(
        {
          id: bob.id,
          displayName: bob.displayName,
          username: bob.username,
          friendCode: bob.friendCode,
        },
        fakeBobSocket
      );

      // Alice invites Bob
      const invite = await friendsService.sendRoomInvite({
        fromUserId: alice.id,
        toUserId: bob.id,
        roomCode: "INV123",
        roomName: "Alice's Hangout",
        videoTitle: "Interstellar",
      });

      expect(invite.roomCode).toBe("INV123");

      // Bob received real-time invite
      const inviteMsg = bobMsgs.find((m) => m.type === "ROOM_INVITE_RECEIVED");
      expect(inviteMsg).toBeDefined();
      expect(inviteMsg.payload.roomCode).toBe("INV123");
      expect(inviteMsg.payload.fromUserId).toBe(alice.id);

      // Persistent notification stored for Bob
      const notifs = await notificationRepo.getUserNotifications(bob.id);
      expect(notifs.some((n) => n.type === "room_invite")).toBe(true);
      const unread = await notificationRepo.getUnreadCount(bob.id);
      expect(unread).toBeGreaterThan(0);

      // Bob marks notification as read
      const notifId = notifs[0].id;
      await notificationRepo.markAsRead(notifId, bob.id);
      const unreadAfter = await notificationRepo.getUnreadCount(bob.id);
      expect(unreadAfter).toBe(unread - 1);
    });
  });

  describe("Presence Fan-Out at Scale", () => {
    it("should broadcast presence updates to 50 concurrent online friends with minimal latency", async () => {
      const friendCount = 50;
      const friendIds: string[] = [];
      const friendSockets: any[] = [];
      const receivedCounts: number[] = new Array(friendCount).fill(0);

      // Create and friend 50 users with Alice
      for (let i = 0; i < friendCount; i++) {
        const u = await authRepo.createUser({
          email: `friend${i}@example.com`,
          displayName: `Friend ${i}`,
          username: `friend${i}`,
          friendCode: `FR#${1000 + i}`,
          passwordHash: "hash",
          emailVerifiedAt: new Date(),
        });
        friendIds.push(u.id);

        // Instant mutual friendship
        await friendsRepo.createOrUpdateFriendship({
          user1Id: alice.id,
          user2Id: u.id,
          requesterId: alice.id,
          addresseeId: u.id,
          status: "accepted",
        });

        const idx = i;
        const fakeWs: any = {
          readyState: WebSocket.OPEN,
          send: () => {
            receivedCounts[idx]++;
          },
          once: () => {},
        };
        friendSockets.push(fakeWs);

        await presenceService.registerSocket(
          {
            id: u.id,
            displayName: u.displayName,
            username: u.username,
            friendCode: u.friendCode,
          },
          fakeWs
        );
      }

      // Reset count trackers before fan-out benchmark
      for (let i = 0; i < friendCount; i++) receivedCounts[i] = 0;

      const startTime = performance.now();

      // Alice updates her presence activity
      await presenceService.setRoomActivity(alice.id, {
        roomCode: "PARTY50",
        roomName: "Mega Watch Party",
        videoTitle: "The Matrix",
        isPublic: true,
      });

      const elapsedMs = performance.now() - startTime;

      // Verify all 50 friends received the presence update
      for (let i = 0; i < friendCount; i++) {
        expect(receivedCounts[i]).toBeGreaterThanOrEqual(1);
      }

      // Fan-out across 50 users should finish in < 50ms
      expect(elapsedMs).toBeLessThan(50);
    });
  });
});
