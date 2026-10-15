export type ControlMode = "host_only" | "public";
export type RoomType = "public" | "friends-only" | "invite-only";
export type PlaybackStatus = "playing" | "paused" | "buffering";
export type Role = "host" | "moderator" | "member" | "guest";

export type RoomPermission =
  | "control_playback"
  | "edit_playlist"
  | "create_polls"
  | "kick"
  | "ban"
  | "mute"
  | "delete_message"
  | "lock_room"
  | "manage_waiting_room"
  | "manage_invites"
  | "manage_roles"
  | "manage_settings"
  | "share_screen"
  | "add_sources"
  | "approve_sources"
  | "manage_source_blocklist";

export type PermissionMatrix = Record<Role, Record<RoomPermission, boolean>>;

export const DEFAULT_PERMISSION_MATRIX: PermissionMatrix = {
  host: {
    control_playback: true,
    edit_playlist: true,
    create_polls: true,
    kick: true,
    ban: true,
    mute: true,
    delete_message: true,
    lock_room: true,
    manage_waiting_room: true,
    manage_invites: true,
    manage_roles: true,
    manage_settings: true,
    share_screen: true,
    add_sources: true,
    approve_sources: true,
    manage_source_blocklist: true,
  },
  moderator: {
    control_playback: true,
    edit_playlist: true,
    create_polls: true,
    kick: true,
    ban: true,
    mute: true,
    delete_message: true,
    lock_room: true,
    manage_waiting_room: true,
    manage_invites: true,
    manage_roles: false,
    manage_settings: true,
    share_screen: true,
    add_sources: true,
    approve_sources: true,
    manage_source_blocklist: true,
  },
  member: {
    control_playback: true,
    edit_playlist: true,
    create_polls: true,
    kick: false,
    ban: false,
    mute: false,
    delete_message: false,
    lock_room: false,
    manage_waiting_room: false,
    manage_invites: false,
    manage_roles: false,
    manage_settings: false,
    share_screen: false,
    add_sources: true,
    approve_sources: false,
    manage_source_blocklist: false,
  },
  guest: {
    control_playback: false,
    edit_playlist: false,
    create_polls: false,
    kick: false,
    ban: false,
    mute: false,
    delete_message: false,
    lock_room: false,
    manage_waiting_room: false,
    manage_invites: false,
    manage_roles: false,
    manage_settings: false,
    share_screen: false,
    add_sources: false,
    approve_sources: false,
    manage_source_blocklist: false,
  },
};

export interface WaitingJoinRequest {
  requestId: string;
  userId: string;
  userName: string;
  accountId?: string;
  requestedAt: number;
}

export interface RoomBan {
  id: string;
  userId: string;
  accountId?: string;
  sessionToken?: string;
  userName: string;
  reason?: string;
  bannedBy: string;
  bannedAt: number;
}

export interface MuteRecord {
  userId: string;
  userName: string;
  mutedBy: string;
  mutedAt: number;
  mutedUntil: number | null;
  reason?: string;
}

export interface RoomInviteLink {
  id: string;
  roomId: string;
  roomCode: string;
  createdByUserId: string;
  createdAt: number;
  expiresAt: number | null;
  maxUses: number | null;
  useCount: number;
  isRevoked: boolean;
  role: Role;
}

export interface ModerationReport {
  id: string;
  roomId: string;
  roomCode: string;
  roomName: string;
  reporterUserId: string;
  reporterUserName: string;
  reporterAccountId?: string;
  targetType: "user" | "message";
  targetUserId: string;
  targetUserName: string;
  targetAccountId?: string;
  targetMessageId?: string;
  reportedMessageText?: string;
  reason: string;
  description?: string;
  chatContext: ChatMessage[];
  createdAt: number;
  status: "pending" | "reviewed" | "dismissed" | "actioned";
  actionTaken?: string;
}

export interface Member {
  userId: string;
  userName: string;
  role: Role;
  isHost: boolean;
  isConnected: boolean;
  isBuffering: boolean;
  isMuted?: boolean;
  joinedAt: number;
  lastSeenAt: number;
  e2eePublicKey?: string;
  inVoice?: boolean;
  isSpeaking?: boolean;
  voiceMuted?: boolean;
  videoEnabled?: boolean;
}

export type MemberPublicInfo = Omit<Member, "lastSeenAt">;

export type VideoProvider =
  | "html5"
  | "youtube"
  | "vimeo"
  | "local"
  | "screenshare"
  | "podcast"
  | "embed"
  | "soundcloud"
  | "spotify"
  | "co-browse";

export interface PlaybackState {
  videoId: string;
  provider?: VideoProvider;
  sourceRef?: string;
  status: PlaybackStatus;
  positionMs: number;
  serverTimeMs: number;
  playbackRate: number;
  title?: string;
  author?: string;
  domain?: string;
  originalUrl?: string;
  license?: string;
}

export interface PlaylistItem {
  id: string;
  videoId: string;
  provider?: VideoProvider;
  sourceRef?: string;
  title: string;
  durationMs: number;
  thumbnailUrl?: string;
  addedByUserId: string;
  addedByUserName: string;
  order?: number; // Fractional index for concurrent reordering
  author?: string;
  domain?: string;
  originalUrl?: string;
  license?: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
  voterUserIds: string[];
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  createdByUserId: string;
  createdAt: number;
  durationMs: number;
  expiresAtServerTimeMs: number;
  isClosed: boolean;
  autoQueueWinner?: boolean;
}

export interface PollSummary {
  id: string;
  question: string;
  options: { id: string; text: string; votes: number }[];
  expiresAtServerTimeMs: number;
  isClosed: boolean;
  autoQueueWinner?: boolean;
  userVotedOptionId?: string;
  winnerOptionText?: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  serverTimestampMs: number;
  isSystem?: boolean;
  isDeleted?: boolean;
  deletedBy?: string;
}

export interface ReactionBurst {
  id: string;
  userId: string;
  userName: string;
  emoji: string;
  videoTimestampMs: number;
  createdAtMs?: number;
}

export interface MomentBookmark {
  id: string;
  userId: string;
  userName: string;
  videoId: string;
  timestampMs: number;
  text: string;
  createdAtMs: number;
  color?: string;
}

export interface ReadyCheck {
  id: string;
  initiatedByUserId: string;
  initiatedByUserName: string;
  countdownMs: number;
  targetServerTimeMs: number;
  startPositionMs: number;
  active: boolean;
}

export interface MemberSyncMetrics {
  userId: string;
  userName: string;
  rttMs: number;
  clockOffsetMs: number;
  driftMs: number;
  playbackRate: number;
  isBuffering: boolean;
  lastReportTimeMs: number;
}

export interface RoomSyncHealthSummary {
  p50DriftMs: number;
  p95DriftMs: number;
  maxDriftMs: number;
  averageRttMs: number;
  bufferingCount: number;
  totalMembers: number;
  syncCoherenceScore: number; // 0 to 100%
  memberMetrics: MemberSyncMetrics[];
}

export interface CouchSeat {
  seatIndex: number;
  userId: string;
  userName: string;
  isHost: boolean;
  avatarSeed: string;
  avatarColor: string;
  status: "watching" | "buffering" | "reacting";
  lastReactionEmoji?: string;
  reactionExpiryMs?: number;
}

export interface ChaosConfig {
  enabled: boolean;
  latencyMs: number;
  jitterMs: number;
  packetLossRate: number;
  disconnectIntervalMs?: number;
}

export type ScreenShareTransportMode = "mesh" | "sfu";

export interface ScreenShareSessionInfo {
  sharerUserId: string;
  sharerUserName: string;
  title: string;
  hasAudio: boolean;
  transportMode: ScreenShareTransportMode;
  startedAtMs: number;
}

export interface WebRtcSignalPayload {
  targetUserId: string;
  signalType: "offer" | "answer" | "ice-candidate";
  signalData: any;
  screenShareSessionId?: string;
}

export interface ScreenShareMetrics {
  rttMs: number;
  jitterMs: number;
  packetLossPercent: number;
  liveDelayMs: number;
  bitrateBps?: number;
  fps?: number;
  resolution?: string;
}

export interface RoomSnapshot {
  roomId: string;
  roomCode: string;
  roomName: string;
  inviteUrl: string;
  hostId: string;
  version: number;
  controlMode: ControlMode;
  roomType: RoomType;
  hasPassword: boolean;
  maxMembers?: number;
  waitingRoomEnabled: boolean;
  autoApproveFriends: boolean;
  isLocked: boolean;
  slowModeSeconds: number;
  profanityFilterEnabled: boolean;
  members: MemberPublicInfo[];
  waitingRequests?: WaitingJoinRequest[];
  playback: PlaybackState;
  playlist: PlaylistItem[];
  activePoll: PollSummary | null;
  chatHistory: ChatMessage[];
  storedReactions: ReactionBurst[];
  bookmarks: MomentBookmark[];
  readyCheck: ReadyCheck | null;
  syncHealth?: RoomSyncHealthSummary;
  selfUserId: string;
  selfRole: Role;
  reconnectToken: string;
  serverTimeMs: number;
  e2eeEnabled?: boolean;
  e2eeKeyVersion?: number;
  e2eeSafetyFingerprint?: string;
  screenShare?: ScreenShareSessionInfo | null;
  approvedScreenSharers?: string[];
  requireLinkApproval: boolean;
  approvedSourceAdders?: string[];
  sourceApprovalQueue?: PendingSourceSubmission[];
  sourceAuditLog?: SourceAuditEntry[];
  sourceBlocklist?: SourceBlocklistRule[];
  isHomeRoom?: boolean;
  homeGroupName?: string;
  sourcePlaybackMemory?: Record<string, SourcePlaybackMemoryItem>;
  chatRetentionDays?: number;
  roomRules?: string;
  videoDisabledForRoom?: boolean;
  voiceParticipants?: ParticipantMediaState[];
  recordingState?: RoomRecordingState;
}

export interface RoomEvent {
  version: number;
  type: string;
  payload: unknown;
  serverTimeMs: number;
  causedBy?: {
    userId: string;
    clientSeq?: number;
  };
}

// ==========================================
// FRIENDS & PRESENCE SOCIAL MODELS
// ==========================================

export type FriendshipStatus = "pending" | "accepted" | "blocked";
export type PresencePrivacy = "everyone" | "friends" | "nobody";
export type FriendPresenceStatus = "online" | "offline" | "watching";

export interface FriendActivity {
  roomCode: string;
  roomName: string;
  videoTitle?: string;
  isPublic?: boolean;
}

export interface FriendPresence {
  userId: string;
  displayName: string;
  username?: string;
  friendCode?: string;
  avatar?: string | null;
  status: FriendPresenceStatus;
  activity?: FriendActivity;
  lastSeenAt: number;
}

export interface FriendUserInfo {
  id: string;
  displayName: string;
  username?: string;
  friendCode: string;
  avatar?: string | null;
  presencePrivacy?: PresencePrivacy;
}

export interface Friendship {
  id: string;
  user1Id: string;
  user2Id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  blockedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  friend?: FriendUserInfo;
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: "friend_request_received" | "friend_request_accepted" | "room_invite" | "system";
  actorId?: string | null;
  actorName?: string | null;
  payload: Record<string, any>;
  read: boolean;
  createdAt: string;
}

export interface RoomInvite {
  inviteId: string;
  fromUserId: string;
  fromDisplayName: string;
  roomCode: string;
  roomName: string;
  videoTitle?: string;
  createdAt: number;
}

// ==========================================
// USER PROFILE, PREFERENCES & ACCOUNT MODELS
// ==========================================

export type WhoCanFriendMe = "everyone" | "friends_of_friends" | "nobody";
export type WhoCanInviteMe = "everyone" | "friends_only" | "nobody";

export interface UserPrivacySettings {
  presence: PresencePrivacy; // 'everyone' | 'friends' | 'nobody'
  whoCanFriendMe: WhoCanFriendMe;
  whoCanInviteMe: WhoCanInviteMe;
}

export interface InAppNotificationPreferences {
  friendRequests: boolean;
  roomInvites: boolean;
  chatMentions: boolean;
  coWatchMilestones: boolean;
}

export type EmailDigestFrequency = "daily" | "weekly" | "none";

export interface NotificationPreferences {
  inApp: InAppNotificationPreferences;
  emailDigest: EmailDigestFrequency;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  username?: string;
  friendCode: string;
  avatar?: string | null;
  bio?: string;
  privacySettings: UserPrivacySettings;
  notificationPreferences: NotificationPreferences;
  createdAt: string;
  isEmailVerified: boolean;
}

// ==========================================
// WATCH HISTORY & FAVOURITES MODELS
// ==========================================

export interface WatchHistoryItem {
  id: string;
  userId: string;
  videoId: string;
  title: string;
  durationMs: number;
  durationWatchedMs: number;
  completed: boolean;
  watchedAt: string;
  thumbnailUrl?: string;
  roomId?: string;
}

export interface FavouriteItem {
  id: string;
  userId: string;
  videoId: string;
  title: string;
  thumbnailUrl?: string;
  durationMs?: number;
  addedAt: string;
}

// ==========================================
// CO-WATCHING & SOCIAL WATCH STATS MODELS
// ==========================================

export interface CoWatchRecord {
  id: string;
  userId: string;
  friendUserId: string;
  friendDisplayName: string;
  videoId: string;
  videoTitle: string;
  durationWatchedMs: number;
  watchedAt: string;
  roomId?: string;
}

export interface CoWatchedVideoSummary {
  videoId: string;
  title: string;
  totalDurationWatchedMs: number;
  sessionsCount: number;
  lastWatchedAt: string;
}

export interface FriendCoWatchStats {
  friendUserId: string;
  friendDisplayName: string;
  friendAvatar?: string | null;
  totalCoWatchDurationMs: number;
  totalSessionsCount: number;
  videosWatchedTogether: CoWatchedVideoSummary[];
  firstWatchedAt: string;
  lastWatchedAt: string;
}

// ==========================================
// PERSONAL PLAYLISTS MODELS
// ==========================================

export interface PersonalPlaylist {
  id: string;
  userId: string;
  title: string;
  description?: string;
  isPublic: boolean;
  items: PlaylistItem[];
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// SESSIONS & USER DATA EXPORT MODELS
// ==========================================

export interface ActiveSession {
  id: string;
  familyId: string;
  deviceInfo?: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export interface UserDataExport {
  exportedAt: string;
  profile: UserProfile;
  privacySettings: UserPrivacySettings;
  notificationPreferences: NotificationPreferences;
  watchHistory: WatchHistoryItem[];
  favourites: FavouriteItem[];
  personalPlaylists: PersonalPlaylist[];
  friends: Friendship[];
  coWatchStats: FriendCoWatchStats[];
  activeSessions: Array<Omit<ActiveSession, "isCurrent">>;
}

// ==========================================
// CO-BROWSE MODELS
// ==========================================

export interface RelativeReadingPosition {
  /** Nearest heading or paragraph anchor selector, e.g. "h2#heading-id" or "p:nth-of-type(3)" */
  anchorSelector: string;
  /** Short text snippet (<= 60 chars) to re-identify element if DOM layout shifts */
  anchorTextSnippet?: string;
  /** Vertical offset in pixels relative to the top of the anchor element */
  offsetPx: number;
  /** Normalized progression percentage within the anchor element (0.0 to 1.0) */
  percentageWithinAnchor: number;
}

/**
 * W3C Web Annotation TextQuoteSelector
 * https://www.w3.org/TR/annotation-model/#text-quote-selector
 */
export interface W3CTextQuoteSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface SharedHighlight {
  id: string;
  userId: string;
  userName: string;
  color: string; // e.g. "yellow", "cyan", "pink", "green", "purple"
  target: W3CTextQuoteSelector;
  createdAt: number;
}

export interface StickyComment {
  id: string;
  highlightId?: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  target: W3CTextQuoteSelector;
  commentText: string;
  createdAt: number;
}

export interface MemberReadingPresence {
  userId: string;
  userName: string;
  userColor: string;
  anchorSelector: string;
  anchorTextSnippet?: string;
  lastUpdated: number;
}

export interface SectionPing {
  id: string;
  userId: string;
  userName: string;
  sectionTitle: string;
  anchorSelector: string;
  timestamp: number;
}

export interface CoBrowseMediaState {
  mediaId: string;
  tagName: "video" | "audio";
  status: "playing" | "paused";
  positionMs: number;
  serverTimeMs: number;
  playbackRate: number;
  durationMs?: number;
}

export interface CoBrowseSession {
  url: string;
  title: string;
  frameAllowed: boolean;
  hostReadingPosition?: RelativeReadingPosition;
  activeMedia?: CoBrowseMediaState;
  highlights: SharedHighlight[];
  stickyComments: StickyComment[];
  presence: Record<string, MemberReadingPresence>;
  sharedNotes: string;
  notesVersion: number;
  sectionPings: SectionPing[];
}

// ==========================================
// SOURCE GUARDRAILS & SAFE-LINK MODELS
// ==========================================

export type UrlSafetyLevel = "safe" | "suspicious" | "malicious" | "blocked";

export interface UrlSafetyReport {
  url: string;
  domain: string;
  safetyLevel: UrlSafetyLevel;
  threatTypes: string[];
  isSafe: boolean;
  warning?: string;
  sourceCheck: "google_safe_browsing" | "local_blocklist" | "room_blocklist" | "verified_origin" | "heuristics";
  scannedAt: number;
}

export interface PendingSourceSubmission {
  id: string;
  userId: string;
  userName: string;
  sourceUrl: string;
  domain: string;
  title: string;
  author?: string;
  provider: VideoProvider;
  sourceRef?: string;
  durationMs?: number;
  thumbnailUrl?: string;
  submittedAt: number;
  actionType: "change_video" | "add_playlist";
  autoPlay?: boolean;
  startPositionMs?: number;
  safety: UrlSafetyReport;
}

export type SourceAuditAction =
  | "added"
  | "submitted"
  | "approved"
  | "rejected"
  | "reported"
  | "blocked";

export interface SourceAuditEntry {
  id: string;
  timestamp: number;
  userId: string;
  userName: string;
  action: SourceAuditAction;
  sourceUrl: string;
  domain: string;
  title?: string;
  provider?: VideoProvider;
  performedByUserId: string;
  performedByUserName: string;
  notes?: string;
}

export interface SourceReport {
  id: string;
  roomId: string;
  roomCode: string;
  reporterUserId: string;
  reporterUserName: string;
  sourceUrl: string;
  domain: string;
  reason: string;
  description?: string;
  reportedAt: number;
  status: "pending" | "reviewed" | "actioned" | "dismissed";
}

export interface SourceBlocklistRule {
  id: string;
  pattern: string;
  reason?: string;
  addedByUserId: string;
  addedByUserName: string;
  addedAt: number;
}

// ==========================================
// DAILY DELIGHT & GROUP LIFE SOCIAL MODELS
// ==========================================

export interface SourcePlaybackMemoryItem {
  positionMs: number;
  updatedAt: number;
  updatedBy?: string;
}

export interface PushPreferences {
  enabled: boolean;
  partyStarted: boolean;
  partyInvite: boolean;
  friendRequest: boolean;
  party10mReminder: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // e.g. "22:00"
  quietHoursEnd: string; // e.g. "08:00"
  timezoneOffsetMinutes?: number; // client minutes, e.g. -330
}

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  expirationTime?: number | null;
}

export type PartyRsvpStatus = "attending" | "maybe" | "declined";

export interface ScheduledParty {
  id: string;
  title: string;
  description?: string;
  creatorUserId: string;
  creatorDisplayName: string;
  scheduledStartTimeMs: number;
  scheduledEndTimeMs?: number;
  sourceUrl?: string;
  sourceTitle?: string;
  roomId?: string;
  roomCode?: string;
  isHomeRoom?: boolean;
  invitedUserIds: string[];
  rsvps: Record<string, PartyRsvpStatus>;
  reminded10m?: boolean;
  roomOpened?: boolean;
  createdAt: number;
}

export interface FriendActivityItem {
  roomId: string;
  roomCode: string;
  roomName: string;
  isHomeRoom?: boolean;
  sourceTitle?: string;
  videoId?: string;
  memberCount: number;
  friendParticipants: Array<{
    userId: string;
    displayName: string;
    avatarUrl?: string;
  }>;
}

// ==========================================
// REAL-TIME VOICE & VIDEO CHAT MODELS
// ==========================================

export interface ParticipantMediaState {
  userId: string;
  userName: string;
  role: Role;
  inVoice: boolean;
  audioMuted: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  isSpeaking: boolean;
  audioLevel?: number; // 0.0 - 1.0
  joinedVoiceAt?: number;
}

export interface MediaTokenRequest {
  roomCode: string;
}

export interface MediaTokenResponse {
  success: boolean;
  provider: "livekit" | "mock";
  serverUrl: string;
  token: string;
  identity: string;
  roomName: string;
  iceServers: RTCIceServer[];
  expiresAt: number;
  permissions: {
    canPublishAudio: boolean;
    canPublishVideo: boolean;
    canPublishScreen: boolean;
    canSubscribe: boolean;
  };
  videoDisabledForRoom?: boolean;
}

export interface VoiceStateUpdatePayload {
  inVoice: boolean;
  audioMuted: boolean;
  videoEnabled: boolean;
  screenSharing?: boolean;
}

export interface ModMuteVoicePayload {
  targetUserId: string;
  muteAudio?: boolean;
  muteVideo?: boolean;
}

export interface ModRemoveVoicePayload {
  targetUserId: string;
}

export interface ModDisableRoomVideoPayload {
  disabled: boolean;
}

// ==========================================
// ROOM RECORDING & EXPLICIT CONSENT MODELS
// ==========================================

export interface RoomRecordingState {
  isRecording: boolean;
  consentRequired: boolean;
  requestedBy?: string;
  requestedAt?: number;
  consentedUserIds: string[];
  deniedUserIds: string[];
}

export interface RoomRecordingRequestPayload {
  requestedBy: string;
}

export interface RoomRecordingConsentPayload {
  consentGranted: boolean;
}
