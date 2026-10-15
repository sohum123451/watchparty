import { WebSocket } from "ws";
import {
  FriendPresence,
  FriendPresenceStatus,
  PresencePrivacy,
  ServerMessage,
} from "@watchparty/shared";
import { IFriendsRepository } from "../db/FriendsRepository.js";
import { IAuthRepository } from "../../auth/db/AuthRepository.js";

export interface UserPresenceState {
  userId: string;
  displayName: string;
  username?: string;
  friendCode?: string;
  avatar?: string | null;
  status: FriendPresenceStatus;
  activity?: {
    roomCode: string;
    roomName: string;
    videoTitle?: string;
    isPublic?: boolean;
  };
  presencePrivacy: PresencePrivacy;
  lastSeenAt: number;
}

export class PresenceService {
  private userSockets: Map<string, Set<WebSocket>> = new Map();
  private presenceMap: Map<string, UserPresenceState> = new Map();
  private friendsRepo: IFriendsRepository;
  private authRepo: IAuthRepository;

  constructor(friendsRepo: IFriendsRepository, authRepo: IAuthRepository) {
    this.friendsRepo = friendsRepo;
    this.authRepo = authRepo;
  }

  /**
   * Registers an active authenticated WebSocket connection.
   */
  public async registerSocket(
    user: {
      id: string;
      displayName: string;
      username?: string;
      friendCode?: string;
      avatar?: string | null;
      presencePrivacy?: PresencePrivacy;
    },
    ws: WebSocket
  ): Promise<void> {
    const userId = user.id;
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(ws);

    let state = this.presenceMap.get(userId);
    if (!state) {
      state = {
        userId,
        displayName: user.displayName,
        username: user.username,
        friendCode: user.friendCode,
        avatar: user.avatar,
        status: "online",
        presencePrivacy: user.presencePrivacy || "friends",
        lastSeenAt: Date.now(),
      };
      this.presenceMap.set(userId, state);
    } else {
      if (state.status === "offline") {
        state.status = "online";
      }
      state.lastSeenAt = Date.now();
    }

    // Attach close listener to manage disconnects
    ws.once("close", () => {
      this.handleSocketClose(userId, ws);
    });

    // Send immediate sync of online friends to this connecting socket
    await this.sendFriendsPresenceSync(userId, ws);

    // Fan-out online presence to friends
    await this.broadcastPresenceToFriends(userId);
  }

  /**
   * Handles individual socket termination for a user.
   */
  private async handleSocketClose(userId: string, ws: WebSocket): Promise<void> {
    const socketSet = this.userSockets.get(userId);
    if (socketSet) {
      socketSet.delete(ws);
      if (socketSet.size === 0) {
        this.userSockets.delete(userId);
        const state = this.presenceMap.get(userId);
        if (state) {
          state.status = "offline";
          state.activity = undefined;
          state.lastSeenAt = Date.now();
          // Fan out offline presence to friends
          await this.broadcastPresenceToFriends(userId);
        }
      }
    }
  }

  /**
   * Sets room activity when a user joins or updates playback in a room.
   */
  public async setRoomActivity(
    userId: string,
    activity?: {
      roomCode: string;
      roomName: string;
      videoTitle?: string;
      isPublic?: boolean;
    }
  ): Promise<void> {
    let state = this.presenceMap.get(userId);
    if (!state) {
      const user = await this.authRepo.findUserById(userId);
      if (!user) return;
      state = {
        userId,
        displayName: user.displayName,
        username: user.username || undefined,
        friendCode: user.friendCode,
        avatar: user.avatar,
        status: activity ? "watching" : "online",
        activity,
        presencePrivacy: (user.presencePrivacy as PresencePrivacy) || "friends",
        lastSeenAt: Date.now(),
      };
      this.presenceMap.set(userId, state);
    } else {
      state.status = activity ? "watching" : "online";
      state.activity = activity;
      state.lastSeenAt = Date.now();
    }

    await this.broadcastPresenceToFriends(userId);
  }

  /**
   * Updates a user's privacy setting ('everyone' | 'friends' | 'nobody').
   */
  public async setPrivacy(userId: string, privacy: PresencePrivacy): Promise<void> {
    let state = this.presenceMap.get(userId);
    const oldPrivacy = state ? state.presencePrivacy : "friends";

    if (!state) {
      const user = await this.authRepo.findUserById(userId);
      if (user) {
        state = {
          userId,
          displayName: user.displayName,
          username: user.username || undefined,
          friendCode: user.friendCode,
          avatar: user.avatar,
          status: "online",
          presencePrivacy: privacy,
          lastSeenAt: Date.now(),
        };
        this.presenceMap.set(userId, state);
      }
    } else {
      state.presencePrivacy = privacy;
    }

    if (privacy === "nobody" && oldPrivacy !== "nobody") {
      // Broadcast offline immediately to hide presence
      await this.broadcastPresenceToFriends(userId, "offline");
    } else if (oldPrivacy === "nobody" && privacy !== "nobody") {
      // Broadcast active presence
      await this.broadcastPresenceToFriends(userId);
    }
  }

  /**
   * Broadcasts presence state to all accepted online friends.
   * Respects user's privacy setting and skips blocked users.
   */
  public async broadcastPresenceToFriends(
    userId: string,
    forcedStatus?: FriendPresenceStatus
  ): Promise<void> {
    const state = this.presenceMap.get(userId);
    if (!state) return;

    if (state.presencePrivacy === "nobody" && !forcedStatus) {
      // User is hidden; don't broadcast anything
      return;
    }

    const friendships = await this.friendsRepo.getUserFriendships(userId);
    const acceptedFriendIds: string[] = [];

    for (const f of friendships) {
      if (f.status === "accepted") {
        const friendId = f.user1Id === userId ? f.user2Id : f.user1Id;
        acceptedFriendIds.push(friendId);
      }
    }

    if (acceptedFriendIds.length === 0) return;

    const payload: FriendPresence = {
      userId: state.userId,
      displayName: state.displayName,
      username: state.username,
      friendCode: state.friendCode,
      avatar: state.avatar,
      status: forcedStatus || (state.presencePrivacy === "nobody" ? "offline" : state.status),
      activity: forcedStatus === "offline" || state.presencePrivacy === "nobody" ? undefined : state.activity,
      lastSeenAt: state.lastSeenAt,
    };

    const message: ServerMessage = {
      type: "FRIEND_PRESENCE_UPDATE",
      payload,
    };

    this.broadcastToUsers(acceptedFriendIds, message);
  }

  /**
   * Sends initial sync of all online accepted friends to a user's connection.
   */
  public async sendFriendsPresenceSync(userId: string, targetWs?: WebSocket): Promise<void> {
    const friendships = await this.friendsRepo.getUserFriendships(userId);
    const presences: FriendPresence[] = [];

    for (const f of friendships) {
      if (f.status === "accepted") {
        const friendId = f.user1Id === userId ? f.user2Id : f.user1Id;
        const friendState = this.presenceMap.get(friendId);

        if (friendState) {
          if (friendState.presencePrivacy === "nobody") {
            // Friend chose nobody; report offline
            presences.push({
              userId: friendState.userId,
              displayName: friendState.displayName,
              username: friendState.username,
              friendCode: friendState.friendCode,
              avatar: friendState.avatar,
              status: "offline",
              lastSeenAt: friendState.lastSeenAt,
            });
          } else {
            presences.push({
              userId: friendState.userId,
              displayName: friendState.displayName,
              username: friendState.username,
              friendCode: friendState.friendCode,
              avatar: friendState.avatar,
              status: friendState.status,
              activity: friendState.activity,
              lastSeenAt: friendState.lastSeenAt,
            });
          }
        } else {
          // Look up user details for offline presence entry
          const u = await this.authRepo.findUserById(friendId);
          if (u) {
            presences.push({
              userId: u.id,
              displayName: u.displayName,
              username: u.username || undefined,
              friendCode: u.friendCode,
              avatar: u.avatar,
              status: "offline",
              lastSeenAt: 0,
            });
          }
        }
      }
    }

    const message: ServerMessage = {
      type: "FRIEND_PRESENCE_SYNC",
      payload: { presences },
    };

    if (targetWs) {
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify(message));
      }
    } else {
      this.sendToUser(userId, message);
    }
  }

  /**
   * Sends a message to all active sockets of a target user.
   */
  public sendToUser(userId: string, message: ServerMessage): number {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return 0;

    let sent = 0;
    const serialized = JSON.stringify(message);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(serialized);
        sent++;
      }
    }
    return sent;
  }

  /**
   * High-performance fan-out of a message to multiple users.
   */
  public broadcastToUsers(userIds: string[], message: ServerMessage): number {
    if (userIds.length === 0) return 0;
    let totalSent = 0;
    const serialized = JSON.stringify(message);

    for (const uid of userIds) {
      const sockets = this.userSockets.get(uid);
      if (sockets) {
        for (const ws of sockets) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(serialized);
            totalSent++;
          }
        }
      }
    }
    return totalSent;
  }

  /**
   * Gets current presence state of a user.
   */
  public getUserPresence(userId: string): UserPresenceState | null {
    return this.presenceMap.get(userId) || null;
  }

  public isUserOnline(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return Boolean(sockets && sockets.size > 0);
  }

  public clear(): void {
    this.userSockets.clear();
    this.presenceMap.clear();
  }
}
