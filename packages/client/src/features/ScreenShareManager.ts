import {
  ScreenShareSessionInfo,
  ScreenShareMetrics,
  ScreenShareTransportMode,
  ServerMessage,
  ClientMessage,
} from "@watchparty/shared";
import { ScreenShareAdapter } from "../adapters/ScreenShareAdapter.js";
import {
  ScreenShareTransport,
  MeshScreenShareTransport,
  SfuScreenShareTransport,
} from "./ScreenShareTransport.js";
import { SyncHealthMonitor } from "./SyncHealthMonitor.js";
import { CoWatchAudioManager } from "./CoWatchAudioManager.js";

export type BitratePreset = "high" | "medium" | "low";

export const BITRATE_PRESET_MAP: Record<BitratePreset, number> = {
  high: 3_000_000,    // 3.0 Mbps (1080p sharp text & high motion)
  medium: 1_500_000,  // 1.5 Mbps (720p balanced bandwidth)
  low: 500_000,       // 500 kbps (low bandwidth / high packet loss fallback)
};

export interface ScreenShareManagerOptions {
  localUserId: string;
  localUserName: string;
  isHost: boolean;
  getMemberCount: () => number;
  getMemberIds: () => string[];
  sendMessage: (msg: ClientMessage) => void;
  adapter?: ScreenShareAdapter;
  syncHealthMonitor?: SyncHealthMonitor;
  audioManager?: CoWatchAudioManager;
}

export interface ScreenShareState {
  isSharing: boolean;
  isApproved: boolean;
  activeSession: ScreenShareSessionInfo | null;
  transportMode: ScreenShareTransportMode | null;
  bitratePreset: BitratePreset;
  currentMetrics: ScreenShareMetrics | null;
}

export class ScreenShareManager {
  private readonly options: ScreenShareManagerOptions;
  private isSharing = false;
  private isApproved = false;
  private activeSession: ScreenShareSessionInfo | null = null;
  private transport: ScreenShareTransport | null = null;
  private bitratePreset: BitratePreset = "high";
  private currentMetrics: ScreenShareMetrics | null = null;
  private localStream: MediaStream | null = null;
  private adapter: ScreenShareAdapter;
  private metricsReportInterval: any = null;

  private readonly stateListeners: Set<(state: ScreenShareState) => void> = new Set();
  private readonly metricsListeners: Set<(metrics: ScreenShareMetrics) => void> = new Set();

  constructor(options: ScreenShareManagerOptions) {
    this.options = options;
    this.isApproved = options.isHost;
    this.adapter = options.adapter || new ScreenShareAdapter();
  }

  public getAdapter(): ScreenShareAdapter {
    return this.adapter;
  }

  public canShare(): boolean {
    return this.options.isHost || this.isApproved;
  }

  public getState(): ScreenShareState {
    return {
      isSharing: this.isSharing,
      isApproved: this.isApproved,
      activeSession: this.activeSession,
      transportMode: this.transport?.mode || this.activeSession?.transportMode || null,
      bitratePreset: this.bitratePreset,
      currentMetrics: this.currentMetrics,
    };
  }

  /**
   * Starts screen capture using getDisplayMedia with tab audio capture.
   * Sharer publishes stream over WebRTC (Mesh or SFU based on viewer count).
   */
  public async startScreenShare(opts?: {
    title?: string;
    hasAudio?: boolean;
    forceTransport?: ScreenShareTransportMode;
  }): Promise<MediaStream> {
    if (!this.canShare()) {
      throw new Error("Security Violation: Only the room host or approved members are authorized to share screen");
    }

    const hasAudio = opts?.hasAudio ?? true;
    const title = opts?.title || `${this.options.localUserName}'s Screen`;

    // 1. Capture user screen with tab/system audio capture
    let stream: MediaStream;
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getDisplayMedia) {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            displaySurface: "monitor",
          } as any,
          audio: hasAudio
            ? {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              }
            : false,
        });
      } catch (err: any) {
        // If audio capture fails (e.g. user selected window without audio support), fallback to video only
        if (hasAudio) {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        } else {
          throw err;
        }
      }
    } else {
      // Test/headless fallback stream mock
      stream = this.createMockMediaStream();
    }

    this.localStream = stream;
    this.isSharing = true;

    // 2. Determine transport mode (Mesh for <10 viewers, SFU for 10+)
    const viewerCount = this.options.getMemberCount();
    const transportMode: ScreenShareTransportMode =
      opts?.forceTransport || (viewerCount >= 10 ? "sfu" : "mesh");

    // 3. Instantiate transport
    this.transport = this.createTransport(transportMode, true);

    // 4. Publish stream & attach to local adapter (muted locally to prevent acoustic feedback)
    this.adapter.setMediaStream(stream, true);
    await this.transport.publishStream(stream);
    await this.transport.setBitrate(BITRATE_PRESET_MAP[this.bitratePreset]);

    // 5. Handle native browser "Stop sharing" bar click or track end
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener("ended", () => {
        if (this.isSharing) {
          this.stopScreenShare("user_stopped_browser_capture");
        }
      });
    }

    // 6. Notify room server
    this.options.sendMessage({
      type: "SCREEN_SHARE_START",
      payload: {
        title,
        hasAudio: stream.getAudioTracks().length > 0,
      },
    });

    this.startMetricsReporting();
    this.notifyState();
    return stream;
  }

  /**
   * Reshares screen or switches window/tab without leaving the room session.
   */
  public async reshare(): Promise<MediaStream> {
    const prevTitle = this.activeSession?.title;
    this.cleanupCurrentTransport();
    return await this.startScreenShare({ title: prevTitle });
  }

  /**
   * Stops screen sharing and releases media streams.
   */
  public stopScreenShare(reason?: string): void {
    if (!this.isSharing && !this.activeSession) return;

    this.isSharing = false;
    this.cleanupCurrentTransport();
    this.options.audioManager?.detachRemoteScreenShareAudio();

    this.options.sendMessage({
      type: "SCREEN_SHARE_STOP",
      payload: {
        reason: reason || "user_stopped",
      },
    });

    this.activeSession = null;
    this.notifyState();
  }

  /**
   * Dynamically adapts the video bitrate (High: 3.0 Mbps, Medium: 1.5 Mbps, Low: 500 kbps).
   */
  public async setBitratePreset(preset: BitratePreset): Promise<void> {
    this.bitratePreset = preset;
    const bps = BITRATE_PRESET_MAP[preset];
    if (this.transport) {
      await this.transport.setBitrate(bps);
    }
    this.notifyState();
  }

  /**
   * Host approves a member to share screen.
   */
  public grantPermission(targetUserId: string): void {
    this.options.sendMessage({
      type: "ROOM_SCREEN_SHARE_PERMIT",
      payload: { targetUserId },
    });
  }

  /**
   * Host revokes a member's screen sharing permission.
   */
  public revokePermission(targetUserId: string): void {
    this.options.sendMessage({
      type: "ROOM_SCREEN_SHARE_REVOKE",
      payload: { targetUserId },
    });
  }

  /**
   * Processes incoming server events related to screen sharing.
   */
  public async handleServerMessage(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "SCREEN_SHARE_STARTED": {
        const session = message.payload;
        this.activeSession = session;

        // If another member is sharing, initialize viewer subscription
        if (session.sharerUserId !== this.options.localUserId) {
          this.isSharing = false;
          this.cleanupCurrentTransport();

          this.transport = this.createTransport(session.transportMode, false, session.sharerUserId);
          this.transport.onRemoteStream((remoteStream) => {
            this.adapter.setMediaStream(remoteStream, false);
            this.options.audioManager?.attachRemoteScreenShareAudio(remoteStream);
          });
          await this.transport.subscribeStream();
          this.startMetricsReporting();
        }
        this.notifyState();
        break;
      }

      case "SCREEN_SHARE_STOPPED": {
        this.activeSession = null;
        this.options.audioManager?.detachRemoteScreenShareAudio();
        if (!this.isSharing) {
          this.cleanupCurrentTransport();
        }
        this.isSharing = false;
        this.notifyState();
        break;
      }

      case "SCREEN_SHARE_PERMISSION_GRANTED": {
        if (message.payload.targetUserId === this.options.localUserId) {
          this.isApproved = true;
          this.notifyState();
        }
        break;
      }

      case "SCREEN_SHARE_PERMISSION_REVOKED": {
        if (message.payload.targetUserId === this.options.localUserId) {
          this.isApproved = this.options.isHost;
          if (this.isSharing) {
            this.stopScreenShare("permission_revoked");
          }
          this.notifyState();
        }
        break;
      }

      case "WEBRTC_SIGNAL": {
        if (this.transport) {
          await this.transport.handleSignalingMessage(
            message.payload.fromUserId,
            message.payload.signalType,
            message.payload.signalData
          );
        }
        break;
      }

      case "SCREEN_SHARE_METRICS_BROADCAST": {
        // Server fanout of room viewer latency stats
        if (this.options.syncHealthMonitor && message.payload) {
          // Feed viewer stats to sync health panel
        }
        break;
      }
    }
  }

  private createTransport(
    mode: ScreenShareTransportMode,
    isPublisher: boolean,
    sharerUserId?: string
  ): ScreenShareTransport {
    if (mode === "sfu") {
      return new SfuScreenShareTransport({
        localUserId: this.options.localUserId,
        isPublisher,
        sendSignal: (targetUserId, signalType, signalData) => {
          this.options.sendMessage({
            type: "WEBRTC_SIGNAL",
            payload: {
              targetUserId,
              signalType,
              signalData,
              screenShareSessionId: this.activeSession?.sharerUserId,
            },
          });
        },
      });
    }

    return new MeshScreenShareTransport({
      localUserId: this.options.localUserId,
      isPublisher,
      sharerUserId: sharerUserId || this.activeSession?.sharerUserId,
      peerUserIds: this.options.getMemberIds(),
      sendSignal: (targetUserId, signalType, signalData) => {
        this.options.sendMessage({
          type: "WEBRTC_SIGNAL",
          payload: {
            targetUserId,
            signalType,
            signalData,
            screenShareSessionId: this.activeSession?.sharerUserId,
          },
        });
      },
    });
  }

  private startMetricsReporting(): void {
    this.stopMetricsReporting();
    this.metricsReportInterval = setInterval(async () => {
      if (!this.transport) return;
      const stats = await this.transport.getStats();
      if (stats) {
        this.currentMetrics = stats;
        for (const fn of this.metricsListeners) fn(stats);

        // Send metrics report to server
        this.options.sendMessage({
          type: "SCREEN_SHARE_METRICS_REPORT",
          payload: stats,
        });

        // Update SyncHealthMonitor
        if (this.options.syncHealthMonitor) {
          // In screen share mode, sharer is clock: drift is keeping everyone near the live edge
          const summary = this.options.syncHealthMonitor.getSummary();
          summary.averageRttMs = stats.rttMs;
          summary.p50DriftMs = stats.liveDelayMs;
          summary.p95DriftMs = stats.liveDelayMs + stats.jitterMs * 2;
          this.options.syncHealthMonitor.handleServerBroadcast(summary);
        }
      }
    }, 2000);
  }

  private stopMetricsReporting(): void {
    if (this.metricsReportInterval) {
      clearInterval(this.metricsReportInterval);
      this.metricsReportInterval = null;
    }
  }

  private cleanupCurrentTransport(): void {
    this.stopMetricsReporting();
    if (this.localStream) {
      for (const t of this.localStream.getTracks()) {
        try {
          t.stop();
        } catch {}
      }
      this.localStream = null;
    }
    if (this.transport) {
      this.transport.destroy();
      this.transport = null;
    }
    this.adapter.stopExistingStream();
  }

  private createMockMediaStream(): MediaStream {
    if (typeof MediaStream !== "undefined") {
      try {
        return new MediaStream();
      } catch {}
    }
    return {
      id: "mock_screenshare_stream",
      active: true,
      getTracks: () => [
        {
          id: "mock_video_track",
          kind: "video",
          enabled: true,
          stop: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
        } as any,
      ],
      getVideoTracks: () => [
        {
          id: "mock_video_track",
          kind: "video",
          enabled: true,
          stop: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
        } as any,
      ],
      getAudioTracks: () => [],
      addTrack: () => {},
      removeTrack: () => {},
    } as any;
  }

  public onStateChange(listener: (state: ScreenShareState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.getState());
    return () => this.stateListeners.delete(listener);
  }

  public onMetrics(listener: (metrics: ScreenShareMetrics) => void): () => void {
    this.metricsListeners.add(listener);
    if (this.currentMetrics) listener(this.currentMetrics);
    return () => this.metricsListeners.delete(listener);
  }

  private notifyState(): void {
    const state = this.getState();
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  public destroy(): void {
    this.stopScreenShare("destroyed");
    this.cleanupCurrentTransport();
    this.stateListeners.clear();
    this.metricsListeners.clear();
  }
}
