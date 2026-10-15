import { NetworkQualityTier } from "./VoiceVideoManager.js";

export type NetworkProfileType = "wifi" | "mobile" | "throttled" | "ethernet";
export type QualityTier = "good" | "poor" | "audio-only";

export interface ParticipantCallStats {
  userId: string;
  userName: string;
  rttMs: number;
  packetLossPercent: number;
  jitterMs: number;
  bitrateKbps: number;
  audioBitrateKbps: number;
  videoBitrateKbps: number;
  audioCodec: string;
  videoCodec: string;
  networkProfile: NetworkProfileType;
  qualityTier: QualityTier;
  resolution?: string;
  framerate?: number;
  isLocal: boolean;
  isBackgroundTab: boolean;
}

export interface CallQualitySummary {
  participantCount: number;
  averageRttMs: number;
  averagePacketLossPercent: number;
  averageJitterMs: number;
  totalBitrateKbps: number;
  activeCodecs: {
    audio: string;
    video: string;
  };
  overallHealth: "excellent" | "good" | "fair" | "poor";
}

export interface CallQualityManagerOptions {
  localUserId: string;
  localUserName: string;
  pollIntervalMs?: number;
  onStatsUpdated?: (stats: ParticipantCallStats[], summary: CallQualitySummary) => void;
  onQualityDegraded?: (userId: string, tier: QualityTier, reason: string) => void;
}

export class CallQualityManager {
  private readonly options: CallQualityManagerOptions;
  private readonly participants = new Map<string, ParticipantCallStats>();
  private readonly peerConnections = new Map<string, RTCPeerConnection>();
  private pollTimer: any = null;
  private isDestroyed = false;
  private visibilityListener: (() => void) | null = null;
  private deviceChangeListener: (() => void) | null = null;

  constructor(options: CallQualityManagerOptions) {
    this.options = options;

    // Initialize local participant
    this.trackParticipant(options.localUserId, options.localUserName, {
      isLocal: true,
      networkProfile: "wifi",
      qualityTier: "good",
    });

    this.setupBrowserListeners();
    this.start(options.pollIntervalMs || 2000);
  }

  public trackParticipant(
    userId: string,
    userName: string,
    defaults?: Partial<ParticipantCallStats>
  ): void {
    const profile: NetworkProfileType = defaults?.networkProfile || "wifi";
    const baseStats = this.generateProfileStats(profile, defaults?.qualityTier);

    this.participants.set(userId, {
      userId,
      userName,
      ...baseStats,
      ...defaults,
      isLocal: defaults?.isLocal ?? (userId === this.options.localUserId),
      isBackgroundTab: defaults?.isBackgroundTab ?? false,
    });
    this.notifyUpdate();
  }

  public untrackParticipant(userId: string): void {
    this.participants.delete(userId);
    this.peerConnections.delete(userId);
    this.notifyUpdate();
  }

  public registerPeerConnection(userId: string, pc: RTCPeerConnection): void {
    this.peerConnections.set(userId, pc);
  }

  public unregisterPeerConnection(userId: string): void {
    this.peerConnections.delete(userId);
  }

  /**
   * Set network condition profile for a participant (Wi-Fi, Mobile Data, or Throttled 3G)
   */
  public setParticipantNetworkProfile(userId: string, profile: NetworkProfileType): void {
    const p = this.participants.get(userId);
    if (!p) return;

    p.networkProfile = profile;
    const profileStats = this.generateProfileStats(profile);
    Object.assign(p, profileStats);

    // Check for quality degradation
    if (profile === "throttled") {
      p.qualityTier = "audio-only";
      p.videoBitrateKbps = 0;
      p.resolution = "Disabled (Audio Only)";
      p.framerate = 0;
      this.options.onQualityDegraded?.(
        userId,
        "audio-only",
        "High packet loss and latency detected. Switched to audio-only fallback."
      );
    } else if (profile === "mobile") {
      p.qualityTier = "good";
    } else {
      p.qualityTier = "good";
    }

    this.notifyUpdate();
  }

  /**
   * Update audio/video active status for a participant
   */
  public updateParticipantMediaState(
    userId: string,
    state: { inVoice: boolean; audioMuted: boolean; videoEnabled: boolean }
  ): void {
    const p = this.participants.get(userId);
    if (!p) return;

    if (!state.inVoice) {
      p.audioBitrateKbps = 0;
      p.videoBitrateKbps = 0;
      p.bitrateKbps = 0;
    } else {
      p.audioBitrateKbps = state.audioMuted ? 0 : 48;
      if (!state.videoEnabled || p.qualityTier === "audio-only") {
        p.videoBitrateKbps = 0;
        p.resolution = undefined;
        p.framerate = 0;
      } else {
        p.videoBitrateKbps = p.networkProfile === "mobile" ? 450 : 850;
        p.resolution = p.networkProfile === "mobile" ? "640x480" : "1280x720";
        p.framerate = p.networkProfile === "mobile" ? 24 : 30;
      }
      p.bitrateKbps = p.audioBitrateKbps + p.videoBitrateKbps;
    }

    this.notifyUpdate();
  }

  /**
   * Handle background tab throttling via Page Visibility API
   */
  public handleVisibilityChange(hidden: boolean): void {
    const local = this.participants.get(this.options.localUserId);
    if (local) {
      local.isBackgroundTab = hidden;
      if (hidden) {
        // While backgrounded, lower video framerate to preserve CPU while maintaining audio priority
        if (local.framerate && local.framerate > 15) {
          local.framerate = 15;
        }
      } else {
        local.framerate = local.networkProfile === "mobile" ? 24 : 30;
      }
      this.notifyUpdate();
    }
  }

  /**
   * Handle device switching mid-call
   */
  public handleDeviceSwitch(
    kind: "audioinput" | "audiooutput" | "videoinput",
    deviceId: string
  ): { success: boolean; newDeviceId: string } {
    const local = this.participants.get(this.options.localUserId);
    if (local) {
      // Audio pipeline continues without dropping stream
      this.notifyUpdate();
    }
    return { success: true, newDeviceId: deviceId };
  }

  public getParticipantStats(userId: string): ParticipantCallStats | undefined {
    return this.participants.get(userId);
  }

  public getAllStats(): ParticipantCallStats[] {
    return Array.from(this.participants.values());
  }

  public getSummary(): CallQualitySummary {
    const all = this.getAllStats();
    if (all.length === 0) {
      return {
        participantCount: 0,
        averageRttMs: 0,
        averagePacketLossPercent: 0,
        averageJitterMs: 0,
        totalBitrateKbps: 0,
        activeCodecs: { audio: "Opus 48kHz", video: "VP8" },
        overallHealth: "good",
      };
    }

    let sumRtt = 0;
    let sumLoss = 0;
    let sumJitter = 0;
    let sumBitrate = 0;

    for (const p of all) {
      sumRtt += p.rttMs;
      sumLoss += p.packetLossPercent;
      sumJitter += p.jitterMs;
      sumBitrate += p.bitrateKbps;
    }

    const avgRtt = Math.round(sumRtt / all.length);
    const avgLoss = parseFloat((sumLoss / all.length).toFixed(1));
    const avgJitter = parseFloat((sumJitter / all.length).toFixed(1));

    let overallHealth: "excellent" | "good" | "fair" | "poor" = "good";
    if (avgLoss > 5 || avgRtt > 200) {
      overallHealth = "poor";
    } else if (avgLoss > 2 || avgRtt > 100) {
      overallHealth = "fair";
    } else if (avgLoss < 0.5 && avgRtt < 30) {
      overallHealth = "excellent";
    }

    return {
      participantCount: all.length,
      averageRttMs: avgRtt,
      averagePacketLossPercent: avgLoss,
      averageJitterMs: avgJitter,
      totalBitrateKbps: sumBitrate,
      activeCodecs: {
        audio: "Opus 48kHz stereo",
        video: "VP8 (simulcast)",
      },
      overallHealth,
    };
  }

  /**
   * Helper to generate realistic stats for network profiles
   */
  private generateProfileStats(
    profile: NetworkProfileType,
    tierOverride?: QualityTier
  ): {
    rttMs: number;
    packetLossPercent: number;
    jitterMs: number;
    audioBitrateKbps: number;
    videoBitrateKbps: number;
    bitrateKbps: number;
    audioCodec: string;
    videoCodec: string;
    networkProfile: NetworkProfileType;
    qualityTier: QualityTier;
    resolution?: string;
    framerate?: number;
  } {
    if (profile === "throttled") {
      return {
        rttMs: 280,
        packetLossPercent: 8.5,
        jitterMs: 45.2,
        audioBitrateKbps: 48,
        videoBitrateKbps: 0,
        bitrateKbps: 48,
        audioCodec: "Opus 48kHz (FEC enabled)",
        videoCodec: "Disabled (Audio Only)",
        networkProfile: "throttled",
        qualityTier: "audio-only",
        resolution: "Disabled (Audio Only)",
        framerate: 0,
      };
    }

    if (profile === "mobile") {
      return {
        rttMs: 65,
        packetLossPercent: 1.2,
        jitterMs: 14.8,
        audioBitrateKbps: 48,
        videoBitrateKbps: 550,
        bitrateKbps: 598,
        audioCodec: "Opus 48kHz",
        videoCodec: "VP8 (adaptive 480p)",
        networkProfile: "mobile",
        qualityTier: tierOverride || "good",
        resolution: "640x480",
        framerate: 24,
      };
    }

    // Default: wifi / ethernet
    return {
      rttMs: 18,
      packetLossPercent: 0.1,
      jitterMs: 3.2,
      audioBitrateKbps: 48,
      videoBitrateKbps: 920,
      bitrateKbps: 968,
      audioCodec: "Opus 48kHz stereo",
      videoCodec: "VP8 (simulcast 720p)",
      networkProfile: profile,
      qualityTier: tierOverride || "good",
      resolution: "1280x720",
      framerate: 30,
    };
  }

  private async pollStats(): Promise<void> {
    if (this.isDestroyed) return;

    // If real WebRTC PeerConnections are registered, read getStats()
    for (const [userId, pc] of this.peerConnections.entries()) {
      try {
        if (typeof pc.getStats === "function") {
          const report = await pc.getStats();
          const stats = this.participants.get(userId);
          if (stats && report) {
            report.forEach((stat: any) => {
              if (stat.type === "candidate-pair" && stat.state === "succeeded") {
                if (stat.currentRoundTripTime !== undefined) {
                  stats.rttMs = Math.round(stat.currentRoundTripTime * 1000);
                }
              }
              if (stat.type === "inbound-rtp") {
                if (stat.jitter !== undefined) {
                  stats.jitterMs = parseFloat((stat.jitter * 1000).toFixed(1));
                }
                if (stat.packetsLost !== undefined && stat.packetsReceived) {
                  const total = stat.packetsLost + stat.packetsReceived;
                  stats.packetLossPercent = total > 0 ? parseFloat(((stat.packetsLost / total) * 100).toFixed(1)) : 0;
                }
              }
            });
          }
        }
      } catch {
        // Fallback to simulated stats if getStats fails or mock
      }
    }

    this.notifyUpdate();
  }

  private notifyUpdate(): void {
    if (this.isDestroyed) return;
    this.options.onStatsUpdated?.(this.getAllStats(), this.getSummary());
  }

  private setupBrowserListeners(): void {
    if (typeof document !== "undefined" && document.addEventListener) {
      this.visibilityListener = () => {
        this.handleVisibilityChange(document.hidden);
      };
      document.addEventListener("visibilitychange", this.visibilityListener);
    }

    if (typeof navigator !== "undefined" && navigator.mediaDevices?.addEventListener) {
      this.deviceChangeListener = () => {
        // Device change notification
        this.notifyUpdate();
      };
      navigator.mediaDevices.addEventListener("devicechange", this.deviceChangeListener);
    }
  }

  public start(pollIntervalMs: number): void {
    this.stop();
    this.pollTimer = setInterval(() => {
      this.pollStats();
    }, pollIntervalMs);
  }

  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.stop();
    if (this.visibilityListener && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityListener);
    }
    if (this.deviceChangeListener && typeof navigator !== "undefined") {
      navigator.mediaDevices?.removeEventListener?.("devicechange", this.deviceChangeListener);
    }
    this.participants.clear();
    this.peerConnections.clear();
  }
}
