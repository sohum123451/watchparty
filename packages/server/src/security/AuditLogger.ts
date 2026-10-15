export type SecurityEventType =
  | "AUTH_LOGIN_SUCCESS"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_SIGNUP"
  | "AUTH_PASSWORD_RESET_REQUESTED"
  | "AUTH_PASSWORD_RESET_SUCCESS"
  | "AUTH_SESSION_REVOKED"
  | "AUTH_ACCOUNT_LOCKED"
  | "ROOM_CREATED"
  | "ROOM_HOST_TRANSFERRED"
  | "ROOM_MEMBER_KICKED"
  | "FRIEND_BLOCKED"
  | "E2EE_KEY_ROTATED"
  | "ROOM_MEMBER_BANNED"
  | "ROOM_MEMBER_UNBANNED"
  | "ROOM_MEMBER_MUTED"
  | "ROOM_MEMBER_UNMUTED"
  | "ROOM_LOCKED"
  | "ROOM_UNLOCKED"
  | "ROOM_SETTINGS_UPDATED"
  | "CHAT_MESSAGE_DELETED"
  | "MODERATION_REPORT_CREATED"
  | "INVITE_LINK_CREATED"
  | "INVITE_LINK_REVOKED"
  | "INVITE_LINK_REGENERATED"
  | "WAITING_ROOM_APPROVED"
  | "WAITING_ROOM_DENIED"
  | "ROLE_ASSIGNED"
  | "MEDIA_TOKEN_ISSUED"
  | "VOICE_PARTICIPANT_JOINED"
  | "VOICE_PARTICIPANT_LEFT"
  | "VOICE_PARTICIPANT_MUTED"
  | "VOICE_PARTICIPANT_REMOVED";


export interface AuditLogEntry {
  id: string;
  timestamp: string;
  type: SecurityEventType;
  actorId?: string;
  targetId?: string;
  ipAddress?: string;
  userAgent?: string;
  outcome: "SUCCESS" | "FAILURE";
  details?: Record<string, any>;
}

export class AuditLogger {
  private logs: AuditLogEntry[] = [];
  private maxLogs: number;

  constructor(maxLogs = 1000) {
    this.maxLogs = maxLogs;
  }

  public log(entry: Omit<AuditLogEntry, "id" | "timestamp">): AuditLogEntry {
    const fullEntry: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.logs.push(fullEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    if (process.env.NODE_ENV !== "test") {
      console.log(`[AUDIT_LOG] ${fullEntry.timestamp} [${fullEntry.type}] actor=${fullEntry.actorId || "anon"} outcome=${fullEntry.outcome}`);
    }

    return fullEntry;
  }

  public getLogs(filter?: { type?: SecurityEventType; actorId?: string }): AuditLogEntry[] {
    return this.logs.filter((l) => {
      if (filter?.type && l.type !== filter.type) return false;
      if (filter?.actorId && l.actorId !== filter.actorId) return false;
      return true;
    });
  }

  public clear(): void {
    this.logs = [];
  }
}

export const auditLogger = new AuditLogger();
