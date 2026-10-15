import webpush from "web-push";
import type { PushPreferences, PushSubscriptionData } from "@watchparty/shared";

export type PushNotificationType =
  | "partyStarted"
  | "partyInvite"
  | "friendRequest"
  | "party10mReminder";

export interface PushMessagePayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  data?: Record<string, any>;
}

export interface SendPushResult {
  sent: number;
  failed: number;
  suppressedReason?: "disabled" | "type_disabled" | "quiet_hours" | "no_subscriptions";
}

export class WebPushService {
  private publicKey: string;
  private privateKey: string;
  private contactEmail: string;

  // Subscriptions per userId (each user can have multiple devices/browsers)
  private userSubscriptions: Map<string, Map<string, PushSubscriptionData>> = new Map();

  // Notification preferences per userId
  private userPreferences: Map<string, PushPreferences> = new Map();

  constructor(options?: {
    publicKey?: string;
    privateKey?: string;
    contactEmail?: string;
  }) {
    this.contactEmail = options?.contactEmail || process.env.VAPID_CONTACT_EMAIL || "mailto:admin@watchparty.internal";

    if (options?.publicKey && options?.privateKey) {
      this.publicKey = options.publicKey;
      this.privateKey = options.privateKey;
    } else if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      this.publicKey = process.env.VAPID_PUBLIC_KEY;
      this.privateKey = process.env.VAPID_PRIVATE_KEY;
    } else {
      // Auto-generate standards-compliant P-256 ECDSA VAPID keys for zero-ops deployment
      const keys = webpush.generateVAPIDKeys();
      this.publicKey = keys.publicKey;
      this.privateKey = keys.privateKey;
    }

    try {
      webpush.setVapidDetails(this.contactEmail, this.publicKey, this.privateKey);
    } catch (err) {
      console.warn("[WebPushService] Failed to set VAPID details:", err);
    }
  }

  public getPublicKey(): string {
    return this.publicKey;
  }

  public getDefaultPreferences(): PushPreferences {
    return {
      enabled: true,
      partyStarted: true,
      partyInvite: true,
      friendRequest: true,
      party10mReminder: true,
      quietHoursEnabled: false,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
      timezoneOffsetMinutes: 0,
    };
  }

  public getPreferences(userId: string): PushPreferences {
    const existing = this.userPreferences.get(userId);
    if (existing) {
      return { ...existing };
    }
    const def = this.getDefaultPreferences();
    this.userPreferences.set(userId, { ...def });
    return def;
  }

  public updatePreferences(userId: string, update: Partial<PushPreferences>): PushPreferences {
    const current = this.getPreferences(userId);
    const updated: PushPreferences = {
      ...current,
      ...update,
    };
    this.userPreferences.set(userId, updated);
    return { ...updated };
  }

  public subscribe(userId: string, subscription: PushSubscriptionData): void {
    if (!subscription || !subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new Error("Invalid push subscription structure");
    }
    let subs = this.userSubscriptions.get(userId);
    if (!subs) {
      subs = new Map();
      this.userSubscriptions.set(userId, subs);
    }
    subs.set(subscription.endpoint, subscription);
  }

  public unsubscribe(userId: string, endpoint: string): boolean {
    const subs = this.userSubscriptions.get(userId);
    if (subs) {
      const deleted = subs.delete(endpoint);
      if (subs.size === 0) {
        this.userSubscriptions.delete(userId);
      }
      return deleted;
    }
    return false;
  }

  public getSubscriptions(userId: string): PushSubscriptionData[] {
    const subs = this.userSubscriptions.get(userId);
    return subs ? Array.from(subs.values()) : [];
  }

  /**
   * Evaluates if the current moment falls within user-configured quiet hours.
   * Handles overnight intervals (e.g., 22:00 to 08:00) and client timezone offsets.
   */
  public isQuietHours(prefs: PushPreferences, now = new Date()): boolean {
    if (!prefs.quietHoursEnabled) {
      return false;
    }

    const startMinutes = this.parseTimeToMinutes(prefs.quietHoursStart);
    const endMinutes = this.parseTimeToMinutes(prefs.quietHoursEnd);
    if (startMinutes === null || endMinutes === null) {
      return false;
    }

    // Client local minutes calculation using timezone offset (e.g. -330 minutes for UTC+5:30)
    const clientOffsetMinutes = prefs.timezoneOffsetMinutes ?? 0;
    // Client local time = UTC time - offsetMinutes
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
    const clientMs = utcMs - clientOffsetMinutes * 60 * 1000;
    const clientDate = new Date(clientMs);
    const currentMinutes = clientDate.getHours() * 60 + clientDate.getMinutes();

    if (startMinutes <= endMinutes) {
      // Single day window (e.g., 13:00 to 17:00)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
      // Overnight window (e.g., 22:00 to 08:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
  }

  private parseTimeToMinutes(timeStr: string): number | null {
    if (!timeStr || typeof timeStr !== "string") return null;
    const parts = timeStr.trim().split(":");
    if (parts.length < 2) return null;
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }
    return hours * 60 + minutes;
  }

  /**
   * Dispatches a push notification respecting user preferences and quiet hours.
   */
  public async sendNotification(
    userId: string,
    type: PushNotificationType,
    payload: PushMessagePayload
  ): Promise<SendPushResult> {
    const prefs = this.getPreferences(userId);

    if (!prefs.enabled) {
      return { sent: 0, failed: 0, suppressedReason: "disabled" };
    }

    if (!prefs[type]) {
      return { sent: 0, failed: 0, suppressedReason: "type_disabled" };
    }

    if (this.isQuietHours(prefs)) {
      return { sent: 0, failed: 0, suppressedReason: "quiet_hours" };
    }

    const subs = this.userSubscriptions.get(userId);
    if (!subs || subs.size === 0) {
      return { sent: 0, failed: 0, suppressedReason: "no_subscriptions" };
    }

    let sent = 0;
    let failed = 0;
    const staleEndpoints: string[] = [];

    const stringifiedPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || "/app",
      icon: payload.icon || "/icon-192.svg",
      data: payload.data || {},
    });

    for (const [endpoint, sub] of subs.entries()) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth,
            },
          },
          stringifiedPayload,
          {
            TTL: 3600, // 1 hour TTL
            urgency: "high",
          }
        );
        sent++;
      } catch (err: any) {
        failed++;
        // If subscription is expired or unregistered (HTTP 404 or 410 Gone), prune it
        if (err.statusCode === 404 || err.statusCode === 410) {
          staleEndpoints.push(endpoint);
        }
      }
    }

    // Cleanup dead subscriptions
    for (const ep of staleEndpoints) {
      subs.delete(ep);
    }
    if (subs.size === 0) {
      this.userSubscriptions.delete(userId);
    }

    return { sent, failed };
  }

  public async sendFriendRequestNotification(
    targetUserId: string,
    fromUser: { id: string; displayName: string }
  ): Promise<SendPushResult> {
    return this.sendNotification(targetUserId, "friendRequest", {
      title: "New Friend Request",
      body: `${fromUser.displayName} sent you a friend request.`,
      url: "/app?tab=friends",
      data: { type: "friend_request", fromUserId: fromUser.id },
    });
  }

  public async sendPartyInviteNotification(
    targetUserId: string,
    fromUser: { id: string; displayName: string },
    room: { code: string; name: string; videoTitle?: string }
  ): Promise<SendPushResult> {
    const videoDesc = room.videoTitle ? ` to watch "${room.videoTitle}"` : "";
    return this.sendNotification(targetUserId, "partyInvite", {
      title: "Watch Party Invitation",
      body: `${fromUser.displayName} invited you${videoDesc} in "${room.name}"!`,
      url: `/join/${room.code}`,
      data: { type: "party_invite", roomCode: room.code },
    });
  }

  public async sendPartyStartedNotification(
    targetUserId: string,
    friend: { id: string; displayName: string },
    room: { code: string; name: string; videoTitle?: string }
  ): Promise<SendPushResult> {
    const videoDesc = room.videoTitle ? ` ("${room.videoTitle}")` : "";
    return this.sendNotification(targetUserId, "partyStarted", {
      title: "Friend Started a Party",
      body: `${friend.displayName} started a watch party in "${room.name}"${videoDesc}. Join now!`,
      url: `/join/${room.code}`,
      data: { type: "party_started", roomCode: room.code },
    });
  }

  public async sendParty10mReminderNotification(
    targetUserId: string,
    party: { id: string; title: string; roomCode?: string; scheduledStartTimeMs: number }
  ): Promise<SendPushResult> {
    const url = party.roomCode ? `/join/${party.roomCode}` : `/app?party=${party.id}`;
    return this.sendNotification(targetUserId, "party10mReminder", {
      title: "Party Starts in 10 Minutes!",
      body: `Your scheduled watch party "${party.title}" starts in 10 minutes. Get your snacks ready!`,
      url,
      data: { type: "party_10m_reminder", partyId: party.id, roomCode: party.roomCode },
    });
  }
}
