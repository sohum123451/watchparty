import { WebSocket } from "ws";
import {
  ClientMessage,
  ServerMessage,
  ControlMode,
  PlaybackState,
  RoomSnapshot,
} from "@watchparty/shared";
import { PlaybackSyncEngine } from "@watchparty/client";
import { SimulatedVideo } from "./SimulatedVideo.js";
import { NetworkEmulator, NetworkConditions } from "./NetworkEmulator.js";

export interface HeadlessClientOptions {
  userId?: string;
  userName?: string;
  hardwareDriftPpm?: number;
  networkConditions?: NetworkConditions;
}

export interface LatencyEvent {
  commandId: string;
  action: "play" | "pause" | "seek";
  originUserId: string;
  clientSeq: number;
  targetPositionMs?: number;
  sendMonotonicMs: number;
}

/**
 * Headless WebSocket client simulating an end-user in a WatchParty room,
 * with real WebSocket networking, clock synchronization, and simulated video element.
 */
export class HeadlessClient {
  public readonly id: string;
  public readonly userName: string;
  public readonly video: SimulatedVideo;
  public readonly engine: PlaybackSyncEngine;
  public readonly network: NetworkEmulator;

  public ws: WebSocket | null = null;
  public serverUrl = "";
  public roomCode = "";
  public userId = "";
  public isHost = false;
  public reconnectToken = "";
  public lastKnownVersion = 0;
  public isConnected = false;

  private clientSeqCounter = 1;
  private messageListeners: Set<(msg: ServerMessage) => void> = new Set();
  private onPlaybackUpdateCallbacks: Set<
    (update: { playback: PlaybackState; causedBy?: { userId: string; clientSeq?: number } }) => void
  > = new Set();

  constructor(options: HeadlessClientOptions = {}) {
    this.id = options.userId || `client_${Math.random().toString(36).substring(2, 9)}`;
    this.userName = options.userName || `User_${this.id.substring(0, 5)}`;
    this.network = new NetworkEmulator(options.networkConditions);
    this.video = new SimulatedVideo({ hardwareDriftPpm: options.hardwareDriftPpm });

    this.engine = new PlaybackSyncEngine({
      video: this.video,
      sendPing: (clientSendTimeMs) => {
        this.sendRaw({
          type: "SYNC_PING",
          payload: { clientSendTimeMs },
        });
      },
      pingIntervalMs: 2500, // Slightly faster pings for benchmark responsiveness
      driftIntervalMs: 100, // 100ms drift loop matching benchmark sample rate
      deadZoneMs: 40,
      hysteresisZoneMs: 20,
      hardSeekThresholdMs: 1000,
    });
  }

  public nextSeq(): number {
    return this.clientSeqCounter++;
  }

  public async connect(serverUrl: string): Promise<void> {
    this.serverUrl = serverUrl;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(serverUrl);
      this.ws = socket;

      socket.on("open", () => {
        this.isConnected = true;
        this.engine.start();
        resolve();
      });

      socket.on("message", (data: Buffer | string) => {
        this.network.transmit(() => {
          this.handleIncomingRaw(data.toString());
        });
      });

      socket.on("close", () => {
        this.isConnected = false;
      });

      socket.on("error", (err) => {
        if (!this.isConnected) {
          reject(err);
        }
      });
    });
  }

  private handleIncomingRaw(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    if ("version" in msg && typeof msg.version === "number") {
      this.lastKnownVersion = msg.version;
    }

    // Handle NTP Sync Pong
    if (msg.type === "SYNC_PONG") {
      const { clientSendTimeMs, serverReceiveTimeMs, serverSendTimeMs } = msg.payload;
      this.engine.handleSyncPong(
        clientSendTimeMs,
        serverReceiveTimeMs,
        serverSendTimeMs,
        Date.now()
      );
    }

    // Handle Snapshot
    if (msg.type === "ROOM_SNAPSHOT") {
      const snap: RoomSnapshot = msg.payload;
      this.userId = snap.selfUserId;
      this.reconnectToken = snap.reconnectToken;
      this.roomCode = snap.roomCode;
      this.isHost = snap.hostId === this.userId;
      this.engine.setPlaybackState(snap.playback);
    }

    // Handle Playback Updates
    if (msg.type === "PLAYBACK_UPDATE") {
      this.engine.setPlaybackState(msg.payload.playback);
      for (const cb of this.onPlaybackUpdateCallbacks) {
        cb({ playback: msg.payload.playback, causedBy: msg.payload.causedBy });
      }
    }

    // Handle Host Changed
    if (msg.type === "ROOM_HOST_CHANGED") {
      this.isHost = msg.payload.newHostId === this.userId;
    }

    // Handle Missed Events
    if (msg.type === "MISSED_EVENTS") {
      for (const event of msg.payload.events) {
        if (event.type === "PLAYBACK_UPDATE") {
          const payload = event.payload as { playback: PlaybackState; causedBy?: any };
          this.engine.setPlaybackState(payload.playback);
        }
      }
    }

    // Notify generic listeners
    for (const listener of this.messageListeners) {
      listener(msg);
    }
  }

  public sendRaw(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.network.transmit(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    });
  }

  public async createRoom(
    roomName = "Bench Room",
    controlMode: ControlMode = "public",
    retries = 3
  ): Promise<{ roomCode: string }> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const seq = this.nextSeq();
        const waitSnapshot = this.waitForMessage(
          (m): m is ServerMessage & { type: "ROOM_SNAPSHOT" } => m.type === "ROOM_SNAPSHOT",
          3000
        );

        this.sendRaw({
          type: "ROOM_CREATE",
          clientSeq: seq,
          payload: {
            userName: this.userName,
            roomName,
            controlMode,
            initialVideoId: "bench_vid",
            e2eeEnabled: true,
          },
        });

        const snapshotMsg = await waitSnapshot;
        this.roomCode = snapshotMsg.payload.roomCode;
        this.userId = snapshotMsg.payload.selfUserId;
        this.reconnectToken = snapshotMsg.payload.reconnectToken;
        this.isHost = true;
        return { roomCode: this.roomCode };
      } catch (err) {
        if (attempt === retries) throw err;
      }
    }
    throw new Error("Failed to create room after retries");
  }

  public async joinRoom(roomCode: string, reconnectToken?: string, retries = 3): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const seq = this.nextSeq();
        const waitSnapshotOrAck = this.waitForMessage(
          (m) => m.type === "ROOM_SNAPSHOT" || m.type === "MISSED_EVENTS",
          2500
        );

        this.sendRaw({
          type: "ROOM_JOIN",
          clientSeq: seq,
          payload: {
            roomCode,
            userName: this.userName,
            reconnectToken: reconnectToken || (this.reconnectToken || undefined),
            lastKnownVersion: this.lastKnownVersion > 0 ? this.lastKnownVersion : undefined,
          },
        });

        await waitSnapshotOrAck;
        return;
      } catch (err) {
        if (attempt === retries) throw err;
      }
    }
    throw new Error(`Failed to join room ${roomCode} after ${retries} retries`);
  }

  public sendPlay(positionMs?: number): number {
    const seq = this.nextSeq();
    this.sendRaw({
      type: "PLAYBACK_PLAY",
      clientSeq: seq,
      payload: { positionMs },
    });
    return seq;
  }

  public sendPause(positionMs?: number): number {
    const seq = this.nextSeq();
    this.sendRaw({
      type: "PLAYBACK_PAUSE",
      clientSeq: seq,
      payload: { positionMs },
    });
    return seq;
  }

  public sendSeek(targetPositionMs: number, autoPlay?: boolean): number {
    const seq = this.nextSeq();
    this.sendRaw({
      type: "PLAYBACK_SEEK",
      clientSeq: seq,
      payload: { targetPositionMs, autoPlay },
    });
    return seq;
  }

  public async disconnect(): Promise<void> {
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      this.isConnected = false;
      await new Promise<void>((resolve) => {
        socket.once("close", () => resolve());
        socket.close();
      });
    }
  }

  public async reconnect(roomCode = this.roomCode): Promise<void> {
    await this.connect(this.serverUrl);
    await this.joinRoom(roomCode, this.reconnectToken);
  }

  /**
   * Samples instantaneous post-correction drift between simulated video currentTime
   * and the authoritative target position in milliseconds.
   */
  public sampleDrift(): { driftMs: number; clientPosMs: number; targetPosMs: number } {
    const clientPosMs = Math.round(this.video.currentTime * 1000);
    const targetPosMs = Math.round(this.engine.getTargetPositionMs());
    const driftMs = clientPosMs - targetPosMs;
    return { driftMs, clientPosMs, targetPosMs };
  }

  public onPlaybackUpdate(
    cb: (update: { playback: PlaybackState; causedBy?: { userId: string; clientSeq?: number } }) => void
  ): () => void {
    this.onPlaybackUpdateCallbacks.add(cb);
    return () => this.onPlaybackUpdateCallbacks.delete(cb);
  }

  public waitForMessage<T extends ServerMessage>(
    predicate: (msg: ServerMessage) => msg is T,
    timeoutMs = 5000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.messageListeners.delete(handler);
        reject(new Error(`Timed out waiting for message after ${timeoutMs}ms`));
      }, timeoutMs);

      const handler = (msg: ServerMessage) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          this.messageListeners.delete(handler);
          resolve(msg);
        }
      };

      this.messageListeners.add(handler);
    });
  }

  public destroy(): void {
    this.engine.destroy();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.messageListeners.clear();
    this.onPlaybackUpdateCallbacks.clear();
  }
}
