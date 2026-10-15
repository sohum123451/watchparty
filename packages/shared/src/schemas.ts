import { z } from "zod";
import {
  ControlMode,
  PlaybackStatus,
  RoomSnapshot,
  MemberPublicInfo,
  PlaybackState,
  PlaylistItem,
  PollSummary,
  ChatMessage,
  ReactionBurst,
  RoomEvent,
  MomentBookmark,
  ReadyCheck,
  RoomSyncHealthSummary,
  FriendPresence,
  FriendUserInfo,
  NotificationItem,
  RoomInvite,
  RoomType,
  Role,
  WaitingJoinRequest,
  RoomBan,
  MuteRecord,
  RoomInviteLink,
  ModerationReport,
  UserProfile,
  WatchHistoryItem,
  FavouriteItem,
  FriendCoWatchStats,
  PersonalPlaylist,
  ActiveSession,
  UserDataExport,
  UserPrivacySettings,
  NotificationPreferences,
  ScreenShareSessionInfo,
  WebRtcSignalPayload,
  ScreenShareMetrics,
  RelativeReadingPosition,
  MemberReadingPresence,
  SharedHighlight,
  StickyComment,
  SectionPing,
  CoBrowseMediaState,
  CoBrowseSession,
  PendingSourceSubmission,
  SourceAuditEntry,
  SourceReport,
  SourceBlocklistRule,
  UrlSafetyReport,
  ParticipantMediaState,
} from "./models.js";

// ==========================================
// CLIENT -> SERVER MESSAGE SCHEMAS
// ==========================================

export const SyncPingSchema = z.object({
  type: z.literal("SYNC_PING"),
  payload: z.object({
    clientSendTimeMs: z.number().int().positive(),
  }),
});

export const RoomCreateSchema = z.object({
  type: z.literal("ROOM_CREATE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    userName: z.string().trim().min(1).max(32),
    roomName: z.string().trim().min(1).max(64),
    controlMode: z.enum(["host_only", "public"]).default("public"),
    roomType: z.enum(["public", "friends-only", "invite-only"]).default("public"),
    roomPassword: z.string().trim().min(1).max(64).optional(),
    maxMembers: z.number().int().min(2).max(500).optional(),
    waitingRoomEnabled: z.boolean().default(false),
    autoApproveFriends: z.boolean().default(true),
    profanityFilterEnabled: z.boolean().default(false),
    slowModeSeconds: z.number().int().min(0).max(300).default(0),
    initialVideoId: z.string().trim().optional(),
    e2eeEnabled: z.boolean().default(false),
    e2eePublicKey: z.string().trim().optional(),
    chatRetentionDays: z.number().int().min(0).max(365).optional(),
    roomRules: z.string().max(2000).trim().optional(),
  }),
});

export const RoomJoinSchema = z.object({
  type: z.literal("ROOM_JOIN"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    roomCode: z.string().trim().toUpperCase().min(4).max(10),
    userName: z.string().trim().min(1).max(32),
    password: z.string().trim().optional(),
    inviteToken: z.string().trim().optional(),
    reconnectToken: z.string().trim().optional(),
    lastKnownVersion: z.number().int().min(0).optional(),
    e2eePublicKey: z.string().trim().optional(),
  }),
});

export const RoomLeaveSchema = z.object({
  type: z.literal("ROOM_LEAVE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({}).optional().default({}),
});

export const RoomTransferHostSchema = z.object({
  type: z.literal("ROOM_TRANSFER_HOST"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    targetUserId: z.string().trim().min(1),
  }),
});

export const RoomUpdateSettingsSchema = z.object({
  type: z.literal("ROOM_UPDATE_SETTINGS"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    controlMode: z.enum(["host_only", "public"]).optional(),
    roomType: z.enum(["public", "friends-only", "invite-only"]).optional(),
    roomPassword: z.string().trim().nullable().optional(),
    maxMembers: z.number().int().min(2).max(500).optional(),
    waitingRoomEnabled: z.boolean().optional(),
    autoApproveFriends: z.boolean().optional(),
    profanityFilterEnabled: z.boolean().optional(),
    slowModeSeconds: z.number().int().min(0).max(300).optional(),
    isLocked: z.boolean().optional(),
    chatRetentionDays: z.number().int().min(0).max(365).optional(),
    roomRules: z.string().max(2000).trim().nullable().optional(),
  }),
});

export const PlaybackPlaySchema = z.object({
  type: z.literal("PLAYBACK_PLAY"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    positionMs: z.number().min(0).optional(),
  }),
});

export const PlaybackPauseSchema = z.object({
  type: z.literal("PLAYBACK_PAUSE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    positionMs: z.number().min(0).optional(),
  }),
});

export const PlaybackSeekSchema = z.object({
  type: z.literal("PLAYBACK_SEEK"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    targetPositionMs: z.number().min(0),
    autoPlay: z.boolean().optional(),
  }),
});

export const PlaybackChangeVideoSchema = z.object({
  type: z.literal("PLAYBACK_CHANGE_VIDEO"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    videoId: z.string().trim().min(1),
    provider: z.enum(["html5", "youtube", "vimeo", "local", "screenshare"]).optional(),
    sourceRef: z.string().optional(),
    title: z.string().optional(),
    startPositionMs: z.number().min(0).optional(),
    autoPlay: z.boolean().optional(),
  }),
});

export const PlaybackBufferReportSchema = z.object({
  type: z.literal("PLAYBACK_BUFFER_REPORT"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    isBuffering: z.boolean(),
    bufferedUpToMs: z.number().min(0).optional(),
  }),
});

export const PlaylistAddSchema = z.object({
  type: z.literal("PLAYLIST_ADD"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    videoId: z.string().trim().min(1),
    provider: z.enum(["html5", "youtube", "vimeo", "local", "screenshare"]).optional(),
    sourceRef: z.string().optional(),
    title: z.string().trim().min(1).max(128),
    durationMs: z.number().min(0),
    thumbnailUrl: z.string().optional(),
  }),
});

export const PlaylistRemoveSchema = z.object({
  type: z.literal("PLAYLIST_REMOVE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    playlistItemId: z.string().trim().min(1),
  }),
});

export const PlaylistReorderSchema = z.object({
  type: z.literal("PLAYLIST_REORDER"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    playlistItemId: z.string().trim().min(1),
    newIndex: z.number().int().min(0),
    order: z.number().optional(),
    expectedVersion: z.number().int().optional(),
  }),
});

export const PollCreateSchema = z.object({
  type: z.literal("POLL_CREATE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    question: z.string().trim().min(1).max(120),
    options: z.array(z.string().trim().min(1).max(64)).min(2).max(6),
    durationSeconds: z.number().int().min(10).max(300).default(30),
    autoQueueWinner: z.boolean().default(false),
  }),
});

export const PollVoteSchema = z.object({
  type: z.literal("POLL_VOTE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    pollId: z.string().trim().min(1),
    optionIndex: z.number().int().min(0),
  }),
});

export const PollCloseSchema = z.object({
  type: z.literal("POLL_CLOSE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    pollId: z.string().trim().min(1),
  }),
});

export const ChatSendSchema = z.object({
  type: z.literal("CHAT_SEND"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    text: z.string().trim().min(1).max(500),
  }),
});

export const ChatTypingSchema = z.object({
  type: z.literal("CHAT_TYPING"),
  payload: z.object({
    isTyping: z.boolean(),
  }),
});

export const PlaybackEndedSchema = z.object({
  type: z.literal("PLAYBACK_ENDED"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    videoId: z.string().trim().min(1),
  }),
});

export const ReactionEmitSchema = z.object({
  type: z.literal("REACTION_EMIT"),
  payload: z.object({
    emoji: z.string().min(1).max(8),
    videoTimestampMs: z.number().min(0),
  }),
});

export const BookmarkCreateSchema = z.object({
  type: z.literal("BOOKMARK_CREATE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    videoId: z.string().trim().min(1),
    timestampMs: z.number().min(0),
    text: z.string().trim().min(1).max(280),
    color: z.string().optional(),
  }),
});

export const BookmarkRemoveSchema = z.object({
  type: z.literal("BOOKMARK_REMOVE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    bookmarkId: z.string().trim().min(1),
  }),
});

export const ReadyCheckStartSchema = z.object({
  type: z.literal("READY_CHECK_START"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    countdownMs: z.number().int().min(1000).max(10000).default(3000),
    startPositionMs: z.number().min(0).optional(),
  }),
});

export const SyncMetricsReportSchema = z.object({
  type: z.literal("SYNC_METRICS_REPORT"),
  payload: z.object({
    rttMs: z.number(),
    clockOffsetMs: z.number(),
    driftMs: z.number(),
    playbackRate: z.number(),
    isBuffering: z.boolean(),
  }),
});

export const FriendPresenceQuerySchema = z.object({
  type: z.literal("FRIEND_PRESENCE_QUERY"),
  payload: z.object({}).optional().default({}),
});

export const FriendInviteSendSchema = z.object({
  type: z.literal("FRIEND_INVITE_SEND"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    friendUserId: z.string().trim().min(1),
  }),
});

export const NotificationsMarkReadSchema = z.object({
  type: z.literal("NOTIFICATIONS_MARK_READ"),
  payload: z.object({
    notificationId: z.string().optional(),
    all: z.boolean().optional(),
  }),
});

export const RoomE2eeKeyDistributeSchema = z.object({
  type: z.literal("ROOM_E2EE_KEY_DISTRIBUTE"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    keyVersion: z.number().int().positive(),
    packages: z.array(
      z.object({
        targetUserId: z.string().trim().min(1),
        wrappedKey: z.string().trim().min(1),
        iv: z.string().trim().min(1),
      })
    ),
  }),
});

export const ChatSendEncryptedSchema = z.object({
  type: z.literal("CHAT_SEND_ENCRYPTED"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    ciphertext: z.string().trim().min(1),
    iv: z.string().trim().min(1),
    keyVersion: z.number().int().positive(),
  }),
});

export const RoomKickMemberSchema = z.object({
  type: z.literal("ROOM_KICK_MEMBER"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    targetUserId: z.string().trim().min(1),
    reason: z.string().optional(),
  }),
});

export const RoomBanMemberSchema = z.object({
  type: z.literal("ROOM_BAN_MEMBER"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    targetUserId: z.string().trim().min(1),
    banType: z.enum(["account", "session", "both"]).default("both"),
    reason: z.string().trim().max(200).optional(),
    durationSeconds: z.number().int().positive().optional(),
  }),
});

export const RoomGetBansSchema = z.object({
  type: z.literal("ROOM_GET_BANS"),
  clientSeq: z.number().int().positive(),
  payload: z.object({}).optional(),
});

export const RoomUnbanSchema = z.object({
  type: z.literal("ROOM_UNBAN"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    targetIdentifier: z.string().trim().min(1),
  }),
});

export const RoomMuteMemberSchema = z.object({
  type: z.literal("ROOM_MUTE_MEMBER"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    targetUserId: z.string().trim().min(1),
    durationSeconds: z.number().int().min(1).max(86400).optional(),
    reason: z.string().trim().max(200).optional(),
  }),
});

export const RoomUnmuteMemberSchema = z.object({
  type: z.literal("ROOM_UNMUTE_MEMBER"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    targetUserId: z.string().trim().min(1),
  }),
});

export const RoomAssignRoleSchema = z.object({
  type: z.literal("ROOM_ASSIGN_ROLE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    targetUserId: z.string().trim().min(1),
    role: z.enum(["moderator", "member", "guest"]),
  }),
});

export const ChatMessageDeleteSchema = z.object({
  type: z.literal("CHAT_MESSAGE_DELETE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    messageId: z.string().trim().min(1),
  }),
});

export const RoomLockToggleSchema = z.object({
  type: z.literal("ROOM_LOCK_TOGGLE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    isLocked: z.boolean(),
  }),
});

export const WaitingRoomApproveSchema = z.object({
  type: z.literal("WAITING_ROOM_APPROVE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    requestId: z.string().trim().min(1),
  }),
});

export const WaitingRoomDenySchema = z.object({
  type: z.literal("WAITING_ROOM_DENY"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    requestId: z.string().trim().min(1),
    reason: z.string().trim().max(200).optional(),
  }),
});

export const ModerationReportCreateSchema = z.object({
  type: z.literal("MODERATION_REPORT_CREATE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    targetType: z.enum(["user", "message"]),
    targetUserId: z.string().trim().min(1),
    targetMessageId: z.string().trim().optional(),
    reason: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
  }),
});

export const InviteLinkCreateSchema = z.object({
  type: z.literal("INVITE_LINK_CREATE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    expiresInSeconds: z.number().int().min(60).max(2592000).optional(),
    maxUses: z.number().int().min(1).max(1000).optional(),
    role: z.enum(["member", "guest"]).default("member"),
  }),
});

export const InviteLinkRevokeSchema = z.object({
  type: z.literal("INVITE_LINK_REVOKE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    inviteId: z.string().trim().min(1),
  }),
});

export const InviteLinkRegenerateSchema = z.object({
  type: z.literal("INVITE_LINK_REGENERATE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    inviteId: z.string().trim().min(1),
    expiresInSeconds: z.number().int().min(60).max(2592000).optional(),
    maxUses: z.number().int().min(1).max(1000).optional(),
  }),
});

export const ScreenShareStartSchema = z.object({
  type: z.literal("SCREEN_SHARE_START"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    title: z.string().trim().max(100).optional(),
    hasAudio: z.boolean().default(true),
  }),
});

export const ScreenShareStopSchema = z.object({
  type: z.literal("SCREEN_SHARE_STOP"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    reason: z.string().trim().optional(),
  }),
});

export const RoomScreenSharePermitSchema = z.object({
  type: z.literal("ROOM_SCREEN_SHARE_PERMIT"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    targetUserId: z.string().trim().min(1),
  }),
});

export const RoomScreenShareRevokeSchema = z.object({
  type: z.literal("ROOM_SCREEN_SHARE_REVOKE"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    targetUserId: z.string().trim().min(1),
  }),
});

export const WebRtcSignalSchema = z.object({
  type: z.literal("WEBRTC_SIGNAL"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    targetUserId: z.string().trim().min(1),
    signalType: z.enum(["offer", "answer", "ice-candidate"]),
    signalData: z.any(),
    screenShareSessionId: z.string().optional(),
  }),
});

export const ScreenShareMetricsReportSchema = z.object({
  type: z.literal("SCREEN_SHARE_METRICS_REPORT"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    rttMs: z.number().min(0),
    jitterMs: z.number().min(0),
    packetLossPercent: z.number().min(0).max(100),
    liveDelayMs: z.number().min(0),
    bitrateBps: z.number().optional(),
    fps: z.number().optional(),
    resolution: z.string().optional(),
  }),
});

// ==========================================
// CO-BROWSE SCHEMAS
// ==========================================

export const RelativeReadingPositionSchema = z.object({
  anchorSelector: z.string(),
  anchorTextSnippet: z.string().optional(),
  offsetPx: z.number(),
  percentageWithinAnchor: z.number(),
});

export const W3CTextQuoteSelectorSchema = z.object({
  exact: z.string(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
});

export const SharedHighlightSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  color: z.string(),
  target: W3CTextQuoteSelectorSchema,
  createdAt: z.number(),
});

export const StickyCommentSchema = z.object({
  id: z.string(),
  highlightId: z.string().optional(),
  userId: z.string(),
  userName: z.string(),
  userAvatar: z.string().optional(),
  target: W3CTextQuoteSelectorSchema,
  commentText: z.string().trim().min(1).max(2000),
  createdAt: z.number(),
});

export const MemberReadingPresenceSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  userColor: z.string(),
  anchorSelector: z.string(),
  anchorTextSnippet: z.string().optional(),
  lastUpdated: z.number(),
});

export const SectionPingSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userName: z.string(),
  sectionTitle: z.string(),
  anchorSelector: z.string(),
  timestamp: z.number(),
});

export const CoBrowseMediaStateSchema = z.object({
  mediaId: z.string(),
  tagName: z.enum(["video", "audio"]),
  status: z.enum(["playing", "paused"]),
  positionMs: z.number(),
  serverTimeMs: z.number(),
  playbackRate: z.number(),
  durationMs: z.number().optional(),
});

export const CoBrowseSessionSchema = z.object({
  url: z.string(),
  title: z.string(),
  frameAllowed: z.boolean(),
  hostReadingPosition: RelativeReadingPositionSchema.optional(),
  activeMedia: CoBrowseMediaStateSchema.optional(),
  highlights: z.array(SharedHighlightSchema).default([]),
  stickyComments: z.array(StickyCommentSchema).default([]),
  presence: z.record(z.string(), MemberReadingPresenceSchema).default({}),
  sharedNotes: z.string().default(""),
  notesVersion: z.number().default(1),
  sectionPings: z.array(SectionPingSchema).default([]),
});

export const CoBrowseScrollEventSchema = z.object({
  type: z.literal("CO_BROWSE_SCROLL"),
  payload: z.union([
    RelativeReadingPositionSchema,
    z.object({
      position: RelativeReadingPositionSchema,
      isHost: z.boolean().default(false),
    }),
  ]),
});

export const CoBrowsePresenceEventSchema = z.object({
  type: z.literal("CO_BROWSE_PRESENCE"),
  payload: MemberReadingPresenceSchema,
});

export const CoBrowseHighlightAddEventSchema = z.object({
  type: z.literal("CO_BROWSE_HIGHLIGHT_ADD"),
  payload: SharedHighlightSchema,
});

export const CoBrowseHighlightRemoveEventSchema = z.object({
  type: z.literal("CO_BROWSE_HIGHLIGHT_REMOVE"),
  payload: z.object({
    highlightId: z.string(),
  }),
});

export const CoBrowseCommentAddEventSchema = z.object({
  type: z.literal("CO_BROWSE_COMMENT_ADD"),
  payload: StickyCommentSchema,
});

export const CoBrowseCommentDeleteEventSchema = z.object({
  type: z.literal("CO_BROWSE_COMMENT_DELETE"),
  payload: z.object({
    commentId: z.string(),
  }),
});

export const CoBrowseNotesUpdateEventSchema = z.object({
  type: z.literal("CO_BROWSE_NOTES_UPDATE"),
  payload: z.object({
    text: z.string().max(50000),
    version: z.number().int().positive(),
  }),
});

export const CoBrowseSectionPingEventSchema = z.object({
  type: z.literal("CO_BROWSE_SECTION_PING"),
  payload: SectionPingSchema,
});

export const CoBrowseMediaSyncEventSchema = z.object({
  type: z.literal("CO_BROWSE_MEDIA_SYNC"),
  payload: CoBrowseMediaStateSchema,
});

export const SourceSubmitSchema = z.object({
  type: z.literal("SOURCE_SUBMIT"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    url: z.string().url(),
    actionType: z.enum(["change_video", "add_playlist"]),
    title: z.string().optional(),
    autoPlay: z.boolean().optional(),
    startPositionMs: z.number().nonnegative().optional(),
  }),
});

export const SourceApproveSchema = z.object({
  type: z.literal("SOURCE_APPROVE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    submissionId: z.string(),
  }),
});

export const SourceRejectSchema = z.object({
  type: z.literal("SOURCE_REJECT"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    submissionId: z.string(),
    reason: z.string().optional(),
  }),
});

export const SourcePermitUserSchema = z.object({
  type: z.literal("SOURCE_PERMIT_USER"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    targetUserId: z.string(),
    permit: z.boolean(),
  }),
});

export const SourceBlocklistAddSchema = z.object({
  type: z.literal("SOURCE_BLOCKLIST_ADD"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    pattern: z.string().min(1),
    reason: z.string().optional(),
  }),
});

export const SourceBlocklistRemoveSchema = z.object({
  type: z.literal("SOURCE_BLOCKLIST_REMOVE"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    ruleId: z.string(),
  }),
});

export const SourceReportSchema = z.object({
  type: z.literal("SOURCE_REPORT"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    sourceUrl: z.string(),
    reason: z.string().min(1),
    description: z.string().optional(),
  }),
});

export const SourceUpdateSettingsSchema = z.object({
  type: z.literal("SOURCE_UPDATE_SETTINGS"),
  clientSeq: z.number().int().positive(),
  payload: z.object({
    requireLinkApproval: z.boolean(),
  }),
});

export const VoiceStateUpdateSchema = z.object({
  type: z.literal("VOICE_STATE_UPDATE"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    inVoice: z.boolean(),
    audioMuted: z.boolean(),
    videoEnabled: z.boolean(),
    screenSharing: z.boolean().optional(),
  }),
});

export const ModMuteVoiceSchema = z.object({
  type: z.literal("ROOM_MOD_MUTE_VOICE"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    targetUserId: z.string().trim().min(1),
    muteAudio: z.boolean().optional(),
    muteVideo: z.boolean().optional(),
  }),
});

export const ModRemoveVoiceSchema = z.object({
  type: z.literal("ROOM_MOD_REMOVE_VOICE"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    targetUserId: z.string().trim().min(1),
  }),
});

export const ModDisableRoomVideoSchema = z.object({
  type: z.literal("ROOM_MOD_DISABLE_ROOM_VIDEO"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    disabled: z.boolean(),
  }),
});

export const RoomRecordingRequestSchema = z.object({
  type: z.literal("ROOM_RECORDING_REQUEST"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({}).catchall(z.unknown()).optional(),
});

export const RoomRecordingConsentSchema = z.object({
  type: z.literal("ROOM_RECORDING_CONSENT"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({
    consentGranted: z.boolean(),
  }),
});

export const RoomRecordingStopSchema = z.object({
  type: z.literal("ROOM_RECORDING_STOP"),
  clientSeq: z.number().int().positive().optional(),
  payload: z.object({}).catchall(z.unknown()).optional(),
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  SyncPingSchema,
  RoomCreateSchema,
  RoomJoinSchema,
  RoomLeaveSchema,
  RoomTransferHostSchema,
  RoomUpdateSettingsSchema,
  PlaybackPlaySchema,
  PlaybackPauseSchema,
  PlaybackSeekSchema,
  PlaybackChangeVideoSchema,
  PlaybackBufferReportSchema,
  PlaybackEndedSchema,
  PlaylistAddSchema,
  PlaylistRemoveSchema,
  PlaylistReorderSchema,
  PollCreateSchema,
  PollVoteSchema,
  PollCloseSchema,
  ChatSendSchema,
  ChatTypingSchema,
  ReactionEmitSchema,
  BookmarkCreateSchema,
  BookmarkRemoveSchema,
  ReadyCheckStartSchema,
  SyncMetricsReportSchema,
  FriendPresenceQuerySchema,
  FriendInviteSendSchema,
  NotificationsMarkReadSchema,
  RoomE2eeKeyDistributeSchema,
  ChatSendEncryptedSchema,
  RoomKickMemberSchema,
  RoomBanMemberSchema,
  RoomGetBansSchema,
  RoomUnbanSchema,
  RoomMuteMemberSchema,
  RoomUnmuteMemberSchema,
  RoomAssignRoleSchema,
  ChatMessageDeleteSchema,
  RoomLockToggleSchema,
  WaitingRoomApproveSchema,
  WaitingRoomDenySchema,
  ModerationReportCreateSchema,
  InviteLinkCreateSchema,
  InviteLinkRevokeSchema,
  InviteLinkRegenerateSchema,
  ScreenShareStartSchema,
  ScreenShareStopSchema,
  RoomScreenSharePermitSchema,
  RoomScreenShareRevokeSchema,
  WebRtcSignalSchema,
  ScreenShareMetricsReportSchema,
  CoBrowseScrollEventSchema,
  CoBrowsePresenceEventSchema,
  CoBrowseHighlightAddEventSchema,
  CoBrowseHighlightRemoveEventSchema,
  CoBrowseCommentAddEventSchema,
  CoBrowseCommentDeleteEventSchema,
  CoBrowseNotesUpdateEventSchema,
  CoBrowseSectionPingEventSchema,
  CoBrowseMediaSyncEventSchema,
  SourceSubmitSchema,
  SourceApproveSchema,
  SourceRejectSchema,
  SourcePermitUserSchema,
  SourceBlocklistAddSchema,
  SourceBlocklistRemoveSchema,
  SourceReportSchema,
  SourceUpdateSettingsSchema,
  VoiceStateUpdateSchema,
  ModMuteVoiceSchema,
  ModRemoveVoiceSchema,
  ModDisableRoomVideoSchema,
  RoomRecordingRequestSchema,
  RoomRecordingConsentSchema,
  RoomRecordingStopSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ==========================================
// SERVER -> CLIENT MESSAGE DEFINITIONS
// ==========================================

export type ServerMessage =
  | {
      type: "SYNC_PONG";
      payload: {
        clientSendTimeMs: number;
        serverReceiveTimeMs: number;
        serverSendTimeMs: number;
      };
    }
  | {
      type: "ACK";
      clientSeq: number;
      version: number;
    }
  | {
      type: "ERROR";
      clientSeq?: number;
      code: string;
      message: string;
      details?: unknown;
    }
  | {
      type: "ROOM_SNAPSHOT";
      version: number;
      payload: RoomSnapshot;
    }
  | {
      type: "ROOM_MEMBER_JOINED";
      version: number;
      payload: {
        member: MemberPublicInfo;
      };
    }
  | {
      type: "ROOM_MEMBER_LEFT";
      version: number;
      payload: {
        userId: string;
        newHostId?: string;
      };
    }
  | {
      type: "ROOM_BANS_LIST";
      payload: {
        bans: RoomBan[];
      };
    }
  | {
      type: "ROOM_MEMBER_STATUS";
      version: number;
      payload: {
        userId: string;
        isConnected: boolean;
      };
    }
  | {
      type: "ROOM_HOST_CHANGED";
      version: number;
      payload: {
        newHostId: string;
        previousHostId: string;
        reason: "manual" | "automatic_promotion";
      };
    }
  | {
      type: "ROOM_SETTINGS_UPDATED";
      version: number;
      payload: {
        controlMode: ControlMode;
      };
    }
  | {
      type: "PLAYBACK_UPDATE";
      version: number;
      payload: {
        playback: PlaybackState;
        causedBy: {
          userId: string;
          clientSeq?: number;
        };
        reason: string;
      };
    }
  | {
      type: "PLAYLIST_UPDATED";
      version: number;
      payload: {
        playlist: PlaylistItem[];
      };
    }
  | {
      type: "POLL_UPDATED";
      version: number;
      payload: {
        poll: PollSummary;
      };
    }
  | {
      type: "CHAT_BROADCAST";
      version: number;
      payload: {
        message: ChatMessage;
      };
    }
  | {
      type: "CHAT_TYPING_BROADCAST";
      payload: {
        userId: string;
        userName: string;
        isTyping: boolean;
      };
    }
  | {
      type: "REACTION_BROADCAST";
      payload: {
        reaction: ReactionBurst;
      };
    }
  | {
      type: "HEARTBEAT";
      payload: {
        serverTimeMs: number;
      };
    }
  | {
      type: "BOOKMARKS_UPDATED";
      version: number;
      payload: {
        bookmarks: MomentBookmark[];
      };
    }
  | {
      type: "READY_CHECK_COUNTDOWN";
      version: number;
      payload: ReadyCheck;
    }
  | {
      type: "READY_CHECK_CANCEL";
      version: number;
      payload: {
        reason: string;
      };
    }
  | {
      type: "SYNC_METRICS_BROADCAST";
      payload: RoomSyncHealthSummary;
    }
  | {
      type: "MISSED_EVENTS";
      payload: {
        fromVersion: number;
        toVersion: number;
        events: RoomEvent[];
      };
    }
  | {
      type: "FRIEND_REQUEST_RECEIVED";
      payload: {
        id: string;
        fromUserId: string;
        fromDisplayName: string;
        fromUsername?: string;
        friendCode?: string;
        createdAt: string;
      };
    }
  | {
      type: "FRIEND_REQUEST_ACCEPTED";
      payload: {
        id: string;
        friend: FriendUserInfo;
      };
    }
  | {
      type: "FRIEND_PRESENCE_UPDATE";
      payload: FriendPresence;
    }
  | {
      type: "FRIEND_PRESENCE_SYNC";
      payload: {
        presences: FriendPresence[];
      };
    }
  | {
      type: "ROOM_INVITE_RECEIVED";
      payload: RoomInvite;
    }
  | {
      type: "NOTIFICATION_CREATED";
      payload: NotificationItem;
    }
  | {
      type: "NOTIFICATIONS_COUNT";
      payload: {
        unreadCount: number;
      };
    }
  | {
      type: "NOTIFICATIONS_SNAPSHOT";
      payload: {
        notifications: NotificationItem[];
        unreadCount: number;
      };
    }
  | {
      type: "ROOM_E2EE_KEY_PACKAGE";
      version: number;
      payload: {
        keyVersion: number;
        hostUserId: string;
        hostPublicKey: string;
        wrappedKey: string;
        iv: string;
      };
    }
  | {
      type: "CHAT_BROADCAST_ENCRYPTED";
      version: number;
      payload: {
        id: string;
        userId: string;
        userName: string;
        ciphertext: string;
        iv: string;
        keyVersion: number;
        serverTimestampMs: number;
      };
    }
  | {
      type: "ROOM_E2EE_KEY_ROTATED";
      version: number;
      payload: {
        keyVersion: number;
        reason: "member_left" | "member_kicked" | "host_changed";
      };
    }
  | {
      type: "ROOM_WAITING_LOBBY";
      payload: {
        roomCode: string;
        roomName: string;
        requestId: string;
        message: string;
      };
    }
  | {
      type: "WAITING_ROOM_REQUEST_ADDED";
      version: number;
      payload: {
        request: WaitingJoinRequest;
      };
    }
  | {
      type: "WAITING_ROOM_REQUEST_RESOLVED";
      version: number;
      payload: {
        requestId: string;
        action: "approved" | "denied";
        resolvedBy: string;
      };
    }
  | {
      type: "ROOM_ROLE_ASSIGNED";
      version: number;
      payload: {
        userId: string;
        userName: string;
        role: Role;
        assignedBy: string;
      };
    }
  | {
      type: "ROOM_MEMBER_BANNED";
      version: number;
      payload: {
        userId: string;
        userName: string;
        bannedBy: string;
        reason?: string;
      };
    }
  | {
      type: "ROOM_MEMBER_UNBANNED";
      version: number;
      payload: {
        identifier: string;
        unbannedBy: string;
      };
    }
  | {
      type: "ROOM_MEMBER_MUTED";
      version: number;
      payload: {
        userId: string;
        userName: string;
        mutedBy: string;
        mutedUntil: number | null;
        reason?: string;
      };
    }
  | {
      type: "ROOM_MEMBER_UNMUTED";
      version: number;
      payload: {
        userId: string;
        userName: string;
        unmutedBy: string;
      };
    }
  | {
      type: "CHAT_MESSAGE_DELETED";
      version: number;
      payload: {
        messageId: string;
        deletedBy: string;
      };
    }
  | {
      type: "ROOM_LOCK_UPDATED";
      version: number;
      payload: {
        isLocked: boolean;
        updatedBy: string;
      };
    }
  | {
      type: "INVITE_LINK_CREATED";
      version: number;
      payload: {
        inviteLink: RoomInviteLink;
      };
    }
  | {
      type: "INVITE_LINK_REVOKED";
      version: number;
      payload: {
        inviteId: string;
        revokedBy: string;
      };
    }
  | {
      type: "INVITE_LINKS_SNAPSHOT";
      version: number;
      payload: {
        inviteLinks: RoomInviteLink[];
      };
    }
  | {
      type: "MODERATION_REPORT_CREATED";
      payload: {
        report: ModerationReport;
      };
    }
  | {
      type: "MODERATION_REPORTS_SNAPSHOT";
      payload: {
        reports: ModerationReport[];
      };
    }
  | {
      type: "SCREEN_SHARE_STARTED";
      version: number;
      payload: ScreenShareSessionInfo;
    }
  | {
      type: "SCREEN_SHARE_STOPPED";
      version: number;
      payload: {
        sharerUserId: string;
        reason?: string;
      };
    }
  | {
      type: "SCREEN_SHARE_PERMISSION_GRANTED";
      version: number;
      payload: {
        targetUserId: string;
        grantedBy: string;
      };
    }
  | {
      type: "SCREEN_SHARE_PERMISSION_REVOKED";
      version: number;
      payload: {
        targetUserId: string;
        revokedBy: string;
      };
    }
  | {
      type: "WEBRTC_SIGNAL";
      payload: {
        fromUserId: string;
        signalType: "offer" | "answer" | "ice-candidate";
        signalData: any;
        screenShareSessionId?: string;
      };
    }
  | {
      type: "SCREEN_SHARE_METRICS_BROADCAST";
      payload: {
        viewerUserId: string;
        metrics: ScreenShareMetrics;
      };
    }
  | {
      type: "CO_BROWSE_SCROLL";
      payload: RelativeReadingPosition;
    }
  | {
      type: "CO_BROWSE_PRESENCE";
      payload: MemberReadingPresence;
    }
  | {
      type: "CO_BROWSE_HIGHLIGHT_ADD";
      payload: SharedHighlight;
    }
  | {
      type: "CO_BROWSE_HIGHLIGHT_REMOVE";
      payload: { highlightId: string };
    }
  | {
      type: "CO_BROWSE_COMMENT_ADD";
      payload: StickyComment;
    }
  | {
      type: "CO_BROWSE_COMMENT_DELETE";
      payload: { commentId: string };
    }
  | {
      type: "CO_BROWSE_NOTES_UPDATE";
      payload: { text: string; version: number };
    }
  | {
      type: "CO_BROWSE_SECTION_PING";
      payload: SectionPing;
    }
  | {
      type: "CO_BROWSE_MEDIA_SYNC";
      payload: CoBrowseMediaState;
    }
  | {
      type: "SOURCE_SUBMISSION_QUEUED";
      version: number;
      payload: {
        submission: PendingSourceSubmission;
      };
    }
  | {
      type: "SOURCE_SUBMISSION_APPROVED";
      version: number;
      payload: {
        submissionId: string;
        approvedBy: string;
      };
    }
  | {
      type: "SOURCE_SUBMISSION_REJECTED";
      version: number;
      payload: {
        submissionId: string;
        rejectedBy: string;
        reason?: string;
      };
    }
  | {
      type: "SOURCE_BLOCKLIST_UPDATED";
      version: number;
      payload: {
        blocklist: SourceBlocklistRule[];
      };
    }
  | {
      type: "SOURCE_AUDIT_LOG_ENTRY";
      payload: {
        entry: SourceAuditEntry;
      };
    }
  | {
      type: "SOURCE_REPORT_RECORDED";
      payload: {
        report: SourceReport;
      };
    }
  | {
      type: "SOURCE_SETTINGS_UPDATED";
      version: number;
      payload: {
        requireLinkApproval: boolean;
        approvedSourceAdders: string[];
      };
    }
  | {
      type: "ROOM_VOICE_STATE_UPDATED";
      payload: {
        participants: ParticipantMediaState[];
        videoDisabledForRoom?: boolean;
      };
    }
  | {
      type: "ROOM_RECORDING_REQUESTED";
      payload: {
        requestedBy: string;
        bannerText: string;
      };
    }
  | {
      type: "ROOM_RECORDING_STARTED";
      payload: {
        isRecording: boolean;
        requestedBy?: string;
        bannerText: string;
      };
    }
  | {
      type: "ROOM_RECORDING_ABORTED";
      payload: {
        reason: string;
        deniedByUserId: string;
      };
    }
  | {
      type: "ROOM_RECORDING_STOPPED";
      payload: {
        stoppedBy: string;
        bannerText: string;
      };
    };

// ==========================================
// USER PROFILE, WATCH DATA & SETTINGS SCHEMAS
// ==========================================

export const UserPrivacySettingsSchema = z.object({
  presence: z.enum(["everyone", "friends", "nobody"]).default("friends"),
  whoCanFriendMe: z.enum(["everyone", "friends_of_friends", "nobody"]).default("everyone"),
  whoCanInviteMe: z.enum(["everyone", "friends_only", "nobody"]).default("everyone"),
});

export const InAppNotificationPreferencesSchema = z.object({
  friendRequests: z.boolean().default(true),
  roomInvites: z.boolean().default(true),
  chatMentions: z.boolean().default(true),
  coWatchMilestones: z.boolean().default(true),
});

export const NotificationPreferencesSchema = z.object({
  inApp: InAppNotificationPreferencesSchema,
  emailDigest: z.enum(["daily", "weekly", "none"]).default("weekly"),
});

export const UserProfileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(64).optional(),
  bio: z.string().trim().max(500).optional(),
  avatar: z.string().optional().or(z.null()),
  privacySettings: UserPrivacySettingsSchema.partial().optional(),
  notificationPreferences: z.object({
    inApp: InAppNotificationPreferencesSchema.partial().optional(),
    emailDigest: z.enum(["daily", "weekly", "none"]).optional(),
  }).optional(),
});

export type UserProfileUpdate = z.infer<typeof UserProfileUpdateSchema>;

export const WatchHistoryAddSchema = z.object({
  videoId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  durationMs: z.number().int().min(0).default(0),
  durationWatchedMs: z.number().int().min(0).default(0),
  completed: z.boolean().default(false),
  thumbnailUrl: z.string().url().optional().or(z.literal("")),
  roomId: z.string().optional(),
});

export const FavouriteAddSchema = z.object({
  videoId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  thumbnailUrl: z.string().url().optional().or(z.literal("")),
  durationMs: z.number().int().min(0).optional(),
});

export const CoWatchRecordSchema = z.object({
  friendUserId: z.string().trim().min(1),
  friendDisplayName: z.string().trim().min(1),
  videoId: z.string().trim().min(1),
  videoTitle: z.string().trim().min(1),
  durationWatchedMs: z.number().int().min(1),
  roomId: z.string().optional(),
});

export const PersonalPlaylistItemSchema = z.object({
  id: z.string().optional(),
  videoId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  durationMs: z.number().int().min(0),
  thumbnailUrl: z.string().optional(),
  addedByUserId: z.string().optional(),
  addedByUserName: z.string().optional(),
  order: z.number().optional(),
});

export const PersonalPlaylistCreateSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  isPublic: z.boolean().default(false),
  items: z.array(PersonalPlaylistItemSchema).default([]),
});

export const PersonalPlaylistUpdateSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  isPublic: z.boolean().optional(),
  items: z.array(PersonalPlaylistItemSchema).optional(),
});

export const ChangeEmailRequestSchema = z.object({
  newEmail: z.string().trim().email(),
  password: z.string().min(1),
});

export const ChangeEmailConfirmSchema = z.object({
  token: z.string().trim().min(1),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const DeleteAccountSchema = z.object({
  password: z.string().min(1),
});

// ==========================================
// REAL-TIME VOICE & VIDEO CHAT SCHEMAS
// ==========================================

export const MediaTokenRequestSchema = z.object({
  roomCode: z.string().trim().min(1).max(20),
});
