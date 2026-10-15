import {
  MediaProvider,
  MediaTokenOptions,
  MediaTokenResult,
  IceServerConfig,
} from "./MediaProvider.js";

/**
 * Mock / In-Memory Media Provider for testing, local offline development,
 * and deterministic test executions without external network dependencies.
 */
export class MockMediaProvider implements MediaProvider {
  public readonly name = "mock" as const;

  public async generateToken(options: MediaTokenOptions): Promise<MediaTokenResult> {
    const expiresAt = Date.now() + (options.ttlSeconds || 3600) * 1000;
    const fakeToken = `mock_token_${Buffer.from(
      JSON.stringify({
        room: options.roomCode,
        sub: options.userId,
        name: options.userName,
        role: options.role,
        audio: options.canPublishAudio,
        video: options.canPublishVideo,
        screen: options.canPublishScreen,
        exp: expiresAt,
      })
    ).toString("base64")}`;

    return {
      provider: "mock",
      serverUrl: "ws://mock-sfu.local:7880",
      token: fakeToken,
      identity: options.userId,
      roomName: options.roomCode,
      iceServers: this.getIceServers(options.userId),
      expiresAt,
      permissions: {
        canPublishAudio: options.canPublishAudio,
        canPublishVideo: options.canPublishVideo,
        canPublishScreen: options.canPublishScreen,
        canSubscribe: true,
      },
    };
  }

  public getIceServers(_userId?: string): IceServerConfig[] {
    return [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    ];
  }
}
