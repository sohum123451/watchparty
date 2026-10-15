import crypto from "node:crypto";
import { Room } from "../rooms/Room.js";
import { RoomManager } from "../rooms/RoomManager.js";
import { IRedisService } from "./RedisService.js";
import {
  PlaybackState,
  PlaylistItem,
  ChatMessage,
  ControlMode,
  RoomType,
  Role,
  ServerMessage,
  ClientMessage,
} from "@watchparty/shared";

export interface SerializedRoomMember {
  userId: string;
  userName: string;
  role: Role;
  isHost: boolean;
  accountId?: string;
  sessionToken: string;
  joinedAt: number;
}

export interface RoomSnapshotData {
  roomId: string;
  roomCode: string;
  roomName: string;
  baseUrl: string;
  hostId: string;
  version: number;
  controlMode: ControlMode;
  roomType: RoomType;
  passwordHash?: string;
  passwordSalt?: string;
  maxMembers: number;
  waitingRoomEnabled: boolean;
  autoApproveFriends: boolean;
  profanityFilterEnabled: boolean;
  slowModeSeconds: number;
  e2eeEnabled: boolean;
  e2eeHostPublicKey?: string;
  playback: PlaybackState;
  playlist: PlaylistItem[];
  members: SerializedRoomMember[];
  chatHistory: ChatMessage[];
  bannedUserIds: string[];
  bannedAccountIds: string[];
  bannedSessionTokens: string[];
  snapshotTimestamp: number;
}

export interface ClusterMessage {
  senderNodeId: string;
  roomId: string;
  type: "ROOM_BROADCAST" | "ROOM_COMMAND" | "OWNERSHIP_CLAIM" | "NODE_DRAIN";
  payload: any;
  timestamp: number;
}

export class RedisRoomAdapter {
  public readonly nodeId: string;
  private redis: IRedisService;
  private ownedRoomIds: Set<string> = new Set();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private clusterChannel = "watchparty:cluster:events";
  private commandChannel = "watchparty:cluster:commands";
  private onRemoteBroadcastHandler?: (roomId: string, message: ServerMessage) => void;
  private onRemoteCommandHandler?: (roomId: string, command: ClientMessage, userId: string) => void;

  constructor(redis: IRedisService, nodeId?: string) {
    this.redis = redis;
    this.nodeId = nodeId || `node_${crypto.randomUUID().slice(0, 8)}`;
  }

  public async init(): Promise<void> {
    // Subscribe to cluster channels
    await this.redis.subscribe(this.clusterChannel, (raw) => {
      this.handleClusterMessage(raw);
    });

    await this.redis.subscribe(this.commandChannel, (raw) => {
      this.handleClusterMessage(raw);
    });

    // Start 5-second ownership renewal heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.renewAllOwnerships().catch((err) => {
        console.warn(`[RedisRoomAdapter] Heartbeat renewal error:`, err);
      });
    }, 5000);
  }

  public setRemoteBroadcastHandler(handler: (roomId: string, message: ServerMessage) => void): void {
    this.onRemoteBroadcastHandler = handler;
  }

  public setRemoteCommandHandler(handler: (roomId: string, command: ClientMessage, userId: string) => void): void {
    this.onRemoteCommandHandler = handler;
  }

  private handleClusterMessage(raw: string): void {
    try {
      const msg: ClusterMessage = JSON.parse(raw);
      if (msg.senderNodeId === this.nodeId) {
        return; // Ignore own messages
      }

      if (msg.type === "ROOM_BROADCAST") {
        this.onRemoteBroadcastHandler?.(msg.roomId, msg.payload as ServerMessage);
      } else if (msg.type === "ROOM_COMMAND") {
        if (this.ownedRoomIds.has(msg.roomId)) {
          this.onRemoteCommandHandler?.(msg.roomId, msg.payload.command, msg.payload.userId);
        }
      }
    } catch (err) {
      console.error("[RedisRoomAdapter] Error parsing cluster message:", err);
    }
  }

  // ==========================================
  // PER-ROOM OWNERSHIP & ORDERING GUARANTEES
  // ==========================================

  public async acquireRoomOwnership(roomId: string, ttlMs = 15000): Promise<boolean> {
    const key = `room:owner:${roomId}`;
    const acquired = await this.redis.acquireLock(key, this.nodeId, ttlMs);
    if (acquired) {
      this.ownedRoomIds.add(roomId);
    }
    return acquired;
  }

  public async renewRoomOwnership(roomId: string, ttlMs = 15000): Promise<boolean> {
    const key = `room:owner:${roomId}`;
    return this.redis.renewLock(key, this.nodeId, ttlMs);
  }

  public async releaseRoomOwnership(roomId: string): Promise<boolean> {
    const key = `room:owner:${roomId}`;
    this.ownedRoomIds.delete(roomId);
    return this.redis.releaseLock(key, this.nodeId);
  }

  public async getRoomOwner(roomId: string): Promise<string | null> {
    const key = `room:owner:${roomId}`;
    return this.redis.get(key);
  }

  public isRoomOwnedLocally(roomId: string): boolean {
    return this.ownedRoomIds.has(roomId);
  }

  private async renewAllOwnerships(): Promise<void> {
    for (const roomId of this.ownedRoomIds) {
      await this.renewRoomOwnership(roomId);
    }
  }

  // ==========================================
  // ROOM STATE SNAPSHOTTING & PERSISTENCE
  // ==========================================

  public async saveRoomSnapshot(room: Room): Promise<void> {
    const membersList: SerializedRoomMember[] = room.getAllMembers().map((m) => ({
      userId: m.userId,
      userName: m.userName,
      role: m.role,
      isHost: m.isHost,
      accountId: m.accountId,
      sessionToken: m.sessionToken,
      joinedAt: m.joinedAt,
    }));

    const snapshot: RoomSnapshotData = {
      roomId: room.roomId,
      roomCode: room.roomCode,
      roomName: room.roomName,
      baseUrl: room.baseUrl,
      hostId: room.hostId,
      version: room.version,
      controlMode: room.controlMode,
      roomType: room.roomType,
      passwordHash: room.getPasswordHash(),
      passwordSalt: room.getPasswordSalt(),
      maxMembers: room.maxMembers,
      waitingRoomEnabled: room.waitingRoomEnabled,
      autoApproveFriends: room.autoApproveFriends,
      profanityFilterEnabled: room.profanityFilterEnabled,
      slowModeSeconds: room.slowModeSeconds,
      e2eeEnabled: room.e2eeEnabled,
      e2eeHostPublicKey: room.e2eeHostPublicKey,
      playback: {
        videoId: room.playback.videoId,
        status: room.playback.status,
        positionMs: room.playback.positionMs,
        playbackRate: room.playback.playbackRate,
        serverTimeMs: room.playback.serverTimeMs,
      },
      playlist: [...room.playlist],
      members: membersList,
      chatHistory: [...room.chatHistory],
      bannedUserIds: room.getBannedUserIds(),
      bannedAccountIds: room.getBannedAccountIds(),
      bannedSessionTokens: room.getBannedSessionTokens(),
      snapshotTimestamp: Date.now(),
    };

    const snapshotKey = `room:snapshot:${room.roomId}`;
    const codeKey = `room:code:${room.roomCode.toUpperCase()}`;

    // Store snapshot with 24h expiration
    await this.redis.set(snapshotKey, JSON.stringify(snapshot), 86400);
    await this.redis.set(codeKey, room.roomId, 86400);

    // Track in active index
    const activeIndexKey = "room:active_index";
    const existing = await this.redis.get(activeIndexKey);
    let ids: string[] = existing ? JSON.parse(existing) : [];
    if (!ids.includes(room.roomId)) {
      ids.push(room.roomId);
      await this.redis.set(activeIndexKey, JSON.stringify(ids), 86400);
    }
  }

  public async loadRoomSnapshot(roomIdOrCode: string): Promise<RoomSnapshotData | null> {
    let roomId = roomIdOrCode;
    if (!roomId.startsWith("room_")) {
      const mappedId = await this.redis.get(`room:code:${roomIdOrCode.toUpperCase()}`);
      if (mappedId) {
        roomId = mappedId;
      }
    }

    const raw = await this.redis.get(`room:snapshot:${roomId}`);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as RoomSnapshotData;
    } catch {
      return null;
    }
  }

  public async deleteRoomSnapshot(roomId: string, roomCode?: string): Promise<void> {
    await this.redis.del(`room:snapshot:${roomId}`);
    if (roomCode) {
      await this.redis.del(`room:code:${roomCode.toUpperCase()}`);
    }
    await this.releaseRoomOwnership(roomId);

    const activeIndexKey = "room:active_index";
    const existing = await this.redis.get(activeIndexKey);
    if (existing) {
      let ids: string[] = JSON.parse(existing);
      ids = ids.filter((id) => id !== roomId);
      await this.redis.set(activeIndexKey, JSON.stringify(ids), 86400);
    }
  }

  /**
   * Restores active rooms from Redis snapshots into RoomManager upon server start or restart.
   */
  public async restoreRooms(roomManager: RoomManager): Promise<number> {
    const activeIndexKey = "room:active_index";
    const existing = await this.redis.get(activeIndexKey);
    if (!existing) return 0;

    let ids: string[] = [];
    try {
      ids = JSON.parse(existing);
    } catch {
      return 0;
    }

    let restoredCount = 0;
    for (const roomId of ids) {
      // Check if already in memory
      if (roomManager.getRoomById(roomId)) continue;

      const snapshot = await this.loadRoomSnapshot(roomId);
      if (!snapshot) continue;

      // Try acquiring ownership if not owned by an active node
      const owner = await this.getRoomOwner(roomId);
      if (!owner || owner === this.nodeId) {
        await this.acquireRoomOwnership(roomId);
      }

      const room = new Room({
        roomId: snapshot.roomId,
        roomCode: snapshot.roomCode,
        roomName: snapshot.roomName,
        hostUserId: snapshot.hostId,
        hostUserName: snapshot.members.find((m) => m.userId === snapshot.hostId)?.userName || "Host",
        controlMode: snapshot.controlMode,
        roomType: snapshot.roomType,
        passwordHash: snapshot.passwordHash,
        passwordSalt: snapshot.passwordSalt,
        maxMembers: snapshot.maxMembers,
        waitingRoomEnabled: snapshot.waitingRoomEnabled,
        autoApproveFriends: snapshot.autoApproveFriends,
        profanityFilterEnabled: snapshot.profanityFilterEnabled,
        slowModeSeconds: snapshot.slowModeSeconds,
        baseUrl: snapshot.baseUrl,
        onDestroy: (id) => {
          roomManager.removeRoom(id);
          this.deleteRoomSnapshot(id, snapshot.roomCode).catch(console.error);
        },
        onClusterBroadcast: (id, msg) => this.publishRoomBroadcast(id, msg),
        onStateChanged: (r) => this.saveRoomSnapshot(r),
        e2eeEnabled: snapshot.e2eeEnabled,
        e2eeHostPublicKey: snapshot.e2eeHostPublicKey,
      });

      // Restore playback state
      room.playback = {
        videoId: snapshot.playback.videoId,
        status: snapshot.playback.status,
        positionMs: snapshot.playback.positionMs,
        playbackRate: snapshot.playback.playbackRate,
        serverTimeMs: snapshot.playback.serverTimeMs,
      };

      // Restore playlist & version
      room.playlist = snapshot.playlist;
      room.version = snapshot.version;
      room.chatHistory = snapshot.chatHistory;

      // Restore reconnectable members
      for (const m of snapshot.members) {
        room.restoreMember({
          userId: m.userId,
          userName: m.userName,
          role: m.role,
          isHost: m.isHost,
          isConnected: false,
          isBuffering: false,
          accountId: m.accountId,
          joinedAt: m.joinedAt,
          lastSeenAt: Date.now(),
          sessionToken: m.sessionToken,
        });
      }

      // Restore bans
      room.restoreBanEntries(
        snapshot.bannedUserIds || [],
        snapshot.bannedAccountIds || [],
        snapshot.bannedSessionTokens || []
      );

      roomManager.registerRestoredRoom(room);
      restoredCount++;
    }

    return restoredCount;
  }

  // ==========================================
  // MULTI-NODE PUB/SUB BROADCASTING & ROUTING
  // ==========================================

  public async publishRoomBroadcast(roomId: string, message: ServerMessage): Promise<void> {
    const payload: ClusterMessage = {
      senderNodeId: this.nodeId,
      roomId,
      type: "ROOM_BROADCAST",
      payload: message,
      timestamp: Date.now(),
    };
    await this.redis.publish(this.clusterChannel, JSON.stringify(payload));
  }

  public async routeCommandToOwner(roomId: string, command: ClientMessage, userId: string): Promise<boolean> {
    const owner = await this.getRoomOwner(roomId);
    if (!owner) {
      return false;
    }
    if (owner === this.nodeId) {
      return true; // Already on owner node
    }

    // Forward command to the owning node
    const payload: ClusterMessage = {
      senderNodeId: this.nodeId,
      roomId,
      type: "ROOM_COMMAND",
      payload: { command, userId },
      timestamp: Date.now(),
    };
    await this.redis.publish(this.commandChannel, JSON.stringify(payload));
    return true;
  }

  public async disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const roomId of this.ownedRoomIds) {
      await this.releaseRoomOwnership(roomId);
    }
    this.ownedRoomIds.clear();
  }
}
