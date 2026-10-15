import {
  ControlMode,
  PlaybackState,
  PlaylistItem,
  VideoProvider,
  Poll,
  PollOption,
  PollSummary,
  ChatMessage,
  ReactionBurst,
  RoomSnapshot,
  MemberPublicInfo,
  RoomEvent,
  ServerMessage,
  ERROR_CODES,
  WS_CLOSE_CODES,
  ROOM_CONSTANTS,
  VersionedRingBuffer,
  derivePlaybackPositionMs,
  sanitizeText,
  MOVIE_CATALOGUE,
  MomentBookmark,
  ReadyCheck,
  MemberSyncMetrics,
  RoomSyncHealthSummary,
  RoomType,
  Role,
  RoomPermission,
  DEFAULT_PERMISSION_MATRIX,
  PermissionMatrix,
  WaitingJoinRequest,
  RoomBan,
  MuteRecord,
  RoomInviteLink,
  ModerationReport,
  filterProfanity,
  ScreenShareSessionInfo,
  ScreenShareTransportMode,
  ScreenShareMetrics,
  PendingSourceSubmission,
  SourceAuditEntry,
  SourceAuditAction,
  SourceReport,
  SourceBlocklistRule,
  UrlSafetyReport,
  SourcePlaybackMemoryItem,
  ParticipantMediaState,
  RoomRecordingState,
} from "@watchparty/shared";
import {
  generateId,
  generateSessionToken,
  generatePasswordSalt,
  hashRoomPassword,
  verifyRoomPassword,
} from "../utils/crypto.js";
import { auditLogger } from "../security/AuditLogger.js";
import { UrlSafetyChecker, defaultUrlSafetyChecker } from "../services/UrlSafetyChecker.js";

export interface ActiveConnection {
  send(message: ServerMessage): void;
  close(code?: number, reason?: string): void;
  isAlive: boolean;
  roomId?: string;
  userId?: string;
}

export interface RoomMemberInternal {
  userId: string;
  userName: string;
  role: Role;
  isHost: boolean;
  isConnected: boolean;
  isBuffering: boolean;
  isMuted?: boolean;
  accountId?: string;
  joinedAt: number;
  lastSeenAt: number;
  sessionToken: string;
  connection?: ActiveConnection;
  e2eePublicKey?: string;
}

export interface RoomConfig {
  roomId: string;
  roomCode: string;
  roomName: string;
  hostUserId: string;
  hostUserName: string;
  hostAccountId?: string;
  controlMode?: ControlMode;
  roomType?: RoomType;
  roomPassword?: string;
  maxMembers?: number;
  waitingRoomEnabled?: boolean;
  autoApproveFriends?: boolean;
  profanityFilterEnabled?: boolean;
  slowModeSeconds?: number;
  initialVideoId?: string;
  baseUrl?: string;
  idleTtlMs?: number;
  hostGraceMs?: number;
  onDestroy?: (roomId: string) => void;
  e2eeEnabled?: boolean;
  e2eeHostPublicKey?: string;
  friendsService?: any;
  passwordHash?: string;
  passwordSalt?: string;
  requireLinkApproval?: boolean;
  approvedSourceAdders?: string[];
  onClusterBroadcast?: (roomId: string, message: ServerMessage) => void;
  onStateChanged?: (room: Room) => void;
  isHomeRoom?: boolean;
  homeGroupName?: string;
  sourcePlaybackMemory?: Record<string, SourcePlaybackMemoryItem>;
  chatRetentionDays?: number;
  roomRules?: string;
  videoDisabledForRoom?: boolean;
}

export class Room {
  public readonly roomId: string;
  public readonly roomCode: string;
  public readonly roomName: string;
  public readonly baseUrl: string;
  public hostId: string;
  public version: number;
  public controlMode: ControlMode;
  public roomType: RoomType;
  public isHomeRoom: boolean;
  public homeGroupName?: string;
  public sourcePlaybackMemory: Map<string, SourcePlaybackMemoryItem>;
  public maxMembers: number;
  public waitingRoomEnabled: boolean;
  public autoApproveFriends: boolean;
  public isLocked: boolean;
  public slowModeSeconds: number;
  public profanityFilterEnabled: boolean;
  public chatRetentionDays: number = 7;
  public roomRules?: string;
  public videoDisabledForRoom: boolean = false;
  public voiceParticipants: Map<string, ParticipantMediaState> = new Map();
  public recordingState: RoomRecordingState;
  private mediaService?: any;
  public playback: PlaybackState;
  public playlist: PlaylistItem[];
  public activePoll: Poll | null;
  public chatHistory: ChatMessage[];
  public storedReactions: ReactionBurst[];
  public bookmarks: MomentBookmark[];
  public readyCheck: ReadyCheck | null;
  public readonly e2eeEnabled: boolean;
  public e2eeKeyVersion: number;
  public e2eeSafetyFingerprint?: string;
  public e2eeHostPublicKey?: string;
  public approvedScreenSharers: Set<string> = new Set();
  public activeScreenSharerId?: string;
  public activeScreenShareSession?: ScreenShareSessionInfo | null = null;
  private screenShareMetrics: Map<string, ScreenShareMetrics> = new Map();

  public requireLinkApproval: boolean;
  public approvedSourceAdders: Set<string> = new Set();
  public sourceApprovalQueue: Map<string, PendingSourceSubmission> = new Map();
  public sourceAuditLog: SourceAuditEntry[] = [];
  public sourceBlocklist: Map<string, SourceBlocklistRule> = new Map();
  public sourceReports: Map<string, SourceReport> = new Map();
  public urlSafetyChecker: UrlSafetyChecker;

  private passwordHash?: string;
  private passwordSalt?: string;
  private friendsService?: any;
  private permissionMatrix: PermissionMatrix;
  private waitingRequests: Map<string, WaitingJoinRequest>;
  private waitingConnections: Map<string, ActiveConnection>;
  private bans: Map<string, RoomBan>;
  private bannedAccountIds: Set<string>;
  private bannedSessionTokens: Set<string>;
  private bannedUserIds: Set<string>;
  private mutes: Map<string, MuteRecord>;
  private inviteLinks: Map<string, RoomInviteLink>;
  private reports: Map<string, ModerationReport>;
  private userLastChatTime: Map<string, number>;

  private members: Map<string, RoomMemberInternal>; // Keyed by userId
  private ringBuffer: VersionedRingBuffer;
  private actionQueue: Promise<void>;
  private userReactionRates: Map<string, { count: number; resetTime: number }>;
  private userChatRates: Map<string, { count: number; resetTime: number }>;
  private memberMetrics: Map<string, MemberSyncMetrics>;
  private pollExpirationTimer: NodeJS.Timeout | null = null;
  private readyCheckTimer: NodeJS.Timeout | null = null;
  
  private hostDisconnectTimer: NodeJS.Timeout | null = null;
  private idleCleanupTimer: NodeJS.Timeout | null = null;
  private readonly idleTtlMs: number;
  private readonly hostGraceMs: number;
  private readonly onDestroy?: (roomId: string) => void;
  private onClusterBroadcast?: (roomId: string, message: ServerMessage) => void;
  private onStateChanged?: (room: Room) => void;

  constructor(config: RoomConfig) {
    this.roomId = config.roomId;
    this.roomCode = config.roomCode;
    this.roomName = config.roomName;
    this.baseUrl = config.baseUrl || "http://localhost:3000";
    this.hostId = config.hostUserId;
    this.version = 1;
    this.controlMode = config.controlMode || "public";
    this.roomType = config.roomType || "public";
    this.isHomeRoom = Boolean(config.isHomeRoom);
    this.homeGroupName = config.homeGroupName;
    this.sourcePlaybackMemory = new Map();
    if (config.sourcePlaybackMemory) {
      for (const [key, val] of Object.entries(config.sourcePlaybackMemory)) {
        this.sourcePlaybackMemory.set(key, val);
      }
    }
    this.maxMembers = config.maxMembers ?? ROOM_CONSTANTS.MAX_ROOM_MEMBERS;
    this.waitingRoomEnabled = Boolean(config.waitingRoomEnabled);
    this.autoApproveFriends = config.autoApproveFriends ?? true;
    this.isLocked = false;
    this.slowModeSeconds = config.slowModeSeconds ?? 0;
    this.profanityFilterEnabled = config.profanityFilterEnabled !== undefined ? Boolean(config.profanityFilterEnabled) : true;
    this.chatRetentionDays = config.chatRetentionDays !== undefined ? Math.max(0, config.chatRetentionDays) : 7;
    this.roomRules = config.roomRules ? config.roomRules.slice(0, 2000).trim() : undefined;
    this.videoDisabledForRoom = Boolean(config.videoDisabledForRoom);
    this.recordingState = {
      isRecording: false,
      consentRequired: true,
      consentedUserIds: [],
      deniedUserIds: [],
    };
    this.friendsService = config.friendsService;
    this.idleTtlMs = config.idleTtlMs ?? ROOM_CONSTANTS.IDLE_ROOM_TTL_MS;
    this.hostGraceMs = config.hostGraceMs ?? ROOM_CONSTANTS.HOST_DISCONNECT_GRACE_MS;
    this.onDestroy = config.onDestroy;
    this.onClusterBroadcast = config.onClusterBroadcast;
    this.onStateChanged = config.onStateChanged;
    this.e2eeEnabled = Boolean(config.e2eeEnabled);
    this.e2eeHostPublicKey = config.e2eeHostPublicKey;
    this.e2eeKeyVersion = 1;

    // Password hashing or restore existing hash
    if (config.passwordHash && config.passwordSalt) {
      this.passwordHash = config.passwordHash;
      this.passwordSalt = config.passwordSalt;
    } else if (config.roomPassword && config.roomPassword.trim().length > 0) {
      this.passwordSalt = generatePasswordSalt();
      this.passwordHash = hashRoomPassword(config.roomPassword.trim(), this.passwordSalt);
    }

    this.permissionMatrix = JSON.parse(JSON.stringify(DEFAULT_PERMISSION_MATRIX));
    this.waitingRequests = new Map();
    this.waitingConnections = new Map();
    this.bans = new Map();
    this.bannedAccountIds = new Set();
    this.bannedSessionTokens = new Set();
    this.bannedUserIds = new Set();
    this.mutes = new Map();
    this.inviteLinks = new Map();
    this.reports = new Map();
    this.userLastChatTime = new Map();

    this.requireLinkApproval = Boolean(config.requireLinkApproval);
    this.approvedSourceAdders = new Set(config.approvedSourceAdders || []);
    this.sourceApprovalQueue = new Map();
    this.sourceAuditLog = [];
    this.sourceBlocklist = new Map();
    this.sourceReports = new Map();
    this.urlSafetyChecker = defaultUrlSafetyChecker;

    const initialVideo = config.initialVideoId || "big_buck_bunny";
    const now = Date.now();
    this.playback = {
      videoId: initialVideo,
      status: "paused",
      positionMs: 0,
      serverTimeMs: now,
      playbackRate: 1.0,
    };

    this.playlist = [
      {
        id: generateId("pl"),
        videoId: initialVideo,
        title: "Big Buck Bunny (Demo)",
        durationMs: 596000,
        addedByUserId: config.hostUserId,
        addedByUserName: config.hostUserName,
        order: 1000,
      },
    ];

    this.activePoll = null;
    this.members = new Map();
    this.ringBuffer = new VersionedRingBuffer(ROOM_CONSTANTS.RING_BUFFER_CAPACITY);
    this.actionQueue = Promise.resolve();
    this.chatHistory = [];
    this.storedReactions = [];
    this.bookmarks = [];
    this.readyCheck = null;
    this.memberMetrics = new Map();
    this.userReactionRates = new Map();
    this.userChatRates = new Map();

    // Register host member
    const hostSessionToken = generateSessionToken();
    const hostMember: RoomMemberInternal = {
      userId: config.hostUserId,
      userName: config.hostUserName,
      role: "host",
      isHost: true,
      isConnected: false,
      isBuffering: false,
      isMuted: false,
      accountId: config.hostAccountId,
      joinedAt: now,
      lastSeenAt: now,
      sessionToken: hostSessionToken,
      e2eePublicKey: config.e2eeHostPublicKey,
    };
    this.members.set(config.hostUserId, hostMember);

    // Initial event
    this.ringBuffer.push({
      version: 1,
      type: "ROOM_CREATED",
      payload: { roomId: this.roomId, roomCode: this.roomCode },
      serverTimeMs: now,
    });

    this.emitSystemMessage(`Room "${this.roomName}" created. Welcome!`);
  }

  /**
   * Prune chat messages older than chatRetentionDays (if retention > 0).
   * Returns count of pruned messages.
   */
  public pruneExpiredChat(nowMs: number = Date.now()): number {
    if (this.chatRetentionDays <= 0 || this.chatHistory.length === 0) {
      return 0;
    }
    const cutoff = nowMs - this.chatRetentionDays * 86400 * 1000;
    const initialLength = this.chatHistory.length;
    this.chatHistory = this.chatHistory.filter((msg) => msg.serverTimestampMs >= cutoff);
    return initialLength - this.chatHistory.length;
  }

  public emitSystemMessage(text: string): void {
    this.pruneExpiredChat();
    const msg: ChatMessage = {
      id: generateId("sys"),
      userId: "system",
      userName: "System",
      text,
      serverTimestampMs: Date.now(),
      isSystem: true,
    };

    this.chatHistory.push(msg);
    if (this.chatHistory.length > 100) {
      this.chatHistory.shift();
    }

    this.broadcast({
      type: "CHAT_BROADCAST",
      version: this.version,
      payload: { message: msg },
    });
  }

  public get inviteUrl(): string {
    return `${this.baseUrl}/join/${this.roomCode}`;
  }

  /**
   * Deterministic action serialization:
   * Chains every state mutation sequentially in the order of arrival.
   */
  public enqueueAction<T>(action: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.actionQueue = this.actionQueue
        .then(async () => {
          const result = await action();
          resolve(result);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

  // ==========================================
  // MEMBER LIFECYCLE & RECONNECTION
  // ==========================================

  public async isFriendOfHost(userAccountId?: string): Promise<boolean> {
    if (!userAccountId || !this.friendsService) return false;
    const host = this.members.get(this.hostId);
    if (!host || !host.accountId) return false;
    if (host.accountId === userAccountId) return true;
    try {
      const rel = await this.friendsService.getFriendsRepo().getRelationship(host.accountId, userAccountId);
      return rel !== null && rel.status === "accepted";
    } catch {
      return false;
    }
  }

  public addMember(
    userName: string,
    connection?: ActiveConnection,
    e2eePublicKey?: string,
    options?: {
      accountId?: string;
      sessionToken?: string;
      role?: Role;
      password?: string;
      inviteToken?: string;
      isFriendOfHost?: boolean;
    }
  ):
    | { success: true; member: RoomMemberInternal; sessionToken: string }
    | { success: false; code: string; message: string; waiting?: boolean; requestId?: string } {
    this.cancelIdleTimer();
    this.cleanExpiredBans();

    // 1. Check if user or account or session is banned
    if (options?.accountId && this.bannedAccountIds.has(options.accountId)) {
      return {
        success: false,
        code: ERROR_CODES.USER_BANNED,
        message: "You are banned from this room",
      };
    }
    if (options?.sessionToken && this.bannedSessionTokens.has(options.sessionToken)) {
      return {
        success: false,
        code: ERROR_CODES.USER_BANNED,
        message: "You are banned from this room",
      };
    }

    // 2. Check if room is locked
    if (this.isLocked) {
      return {
        success: false,
        code: ERROR_CODES.ROOM_LOCKED,
        message: "This room is currently locked by a moderator",
      };
    }

    // 3. Check max members
    if (this.members.size >= this.maxMembers) {
      return {
        success: false,
        code: ERROR_CODES.ROOM_FULL,
        message: "Room has reached maximum member capacity",
      };
    }

    // 4. Check password if room has one
    if (this.passwordHash && this.passwordSalt) {
      if (!options?.password) {
        return {
          success: false,
          code: ERROR_CODES.ROOM_PASSWORD_REQUIRED,
          message: "Room password is required to join this room",
        };
      }
      if (!verifyRoomPassword(options.password, this.passwordSalt, this.passwordHash)) {
        return {
          success: false,
          code: ERROR_CODES.INVALID_PASSWORD,
          message: "Incorrect room password",
        };
      }
    }

    // 5. Check invite token (if provided or required by invite-only)
    let grantedRole: Role = options?.role || "member";
    let validInvite = false;
    if (options?.inviteToken) {
      const invite = this.inviteLinks.get(options.inviteToken);
      if (!invite || invite.isRevoked) {
        return {
          success: false,
          code: ERROR_CODES.INVITE_INVALID,
          message: "Invite link is invalid or has been revoked",
        };
      }
      if (invite.expiresAt !== null && Date.now() > invite.expiresAt) {
        return {
          success: false,
          code: ERROR_CODES.INVITE_EXPIRED,
          message: "Invite link has expired",
        };
      }
      if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
        return {
          success: false,
          code: ERROR_CODES.INVITE_MAX_USES_REACHED,
          message: "Invite link has reached its maximum uses",
        };
      }
      invite.useCount++;
      validInvite = true;
      grantedRole = invite.role;
    }

    // 6. Access Type checks
    if (this.roomType === "invite-only" && !validInvite) {
      if (!this.waitingRoomEnabled) {
        return {
          success: false,
          code: ERROR_CODES.PERMISSION_DENIED,
          message: "This room is invite-only. A valid invite link is required.",
        };
      }
    } else if (this.roomType === "friends-only" && !options?.isFriendOfHost) {
      if (!this.waitingRoomEnabled) {
        return {
          success: false,
          code: ERROR_CODES.PERMISSION_DENIED,
          message: "This room is friends-only. You must be a friend of the host to join.",
        };
      }
    }

    // 7. Waiting room check
    const shouldGoToWaitingRoom =
      (this.waitingRoomEnabled ||
        (this.roomType === "invite-only" && !validInvite) ||
        (this.roomType === "friends-only" && !options?.isFriendOfHost)) &&
      !(this.autoApproveFriends && options?.isFriendOfHost);

    if (shouldGoToWaitingRoom) {
      const requestId = generateId("req");
      const requestUserId = generateId("usr");
      const request: WaitingJoinRequest = {
        requestId,
        userId: requestUserId,
        userName,
        accountId: options?.accountId,
        requestedAt: Date.now(),
      };
      this.waitingRequests.set(requestId, request);
      if (connection) {
        this.waitingConnections.set(requestId, connection);
        connection.send({
          type: "ROOM_WAITING_LOBBY",
          payload: {
            roomCode: this.roomCode,
            roomName: this.roomName,
            requestId,
            message: "You are in the waiting room. Please wait for the host or a moderator to approve your request.",
          },
        });
      }
      this.broadcastToStaff({
        type: "WAITING_ROOM_REQUEST_ADDED",
        version: this.version,
        payload: { request },
      });
      return {
        success: false,
        code: ERROR_CODES.WAITING_FOR_APPROVAL,
        message: "You have been placed in the waiting room",
        waiting: true,
        requestId,
      };
    }

    const userId = generateId("usr");
    const sessionToken = generateSessionToken();
    const now = Date.now();

    const member: RoomMemberInternal = {
      userId,
      userName,
      role: grantedRole,
      isHost: this.members.size === 0, // Fallback if no members
      isConnected: Boolean(connection),
      isBuffering: false,
      isMuted: false,
      accountId: options?.accountId,
      joinedAt: now,
      lastSeenAt: now,
      sessionToken,
      connection,
      e2eePublicKey,
    };

    if (member.isHost) {
      this.hostId = userId;
      member.role = "host";
    }

    this.members.set(userId, member);
    this.version++;

    const memberPublic: MemberPublicInfo = this.toPublicMember(member);
    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_MEMBER_JOINED",
      payload: { member: memberPublic },
      serverTimeMs: now,
      causedBy: { userId },
    };
    this.ringBuffer.push(event);

    // Broadcast member joined to others
    this.broadcastExcept(userId, {
      type: "ROOM_MEMBER_JOINED",
      version: this.version,
      payload: { member: memberPublic },
    });

    this.emitSystemMessage(`${userName} joined the party`);

    return { success: true, member, sessionToken };
  }

  public attachConnection(userId: string, connection: ActiveConnection): void {
    const member = this.members.get(userId);
    if (!member) return;

    this.cancelIdleTimer();
    member.isConnected = true;
    member.lastSeenAt = Date.now();
    member.connection = connection;

    if (member.isHost && this.hostDisconnectTimer) {
      // Host reconnected within grace period!
      clearTimeout(this.hostDisconnectTimer);
      this.hostDisconnectTimer = null;
    }
  }

  public handleDisconnect(userId: string): void {
    const member = this.members.get(userId);
    if (!member) return;

    member.isConnected = false;
    member.lastSeenAt = Date.now();
    member.connection = undefined;

    this.version++;
    const now = Date.now();
    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_MEMBER_STATUS",
      payload: { userId, isConnected: false },
      serverTimeMs: now,
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "ROOM_MEMBER_STATUS",
      version: this.version,
      payload: { userId, isConnected: false },
    });

    // If active screen sharer disconnected, terminate live stream
    if (this.activeScreenSharerId === userId) {
      this.stopScreenShare(userId, undefined, "sharer_disconnected");
    }

    // Check if host disconnected
    if (member.isHost) {
      this.startHostGraceTimer();
    }

    // Check if all members are disconnected
    const activeCount = Array.from(this.members.values()).filter((m) => m.isConnected).length;
    if (activeCount === 0) {
      this.startIdleTimer();
    }
  }

  public reconnectMember(
    sessionToken: string,
    connection?: ActiveConnection,
    lastKnownVersion?: number,
    accountId?: string
  ):
    | { success: true; member: RoomMemberInternal; missedEvents: RoomEvent[] | null }
    | { success: false; code: string; message: string } {
    this.cleanExpiredBans();

    // 1. Ban evasion check by session token
    if (this.bannedSessionTokens.has(sessionToken)) {
      return {
        success: false,
        code: ERROR_CODES.USER_BANNED,
        message: "You are banned from this room",
      };
    }

    // 2. Ban evasion check by account
    if (accountId && this.bannedAccountIds.has(accountId)) {
      return {
        success: false,
        code: ERROR_CODES.USER_BANNED,
        message: "You are banned from this room",
      };
    }

    let targetMember: RoomMemberInternal | undefined;
    for (const m of this.members.values()) {
      if (m.sessionToken === sessionToken) {
        targetMember = m;
        break;
      }
    }

    if (!targetMember) {
      return {
        success: false,
        code: ERROR_CODES.INVALID_TOKEN,
        message: "Session token is invalid or expired",
      };
    }

    // 3. Ban check by target userId or accountId
    if (
      this.bannedUserIds.has(targetMember.userId) ||
      (targetMember.accountId && this.bannedAccountIds.has(targetMember.accountId))
    ) {
      return {
        success: false,
        code: ERROR_CODES.USER_BANNED,
        message: "You are banned from this room",
      };
    }

    this.cancelIdleTimer();
    targetMember.isConnected = true;
    targetMember.lastSeenAt = Date.now();
    targetMember.connection = connection;

    // If host reconnected, cancel grace timer
    if (targetMember.isHost && this.hostDisconnectTimer) {
      clearTimeout(this.hostDisconnectTimer);
      this.hostDisconnectTimer = null;
    }

    this.version++;
    const now = Date.now();
    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_MEMBER_STATUS",
      payload: { userId: targetMember.userId, isConnected: true },
      serverTimeMs: now,
    };
    this.ringBuffer.push(event);

    this.broadcastExcept(targetMember.userId, {
      type: "ROOM_MEMBER_STATUS",
      version: this.version,
      payload: { userId: targetMember.userId, isConnected: true },
    });

    let missedEvents: RoomEvent[] | null = null;
    if (typeof lastKnownVersion === "number" && lastKnownVersion > 0) {
      missedEvents = this.ringBuffer.getEventsSince(lastKnownVersion);
    }

    return {
      success: true,
      member: targetMember,
      missedEvents,
    };
  }

  // ==========================================
  // REAL-TIME VOICE & VIDEO CHAT METHODS
  // ==========================================

  public cleanExpiredBans(): void {
    const now = Date.now();
    for (const [id, ban] of this.bans.entries()) {
      if (ban.expiresAt && ban.expiresAt <= now) {
        this.bannedUserIds.delete(ban.userId);
        if (ban.accountId) this.bannedAccountIds.delete(ban.accountId);
        if (ban.sessionToken) this.bannedSessionTokens.delete(ban.sessionToken);
        this.bans.delete(id);
      }
    }
  }

  public isBanned(userId: string, accountId?: string): boolean {
    this.cleanExpiredBans();
    if (this.bannedUserIds.has(userId)) return true;
    if (accountId && this.bannedAccountIds.has(accountId)) return true;
    return false;
  }

  public updateVoiceState(
    userId: string,
    state: { inVoice?: boolean; audioMuted?: boolean; videoEnabled?: boolean; screenSharing?: boolean; isSpeaking?: boolean }
  ): ParticipantMediaState | null {
    const member = this.members.get(userId);
    if (!member) return null;

    const existing = this.voiceParticipants.get(userId);

    if (state.inVoice === false) {
      if (existing) {
        auditLogger.log({
          type: "VOICE_PARTICIPANT_LEFT",
          actorId: userId,
          outcome: "SUCCESS",
          details: {
            roomId: this.roomId,
            roomCode: this.roomCode,
            durationMs: existing.joinedVoiceAt ? Date.now() - existing.joinedVoiceAt : 0,
          },
        });
      }
      this.voiceParticipants.delete(userId);
      this.broadcastVoiceState();
      return null;
    }

    if (!existing) {
      auditLogger.log({
        type: "VOICE_PARTICIPANT_JOINED",
        actorId: userId,
        outcome: "SUCCESS",
        details: { roomId: this.roomId, roomCode: this.roomCode },
      });
    }

    const isVideoAllowed = !this.videoDisabledForRoom && member.role !== "guest";

    const participantState: ParticipantMediaState = {
      userId,
      userName: member.userName,
      role: member.role,
      inVoice: true,
      audioMuted: member.isMuted ? true : Boolean(state.audioMuted),
      videoEnabled: isVideoAllowed ? Boolean(state.videoEnabled) : false,
      screenSharing: Boolean(state.screenSharing),
      isSpeaking: state.isSpeaking !== undefined ? Boolean(state.isSpeaking) : Boolean(existing?.isSpeaking),
      joinedVoiceAt: existing?.joinedVoiceAt || Date.now(),
    };

    this.voiceParticipants.set(userId, participantState);
    this.broadcastVoiceState();
    return participantState;
  }

  public broadcastVoiceState(): void {
    const participants = Array.from(this.voiceParticipants.values());
    this.broadcast({
      type: "ROOM_VOICE_STATE_UPDATED",
      payload: {
        participants,
        videoDisabledForRoom: this.videoDisabledForRoom,
      },
    });
  }

  public muteVoiceParticipant(actorUserId: string, targetUserId: string): boolean {
    const target = this.voiceParticipants.get(targetUserId);
    if (target) {
      target.audioMuted = true;
    }
    const member = this.members.get(targetUserId);
    if (member) {
      member.isMuted = true;
    }
    auditLogger.log({
      type: "VOICE_PARTICIPANT_MUTED",
      actorId: actorUserId,
      targetId: targetUserId,
      outcome: "SUCCESS",
      details: { roomId: this.roomId, roomCode: this.roomCode },
    });
    this.broadcastVoiceState();
    return true;
  }

  public removeVoiceParticipant(actorUserId: string, targetUserId: string): boolean {
    this.voiceParticipants.delete(targetUserId);
    auditLogger.log({
      type: "VOICE_PARTICIPANT_REMOVED",
      actorId: actorUserId,
      targetId: targetUserId,
      outcome: "SUCCESS",
      details: { roomId: this.roomId, roomCode: this.roomCode },
    });
    this.broadcastVoiceState();
    return true;
  }

  public setRoomVideoDisabled(actorUserId: string, disabled: boolean): boolean {
    this.videoDisabledForRoom = disabled;
    if (disabled) {
      for (const p of this.voiceParticipants.values()) {
        p.videoEnabled = false;
      }
    }
    this.broadcastVoiceState();
    return true;
  }

  public setMediaService(service: any): void {
    this.mediaService = service;
  }

  public getRecordingState(): RoomRecordingState {
    return { ...this.recordingState };
  }

  public requestRecording(actorUserId: string): { success: boolean; error?: string } {
    if (!this.hasPermission(actorUserId, "manage_settings")) {
      return { success: false, error: "Only the host or moderators can request room recording." };
    }

    this.recordingState = {
      isRecording: false,
      consentRequired: true,
      requestedBy: actorUserId,
      requestedAt: Date.now(),
      consentedUserIds: [actorUserId],
      deniedUserIds: [],
    };

    const connectedMembers = Array.from(this.members.values()).filter((m) => m.isConnected);
    if (connectedMembers.length <= 1) {
      this.recordingState.isRecording = true;
      this.broadcast({
        type: "ROOM_RECORDING_STARTED",
        payload: {
          isRecording: true,
          requestedBy: actorUserId,
          bannerText: "🔴 REC: This room is being recorded. Explicit consent confirmed by all members.",
        },
      });
      return { success: true };
    }

    this.broadcast({
      type: "ROOM_RECORDING_REQUESTED",
      payload: {
        requestedBy: actorUserId,
        bannerText: "⚠️ Recording requested by room host. Explicit consent from everyone in the room is required.",
      },
    });

    return { success: true };
  }

  public submitRecordingConsent(
    userId: string,
    consentGranted: boolean
  ): { success: boolean; isRecording: boolean; aborted?: boolean } {
    if (!this.members.has(userId)) {
      return { success: false, isRecording: this.recordingState.isRecording };
    }

    if (!consentGranted) {
      if (!this.recordingState.deniedUserIds.includes(userId)) {
        this.recordingState.deniedUserIds.push(userId);
      }
      this.recordingState.isRecording = false;
      this.broadcast({
        type: "ROOM_RECORDING_ABORTED",
        payload: {
          reason: "Recording aborted: explicit consent was denied by a room member.",
          deniedByUserId: userId,
        },
      });
      return { success: true, isRecording: false, aborted: true };
    }

    if (!this.recordingState.consentedUserIds.includes(userId)) {
      this.recordingState.consentedUserIds.push(userId);
    }

    const connectedUserIds = Array.from(this.members.values())
      .filter((m) => m.isConnected)
      .map((m) => m.userId);

    const allConsented = connectedUserIds.every((id) =>
      this.recordingState.consentedUserIds.includes(id)
    );

    if (allConsented) {
      this.recordingState.isRecording = true;
      this.broadcast({
        type: "ROOM_RECORDING_STARTED",
        payload: {
          isRecording: true,
          requestedBy: this.recordingState.requestedBy,
          bannerText: "🔴 REC: This room is being recorded. Explicit consent confirmed by all members.",
        },
      });
      return { success: true, isRecording: true };
    }

    return { success: true, isRecording: false };
  }

  public stopRecording(actorUserId: string): boolean {
    if (!this.recordingState.isRecording && !this.recordingState.requestedBy) {
      return false;
    }
    this.recordingState.isRecording = false;
    this.recordingState.requestedBy = undefined;
    this.recordingState.consentedUserIds = [];
    this.recordingState.deniedUserIds = [];
    this.broadcast({
      type: "ROOM_RECORDING_STOPPED",
      payload: {
        stoppedBy: actorUserId,
        bannerText: "Recording has ended.",
      },
    });
    return true;
  }

  public removeMember(userId: string): { newHostId?: string } {
    const member = this.members.get(userId);
    if (!member) return {};

    if (this.voiceParticipants.has(userId)) {
      this.voiceParticipants.delete(userId);
      this.broadcastVoiceState();
    }
    if (this.mediaService) {
      this.mediaService.revokeUserTokens(this.roomCode, userId);
    }

    const wasHost = member.isHost;
    this.members.delete(userId);
    this.version++;

    let newHostId: string | undefined;
    if (wasHost && this.members.size > 0) {
      const candidate = this.getLongestPresentMember();
      if (candidate) {
        candidate.isHost = true;
        this.hostId = candidate.userId;
        newHostId = candidate.userId;
      }
    }

    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_MEMBER_LEFT",
      payload: { userId, newHostId },
      serverTimeMs: Date.now(),
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "ROOM_MEMBER_LEFT",
      version: this.version,
      payload: { userId, newHostId },
    });

    this.emitSystemMessage(`${member.userName} left the party`);

    if (newHostId) {
      this.broadcastHostChanged(newHostId, userId, "automatic_promotion");
    }

    if (this.e2eeEnabled && this.members.size > 0) {
      this.triggerE2eeKeyRotation("member_left");
    }

    if (this.activeScreenSharerId === userId) {
      this.stopScreenShare(userId, undefined, "sharer_left");
    }
    this.approvedScreenSharers.delete(userId);

    const activeCount = Array.from(this.members.values()).filter((m) => m.isConnected).length;
    if (activeCount === 0) {
      this.startIdleTimer();
    }

    return { newHostId };
  }

  // ==========================================
  // HOST PROMOTION & TRANSFERS
  // ==========================================

  public manualTransferHost(
    currentHostUserId: string,
    clientSeq: number,
    targetUserId: string
  ): { success: true } | { success: false; code: string; message: string } {
    const currentHost = this.members.get(currentHostUserId);
    if (!currentHost || !currentHost.isHost) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Only the current host can transfer room ownership",
      };
    }

    const target = this.members.get(targetUserId);
    if (!target) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Target user is not a member of this room",
      };
    }

    if (currentHostUserId === targetUserId) {
      return { success: true };
    }

    currentHost.isHost = false;
    target.isHost = true;
    this.hostId = targetUserId;

    this.version++;
    const now = Date.now();
    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_HOST_CHANGED",
      payload: {
        newHostId: targetUserId,
        previousHostId: currentHostUserId,
        reason: "manual",
      },
      serverTimeMs: now,
      causedBy: { userId: currentHostUserId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcastHostChanged(targetUserId, currentHostUserId, "manual");
    this.emitSystemMessage(`${currentHost.userName} transferred host controls to ${target.userName}`);
    if (this.e2eeEnabled) {
      this.triggerE2eeKeyRotation("host_changed");
    }
    return { success: true };
  }

  private startHostGraceTimer(): void {
    if (this.hostDisconnectTimer) {
      clearTimeout(this.hostDisconnectTimer);
    }

    this.hostDisconnectTimer = setTimeout(() => {
      this.hostDisconnectTimer = null;
      const currentHost = this.members.get(this.hostId);
      if (currentHost && !currentHost.isConnected) {
        // Promote longest-present active member
        const candidate = this.getLongestPresentConnectedMember();
        if (candidate && candidate.userId !== this.hostId) {
          const oldHostId = this.hostId;
          currentHost.isHost = false;
          candidate.isHost = true;
          this.hostId = candidate.userId;

          this.version++;
          const now = Date.now();
          const event: RoomEvent = {
            version: this.version,
            type: "ROOM_HOST_CHANGED",
            payload: {
              newHostId: candidate.userId,
              previousHostId: oldHostId,
              reason: "automatic_promotion",
            },
            serverTimeMs: now,
          };
          this.ringBuffer.push(event);
          this.broadcastHostChanged(candidate.userId, oldHostId, "automatic_promotion");
          this.emitSystemMessage(`${candidate.userName} is now the room host`);
          if (this.e2eeEnabled) {
            this.triggerE2eeKeyRotation("host_changed");
          }
        }
      }
    }, this.hostGraceMs);
  }

  private getLongestPresentConnectedMember(): RoomMemberInternal | undefined {
    let best: RoomMemberInternal | undefined;
    for (const m of this.members.values()) {
      if (m.isConnected) {
        if (!best || m.joinedAt < best.joinedAt) {
          best = m;
        }
      }
    }
    return best;
  }

  private getLongestPresentMember(): RoomMemberInternal | undefined {
    let best: RoomMemberInternal | undefined;
    for (const m of this.members.values()) {
      if (!best || m.joinedAt < best.joinedAt) {
        best = m;
      }
    }
    return best;
  }

  // ==========================================
  // ACCESS CONTROL, MODERATION & PERMISSION MATRIX
  // ==========================================

  public broadcastToStaff(message: ServerMessage): void {
    for (const member of this.members.values()) {
      if (member.isHost || member.role === "moderator") {
        if (member.connection && member.isConnected) {
          try {
            member.connection.send(message);
          } catch {
            // Socket closed
          }
        }
      }
    }
  }

  public hasPermission(userId: string, permission: RoomPermission): boolean {
    const member = this.members.get(userId);
    if (!member) return false;
    if (member.isHost) return true;

    if (permission === "control_playback") {
      if (this.controlMode === "host_only" && member.role !== "host" && member.role !== "moderator") {
        return false;
      }
    }

    const role = member.role || (member.isHost ? "host" : "member");
    return Boolean(this.permissionMatrix[role]?.[permission]);
  }

  public canModerateTarget(actorId: string, targetId: string): boolean {
    if (actorId === targetId) return false;
    const actor = this.members.get(actorId);
    const target = this.members.get(targetId);
    if (!actor || !target) return false;
    if (target.isHost) return false; // Host can never be moderated
    if (actor.isHost) return true;   // Host can moderate anyone
    if (actor.role === "moderator") {
      // Moderator can moderate members and guests, but not other moderators
      return target.role !== "moderator";
    }
    return false;
  }

  public kickMember(
    actorId: string,
    clientSeq: number,
    targetUserId: string,
    reason?: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "kick")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to kick members",
      };
    }

    if (actorId === targetUserId) {
      return {
        success: false,
        code: ERROR_CODES.INVALID_ACTION,
        message: "You cannot kick yourself",
      };
    }

    if (!this.canModerateTarget(actorId, targetUserId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You cannot kick a member with equal or higher role",
      };
    }

    const target = this.members.get(targetUserId);
    if (!target) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Target member not found in room",
      };
    }

    if (target.connection) {
      try {
        target.connection.send({
          type: "ERROR",
          code: "KICKED_FROM_ROOM",
          message: reason ? `You were removed from the room: ${reason}` : "You were removed from the room by a moderator",
        });
        target.connection.close(WS_CLOSE_CODES.USER_KICKED, "Kicked from room");
      } catch {
        // Socket closed
      }
    }

    if (this.voiceParticipants.has(targetUserId)) {
      this.voiceParticipants.delete(targetUserId);
      this.broadcastVoiceState();
    }
    if (this.mediaService) {
      this.mediaService.revokeUserTokens(this.roomCode, targetUserId);
    }

    this.members.delete(targetUserId);
    this.version++;
    const now = Date.now();

    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_MEMBER_LEFT",
      payload: { userId: targetUserId },
      serverTimeMs: now,
      causedBy: { userId: actorId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "ROOM_MEMBER_LEFT",
      version: this.version,
      payload: { userId: targetUserId },
    });

    const actor = this.members.get(actorId);
    this.emitSystemMessage(`${target.userName} was removed from the room by ${actor?.userName || "a moderator"}`);

    auditLogger.log({
      type: "ROOM_MEMBER_KICKED",
      outcome: "SUCCESS",
      actorId,
      targetId: targetUserId,
      details: { roomId: this.roomId, reason },
    });

    if (this.e2eeEnabled && this.members.size > 0) {
      this.triggerE2eeKeyRotation("member_kicked");
    }

    const activeCount = Array.from(this.members.values()).filter((m) => m.isConnected).length;
    if (activeCount === 0) {
      this.startIdleTimer();
    }

    return { success: true, version: this.version };
  }

  public banMember(
    actorId: string,
    clientSeq: number,
    targetUserId: string,
    banType: "account" | "session" | "both" | string = "both",
    reason?: string,
    durationSeconds?: number
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "ban")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to ban members",
      };
    }

    if (actorId === targetUserId) {
      return {
        success: false,
        code: ERROR_CODES.INVALID_ACTION,
        message: "You cannot ban yourself",
      };
    }

    if (!this.canModerateTarget(actorId, targetUserId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You cannot ban a member with equal or higher role",
      };
    }

    const target = this.members.get(targetUserId);
    if (!target) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Target member not found in room",
      };
    }

    let resolvedBanType: "account" | "session" | "both" = "both";
    let resolvedReason = reason;
    if (banType !== "account" && banType !== "session" && banType !== "both") {
      resolvedReason = banType;
      resolvedBanType = "both";
    } else {
      resolvedBanType = banType;
    }

    const expiresAt = durationSeconds && durationSeconds > 0 ? Date.now() + durationSeconds * 1000 : null;

    // Ban tracking
    this.bannedUserIds.add(targetUserId);
    if ((resolvedBanType === "session" || resolvedBanType === "both") && target.sessionToken) {
      this.bannedSessionTokens.add(target.sessionToken);
    }
    if ((resolvedBanType === "account" || resolvedBanType === "both") && target.accountId) {
      this.bannedAccountIds.add(target.accountId);
    }

    const banRecord: RoomBan = {
      id: generateId("ban"),
      userId: targetUserId,
      accountId: target.accountId,
      sessionToken: target.sessionToken,
      userName: target.userName,
      reason: resolvedReason,
      bannedBy: actorId,
      bannedAt: Date.now(),
      expiresAt,
    };
    this.bans.set(banRecord.id, banRecord);

    if (target.connection) {
      try {
        target.connection.send({
          type: "ERROR",
          code: ERROR_CODES.USER_BANNED,
          message: resolvedReason ? `You were banned from the room: ${resolvedReason}` : "You were banned from the room",
        });
        target.connection.close(WS_CLOSE_CODES.USER_BANNED, "Banned from room");
      } catch {
        // Socket closed
      }
    }

    if (this.voiceParticipants.has(targetUserId)) {
      this.voiceParticipants.delete(targetUserId);
      this.broadcastVoiceState();
    }
    if (this.mediaService) {
      this.mediaService.revokeUserTokens(this.roomCode, targetUserId);
    }

    this.members.delete(targetUserId);
    this.version++;
    const now = Date.now();

    const banEvent: RoomEvent = {
      version: this.version,
      type: "ROOM_MEMBER_BANNED",
      payload: {
        userId: targetUserId,
        userName: target.userName,
        bannedBy: actorId,
        reason,
      },
      serverTimeMs: now,
      causedBy: { userId: actorId, clientSeq },
    };
    this.ringBuffer.push(banEvent);

    this.broadcast({
      type: "ROOM_MEMBER_BANNED",
      version: this.version,
      payload: {
        userId: targetUserId,
        userName: target.userName,
        bannedBy: actorId,
        reason,
      },
    });

    this.broadcast({
      type: "ROOM_MEMBER_LEFT",
      version: this.version,
      payload: { userId: targetUserId },
    });

    const actor = this.members.get(actorId);
    this.emitSystemMessage(`${target.userName} was banned from the room by ${actor?.userName || "a moderator"}`);

    auditLogger.log({
      type: "ROOM_MEMBER_BANNED",
      outcome: "SUCCESS",
      actorId,
      targetId: targetUserId,
      details: { roomId: this.roomId, banType, reason },
    });

    if (this.e2eeEnabled && this.members.size > 0) {
      this.triggerE2eeKeyRotation("member_kicked");
    }

    const activeCount = Array.from(this.members.values()).filter((m) => m.isConnected).length;
    if (activeCount === 0) {
      this.startIdleTimer();
    }

    return { success: true, version: this.version };
  }

  public unbanMember(
    actorId: string,
    clientSeq: number,
    targetIdentifier: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "ban")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to unban members",
      };
    }

    this.bannedUserIds.delete(targetIdentifier);
    this.bannedAccountIds.delete(targetIdentifier);
    this.bannedSessionTokens.delete(targetIdentifier);

    for (const [id, ban] of this.bans.entries()) {
      if (
        ban.userId === targetIdentifier ||
        ban.accountId === targetIdentifier ||
        ban.sessionToken === targetIdentifier ||
        id === targetIdentifier
      ) {
        this.bannedUserIds.delete(ban.userId);
        if (ban.accountId) this.bannedAccountIds.delete(ban.accountId);
        if (ban.sessionToken) this.bannedSessionTokens.delete(ban.sessionToken);
        this.bans.delete(id);
      }
    }

    this.version++;
    const now = Date.now();

    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_MEMBER_UNBANNED",
      payload: { identifier: targetIdentifier, unbannedBy: actorId },
      serverTimeMs: now,
      causedBy: { userId: actorId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "ROOM_MEMBER_UNBANNED",
      version: this.version,
      payload: { identifier: targetIdentifier, unbannedBy: actorId },
    });

    auditLogger.log({
      type: "ROOM_MEMBER_UNBANNED",
      outcome: "SUCCESS",
      actorId,
      targetId: targetIdentifier,
      details: { roomId: this.roomId },
    });

    return { success: true, version: this.version };
  }

  public unbanUser(
    actorId: string,
    clientSeq: number,
    targetIdentifier: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    return this.unbanMember(actorId, clientSeq, targetIdentifier);
  }

  public muteMember(
    actorId: string,
    clientSeq: number,
    targetUserId: string,
    durationSeconds?: number,
    reason?: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "mute")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to mute members",
      };
    }

    if (actorId === targetUserId) {
      return {
        success: false,
        code: ERROR_CODES.INVALID_ACTION,
        message: "You cannot mute yourself",
      };
    }

    if (!this.canModerateTarget(actorId, targetUserId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You cannot mute a member with equal or higher role",
      };
    }

    const target = this.members.get(targetUserId);
    if (!target) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Target member not found in room",
      };
    }

    target.isMuted = true;
    const now = Date.now();
    const mutedUntil = durationSeconds ? now + durationSeconds * 1000 : null;

    const muteRecord: MuteRecord = {
      userId: targetUserId,
      userName: target.userName,
      mutedBy: actorId,
      mutedAt: now,
      mutedUntil,
      reason,
    };
    this.mutes.set(targetUserId, muteRecord);

    this.version++;
    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_MEMBER_MUTED",
      payload: {
        userId: targetUserId,
        userName: target.userName,
        mutedBy: actorId,
        mutedUntil,
        reason,
      },
      serverTimeMs: now,
      causedBy: { userId: actorId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "ROOM_MEMBER_MUTED",
      version: this.version,
      payload: {
        userId: targetUserId,
        userName: target.userName,
        mutedBy: actorId,
        mutedUntil,
        reason,
      },
    });

    const actor = this.members.get(actorId);
    this.emitSystemMessage(
      `${target.userName} was muted by ${actor?.userName || "a moderator"}${durationSeconds ? ` for ${durationSeconds}s` : ""}`
    );

    auditLogger.log({
      type: "ROOM_MEMBER_MUTED",
      outcome: "SUCCESS",
      actorId,
      targetId: targetUserId,
      details: { roomId: this.roomId, durationSeconds, reason },
    });

    return { success: true, version: this.version };
  }

  public unmuteMember(
    actorId: string,
    clientSeq: number,
    targetUserId: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "mute")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to unmute members",
      };
    }

    const target = this.members.get(targetUserId);
    if (target) {
      target.isMuted = false;
    }
    this.mutes.delete(targetUserId);

    this.version++;
    const now = Date.now();

    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_MEMBER_UNMUTED",
      payload: {
        userId: targetUserId,
        userName: target?.userName || targetUserId,
        unmutedBy: actorId,
      },
      serverTimeMs: now,
      causedBy: { userId: actorId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "ROOM_MEMBER_UNMUTED",
      version: this.version,
      payload: {
        userId: targetUserId,
        userName: target?.userName || targetUserId,
        unmutedBy: actorId,
      },
    });

    auditLogger.log({
      type: "ROOM_MEMBER_UNMUTED",
      outcome: "SUCCESS",
      actorId,
      targetId: targetUserId,
      details: { roomId: this.roomId },
    });

    return { success: true, version: this.version };
  }

  public assignRole(
    actorId: string,
    clientSeq: number,
    targetUserId: string,
    role: "moderator" | "member" | "guest"
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "manage_roles")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Only the host can assign roles",
      };
    }

    if (targetUserId === this.hostId) {
      return {
        success: false,
        code: ERROR_CODES.INVALID_ACTION,
        message: "Host role cannot be altered through role assignment",
      };
    }

    const target = this.members.get(targetUserId);
    if (!target) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Target member not found in room",
      };
    }

    target.role = role;
    this.version++;
    const now = Date.now();

    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_ROLE_ASSIGNED",
      payload: {
        userId: targetUserId,
        userName: target.userName,
        role,
        assignedBy: actorId,
      },
      serverTimeMs: now,
      causedBy: { userId: actorId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "ROOM_ROLE_ASSIGNED",
      version: this.version,
      payload: {
        userId: targetUserId,
        userName: target.userName,
        role,
        assignedBy: actorId,
      },
    });

    this.emitSystemMessage(`${target.userName} is now a ${role}`);

    auditLogger.log({
      type: "ROLE_ASSIGNED",
      outcome: "SUCCESS",
      actorId,
      targetId: targetUserId,
      details: { roomId: this.roomId, role },
    });

    return { success: true, version: this.version };
  }

  public setMemberRole(
    actorId: string,
    clientSeq: number,
    targetUserId: string,
    role: "moderator" | "member" | "guest"
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    return this.assignRole(actorId, clientSeq, targetUserId, role);
  }

  public deleteChatMessage(
    actorId: string,
    clientSeq: number,
    messageId: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    const msg = this.chatHistory.find((m) => m.id === messageId);
    if (!msg) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Chat message not found",
      };
    }

    const isAuthor = msg.userId === actorId;
    if (!isAuthor && !this.hasPermission(actorId, "delete_message")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to delete this message",
      };
    }

    msg.isDeleted = true;
    msg.deletedBy = actorId;
    msg.text = "[Message deleted by moderator]";

    this.version++;
    const now = Date.now();

    const event: RoomEvent = {
      version: this.version,
      type: "CHAT_MESSAGE_DELETED",
      payload: { messageId, deletedBy: actorId },
      serverTimeMs: now,
      causedBy: { userId: actorId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "CHAT_MESSAGE_DELETED",
      version: this.version,
      payload: { messageId, deletedBy: actorId },
    });

    auditLogger.log({
      type: "CHAT_MESSAGE_DELETED",
      outcome: "SUCCESS",
      actorId,
      details: { roomId: this.roomId, messageId },
    });

    return { success: true, version: this.version };
  }

  public toggleRoomLock(
    actorId: string,
    clientSeq: number,
    isLocked: boolean
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "lock_room")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to lock/unlock this room",
      };
    }

    this.isLocked = isLocked;
    this.version++;
    const now = Date.now();

    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_LOCK_UPDATED",
      payload: { isLocked, updatedBy: actorId },
      serverTimeMs: now,
      causedBy: { userId: actorId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "ROOM_LOCK_UPDATED",
      version: this.version,
      payload: { isLocked, updatedBy: actorId },
    });

    const actor = this.members.get(actorId);
    this.emitSystemMessage(
      `Room has been ${isLocked ? "locked" : "unlocked"} by ${actor?.userName || "a moderator"}`
    );

    auditLogger.log({
      type: isLocked ? "ROOM_LOCKED" : "ROOM_UNLOCKED",
      outcome: "SUCCESS",
      actorId,
      details: { roomId: this.roomId },
    });

    return { success: true, version: this.version };
  }

  public lockRoom(
    actorId: string,
    clientSeq: number,
    isLocked: boolean
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    return this.toggleRoomLock(actorId, clientSeq, isLocked);
  }

  public approveWaitingRequest(
    actorId: string,
    clientSeq: number,
    requestId: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "manage_waiting_room")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to manage waiting room requests",
      };
    }

    const request = this.waitingRequests.get(requestId);
    if (!request) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Waiting request not found or already resolved",
      };
    }

    if (this.members.size >= this.maxMembers) {
      return {
        success: false,
        code: ERROR_CODES.ROOM_FULL,
        message: "Room is at maximum member capacity",
      };
    }

    this.waitingRequests.delete(requestId);
    const conn = this.waitingConnections.get(requestId);
    this.waitingConnections.delete(requestId);

    const sessionToken = generateSessionToken();
    const now = Date.now();
    const member: RoomMemberInternal = {
      userId: request.userId,
      userName: request.userName,
      role: "member",
      isHost: false,
      isConnected: Boolean(conn),
      isBuffering: false,
      isMuted: false,
      accountId: request.accountId,
      joinedAt: now,
      lastSeenAt: now,
      sessionToken,
      connection: conn,
    };

    this.members.set(request.userId, member);
    this.version++;

    const memberPublic = this.toPublicMember(member);
    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_MEMBER_JOINED",
      payload: { member: memberPublic },
      serverTimeMs: now,
      causedBy: { userId: request.userId },
    };
    this.ringBuffer.push(event);

    this.broadcastExcept(request.userId, {
      type: "ROOM_MEMBER_JOINED",
      version: this.version,
      payload: { member: memberPublic },
    });

    this.broadcastToStaff({
      type: "WAITING_ROOM_REQUEST_RESOLVED",
      version: this.version,
      payload: { requestId, action: "approved", resolvedBy: actorId },
    });

    if (conn) {
      conn.roomId = this.roomId;
      conn.userId = request.userId;
      conn.send({
        type: "ROOM_SNAPSHOT",
        version: this.version,
        payload: this.getSnapshot(request.userId, sessionToken),
      });
    }

    this.emitSystemMessage(`${request.userName} was approved to join the party`);

    auditLogger.log({
      type: "WAITING_ROOM_APPROVED",
      outcome: "SUCCESS",
      actorId,
      targetId: request.userId,
      details: { roomId: this.roomId, requestId },
    });

    return { success: true, version: this.version };
  }

  public denyWaitingRequest(
    actorId: string,
    clientSeq: number,
    requestId: string,
    reason?: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "manage_waiting_room")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to manage waiting room requests",
      };
    }

    const request = this.waitingRequests.get(requestId);
    if (!request) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Waiting request not found or already resolved",
      };
    }

    this.waitingRequests.delete(requestId);
    const conn = this.waitingConnections.get(requestId);
    this.waitingConnections.delete(requestId);

    if (conn) {
      try {
        conn.send({
          type: "ERROR",
          code: ERROR_CODES.JOIN_REQUEST_DENIED,
          message: reason || "Your request to join the room was denied by a moderator",
        });
        conn.close(4003, "Join request denied");
      } catch {
        // Socket closed
      }
    }

    this.broadcastToStaff({
      type: "WAITING_ROOM_REQUEST_RESOLVED",
      version: this.version,
      payload: { requestId, action: "denied", resolvedBy: actorId },
    });

    auditLogger.log({
      type: "WAITING_ROOM_DENIED",
      outcome: "SUCCESS",
      actorId,
      targetId: request.userId,
      details: { roomId: this.roomId, requestId, reason },
    });

    return { success: true, version: this.version };
  }

  public createModerationReport(
    reporterUserId: string,
    payload: {
      targetType: "user" | "message";
      targetUserId: string;
      targetMessageId?: string;
      reason: string;
      description?: string;
    }
  ): { success: true; report: ModerationReport } | { success: false; code: string; message: string } {
    const reporter = this.members.get(reporterUserId);
    if (!reporter) {
      return {
        success: false,
        code: ERROR_CODES.NOT_IN_ROOM,
        message: "You must be in the room to submit a report",
      };
    }

    const targetUser = this.members.get(payload.targetUserId);
    const targetUserName = targetUser?.userName || "Unknown User";

    let reportedMessageText: string | undefined;
    let chatContext: ChatMessage[] = [];

    if (payload.targetMessageId) {
      const idx = this.chatHistory.findIndex((m) => m.id === payload.targetMessageId);
      if (idx !== -1) {
        reportedMessageText = this.chatHistory[idx].text;
        const start = Math.max(0, idx - 5);
        const end = Math.min(this.chatHistory.length, idx + 6);
        chatContext = this.chatHistory.slice(start, end);
      }
    } else {
      chatContext = this.chatHistory.slice(-10);
    }

    const report: ModerationReport = {
      id: generateId("rep"),
      roomId: this.roomId,
      roomCode: this.roomCode,
      roomName: this.roomName,
      reporterUserId,
      reporterUserName: reporter.userName,
      reporterAccountId: reporter.accountId,
      targetType: payload.targetType,
      targetUserId: payload.targetUserId,
      targetUserName,
      targetAccountId: targetUser?.accountId,
      targetMessageId: payload.targetMessageId,
      reportedMessageText,
      reason: payload.reason,
      description: payload.description,
      chatContext,
      createdAt: Date.now(),
      status: "pending",
    };

    this.reports.set(report.id, report);

    this.broadcastToStaff({
      type: "MODERATION_REPORT_CREATED",
      payload: { report },
    });

    auditLogger.log({
      type: "MODERATION_REPORT_CREATED",
      outcome: "SUCCESS",
      actorId: reporterUserId,
      targetId: payload.targetUserId,
      details: {
        roomId: this.roomId,
        targetType: payload.targetType,
        reason: payload.reason,
        reportId: report.id,
      },
    });

    return { success: true, report };
  }

  public createInviteLink(
    actorId: string,
    options?: { expiresInSeconds?: number; maxUses?: number; role?: Role }
  ): { success: true; inviteLink: RoomInviteLink } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "manage_invites")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to create invite links",
      };
    }

    const inviteId = generateId("inv");
    const expiresAt = options?.expiresInSeconds ? Date.now() + options.expiresInSeconds * 1000 : null;
    const maxUses = options?.maxUses ?? null;

    const inviteLink: RoomInviteLink = {
      id: inviteId,
      roomId: this.roomId,
      roomCode: this.roomCode,
      createdByUserId: actorId,
      createdAt: Date.now(),
      expiresAt,
      maxUses,
      useCount: 0,
      isRevoked: false,
      role: options?.role || "member",
    };

    this.inviteLinks.set(inviteId, inviteLink);

    auditLogger.log({
      type: "INVITE_LINK_CREATED",
      outcome: "SUCCESS",
      actorId,
      details: { roomId: this.roomId, inviteId, expiresAt, maxUses },
    });

    return { success: true, inviteLink };
  }

  public revokeInviteLink(
    actorId: string,
    inviteId: string
  ): { success: true } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "manage_invites")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to revoke invite links",
      };
    }

    const link = this.inviteLinks.get(inviteId);
    if (!link) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Invite link not found",
      };
    }

    link.isRevoked = true;

    this.broadcastToStaff({
      type: "INVITE_LINK_REVOKED",
      version: this.version,
      payload: { inviteId, revokedBy: actorId },
    });

    auditLogger.log({
      type: "INVITE_LINK_REVOKED",
      outcome: "SUCCESS",
      actorId,
      details: { roomId: this.roomId, inviteId },
    });

    return { success: true };
  }

  public regenerateInviteLink(
    actorId: string,
    inviteId: string,
    options?: { expiresInSeconds?: number; maxUses?: number }
  ): { success: true; inviteLink: RoomInviteLink } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "manage_invites")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to regenerate invite links",
      };
    }

    const oldLink = this.inviteLinks.get(inviteId);
    if (!oldLink) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Original invite link not found",
      };
    }

    oldLink.isRevoked = true;

    const newInviteId = generateId("inv");
    const expiresInSeconds = options?.expiresInSeconds;
    const expiresAt = expiresInSeconds ? Date.now() + expiresInSeconds * 1000 : oldLink.expiresAt;
    const maxUses = options?.maxUses ?? oldLink.maxUses;

    const newLink: RoomInviteLink = {
      id: newInviteId,
      roomId: this.roomId,
      roomCode: this.roomCode,
      createdByUserId: actorId,
      createdAt: Date.now(),
      expiresAt,
      maxUses,
      useCount: 0,
      isRevoked: false,
      role: oldLink.role,
    };

    this.inviteLinks.set(newInviteId, newLink);

    auditLogger.log({
      type: "INVITE_LINK_REGENERATED",
      outcome: "SUCCESS",
      actorId,
      details: { roomId: this.roomId, oldInviteId: inviteId, newInviteId },
    });

    return { success: true, inviteLink: newLink };
  }

  public getBans(): RoomBan[] {
    this.cleanExpiredBans();
    return Array.from(this.bans.values());
  }

  public getMutes(): MuteRecord[] {
    return Array.from(this.mutes.values());
  }

  public getReports(): ModerationReport[] {
    return Array.from(this.reports.values());
  }

  public getInviteLinks(): RoomInviteLink[] {
    return Array.from(this.inviteLinks.values());
  }

  public getWaitingRequests(): WaitingJoinRequest[] {
    return Array.from(this.waitingRequests.values());
  }

  public triggerE2eeKeyRotation(reason: "member_left" | "member_kicked" | "host_changed"): void {
    if (!this.e2eeEnabled) return;
    this.e2eeKeyVersion++;
    this.broadcast({
      type: "ROOM_E2EE_KEY_ROTATED",
      version: this.version,
      payload: {
        keyVersion: this.e2eeKeyVersion,
        reason,
      },
    });
  }

  public distributeE2eeKeyPackages(
    hostUserId: string,
    keyVersion: number,
    packages: Array<{ targetUserId: string; wrappedKey: string; iv: string }>
  ): { success: true } | { success: false; code: string; message: string } {
    if (!this.e2eeEnabled) {
      return { success: false, code: ERROR_CODES.INVALID_ACTION, message: "E2EE is not enabled for this room" };
    }
    const hostMember = this.members.get(hostUserId);
    if (!hostMember || !hostMember.isHost) {
      return { success: false, code: ERROR_CODES.PERMISSION_DENIED, message: "Only the host can distribute E2EE room keys" };
    }
    this.e2eeKeyVersion = Math.max(this.e2eeKeyVersion, keyVersion);
    const hostPublicKey = hostMember.e2eePublicKey || "";

    for (const pkg of packages) {
      const targetMember = this.members.get(pkg.targetUserId);
      if (targetMember && targetMember.isConnected && targetMember.connection) {
        try {
          targetMember.connection.send({
            type: "ROOM_E2EE_KEY_PACKAGE",
            version: this.version,
            payload: {
              keyVersion: this.e2eeKeyVersion,
              hostUserId,
              hostPublicKey,
              wrappedKey: pkg.wrappedKey,
              iv: pkg.iv,
            },
          });
        } catch {
          // ignore socket write failure
        }
      }
    }
    return { success: true };
  }

  public broadcastEncryptedChat(
    userId: string,
    clientSeq: number,
    ciphertext: string,
    iv: string,
    keyVersion: number
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.e2eeEnabled) {
      return {
        success: false,
        code: ERROR_CODES.INVALID_ACTION,
        message: "E2EE is not enabled for this room",
      };
    }
    const member = this.members.get(userId);
    if (!member) {
      return {
        success: false,
        code: ERROR_CODES.NOT_IN_ROOM,
        message: "You are not a member of this room",
      };
    }

    const mute = this.mutes.get(userId);
    if (mute) {
      if (mute.mutedUntil === null || Date.now() < mute.mutedUntil) {
        return {
          success: false,
          code: ERROR_CODES.USER_MUTED,
          message: "You are currently muted in this room",
        };
      } else {
        this.mutes.delete(userId);
        member.isMuted = false;
      }
    }

    const now = Date.now();
    let rateRecord = this.userChatRates.get(userId);
    if (!rateRecord || now > rateRecord.resetTime) {
      rateRecord = { count: 0, resetTime: now + 3000 };
      this.userChatRates.set(userId, rateRecord);
    }
    if (rateRecord.count >= 5) {
      return {
        success: false,
        code: ERROR_CODES.RATE_LIMITED,
        message: "Chat rate limit exceeded. Please wait a moment before sending another message.",
      };
    }
    rateRecord.count++;

    const msgId = generateId("msg");
    this.version++;

    // Add unreadable placeholder to server history for late-joiner offset comparison
    const encryptedPlaceholder: ChatMessage = {
      id: msgId,
      userId,
      userName: member.userName,
      text: "[Encrypted Message]",
      serverTimestampMs: now,
      isSystem: false,
    };
    this.pruneExpiredChat(now);
    this.chatHistory.push(encryptedPlaceholder);
    if (this.chatHistory.length > 100) {
      this.chatHistory.shift();
    }

    this.broadcast({
      type: "CHAT_BROADCAST_ENCRYPTED",
      version: this.version,
      payload: {
        id: msgId,
        userId,
        userName: member.userName,
        ciphertext,
        iv,
        keyVersion,
        serverTimestampMs: now,
      },
    });

    return { success: true, version: this.version };
  }

  private broadcastHostChanged(
    newHostId: string,
    previousHostId: string,
    reason: "manual" | "automatic_promotion"
  ): void {
    this.broadcast({
      type: "ROOM_HOST_CHANGED",
      version: this.version,
      payload: {
        newHostId,
        previousHostId,
        reason,
      },
    });
  }

  // ==========================================
  // PLAYBACK COMMANDS & CONCURRENCY
  // ==========================================

  public rememberSourcePosition(videoIdOrRef: string, positionMs: number, updatedBy?: string): void {
    if (!videoIdOrRef) return;
    const pos = Math.max(0, Math.floor(positionMs));
    this.sourcePlaybackMemory.set(videoIdOrRef, {
      positionMs: pos,
      updatedAt: Date.now(),
      updatedBy,
    });
    if (this.playback?.sourceRef && this.playback.sourceRef !== videoIdOrRef) {
      this.sourcePlaybackMemory.set(this.playback.sourceRef, {
        positionMs: pos,
        updatedAt: Date.now(),
        updatedBy,
      });
    }
  }

  public getRememberedPosition(videoIdOrRef: string): number | null {
    const item = this.sourcePlaybackMemory.get(videoIdOrRef);
    return item ? item.positionMs : null;
  }

  private checkPlaybackPermission(userId: string): boolean {
    return this.hasPermission(userId, "control_playback");
  }

  public applyPlay(
    userId: string,
    clientSeq: number,
    positionMs?: number
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.checkPlaybackPermission(userId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Playback control is restricted to the room host",
      };
    }

    const now = Date.now();
    let startPos = this.playback.positionMs;
    if (typeof positionMs === "number" && positionMs >= 0) {
      startPos = positionMs;
    } else if (this.playback.status === "playing") {
      startPos = derivePlaybackPositionMs(this.playback, now);
    }

    this.playback = {
      ...this.playback,
      status: "playing",
      positionMs: startPos,
      serverTimeMs: now,
      playbackRate: 1.0,
    };

    this.rememberSourcePosition(this.playback.videoId, startPos, userId);

    this.version++;
    const event: RoomEvent = {
      version: this.version,
      type: "PLAYBACK_UPDATE",
      payload: {
        playback: { ...this.playback },
        causedBy: { userId, clientSeq },
        reason: "play",
      },
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcastPlaybackUpdate(userId, clientSeq, "play");
    return { success: true, version: this.version };
  }

  public applyPause(
    userId: string,
    clientSeq: number,
    positionMs?: number
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.checkPlaybackPermission(userId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Playback control is restricted to the room host",
      };
    }

    const now = Date.now();
    let currentPos: number;
    if (typeof positionMs === "number" && positionMs >= 0) {
      currentPos = positionMs;
    } else {
      currentPos = derivePlaybackPositionMs(this.playback, now);
    }

    this.playback = {
      ...this.playback,
      status: "paused",
      positionMs: currentPos,
      serverTimeMs: now,
      playbackRate: 1.0,
    };

    this.rememberSourcePosition(this.playback.videoId, currentPos, userId);

    this.version++;
    const event: RoomEvent = {
      version: this.version,
      type: "PLAYBACK_UPDATE",
      payload: {
        playback: { ...this.playback },
        causedBy: { userId, clientSeq },
        reason: "pause",
      },
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcastPlaybackUpdate(userId, clientSeq, "pause");
    return { success: true, version: this.version };
  }

  public applySeek(
    userId: string,
    clientSeq: number,
    targetPositionMs: number,
    autoPlay?: boolean
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.checkPlaybackPermission(userId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Playback control is restricted to the room host",
      };
    }

    const now = Date.now();
    const newStatus =
      autoPlay !== undefined
        ? autoPlay
          ? "playing"
          : "paused"
        : this.playback.status;

    this.playback = {
      ...this.playback,
      status: newStatus,
      positionMs: Math.max(0, targetPositionMs),
      serverTimeMs: now,
    };

    this.rememberSourcePosition(this.playback.videoId, this.playback.positionMs, userId);

    this.version++;
    const event: RoomEvent = {
      version: this.version,
      type: "PLAYBACK_UPDATE",
      payload: {
        playback: { ...this.playback },
        causedBy: { userId, clientSeq },
        reason: "seek",
      },
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcastPlaybackUpdate(userId, clientSeq, "seek");
    return { success: true, version: this.version };
  }

  public isSourceBlockedSync(urlString: string): { blocked: boolean; warning?: string } {
    const domain = this.urlSafetyChecker.extractDomain(urlString);
    for (const rule of this.sourceBlocklist.values()) {
      if (this.urlSafetyChecker.matchesPattern(domain, rule.pattern) || urlString.includes(rule.pattern)) {
        return { blocked: true, warning: rule.reason || "This domain is on the room host's blocklist." };
      }
    }
    for (const pattern of this.urlSafetyChecker.getPlatformBlocklist()) {
      if (this.urlSafetyChecker.matchesPattern(domain, pattern) || urlString.includes(pattern)) {
        return { blocked: true, warning: "Domain is flagged on the platform security blocklist for malicious content." };
      }
    }
    return { blocked: false };
  }

  public applyChangeVideo(
    userId: string,
    clientSeq: number,
    videoId: string,
    startPositionMs = 0,
    autoPlay = false,
    provider: VideoProvider = "html5",
    sourceRef?: string,
    title?: string,
    author?: string,
    license?: string,
    bypassApproval = false
  ): { success: true; version: number; queued?: boolean; submissionId?: string } | { success: false; code: string; message: string } {
    if (!this.checkPlaybackPermission(userId) && !this.canUserAddSource(userId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Playback control is restricted to the room host",
      };
    }

    const member = this.members.get(userId);
    const targetRef = sourceRef || videoId;

    if (targetRef.startsWith("http:") || targetRef.startsWith("https:")) {
      const blockCheck = this.isSourceBlockedSync(targetRef);
      if (blockCheck.blocked) {
        const domain = this.urlSafetyChecker.extractDomain(targetRef);
        this.recordSourceAudit(
          "blocked",
          userId,
          member ? member.userName : "Guest",
          targetRef,
          domain,
          userId,
          member ? member.userName : "Guest",
          title || videoId,
          provider,
          blockCheck.warning
        );
        return {
          success: false,
          code: "BLOCKED_SOURCE",
          message: blockCheck.warning || "This URL or domain is blocked by room or platform security rules.",
        };
      }
    }

    const isStaff = userId === this.hostId || member?.role === "moderator";

    // If requireLinkApproval is enabled and user is not host/moderator and not approved
    if (!bypassApproval && this.requireLinkApproval && !isStaff && !this.approvedSourceAdders.has(userId)) {
      const submissionId = generateId("src_sub");
      const domain = this.urlSafetyChecker.extractDomain(targetRef);
      const submission: PendingSourceSubmission = {
        id: submissionId,
        userId,
        userName: member ? member.userName : "Guest",
        sourceUrl: targetRef,
        domain,
        title: title || videoId,
        author,
        provider: provider || "html5",
        sourceRef: targetRef,
        durationMs: 0,
        submittedAt: Date.now(),
        actionType: "change_video",
        autoPlay,
        startPositionMs,
        safety: {
          url: targetRef,
          domain,
          safetyLevel: "safe",
          threatTypes: [],
          isSafe: true,
          sourceCheck: "local_blocklist",
          scannedAt: Date.now(),
        },
      };
      this.sourceApprovalQueue.set(submissionId, submission);
      this.recordSourceAudit(
        "submitted",
        userId,
        member ? member.userName : "Guest",
        targetRef,
        domain,
        userId,
        member ? member.userName : "Guest",
        title || videoId,
        provider,
        "Queued for host approval"
      );
      this.broadcastToStaff({
        type: "SOURCE_SUBMISSION_QUEUED",
        version: this.version,
        payload: { submission },
      });
      return { success: true, version: this.version, queued: true, submissionId };
    }

    const now = Date.now();
    const domain = this.urlSafetyChecker.extractDomain(targetRef);

    if (this.playback?.videoId) {
      this.rememberSourcePosition(this.playback.videoId, derivePlaybackPositionMs(this.playback, now), userId);
    }

    this.playback = {
      videoId,
      provider: provider || "html5",
      sourceRef: sourceRef || videoId,
      status: autoPlay ? "playing" : "paused",
      positionMs: Math.max(0, startPositionMs),
      serverTimeMs: now,
      playbackRate: 1.0,
      title: title || videoId,
      author,
      domain,
      originalUrl: targetRef.startsWith("http") ? targetRef : undefined,
      license,
    };

    if (startPositionMs > 0) {
      this.rememberSourcePosition(videoId, startPositionMs, userId);
    }

    this.recordSourceAudit(
      "added",
      userId,
      member ? member.userName : "Guest",
      targetRef,
      domain,
      userId,
      member ? member.userName : "Guest",
      title || videoId,
      provider
    );

    this.version++;
    const event: RoomEvent = {
      version: this.version,
      type: "PLAYBACK_UPDATE",
      payload: {
        playback: { ...this.playback },
        causedBy: { userId, clientSeq },
        reason: "video_change",
      },
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcastPlaybackUpdate(userId, clientSeq, "video_change");
    return { success: true, version: this.version };
  }

  public applyBufferReport(userId: string, isBuffering: boolean): void {
    const member = this.members.get(userId);
    if (!member) return;

    member.isBuffering = isBuffering;

    // If room is playing and a member stalls, pause to let them buffer
    if (isBuffering && this.playback.status === "playing") {
      const now = Date.now();
      const currentPos = derivePlaybackPositionMs(this.playback, now);
      this.playback = {
        ...this.playback,
        status: "buffering",
        positionMs: currentPos,
        serverTimeMs: now,
      };

      this.version++;
      const event: RoomEvent = {
        version: this.version,
        type: "PLAYBACK_UPDATE",
        payload: {
          playback: { ...this.playback },
          causedBy: { userId },
          reason: "buffer_stall",
        },
        serverTimeMs: now,
      };
      this.ringBuffer.push(event);
      this.broadcastPlaybackUpdate(userId, undefined, "buffer_stall");
    } else if (!isBuffering && this.playback.status === "buffering") {
      // Check if all connected members are no longer buffering
      const stillBuffering = Array.from(this.members.values()).some(
        (m) => m.isConnected && m.isBuffering
      );
      if (!stillBuffering) {
        const now = Date.now();
        this.playback = {
          ...this.playback,
          status: "playing",
          serverTimeMs: now,
        };

        this.version++;
        const event: RoomEvent = {
          version: this.version,
          type: "PLAYBACK_UPDATE",
          payload: {
            playback: { ...this.playback },
            causedBy: { userId },
            reason: "buffer_resumed",
          },
          serverTimeMs: now,
        };
        this.ringBuffer.push(event);
        this.broadcastPlaybackUpdate(userId, undefined, "buffer_resumed");
      }
    }
  }

  private broadcastPlaybackUpdate(userId: string, clientSeq: number | undefined, reason: string): void {
    this.broadcast({
      type: "PLAYBACK_UPDATE",
      version: this.version,
      payload: {
        playback: { ...this.playback },
        causedBy: { userId, clientSeq },
        reason,
      },
    });
  }

  // ==========================================
  // ROOM SETTINGS & PERMISSIONS
  // ==========================================

  public updateSettings(
    userId: string,
    clientSeq: number,
    settingsOrControlMode:
      | ControlMode
      | {
          controlMode?: ControlMode;
          roomType?: RoomType;
          roomPassword?: string | null;
          maxMembers?: number;
          waitingRoomEnabled?: boolean;
          autoApproveFriends?: boolean;
          profanityFilterEnabled?: boolean;
          slowModeSeconds?: number;
          isLocked?: boolean;
          chatRetentionDays?: number;
          roomRules?: string | null;
        }
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(userId, "manage_settings")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to modify room settings",
      };
    }

    if (typeof settingsOrControlMode === "string") {
      this.controlMode = settingsOrControlMode;
    } else if (settingsOrControlMode && typeof settingsOrControlMode === "object") {
      const s = settingsOrControlMode;
      if (s.controlMode !== undefined) this.controlMode = s.controlMode;
      if (s.roomType !== undefined) this.roomType = s.roomType;
      if (s.maxMembers !== undefined) this.maxMembers = s.maxMembers;
      if (s.waitingRoomEnabled !== undefined) this.waitingRoomEnabled = s.waitingRoomEnabled;
      if (s.autoApproveFriends !== undefined) this.autoApproveFriends = s.autoApproveFriends;
      if (s.profanityFilterEnabled !== undefined) this.profanityFilterEnabled = s.profanityFilterEnabled;
      if (s.slowModeSeconds !== undefined) this.slowModeSeconds = s.slowModeSeconds;
      if (s.isLocked !== undefined) this.isLocked = s.isLocked;
      if (s.chatRetentionDays !== undefined) {
        this.chatRetentionDays = Math.max(0, Math.floor(s.chatRetentionDays));
        this.pruneExpiredChat();
      }
      if (s.roomRules !== undefined) {
        this.roomRules = s.roomRules && s.roomRules.trim().length > 0 ? s.roomRules.slice(0, 2000).trim() : undefined;
      }

      if (s.roomPassword !== undefined) {
        if (s.roomPassword && s.roomPassword.trim().length > 0) {
          this.passwordSalt = generatePasswordSalt();
          this.passwordHash = hashRoomPassword(s.roomPassword.trim(), this.passwordSalt);
        } else {
          this.passwordHash = undefined;
          this.passwordSalt = undefined;
        }
      }
    }

    this.version++;
    const now = Date.now();

    const payload = {
      controlMode: this.controlMode,
      roomType: this.roomType,
      hasPassword: Boolean(this.passwordHash),
      maxMembers: this.maxMembers,
      waitingRoomEnabled: this.waitingRoomEnabled,
      autoApproveFriends: this.autoApproveFriends,
      isLocked: this.isLocked,
      slowModeSeconds: this.slowModeSeconds,
      profanityFilterEnabled: this.profanityFilterEnabled,
      chatRetentionDays: this.chatRetentionDays,
      roomRules: this.roomRules,
    };

    const event: RoomEvent = {
      version: this.version,
      type: "ROOM_SETTINGS_UPDATED",
      payload,
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "ROOM_SETTINGS_UPDATED",
      version: this.version,
      payload,
    });

    auditLogger.log({
      type: "ROOM_SETTINGS_UPDATED",
      outcome: "SUCCESS",
      actorId: userId,
      details: { roomId: this.roomId, settings: payload },
    });

    return { success: true, version: this.version };
  }

  // ==========================================
  // PLAYLIST, POLLS, CHAT, REACTIONS
  // ==========================================

  public addPlaylistItem(
    userId: string,
    clientSeq: number,
    videoId: string,
    title: string,
    durationMs: number,
    thumbnailUrl?: string,
    provider: VideoProvider = "html5",
    sourceRef?: string,
    author?: string,
    domain?: string,
    license?: string,
    bypassApproval = false
  ): { success: true; version: number; queued?: boolean; submissionId?: string } | { success: false; code: string; message: string } {
    if (!this.hasPermission(userId, "edit_playlist") && !this.canUserAddSource(userId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to edit the playlist",
      };
    }
    const member = this.members.get(userId);
    const targetRef = sourceRef || videoId;

    if (targetRef.startsWith("http:") || targetRef.startsWith("https:")) {
      const blockCheck = this.isSourceBlockedSync(targetRef);
      if (blockCheck.blocked) {
        const itemDomain = domain || this.urlSafetyChecker.extractDomain(targetRef);
        this.recordSourceAudit(
          "blocked",
          userId,
          member ? member.userName : "Guest",
          targetRef,
          itemDomain,
          userId,
          member ? member.userName : "Guest",
          title,
          provider,
          blockCheck.warning
        );
        return {
          success: false,
          code: "BLOCKED_SOURCE",
          message: blockCheck.warning || "This URL or domain is blocked by room or platform security rules.",
        };
      }
    }

    const isStaff = userId === this.hostId || member?.role === "moderator";
    if (!bypassApproval && this.requireLinkApproval && !isStaff && !this.approvedSourceAdders.has(userId)) {
      const submissionId = generateId("src_sub");
      const itemDomain = domain || this.urlSafetyChecker.extractDomain(targetRef);
      const submission: PendingSourceSubmission = {
        id: submissionId,
        userId,
        userName: member ? member.userName : "Guest",
        sourceUrl: targetRef,
        domain: itemDomain,
        title,
        author,
        provider: provider || "html5",
        sourceRef: targetRef,
        durationMs,
        thumbnailUrl,
        submittedAt: Date.now(),
        actionType: "add_playlist",
        safety: {
          url: targetRef,
          domain: itemDomain,
          safetyLevel: "safe",
          threatTypes: [],
          isSafe: true,
          sourceCheck: "local_blocklist",
          scannedAt: Date.now(),
        },
      };
      this.sourceApprovalQueue.set(submissionId, submission);
      this.recordSourceAudit(
        "submitted",
        userId,
        member ? member.userName : "Guest",
        targetRef,
        itemDomain,
        userId,
        member ? member.userName : "Guest",
        title,
        provider,
        "Queued for host approval"
      );
      this.broadcastToStaff({
        type: "SOURCE_SUBMISSION_QUEUED",
        version: this.version,
        payload: { submission },
      });
      return { success: true, version: this.version, queued: true, submissionId };
    }

    const lastItem = this.playlist[this.playlist.length - 1];
    const itemOrder =
      lastItem && typeof lastItem.order === "number"
        ? lastItem.order + 1000
        : (this.playlist.length + 1) * 1000;

    const resolvedDomain = domain || this.urlSafetyChecker.extractDomain(targetRef);

    const item: PlaylistItem = {
      id: generateId("pl"),
      videoId,
      provider: provider || "html5",
      sourceRef: sourceRef || videoId,
      title,
      durationMs,
      thumbnailUrl,
      addedByUserId: userId,
      addedByUserName: member ? member.userName : "Guest",
      order: itemOrder,
      author,
      domain: resolvedDomain,
      originalUrl: targetRef.startsWith("http") ? targetRef : undefined,
      license,
    };

    this.playlist.push(item);
    this.recordSourceAudit(
      "added",
      userId,
      member ? member.userName : "Guest",
      targetRef,
      resolvedDomain,
      userId,
      member ? member.userName : "Guest",
      title,
      provider
    );
    this.version++;
    const now = Date.now();

    const event: RoomEvent = {
      version: this.version,
      type: "PLAYLIST_UPDATED",
      payload: { playlist: [...this.playlist] },
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "PLAYLIST_UPDATED",
      version: this.version,
      payload: { playlist: [...this.playlist] },
    });

    return { success: true, version: this.version };
  }

  // ==========================================
  // SOURCE GUARDRAILS & PERMISSION MANAGEMENT
  // ==========================================

  public canUserAddSource(userId: string): boolean {
    const member = this.members.get(userId);
    if (!member) return false;
    if (member.isHost || member.role === "moderator") return true;
    if (this.approvedSourceAdders.has(userId)) return true;
    return this.hasPermission(userId, "add_sources");
  }

  public canUserApproveSource(userId: string): boolean {
    const member = this.members.get(userId);
    if (!member) return false;
    if (member.isHost || member.role === "moderator") return true;
    return this.hasPermission(userId, "approve_sources");
  }

  public recordSourceAudit(
    action: SourceAuditAction,
    userId: string,
    userName: string,
    sourceUrl: string,
    domain: string,
    performedByUserId: string,
    performedByUserName: string,
    title?: string,
    provider?: VideoProvider,
    notes?: string
  ): SourceAuditEntry {
    const entry: SourceAuditEntry = {
      id: generateId("src_aud"),
      timestamp: Date.now(),
      userId,
      userName,
      action,
      sourceUrl,
      domain,
      title,
      provider,
      performedByUserId,
      performedByUserName,
      notes,
    };
    this.sourceAuditLog.push(entry);
    if (this.sourceAuditLog.length > 200) {
      this.sourceAuditLog.shift();
    }
    this.broadcast({
      type: "SOURCE_AUDIT_LOG_ENTRY",
      payload: { entry },
    });
    return entry;
  }

  public async submitSource(
    userId: string,
    clientSeq: number,
    payload: {
      url: string;
      actionType: "change_video" | "add_playlist";
      title?: string;
      autoPlay?: boolean;
      startPositionMs?: number;
    }
  ): Promise<{ success: true; version: number; queued?: boolean; submissionId?: string } | { success: false; code: string; message: string }> {
    if (!this.canUserAddSource(userId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Only the host or approved members can add sources to this room",
      };
    }

    const member = this.members.get(userId);
    const domain = this.urlSafetyChecker.extractDomain(payload.url);
    const safety = await this.urlSafetyChecker.checkUrl(payload.url, Array.from(this.sourceBlocklist.values()));

    if (!safety.isSafe && (safety.safetyLevel === "blocked" || safety.safetyLevel === "malicious")) {
      this.recordSourceAudit(
        "blocked",
        userId,
        member ? member.userName : "Guest",
        payload.url,
        domain,
        userId,
        member ? member.userName : "Guest",
        payload.title || payload.url,
        undefined,
        safety.warning
      );
      return {
        success: false,
        code: "BLOCKED_SOURCE",
        message: safety.warning || "This URL or domain is blocked by room or platform security rules.",
      };
    }

    const isStaff = userId === this.hostId || member?.role === "moderator";

    if (this.requireLinkApproval && !isStaff && !this.approvedSourceAdders.has(userId)) {
      const submissionId = generateId("src_sub");
      const submission: PendingSourceSubmission = {
        id: submissionId,
        userId,
        userName: member ? member.userName : "Guest",
        sourceUrl: payload.url,
        domain,
        title: payload.title || payload.url,
        provider: "html5",
        sourceRef: payload.url,
        durationMs: 0,
        submittedAt: Date.now(),
        actionType: payload.actionType,
        autoPlay: payload.autoPlay,
        startPositionMs: payload.startPositionMs,
        safety,
      };
      this.sourceApprovalQueue.set(submissionId, submission);
      this.recordSourceAudit(
        "submitted",
        userId,
        member ? member.userName : "Guest",
        payload.url,
        domain,
        userId,
        member ? member.userName : "Guest",
        submission.title,
        submission.provider,
        "Queued for approval"
      );
      this.broadcastToStaff({
        type: "SOURCE_SUBMISSION_QUEUED",
        version: this.version,
        payload: { submission },
      });
      return { success: true, version: this.version, queued: true, submissionId };
    }

    if (payload.actionType === "change_video") {
      return this.applyChangeVideo(
        userId,
        clientSeq,
        payload.url,
        payload.startPositionMs || 0,
        payload.autoPlay || false,
        "html5",
        payload.url,
        payload.title || payload.url
      );
    } else {
      return this.addPlaylistItem(
        userId,
        clientSeq,
        payload.url,
        payload.title || payload.url,
        0,
        undefined,
        "html5",
        payload.url
      );
    }
  }

  public approveSourceSubmission(
    actorId: string,
    clientSeq: number,
    submissionId: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.canUserApproveSource(actorId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to approve sources in this room",
      };
    }

    const submission = this.sourceApprovalQueue.get(submissionId);
    if (!submission) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Source submission not found or already processed",
      };
    }

    this.sourceApprovalQueue.delete(submissionId);
    const actor = this.members.get(actorId);

    if (submission.actionType === "change_video") {
      this.applyChangeVideo(
        submission.userId,
        clientSeq,
        submission.sourceUrl,
        submission.startPositionMs || 0,
        submission.autoPlay || false,
        submission.provider,
        submission.sourceRef || submission.sourceUrl,
        submission.title,
        submission.author,
        undefined,
        true // bypassApproval
      );
    } else {
      this.addPlaylistItem(
        submission.userId,
        clientSeq,
        submission.sourceUrl,
        submission.title,
        submission.durationMs || 0,
        submission.thumbnailUrl,
        submission.provider,
        submission.sourceRef || submission.sourceUrl,
        submission.author,
        submission.domain,
        undefined,
        true // bypassApproval
      );
    }

    this.recordSourceAudit(
      "approved",
      submission.userId,
      submission.userName,
      submission.sourceUrl,
      submission.domain,
      actorId,
      actor ? actor.userName : "Moderator",
      submission.title,
      submission.provider,
      "Approved by staff"
    );

    this.broadcast({
      type: "SOURCE_SUBMISSION_APPROVED",
      version: this.version,
      payload: {
        submissionId,
        approvedBy: actor ? actor.userName : "Staff",
      },
    });

    return { success: true, version: this.version };
  }

  public rejectSourceSubmission(
    actorId: string,
    clientSeq: number,
    submissionId: string,
    reason?: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.canUserApproveSource(actorId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to reject sources in this room",
      };
    }

    const submission = this.sourceApprovalQueue.get(submissionId);
    if (!submission) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Source submission not found or already processed",
      };
    }

    this.sourceApprovalQueue.delete(submissionId);
    const actor = this.members.get(actorId);

    this.recordSourceAudit(
      "rejected",
      submission.userId,
      submission.userName,
      submission.sourceUrl,
      submission.domain,
      actorId,
      actor ? actor.userName : "Moderator",
      submission.title,
      submission.provider,
      reason || "Rejected by staff"
    );

    this.broadcast({
      type: "SOURCE_SUBMISSION_REJECTED",
      version: this.version,
      payload: {
        submissionId,
        rejectedBy: actor ? actor.userName : "Staff",
        reason,
      },
    });

    return { success: true, version: this.version };
  }

  public permitSourceAdder(
    actorId: string,
    clientSeq: number,
    targetUserId: string,
    permit: boolean
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.canUserApproveSource(actorId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to manage source adders",
      };
    }

    if (permit) {
      this.approvedSourceAdders.add(targetUserId);
    } else {
      this.approvedSourceAdders.delete(targetUserId);
    }

    this.version++;
    this.broadcast({
      type: "SOURCE_SETTINGS_UPDATED",
      version: this.version,
      payload: {
        requireLinkApproval: this.requireLinkApproval,
        approvedSourceAdders: Array.from(this.approvedSourceAdders),
      },
    });

    return { success: true, version: this.version };
  }

  public updateSourceSettings(
    actorId: string,
    clientSeq: number,
    settings: { requireLinkApproval?: boolean }
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "manage_settings")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to manage room settings",
      };
    }

    if (typeof settings.requireLinkApproval === "boolean") {
      this.requireLinkApproval = settings.requireLinkApproval;
    }

    this.version++;
    this.broadcast({
      type: "SOURCE_SETTINGS_UPDATED",
      version: this.version,
      payload: {
        requireLinkApproval: this.requireLinkApproval,
        approvedSourceAdders: Array.from(this.approvedSourceAdders),
      },
    });

    return { success: true, version: this.version };
  }

  public addSourceBlocklistRule(
    actorId: string,
    clientSeq: number,
    pattern: string,
    reason?: string
  ): { success: true; version: number; rule: SourceBlocklistRule } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "manage_source_blocklist")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to manage the source blocklist",
      };
    }

    const actor = this.members.get(actorId);
    const rule: SourceBlocklistRule = {
      id: generateId("rule"),
      pattern: pattern.trim().toLowerCase(),
      reason,
      addedByUserId: actorId,
      addedByUserName: actor ? actor.userName : "Staff",
      addedAt: Date.now(),
    };

    this.sourceBlocklist.set(rule.id, rule);
    this.version++;

    this.recordSourceAudit(
      "blocked",
      actorId,
      actor ? actor.userName : "Staff",
      pattern,
      pattern,
      actorId,
      actor ? actor.userName : "Staff",
      undefined,
      undefined,
      `Rule added: ${reason || "Host blocklist"}`
    );

    this.broadcast({
      type: "SOURCE_BLOCKLIST_UPDATED",
      version: this.version,
      payload: {
        blocklist: Array.from(this.sourceBlocklist.values()),
      },
    });

    return { success: true, version: this.version, rule };
  }

  public removeSourceBlocklistRule(
    actorId: string,
    clientSeq: number,
    ruleId: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(actorId, "manage_source_blocklist")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to manage the source blocklist",
      };
    }

    this.sourceBlocklist.delete(ruleId);
    this.version++;

    this.broadcast({
      type: "SOURCE_BLOCKLIST_UPDATED",
      version: this.version,
      payload: {
        blocklist: Array.from(this.sourceBlocklist.values()),
      },
    });

    return { success: true, version: this.version };
  }

  public reportSource(
    actorId: string,
    clientSeq: number,
    sourceUrl: string,
    reason: string,
    description?: string
  ): { success: true; version: number; report: SourceReport } | { success: false; code: string; message: string } {
    const actor = this.members.get(actorId);
    const domain = this.urlSafetyChecker.extractDomain(sourceUrl);
    const report: SourceReport = {
      id: generateId("src_rep"),
      roomId: this.roomId,
      roomCode: this.roomCode,
      reporterUserId: actorId,
      reporterUserName: actor ? actor.userName : "User",
      sourceUrl,
      domain,
      reason,
      description,
      reportedAt: Date.now(),
      status: "pending",
    };

    this.sourceReports.set(report.id, report);

    this.recordSourceAudit(
      "reported",
      actorId,
      actor ? actor.userName : "User",
      sourceUrl,
      domain,
      actorId,
      actor ? actor.userName : "User",
      undefined,
      undefined,
      `Reported for: ${reason}`
    );

    this.broadcastToStaff({
      type: "SOURCE_REPORT_RECORDED",
      payload: { report },
    });

    return { success: true, version: this.version, report };
  }

  public removePlaylistItem(
    userId: string,
    clientSeq: number,
    playlistItemId: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(userId, "edit_playlist")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to edit the playlist",
      };
    }

    this.playlist = this.playlist.filter((p) => p.id !== playlistItemId);
    this.version++;
    const now = Date.now();

    const event: RoomEvent = {
      version: this.version,
      type: "PLAYLIST_UPDATED",
      payload: { playlist: [...this.playlist] },
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "PLAYLIST_UPDATED",
      version: this.version,
      payload: { playlist: [...this.playlist] },
    });

    return { success: true, version: this.version };
  }

  public reorderPlaylistItem(
    userId: string,
    clientSeq: number,
    playlistItemId: string,
    newIndex: number,
    order?: number,
    expectedVersion?: number
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(userId, "edit_playlist")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to edit the playlist",
      };
    }

    const item = this.playlist.find((p) => p.id === playlistItemId);
    if (!item) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Playlist item not found",
      };
    }

    // Version check if expectedVersion is provided and fractional order is not
    if (typeof expectedVersion === "number" && typeof order !== "number") {
      if (expectedVersion !== this.version) {
        return {
          success: false,
          code: ERROR_CODES.INVALID_ACTION,
          message: "Playlist was modified concurrently, please retry",
        };
      }
    }

    if (typeof order === "number") {
      // Fractional indexing: update item order and sort
      item.order = order;
      this.playlist.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));

      // Precision safeguard: renormalize if gap between adjacent items is too small (< 0.001)
      let needsRenormalization = false;
      for (let i = 0; i < this.playlist.length - 1; i++) {
        const gap = (this.playlist[i + 1].order ?? 0) - (this.playlist[i].order ?? 0);
        if (gap <= 0.001) {
          needsRenormalization = true;
          break;
        }
      }
      if (needsRenormalization) {
        this.playlist.forEach((p, idx) => {
          p.order = (idx + 1) * 1000;
        });
      }
    } else {
      const currentIndex = this.playlist.findIndex((p) => p.id === playlistItemId);
      if (currentIndex !== -1 && newIndex >= 0 && newIndex < this.playlist.length) {
        const [removed] = this.playlist.splice(currentIndex, 1);
        this.playlist.splice(newIndex, 0, removed);
        this.playlist.forEach((p, idx) => {
          p.order = (idx + 1) * 1000;
        });
      }
    }

    this.version++;
    const now = Date.now();

    const event: RoomEvent = {
      version: this.version,
      type: "PLAYLIST_UPDATED",
      payload: { playlist: [...this.playlist] },
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "PLAYLIST_UPDATED",
      version: this.version,
      payload: { playlist: [...this.playlist] },
    });

    return { success: true, version: this.version };
  }

  public loadPlaylist(
    userId: string,
    clientSeq: number,
    items: { videoId: string; title: string; durationMs?: number; thumbnailUrl?: string }[],
    mode: "replace" | "append" = "append"
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    let effectiveUserId = userId;
    const directMember = this.members.get(userId);
    if (!directMember) {
      const accMember = this.getMemberByAccountId(userId);
      if (accMember) {
        effectiveUserId = accMember.userId;
      }
    }

    if (!this.hasPermission(effectiveUserId, "edit_playlist")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to edit the playlist",
      };
    }

    const member = this.members.get(effectiveUserId);
    const addedByName = member ? member.userName : "Guest";

    let lastOrder = 0;
    if (mode === "append" && this.playlist.length > 0) {
      const last = this.playlist[this.playlist.length - 1];
      lastOrder = typeof last.order === "number" ? last.order : this.playlist.length * 1000;
    }

    const newItems: PlaylistItem[] = items.map((it, idx) => ({
      id: generateId("pl"),
      videoId: it.videoId,
      title: it.title,
      durationMs: it.durationMs ?? 0,
      thumbnailUrl: it.thumbnailUrl,
      addedByUserId: effectiveUserId,
      addedByUserName: addedByName,
      order: lastOrder + (idx + 1) * 1000,
    }));

    if (mode === "replace") {
      this.playlist = newItems;
      if (this.playlist.length > 0 && !this.playback.videoId) {
        this.playback.videoId = this.playlist[0].videoId;
      }
    } else {
      this.playlist.push(...newItems);
      if (!this.playback.videoId && this.playlist.length > 0) {
        this.playback.videoId = this.playlist[0].videoId;
      }
    }

    this.version++;
    const now = Date.now();

    const event: RoomEvent = {
      version: this.version,
      type: "PLAYLIST_UPDATED",
      payload: { playlist: [...this.playlist] },
      serverTimeMs: now,
      causedBy: { userId: effectiveUserId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "PLAYLIST_UPDATED",
      version: this.version,
      payload: { playlist: [...this.playlist] },
    });

    return { success: true, version: this.version };
  }

  public advancePlaylist(
    userId: string,
    clientSeq: number,
    videoId: string
  ): { success: boolean; nextVideoId?: string } {
    if (this.playback.videoId !== videoId) {
      return { success: false };
    }

    const currentIndex = this.playlist.findIndex((p) => p.videoId === videoId);
    let nextItem: PlaylistItem | undefined;

    if (currentIndex !== -1 && currentIndex + 1 < this.playlist.length) {
      nextItem = this.playlist[currentIndex + 1];
    } else if (this.playlist.length > 0 && this.playlist[0].videoId !== videoId) {
      nextItem = this.playlist[0];
    }

    if (nextItem) {
      this.playback = {
        videoId: nextItem.videoId,
        status: "playing",
        positionMs: 0,
        serverTimeMs: Date.now(),
        playbackRate: 1.0,
      };
      this.version++;

      const event: RoomEvent = {
        version: this.version,
        type: "PLAYBACK_UPDATE",
        payload: {
          playback: { ...this.playback },
          causedBy: { userId, clientSeq },
          reason: "auto_advance",
        },
        serverTimeMs: Date.now(),
        causedBy: { userId, clientSeq },
      };
      this.ringBuffer.push(event);

      this.broadcast({
        type: "PLAYBACK_UPDATE",
        version: this.version,
        payload: {
          playback: { ...this.playback },
          causedBy: { userId, clientSeq },
          reason: "auto_advance",
        },
      });

      this.emitSystemMessage(`Up next: "${nextItem.title}"`);
      return { success: true, nextVideoId: nextItem.videoId };
    }

    return { success: false };
  }

  public createPoll(
    userId: string,
    clientSeq: number,
    question: string,
    options: string[],
    durationSeconds = 30,
    autoQueueWinner = false
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.hasPermission(userId, "create_polls")) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "You do not have permission to create polls",
      };
    }

    if (this.pollExpirationTimer) {
      clearTimeout(this.pollExpirationTimer);
      this.pollExpirationTimer = null;
    }

    const pollId = generateId("poll");
    const now = Date.now();
    const poll: Poll = {
      id: pollId,
      question: sanitizeText(question),
      options: options.map((opt) => ({
        id: generateId("opt"),
        text: sanitizeText(opt),
        votes: 0,
        voterUserIds: [],
      })),
      createdByUserId: userId,
      createdAt: now,
      durationMs: durationSeconds * 1000,
      expiresAtServerTimeMs: now + durationSeconds * 1000,
      isClosed: false,
      autoQueueWinner,
    };

    this.activePoll = poll;
    this.version++;

    const summary = this.getPollSummary(poll);
    const event: RoomEvent = {
      version: this.version,
      type: "POLL_UPDATED",
      payload: { poll: summary },
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "POLL_UPDATED",
      version: this.version,
      payload: { poll: summary },
    });

    const member = this.members.get(userId);
    this.emitSystemMessage(`${member ? member.userName : "Someone"} created a poll: "${poll.question}"`);

    // Auto-close when duration expires
    this.pollExpirationTimer = setTimeout(() => {
      this.closePoll(pollId);
    }, durationSeconds * 1000);

    return { success: true, version: this.version };
  }

  public closePoll(pollId: string): void {
    if (!this.activePoll || this.activePoll.id !== pollId || this.activePoll.isClosed) {
      return;
    }

    this.activePoll.isClosed = true;
    if (this.pollExpirationTimer) {
      clearTimeout(this.pollExpirationTimer);
      this.pollExpirationTimer = null;
    }

    let winnerOption: PollOption | undefined;
    for (const opt of this.activePoll.options) {
      if (!winnerOption || opt.votes > winnerOption.votes) {
        winnerOption = opt;
      }
    }

    this.version++;
    const summary = this.getPollSummary(this.activePoll);
    if (winnerOption && winnerOption.votes > 0) {
      summary.winnerOptionText = winnerOption.text;
    }

    const event: RoomEvent = {
      version: this.version,
      type: "POLL_UPDATED",
      payload: { poll: summary },
      serverTimeMs: Date.now(),
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "POLL_UPDATED",
      version: this.version,
      payload: { poll: summary },
    });

    if (winnerOption && winnerOption.votes > 0) {
      this.emitSystemMessage(`Poll finished! "${winnerOption.text}" won with ${winnerOption.votes} vote(s).`);

      if (this.activePoll.autoQueueWinner) {
        const matchingMovie = MOVIE_CATALOGUE.find(
          (m) => m.title.toLowerCase() === winnerOption!.text.toLowerCase()
        );
        if (matchingMovie) {
          this.addPlaylistItem(
            this.hostId,
            0,
            matchingMovie.id,
            matchingMovie.title,
            matchingMovie.runtime * 60 * 1000,
            matchingMovie.posterUrl
          );
          this.emitSystemMessage(`"${matchingMovie.title}" was automatically added to the queue!`);
        }
      }
    } else {
      this.emitSystemMessage(`Poll finished with no votes.`);
    }
  }

  public votePoll(
    userId: string,
    clientSeq: number,
    pollId: string,
    optionIndex: number
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.activePoll || this.activePoll.id !== pollId || this.activePoll.isClosed) {
      return {
        success: false,
        code: ERROR_CODES.INVALID_ACTION,
        message: "Poll is closed or does not exist",
      };
    }

    if (Date.now() > this.activePoll.expiresAtServerTimeMs) {
      this.closePoll(pollId);
      return {
        success: false,
        code: ERROR_CODES.INVALID_ACTION,
        message: "Poll has expired",
      };
    }

    if (optionIndex < 0 || optionIndex >= this.activePoll.options.length) {
      return {
        success: false,
        code: ERROR_CODES.INVALID_ACTION,
        message: "Invalid option index",
      };
    }

    // Remove any previous vote by this user
    for (const opt of this.activePoll.options) {
      const idx = opt.voterUserIds.indexOf(userId);
      if (idx !== -1) {
        opt.voterUserIds.splice(idx, 1);
        opt.votes = opt.voterUserIds.length;
      }
    }

    // Add new vote
    const selected = this.activePoll.options[optionIndex];
    selected.voterUserIds.push(userId);
    selected.votes = selected.voterUserIds.length;

    this.version++;
    const now = Date.now();
    const summary = this.getPollSummary(this.activePoll);

    const event: RoomEvent = {
      version: this.version,
      type: "POLL_UPDATED",
      payload: { poll: summary },
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "POLL_UPDATED",
      version: this.version,
      payload: { poll: summary },
    });

    return { success: true, version: this.version };
  }

  public broadcastChat(
    userId: string,
    clientSeq: number,
    text: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    const member = this.members.get(userId);
    if (!member) {
      return {
        success: false,
        code: ERROR_CODES.NOT_IN_ROOM,
        message: "You are not a member of this room",
      };
    }

    // Check if user is muted
    const mute = this.mutes.get(userId);
    if (mute) {
      if (mute.mutedUntil === null || Date.now() < mute.mutedUntil) {
        return {
          success: false,
          code: ERROR_CODES.USER_MUTED,
          message: "You are currently muted in this room",
        };
      } else {
        this.mutes.delete(userId);
        member.isMuted = false;
      }
    }

    // Check slow mode (exempt host and moderators)
    if (this.slowModeSeconds > 0 && member.role !== "host" && member.role !== "moderator") {
      const lastChat = this.userLastChatTime.get(userId) || 0;
      const elapsedMs = Date.now() - lastChat;
      if (elapsedMs < this.slowModeSeconds * 1000) {
        const waitSec = Math.ceil((this.slowModeSeconds * 1000 - elapsedMs) / 1000);
        return {
          success: false,
          code: ERROR_CODES.SLOW_MODE_ACTIVE,
          message: `Slow mode is active. Please wait ${waitSec}s before sending another message.`,
        };
      }
      this.userLastChatTime.set(userId, Date.now());
    }

    const now = Date.now();
    let rateRecord = this.userChatRates.get(userId);
    if (!rateRecord || now > rateRecord.resetTime) {
      rateRecord = { count: 0, resetTime: now + 3000 };
      this.userChatRates.set(userId, rateRecord);
    }

    if (rateRecord.count >= 5) {
      return {
        success: false,
        code: ERROR_CODES.RATE_LIMITED,
        message: "Chat rate limit exceeded. Please wait a moment before sending another message.",
      };
    }
    rateRecord.count++;

    // Apply profanity filter if enabled
    let processedText = text;
    if (this.profanityFilterEnabled) {
      const filtered = filterProfanity(text);
      processedText = filtered.cleanText;
    }

    const sanitized = sanitizeText(processedText);
    const msg: ChatMessage = {
      id: generateId("msg"),
      userId,
      userName: member.userName,
      text: sanitized,
      serverTimestampMs: now,
      isSystem: false,
    };

    this.pruneExpiredChat(now);
    this.chatHistory.push(msg);
    if (this.chatHistory.length > 100) {
      this.chatHistory.shift();
    }

    this.version++;
    const event: RoomEvent = {
      version: this.version,
      type: "CHAT_BROADCAST",
      payload: { message: msg },
      serverTimeMs: msg.serverTimestampMs,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "CHAT_BROADCAST",
      version: this.version,
      payload: { message: msg },
    });

    return { success: true, version: this.version };
  }

  public broadcastTyping(userId: string, isTyping: boolean): void {
    const member = this.members.get(userId);
    if (!member) return;

    this.broadcastExcept(userId, {
      type: "CHAT_TYPING_BROADCAST",
      payload: {
        userId,
        userName: member.userName,
        isTyping,
      },
    });
  }

  public broadcastReaction(
    userId: string,
    emoji: string,
    videoTimestampMs: number
  ): boolean {
    const member = this.members.get(userId);
    if (!member) return false;

    // Rate limiting: max 5 reactions per 2 seconds
    const now = Date.now();
    let rateRecord = this.userReactionRates.get(userId);
    if (!rateRecord || now > rateRecord.resetTime) {
      rateRecord = { count: 0, resetTime: now + 2000 };
      this.userReactionRates.set(userId, rateRecord);
    }

    if (rateRecord.count >= 5) {
      return false; // Throttled
    }
    rateRecord.count++;

    const reaction: ReactionBurst = {
      id: generateId("rxn"),
      userId,
      userName: member.userName,
      emoji: sanitizeText(emoji),
      videoTimestampMs: Math.max(0, videoTimestampMs),
      createdAtMs: now,
    };

    this.storedReactions.push(reaction);
    if (this.storedReactions.length > 1000) {
      this.storedReactions.shift();
    }

    this.broadcast({
      type: "REACTION_BROADCAST",
      payload: { reaction },
    });
    return true;
  }

  // ==========================================
  // SHARED MOMENT BOOKMARKS
  // ==========================================

  public addBookmark(
    userId: string,
    clientSeq: number,
    videoId: string,
    timestampMs: number,
    text: string,
    color?: string
  ): { success: true; version: number } {
    const member = this.members.get(userId);
    const sanitized = sanitizeText(text);
    const bookmark: MomentBookmark = {
      id: generateId("bmk"),
      userId,
      userName: member ? member.userName : "Guest",
      videoId,
      timestampMs: Math.max(0, timestampMs),
      text: sanitized,
      createdAtMs: Date.now(),
      color: color || "#6366f1",
    };

    this.bookmarks.push(bookmark);
    if (this.bookmarks.length > 200) {
      this.bookmarks.shift();
    }

    this.version++;
    const now = Date.now();
    const event: RoomEvent = {
      version: this.version,
      type: "BOOKMARKS_UPDATED",
      payload: { bookmarks: [...this.bookmarks] },
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "BOOKMARKS_UPDATED",
      version: this.version,
      payload: { bookmarks: [...this.bookmarks] },
    });

    const mins = Math.floor(timestampMs / 60000);
    const secs = Math.floor((timestampMs % 60000) / 1000);
    const timeFormatted = `${mins}:${secs.toString().padStart(2, "0")}`;
    this.emitSystemMessage(
      `${member ? member.userName : "Someone"} pinned a moment at ${timeFormatted}: "${sanitized}"`
    );

    return { success: true, version: this.version };
  }

  public removeBookmark(
    userId: string,
    clientSeq: number,
    bookmarkId: string
  ): { success: true; version: number } {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== bookmarkId);
    this.version++;
    const now = Date.now();

    const event: RoomEvent = {
      version: this.version,
      type: "BOOKMARKS_UPDATED",
      payload: { bookmarks: [...this.bookmarks] },
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "BOOKMARKS_UPDATED",
      version: this.version,
      payload: { bookmarks: [...this.bookmarks] },
    });

    return { success: true, version: this.version };
  }

  // ==========================================
  // READY CHECK (SYNCHRONIZED COUNTDOWN START)
  // ==========================================

  public startReadyCheck(
    userId: string,
    clientSeq: number,
    countdownMs = 3000,
    startPositionMs?: number
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.checkPlaybackPermission(userId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Only the host can start a ready check",
      };
    }

    if (this.readyCheckTimer) {
      clearTimeout(this.readyCheckTimer);
      this.readyCheckTimer = null;
    }

    const member = this.members.get(userId);
    const now = Date.now();
    const targetPos =
      typeof startPositionMs === "number" && startPositionMs >= 0
        ? startPositionMs
        : this.playback.positionMs;
    const targetServerTimeMs = now + countdownMs;

    const readyCheck: ReadyCheck = {
      id: generateId("rc"),
      initiatedByUserId: userId,
      initiatedByUserName: member ? member.userName : "Host",
      countdownMs,
      targetServerTimeMs,
      startPositionMs: targetPos,
      active: true,
    };

    this.readyCheck = readyCheck;
    this.version++;

    const event: RoomEvent = {
      version: this.version,
      type: "READY_CHECK_COUNTDOWN",
      payload: readyCheck,
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "READY_CHECK_COUNTDOWN",
      version: this.version,
      payload: readyCheck,
    });

    this.emitSystemMessage(
      `Synchronized start in ${(countdownMs / 1000).toFixed(0)}s! Everyone get ready...`
    );

    this.readyCheckTimer = setTimeout(() => {
      this.readyCheckTimer = null;
      if (this.readyCheck && this.readyCheck.id === readyCheck.id && this.readyCheck.active) {
        this.readyCheck.active = false;
        // Start playback synchronously
        this.applyPlay(this.hostId, 0, targetPos);
        this.emitSystemMessage("Party started! Playback synchronized for everyone.");
      }
    }, countdownMs);

    return { success: true, version: this.version };
  }

  public cancelReadyCheck(userId: string, reason = "Cancelled by host"): void {
    if (this.readyCheckTimer) {
      clearTimeout(this.readyCheckTimer);
      this.readyCheckTimer = null;
    }

    if (this.readyCheck && this.readyCheck.active) {
      this.readyCheck = null;
      this.version++;
      this.broadcast({
        type: "READY_CHECK_CANCEL",
        version: this.version,
        payload: { reason },
      });
      this.emitSystemMessage(`Ready check cancelled: ${reason}`);
    }
  }

  // ==========================================
  // SYNC HEALTH & TELEMETRY
  // ==========================================

  public recordMemberMetrics(
    userId: string,
    metrics: {
      rttMs: number;
      clockOffsetMs: number;
      driftMs: number;
      playbackRate: number;
      isBuffering: boolean;
    }
  ): void {
    const member = this.members.get(userId);
    this.memberMetrics.set(userId, {
      userId,
      userName: member ? member.userName : "Peer",
      rttMs: Math.round(metrics.rttMs),
      clockOffsetMs: Math.round(metrics.clockOffsetMs),
      driftMs: Math.round(metrics.driftMs),
      playbackRate: Number(metrics.playbackRate.toFixed(2)),
      isBuffering: metrics.isBuffering,
      lastReportTimeMs: Date.now(),
    });

    if (member && member.isBuffering !== metrics.isBuffering) {
      this.applyBufferReport(userId, metrics.isBuffering);
    }
  }

  public getSyncHealthSummary(): RoomSyncHealthSummary {
    const connected = Array.from(this.members.values()).filter((m) => m.isConnected);
    const metricsList: MemberSyncMetrics[] = [];

    for (const m of connected) {
      const reported = this.memberMetrics.get(m.userId);
      if (reported && Date.now() - reported.lastReportTimeMs < 15000) {
        metricsList.push(reported);
      } else {
        metricsList.push({
          userId: m.userId,
          userName: m.userName,
          rttMs: 25,
          clockOffsetMs: 0,
          driftMs: 0,
          playbackRate: 1.0,
          isBuffering: m.isBuffering,
          lastReportTimeMs: Date.now(),
        });
      }
    }

    if (metricsList.length === 0) {
      return {
        p50DriftMs: 0,
        p95DriftMs: 0,
        maxDriftMs: 0,
        averageRttMs: 0,
        bufferingCount: 0,
        totalMembers: 0,
        syncCoherenceScore: 100,
        memberMetrics: [],
      };
    }

    const drifts = metricsList.map((m) => Math.abs(m.driftMs)).sort((a, b) => a - b);
    const p50Idx = Math.floor(drifts.length * 0.5);
    const p95Idx = Math.min(drifts.length - 1, Math.floor(drifts.length * 0.95));
    const p50DriftMs = drifts[p50Idx] || 0;
    const p95DriftMs = drifts[p95Idx] || 0;
    const maxDriftMs = drifts[drifts.length - 1] || 0;

    const totalRtt = metricsList.reduce((sum, m) => sum + m.rttMs, 0);
    const averageRttMs = Math.round(totalRtt / metricsList.length);
    const bufferingCount = metricsList.filter((m) => m.isBuffering).length;

    const driftPenalty = Math.min(60, p95DriftMs / 8);
    const bufferPenalty = Math.min(40, bufferingCount * 15);
    const syncCoherenceScore = Math.max(0, Math.round(100 - driftPenalty - bufferPenalty));

    return {
      p50DriftMs,
      p95DriftMs,
      maxDriftMs,
      averageRttMs,
      bufferingCount,
      totalMembers: connected.length,
      syncCoherenceScore,
      memberMetrics: metricsList,
    };
  }

  public broadcastSyncHealth(): void {
    this.broadcast({
      type: "SYNC_METRICS_BROADCAST",
      payload: this.getSyncHealthSummary(),
    });
  }

  // ==========================================
  // SNAPSHOT & BROADCAST UTILITIES
  // ==========================================

  public getSnapshot(selfUserId: string, sessionToken: string): RoomSnapshot {
    const member = this.members.get(selfUserId);
    const memberJoinedAt = member ? member.joinedAt : Date.now();
    const selfRole: Role = member?.role || (member?.isHost ? "host" : "guest");
    const isStaff = selfRole === "host" || selfRole === "moderator";

    this.pruneExpiredChat();
    return {
      roomId: this.roomId,
      roomCode: this.roomCode,
      roomName: this.roomName,
      inviteUrl: this.inviteUrl,
      hostId: this.hostId,
      version: this.version,
      controlMode: this.controlMode,
      roomType: this.roomType,
      hasPassword: Boolean(this.passwordHash),
      maxMembers: this.maxMembers,
      waitingRoomEnabled: this.waitingRoomEnabled,
      autoApproveFriends: this.autoApproveFriends,
      isLocked: this.isLocked,
      slowModeSeconds: this.slowModeSeconds,
      profanityFilterEnabled: this.profanityFilterEnabled,
      chatRetentionDays: this.chatRetentionDays,
      roomRules: this.roomRules,
      videoDisabledForRoom: this.videoDisabledForRoom,
      voiceParticipants: Array.from(this.voiceParticipants.values()),
      recordingState: this.getRecordingState(),
      members: Array.from(this.members.values()).map((m) => this.toPublicMember(m)),
      waitingRequests: isStaff ? Array.from(this.waitingRequests.values()) : undefined,
      bans: isStaff ? this.getBans() : undefined,
      playback: { ...this.playback },
      playlist: [...this.playlist],
      activePoll: this.activePoll ? this.getPollSummary(this.activePoll, selfUserId) : null,
      chatHistory: this.e2eeEnabled
        ? this.chatHistory.filter((m) => m.serverTimestampMs >= memberJoinedAt)
        : [...this.chatHistory],
      storedReactions: [...this.storedReactions],
      bookmarks: [...this.bookmarks],
      readyCheck: this.readyCheck ? { ...this.readyCheck } : null,
      syncHealth: this.getSyncHealthSummary(),
      selfUserId,
      selfRole,
      reconnectToken: sessionToken,
      serverTimeMs: Date.now(),
      e2eeEnabled: this.e2eeEnabled,
      e2eeKeyVersion: this.e2eeKeyVersion,
      e2eeSafetyFingerprint: this.e2eeSafetyFingerprint,
      screenShare: this.activeScreenShareSession || null,
      approvedScreenSharers: Array.from(this.approvedScreenSharers),
      requireLinkApproval: this.requireLinkApproval,
      approvedSourceAdders: Array.from(this.approvedSourceAdders),
      sourceApprovalQueue: isStaff ? Array.from(this.sourceApprovalQueue.values()) : undefined,
      sourceAuditLog: this.sourceAuditLog.slice(-50),
      sourceBlocklist: Array.from(this.sourceBlocklist.values()),
      isHomeRoom: this.isHomeRoom,
      homeGroupName: this.homeGroupName,
      sourcePlaybackMemory: Object.fromEntries(this.sourcePlaybackMemory.entries()),
    };
  }

  public broadcast(message: ServerMessage): void {
    this.broadcastLocal(message);
    if (this.onClusterBroadcast) {
      this.onClusterBroadcast(this.roomId, message);
    }
    // Automatically trigger durable state persistence for state mutations
    if (
      message.type === "PLAYBACK_UPDATE" ||
      message.type === "PLAYLIST_UPDATED" ||
      message.type === "ROOM_SETTINGS_UPDATED" ||
      message.type === "CHAT_BROADCAST" ||
      message.type === "CHAT_BROADCAST_ENCRYPTED"
    ) {
      this.notifyStateChanged();
    }
  }

  public broadcastLocal(message: ServerMessage): void {
    for (const member of this.members.values()) {
      if (member.isConnected && member.connection) {
        try {
          member.connection.send(message);
        } catch {
          // Socket error handled in connection wrapper
        }
      }
    }
  }

  public notifyStateChanged(): void {
    if (this.onStateChanged) {
      this.onStateChanged(this);
    }
  }

  public broadcastExcept(excludeUserId: string, message: ServerMessage): void {
    for (const member of this.members.values()) {
      if (member.userId !== excludeUserId && member.isConnected && member.connection) {
        try {
          member.connection.send(message);
        } catch {
          // Socket error
        }
      }
    }
  }

  private toPublicMember(m: RoomMemberInternal): MemberPublicInfo {
    const vp = this.voiceParticipants.get(m.userId);
    return {
      userId: m.userId,
      userName: m.userName,
      role: m.role || (m.isHost ? "host" : "member"),
      isHost: m.isHost,
      isConnected: m.isConnected,
      isBuffering: m.isBuffering,
      isMuted: Boolean(m.isMuted),
      joinedAt: m.joinedAt,
      e2eePublicKey: m.e2eePublicKey,
      inVoice: vp ? vp.inVoice : false,
      isSpeaking: vp ? vp.isSpeaking : false,
      voiceMuted: vp ? vp.audioMuted : undefined,
      videoEnabled: vp ? vp.videoEnabled : false,
    };
  }

  private getPollSummary(poll: Poll, selfUserId?: string): PollSummary {
    let userVotedOptionId: string | undefined;
    if (selfUserId) {
      for (const opt of poll.options) {
        if (opt.voterUserIds.includes(selfUserId)) {
          userVotedOptionId = opt.id;
          break;
        }
      }
    }

    return {
      id: poll.id,
      question: poll.question,
      options: poll.options.map((opt) => ({
        id: opt.id,
        text: opt.text,
        votes: opt.votes,
      })),
      expiresAtServerTimeMs: poll.expiresAtServerTimeMs,
      isClosed: poll.isClosed,
      autoQueueWinner: poll.autoQueueWinner,
      userVotedOptionId,
    };
  }

  private startIdleTimer(): void {
    // Persistent home rooms for friend groups are standing rooms and exempt from idle destruction
    if (this.isHomeRoom) return;
    if (this.idleCleanupTimer) return;
    this.idleCleanupTimer = setTimeout(() => {
      this.idleCleanupTimer = null;
      const activeCount = Array.from(this.members.values()).filter((m) => m.isConnected).length;
      if (activeCount === 0) {
        if (this.onDestroy) {
          this.onDestroy(this.roomId);
        }
      }
    }, this.idleTtlMs);
  }

  private cancelIdleTimer(): void {
    if (this.idleCleanupTimer) {
      clearTimeout(this.idleCleanupTimer);
      this.idleCleanupTimer = null;
    }
  }

  public destroy(): void {
    if (this.hostDisconnectTimer) {
      clearTimeout(this.hostDisconnectTimer);
      this.hostDisconnectTimer = null;
    }
    if (this.pollExpirationTimer) {
      clearTimeout(this.pollExpirationTimer);
      this.pollExpirationTimer = null;
    }
    if (this.readyCheckTimer) {
      clearTimeout(this.readyCheckTimer);
      this.readyCheckTimer = null;
    }
    this.cancelIdleTimer();
    this.members.clear();
    this.ringBuffer.clear();
  }

  public getMember(userId: string): RoomMemberInternal | undefined {
    return this.members.get(userId);
  }

  public getMemberByToken(token: string): RoomMemberInternal | undefined {
    for (const m of this.members.values()) {
      if (m.sessionToken === token) return m;
    }
    return undefined;
  }

  public getMemberByAccountId(accountId: string): RoomMemberInternal | undefined {
    for (const m of this.members.values()) {
      if (m.accountId === accountId) return m;
    }
    return undefined;
  }

  public anonymizeUser(accountIdOrUserId: string): void {
    const targetUserIds = new Set<string>();
    targetUserIds.add(accountIdOrUserId);

    for (const member of this.members.values()) {
      if (member.userId === accountIdOrUserId || member.accountId === accountIdOrUserId) {
        targetUserIds.add(member.userId);
        if (member.accountId) targetUserIds.add(member.accountId);
        if (member.connection && member.connection.isAlive) {
          try {
            member.connection.close(1008, "Account deleted");
          } catch {
            // ignore
          }
        }
      }
    }

    for (const msg of this.chatHistory) {
      if (targetUserIds.has(msg.userId)) {
        msg.userName = "[Deleted User]";
      }
    }

    for (const [reqId, req] of this.waitingRequests.entries()) {
      if (targetUserIds.has(req.userId) || (req.accountId && targetUserIds.has(req.accountId))) {
        this.waitingRequests.delete(reqId);
      }
    }

    for (const targetId of targetUserIds) {
      if (this.members.has(targetId)) {
        this.removeMember(targetId);
      }
    }
  }

  // ==========================================
  // SCREEN SHARING & WEBRTC SIGNALING ROUTING
  // ==========================================

  public canShareScreen(userId: string): boolean {
    if (userId === this.hostId) return true;
    if (this.approvedScreenSharers.has(userId)) return true;
    const member = this.members.get(userId);
    if (member && this.hasPermission(userId, "share_screen")) return true;
    return false;
  }

  public startScreenShare(
    userId: string,
    clientSeq?: number,
    payload?: { title?: string; hasAudio?: boolean }
  ): { success: true; version: number; session: ScreenShareSessionInfo } | { success: false; code: string; message: string } {
    const member = this.members.get(userId);
    if (!member) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Member not found in room",
      };
    }

    // Security check: Only the host or approved members can share their screen
    if (!this.canShareScreen(userId)) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Permission denied: Only the host or approved members can share their screen",
      };
    }

    // If another member is sharing: only host can preempt
    if (this.activeScreenSharerId && this.activeScreenSharerId !== userId) {
      if (userId !== this.hostId) {
        return {
          success: false,
          code: ERROR_CODES.PERMISSION_DENIED,
          message: "Another member is currently sharing their screen",
        };
      }
      this.stopScreenShare(this.activeScreenSharerId, undefined, "preempted_by_host");
    }

    this.activeScreenSharerId = userId;
    const transportMode: ScreenShareTransportMode = this.members.size >= 10 ? "sfu" : "mesh";
    const session: ScreenShareSessionInfo = {
      sharerUserId: userId,
      sharerUserName: member.userName,
      title: payload?.title || `${member.userName}'s Screen`,
      hasAudio: payload?.hasAudio ?? true,
      transportMode,
      startedAtMs: Date.now(),
    };
    this.activeScreenShareSession = session;

    // The sharer is the clock: live edge stream
    const now = Date.now();
    this.playback = {
      videoId: `screenshare:${userId}`,
      status: "playing",
      positionMs: 0,
      serverTimeMs: now,
      playbackRate: 1.0,
      provider: "screenshare",
      sourceRef: `screenshare:${userId}`,
    };

    this.version++;
    const event: RoomEvent = {
      version: this.version,
      type: "SCREEN_SHARE_STARTED",
      payload: session,
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "SCREEN_SHARE_STARTED",
      version: this.version,
      payload: session,
    });

    this.broadcast({
      type: "PLAYBACK_UPDATE",
      version: this.version,
      payload: {
        playback: { ...this.playback },
        causedBy: { userId, clientSeq },
        reason: "screenshare_start",
      },
    });

    this.emitSystemMessage(`${member.userName} started sharing their screen (${transportMode.toUpperCase()} mode)`);

    return { success: true, version: this.version, session };
  }

  public stopScreenShare(
    userId: string,
    clientSeq?: number,
    reason?: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (!this.activeScreenSharerId) {
      return { success: true, version: this.version };
    }

    // Security check: Only the active sharer or host can stop screen sharing
    if (userId !== this.activeScreenSharerId && userId !== this.hostId) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Permission denied: Only the active screen sharer or room host can stop screen sharing",
      };
    }

    const previousSharerId = this.activeScreenSharerId;
    this.activeScreenSharerId = undefined;
    this.activeScreenShareSession = null;

    const now = Date.now();
    this.playback = {
      ...this.playback,
      status: "paused",
      serverTimeMs: now,
    };

    this.version++;
    const event: RoomEvent = {
      version: this.version,
      type: "SCREEN_SHARE_STOPPED",
      payload: { sharerUserId: previousSharerId, reason: reason || "sharer_stopped" },
      serverTimeMs: now,
      causedBy: { userId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "SCREEN_SHARE_STOPPED",
      version: this.version,
      payload: { sharerUserId: previousSharerId, reason: reason || "sharer_stopped" },
    });

    this.broadcast({
      type: "PLAYBACK_UPDATE",
      version: this.version,
      payload: {
        playback: { ...this.playback },
        causedBy: { userId, clientSeq },
        reason: "screenshare_stop",
      },
    });

    this.emitSystemMessage("Screen sharing ended");

    return { success: true, version: this.version };
  }

  public approveScreenSharer(
    hostUserId: string,
    clientSeq?: number,
    targetUserId?: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (hostUserId !== this.hostId) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Only the room host can approve screen sharing permissions",
      };
    }
    if (!targetUserId || !this.members.has(targetUserId)) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Target member not found in room",
      };
    }

    this.approvedScreenSharers.add(targetUserId);
    this.version++;
    const event: RoomEvent = {
      version: this.version,
      type: "SCREEN_SHARE_PERMISSION_GRANTED",
      payload: { targetUserId, grantedBy: hostUserId },
      serverTimeMs: Date.now(),
      causedBy: { userId: hostUserId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "SCREEN_SHARE_PERMISSION_GRANTED",
      version: this.version,
      payload: { targetUserId, grantedBy: hostUserId },
    });

    const target = this.members.get(targetUserId);
    if (target) {
      this.emitSystemMessage(`${target.userName} was granted screen sharing permission`);
    }

    return { success: true, version: this.version };
  }

  public revokeScreenSharer(
    hostUserId: string,
    clientSeq?: number,
    targetUserId?: string
  ): { success: true; version: number } | { success: false; code: string; message: string } {
    if (hostUserId !== this.hostId) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Only the room host can revoke screen sharing permissions",
      };
    }
    if (!targetUserId || !this.members.has(targetUserId)) {
      return {
        success: false,
        code: ERROR_CODES.TARGET_NOT_FOUND,
        message: "Target member not found in room",
      };
    }

    this.approvedScreenSharers.delete(targetUserId);

    // If target was actively sharing, stop their stream immediately
    if (this.activeScreenSharerId === targetUserId) {
      this.stopScreenShare(hostUserId, clientSeq, "permission_revoked");
    }

    this.version++;
    const event: RoomEvent = {
      version: this.version,
      type: "SCREEN_SHARE_PERMISSION_REVOKED",
      payload: { targetUserId, revokedBy: hostUserId },
      serverTimeMs: Date.now(),
      causedBy: { userId: hostUserId, clientSeq },
    };
    this.ringBuffer.push(event);

    this.broadcast({
      type: "SCREEN_SHARE_PERMISSION_REVOKED",
      version: this.version,
      payload: { targetUserId, revokedBy: hostUserId },
    });

    const target = this.members.get(targetUserId);
    if (target) {
      this.emitSystemMessage(`${target.userName}'s screen sharing permission was revoked`);
    }

    return { success: true, version: this.version };
  }

  public forwardWebRtcSignal(
    fromUserId: string,
    targetUserId: string,
    signalType: "offer" | "answer" | "ice-candidate",
    signalData: any,
    screenShareSessionId?: string
  ): { success: boolean; code?: string; message?: string } {
    if (!this.members.has(fromUserId)) {
      return { success: false, code: ERROR_CODES.TARGET_NOT_FOUND, message: "Sender not found in room" };
    }
    const targetMember = this.members.get(targetUserId);
    if (!targetMember || !targetMember.connection) {
      return { success: false, code: ERROR_CODES.TARGET_NOT_FOUND, message: "Target member not found or offline" };
    }

    // Security check:
    // Only the active screen sharer can send WebRTC offers (media publisher).
    // Viewers are strictly subscribers and can NEVER send media offers!
    if (signalType === "offer" && fromUserId !== this.activeScreenSharerId) {
      return {
        success: false,
        code: ERROR_CODES.PERMISSION_DENIED,
        message: "Security violation: Viewers are not permitted to send media offers",
      };
    }

    // Deliver the signaling message directly to target peer
    try {
      targetMember.connection.send({
        type: "WEBRTC_SIGNAL",
        payload: {
          fromUserId,
          signalType,
          signalData,
          screenShareSessionId,
        },
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, code: ERROR_CODES.INTERNAL_ERROR, message: err.message };
    }
  }

  public recordScreenShareMetrics(userId: string, metrics: ScreenShareMetrics): void {
    this.screenShareMetrics.set(userId, metrics);
  }

  public getScreenShareMetrics(): ScreenShareMetrics[] {
    return Array.from(this.screenShareMetrics.values());
  }

  // ==========================================
  // PERSISTENCE & SERIALIZATION HELPERS
  // ==========================================

  public getPasswordHash(): string | undefined {
    return this.passwordHash;
  }

  public getPasswordSalt(): string | undefined {
    return this.passwordSalt;
  }

  public getBannedUserIds(): string[] {
    return Array.from(this.bannedUserIds);
  }

  public getBannedAccountIds(): string[] {
    return Array.from(this.bannedAccountIds);
  }

  public getBannedSessionTokens(): string[] {
    return Array.from(this.bannedSessionTokens);
  }

  public restoreBanEntries(userIds: string[], accountIds: string[], sessionTokens: string[]): void {
    for (const u of userIds) this.bannedUserIds.add(u);
    for (const a of accountIds) this.bannedAccountIds.add(a);
    for (const s of sessionTokens) this.bannedSessionTokens.add(s);
  }

  public getAllMembers(): RoomMemberInternal[] {
    return Array.from(this.members.values());
  }

  public getMemberCount(): number {
    return this.members.size;
  }

  public restoreMember(member: RoomMemberInternal): void {
    this.members.set(member.userId, member);
  }
}
