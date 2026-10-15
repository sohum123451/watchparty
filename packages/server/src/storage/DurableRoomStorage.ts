import fs from "node:fs";
import path from "node:path";
import { Room } from "../rooms/Room.js";
import { RoomManager } from "../rooms/RoomManager.js";
import {
  PlaybackState,
  PlaylistItem,
  ChatMessage,
  ControlMode,
  RoomType,
  Role,
  ServerMessage,
  SourcePlaybackMemoryItem,
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
  requireLinkApproval?: boolean;
  approvedSourceAdders?: string[];
  e2eeEnabled: boolean;
  e2eeHostPublicKey?: string;
  isHomeRoom?: boolean;
  homeGroupName?: string;
  sourcePlaybackMemory?: Record<string, SourcePlaybackMemoryItem>;
  playback: PlaybackState;
  playlist: PlaylistItem[];
  members: SerializedRoomMember[];
  chatHistory: ChatMessage[];
  bannedUserIds: string[];
  bannedAccountIds: string[];
  bannedSessionTokens: string[];
  snapshotTimestamp: number;
}

export function serializeRoom(room: Room): RoomSnapshotData {
  const membersList: SerializedRoomMember[] = room.getAllMembers().map((m) => ({
    userId: m.userId,
    userName: m.userName,
    role: m.role,
    isHost: m.isHost,
    accountId: m.accountId,
    sessionToken: m.sessionToken,
    joinedAt: m.joinedAt,
  }));

  return {
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
    requireLinkApproval: room.requireLinkApproval,
    approvedSourceAdders: Array.from(room.approvedSourceAdders || []),
    e2eeEnabled: room.e2eeEnabled,
    e2eeHostPublicKey: room.e2eeHostPublicKey,
    isHomeRoom: room.isHomeRoom,
    homeGroupName: room.homeGroupName,
    sourcePlaybackMemory: Object.fromEntries(room.sourcePlaybackMemory.entries()),
    playback: {
      videoId: room.playback.videoId,
      status: room.playback.status,
      positionMs: room.playback.positionMs,
      playbackRate: room.playback.playbackRate,
      serverTimeMs: room.playback.serverTimeMs,
      domain: room.playback.domain,
      author: room.playback.author,
      originalUrl: room.playback.originalUrl,
      sourceRef: room.playback.sourceRef,
      provider: room.playback.provider,
      title: room.playback.title,
      license: room.playback.license,
    },
    playlist: [...room.playlist],
    members: membersList,
    chatHistory: [...room.chatHistory],
    bannedUserIds: room.getBannedUserIds(),
    bannedAccountIds: room.getBannedAccountIds(),
    bannedSessionTokens: room.getBannedSessionTokens(),
    snapshotTimestamp: Date.now(),
  };
}

export function deserializeRoom(
  snapshot: RoomSnapshotData,
  roomManager: RoomManager,
  callbacks?: {
    onDestroy?: (roomId: string) => void;
    onClusterBroadcast?: (id: string, msg: ServerMessage) => void;
    onStateChanged?: (room: Room) => void;
  }
): Room {
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
    requireLinkApproval: snapshot.requireLinkApproval ?? true,
    approvedSourceAdders: snapshot.approvedSourceAdders || [],
    baseUrl: snapshot.baseUrl,
    onDestroy: callbacks?.onDestroy || ((id) => roomManager.removeRoom(id)),
    onClusterBroadcast: callbacks?.onClusterBroadcast,
    onStateChanged: callbacks?.onStateChanged,
    e2eeEnabled: snapshot.e2eeEnabled,
    e2eeHostPublicKey: snapshot.e2eeHostPublicKey,
    isHomeRoom: snapshot.isHomeRoom,
    homeGroupName: snapshot.homeGroupName,
    sourcePlaybackMemory: snapshot.sourcePlaybackMemory,
  });

  // Calculate elapsed playback position if video was playing during shutdown/restart
  const now = Date.now();
  let restoredPositionMs = snapshot.playback.positionMs;
  if (snapshot.playback.status === "playing" && snapshot.playback.serverTimeMs) {
    const elapsed = (now - snapshot.playback.serverTimeMs) * (snapshot.playback.playbackRate || 1.0);
    restoredPositionMs = Math.max(0, Math.floor(snapshot.playback.positionMs + elapsed));
  }

  room.playback = {
    ...snapshot.playback,
    positionMs: restoredPositionMs,
    serverTimeMs: now,
  };

  room.playlist = snapshot.playlist || [];
  room.version = snapshot.version || 1;
  room.chatHistory = snapshot.chatHistory || [];

  for (const m of snapshot.members || []) {
    room.restoreMember({
      userId: m.userId,
      userName: m.userName,
      role: m.role,
      isHost: m.isHost,
      isConnected: false,
      isBuffering: false,
      accountId: m.accountId,
      joinedAt: m.joinedAt,
      lastSeenAt: now,
      sessionToken: m.sessionToken,
    });
  }

  room.restoreBanEntries(
    snapshot.bannedUserIds || [],
    snapshot.bannedAccountIds || [],
    snapshot.bannedSessionTokens || []
  );

  return room;
}

export interface IRoomStorage {
  saveRoom(room: Room): Promise<void>;
  saveRoomSnapshot(snapshot: RoomSnapshotData): Promise<void>;
  loadRoomSnapshot(roomIdOrCode: string): Promise<RoomSnapshotData | null>;
  deleteRoom(roomId: string, roomCode?: string): Promise<void>;
  getAllActiveSnapshots(): Promise<RoomSnapshotData[]>;
  restoreRooms(roomManager: RoomManager): Promise<number>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface DurableRoomStorageOptions {
  storageFile?: string;
  debounceMs?: number;
  inMemoryOnly?: boolean;
  onClusterBroadcast?: (id: string, msg: ServerMessage) => void;
}

/**
 * Low-maintenance, zero-ops durable room storage designed for small-scale production (5-50 users).
 * Persists room state to durable JSON storage (volume mount or disk) with atomic write guarantees,
 * debounced writes for zero CPU/IO overhead, and automatic room restoration upon server boot.
 */
export class DurableRoomStorage implements IRoomStorage {
  private filePath?: string;
  private memorySnapshots: Map<string, RoomSnapshotData> = new Map();
  private codeToId: Map<string, string> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private debounceMs: number;
  private isFlushing = false;
  private inMemoryOnly: boolean;
  private onClusterBroadcast?: (id: string, msg: ServerMessage) => void;

  constructor(options: DurableRoomStorageOptions = {}) {
    this.inMemoryOnly = options.inMemoryOnly !== undefined
      ? Boolean(options.inMemoryOnly)
      : (!options.storageFile && process.env.NODE_ENV === "test");
    this.debounceMs = options.debounceMs ?? 1000;
    this.onClusterBroadcast = options.onClusterBroadcast;

    if (!this.inMemoryOnly) {
      const dataDir = process.env.DATA_DIR || path.join(process.cwd(), ".data");
      this.filePath = options.storageFile || path.join(dataDir, "rooms_state.json");
      this.loadFromFile();
    }
  }

  private loadFromFile(): void {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        if (raw.trim()) {
          const list: RoomSnapshotData[] = JSON.parse(raw);
          for (const snap of list) {
            // Keep snapshots active for 48 hours
            if (Date.now() - snap.snapshotTimestamp < 48 * 3600 * 1000) {
              this.memorySnapshots.set(snap.roomId, snap);
              this.codeToId.set(snap.roomCode.toUpperCase(), snap.roomId);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[DurableRoomStorage] Could not load state from ${this.filePath}:`, err);
    }
  }

  private writeToFileSync(): void {
    if (this.inMemoryOnly || !this.filePath) return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const list = Array.from(this.memorySnapshots.values());
      const data = JSON.stringify(list, null, 2);
      const tempPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;

      fs.writeFileSync(tempPath, data, "utf-8");
      try {
        fs.renameSync(tempPath, this.filePath);
      } catch {
        fs.copyFileSync(tempPath, this.filePath);
        try {
          fs.unlinkSync(tempPath);
        } catch {}
      }
    } catch (err) {
      console.error(`[DurableRoomStorage] Error writing snapshot to disk:`, err);
    }
  }

  public async saveRoom(room: Room): Promise<void> {
    const snapshot = serializeRoom(room);
    return this.scheduleSaveSnapshot(snapshot);
  }

  public async saveRoomSnapshot(snapshot: RoomSnapshotData): Promise<void> {
    return this.scheduleSaveSnapshot(snapshot);
  }

  private scheduleSaveSnapshot(snapshot: RoomSnapshotData): Promise<void> {
    this.memorySnapshots.set(snapshot.roomId, snapshot);
    this.codeToId.set(snapshot.roomCode.toUpperCase(), snapshot.roomId);

    // If debouncing is 0 or disabled, write immediately
    if (this.debounceMs <= 0 || this.inMemoryOnly) {
      this.writeToFileSync();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const existing = this.debounceTimers.get(snapshot.roomId);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        this.debounceTimers.delete(snapshot.roomId);
        this.writeToFileSync();
        resolve();
      }, this.debounceMs);

      this.debounceTimers.set(snapshot.roomId, timer);
    });
  }

  public async loadRoomSnapshot(roomIdOrCode: string): Promise<RoomSnapshotData | null> {
    let roomId = roomIdOrCode;
    if (!roomId.startsWith("room_")) {
      const mapped = this.codeToId.get(roomIdOrCode.toUpperCase());
      if (mapped) roomId = mapped;
    }

    const snap = this.memorySnapshots.get(roomId);
    return snap ? { ...snap } : null;
  }

  public async deleteRoom(roomId: string, roomCode?: string): Promise<void> {
    const timer = this.debounceTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(roomId);
    }

    this.memorySnapshots.delete(roomId);
    if (roomCode) {
      this.codeToId.delete(roomCode.toUpperCase());
    } else {
      for (const [code, id] of this.codeToId.entries()) {
        if (id === roomId) {
          this.codeToId.delete(code);
        }
      }
    }

    this.writeToFileSync();
  }

  public async getAllActiveSnapshots(): Promise<RoomSnapshotData[]> {
    return Array.from(this.memorySnapshots.values());
  }

  public async restoreRooms(roomManager: RoomManager): Promise<number> {
    let restoredCount = 0;
    const snapshots = Array.from(this.memorySnapshots.values());

    for (const snap of snapshots) {
      if (roomManager.getRoomById(snap.roomId)) {
        continue; // Already restored or in memory
      }

      const room = deserializeRoom(snap, roomManager, {
        onDestroy: (id) => {
          roomManager.removeRoom(id);
          this.deleteRoom(id, snap.roomCode).catch(console.error);
        },
        onClusterBroadcast: this.onClusterBroadcast,
        onStateChanged: (r) => {
          this.saveRoom(r).catch(console.error);
        },
      });

      roomManager.registerRestoredRoom(room);
      restoredCount++;
    }

    return restoredCount;
  }

  public async flush(): Promise<void> {
    if (this.isFlushing) return;
    this.isFlushing = true;
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.writeToFileSync();
    this.isFlushing = false;
  }

  public async close(): Promise<void> {
    await this.flush();
  }

  public clear(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.memorySnapshots.clear();
    this.codeToId.clear();
    if (!this.inMemoryOnly && this.filePath && fs.existsSync(this.filePath)) {
      try {
        fs.unlinkSync(this.filePath);
      } catch {}
    }
  }
}
