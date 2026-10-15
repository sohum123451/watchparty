import { Role } from "@watchparty/shared";

export interface MediaTokenOptions {
  roomName: string;
  roomCode: string;
  userId: string;
  userName: string;
  role: Role;
  canPublishAudio: boolean;
  canPublishVideo: boolean;
  canPublishScreen: boolean;
  ttlSeconds?: number;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface MediaTokenResult {
  provider: "livekit" | "mock";
  serverUrl: string;
  token: string;
  identity: string;
  roomName: string;
  iceServers: IceServerConfig[];
  expiresAt: number;
  permissions: {
    canPublishAudio: boolean;
    canPublishVideo: boolean;
    canPublishScreen: boolean;
    canSubscribe: boolean;
  };
  videoDisabledForRoom?: boolean;
}

export interface MediaProvider {
  readonly name: string;
  generateToken(options: MediaTokenOptions): Promise<MediaTokenResult>;
  getIceServers(userId?: string): IceServerConfig[];
  muteParticipant?(roomName: string, identity: string, muted?: boolean): Promise<boolean>;
  removeParticipant?(roomName: string, identity: string): Promise<boolean>;
  updateRoomPermissions?(roomName: string, options: { videoDisabled?: boolean }): Promise<boolean>;
}
