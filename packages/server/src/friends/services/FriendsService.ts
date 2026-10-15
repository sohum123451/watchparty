import {
  Friendship,
  FriendshipStatus,
  PresencePrivacy,
  ServerMessage,
  RoomInvite,
  FriendActivityItem,
} from "@watchparty/shared";
import { IFriendsRepository } from "../db/FriendsRepository.js";
import { INotificationRepository } from "../db/NotificationRepository.js";
import { IAuthRepository } from "../../auth/db/AuthRepository.js";
import { PresenceService } from "./PresenceService.js";
import { RateLimiterService } from "../../auth/services/RateLimiterService.js";
import type { WebPushService } from "../../push/WebPushService.js";
import type { RoomManager } from "../../rooms/RoomManager.js";

export interface SendFriendRequestInput {
  fromUserId: string;
  email?: string;
  username?: string;
  friendCode?: string;
  clientIp?: string;
}

export interface SendFriendRequestResult {
  success: boolean;
  status?: FriendshipStatus;
  message: string;
  friendshipId?: string;
}

export class FriendsService {
  private friendsRepo: IFriendsRepository;
  private notificationRepo: INotificationRepository;
  private authRepo: IAuthRepository;
  private presenceService: PresenceService;
  private rateLimiter: RateLimiterService;
  private pushService?: WebPushService;

  constructor(options: {
    friendsRepo: IFriendsRepository;
    notificationRepo: INotificationRepository;
    authRepo: IAuthRepository;
    presenceService: PresenceService;
    rateLimiter?: RateLimiterService;
    pushService?: WebPushService;
  }) {
    this.friendsRepo = options.friendsRepo;
    this.notificationRepo = options.notificationRepo;
    this.authRepo = options.authRepo;
    this.presenceService = options.presenceService;
    this.rateLimiter = options.rateLimiter || new RateLimiterService();
    this.pushService = options.pushService;
  }

  public setPushService(pushService: WebPushService): void {
    this.pushService = pushService;
  }

  public getFriendsRepo(): IFriendsRepository {
    return this.friendsRepo;
  }

  public getNotificationRepo(): INotificationRepository {
    return this.notificationRepo;
  }

  public getPresenceService(): PresenceService {
    return this.presenceService;
  }

  /**
   * Sends a friend request by email, username, or friend code.
   * Auto-resolves mutual requests to 'accepted'.
   * Enforces zero email enumeration and rate-limits lookups.
   */
  public async sendFriendRequest(input: SendFriendRequestInput): Promise<SendFriendRequestResult> {
    const requester = await this.authRepo.findUserById(input.fromUserId);
    if (!requester) {
      const err: any = new Error("Requester user not found");
      err.status = 404;
      throw err;
    }

    // Email verification check: unverified users cannot add friends
    if (!requester.emailVerifiedAt) {
      const err: any = new Error("Please verify your email address to add friends");
      err.status = 403;
      throw err;
    }

    // Rate limiting check
    const rateLimitKey = `friends:req:${input.fromUserId}`;
    const rateCheck = this.rateLimiter.check(rateLimitKey);
    if (!rateCheck.allowed) {
      const err: any = new Error(`Too many friend requests. Please wait ${rateCheck.retryAfterSeconds} seconds.`);
      err.status = 429;
      throw err;
    }

    let targetUser: any = null;
    const isEmailLookup = Boolean(input.email);

    if (input.email) {
      const normalizedEmail = input.email.toLowerCase().trim();
      targetUser = await this.authRepo.findUserByEmail(normalizedEmail);
      if (!targetUser) {
        // ANTI-ENUMERATION: Return identical success response for non-existent email
        return {
          success: true,
          message: "If an account with that email exists, a friend request has been sent.",
        };
      }
    } else if (input.friendCode) {
      targetUser = await this.authRepo.findUserByFriendCode(input.friendCode);
      if (!targetUser) {
        const err: any = new Error("User with that friend code not found");
        err.status = 404;
        throw err;
      }
    } else if (input.username) {
      targetUser = await this.authRepo.findUserByUsername(input.username);
      if (!targetUser) {
        const err: any = new Error("User with that username not found");
        err.status = 404;
        throw err;
      }
    } else {
      const err: any = new Error("Target email, username, or friend code must be provided");
      err.status = 400;
      throw err;
    }

    // Cannot add self
    if (targetUser.id === requester.id) {
      const err: any = new Error("Cannot add yourself as a friend");
      err.status = 400;
      throw err;
    }

    // Check relationship
    const relationship = await this.friendsRepo.getRelationship(requester.id, targetUser.id);

    if (relationship) {
      // 1. Check if blocked
      if (relationship.status === "blocked") {
        if (relationship.blockedBy === requester.id) {
          const err: any = new Error("You have blocked this user. Unblock them first to send a friend request.");
          err.status = 400;
          throw err;
        } else {
          // Target blocked requester: if email lookup, return generic message without leakage
          if (isEmailLookup) {
            return {
              success: true,
              message: "If an account with that email exists, a friend request has been sent.",
            };
          }
          const err: any = new Error("Unable to send friend request to this user");
          err.status = 400;
          throw err;
        }
      }

      // 2. Check if already friends
      if (relationship.status === "accepted") {
        return {
          success: true,
          status: "accepted",
          message: "You are already friends.",
          friendshipId: relationship.id,
        };
      }

      // 3. Check pending requests
      if (relationship.status === "pending") {
        // If requester is already the requester, duplicate request
        if (relationship.requesterId === requester.id) {
          return {
            success: true,
            status: "pending",
            message: "Friend request already pending.",
            friendshipId: relationship.id,
          };
        }

        // MUTUAL REQUEST RESOLUTION: Target already sent a request to requester!
        // Two people sending requests to each other auto-resolves to accepted!
        const updated = await this.friendsRepo.createOrUpdateFriendship({
          user1Id: relationship.user1Id,
          user2Id: relationship.user2Id,
          requesterId: relationship.requesterId,
          addresseeId: relationship.addresseeId,
          status: "accepted",
        });

        // Persist notifications for both users
        await this.notificationRepo.createNotification({
          userId: targetUser.id,
          type: "friend_request_accepted",
          actorId: requester.id,
          actorName: requester.displayName,
          payload: { friendshipId: updated.id },
        });

        await this.notificationRepo.createNotification({
          userId: requester.id,
          type: "friend_request_accepted",
          actorId: targetUser.id,
          actorName: targetUser.displayName,
          payload: { friendshipId: updated.id },
        });

        // Push real-time WS events
        this.presenceService.sendToUser(targetUser.id, {
          type: "FRIEND_REQUEST_ACCEPTED",
          payload: {
            id: updated.id,
            friend: {
              id: requester.id,
              displayName: requester.displayName,
              username: requester.username || undefined,
              friendCode: requester.friendCode,
              avatar: requester.avatar,
            },
          },
        });

        this.presenceService.sendToUser(requester.id, {
          type: "FRIEND_REQUEST_ACCEPTED",
          payload: {
            id: updated.id,
            friend: {
              id: targetUser.id,
              displayName: targetUser.displayName,
              username: targetUser.username || undefined,
              friendCode: targetUser.friendCode,
              avatar: targetUser.avatar,
            },
          },
        });

        // Fan out mutual presence
        await this.presenceService.broadcastPresenceToFriends(requester.id);
        await this.presenceService.broadcastPresenceToFriends(targetUser.id);

        return {
          success: true,
          status: "accepted",
          message: "Friend request accepted! You are now friends.",
          friendshipId: updated.id,
        };
      }
    }

    // Normal case: Create pending friend request
    const newFriendship = await this.friendsRepo.createOrUpdateFriendship({
      user1Id: requester.id,
      user2Id: targetUser.id,
      requesterId: requester.id,
      addresseeId: targetUser.id,
      status: "pending",
    });

    // Create persistent notification for target
    const notif = await this.notificationRepo.createNotification({
      userId: targetUser.id,
      type: "friend_request_received",
      actorId: requester.id,
      actorName: requester.displayName,
      payload: {
        friendshipId: newFriendship.id,
        fromUserId: requester.id,
        fromDisplayName: requester.displayName,
        fromUsername: requester.username,
        friendCode: requester.friendCode,
      },
    });

    // Real-time push to target user if online
    this.presenceService.sendToUser(targetUser.id, {
      type: "FRIEND_REQUEST_RECEIVED",
      payload: {
        id: newFriendship.id,
        fromUserId: requester.id,
        fromDisplayName: requester.displayName,
        fromUsername: requester.username || undefined,
        friendCode: requester.friendCode,
        createdAt: newFriendship.createdAt.toISOString(),
      },
    });

    const unread = await this.notificationRepo.getUnreadCount(targetUser.id);
    this.presenceService.sendToUser(targetUser.id, {
      type: "NOTIFICATIONS_COUNT",
      payload: { unreadCount: unread },
    });

    // Web Push notification to recipient
    if (this.pushService) {
      this.pushService
        .sendFriendRequestNotification(targetUser.id, {
          id: requester.id,
          displayName: requester.displayName,
        })
        .catch((err) => console.warn("[FriendsService] Push notification failed:", err));
    }

    return {
      success: true,
      status: "pending",
      message: isEmailLookup
        ? "If an account with that email exists, a friend request has been sent."
        : "Friend request sent.",
      friendshipId: newFriendship.id,
    };
  }

  /**
   * Accepts a pending friend request.
   * Authorization check: only the addressee can accept.
   */
  public async acceptFriendRequest(userId: string, friendshipId: string): Promise<Friendship> {
    const user = await this.authRepo.findUserById(userId);
    if (!user?.emailVerifiedAt) {
      const err: any = new Error("Please verify your email address to add friends");
      err.status = 403;
      throw err;
    }

    const row = await this.friendsRepo.findFriendshipById(friendshipId);
    if (!row) {
      const err: any = new Error("Friend request not found");
      err.status = 404;
      throw err;
    }

    // Authorization check
    if (row.addresseeId !== userId) {
      const err: any = new Error("You are not authorized to accept this friend request");
      err.status = 403;
      throw err;
    }

    if (row.status !== "pending") {
      const err: any = new Error(`Cannot accept request in '${row.status}' status`);
      err.status = 400;
      throw err;
    }

    const updated = await this.friendsRepo.createOrUpdateFriendship({
      user1Id: row.user1Id,
      user2Id: row.user2Id,
      requesterId: row.requesterId,
      addresseeId: row.addresseeId,
      status: "accepted",
    });

    const requester = await this.authRepo.findUserById(row.requesterId);

    // Persist notification for original requester
    await this.notificationRepo.createNotification({
      userId: row.requesterId,
      type: "friend_request_accepted",
      actorId: user.id,
      actorName: user.displayName,
      payload: { friendshipId: updated.id },
    });

    // Real-time push to requester
    this.presenceService.sendToUser(row.requesterId, {
      type: "FRIEND_REQUEST_ACCEPTED",
      payload: {
        id: updated.id,
        friend: {
          id: user.id,
          displayName: user.displayName,
          username: user.username || undefined,
          friendCode: user.friendCode,
          avatar: user.avatar,
        },
      },
    });

    const unread = await this.notificationRepo.getUnreadCount(row.requesterId);
    this.presenceService.sendToUser(row.requesterId, {
      type: "NOTIFICATIONS_COUNT",
      payload: { unreadCount: unread },
    });

    // Fan-out mutual presence
    await this.presenceService.broadcastPresenceToFriends(userId);
    await this.presenceService.broadcastPresenceToFriends(row.requesterId);

    return {
      id: updated.id,
      user1Id: updated.user1Id,
      user2Id: updated.user2Id,
      requesterId: updated.requesterId,
      addresseeId: updated.addresseeId,
      status: "accepted",
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      friend: requester
        ? {
            id: requester.id,
            displayName: requester.displayName,
            username: requester.username || undefined,
            friendCode: requester.friendCode,
            avatar: requester.avatar,
            presencePrivacy: requester.presencePrivacy as PresencePrivacy,
          }
        : undefined,
    };
  }

  /**
   * Declines a pending friend request.
   * Authorization check: only the addressee can decline.
   */
  public async declineFriendRequest(userId: string, friendshipId: string): Promise<boolean> {
    const row = await this.friendsRepo.findFriendshipById(friendshipId);
    if (!row) {
      const err: any = new Error("Friend request not found");
      err.status = 404;
      throw err;
    }

    if (row.addresseeId !== userId) {
      const err: any = new Error("You are not authorized to decline this friend request");
      err.status = 403;
      throw err;
    }

    return this.friendsRepo.deleteFriendship(friendshipId);
  }

  /**
   * Cancels a pending friend request.
   * Authorization check: only the requester can cancel.
   */
  public async cancelFriendRequest(userId: string, friendshipId: string): Promise<boolean> {
    const row = await this.friendsRepo.findFriendshipById(friendshipId);
    if (!row) {
      const err: any = new Error("Friend request not found");
      err.status = 404;
      throw err;
    }

    if (row.requesterId !== userId) {
      const err: any = new Error("You are not authorized to cancel this friend request");
      err.status = 403;
      throw err;
    }

    return this.friendsRepo.deleteFriendship(friendshipId);
  }

  /**
   * Removes an accepted friend (unfriend).
   */
  public async removeFriend(userId: string, friendId: string): Promise<boolean> {
    const relationship = await this.friendsRepo.getRelationship(userId, friendId);
    if (!relationship || relationship.status !== "accepted") {
      const err: any = new Error("Friendship not found");
      err.status = 404;
      throw err;
    }

    const deleted = await this.friendsRepo.deleteFriendship(relationship.id);
    if (deleted) {
      // Fan-out offline to both to sever presence view
      await this.presenceService.broadcastPresenceToFriends(userId, "offline");
      await this.presenceService.broadcastPresenceToFriends(friendId, "offline");
    }
    return deleted;
  }

  /**
   * Blocks a user. Removes any existing friendship, hides presence, and prevents search/invites.
   */
  public async blockUser(userId: string, targetUserId: string): Promise<boolean> {
    if (userId === targetUserId) {
      const err: any = new Error("Cannot block yourself");
      err.status = 400;
      throw err;
    }

    await this.friendsRepo.createOrUpdateFriendship({
      user1Id: userId,
      user2Id: targetUserId,
      requesterId: userId,
      addresseeId: targetUserId,
      status: "blocked",
      blockedBy: userId,
    });

    // Notify presence service: send offline presence update to hide status
    this.presenceService.sendToUser(targetUserId, {
      type: "FRIEND_PRESENCE_UPDATE",
      payload: {
        userId,
        displayName: "",
        status: "offline",
        lastSeenAt: 0,
      },
    });

    return true;
  }

  /**
   * Unblocks a user. Only the user who placed the block can unblock.
   */
  public async unblockUser(userId: string, targetUserId: string): Promise<boolean> {
    const relationship = await this.friendsRepo.getRelationship(userId, targetUserId);
    if (!relationship) return true;

    if (relationship.status !== "blocked") {
      return true;
    }

    // Authorization check
    if (relationship.blockedBy !== userId) {
      const err: any = new Error("You cannot unblock this user");
      err.status = 403;
      throw err;
    }

    return this.friendsRepo.deleteFriendship(relationship.id);
  }

  /**
   * Retrieves user's friends list categorized by status.
   */
  public async getFriendsList(userId: string) {
    const rawList = await this.friendsRepo.getUserFriendships(userId);
    const friends: Friendship[] = [];
    const incomingRequests: Friendship[] = [];
    const outgoingRequests: Friendship[] = [];
    const blockedUsers: Friendship[] = [];

    for (const f of rawList) {
      const otherId = f.user1Id === userId ? f.user2Id : f.user1Id;
      const otherUser = await this.authRepo.findUserById(otherId);

      const item: Friendship = {
        id: f.id,
        user1Id: f.user1Id,
        user2Id: f.user2Id,
        requesterId: f.requesterId,
        addresseeId: f.addresseeId,
        status: f.status as FriendshipStatus,
        blockedBy: f.blockedBy,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
        friend: otherUser
          ? {
              id: otherUser.id,
              displayName: otherUser.displayName,
              username: otherUser.username || undefined,
              friendCode: otherUser.friendCode,
              avatar: otherUser.avatar,
              presencePrivacy: otherUser.presencePrivacy as PresencePrivacy,
            }
          : undefined,
      };

      if (f.status === "accepted") {
        friends.push(item);
      } else if (f.status === "pending") {
        if (f.addresseeId === userId) {
          incomingRequests.push(item);
        } else {
          outgoingRequests.push(item);
        }
      } else if (f.status === "blocked" && f.blockedBy === userId) {
        blockedUsers.push(item);
      }
    }

    return {
      friends,
      incomingRequests,
      outgoingRequests,
      blockedUsers,
    };
  }

  /**
   * Searches users by username or friend code.
   * Prohibits email lookup to prevent enumeration.
   * Excludes blocked relationships.
   */
  public async searchUsers(searcherId: string, query: string, clientIp?: string) {
    // Rate limit lookups
    const rateKey = `friends:search:${searcherId || clientIp || "anon"}`;
    const rateCheck = this.rateLimiter.check(rateKey);
    if (!rateCheck.allowed) {
      const err: any = new Error(`Search rate limit reached. Please wait ${rateCheck.retryAfterSeconds} seconds.`);
      err.status = 429;
      throw err;
    }

    const trimmed = query.trim();
    if (trimmed.includes("@")) {
      const err: any = new Error(
        "Searching by email is not permitted to protect user privacy. Please search by username or friend code, or send a friend request directly using their email address."
      );
      err.status = 400;
      throw err;
    }

    const users = await this.authRepo.searchUsers(trimmed, 20);
    const results = [];

    for (const u of users) {
      if (u.id === searcherId) continue;

      const relationship = await this.friendsRepo.getRelationship(searcherId, u.id);
      if (relationship && relationship.status === "blocked") {
        // Hide blocked users from search completely
        continue;
      }

      results.push({
        id: u.id,
        displayName: u.displayName,
        username: u.username,
        friendCode: u.friendCode,
        avatar: u.avatar,
        relationshipStatus: relationship ? relationship.status : "none",
        isRequester: relationship ? relationship.requesterId === searcherId : false,
      });
    }

    return results;
  }

  /**
   * Invites a friend to the current room.
   */
  public async sendRoomInvite(data: {
    fromUserId: string;
    toUserId: string;
    roomCode: string;
    roomName: string;
    videoTitle?: string;
  }): Promise<RoomInvite> {
    const sender = await this.authRepo.findUserById(data.fromUserId);
    if (!sender) {
      const err: any = new Error("Sender not found");
      err.status = 404;
      throw err;
    }

    // Must be accepted friends
    const rel = await this.friendsRepo.getRelationship(data.fromUserId, data.toUserId);
    if (!rel || rel.status !== "accepted") {
      const err: any = new Error("You can only invite accepted friends to rooms");
      err.status = 403;
      throw err;
    }

    const invite: RoomInvite = {
      inviteId: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      fromUserId: sender.id,
      fromDisplayName: sender.displayName,
      roomCode: data.roomCode,
      roomName: data.roomName,
      videoTitle: data.videoTitle,
      createdAt: Date.now(),
    };

    // Create persistent notification for recipient
    await this.notificationRepo.createNotification({
      userId: data.toUserId,
      type: "room_invite",
      actorId: sender.id,
      actorName: sender.displayName,
      payload: invite,
    });

    // Send real-time WS message
    this.presenceService.sendToUser(data.toUserId, {
      type: "ROOM_INVITE_RECEIVED",
      payload: invite,
    });

    const unread = await this.notificationRepo.getUnreadCount(data.toUserId);
    this.presenceService.sendToUser(data.toUserId, {
      type: "NOTIFICATIONS_COUNT",
      payload: { unreadCount: unread },
    });

    // Web Push notification to invited friend
    if (this.pushService) {
      this.pushService
        .sendPartyInviteNotification(
          data.toUserId,
          { id: sender.id, displayName: sender.displayName },
          { code: data.roomCode, name: data.roomName, videoTitle: data.videoTitle }
        )
        .catch((err) => console.warn("[FriendsService] Push invite failed:", err));
    }

    return invite;
  }

  /**
   * Broadcasts a Web Push notification to all accepted friends that a user started a watch party.
   */
  public async notifyFriendsPartyStarted(
    userId: string,
    room: { code: string; name: string; videoTitle?: string }
  ): Promise<number> {
    const user = await this.authRepo.findUserById(userId);
    if (!user) return 0;
    const { friends } = await this.getFriendsList(userId);
    let count = 0;
    for (const item of friends) {
      if (item.friend && this.pushService) {
        this.pushService
          .sendPartyStartedNotification(
            item.friend.id,
            { id: user.id, displayName: user.displayName },
            room
          )
          .catch((err) => console.warn("[FriendsService] Push party started failed:", err));
        count++;
      }
    }
    return count;
  }

  /**
   * Generates a live activity summary of active watch parties where friends are participating.
   * e.g., "Sam and Priya are watching Big Buck Bunny, join"
   */
  public async getFriendsActivity(
    userId: string,
    roomManager: RoomManager
  ): Promise<FriendActivityItem[]> {
    const { friends } = await this.getFriendsList(userId);
    if (!friends || friends.length === 0) {
      return [];
    }

    const friendMap = new Map<string, { id: string; displayName: string; avatar?: string }>();
    for (const item of friends) {
      if (item.friend && item.friend.presencePrivacy !== "nobody") {
        friendMap.set(item.friend.id, {
          id: item.friend.id,
          displayName: item.friend.displayName,
          avatar: item.friend.avatar || undefined,
        });
      }
    }

    const activityList: FriendActivityItem[] = [];
    const rooms = roomManager.getAllRooms();

    for (const room of rooms) {
      const activeMembers = room.getAllMembers().filter((m) => m.isConnected);
      const friendsInRoom: Array<{ userId: string; displayName: string; avatarUrl?: string }> = [];

      for (const member of activeMembers) {
        // Exclude self from friends list
        if (member.userId === userId || member.accountId === userId) continue;

        const matchedFriend =
          (member.accountId && friendMap.get(member.accountId)) ||
          friendMap.get(member.userId);

        if (matchedFriend && !friendsInRoom.some((f) => f.userId === matchedFriend.id)) {
          friendsInRoom.push({
            userId: matchedFriend.id,
            displayName: matchedFriend.displayName,
            avatarUrl: matchedFriend.avatar,
          });
        }
      }

      if (friendsInRoom.length > 0) {
        activityList.push({
          roomId: room.roomId,
          roomCode: room.roomCode,
          roomName: room.roomName,
          isHomeRoom: room.isHomeRoom,
          sourceTitle: room.playback.title || room.playback.videoId,
          videoId: room.playback.videoId,
          memberCount: activeMembers.length,
          friendParticipants: friendsInRoom,
        });
      }
    }

    return activityList;
  }

  /**
   * Updates presence privacy setting ('everyone' | 'friends' | 'nobody').
   */
  public async updatePresencePrivacy(userId: string, privacy: PresencePrivacy): Promise<void> {
    await this.authRepo.updateUser(userId, { presencePrivacy: privacy });
    await this.presenceService.setPrivacy(userId, privacy);
  }
}
