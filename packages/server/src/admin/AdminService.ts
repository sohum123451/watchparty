import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { RoomManager } from "../rooms/RoomManager.js";
import { IAuthRepository } from "../auth/db/AuthRepository.js";
import { Mailer } from "../auth/mailer/Mailer.js";
import { TokenSecurity } from "../auth/crypto/tokens.js";
import { WebSocketGateway } from "../gateway/WebSocketGateway.js";
import { ModerationReport } from "@watchparty/shared";
import { SentryClient, globalSentry } from "../observability/SentryClient.js";

export type RegistrationMode = "public" | "invite_only" | "disabled";

export interface RegistrationInvite {
  id: string;
  code: string;
  createdByUserId?: string;
  maxUses?: number; // undefined or null = unlimited
  useCount: number;
  expiresAt?: number; // ms timestamp
  isRevoked: boolean;
  note?: string;
  createdAt: number;
}

export interface UsageAlert {
  type: "email" | "storage" | "bandwidth" | "rate_limit";
  level: "info" | "warning" | "critical";
  title: string;
  message: string;
  percentUsed: number;
  threshold: number;
  recommendedAction: string;
}

export interface UsageReport {
  timestamp: number;
  email: {
    provider: string;
    sentToday: number;
    dailyLimit: number;
    sentThisMonth: number;
    monthlyLimit: number;
    percentDailyUsed: number;
    percentMonthlyUsed: number;
    status: "healthy" | "warning" | "critical";
  };
  storage: {
    dataDirSizeBytes: number;
    dataDirSizeMB: number;
    warningThresholdMB: number;
    percentThresholdUsed: number;
    status: "healthy" | "warning" | "critical";
  };
  bandwidth: {
    inboundBytes: number;
    outboundBytes: number;
    totalBytes: number;
    totalMB: number;
  };
  system: {
    activeRooms: number;
    connectedSockets: number;
    registeredUsers: number;
    uptimeSeconds: number;
    registrationMode: RegistrationMode;
  };
  alerts: UsageAlert[];
}

export interface AdminServiceOptions {
  authRepo: IAuthRepository;
  roomManager: RoomManager;
  mailer?: Mailer;
  gateway?: WebSocketGateway;
  adminSecret: string;
  initialRegistrationMode?: RegistrationMode;
  masterInviteCode?: string;
  uptimeAlertWebhookUrl?: string;
  usageAlertEmail?: string;
  mailerProvider?: string;
  dataDir?: string;
}

export class AdminService {
  private authRepo: IAuthRepository;
  private roomManager: RoomManager;
  private mailer?: Mailer;
  private gateway?: WebSocketGateway;
  private adminSecret: string;
  private registrationMode: RegistrationMode;
  private masterInviteCode?: string;
  private uptimeAlertWebhookUrl?: string;
  private usageAlertEmail?: string;
  private mailerProvider: string;
  private dataDir: string;

  // In-Memory state for invites and telemetry
  private invites: Map<string, RegistrationInvite> = new Map();
  private emailsSentToday = 0;
  private emailsSentThisMonth = 0;
  private lastEmailCounterResetDate: string;
  private lastEmailCounterResetMonth: string;
  private bandwidthInboundBytes = 0;
  private bandwidthOutboundBytes = 0;

  constructor(options: AdminServiceOptions) {
    this.authRepo = options.authRepo;
    this.roomManager = options.roomManager;
    this.mailer = options.mailer;
    this.gateway = options.gateway;
    this.adminSecret = options.adminSecret;
    this.registrationMode = options.initialRegistrationMode || "invite_only";
    this.masterInviteCode = options.masterInviteCode?.toUpperCase().trim();
    this.uptimeAlertWebhookUrl = options.uptimeAlertWebhookUrl;
    this.usageAlertEmail = options.usageAlertEmail;
    this.mailerProvider = options.mailerProvider || "console";
    this.dataDir = options.dataDir || "./.data";

    const now = new Date();
    this.lastEmailCounterResetDate = now.toISOString().slice(0, 10);
    this.lastEmailCounterResetMonth = now.toISOString().slice(0, 7);

    // Seed master invite if configured
    if (this.masterInviteCode) {
      this.createInvite({
        customCode: this.masterInviteCode,
        note: "Master friend group invite code",
        maxUses: undefined,
      });
    }
  }

  public setGateway(gateway: WebSocketGateway): void {
    this.gateway = gateway;
  }

  public setMailer(mailer: Mailer): void {
    this.mailer = mailer;
  }

  // =========================================================================
  // AUTHENTICATION & SECURITY
  // =========================================================================

  public verifyAdminSecret(tokenOrPassword?: string): boolean {
    if (!tokenOrPassword) return false;
    const cleanToken = tokenOrPassword.replace(/^Bearer\s+/i, "").trim();
    return cleanToken === this.adminSecret;
  }

  // =========================================================================
  // REGISTRATION & INVITE ACCESS CONTROL (INVITE-ONLY & KILL SWITCH)
  // =========================================================================

  public getRegistrationMode(): RegistrationMode {
    return this.registrationMode;
  }

  public setRegistrationMode(mode: RegistrationMode): void {
    this.registrationMode = mode;
  }

  public createInvite(options: {
    customCode?: string;
    maxUses?: number;
    expiresInDays?: number;
    note?: string;
    createdByUserId?: string;
  } = {}): RegistrationInvite {
    const code = (options.customCode || `WP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`).trim().toUpperCase();
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = options.expiresInDays ? now + options.expiresInDays * 24 * 60 * 60 * 1000 : undefined;

    const invite: RegistrationInvite = {
      id,
      code,
      createdByUserId: options.createdByUserId,
      maxUses: options.maxUses,
      useCount: 0,
      expiresAt,
      isRevoked: false,
      note: options.note,
      createdAt: now,
    };

    this.invites.set(code, invite);
    return { ...invite };
  }

  public listInvites(): RegistrationInvite[] {
    return Array.from(this.invites.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  public revokeInvite(codeOrId: string): boolean {
    const normalized = codeOrId.trim().toUpperCase();
    for (const invite of this.invites.values()) {
      if (invite.code === normalized || invite.id === codeOrId) {
        invite.isRevoked = true;
        return true;
      }
    }
    return false;
  }

  public validateAndConsumeInvite(code?: string): { valid: boolean; reason?: string } {
    if (this.registrationMode === "disabled") {
      return { valid: false, reason: "Registration is temporarily disabled by an administrator (Kill switch active)." };
    }

    if (this.registrationMode === "public") {
      return { valid: true };
    }

    // Invite-only mode requires code
    if (!code || !code.trim()) {
      return { valid: false, reason: "Registration is currently invite-only. A valid invite code or link is required." };
    }

    const normalized = code.trim().toUpperCase();

    // Check master fallback code if matches
    if (this.masterInviteCode && normalized === this.masterInviteCode) {
      return { valid: true };
    }

    const invite = this.invites.get(normalized);
    if (!invite) {
      return { valid: false, reason: "Invalid invite code." };
    }

    if (invite.isRevoked) {
      return { valid: false, reason: "This invite code has been revoked." };
    }

    if (invite.expiresAt && Date.now() > invite.expiresAt) {
      return { valid: false, reason: "This invite code has expired." };
    }

    if (invite.maxUses !== undefined && invite.maxUses !== null && invite.useCount >= invite.maxUses) {
      return { valid: false, reason: "This invite code has reached its maximum usage limit." };
    }

    // Consume 1 use
    invite.useCount += 1;
    return { valid: true };
  }

  // =========================================================================
  // USER MANAGEMENT (BAN / UNBAN / REVOKE SESSIONS / VERIFY)
  // =========================================================================

  public async listUsers(options: { query?: string; page?: number; limit?: number } = {}) {
    const limit = options.limit || 50;
    const page = options.page || 1;
    const offset = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.authRepo.getAllUsers({ query: options.query, limit, offset }),
      this.authRepo.countUsers(),
    ]);

    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        username: u.username,
        friendCode: u.friendCode,
        role: u.role,
        isBanned: u.isBanned,
        bannedAt: u.bannedAt,
        bannedReason: u.bannedReason,
        isEmailVerified: Boolean(u.emailVerifiedAt),
        createdAt: u.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  public async banUser(userId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const user = await this.authRepo.findUserById(userId);
    if (!user) {
      return { success: false, message: "User not found" };
    }

    await this.authRepo.banUser(userId, reason || "Banned by administrator");

    // Revoke all active sessions
    await this.authRepo.revokeAllUserTokens(userId);

    // Disconnect any active WebSockets across rooms
    if (this.gateway) {
      this.gateway.disconnectUser(userId, 4003, `Account suspended: ${reason || "Banned by administrator"}`);
    }

    return { success: true, message: `User ${user.email} has been banned and active sessions revoked.` };
  }

  public async unbanUser(userId: string): Promise<{ success: boolean; message: string }> {
    const user = await this.authRepo.findUserById(userId);
    if (!user) {
      return { success: false, message: "User not found" };
    }

    await this.authRepo.unbanUser(userId);
    return { success: true, message: `User ${user.email} has been unbanned.` };
  }

  public async revokeUserSessions(userId: string): Promise<{ success: boolean; revokedCount: number }> {
    const revokedCount = await this.authRepo.revokeAllUserTokens(userId);

    if (this.gateway) {
      this.gateway.disconnectUser(userId, 4001, "Sessions revoked by administrator");
    }

    return { success: true, revokedCount };
  }

  public async resendVerificationEmail(userId: string, baseUrl = "http://localhost:3001"): Promise<{ success: boolean; message: string }> {
    const user = await this.authRepo.findUserById(userId);
    if (!user) {
      return { success: false, message: "User not found" };
    }

    if (user.emailVerifiedAt) {
      return { success: false, message: "User email is already verified" };
    }

    // Invalidate existing tokens
    await this.authRepo.invalidatePendingEmailTokens(userId, "verify");

    // Create fresh single-use verification token
    const rawVerifyToken = TokenSecurity.generateRandomToken(32);
    const verifyTokenHash = TokenSecurity.hashToken(rawVerifyToken);
    await this.authRepo.createEmailToken({
      userId: user.id,
      type: "verify",
      tokenHash: verifyTokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const verifyUrl = `${baseUrl}/verify-email?token=${rawVerifyToken}`;

    if (this.mailer) {
      await this.mailer.sendVerificationEmail(user.email, rawVerifyToken, verifyUrl);
      this.recordEmailSent();
    }

    return { success: true, message: `Verification email dispatched to ${user.email}.` };
  }

  // =========================================================================
  // ACTIVE ROOMS MANAGEMENT
  // =========================================================================

  public listActiveRooms() {
    const rooms = this.roomManager.getAllRooms();
    return rooms.map((r) => {
      const hostMember = r.getMember(r.hostId);
      return {
        roomId: r.roomId,
        roomCode: r.roomCode,
        roomName: r.roomName,
        hostUserId: r.hostId,
        hostUserName: hostMember?.userName || "Host",
        memberCount: r.getMemberCount(),
        isLocked: r.isLocked,
        isHomeRoom: r.isHomeRoom,
        homeGroupName: r.homeGroupName,
        controlMode: r.controlMode,
        currentVideoId: r.playlist[0]?.videoId || r.playlist[0]?.title || undefined,
        playbackStatus: r.playback?.status || "paused",
        playbackPosition: Math.round(r.playback?.positionMs || 0),
        createdAt: Date.now(),
      };
    });
  }

  public forceCloseRoom(roomId: string, reason = "Closed by administrator"): { success: boolean; message: string } {
    const room = this.roomManager.getRoomById(roomId);
    if (!room) {
      return { success: false, message: "Room not found" };
    }

    // Notify all members with error toast and close connections
    room.emitSystemMessage(`This room was closed by administrator: ${reason}`);

    this.roomManager.removeRoom(roomId);
    return { success: true, message: `Room ${room.roomCode} closed successfully.` };
  }

  public toggleRoomLock(roomId: string, locked: boolean): { success: boolean; isLocked?: boolean; message: string } {
    const room = this.roomManager.getRoomById(roomId);
    if (!room) {
      return { success: false, message: "Room not found" };
    }

    room.isLocked = locked;
    room.version++;
    room.broadcast({
      type: "ROOM_LOCK_UPDATED",
      version: room.version,
      payload: { isLocked: locked, updatedBy: "administrator" },
    });
    return { success: true, isLocked: room.isLocked, message: `Room ${room.roomCode} ${locked ? "locked" : "unlocked"}.` };
  }

  // =========================================================================
  // MODERATION REPORTS & ACTIONING
  // =========================================================================

  public listModerationReports(): ModerationReport[] {
    const allReports: ModerationReport[] = [];
    const rooms = this.roomManager.getAllRooms();

    for (const room of rooms) {
      const reports = room.getReports();
      allReports.push(...reports);
    }

    return allReports.sort((a, b) => b.createdAt - a.createdAt);
  }

  public async actionReport(
    reportId: string,
    action: "dismiss" | "ban_user" | "kick_user",
    reason?: string
  ): Promise<{ success: boolean; message: string }> {
    const rooms = this.roomManager.getAllRooms();
    let targetReport: ModerationReport | undefined;
    let parentRoom: any;

    for (const room of rooms) {
      const rep = room.getReports().find((r) => r.id === reportId);
      if (rep) {
        targetReport = rep;
        parentRoom = room;
        break;
      }
    }

    if (!targetReport) {
      return { success: false, message: "Report not found or room no longer active" };
    }

    if (action === "dismiss") {
      targetReport.status = "dismissed";
      return { success: true, message: "Report dismissed." };
    }

    if (action === "ban_user" && targetReport.targetUserId) {
      targetReport.status = "actioned";
      targetReport.actionTaken = "user_banned";

      // If user has account ID, ban account
      if (targetReport.targetAccountId) {
        await this.banUser(targetReport.targetAccountId, reason || `Reported for: ${targetReport.reason}`);
      }

      // Also ban inside the room
      parentRoom.banMember(parentRoom.hostId, 9999, targetReport.targetUserId, reason || targetReport.reason);
      return { success: true, message: `Offender banned across room and user account suspended.` };
    }

    if (action === "kick_user" && targetReport.targetUserId) {
      targetReport.status = "actioned";
      targetReport.actionTaken = "user_kicked";
      parentRoom.kickMember(parentRoom.hostId, 9999, targetReport.targetUserId, reason || targetReport.reason);
      return { success: true, message: `User kicked from room.` };
    }

    return { success: false, message: "Unknown action" };
  }

  // =========================================================================
  // USAGE, COST ALERTS & TELEMETRY
  // =========================================================================

  public recordEmailSent(): void {
    const now = new Date();
    const currentDate = now.toISOString().slice(0, 10);
    const currentMonth = now.toISOString().slice(0, 7);

    if (currentDate !== this.lastEmailCounterResetDate) {
      this.emailsSentToday = 0;
      this.lastEmailCounterResetDate = currentDate;
    }
    if (currentMonth !== this.lastEmailCounterResetMonth) {
      this.emailsSentThisMonth = 0;
      this.lastEmailCounterResetMonth = currentMonth;
    }

    this.emailsSentToday += 1;
    this.emailsSentThisMonth += 1;

    // Check quota thresholds
    this.checkAndTriggerUsageAlerts();
  }

  public recordBandwidth(inbound: number, outbound: number): void {
    this.bandwidthInboundBytes += inbound;
    this.bandwidthOutboundBytes += outbound;
  }

  public getUsageReport(): UsageReport {
    // Limits based on transactional email provider free tiers:
    // Resend free tier: 3,000 emails/month, 100 emails/day
    // Postmark free tier: 100 emails/month
    const dailyLimit = this.mailerProvider === "postmark" ? 100 : 100;
    const monthlyLimit = this.mailerProvider === "postmark" ? 100 : 3000;

    const percentDailyUsed = Math.min(100, Math.round((this.emailsSentToday / dailyLimit) * 100));
    const percentMonthlyUsed = Math.min(100, Math.round((this.emailsSentThisMonth / monthlyLimit) * 100));

    let emailStatus: "healthy" | "warning" | "critical" = "healthy";
    if (percentDailyUsed >= 95 || percentMonthlyUsed >= 95) {
      emailStatus = "critical";
    } else if (percentDailyUsed >= 80 || percentMonthlyUsed >= 80) {
      emailStatus = "warning";
    }

    // Disk Storage Calculation
    const dataDirSizeBytes = this.getDirectorySize(this.dataDir);
    const dataDirSizeMB = Math.round((dataDirSizeBytes / (1024 * 1024)) * 10) / 10;
    const warningThresholdMB = 2000; // 2GB warning threshold for $4-$6 VPS
    const percentThresholdUsed = Math.min(100, Math.round((dataDirSizeMB / warningThresholdMB) * 100));

    let storageStatus: "healthy" | "warning" | "critical" = "healthy";
    if (percentThresholdUsed >= 90) {
      storageStatus = "critical";
    } else if (percentThresholdUsed >= 75) {
      storageStatus = "warning";
    }

    const totalBandwidthBytes = this.bandwidthInboundBytes + this.bandwidthOutboundBytes;
    const totalBandwidthMB = Math.round((totalBandwidthBytes / (1024 * 1024)) * 10) / 10;

    // Build proactive alerts list
    const alerts: UsageAlert[] = [];

    if (emailStatus === "critical") {
      alerts.push({
        type: "email",
        level: "critical",
        title: "Email Free-Tier Quota Nearly Exhausted",
        message: `Sent ${this.emailsSentToday}/${dailyLimit} today (${percentDailyUsed}%) and ${this.emailsSentThisMonth}/${monthlyLimit} this month.`,
        percentUsed: percentDailyUsed,
        threshold: 95,
        recommendedAction: "Upgrade Resend/Postmark tier or pause non-critical notifications to avoid dropped emails.",
      });
    } else if (emailStatus === "warning") {
      alerts.push({
        type: "email",
        level: "warning",
        title: "Email Daily Limit Approaching",
        message: `Sent ${this.emailsSentToday}/${dailyLimit} today (${percentDailyUsed}%). Approaching free tier daily cap.`,
        percentUsed: percentDailyUsed,
        threshold: 80,
        recommendedAction: "Monitor signups; consider enabling invite-only registration to pace transactional emails.",
      });
    }

    if (storageStatus === "critical") {
      alerts.push({
        type: "storage",
        level: "critical",
        title: "VPS Storage Alert (> 90% Allocated Threshold)",
        message: `Persistent data directory is consuming ${dataDirSizeMB} MB of ${warningThresholdMB} MB warning threshold.`,
        percentUsed: percentThresholdUsed,
        threshold: 90,
        recommendedAction: "Prune old backups via scripts/backup-db.sh or upload snapshots to S3/Cloudflare R2.",
      });
    } else if (storageStatus === "warning") {
      alerts.push({
        type: "storage",
        level: "warning",
        title: "Storage Growth Warning",
        message: `Data directory reached ${dataDirSizeMB} MB (${percentThresholdUsed}% of target threshold).`,
        percentUsed: percentThresholdUsed,
        threshold: 75,
        recommendedAction: "Review uploaded avatars and verify daily backup retention pruning.",
      });
    }

    return {
      timestamp: Date.now(),
      email: {
        provider: this.mailerProvider,
        sentToday: this.emailsSentToday,
        dailyLimit,
        sentThisMonth: this.emailsSentThisMonth,
        monthlyLimit,
        percentDailyUsed,
        percentMonthlyUsed,
        status: emailStatus,
      },
      storage: {
        dataDirSizeBytes,
        dataDirSizeMB,
        warningThresholdMB,
        percentThresholdUsed,
        status: storageStatus,
      },
      bandwidth: {
        inboundBytes: this.bandwidthInboundBytes,
        outboundBytes: this.bandwidthOutboundBytes,
        totalBytes: totalBandwidthBytes,
        totalMB: totalBandwidthMB,
      },
      system: {
        activeRooms: this.roomManager.getActiveRoomCount(),
        connectedSockets: this.gateway ? (this.gateway as any).getConnectedSocketCount?.() || 0 : 0,
        registeredUsers: 0, // populated dynamically when requested
        uptimeSeconds: Math.floor(process.uptime()),
        registrationMode: this.registrationMode,
      },
      alerts,
    };
  }

  private checkAndTriggerUsageAlerts(): void {
    const report = this.getUsageReport();
    if (report.alerts.length > 0 && this.uptimeAlertWebhookUrl) {
      for (const alert of report.alerts) {
        if (alert.level === "critical" || alert.level === "warning") {
          this.dispatchWebhookAlert(alert).catch(() => {});
        }
      }
    }
  }

  private async dispatchWebhookAlert(alert: UsageAlert): Promise<void> {
    if (!this.uptimeAlertWebhookUrl) return;

    try {
      const payload = {
        content: `🚨 **[WatchParty ${alert.level.toUpperCase()} Alert]**: ${alert.title}\n${alert.message}\n👉 **Recommended Action**: ${alert.recommendedAction}`,
        embeds: [
          {
            title: alert.title,
            description: alert.message,
            color: alert.level === "critical" ? 15158332 : 16753920,
            fields: [
              { name: "Resource", value: alert.type.toUpperCase(), inline: true },
              { name: "Utilization", value: `${alert.percentUsed}%`, inline: true },
              { name: "Next Step", value: alert.recommendedAction },
            ],
            footer: { text: "WatchParty Observability & Cost Guardrails" },
            timestamp: new Date().toISOString(),
          },
        ],
      };

      await fetch(this.uptimeAlertWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e: any) {
      console.warn(`[AdminService] Failed to dispatch webhook alert: ${e.message}`);
    }
  }

  private getDirectorySize(dirPath: string): number {
    try {
      if (!fs.existsSync(dirPath)) return 0;
      let total = 0;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += this.getDirectorySize(fullPath);
        } else if (entry.isFile()) {
          total += fs.statSync(fullPath).size;
        }
      }
      return total;
    } catch {
      return 0;
    }
  }
}
