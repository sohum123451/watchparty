import {
  RoomSnapshot,
  ClientMessage,
  ServerMessage,
  MemberPublicInfo,
  PlaylistItem,
  PollSummary,
  ChatMessage,
  ReactionBurst,
  MomentBookmark,
  ReadyCheck,
  RoomSyncHealthSummary,
} from "@watchparty/shared";
import { ChatManager } from "./ChatManager.js";
import { ReactionManager } from "./ReactionManager.js";
import { PlaylistManager } from "./PlaylistManager.js";
import { PollManager } from "./PollManager.js";
import { MemberManager } from "./MemberManager.js";
import { ClockSync } from "../sync/ClockSync.js";
import { PlaybackSyncEngine } from "../sync/PlaybackSyncEngine.js";
import { ReactionHeatmapTimeline } from "../features/ReactionHeatmapTimeline.js";
import { ReadyCheckManager } from "../features/ReadyCheckManager.js";
import { BookmarkManager } from "../features/BookmarkManager.js";
import { VirtualCouchManager } from "../features/VirtualCouchManager.js";
import { SyncHealthMonitor } from "../features/SyncHealthMonitor.js";
import { ChaosSimulator } from "../features/ChaosSimulator.js";
import { FriendsManager } from "./FriendsManager.js";
import { UserManager } from "./UserManager.js";
import { E2eeManager } from "../features/E2eeManager.js";

export interface SocialClientOptions {
  wsSender?: (message: ClientMessage) => void;
  onSnapshot?: (snapshot: RoomSnapshot) => void;
  clockSync?: ClockSync;
  syncEngine?: PlaybackSyncEngine;
  onReadyCheckComplete?: (startPositionMs: number) => void;
  onSeekRequested?: (timestampMs: number) => void;
  onTriggerDisconnect?: () => void;
  friends?: FriendsManager;
  user?: UserManager;
}

export class SocialClient {
  public readonly chat: ChatManager;
  public readonly reactions: ReactionManager;
  public readonly playlist: PlaylistManager;
  public readonly polls: PollManager;
  public readonly members: MemberManager;
  public readonly friends: FriendsManager;
  public readonly user: UserManager;

  // Differentiating feature managers
  public readonly heatmap: ReactionHeatmapTimeline;
  public readonly readyCheck: ReadyCheckManager;
  public readonly bookmarks: BookmarkManager;
  public readonly couch: VirtualCouchManager;
  public readonly syncHealth: SyncHealthMonitor;
  public readonly chaos: ChaosSimulator;
  public readonly e2ee: E2eeManager;

  private clientSeq = 0;
  private wsSender?: (message: ClientMessage) => void;
  private onSnapshotCallback?: (snapshot: RoomSnapshot) => void;
  private onSeekRequested?: (timestampMs: number) => void;

  public roomId = "";
  public roomCode = "";
  public roomName = "";
  public inviteUrl = "";
  public selfUserId = "";
  public sessionToken = "";
  public version = 1;

  constructor(options?: SocialClientOptions) {
    this.wsSender = options?.wsSender;
    this.onSnapshotCallback = options?.onSnapshot;
    this.onSeekRequested = options?.onSeekRequested;

    const clock = options?.clockSync || new ClockSync();
    const fakeSyncEngine = options?.syncEngine || ({} as any);

    this.chat = new ChatManager({
      sendChatHandler: (text) => this.sendChatCommand(text),
      sendTypingHandler: (isTyping) => this.sendTypingCommand(isTyping),
    });

    this.reactions = new ReactionManager({
      sendHandler: (emoji, timestampMs) => this.sendReactionCommand(emoji, timestampMs),
    });

    this.playlist = new PlaylistManager({
      handlers: {
        onAdd: (videoId, title, durationMs, thumbnailUrl) =>
          this.sendPlaylistAddCommand(videoId, title, durationMs, thumbnailUrl),
        onRemove: (itemId) => this.sendPlaylistRemoveCommand(itemId),
        onReorder: (itemId, newIndex, order, expectedVersion) =>
          this.sendPlaylistReorderCommand(itemId, newIndex, order, expectedVersion),
        onPlaybackEnded: (videoId) => this.sendPlaybackEndedCommand(videoId),
      },
    });

    this.polls = new PollManager({
      handlers: {
        onCreatePoll: (q, opts, dur, autoQueue) =>
          this.sendCreatePollCommand(q, opts, dur, autoQueue),
        onVote: (pollId, optIdx) => this.sendVoteCommand(pollId, optIdx),
      },
    });

    this.members = new MemberManager();

    // Differentiating features
    this.heatmap = new ReactionHeatmapTimeline({
      reactionManager: this.reactions,
      onJump: (timeMs) => this.onSeekRequested?.(timeMs),
    });

    this.readyCheck = new ReadyCheckManager({
      clockSync: clock,
      onComplete: (startPos) => options?.onReadyCheckComplete?.(startPos),
    });

    this.bookmarks = new BookmarkManager({
      handlers: {
        onAdd: (videoId, timestampMs, text, color) =>
          this.sendBookmarkCreateCommand(videoId, timestampMs, text, color),
        onRemove: (bookmarkId) => this.sendBookmarkRemoveCommand(bookmarkId),
        onSeek: (timeMs) => this.onSeekRequested?.(timeMs),
      },
    });

    this.couch = new VirtualCouchManager();

    this.syncHealth = new SyncHealthMonitor({
      clockSync: clock,
      syncEngine: fakeSyncEngine,
      reporter: (metrics) => this.sendSyncMetricsReport(metrics),
    });

    this.chaos = new ChaosSimulator({
      onTriggerDisconnect: options?.onTriggerDisconnect,
    });

    this.friends = options?.friends || new FriendsManager({ wsSender: (msg) => this.send(msg) });
    this.user = options?.user || new UserManager();

    this.e2ee = new E2eeManager({
      wsSender: (msg) => this.send(msg),
    });
    this.e2ee.setMembersProvider(() => this.members.getMembers());
  }

  public setSender(sender: (message: ClientMessage) => void): void {
    this.wsSender = sender;
    this.friends.setWsSender((msg) => this.send(msg));
    this.e2ee.setSender((msg) => this.send(msg));
  }

  private nextSeq(): number {
    return ++this.clientSeq;
  }

  private send(message: ClientMessage): boolean {
    if (!this.wsSender) return false;

    // Route through chaos simulator for dev network simulation
    this.chaos.interceptOutgoing(message, (msg) => {
      this.wsSender!(msg);
    });
    return true;
  }

  /**
   * Applies a complete room snapshot from server (initial join or reconnect).
   * Hydrates all social and differentiating state managers.
   */
  public applySnapshot(snapshot: RoomSnapshot): void {
    this.roomId = snapshot.roomId;
    this.roomCode = snapshot.roomCode;
    this.roomName = snapshot.roomName;
    this.inviteUrl = snapshot.inviteUrl;
    this.selfUserId = snapshot.selfUserId;
    this.sessionToken = snapshot.reconnectToken;
    this.version = snapshot.version;

    // Hydrate all state managers
    this.members.initMembers(snapshot.members, snapshot.hostId, snapshot.selfUserId);
    this.chat.initHistory(snapshot.chatHistory);
    this.reactions.initStoredReactions(snapshot.storedReactions);
    this.playlist.initPlaylist(snapshot.playlist, snapshot.version);
    this.polls.initPoll(snapshot.activePoll);

    // Hydrate differentiating features
    this.bookmarks.initBookmarks(snapshot.bookmarks || []);
    if (snapshot.readyCheck && snapshot.readyCheck.active) {
      this.readyCheck.handleCountdownStart(snapshot.readyCheck);
    }
    this.couch.syncMembers(this.members.getMembers());
    if (snapshot.syncHealth) {
      this.syncHealth.handleServerBroadcast(snapshot.syncHealth);
    }

    this.friends.setCurrentRoom(snapshot.roomCode);
    this.e2ee.handleRoomInit({
      enabled: Boolean(snapshot.e2eeEnabled),
      keyVersion: snapshot.e2eeKeyVersion,
      isHost: snapshot.hostId === snapshot.selfUserId,
      selfUserId: snapshot.selfUserId,
      safetyFingerprint: snapshot.e2eeSafetyFingerprint,
    });
    this.onSnapshotCallback?.(snapshot);
  }

  /**
   * Dispatches incoming typed messages from WebSocket server.
   */
  public handleServerMessage(message: ServerMessage): void {
    // Intercept with chaos simulator if active
    this.chaos.interceptIncoming(message, (msg) => {
      this.processServerMessage(msg);
    });
  }

  private processServerMessage(message: ServerMessage): void {
    if ("version" in message && typeof message.version === "number") {
      this.version = message.version;
    }

    this.friends.handleServerMessage(message);

    switch (message.type) {
      case "ROOM_SNAPSHOT": {
        this.applySnapshot(message.payload);
        break;
      }

      case "CHAT_BROADCAST": {
        this.chat.handleIncomingMessage(message.payload.message);
        break;
      }

      case "CHAT_BROADCAST_ENCRYPTED": {
        this.e2ee
          .decryptChat(
            message.payload.ciphertext,
            message.payload.iv,
            message.payload.keyVersion
          )
          .then((decryptedText) => {
            this.chat.handleIncomingMessage({
              id: message.payload.id,
              userId: message.payload.userId,
              userName: message.payload.userName,
              text: decryptedText,
              serverTimestampMs: message.payload.serverTimestampMs,
              isSystem: false,
            });
          });
        break;
      }

      case "ROOM_E2EE_KEY_PACKAGE": {
        this.e2ee.handleIncomingKeyPackage(message.payload);
        break;
      }

      case "ROOM_E2EE_KEY_ROTATED": {
        this.e2ee.handleKeyRotated(message.payload);
        break;
      }

      case "CHAT_TYPING_BROADCAST": {
        this.chat.handleIncomingTyping(
          message.payload.userId,
          message.payload.userName,
          message.payload.isTyping
        );
        break;
      }

      case "REACTION_BROADCAST": {
        this.reactions.handleIncomingReaction(message.payload.reaction);
        this.couch.triggerMemberReaction(
          message.payload.reaction.userId,
          message.payload.reaction.emoji
        );
        break;
      }

      case "PLAYLIST_UPDATED": {
        this.playlist.initPlaylist(message.payload.playlist, message.version);
        break;
      }

      case "POLL_UPDATED": {
        this.polls.handlePollUpdate(message.payload.poll);
        break;
      }

      case "BOOKMARKS_UPDATED": {
        this.bookmarks.initBookmarks(message.payload.bookmarks);
        break;
      }

      case "READY_CHECK_COUNTDOWN": {
        this.readyCheck.handleCountdownStart(message.payload);
        break;
      }

      case "READY_CHECK_CANCEL": {
        this.readyCheck.handleCountdownCancel();
        break;
      }

      case "SYNC_METRICS_BROADCAST": {
        this.syncHealth.handleServerBroadcast(message.payload);
        break;
      }

      case "ROOM_MEMBER_JOINED": {
        this.members.handleMemberJoined(message.payload.member);
        this.couch.syncMembers(this.members.getMembers());
        this.e2ee.handlePeerJoined(message.payload.member);
        break;
      }

      case "ROOM_MEMBER_LEFT": {
        this.members.handleMemberLeft(message.payload.userId, message.payload.newHostId);
        this.couch.syncMembers(this.members.getMembers());
        break;
      }

      case "ROOM_MEMBER_STATUS": {
        this.members.handleMemberStatus(message.payload.userId, message.payload.isConnected);
        this.couch.syncMembers(this.members.getMembers());
        break;
      }

      case "ROOM_HOST_CHANGED": {
        this.members.handleHostChanged(message.payload.newHostId);
        this.couch.syncMembers(this.members.getMembers());
        break;
      }

      case "PLAYBACK_UPDATE": {
        if (message.payload.reason === "buffer_stall" && message.payload.causedBy?.userId) {
          this.members.handleBufferReport(message.payload.causedBy.userId, true);
          this.couch.updateMemberBuffering(message.payload.causedBy.userId, true);
        } else if (message.payload.reason === "buffer_resumed" && message.payload.causedBy?.userId) {
          this.members.handleBufferReport(message.payload.causedBy.userId, false);
          this.couch.updateMemberBuffering(message.payload.causedBy.userId, false);
        }
        break;
      }
    }
  }

  // ==========================================
  // COMMAND SENDER METHODS
  // ==========================================

  private sendChatCommand(text: string): boolean {
    if (this.e2ee.enabled && this.e2ee.hasRoomKey()) {
      this.e2ee.encryptChat(text).then((enc) => {
        if (enc) {
          this.send({
            type: "CHAT_SEND_ENCRYPTED",
            clientSeq: this.nextSeq(),
            payload: {
              ciphertext: enc.ciphertext,
              iv: enc.iv,
              keyVersion: enc.keyVersion,
            },
          });
        }
      });
      return true;
    }

    return this.send({
      type: "CHAT_SEND",
      clientSeq: this.nextSeq(),
      payload: { text },
    });
  }

  private sendTypingCommand(isTyping: boolean): void {
    this.send({
      type: "CHAT_TYPING",
      payload: { isTyping },
    });
  }

  private sendReactionCommand(emoji: string, videoTimestampMs: number): void {
    this.send({
      type: "REACTION_EMIT",
      payload: { emoji, videoTimestampMs },
    });
  }

  private sendPlaylistAddCommand(
    videoId: string,
    title: string,
    durationMs: number,
    thumbnailUrl?: string
  ): boolean {
    return this.send({
      type: "PLAYLIST_ADD",
      clientSeq: this.nextSeq(),
      payload: { videoId, title, durationMs, thumbnailUrl },
    });
  }

  private sendPlaylistRemoveCommand(playlistItemId: string): boolean {
    return this.send({
      type: "PLAYLIST_REMOVE",
      clientSeq: this.nextSeq(),
      payload: { playlistItemId },
    });
  }

  private sendPlaylistReorderCommand(
    playlistItemId: string,
    newIndex: number,
    order?: number,
    expectedVersion?: number
  ): boolean {
    return this.send({
      type: "PLAYLIST_REORDER",
      clientSeq: this.nextSeq(),
      payload: { playlistItemId, newIndex, order, expectedVersion },
    });
  }

  private sendPlaybackEndedCommand(videoId: string): boolean {
    return this.send({
      type: "PLAYBACK_ENDED",
      clientSeq: this.nextSeq(),
      payload: { videoId },
    });
  }

  private sendCreatePollCommand(
    question: string,
    options: string[],
    durationSeconds = 30,
    autoQueueWinner = false
  ): boolean {
    return this.send({
      type: "POLL_CREATE",
      clientSeq: this.nextSeq(),
      payload: { question, options, durationSeconds, autoQueueWinner },
    });
  }

  private sendVoteCommand(pollId: string, optionIndex: number): boolean {
    return this.send({
      type: "POLL_VOTE",
      clientSeq: this.nextSeq(),
      payload: { pollId, optionIndex },
    });
  }

  private sendBookmarkCreateCommand(
    videoId: string,
    timestampMs: number,
    text: string,
    color?: string
  ): boolean {
    return this.send({
      type: "BOOKMARK_CREATE",
      clientSeq: this.nextSeq(),
      payload: { videoId, timestampMs, text, color },
    });
  }

  private sendBookmarkRemoveCommand(bookmarkId: string): boolean {
    return this.send({
      type: "BOOKMARK_REMOVE",
      clientSeq: this.nextSeq(),
      payload: { bookmarkId },
    });
  }

  public startReadyCheck(countdownMs = 3000, startPositionMs?: number): boolean {
    return this.send({
      type: "READY_CHECK_START",
      clientSeq: this.nextSeq(),
      payload: { countdownMs, startPositionMs },
    });
  }

  public sendSyncMetricsReport(metrics: {
    rttMs: number;
    clockOffsetMs: number;
    driftMs: number;
    playbackRate: number;
    isBuffering: boolean;
  }): boolean {
    return this.send({
      type: "SYNC_METRICS_REPORT",
      payload: metrics,
    });
  }

  public transferHost(targetUserId: string): boolean {
    return this.send({
      type: "ROOM_TRANSFER_HOST",
      clientSeq: this.nextSeq(),
      payload: { targetUserId },
    });
  }

  public kickMember(targetUserId: string, reason?: string): boolean {
    return this.send({
      type: "ROOM_KICK_MEMBER",
      clientSeq: this.nextSeq(),
      payload: { targetUserId, reason },
    });
  }

  public banMember(targetUserId: string, banType: "account" | "session" | "both" = "both", reason?: string): boolean {
    return this.send({
      type: "ROOM_BAN_MEMBER",
      clientSeq: this.nextSeq(),
      payload: { targetUserId, banType, reason },
    });
  }

  public unbanMember(targetIdentifier: string): boolean {
    return this.send({
      type: "ROOM_UNBAN",
      clientSeq: this.nextSeq(),
      payload: { targetIdentifier },
    });
  }

  public muteMember(targetUserId: string, durationSeconds?: number, reason?: string): boolean {
    return this.send({
      type: "ROOM_MUTE_MEMBER",
      clientSeq: this.nextSeq(),
      payload: { targetUserId, durationSeconds, reason },
    });
  }

  public unmuteMember(targetUserId: string): boolean {
    return this.send({
      type: "ROOM_UNMUTE_MEMBER",
      clientSeq: this.nextSeq(),
      payload: { targetUserId },
    });
  }

  public assignRole(targetUserId: string, role: "moderator" | "member" | "guest"): boolean {
    return this.send({
      type: "ROOM_ASSIGN_ROLE",
      clientSeq: this.nextSeq(),
      payload: { targetUserId, role },
    });
  }

  public deleteChatMessage(messageId: string): boolean {
    return this.send({
      type: "CHAT_MESSAGE_DELETE",
      clientSeq: this.nextSeq(),
      payload: { messageId },
    });
  }

  public toggleRoomLock(isLocked: boolean): boolean {
    return this.send({
      type: "ROOM_LOCK_TOGGLE",
      clientSeq: this.nextSeq(),
      payload: { isLocked },
    });
  }

  public approveWaitingRequest(requestId: string): boolean {
    return this.send({
      type: "WAITING_ROOM_APPROVE",
      clientSeq: this.nextSeq(),
      payload: { requestId },
    });
  }

  public denyWaitingRequest(requestId: string, reason?: string): boolean {
    return this.send({
      type: "WAITING_ROOM_DENY",
      clientSeq: this.nextSeq(),
      payload: { requestId, reason },
    });
  }

  public createReport(
    targetType: "user" | "message",
    targetUserId: string,
    reason: string,
    description?: string,
    targetMessageId?: string
  ): boolean {
    return this.send({
      type: "MODERATION_REPORT_CREATE",
      clientSeq: this.nextSeq(),
      payload: { targetType, targetUserId, targetMessageId, reason, description },
    });
  }

  public createInviteLink(options?: { expiresInSeconds?: number; maxUses?: number; role?: "member" | "guest" }): boolean {
    return this.send({
      type: "INVITE_LINK_CREATE",
      clientSeq: this.nextSeq(),
      payload: {
        expiresInSeconds: options?.expiresInSeconds,
        maxUses: options?.maxUses,
        role: options?.role || "member",
      },
    });
  }

  public revokeInviteLink(inviteId: string): boolean {
    return this.send({
      type: "INVITE_LINK_REVOKE",
      clientSeq: this.nextSeq(),
      payload: { inviteId },
    });
  }

  public regenerateInviteLink(inviteId: string, options?: { expiresInSeconds?: number; maxUses?: number }): boolean {
    return this.send({
      type: "INVITE_LINK_REGENERATE",
      clientSeq: this.nextSeq(),
      payload: {
        inviteId,
        expiresInSeconds: options?.expiresInSeconds,
        maxUses: options?.maxUses,
      },
    });
  }

  public updateRoomSettings(settings: {
    controlMode?: "host_only" | "public";
    roomType?: "public" | "friends-only" | "invite-only";
    roomPassword?: string | null;
    maxMembers?: number;
    waitingRoomEnabled?: boolean;
    autoApproveFriends?: boolean;
    profanityFilterEnabled?: boolean;
    slowModeSeconds?: number;
    isLocked?: boolean;
  }): boolean {
    return this.send({
      type: "ROOM_UPDATE_SETTINGS",
      clientSeq: this.nextSeq(),
      payload: settings,
    });
  }

  public reportBufferStatus(isBuffering: boolean): boolean {
    return this.send({
      type: "PLAYBACK_BUFFER_REPORT",
      clientSeq: this.nextSeq(),
      payload: { isBuffering },
    });
  }

  public destroy(): void {
    this.chat.destroy();
    this.reactions.destroy();
    this.playlist.destroy();
    this.polls.destroy();
    this.members.destroy();
    this.readyCheck.destroy();
    this.bookmarks.destroy();
    this.couch.destroy();
    this.syncHealth.destroy();
    this.chaos.destroy();
  }
}
