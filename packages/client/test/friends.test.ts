import { describe, it, expect, vi, beforeEach } from "vitest";
import { FriendsManager } from "../src/social/FriendsManager.js";
import { SocialClient } from "../src/social/SocialClient.js";
import { FriendPresence, ServerMessage } from "@watchparty/shared";

describe("FriendsManager (Client)", () => {
  let friendsManager: FriendsManager;
  let sentMessages: any[];
  let joinedRooms: string[];
  let leftRoomsCount: number;

  beforeEach(() => {
    sentMessages = [];
    joinedRooms = [];
    leftRoomsCount = 0;

    friendsManager = new FriendsManager({
      baseUrl: "http://localhost:3001",
      accessToken: "fake-jwt-token",
      wsSender: (msg) => sentMessages.push(msg),
      onJoinRoom: (code) => joinedRooms.push(code),
      onLeaveRoom: () => leftRoomsCount++,
    });
  });

  describe("Real-time Presence Sync & Updates", () => {
    it("should sync initial friend presences from server", () => {
      let notifiedPresences: FriendPresence[] = [];
      friendsManager.onPresenceChange((list) => {
        notifiedPresences = list;
      });

      const initialSyncMsg: ServerMessage = {
        type: "FRIEND_PRESENCE_SYNC",
        payload: {
          presences: [
            {
              userId: "u-alice",
              displayName: "Alice",
              friendCode: "ALICE#1234",
              status: "online",
              lastSeenAt: Date.now(),
            },
            {
              userId: "u-bob",
              displayName: "Bob",
              friendCode: "BOB#5678",
              status: "watching",
              activity: {
                roomCode: "ABC789",
                roomName: "Movie Night",
                videoTitle: "Inception",
                isPublic: true,
              },
              lastSeenAt: Date.now(),
            },
          ],
        },
      };

      friendsManager.handleServerMessage(initialSyncMsg);

      expect(friendsManager.presences.size).toBe(2);
      expect(notifiedPresences.length).toBe(2);
      expect(friendsManager.presences.get("u-bob")?.status).toBe("watching");
      expect(friendsManager.presences.get("u-bob")?.activity?.videoTitle).toBe("Inception");
    });

    it("should update a friend's status dynamically upon FRIEND_PRESENCE_UPDATE", () => {
      // Bob goes online
      friendsManager.handleServerMessage({
        type: "FRIEND_PRESENCE_UPDATE",
        payload: {
          userId: "u-bob",
          displayName: "Bob",
          friendCode: "BOB#5678",
          status: "online",
          lastSeenAt: Date.now(),
        },
      });
      expect(friendsManager.presences.get("u-bob")?.status).toBe("online");

      // Bob starts watching Interstellar
      friendsManager.handleServerMessage({
        type: "FRIEND_PRESENCE_UPDATE",
        payload: {
          userId: "u-bob",
          displayName: "Bob",
          friendCode: "BOB#5678",
          status: "watching",
          activity: {
            roomCode: "XYZ555",
            roomName: "SciFi Hub",
            videoTitle: "Interstellar",
          },
          lastSeenAt: Date.now(),
        },
      });

      expect(friendsManager.presences.get("u-bob")?.status).toBe("watching");
      expect(friendsManager.presences.get("u-bob")?.activity?.videoTitle).toBe("Interstellar");
    });
  });

  describe("Room Invites & In-Room Switching Workflow", () => {
    it("should handle invite when user is not currently in a room (direct join)", () => {
      friendsManager.setCurrentRoom(undefined);

      let handledInvite: any = null;
      friendsManager.onRoomInvite((options) => {
        handledInvite = options;
      });

      friendsManager.handleServerMessage({
        type: "ROOM_INVITE_RECEIVED",
        payload: {
          inviteId: "inv_1",
          fromUserId: "u-alice",
          fromDisplayName: "Alice",
          roomCode: "INV100",
          roomName: "Alice Lounge",
          videoTitle: "Oppenheimer",
          createdAt: Date.now(),
        },
      });

      expect(handledInvite).not.toBeNull();
      expect(handledInvite.isCurrentlyInRoom).toBe(false);
      expect(handledInvite.currentRoomCode).toBeUndefined();

      // Accept invite
      handledInvite.accept();

      expect(leftRoomsCount).toBe(0); // did not need to leave
      expect(joinedRooms).toEqual(["INV100"]);
    });

    it("should handle invite arriving while user is already in another room (switch room workflow)", () => {
      // User is currently watching in room "CURRENT_ROOM"
      friendsManager.setCurrentRoom("CURRENT_ROOM");

      let handledInvite: any = null;
      friendsManager.onRoomInvite((options) => {
        handledInvite = options;
      });

      friendsManager.handleServerMessage({
        type: "ROOM_INVITE_RECEIVED",
        payload: {
          inviteId: "inv_2",
          fromUserId: "u-charlie",
          fromDisplayName: "Charlie",
          roomCode: "TARGET_ROOM",
          roomName: "Charlie's Theater",
          videoTitle: "Dune 2",
          createdAt: Date.now(),
        },
      });

      expect(handledInvite).not.toBeNull();
      expect(handledInvite.isCurrentlyInRoom).toBe(true);
      expect(handledInvite.currentRoomCode).toBe("CURRENT_ROOM");

      // User chooses to switch rooms
      handledInvite.accept();

      // Verified: leaves current room and joins new room
      expect(leftRoomsCount).toBe(1);
      expect(joinedRooms).toEqual(["TARGET_ROOM"]);
    });

    it("should allow one-click 'Join friend's room' for a friend in a room", () => {
      friendsManager.setCurrentRoom("OLD_ROOM");

      // One click join friend's room
      friendsManager.joinFriendRoom("FRIEND_ROOM");

      expect(leftRoomsCount).toBe(1);
      expect(joinedRooms).toEqual(["FRIEND_ROOM"]);
    });

    it("should send room invite over WebSocket when wsSender is configured", async () => {
      friendsManager.setCurrentRoom("ROOM_MY");

      const invite = await friendsManager.inviteFriendToRoom("u-friend-9");

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].type).toBe("FRIEND_INVITE_SEND");
      expect(sentMessages[0].payload.friendUserId).toBe("u-friend-9");
      expect(invite.roomCode).toBe("ROOM_MY");
    });
  });

  describe("Notification Centre & Persistence", () => {
    it("should track unread notification count and items from server messages", () => {
      let notifiedList: any[] = [];
      let notifiedCount = 0;
      friendsManager.onNotificationsChange((list, count) => {
        notifiedList = list;
        notifiedCount = count;
      });

      friendsManager.handleServerMessage({
        type: "NOTIFICATIONS_COUNT",
        payload: { unreadCount: 3 },
      });
      expect(friendsManager.unreadCount).toBe(3);
      expect(notifiedCount).toBe(3);

      friendsManager.handleServerMessage({
        type: "NOTIFICATION_CREATED",
        payload: {
          id: "notif_1",
          userId: "self",
          type: "friend_request_received",
          actorId: "u-bob",
          actorName: "Bob",
          payload: {},
          read: false,
          createdAt: new Date().toISOString(),
        },
      });

      expect(friendsManager.notifications.length).toBe(1);
      expect(friendsManager.unreadCount).toBe(4);
    });

    it("should mark notifications as read over WebSocket", async () => {
      friendsManager.notifications = [
        {
          id: "notif_abc",
          userId: "self",
          type: "system",
          payload: {},
          read: false,
          createdAt: new Date().toISOString(),
        },
      ];

      await friendsManager.markNotificationRead("notif_abc");

      expect(friendsManager.notifications[0].read).toBe(true);
      expect(sentMessages.some((m) => m.type === "NOTIFICATIONS_MARK_READ" && m.payload.notificationId === "notif_abc")).toBe(true);

      await friendsManager.markAllNotificationsRead();
      expect(sentMessages.some((m) => m.type === "NOTIFICATIONS_MARK_READ" && m.payload.all === true)).toBe(true);
      expect(friendsManager.unreadCount).toBe(0);
    });
  });

  describe("Integration with SocialClient", () => {
    it("should synchronize room code on snapshot and dispatch social events", () => {
      const socialClient = new SocialClient({
        friends: friendsManager,
      });

      // Apply snapshot
      socialClient.applySnapshot({
        roomId: "room_1",
        roomCode: "SNAP99",
        roomName: "Snapshot Room",
        inviteUrl: "http://localhost/join/SNAP99",
        hostId: "u-host",
        version: 1,
        controlMode: "public",
        members: [],
        playback: {
          videoId: "vid_1",
          status: "playing",
          positionMs: 0,
          serverTimeMs: Date.now(),
          playbackRate: 1,
        },
        playlist: [],
        activePoll: null,
        chatHistory: [],
        storedReactions: [],
        bookmarks: [],
        readyCheck: null,
        selfUserId: "u-self",
        reconnectToken: "rec_1",
        serverTimeMs: Date.now(),
      });

      expect(friendsManager.currentRoomCode).toBe("SNAP99");

      // Handle presence update through SocialClient
      socialClient.handleServerMessage({
        type: "FRIEND_PRESENCE_UPDATE",
        payload: {
          userId: "u-alice",
          displayName: "Alice",
          status: "watching",
          activity: {
            roomCode: "SNAP99",
            roomName: "Snapshot Room",
            videoTitle: "vid_1",
          },
          lastSeenAt: Date.now(),
        },
      });

      expect(friendsManager.presences.get("u-alice")?.activity?.videoTitle).toBe("vid_1");
    });
  });
});
