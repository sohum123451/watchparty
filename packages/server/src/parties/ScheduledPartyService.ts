import crypto from "node:crypto";
import type { ScheduledParty, PartyRsvpStatus } from "@watchparty/shared";
import type { RoomManager } from "../rooms/RoomManager.js";
import type { WebPushService } from "../push/WebPushService.js";

export interface CreatePartyParams {
  creatorUserId: string;
  creatorDisplayName: string;
  title: string;
  description?: string;
  scheduledStartTimeMs: number;
  scheduledEndTimeMs?: number;
  sourceUrl?: string;
  sourceTitle?: string;
  invitedUserIds?: string[];
  roomId?: string;
  roomCode?: string;
  isHomeRoom?: boolean;
}

export class ScheduledPartyService {
  private parties: Map<string, ScheduledParty> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private roomManager?: RoomManager;
  private pushService?: WebPushService;
  private baseUrl: string;

  constructor(options?: {
    roomManager?: RoomManager;
    pushService?: WebPushService;
    baseUrl?: string;
  }) {
    this.roomManager = options?.roomManager;
    this.pushService = options?.pushService;
    this.baseUrl = options?.baseUrl || "http://localhost:3001";
  }

  public setRoomManager(roomManager: RoomManager): void {
    this.roomManager = roomManager;
  }

  public setPushService(pushService: WebPushService): void {
    this.pushService = pushService;
  }

  public startSchedulerLoop(intervalMs = 15000): void {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(() => {
      this.checkUpcomingParties().catch((err) => {
        console.warn("[ScheduledPartyService] Error in scheduler tick:", err);
      });
    }, intervalMs);
    // Unref so timer doesn't prevent Node process exit
    if (this.checkInterval.unref) {
      this.checkInterval.unref();
    }
  }

  public stopSchedulerLoop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  public createParty(params: CreatePartyParams): ScheduledParty {
    const id = `party_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const roomCode = params.roomCode || `p-${crypto.randomBytes(3).toString("hex")}`;
    const rsvps: Record<string, PartyRsvpStatus> = {
      [params.creatorUserId]: "attending",
    };

    const party: ScheduledParty = {
      id,
      title: params.title.trim(),
      description: params.description?.trim(),
      creatorUserId: params.creatorUserId,
      creatorDisplayName: params.creatorDisplayName,
      scheduledStartTimeMs: params.scheduledStartTimeMs,
      scheduledEndTimeMs: params.scheduledEndTimeMs || params.scheduledStartTimeMs + 2 * 60 * 60 * 1000,
      sourceUrl: params.sourceUrl,
      sourceTitle: params.sourceTitle,
      roomId: params.roomId,
      roomCode,
      isHomeRoom: Boolean(params.isHomeRoom),
      invitedUserIds: params.invitedUserIds || [],
      rsvps,
      reminded10m: false,
      roomOpened: false,
      createdAt: Date.now(),
    };

    this.parties.set(id, party);
    return { ...party, rsvps: { ...party.rsvps }, invitedUserIds: [...party.invitedUserIds] };
  }

  public getParty(id: string): ScheduledParty | null {
    const party = this.parties.get(id);
    if (!party) return null;
    return { ...party, rsvps: { ...party.rsvps }, invitedUserIds: [...party.invitedUserIds] };
  }

  public getUserParties(userId: string): ScheduledParty[] {
    const results: ScheduledParty[] = [];
    for (const party of this.parties.values()) {
      if (
        party.creatorUserId === userId ||
        party.invitedUserIds.includes(userId) ||
        party.rsvps[userId] !== undefined
      ) {
        results.push({ ...party, rsvps: { ...party.rsvps }, invitedUserIds: [...party.invitedUserIds] });
      }
    }
    return results.sort((a, b) => a.scheduledStartTimeMs - b.scheduledStartTimeMs);
  }

  public setRsvp(partyId: string, userId: string, status: PartyRsvpStatus): ScheduledParty {
    const party = this.parties.get(partyId);
    if (!party) {
      throw new Error("Scheduled party not found");
    }
    party.rsvps[userId] = status;
    return { ...party, rsvps: { ...party.rsvps }, invitedUserIds: [...party.invitedUserIds] };
  }

  /**
   * Periodic scheduler tick:
   * 1. Detects upcoming parties within 10 minutes and triggers Web Push reminder.
   * 2. Opens the room automatically at scheduled start time if not already created.
   */
  public async checkUpcomingParties(nowMs = Date.now()): Promise<{ remindedCount: number; openedCount: number }> {
    let remindedCount = 0;
    let openedCount = 0;

    for (const party of this.parties.values()) {
      const timeUntilStart = party.scheduledStartTimeMs - nowMs;

      // 1. 10-Minute Reminder Push Notification
      if (timeUntilStart <= 10 * 60 * 1000 && timeUntilStart > -60 * 1000 && !party.reminded10m) {
        party.reminded10m = true;
        remindedCount++;

        if (this.pushService) {
          // Send to creator + anyone who RSVP'd attending or maybe
          const recipients = new Set<string>();
          recipients.add(party.creatorUserId);
          for (const [uid, status] of Object.entries(party.rsvps)) {
            if (status === "attending" || status === "maybe") {
              recipients.add(uid);
            }
          }

          for (const userId of recipients) {
            this.pushService
              .sendParty10mReminderNotification(userId, {
                id: party.id,
                title: party.title,
                roomCode: party.roomCode,
                scheduledStartTimeMs: party.scheduledStartTimeMs,
              })
              .catch((err) => {
                console.warn(`[ScheduledPartyService] Push reminder failed for user ${userId}:`, err);
              });
          }
        }
      }

      // 2. Automatic Room Creation/Opening at Start Time
      if (nowMs >= party.scheduledStartTimeMs && !party.roomOpened) {
        party.roomOpened = true;
        openedCount++;

        if (this.roomManager && party.roomCode) {
          const existingRoom = this.roomManager.getRoomByCode(party.roomCode);
          if (!existingRoom) {
            // Open room with creator as host
            const created = this.roomManager.createRoom({
              roomCode: party.roomCode,
              roomName: party.title,
              hostUserId: party.creatorUserId,
              hostUserName: party.creatorDisplayName,
              isHomeRoom: party.isHomeRoom,
              initialVideoId: party.sourceUrl || "big_buck_bunny",
            });
            party.roomId = created.room.roomId;

            // If a custom source title was supplied, set it on playback
            if (party.sourceTitle) {
              created.room.playback.title = party.sourceTitle;
            }
          } else {
            party.roomId = existingRoom.roomId;
          }
        }
      }
    }

    return { remindedCount, openedCount };
  }

  /**
   * Generates standard RFC 5545 iCalendar (.ics) export with alarm
   */
  public generateIcsCalendar(partyId: string, customBaseUrl?: string): string {
    const party = this.parties.get(partyId);
    if (!party) {
      throw new Error("Party not found");
    }

    const host = customBaseUrl || this.baseUrl;
    const roomUrl = `${host}/join/${party.roomCode || ""}`;
    const dtStamp = this.formatIcsDateTime(new Date());
    const dtStart = this.formatIcsDateTime(new Date(party.scheduledStartTimeMs));
    const dtEnd = this.formatIcsDateTime(new Date(party.scheduledEndTimeMs || party.scheduledStartTimeMs + 2 * 3600 * 1000));

    const safeTitle = this.escapeIcsText(party.title);
    const safeDesc = this.escapeIcsText(
      `${party.description || "Synchronized Watch Party"}\n\nJoin Party: ${roomUrl}\nHosted by: ${party.creatorDisplayName}`
    );
    const safeLocation = this.escapeIcsText(roomUrl);

    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//WatchParty//WatchParty Scheduled Party//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${party.id}@watchparty`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${safeTitle}`,
      `DESCRIPTION:${safeDesc}`,
      `URL:${roomUrl}`,
      `LOCATION:${safeLocation}`,
      "STATUS:CONFIRMED",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:WatchParty starts in 10 minutes",
      "TRIGGER:-PT10M",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
  }

  private formatIcsDateTime(date: Date): string {
    return date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  }

  private escapeIcsText(text: string): string {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }
}
