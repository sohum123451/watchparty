import { MediaProvider, MediaTokenResult } from "./MediaProvider.js";
import { RoomManager } from "../rooms/RoomManager.js";
import { Role } from "@watchparty/shared";

export interface MediaServiceOptions {
  provider: MediaProvider;
  roomManager: RoomManager;
}

export class MediaService {
  private readonly provider: MediaProvider;
  private readonly roomManager: RoomManager;

  constructor(options: MediaServiceOptions) {
    this.provider = options.provider;
    this.roomManager = options.roomManager;
  }

  public getProvider(): MediaProvider {
    return this.provider;
  }

  /**
   * Generates a short-lived access token for authorized room members.
   * Enforces room-level permissions (e.g. videoDisabledForRoom, user mutes).
   */
  public async generateRoomToken(
    roomCode: string,
    user: { id: string; displayName: string },
    forcedRole?: Role
  ): Promise<MediaTokenResult> {
    const room = this.roomManager.getRoomByCode(roomCode);
    if (!room) {
      const err: any = new Error("Room not found");
      err.status = 404;
      err.code = "ROOM_NOT_FOUND";
      throw err;
    }

    const member = room.getMember(user.id);
    const role: Role = forcedRole || member?.role || (room.hostId === user.id ? "host" : "member");

    // Check voice mute state
    const isMuted = member ? member.isMuted : false;
    const canPublishAudio = !isMuted;

    // Check if room has video disabled
    const isRoomVideoDisabled = Boolean(room.videoDisabledForRoom);
    const canPublishVideo = !isRoomVideoDisabled && role !== "guest";
    const canPublishScreen = (role === "host" || role === "moderator" || room.approvedScreenSharers.has(user.id));

    const tokenResult = await this.provider.generateToken({
      roomName: room.roomName,
      roomCode: room.roomCode,
      userId: user.id,
      userName: user.displayName,
      role,
      canPublishAudio,
      canPublishVideo,
      canPublishScreen,
      ttlSeconds: 3600,
    });

    tokenResult.videoDisabledForRoom = isRoomVideoDisabled;
    return tokenResult;
  }

  /**
   * Host / Moderator controls: Mute participant in voice
   */
  public async muteVoiceParticipant(
    roomCode: string,
    actorUserId: string,
    targetUserId: string
  ): Promise<boolean> {
    const room = this.roomManager.getRoomByCode(roomCode);
    if (!room) return false;

    if (!room.hasPermission(actorUserId, "mute")) {
      const err: any = new Error("Permission denied to mute participant");
      err.status = 403;
      throw err;
    }

    return room.muteVoiceParticipant(actorUserId, targetUserId);
  }

  /**
   * Host / Moderator controls: Remove participant from voice
   */
  public async removeVoiceParticipant(
    roomCode: string,
    actorUserId: string,
    targetUserId: string
  ): Promise<boolean> {
    const room = this.roomManager.getRoomByCode(roomCode);
    if (!room) return false;

    if (!room.hasPermission(actorUserId, "kick")) {
      const err: any = new Error("Permission denied to remove participant from voice");
      err.status = 403;
      throw err;
    }

    return room.removeVoiceParticipant(actorUserId, targetUserId);
  }

  /**
   * Host / Moderator controls: Disable or enable camera video for entire room
   */
  public async setRoomVideoDisabled(
    roomCode: string,
    actorUserId: string,
    disabled: boolean
  ): Promise<boolean> {
    const room = this.roomManager.getRoomByCode(roomCode);
    if (!room) return false;

    if (!room.hasPermission(actorUserId, "manage_settings")) {
      const err: any = new Error("Permission denied to change room video settings");
      err.status = 403;
      throw err;
    }

    return room.setRoomVideoDisabled(actorUserId, disabled);
  }

  // Token revocation registry for kicked/banned users
  private readonly revokedUserTokens = new Map<string, Set<string>>();

  /**
   * Immediately revokes and invalidates media tokens for a user upon kick or ban
   */
  public revokeUserTokens(roomCode: string, userId: string): void {
    let set = this.revokedUserTokens.get(roomCode);
    if (!set) {
      set = new Set();
      this.revokedUserTokens.set(roomCode, set);
    }
    set.add(userId);
  }

  public isUserRevoked(roomCode: string, userId: string): boolean {
    const set = this.revokedUserTokens.get(roomCode);
    return Boolean(set && set.has(userId));
  }
}
