import * as jose from "jose";
import crypto from "node:crypto";
import {
  MediaProvider,
  MediaTokenOptions,
  MediaTokenResult,
  IceServerConfig,
} from "./MediaProvider.js";

export interface LiveKitProviderConfig {
  serverUrl: string;
  apiKey: string;
  apiSecret: string;
  coturnUrl?: string;
  coturnSecret?: string;
  coturnUsername?: string;
  coturnCredential?: string;
}

/**
 * Production-ready LiveKit SFU Media Provider.
 * Generates spec-compliant LiveKit access tokens carrying role and media permissions
 * with integrated STUN / TURN fallback for resilient connectivity across NAT and mobile networks.
 */
export class LiveKitMediaProvider implements MediaProvider {
  public readonly name = "livekit" as const;
  private readonly serverUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly coturnUrl?: string;
  private readonly coturnSecret?: string;
  private readonly coturnUsername?: string;
  private readonly coturnCredential?: string;

  constructor(config: LiveKitProviderConfig) {
    this.serverUrl = config.serverUrl || "ws://localhost:7880";
    this.apiKey = config.apiKey || "devkey";
    this.apiSecret = config.apiSecret || "secret";
    this.coturnUrl = config.coturnUrl;
    this.coturnSecret = config.coturnSecret;
    this.coturnUsername = config.coturnUsername;
    this.coturnCredential = config.coturnCredential;
  }

  /**
   * Generates short-lived, signed LiveKit access token with room permissions.
   */
  public async generateToken(options: MediaTokenOptions): Promise<MediaTokenResult> {
    const nowSec = Math.floor(Date.now() / 1000);
    const ttl = options.ttlSeconds || 3600; // 1 hour default
    const expiresAt = nowSec + ttl;

    const canPublishSources: string[] = [];
    if (options.canPublishAudio) canPublishSources.push("microphone");
    if (options.canPublishVideo) canPublishSources.push("camera");
    if (options.canPublishScreen) canPublishSources.push("screen_share");

    const videoGrant = {
      room: options.roomCode,
      roomJoin: true,
      canPublish: canPublishSources.length > 0,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources,
      roomAdmin: options.role === "host" || options.role === "moderator",
    };

    const secretKey = new TextEncoder().encode(this.apiSecret);
    const token = await new jose.SignJWT({
      name: options.userName,
      video: videoGrant,
      metadata: JSON.stringify({
        role: options.role,
        roomName: options.roomName,
        roomCode: options.roomCode,
      }),
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(this.apiKey)
      .setSubject(options.userId)
      .setIssuedAt(nowSec)
      .setNotBefore(nowSec - 5)
      .setExpirationTime(expiresAt)
      .sign(secretKey);

    return {
      provider: "livekit",
      serverUrl: this.serverUrl,
      token,
      identity: options.userId,
      roomName: options.roomCode,
      iceServers: this.getIceServers(options.userId),
      expiresAt: expiresAt * 1000,
      permissions: {
        canPublishAudio: options.canPublishAudio,
        canPublishVideo: options.canPublishVideo,
        canPublishScreen: options.canPublishScreen,
        canSubscribe: true,
      },
    };
  }

  /**
   * Generates STUN / TURN fallback server list.
   * If Coturn with shared secret is configured, dynamically derives RFC 5766 time-based HMAC credentials.
   */
  public getIceServers(userId: string = "guest"): IceServerConfig[] {
    const servers: IceServerConfig[] = [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    ];

    if (this.coturnUrl) {
      if (this.coturnSecret) {
        // RFC 5766 REST API dynamic ephemeral credentials (valid for 24h)
        const expiry = Math.floor(Date.now() / 1000) + 86400;
        const username = `${expiry}:${userId}`;
        const credential = crypto
          .createHmac("sha1", this.coturnSecret)
          .update(username)
          .digest("base64");

        servers.push({
          urls: [this.coturnUrl],
          username,
          credential,
        });
      } else if (this.coturnUsername && this.coturnCredential) {
        // Static Coturn credentials
        servers.push({
          urls: [this.coturnUrl],
          username: this.coturnUsername,
          credential: this.coturnCredential,
        });
      } else {
        servers.push({
          urls: [this.coturnUrl],
        });
      }
    }

    return servers;
  }
}
