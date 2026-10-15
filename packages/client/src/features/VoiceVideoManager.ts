import {
  ParticipantMediaState,
  MediaTokenResponse,
  ClientMessage,
  VoiceStateUpdatePayload,
} from "@watchparty/shared";
import { CoWatchAudioManager } from "./CoWatchAudioManager.js";

export type MediaDeviceKind = "audioinput" | "videoinput" | "audiooutput";

export interface MediaDeviceInfoSimple {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

export type NetworkQualityTier = "good" | "poor" | "audio-only";
export type LayoutMode = "theater" | "grid";

export interface VoiceVideoState {
  inVoice: boolean;
  audioMuted: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  isSpeaking: boolean;
  pushToTalkEnabled: boolean;
  pttActive: boolean;
  videoDisabledForRoom: boolean;
  selectedMicId: string;
  selectedCameraId: string;
  selectedSpeakerId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  networkQuality: NetworkQualityTier;
  layoutMode: LayoutMode;
  floatingStripCollapsed: boolean;
  floatingStripPip: boolean;
  participants: ParticipantMediaState[];
  remoteVolumes: Record<string, number>; // userId -> volume multiplier (0.0 to 2.0)
}

export interface VoiceVideoError {
  type: "permission_denied" | "device_in_use" | "not_found" | "room_video_disabled" | "network" | "unknown";
  message: string;
  originalError?: any;
}

export interface VoiceVideoManagerOptions {
  localUserId: string;
  localUserName: string;
  roomCode: string;
  isHost?: boolean;
  apiBaseUrl?: string;
  getAuthToken?: () => string | null;
  sendMessage: (msg: ClientMessage) => void;
  onStateChange?: (state: VoiceVideoState) => void;
  onError?: (error: VoiceVideoError) => void;
  onLocalStream?: (stream: MediaStream | null) => void;
  onRemoteStream?: (userId: string, stream: MediaStream | null) => void;
  audioManager?: CoWatchAudioManager;
}

export class VoiceVideoManager {
  private readonly options: VoiceVideoManagerOptions;
  private state: VoiceVideoState;

  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private audioLevelCheckInterval: any = null;

  private remoteAudioElements: Map<string, HTMLAudioElement> = new Map();
  private tokenData: MediaTokenResponse | null = null;
  private isDestroyed = false;
  private readonly audioManager: CoWatchAudioManager;
  private blockedUserIds: Set<string> = new Set();

  constructor(options: VoiceVideoManagerOptions) {
    this.options = options;

    this.audioManager =
      options.audioManager ||
      new CoWatchAudioManager({
        onRequestPushToTalk: () => {
          this.setPushToTalk(true);
        },
        onQuietModeChange: (isQuiet) => {
          if (isQuiet && !this.state.audioMuted) {
            this.setMute(true);
          }
        },
      });

    // Load persisted volume map from localStorage if available
    const savedVolumes = this.loadPersistedVolumes();

    this.state = {
      inVoice: false,
      audioMuted: false,
      videoEnabled: false,
      screenSharing: false,
      isSpeaking: false,
      pushToTalkEnabled: false,
      pttActive: false,
      videoDisabledForRoom: false,
      selectedMicId: "default",
      selectedCameraId: "default",
      selectedSpeakerId: "default",
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      networkQuality: "good",
      layoutMode: "theater",
      floatingStripCollapsed: false,
      floatingStripPip: false,
      participants: [],
      remoteVolumes: savedVolumes,
    };
  }

  public getState(): VoiceVideoState {
    return { ...this.state, participants: [...this.state.participants] };
  }

  public getAudioManager(): CoWatchAudioManager {
    return this.audioManager;
  }

  public async enumerateDevices(): Promise<MediaDeviceInfoSimple[]> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.map((d) => ({
      deviceId: d.deviceId,
      label: d.label,
      kind: d.kind as MediaDeviceKind,
    }));
  }

  private notifyState(): void {
    if (this.isDestroyed) return;
    this.options.onStateChange?.(this.getState());
  }

  private emitError(error: VoiceVideoError): void {
    this.options.onError?.(error);
  }

  /**
   * Request LiveKit/SFU media token and ICE servers from backend
   */
  public async fetchMediaToken(): Promise<MediaTokenResponse> {
    const baseUrl = this.options.apiBaseUrl || "";
    const token = this.options.getAuthToken ? this.options.getAuthToken() : null;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const resp = await fetch(`${baseUrl}/api/media/token`, {
        method: "POST",
        headers,
        body: JSON.stringify({ roomCode: this.options.roomCode }),
      });

      if (!resp.ok) {
        throw new Error(`Media token request failed with HTTP ${resp.status}`);
      }

      const data: MediaTokenResponse = await resp.json();
      this.tokenData = data;
      if (typeof data.videoDisabledForRoom === "boolean") {
        this.state.videoDisabledForRoom = data.videoDisabledForRoom;
      }
      return data;
    } catch (err: any) {
      // Fallback for offline or test environments
      const fallback: MediaTokenResponse = {
        success: true,
        provider: "mock",
        serverUrl: "mock://sfu",
        token: `mock-token-${Date.now()}`,
        identity: this.options.localUserId,
        roomName: this.options.roomCode,
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        expiresAt: Date.now() + 3600_000,
        permissions: {
          canPublishAudio: true,
          canPublishVideo: !this.state.videoDisabledForRoom,
          canPublishScreen: true,
          canSubscribe: true,
        },
        videoDisabledForRoom: this.state.videoDisabledForRoom,
      };
      this.tokenData = fallback;
      return fallback;
    }
  }

  /**
   * Join real-time voice channel
   */
  public async joinVoice(withVideo = false): Promise<void> {
    if (this.state.inVoice) return;

    try {
      await this.fetchMediaToken();

      if (withVideo && this.state.videoDisabledForRoom) {
        this.emitError({
          type: "room_video_disabled",
          message: "Video has been disabled for this room by a moderator.",
        });
        withVideo = false;
      }

      // Acquire media streams with configured constraints
      await this.acquireUserMedia(true, withVideo);

      this.state.inVoice = true;
      this.state.audioMuted = this.state.pushToTalkEnabled;
      if (this.state.audioMuted && this.localStream) {
        this.localStream.getAudioTracks().forEach((t) => {
          t.enabled = false;
        });
      }
      this.state.videoEnabled = withVideo;

      // Start active speaker monitoring
      this.startAudioAnalyser();

      // Broadcast voice state update to WebSocket gateway
      this.broadcastVoiceState();

      this.notifyState();
    } catch (err: any) {
      this.handleMediaError(err);
      throw err;
    }
  }

  /**
   * Leave real-time voice channel
   */
  public leaveVoice(): void {
    if (!this.state.inVoice) return;

    this.stopAudioAnalyser();
    this.stopMediaStream();

    this.state.inVoice = false;
    this.state.audioMuted = false;
    this.state.videoEnabled = false;
    this.state.isSpeaking = false;
    this.state.pttActive = false;

    this.broadcastVoiceState();
    this.notifyState();
  }

  /**
   * Toggle mute status or set explicitly
   */
  public toggleMute(): void {
    if (!this.state.inVoice) return;
    this.setMute(!this.state.audioMuted);
  }

  public setMute(muted: boolean): void {
    if (!this.state.inVoice) return;

    this.state.audioMuted = muted;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !muted;
      }
    }

    if (muted) {
      this.state.isSpeaking = false;
    }

    this.broadcastVoiceState();
    this.notifyState();
  }

  /**
   * Toggle camera or set explicitly
   */
  public async toggleVideo(): Promise<void> {
    if (!this.state.inVoice) return;
    await this.setVideo(!this.state.videoEnabled);
  }

  public async setVideo(enabled: boolean): Promise<void> {
    if (!this.state.inVoice) return;

    if (enabled && this.state.videoDisabledForRoom) {
      this.emitError({
        type: "room_video_disabled",
        message: "Video has been disabled for this room by a moderator.",
      });
      return;
    }

    try {
      if (enabled) {
        await this.acquireUserMedia(true, true);
        this.state.videoEnabled = true;
      } else {
        if (this.localStream) {
          for (const track of this.localStream.getVideoTracks()) {
            track.stop();
            this.localStream.removeTrack(track);
          }
        }
        this.state.videoEnabled = false;
        this.options.onLocalStream?.(this.localStream);
      }

      this.broadcastVoiceState();
      this.notifyState();
    } catch (err: any) {
      this.handleMediaError(err);
    }
  }

  /**
   * Push-to-Talk controls
   */
  public setPushToTalk(enabled: boolean): void {
    this.state.pushToTalkEnabled = enabled;
    if (enabled) {
      // When PTT is enabled, start in muted state
      this.setMute(true);
    }
    this.notifyState();
  }

  public handlePttKeyDown(): void {
    if (!this.state.pushToTalkEnabled || !this.state.inVoice) return;
    if (this.state.pttActive) return;

    this.state.pttActive = true;
    this.setMute(false);
  }

  public handlePttKeyUp(): void {
    if (!this.state.pushToTalkEnabled || !this.state.inVoice) return;
    if (!this.state.pttActive) return;

    this.state.pttActive = false;
    this.setMute(true);
  }

  public setPttActive(active: boolean): void {
    if (active) {
      this.handlePttKeyDown();
    } else {
      this.handlePttKeyUp();
    }
  }

  /**
   * Device selection & Audio constraint adjustments
   */
  public async selectDevice(kind: MediaDeviceKind, deviceId: string): Promise<void> {
    if (kind === "audioinput") {
      this.state.selectedMicId = deviceId;
    } else if (kind === "videoinput") {
      this.state.selectedCameraId = deviceId;
    } else if (kind === "audiooutput") {
      this.state.selectedSpeakerId = deviceId;
      this.applySpeakerOutput(deviceId);
    }

    if (this.state.inVoice) {
      // Re-acquire media stream with updated deviceId
      await this.acquireUserMedia(true, this.state.videoEnabled);
    }
    this.notifyState();
  }

  public async setAudioProcessing(constraints: {
    noiseSuppression?: boolean;
    echoCancellation?: boolean;
    autoGainControl?: boolean;
  }): Promise<void> {
    if (constraints.noiseSuppression !== undefined) {
      this.state.noiseSuppression = constraints.noiseSuppression;
    }
    if (constraints.echoCancellation !== undefined) {
      this.state.echoCancellation = constraints.echoCancellation;
    }
    if (constraints.autoGainControl !== undefined) {
      this.state.autoGainControl = constraints.autoGainControl;
    }

    if (this.state.inVoice) {
      await this.acquireUserMedia(true, this.state.videoEnabled);
    }
    this.notifyState();
  }

  /**
   * Per-person volume sliders (0.0 to 2.0 multiplier)
   */
  public setParticipantVolume(userId: string, volume: number): void {
    const clamped = Math.max(0, Math.min(2, volume));
    this.state.remoteVolumes[userId] = clamped;

    const audioEl = this.remoteAudioElements.get(userId);
    if (audioEl) {
      audioEl.volume = Math.min(1, clamped);
      this.audioManager.registerRemoteAudioElement(userId, audioEl);
    }

    this.savePersistedVolumes();
    this.notifyState();
  }

  public attachRemoteAudioElement(userId: string, audioEl: HTMLAudioElement): void {
    this.remoteAudioElements.set(userId, audioEl);
    if (this.isUserBlocked(userId)) {
      audioEl.muted = true;
      audioEl.volume = 0;
      try { audioEl.pause(); } catch {}
      return;
    }
    this.audioManager.registerRemoteAudioElement(userId, audioEl);
  }

  public setBlockedUserIds(userIds: string[]): void {
    this.blockedUserIds = new Set(userIds);
    for (const userId of userIds) {
      const audioEl = this.remoteAudioElements.get(userId);
      if (audioEl) {
        audioEl.muted = true;
        audioEl.volume = 0;
        try { audioEl.pause(); } catch {}
      }
    }
    this.notifyState();
  }

  public blockUser(userId: string): void {
    this.blockedUserIds.add(userId);
    const audioEl = this.remoteAudioElements.get(userId);
    if (audioEl) {
      audioEl.muted = true;
      audioEl.volume = 0;
      try { audioEl.pause(); } catch {}
    }
    this.notifyState();
  }

  public unblockUser(userId: string): void {
    this.blockedUserIds.delete(userId);
    const audioEl = this.remoteAudioElements.get(userId);
    if (audioEl) {
      audioEl.muted = false;
      const vol = this.getParticipantVolume(userId);
      audioEl.volume = Math.min(1, vol);
    }
    this.notifyState();
  }

  public isUserBlocked(userId: string): boolean {
    return this.blockedUserIds.has(userId);
  }

  public handleRemoteStream(userId: string, stream: MediaStream | null): void {
    if (this.isUserBlocked(userId)) {
      return;
    }
    this.options.onRemoteStream?.(userId, stream);
  }

  public getParticipantVolume(userId: string): number {
    if (this.isUserBlocked(userId)) return 0;
    return this.state.remoteVolumes[userId] ?? 1.0;
  }

  /**
   * Layout & UI Mode Switching
   */
  public setLayoutMode(mode: LayoutMode): void {
    this.state.layoutMode = mode;
    this.notifyState();
  }

  public toggleFloatingStrip(collapsed?: boolean): void {
    this.state.floatingStripCollapsed =
      collapsed !== undefined ? collapsed : !this.state.floatingStripCollapsed;
    this.notifyState();
  }

  public setPipMode(enabled: boolean): void {
    this.state.floatingStripPip = enabled;
    this.notifyState();
  }

  public toggleFloatingStripCollapsed(): void {
    this.toggleFloatingStrip();
  }

  public toggleFloatingStripPip(): void {
    this.setPipMode(!this.state.floatingStripPip);
  }

  /**
   * Adaptive Quality / Network degradation handlers
   */
  public setNetworkQuality(tier: NetworkQualityTier): void {
    if (this.state.networkQuality === tier) return;
    this.state.networkQuality = tier;

    if (tier === "audio-only" && this.state.videoEnabled) {
      // Automatically disable camera on weak connections to maintain audio sync
      this.setVideo(false);
    }

    this.notifyState();
  }

  /**
   * Host / Moderator Controls
   */
  public moderatorMuteParticipant(targetUserId: string, muteAudio = true, muteVideo = false): void {
    this.options.sendMessage({
      type: "ROOM_MOD_MUTE_VOICE",
      clientSeq: Date.now(),
      payload: { targetUserId, muteAudio, muteVideo },
    });
  }

  public moderatorMuteVoice(targetUserId: string, muteAudio = true, muteVideo = false): void {
    this.moderatorMuteParticipant(targetUserId, muteAudio, muteVideo);
  }

  public moderatorRemoveParticipant(targetUserId: string): void {
    this.options.sendMessage({
      type: "ROOM_MOD_REMOVE_VOICE",
      clientSeq: Date.now(),
      payload: { targetUserId },
    });
  }

  public moderatorRemoveVoice(targetUserId: string): void {
    this.moderatorRemoveParticipant(targetUserId);
  }

  public moderatorDisableRoomVideo(disabled: boolean): void {
    this.options.sendMessage({
      type: "ROOM_MOD_DISABLE_ROOM_VIDEO",
      clientSeq: Date.now(),
      payload: { disabled },
    });
  }

  public handleServerVoiceStateUpdated(
    participants?: ParticipantMediaState[],
    videoDisabledForRoom?: boolean
  ): void {
    this.syncFromRoomSnapshot(participants, videoDisabledForRoom);
  }

  /**
   * Handle server synchronization events from WebSocket
   */
  public syncFromRoomSnapshot(
    participants?: ParticipantMediaState[],
    videoDisabledForRoom?: boolean
  ): void {
    let changed = false;

    if (typeof videoDisabledForRoom === "boolean" && this.state.videoDisabledForRoom !== videoDisabledForRoom) {
      this.state.videoDisabledForRoom = videoDisabledForRoom;
      changed = true;
      if (videoDisabledForRoom && this.state.videoEnabled) {
        this.setVideo(false);
      }
    }

    if (participants) {
      this.state.participants = [...participants];
      changed = true;

      // Check if local user was server-muted or removed
      const me = participants.find((p) => p.userId === this.options.localUserId);
      if (me) {
        if (!me.inVoice && this.state.inVoice) {
          // Local user was removed from voice by host
          this.leaveVoice();
          return;
        }
        if (me.audioMuted && !this.state.audioMuted) {
          // Local user was muted by host
          this.setMute(true);
        }
        if (!me.videoEnabled && this.state.videoEnabled) {
          // Local user video was disabled
          this.setVideo(false);
        }
      }
    }

    if (changed) {
      this.updateSpeakingDuckingState();
      this.notifyState();
    }
  }

  /**
   * Internal Media Stream Management
   */
  private async acquireUserMedia(needAudio: boolean, needVideo: boolean): Promise<MediaStream | null> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return null;
    }

    const audioConstraints: boolean | MediaTrackConstraints = needAudio
      ? {
          deviceId:
            this.state.selectedMicId !== "default"
              ? { exact: this.state.selectedMicId }
              : undefined,
          echoCancellation: this.state.echoCancellation,
          noiseSuppression: this.state.noiseSuppression,
          autoGainControl: this.state.autoGainControl,
        }
      : false;

    const videoConstraints: boolean | MediaTrackConstraints = needVideo
      ? {
          deviceId:
            this.state.selectedCameraId !== "default"
              ? { exact: this.state.selectedCameraId }
              : undefined,
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 24 },
        }
      : false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: videoConstraints,
      });

      this.stopMediaStream();
      this.localStream = stream;
      this.audioManager.attachMicStream(stream);

      // Honor current mute state
      if (this.state.audioMuted) {
        for (const t of stream.getAudioTracks()) {
          t.enabled = false;
        }
      }

      this.options.onLocalStream?.(stream);
      return stream;
    } catch (err: any) {
      this.handleMediaError(err);
      throw err;
    }
  }

  private stopMediaStream(): void {
    this.audioManager.detachMicStream();
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
      this.options.onLocalStream?.(null);
    }
  }

  private handleMediaError(err: any): void {
    const errName = err?.name || "";
    if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
      this.emitError({
        type: "permission_denied",
        message: "Microphone/Camera permission denied. Please enable camera and microphone permissions in browser settings.",
        originalError: err,
      });
    } else if (errName === "NotReadableError" || errName === "TrackStartError") {
      this.emitError({
        type: "device_in_use",
        message: "Your microphone or camera is already in use by another application. Please close other video apps and retry.",
        originalError: err,
      });
    } else if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
      this.emitError({
        type: "not_found",
        message: "Requested media device was not found on your system.",
        originalError: err,
      });
    } else {
      this.emitError({
        type: "unknown",
        message: err?.message || "An unexpected media error occurred.",
        originalError: err,
      });
    }
  }

  /**
   * Web Audio API Active-Speaker Analyser
   */
  private startAudioAnalyser(): void {
    if (typeof window === "undefined" || !this.localStream) return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      this.audioContext = new AudioContextClass();
      const source = this.audioContext.createMediaStreamSource(this.localStream);
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.4;
      source.connect(this.analyserNode);

      const buffer = new Uint8Array(this.analyserNode.frequencyBinCount);

      this.audioLevelCheckInterval = setInterval(() => {
        if (!this.analyserNode || this.state.audioMuted || !this.state.inVoice) {
          if (this.state.isSpeaking) {
            this.state.isSpeaking = false;
            this.notifyState();
          }
          return;
        }

        this.analyserNode.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        const avg = sum / buffer.length; // 0 to 255
        const isSpeaking = avg > 20;

        if (this.state.isSpeaking !== isSpeaking) {
          this.state.isSpeaking = isSpeaking;
          this.updateSpeakingDuckingState();
          this.notifyState();
        }
      }, 100);
    } catch {
      // AudioContext failure gracefully degraded
    }
  }

  private stopAudioAnalyser(): void {
    if (this.audioLevelCheckInterval) {
      clearInterval(this.audioLevelCheckInterval);
      this.audioLevelCheckInterval = null;
    }
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }
    this.analyserNode = null;
  }

  private applySpeakerOutput(deviceId: string): void {
    for (const audioEl of this.remoteAudioElements.values()) {
      if (typeof (audioEl as any).setSinkId === "function") {
        (audioEl as any).setSinkId(deviceId).catch(() => {});
      }
    }
  }

  private broadcastVoiceState(): void {
    const payload: VoiceStateUpdatePayload = {
      inVoice: this.state.inVoice,
      audioMuted: this.state.audioMuted,
      videoEnabled: this.state.videoEnabled,
      screenSharing: this.state.screenSharing,
    };

    this.options.sendMessage({
      type: "VOICE_STATE_UPDATE",
      clientSeq: Date.now(),
      payload,
    });
  }

  private loadPersistedVolumes(): Record<string, number> {
    try {
      if (typeof localStorage !== "undefined") {
        const stored = localStorage.getItem("watchparty_voice_volumes");
        if (stored) return JSON.parse(stored);
      }
    } catch {}
    return {};
  }

  private savePersistedVolumes(): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          "watchparty_voice_volumes",
          JSON.stringify(this.state.remoteVolumes)
        );
      }
    } catch {}
  }

  private updateSpeakingDuckingState(): void {
    const isMeSpeaking = this.state.isSpeaking && !this.state.audioMuted;
    const isAnyRemoteSpeaking = this.state.participants.some(
      (p) => p.userId !== this.options.localUserId && p.inVoice && !p.audioMuted
    );
    this.audioManager.notifySpeakingChange(isMeSpeaking || isAnyRemoteSpeaking);
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.leaveVoice();
    this.audioManager.destroy();
    this.remoteAudioElements.clear();
  }
}
