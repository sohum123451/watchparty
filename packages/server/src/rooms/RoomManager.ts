import { ControlMode, RoomType } from "@watchparty/shared";
import { Room } from "./Room.js";
import { generateId, generateRoomCode } from "../utils/crypto.js";
import type { RedisRoomAdapter } from "../redis/RedisRoomAdapter.js";
import type { IRoomStorage } from "../storage/DurableRoomStorage.js";
import type { SourcePlaybackMemoryItem } from "@watchparty/shared";

export interface CreateRoomOptions {
  hostUserName: string;
  roomName: string;
  hostUserId?: string;
  hostAccountId?: string;
  roomCode?: string;
  isHomeRoom?: boolean;
  homeGroupName?: string;
  sourcePlaybackMemory?: Record<string, SourcePlaybackMemoryItem>;
  controlMode?: ControlMode;
  roomType?: RoomType;
  roomPassword?: string;
  maxMembers?: number;
  waitingRoomEnabled?: boolean;
  autoApproveFriends?: boolean;
  profanityFilterEnabled?: boolean;
  slowModeSeconds?: number;
  initialVideoId?: string;
  e2eeEnabled?: boolean;
  e2eeHostPublicKey?: string;
  friendsService?: any;
  requireLinkApproval?: boolean;
  chatRetentionDays?: number;
  roomRules?: string;
}

export class RoomManager {
  private roomsById: Map<string, Room>;
  private roomsByCode: Map<string, Room>;
  private baseUrl: string;
  private redisAdapter?: RedisRoomAdapter;
  private roomStorage?: IRoomStorage;
  private pruneTimer?: NodeJS.Timeout;

  constructor(baseUrl = "http://localhost:3000") {
    this.roomsById = new Map();
    this.roomsByCode = new Map();
    this.baseUrl = baseUrl;

    this.pruneTimer = setInterval(() => {
      this.pruneAllRoomsChat();
    }, 60_000);
    if (this.pruneTimer.unref) {
      this.pruneTimer.unref();
    }
  }

  public pruneAllRoomsChat(): void {
    const now = Date.now();
    for (const room of this.roomsById.values()) {
      room.pruneExpiredChat(now);
    }
  }

  public destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = undefined;
    }
  }

  public setRedisAdapter(adapter: RedisRoomAdapter): void {
    this.redisAdapter = adapter;
  }

  public setRoomStorage(storage: IRoomStorage): void {
    this.roomStorage = storage;
  }

  public getRoomStorage(): IRoomStorage | undefined {
    return this.roomStorage;
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  public createRoom(
    hostUserNameOrOptions: string | CreateRoomOptions,
    roomNameParam?: string,
    controlModeParam: ControlMode = "public",
    initialVideoIdParam?: string,
    e2eeEnabledParam?: boolean,
    e2eeHostPublicKeyParam?: string
  ): { room: Room; hostUserId: string; hostSessionToken: string } {
    let opts: CreateRoomOptions;

    if (typeof hostUserNameOrOptions === "object") {
      opts = hostUserNameOrOptions;
    } else {
      opts = {
        hostUserName: hostUserNameOrOptions,
        roomName: roomNameParam || "WatchParty Room",
        controlMode: controlModeParam,
        initialVideoId: initialVideoIdParam,
        e2eeEnabled: e2eeEnabledParam,
        e2eeHostPublicKey: e2eeHostPublicKeyParam,
      };
    }

    const roomId = generateId("room");
    let roomCode = opts.roomCode || generateRoomCode();

    // Ensure room code uniqueness across active rooms if generating automatically
    if (!opts.roomCode) {
      while (this.roomsByCode.has(roomCode)) {
        roomCode = generateRoomCode();
      }
    }

    const hostUserId = opts.hostUserId || generateId("usr");
    const room = new Room({
      roomId,
      roomCode,
      roomName: opts.roomName,
      hostUserId,
      hostUserName: opts.hostUserName,
      hostAccountId: opts.hostAccountId,
      controlMode: opts.controlMode || "public",
      roomType: opts.roomType || "public",
      roomPassword: opts.roomPassword,
      maxMembers: opts.maxMembers,
      waitingRoomEnabled: opts.waitingRoomEnabled,
      autoApproveFriends: opts.autoApproveFriends,
      profanityFilterEnabled: opts.profanityFilterEnabled,
      slowModeSeconds: opts.slowModeSeconds,
      initialVideoId: opts.initialVideoId,
      baseUrl: this.baseUrl,
      onDestroy: (id) => this.removeRoom(id),
      onClusterBroadcast: (id, msg) => this.redisAdapter?.publishRoomBroadcast(id, msg),
      onStateChanged: (r) => {
        this.roomStorage?.saveRoom(r).catch(console.error);
        this.redisAdapter?.saveRoomSnapshot(r).catch(console.error);
      },
      e2eeEnabled: opts.e2eeEnabled,
      e2eeHostPublicKey: opts.e2eeHostPublicKey,
      friendsService: opts.friendsService,
      requireLinkApproval: opts.requireLinkApproval ?? true,
      isHomeRoom: opts.isHomeRoom,
      homeGroupName: opts.homeGroupName,
      sourcePlaybackMemory: opts.sourcePlaybackMemory,
      chatRetentionDays: opts.chatRetentionDays,
      roomRules: opts.roomRules,
    });

    this.roomsById.set(roomId, room);
    this.roomsByCode.set(roomCode.toUpperCase().trim(), room);

    // Persist immediately to durable storage
    if (this.roomStorage) {
      this.roomStorage.saveRoom(room).catch(console.error);
    }

    // Persist and acquire ownership in Redis if cluster adapter is present
    if (this.redisAdapter) {
      this.redisAdapter.acquireRoomOwnership(roomId).catch(console.error);
      this.redisAdapter.saveRoomSnapshot(room).catch(console.error);
    }

    const hostMember = room.getMember(hostUserId);
    const hostSessionToken = hostMember?.sessionToken || "";

    return { room, hostUserId, hostSessionToken };
  }

  public registerRestoredRoom(room: Room): void {
    this.roomsById.set(room.roomId, room);
    this.roomsByCode.set(room.roomCode.toUpperCase().trim(), room);
  }

  public getAllRooms(): Room[] {
    return Array.from(this.roomsById.values());
  }

  public listHomeRooms(): Room[] {
    return this.getAllRooms().filter((r) => r.isHomeRoom);
  }

  public getRoomByCode(code: string): Room | undefined {
    return this.roomsByCode.get(code.toUpperCase().trim());
  }

  public getRoomById(id: string): Room | undefined {
    return this.roomsById.get(id);
  }

  public getRoom(id: string): Room | undefined {
    return this.roomsById.get(id);
  }

  public removeRoom(roomId: string): void {
    const room = this.roomsById.get(roomId);
    if (room) {
      this.roomsByCode.delete(room.roomCode.toUpperCase().trim());
      this.roomsById.delete(roomId);
      room.destroy();

      if (this.roomStorage) {
        this.roomStorage.deleteRoom(roomId, room.roomCode).catch(console.error);
      }

      if (this.redisAdapter) {
        this.redisAdapter.deleteRoomSnapshot(roomId, room.roomCode).catch(console.error);
      }
    }
  }

  public getActiveRoomCount(): number {
    return this.roomsById.size;
  }

  public anonymizeUserAcrossRooms(accountIdOrUserId: string): void {
    for (const room of this.roomsById.values()) {
      room.anonymizeUser(accountIdOrUserId);
    }
  }

  public cleanupAll(): void {
    for (const room of this.roomsById.values()) {
      room.destroy();
    }
    this.roomsById.clear();
    this.roomsByCode.clear();
  }
}
