import {
  FriendPresence,
  Friendship,
  NotificationItem,
  PresencePrivacy,
  RoomInvite,
  ServerMessage,
  ClientMessage,
} from "@watchparty/shared";

export interface RoomInviteHandlerOptions {
  invite: RoomInvite;
  isCurrentlyInRoom: boolean;
  currentRoomCode?: string;
  accept: () => void;
  decline: () => void;
}

export type PresenceListener = (presences: FriendPresence[]) => void;
export type FriendsListListener = (friends: Friendship[]) => void;
export type RoomInviteListener = (options: RoomInviteHandlerOptions) => void;
export type NotificationsListener = (notifications: NotificationItem[], unreadCount: number) => void;

export interface FriendsManagerOptions {
  baseUrl?: string;
  accessToken?: string;
  wsSender?: (message: ClientMessage) => void;
  onJoinRoom?: (roomCode: string) => void;
  onLeaveRoom?: () => void;
}

export class FriendsManager {
  private baseUrl: string;
  private accessToken?: string;
  private wsSender?: (message: ClientMessage) => void;
  private onJoinRoom?: (roomCode: string) => void;
  private onLeaveRoom?: () => void;

  public currentRoomCode?: string;
  public presences: Map<string, FriendPresence> = new Map();
  public friends: Friendship[] = [];
  public incomingRequests: Friendship[] = [];
  public outgoingRequests: Friendship[] = [];
  public blockedUsers: Friendship[] = [];
  public notifications: NotificationItem[] = [];
  public unreadCount = 0;

  private presenceListeners: Set<PresenceListener> = new Set();
  private friendsListeners: Set<FriendsListListener> = new Set();
  private roomInviteListeners: Set<RoomInviteListener> = new Set();
  private notificationsListeners: Set<NotificationsListener> = new Set();

  constructor(options: FriendsManagerOptions = {}) {
    this.baseUrl = options.baseUrl || "http://localhost:3001";
    this.accessToken = options.accessToken;
    this.wsSender = options.wsSender;
    this.onJoinRoom = options.onJoinRoom;
    this.onLeaveRoom = options.onLeaveRoom;
  }

  public setAccessToken(token?: string): void {
    this.accessToken = token;
  }

  public setWsSender(sender: (message: ClientMessage) => void): void {
    this.wsSender = sender;
  }

  public setCurrentRoom(roomCode?: string): void {
    this.currentRoomCode = roomCode;
  }

  public onPresenceChange(listener: PresenceListener): () => void {
    this.presenceListeners.add(listener);
    return () => this.presenceListeners.delete(listener);
  }

  public onFriendsListChange(listener: FriendsListListener): () => void {
    this.friendsListeners.add(listener);
    return () => this.friendsListeners.delete(listener);
  }

  public onRoomInvite(listener: RoomInviteListener): () => void {
    this.roomInviteListeners.add(listener);
    return () => this.roomInviteListeners.delete(listener);
  }

  public onNotificationsChange(listener: NotificationsListener): () => void {
    this.notificationsListeners.add(listener);
    return () => this.notificationsListeners.delete(listener);
  }

  /**
   * Processes incoming WebSocket messages for social events.
   */
  public handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case "FRIEND_PRESENCE_SYNC": {
        this.presences.clear();
        for (const p of message.payload.presences) {
          this.presences.set(p.userId, p);
        }
        this.notifyPresence();
        break;
      }

      case "FRIEND_PRESENCE_UPDATE": {
        const p = message.payload;
        this.presences.set(p.userId, p);
        this.notifyPresence();
        break;
      }

      case "FRIEND_REQUEST_RECEIVED": {
        // Add to incoming requests
        const req: Friendship = {
          id: message.payload.id,
          user1Id: "",
          user2Id: "",
          requesterId: message.payload.fromUserId,
          addresseeId: "self",
          status: "pending",
          createdAt: message.payload.createdAt,
          updatedAt: message.payload.createdAt,
          friend: {
            id: message.payload.fromUserId,
            displayName: message.payload.fromDisplayName,
            username: message.payload.fromUsername,
            friendCode: message.payload.friendCode || "",
          },
        };
        this.incomingRequests = [req, ...this.incomingRequests.filter((r) => r.id !== req.id)];
        this.notifyFriends();
        break;
      }

      case "FRIEND_REQUEST_ACCEPTED": {
        // Add to friends and remove from outgoing/incoming
        const f: Friendship = {
          id: message.payload.id,
          user1Id: "",
          user2Id: "",
          requesterId: "self",
          addresseeId: message.payload.friend.id,
          status: "accepted",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          friend: message.payload.friend,
        };
        this.friends = [f, ...this.friends.filter((item) => item.friend?.id !== f.friend?.id)];
        this.incomingRequests = this.incomingRequests.filter((r) => r.friend?.id !== f.friend?.id);
        this.outgoingRequests = this.outgoingRequests.filter((r) => r.friend?.id !== f.friend?.id);
        this.notifyFriends();
        break;
      }

      case "ROOM_INVITE_RECEIVED": {
        const invite = message.payload;
        const isCurrentlyInRoom = Boolean(this.currentRoomCode);
        const currentRoomCode = this.currentRoomCode;

        for (const listener of this.roomInviteListeners) {
          listener({
            invite,
            isCurrentlyInRoom,
            currentRoomCode,
            accept: () => {
              if (isCurrentlyInRoom && this.onLeaveRoom) {
                this.onLeaveRoom();
              }
              if (this.onJoinRoom) {
                this.onJoinRoom(invite.roomCode);
              }
            },
            decline: () => {
              // Dismiss toast
            },
          });
        }
        break;
      }

      case "NOTIFICATION_CREATED": {
        this.notifications = [message.payload, ...this.notifications];
        this.unreadCount++;
        this.notifyNotifications();
        break;
      }

      case "NOTIFICATIONS_COUNT": {
        this.unreadCount = message.payload.unreadCount;
        this.notifyNotifications();
        break;
      }

      case "NOTIFICATIONS_SNAPSHOT": {
        this.notifications = message.payload.notifications;
        this.unreadCount = message.payload.unreadCount;
        this.notifyNotifications();
        break;
      }
    }
  }

  // ==========================================
  // HTTP / API ACTIONS
  // ==========================================

  private async apiFetch(endpoint: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(data.error || "API request failed");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  public async fetchFriendsList(): Promise<void> {
    const data = await this.apiFetch("/api/friends");
    this.friends = data.friends || [];
    this.incomingRequests = data.incomingRequests || [];
    this.outgoingRequests = data.outgoingRequests || [];
    this.blockedUsers = data.blockedUsers || [];
    this.notifyFriends();
  }

  public async sendFriendRequest(target: {
    email?: string;
    username?: string;
    friendCode?: string;
  }): Promise<{ success: boolean; message: string; status?: string }> {
    const res = await this.apiFetch("/api/friends/request", {
      method: "POST",
      body: JSON.stringify(target),
    });
    await this.fetchFriendsList();
    return res;
  }

  public async acceptFriendRequest(requestId: string): Promise<void> {
    await this.apiFetch(`/api/friends/requests/${requestId}/accept`, {
      method: "POST",
    });
    await this.fetchFriendsList();
  }

  public async declineFriendRequest(requestId: string): Promise<void> {
    await this.apiFetch(`/api/friends/requests/${requestId}/decline`, {
      method: "POST",
    });
    await this.fetchFriendsList();
  }

  public async cancelFriendRequest(requestId: string): Promise<void> {
    await this.apiFetch(`/api/friends/requests/${requestId}/cancel`, {
      method: "POST",
    });
    await this.fetchFriendsList();
  }

  public async removeFriend(friendId: string): Promise<void> {
    await this.apiFetch(`/api/friends/${friendId}`, {
      method: "DELETE",
    });
    this.presences.delete(friendId);
    await this.fetchFriendsList();
    this.notifyPresence();
  }

  public async blockUser(targetUserId: string): Promise<void> {
    await this.apiFetch(`/api/friends/${targetUserId}/block`, {
      method: "POST",
    });
    this.presences.delete(targetUserId);
    await this.fetchFriendsList();
    this.notifyPresence();
  }

  public async unblockUser(targetUserId: string): Promise<void> {
    await this.apiFetch(`/api/friends/${targetUserId}/unblock`, {
      method: "POST",
    });
    await this.fetchFriendsList();
  }

  public async searchUsers(query: string) {
    return this.apiFetch(`/api/friends/search?q=${encodeURIComponent(query)}`);
  }

  public async inviteFriendToRoom(friendUserId: string, roomCode?: string): Promise<RoomInvite> {
    const effectiveRoomCode = roomCode || this.currentRoomCode;
    if (!effectiveRoomCode) {
      throw new Error("Cannot send room invite: user is not in a room");
    }

    if (this.wsSender) {
      this.wsSender({
        type: "FRIEND_INVITE_SEND",
        payload: { friendUserId },
      });
      return {
        inviteId: `inv_${Date.now()}`,
        fromUserId: "self",
        fromDisplayName: "You",
        roomCode: effectiveRoomCode,
        roomName: "Room",
        createdAt: Date.now(),
      };
    }

    const data = await this.apiFetch("/api/friends/invite", {
      method: "POST",
      body: JSON.stringify({ friendUserId, roomCode: effectiveRoomCode }),
    });
    return data.invite;
  }

  /**
   * One-click "Join friend's room" action.
   */
  public joinFriendRoom(roomCode: string): void {
    if (this.currentRoomCode && this.currentRoomCode !== roomCode && this.onLeaveRoom) {
      this.onLeaveRoom();
    }
    if (this.onJoinRoom) {
      this.onJoinRoom(roomCode);
    }
  }

  public async setPresencePrivacy(privacy: PresencePrivacy): Promise<void> {
    await this.apiFetch("/api/friends/privacy", {
      method: "PUT",
      body: JSON.stringify({ presencePrivacy: privacy }),
    });
  }

  public async fetchNotifications(): Promise<void> {
    const data = await this.apiFetch("/api/notifications");
    this.notifications = data.notifications || [];
    this.unreadCount = data.unreadCount || 0;
    this.notifyNotifications();
  }

  public async markNotificationRead(id: string): Promise<void> {
    if (this.wsSender) {
      this.wsSender({
        type: "NOTIFICATIONS_MARK_READ",
        payload: { notificationId: id },
      });
    } else {
      const data = await this.apiFetch(`/api/notifications/${id}/read`, { method: "POST" });
      this.unreadCount = data.unreadCount ?? Math.max(0, this.unreadCount - 1);
    }

    for (const n of this.notifications) {
      if (n.id === id) n.read = true;
    }
    this.notifyNotifications();
  }

  public async markAllNotificationsRead(): Promise<void> {
    if (this.wsSender) {
      this.wsSender({
        type: "NOTIFICATIONS_MARK_READ",
        payload: { all: true },
      });
    } else {
      await this.apiFetch("/api/notifications/read-all", { method: "POST" });
    }

    for (const n of this.notifications) {
      n.read = true;
    }
    this.unreadCount = 0;
    this.notifyNotifications();
  }

  // ==========================================
  // NOTIFICATION DISPATCHERS
  // ==========================================

  private notifyPresence(): void {
    const list = Array.from(this.presences.values());
    for (const l of this.presenceListeners) {
      l(list);
    }
  }

  private notifyFriends(): void {
    for (const l of this.friendsListeners) {
      l([...this.friends]);
    }
  }

  private notifyNotifications(): void {
    for (const l of this.notificationsListeners) {
      l([...this.notifications], this.unreadCount);
    }
  }
}
