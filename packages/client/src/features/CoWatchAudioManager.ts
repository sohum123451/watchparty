export interface AudioMixerSettings {
  movieVolume: number; // 0.0 to 1.5 (default 1.0)
  voiceVolume: number; // 0.0 to 2.0 (default 1.0)
  notificationVolume: number; // 0.0 to 1.0 (default 0.8)
  autoDuckingEnabled: boolean; // default true
  duckingAmountDb: number; // default -12 dB (range -6 to -30 dB)
  quietModeEnabled: boolean; // default false
}

export interface EchoDetectionDetails {
  correlation: number; // 0.0 to 1.0
  estimatedDelayMs: number;
  confidence: "low" | "medium" | "high";
  suggestAction: "headphones" | "push-to-talk";
}

export interface CoWatchAudioState extends AudioMixerSettings {
  isDucked: boolean;
  currentDuckingGain: number; // 1.0 normally, e.g. 0.2511 (-12dB) when ducked
  echoDetected: boolean;
  echoDetails: EchoDetectionDetails | null;
  audioContextState: "running" | "suspended" | "interrupted" | "closed" | "unsupported";
  isQuietModeActive: boolean;
  isHeadphonesConnected: boolean;
  mobileAudioUnlocked: boolean;
}

export interface CoWatchAudioManagerOptions {
  initialSettings?: Partial<AudioMixerSettings>;
  storageKey?: string;
  onStateChange?: (state: CoWatchAudioState) => void;
  onEchoDetected?: (details: EchoDetectionDetails) => void;
  onDuckingChange?: (isDucked: boolean, gainMultiplier: number) => void;
  onQuietModeChange?: (isActive: boolean) => void;
  onRequestPushToTalk?: () => void;
}

export type NotificationSoundType = "message" | "join" | "leave" | "reaction";

/**
 * CoWatchAudioManager
 *
 * Comprehensive client audio engine specifically engineered for watching and talking at the same time:
 * 1. Echo Detection: Continuous correlation analysis between movie output and mic input to prevent acoustic feedback loops.
 * 2. Auto-Ducking: Smooth Web Audio GainNode ducking (-12 dB default) during active speech with hold-release hangover.
 * 3. 3-Way Independent Volume Controls: Movie, Voices, and Notifications with persistent localStorage sync.
 * 4. Quiet Mode: Enforces push-to-talk / muted voice while the movie plays so casual noise doesn't disrupt scenes.
 * 5. Mobile Audio Lifecycle: Handles iOS user gesture unlock, audio session interruptions, Bluetooth device switches, and screen lock keepalive.
 * 6. Screen Share Audio Mixing: Mixes tab/system audio without local feedback loops.
 */
export class CoWatchAudioManager {
  private readonly options: CoWatchAudioManagerOptions;
  private readonly storageKey: string;

  private state: CoWatchAudioState;

  // Web Audio Context and Nodes
  private audioContext: AudioContext | null = null;
  private movieSourceNode: MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null = null;
  private movieDuckingGainNode: GainNode | null = null;
  private movieMasterGainNode: GainNode | null = null;
  private movieAnalyserNode: AnalyserNode | null = null;

  private micStreamSourceNode: MediaStreamAudioSourceNode | null = null;
  private micAnalyserNode: AnalyserNode | null = null;

  private screenShareAudioNode: MediaStreamAudioSourceNode | null = null;
  private screenShareGainNode: GainNode | null = null;

  // Attached media elements
  private movieMediaElement: HTMLMediaElement | null = null;
  private remoteAudioElements: Map<string, HTMLAudioElement> = new Map();
  private keepAliveAudioElement: HTMLAudioElement | null = null;

  // Auto-Ducking State & Timers
  private isAnyoneSpeaking = false;
  private duckingHoldTimeout: any = null;
  private isMoviePlaying = false;

  // Echo Detection Rolling Buffers
  private movieEnergyHistory: number[] = []; // rolling RMS energy samples (20ms intervals)
  private micEnergyHistory: number[] = [];
  private echoCorrelationCheckInterval: any = null;
  private consecutiveEchoDetections = 0;

  // Mobile Audio Session & Device Listeners
  private boundDeviceChangeListener: (() => void) | null = null;
  private boundVisibilityChangeListener: (() => void) | null = null;
  private boundTouchUnlockListener: (() => void) | null = null;
  private isDestroyed = false;

  constructor(options: CoWatchAudioManagerOptions = {}) {
    this.options = options;
    this.storageKey = options.storageKey || "watchparty_audio_mixer_settings";

    const persisted = this.loadPersistedSettings();
    const defaults: AudioMixerSettings = {
      movieVolume: 1.0,
      voiceVolume: 1.0,
      notificationVolume: 0.8,
      autoDuckingEnabled: true,
      duckingAmountDb: -12,
      quietModeEnabled: false,
    };

    const mergedSettings: AudioMixerSettings = {
      ...defaults,
      ...persisted,
      ...options.initialSettings,
    };

    this.state = {
      ...mergedSettings,
      isDucked: false,
      currentDuckingGain: 1.0,
      echoDetected: false,
      echoDetails: null,
      audioContextState: "unsupported",
      isQuietModeActive: false,
      isHeadphonesConnected: false,
      mobileAudioUnlocked: false,
    };

    this.initAudioContext();
    this.initMobileAudioHandlers();
    this.detectHeadphones();
  }

  public getState(): CoWatchAudioState {
    return { ...this.state };
  }

  private notifyState(): void {
    if (this.isDestroyed) return;
    this.options.onStateChange?.(this.getState());
  }

  /**
   * Initialize Web Audio Context with cross-browser compatibility
   */
  private initAudioContext(): void {
    if (typeof window === "undefined") return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      this.audioContext = new AudioContextClass();
      this.state.audioContextState = this.audioContext.state as any;

      this.audioContext.onstatechange = () => {
        if (!this.audioContext) return;
        this.state.audioContextState = this.audioContext.state as any;
        if (this.audioContext.state === "running") {
          this.state.mobileAudioUnlocked = true;
        }
        this.notifyState();
      };

      // Set up Movie Master & Ducking Gain Pipeline
      this.movieDuckingGainNode = this.audioContext.createGain();
      this.movieMasterGainNode = this.audioContext.createGain();
      this.movieAnalyserNode = this.audioContext.createAnalyser();

      this.movieAnalyserNode.fftSize = 128;
      this.movieDuckingGainNode.gain.setValueAtTime(1.0, this.audioContext.currentTime);
      this.movieMasterGainNode.gain.setValueAtTime(this.state.movieVolume, this.audioContext.currentTime);

      // Pipeline: movieDuckingGain -> movieMasterGain -> movieAnalyser -> destination
      this.movieDuckingGainNode.connect(this.movieMasterGainNode);
      this.movieMasterGainNode.connect(this.movieAnalyserNode);
      this.movieAnalyserNode.connect(this.audioContext.destination);

      // Screen share pipeline
      this.screenShareGainNode = this.audioContext.createGain();
      this.screenShareGainNode.gain.setValueAtTime(this.state.movieVolume, this.audioContext.currentTime);
      this.screenShareGainNode.connect(this.movieDuckingGainNode);
    } catch {
      this.state.audioContextState = "unsupported";
    }
  }

  /**
   * Mobile Audio Lifecycle & User Gesture Unlock
   */
  private initMobileAudioHandlers(): void {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    // 1. User gesture audio unlock for iOS Safari / Chrome Mobile
    const unlock = async () => {
      if (this.audioContext && this.audioContext.state === "suspended") {
        try {
          await this.audioContext.resume();
          this.state.mobileAudioUnlocked = true;
          this.state.audioContextState = "running";
          this.notifyState();
        } catch {}
      }
      this.removeUnlockListeners();
    };

    this.boundTouchUnlockListener = unlock;
    window.addEventListener("touchstart", unlock, { passive: true, once: true });
    window.addEventListener("click", unlock, { passive: true, once: true });
    window.addEventListener("keydown", unlock, { passive: true, once: true });

    // 2. Headset / Bluetooth device changes
    if (typeof navigator !== "undefined" && navigator.mediaDevices?.addEventListener) {
      this.boundDeviceChangeListener = () => {
        this.detectHeadphones();
      };
      navigator.mediaDevices.addEventListener("devicechange", this.boundDeviceChangeListener);
    }

    // 3. Document visibility change / background lock keepalive
    this.boundVisibilityChangeListener = () => {
      if (document.hidden) {
        // Tab went to background or screen locked
        this.ensureBackgroundAudioKeepAlive();
      } else {
        // Returned to foreground: verify audio context is active
        if (this.audioContext && this.audioContext.state === "suspended") {
          this.audioContext.resume().catch(() => {});
        }
      }
    };
    document.addEventListener("visibilitychange", this.boundVisibilityChangeListener);

    // 4. iOS / Safari Audio Session API (where supported)
    if (typeof navigator !== "undefined" && (navigator as any).audioSession) {
      try {
        (navigator as any).audioSession.type = "play-and-record";
      } catch {}
    }
  }

  private removeUnlockListeners(): void {
    if (typeof window === "undefined") return;
    if (this.boundTouchUnlockListener) {
      window.removeEventListener("touchstart", this.boundTouchUnlockListener);
      window.removeEventListener("click", this.boundTouchUnlockListener);
      window.removeEventListener("keydown", this.boundTouchUnlockListener);
      this.boundTouchUnlockListener = null;
    }
  }

  /**
   * Unlocks audio manually (e.g. from an explicit "Join Audio" button click)
   */
  public async unlockMobileAudio(): Promise<boolean> {
    if (!this.audioContext) return false;
    try {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      this.state.mobileAudioUnlocked = true;
      this.state.audioContextState = this.audioContext.state as any;
      this.notifyState();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Background audio keepalive for mobile screen locks
   */
  private ensureBackgroundAudioKeepAlive(): void {
    if (typeof document === "undefined") return;
    if (this.keepAliveAudioElement) return;

    try {
      // Create a 1-second silent looping audio element to maintain background audio session on iOS/Android
      const audio = document.createElement("audio");
      audio.setAttribute("playsinline", "true");
      audio.setAttribute("webkit-playsinline", "true");
      audio.loop = true;
      // Inaudible silent wav base64 (44-byte standard silent WAV header + PCM 0)
      audio.src =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
      audio.volume = 0.01;
      audio.play().catch(() => {});
      this.keepAliveAudioElement = audio;
    } catch {}
  }

  /**
   * Detects whether headphones or headset is the active output device
   */
  public async detectHeadphones(): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      return false;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputDevices = devices.filter((d) => d.kind === "audiooutput");
      const hasHeadphones = outputDevices.some((d) => {
        const label = d.label.toLowerCase();
        return (
          label.includes("headphone") ||
          label.includes("headset") ||
          label.includes("airpod") ||
          label.includes("buds") ||
          label.includes("bluetooth")
        );
      });

      this.state.isHeadphonesConnected = hasHeadphones;
      this.notifyState();
      return hasHeadphones;
    } catch {
      return false;
    }
  }

  /**
   * Attach Movie / Video Player element to the audio pipeline
   */
  public attachMovieElement(videoOrAudioEl: HTMLMediaElement): void {
    this.movieMediaElement = videoOrAudioEl;

    // Apply initial volume
    this.syncMovieElementVolume();

    // If Web Audio is supported and element hasn't been connected yet
    if (this.audioContext && !this.movieSourceNode && this.movieDuckingGainNode) {
      try {
        // Note: createMediaElementSource requires CORS or same-origin
        this.movieSourceNode = this.audioContext.createMediaElementSource(videoOrAudioEl);
        this.movieSourceNode.connect(this.movieDuckingGainNode);
      } catch {
        // Fallback: If CORS or security prevents createMediaElementSource,
        // we smoothly control videoOrAudioEl.volume directly via our volume math!
      }
    }
  }

  public detachMovieElement(): void {
    this.movieMediaElement = null;
  }

  /**
   * Attach Local Microphone Stream for Echo Detection & Monitoring
   */
  public attachMicStream(stream: MediaStream | null): void {
    if (!stream) {
      this.detachMicStream();
      return;
    }

    if (this.audioContext && stream.getAudioTracks().length > 0) {
      try {
        if (this.micStreamSourceNode) {
          this.micStreamSourceNode.disconnect();
        }
        this.micStreamSourceNode = this.audioContext.createMediaStreamSource(stream);
        this.micAnalyserNode = this.audioContext.createAnalyser();
        this.micAnalyserNode.fftSize = 128;
        this.micAnalyserNode.smoothingTimeConstant = 0.3;

        this.micStreamSourceNode.connect(this.micAnalyserNode);

        // Start real-time echo correlation engine
        this.startEchoDetectionLoop();
      } catch {}
    }
  }

  public detachMicStream(): void {
    this.stopEchoDetectionLoop();
    if (this.micStreamSourceNode) {
      try {
        this.micStreamSourceNode.disconnect();
      } catch {}
      this.micStreamSourceNode = null;
    }
    this.micAnalyserNode = null;
    this.state.echoDetected = false;
    this.state.echoDetails = null;
    this.notifyState();
  }

  /**
   * Register Remote Participant Audio Element for Voice Volume Control
   */
  public registerRemoteAudioElement(userId: string, audioElement: HTMLAudioElement): void {
    this.remoteAudioElements.set(userId, audioElement);
    audioElement.volume = Math.min(1.0, Math.max(0, this.state.voiceVolume));
  }

  public unregisterRemoteAudioElement(userId: string): void {
    this.remoteAudioElements.delete(userId);
  }

  /**
   * Screen Share Audio Attachment (Viewer Side)
   * Connects received screen audio into the duckable audio pipeline.
   * NOTE: Sharer side must NEVER play local screen audio locally to prevent instant feedback loops.
   */
  public attachRemoteScreenShareAudio(stream: MediaStream): void {
    if (!this.audioContext || !this.screenShareGainNode) return;
    try {
      if (this.screenShareAudioNode) {
        this.screenShareAudioNode.disconnect();
      }
      this.screenShareAudioNode = this.audioContext.createMediaStreamSource(stream);
      this.screenShareAudioNode.connect(this.screenShareGainNode);
    } catch {}
  }

  public detachRemoteScreenShareAudio(): void {
    if (this.screenShareAudioNode) {
      try {
        this.screenShareAudioNode.disconnect();
      } catch {}
      this.screenShareAudioNode = null;
    }
  }

  /**
   * 1. Auto-Ducking Pipeline
   * Lowers movie volume smoothly when anyone is speaking, then restores smoothly.
   */
  public notifySpeakingChange(isSpeaking: boolean): void {
    this.isAnyoneSpeaking = isSpeaking;

    if (!this.state.autoDuckingEnabled) {
      if (this.state.isDucked) {
        this.applyDuckingGain(1.0);
      }
      return;
    }

    if (isSpeaking) {
      // Cancel pending release timer
      if (this.duckingHoldTimeout) {
        clearTimeout(this.duckingHoldTimeout);
        this.duckingHoldTimeout = null;
      }

      // Compute target linear gain from duckingAmountDb: 10^(dB / 20)
      const targetGain = Math.pow(10, this.state.duckingAmountDb / 20);
      this.applyDuckingGain(targetGain);
    } else {
      // Speech stopped: hold for hangover duration (600ms) before smooth restore
      if (this.duckingHoldTimeout) {
        clearTimeout(this.duckingHoldTimeout);
      }
      this.duckingHoldTimeout = setTimeout(() => {
        this.duckingHoldTimeout = null;
        this.applyDuckingGain(1.0);
      }, 600);
    }
  }

  private applyDuckingGain(gainMultiplier: number): void {
    const isDucked = gainMultiplier < 0.99;
    this.state.isDucked = isDucked;
    this.state.currentDuckingGain = gainMultiplier;

    // Apply to Web Audio GainNode if available
    if (this.audioContext && this.movieDuckingGainNode) {
      const currentTime = this.audioContext.currentTime;
      this.movieDuckingGainNode.gain.cancelScheduledValues(currentTime);
      this.movieDuckingGainNode.gain.setTargetAtTime(gainMultiplier, currentTime, 0.05);
    }

    // Apply directly to attached HTMLMediaElement volume
    this.syncMovieElementVolume();

    this.options.onDuckingChange?.(isDucked, gainMultiplier);
    this.notifyState();
  }

  private syncMovieElementVolume(): void {
    if (!this.movieMediaElement) return;
    try {
      const effective = Math.min(1.0, Math.max(0, this.state.movieVolume * this.state.currentDuckingGain));
      this.movieMediaElement.volume = effective;
    } catch {}
  }

  /**
   * 2. Echo Detection Engine
   * Correlates movie energy envelopes with mic input energy envelopes to detect acoustic leak.
   */
  private startEchoDetectionLoop(): void {
    if (this.echoCorrelationCheckInterval) return;

    const movieBuf = new Uint8Array(64);
    const micBuf = new Uint8Array(64);

    this.movieEnergyHistory = [];
    this.micEnergyHistory = [];
    this.consecutiveEchoDetections = 0;

    this.echoCorrelationCheckInterval = setInterval(() => {
      if (!this.micAnalyserNode) return;

      // 1. Measure mic input energy
      this.micAnalyserNode.getByteFrequencyData(micBuf);
      let micSum = 0;
      for (let i = 0; i < micBuf.length; i++) micSum += micBuf[i];
      const micAvg = micSum / micBuf.length;

      // 2. Measure movie output energy
      let movieAvg = 0;
      if (this.movieAnalyserNode && this.isMoviePlaying) {
        this.movieAnalyserNode.getByteFrequencyData(movieBuf);
        let movieSum = 0;
        for (let i = 0; i < movieBuf.length; i++) movieSum += movieBuf[i];
        movieAvg = movieSum / movieBuf.length;
      }

      // Add to rolling history buffers (keep last 25 samples = 500ms at 20ms intervals)
      this.micEnergyHistory.push(micAvg);
      this.movieEnergyHistory.push(movieAvg);
      if (this.micEnergyHistory.length > 25) this.micEnergyHistory.shift();
      if (this.movieEnergyHistory.length > 25) this.movieEnergyHistory.shift();

      // Only perform correlation when both movie and mic have active sound
      if (this.movieEnergyHistory.length >= 15 && movieAvg > 15 && micAvg > 15) {
        this.evaluateAcousticEcho();
      } else {
        this.consecutiveEchoDetections = Math.max(0, this.consecutiveEchoDetections - 1);
        if (this.consecutiveEchoDetections === 0 && this.state.echoDetected) {
          this.state.echoDetected = false;
          this.state.echoDetails = null;
          this.notifyState();
        }
      }
    }, 20);
  }

  private evaluateAcousticEcho(): void {
    const N = this.micEnergyHistory.length;
    let maxCorrelation = 0;
    let bestLagMs = 0;

    // Search lags from 20ms (1 sample) to 200ms (10 samples)
    for (let lag = 1; lag <= Math.min(10, N - 5); lag++) {
      let sumMic = 0;
      let sumMovie = 0;
      let count = 0;

      for (let i = lag; i < N; i++) {
        sumMic += this.micEnergyHistory[i];
        sumMovie += this.movieEnergyHistory[i - lag];
        count++;
      }
      if (count === 0) continue;

      const meanMic = sumMic / count;
      const meanMovie = sumMovie / count;

      let numerator = 0;
      let denomMic = 0;
      let denomMovie = 0;

      for (let i = lag; i < N; i++) {
        const dMic = this.micEnergyHistory[i] - meanMic;
        const dMovie = this.movieEnergyHistory[i - lag] - meanMovie;
        numerator += dMic * dMovie;
        denomMic += dMic * dMic;
        denomMovie += dMovie * dMovie;
      }

      const denominator = Math.sqrt(denomMic * denomMovie);
      if (denominator > 0.0001) {
        const corr = numerator / denominator;
        if (corr > maxCorrelation) {
          maxCorrelation = corr;
          bestLagMs = lag * 20;
        }
      }
    }

    // Correlation threshold for acoustic echo: 0.65
    if (maxCorrelation > 0.65) {
      this.consecutiveEchoDetections++;
      // Require 3 consecutive windows (60ms) of high correlation to avoid false positives
      if (this.consecutiveEchoDetections >= 3) {
        const details: EchoDetectionDetails = {
          correlation: Math.min(1.0, maxCorrelation),
          estimatedDelayMs: bestLagMs,
          confidence:
            maxCorrelation > 0.85
              ? "high"
              : maxCorrelation > 0.72
              ? "medium"
              : "low",
          suggestAction: this.state.isHeadphonesConnected
            ? "push-to-talk"
            : "headphones",
        };

        this.state.echoDetected = true;
        this.state.echoDetails = details;
        this.options.onEchoDetected?.(details);
        this.notifyState();
      }
    } else {
      this.consecutiveEchoDetections = Math.max(0, this.consecutiveEchoDetections - 1);
    }
  }

  private stopEchoDetectionLoop(): void {
    if (this.echoCorrelationCheckInterval) {
      clearInterval(this.echoCorrelationCheckInterval);
      this.echoCorrelationCheckInterval = null;
    }
  }

  /**
   * Dismiss echo detection banner or trigger recommended remediation
   */
  public dismissEchoWarning(): void {
    this.state.echoDetected = false;
    this.consecutiveEchoDetections = 0;
    this.notifyState();
  }

  public applyEchoRemediation(): void {
    this.dismissEchoWarning();
    this.options.onRequestPushToTalk?.();
  }

  /**
   * 3. Separate Volume Controls (Movie, Voices, Notifications)
   */
  public setMovieVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1.5, volume));
    this.state.movieVolume = clamped;

    if (this.audioContext && this.movieMasterGainNode) {
      this.movieMasterGainNode.gain.setTargetAtTime(clamped, this.audioContext.currentTime, 0.03);
    }
    if (this.audioContext && this.screenShareGainNode) {
      this.screenShareGainNode.gain.setTargetAtTime(clamped, this.audioContext.currentTime, 0.03);
    }
    this.syncMovieElementVolume();

    this.savePersistedSettings();
    this.notifyState();
  }

  public setVoiceVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(2.0, volume));
    this.state.voiceVolume = clamped;

    // Apply voice multiplier across all active remote audio elements
    for (const audioEl of this.remoteAudioElements.values()) {
      audioEl.volume = Math.min(1.0, clamped);
    }

    this.savePersistedSettings();
    this.notifyState();
  }

  public setNotificationVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1.0, volume));
    this.state.notificationVolume = clamped;

    this.savePersistedSettings();
    this.notifyState();
  }

  public setAutoDuckingEnabled(enabled: boolean): void {
    this.state.autoDuckingEnabled = enabled;
    if (!enabled && this.state.isDucked) {
      this.applyDuckingGain(1.0);
    }
    this.savePersistedSettings();
    this.notifyState();
  }

  public setDuckingAmountDb(amountDb: number): void {
    // Clamped between -6 dB (mild) and -30 dB (aggressive)
    const clamped = Math.max(-30, Math.min(-6, amountDb));
    this.state.duckingAmountDb = clamped;

    if (this.state.isDucked) {
      this.applyDuckingGain(Math.pow(10, clamped / 20));
    }
    this.savePersistedSettings();
    this.notifyState();
  }

  /**
   * 4. "Quiet Mode"
   * Automatically enforces Push-to-Talk / muted voice when the movie is playing.
   */
  public setQuietModeEnabled(enabled: boolean): void {
    this.state.quietModeEnabled = enabled;
    this.updateQuietModeStatus();
    this.savePersistedSettings();
    this.notifyState();
  }

  public notifyMoviePlaybackChange(isPlaying: boolean): void {
    this.isMoviePlaying = isPlaying;
    this.updateQuietModeStatus();
  }

  private updateQuietModeStatus(): void {
    const isQuietActive = this.state.quietModeEnabled && this.isMoviePlaying;
    if (this.state.isQuietModeActive !== isQuietActive) {
      this.state.isQuietModeActive = isQuietActive;
      this.options.onQuietModeChange?.(isQuietActive);
      this.notifyState();
    }
  }

  /**
   * Synthesize crisp, low-latency UI notification sounds scaled by notificationVolume
   */
  public playNotificationSound(type: NotificationSoundType): void {
    if (!this.audioContext || this.state.notificationVolume <= 0.01) return;
    if (this.audioContext.state === "suspended") return;

    try {
      const now = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();

      gain.connect(this.audioContext.destination);
      osc.connect(gain);

      const vol = this.state.notificationVolume * 0.2; // comfortable ceiling

      if (type === "message") {
        // High, cheerful double chime (880Hz -> 1175Hz)
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1175, now + 0.08);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.16);
      } else if (type === "join") {
        // Ascending major triad
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.06); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.12); // G5
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.start(now);
        osc.stop(now + 0.24);
      } else if (type === "leave") {
        // Descending chime
        osc.frequency.setValueAtTime(783.99, now); // G5
        osc.frequency.setValueAtTime(523.25, now + 0.08); // C5
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (type === "reaction") {
        // Light pop
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.05);
        gain.gain.setValueAtTime(vol * 0.7, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      }
    } catch {}
  }

  /**
   * Persistence helpers
   */
  private loadPersistedSettings(): Partial<AudioMixerSettings> {
    try {
      if (typeof localStorage !== "undefined") {
        const stored = localStorage.getItem(this.storageKey);
        if (stored) return JSON.parse(stored);
      }
    } catch {}
    return {};
  }

  private savePersistedSettings(): void {
    try {
      if (typeof localStorage !== "undefined") {
        const settings: AudioMixerSettings = {
          movieVolume: this.state.movieVolume,
          voiceVolume: this.state.voiceVolume,
          notificationVolume: this.state.notificationVolume,
          autoDuckingEnabled: this.state.autoDuckingEnabled,
          duckingAmountDb: this.state.duckingAmountDb,
          quietModeEnabled: this.state.quietModeEnabled,
        };
        localStorage.setItem(this.storageKey, JSON.stringify(settings));
      }
    } catch {}
  }

  /**
   * Cleanup and teardown
   */
  public destroy(): void {
    this.isDestroyed = true;
    this.stopEchoDetectionLoop();
    this.removeUnlockListeners();

    if (this.duckingHoldTimeout) {
      clearTimeout(this.duckingHoldTimeout);
      this.duckingHoldTimeout = null;
    }

    if (this.boundDeviceChangeListener && typeof navigator !== "undefined" && navigator.mediaDevices?.removeEventListener) {
      navigator.mediaDevices.removeEventListener("devicechange", this.boundDeviceChangeListener);
    }
    if (this.boundVisibilityChangeListener && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.boundVisibilityChangeListener);
    }

    if (this.keepAliveAudioElement) {
      try {
        this.keepAliveAudioElement.pause();
        this.keepAliveAudioElement.src = "";
      } catch {}
      this.keepAliveAudioElement = null;
    }

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    this.remoteAudioElements.clear();
    this.movieMediaElement = null;
  }
}
