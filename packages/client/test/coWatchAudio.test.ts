import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CoWatchAudioManager, CoWatchAudioState, EchoDetectionDetails } from "../src/features/CoWatchAudioManager.js";
import { ScreenShareAdapter } from "../src/adapters/ScreenShareAdapter.js";

describe("CoWatchAudioManager - Watching and Talking Audio Pipeline", () => {
  let audioManager: CoWatchAudioManager;
  let currentState: CoWatchAudioState;
  let echoDetectedPayload: EchoDetectionDetails | null = null;
  let duckingChangedPayload: { isDucked: boolean; gain: number } | null = null;
  let quietModeActive: boolean | null = null;
  let pttRequested = false;

  // Mock AudioContext and Web Audio Nodes
  const mockGainNode = () => {
    let currentGain = 1.0;
    return {
      gain: {
        value: currentGain,
        setValueAtTime: vi.fn((v) => {
          currentGain = v;
        }),
        setTargetAtTime: vi.fn((v) => {
          currentGain = v;
        }),
        cancelScheduledValues: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  };

  const mockAnalyserNode = () => ({
    fftSize: 128,
    smoothingTimeConstant: 0.3,
    connect: vi.fn(),
    disconnect: vi.fn(),
    getByteFrequencyData: vi.fn((arr: Uint8Array) => {
      // fill with 0s by default
      arr.fill(0);
    }),
  });

  function MockAudioContext(this: any) {
    this.state = "running";
    this.currentTime = 10.5;
    this.destination = {};
    this.createGain = vi.fn(() => mockGainNode());
    this.createAnalyser = vi.fn(() => mockAnalyserNode());
    this.createMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
    this.createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
    this.createOscillator = vi.fn(() => ({
      type: "sine",
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }));
    this.resume = vi.fn().mockImplementation(async () => {
      this.state = "running";
    });
    this.close = vi.fn().mockResolvedValue(undefined);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    echoDetectedPayload = null;
    duckingChangedPayload = null;
    quietModeActive = null;
    pttRequested = false;

    // Mock localStorage
    const storage: Record<string, string> = {};
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => storage[k] || null,
        setItem: (k: string, v: string) => {
          storage[k] = v;
        },
        removeItem: (k: string) => {
          delete storage[k];
        },
      },
      configurable: true,
      writable: true,
    });

    // Mock window AudioContext
    (globalThis as any).AudioContext = MockAudioContext;
    (globalThis as any).window = {
      AudioContext: MockAudioContext,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    // Mock navigator media devices
    Object.defineProperty(globalThis, "navigator", {
      value: {
        mediaDevices: {
          enumerateDevices: vi.fn().mockResolvedValue([
            { deviceId: "mic_1", label: "Built-in Mic", kind: "audioinput" },
            { deviceId: "spk_1", label: "MacBook Pro Speakers", kind: "audiooutput" },
          ]),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      },
      configurable: true,
      writable: true,
    });

    audioManager = new CoWatchAudioManager({
      onStateChange: (state) => {
        currentState = { ...state };
      },
      onEchoDetected: (details) => {
        echoDetectedPayload = details;
      },
      onDuckingChange: (isDucked, gain) => {
        duckingChangedPayload = { isDucked, gain };
      },
      onQuietModeChange: (active) => {
        quietModeActive = active;
      },
      onRequestPushToTalk: () => {
        pttRequested = true;
      },
    });
  });

  afterEach(() => {
    audioManager.destroy();
    vi.useRealTimers();
  });

  describe("1. Separate Volume Controls (Movie, Voices, Notifications) & Persistence", () => {
    it("adjusts movie volume and clamps between 0.0 and 1.5", () => {
      audioManager.setMovieVolume(0.75);
      expect(audioManager.getState().movieVolume).toBe(0.75);

      audioManager.setMovieVolume(2.5); // over max clamp
      expect(audioManager.getState().movieVolume).toBe(1.5);

      audioManager.setMovieVolume(-0.2); // under min clamp
      expect(audioManager.getState().movieVolume).toBe(0.0);
    });

    it("adjusts voice volume and cascades to registered remote audio elements", () => {
      const mockAudioEl1 = { volume: 1.0 } as any;
      const mockAudioEl2 = { volume: 1.0 } as any;

      audioManager.registerRemoteAudioElement("user_bob", mockAudioEl1);
      audioManager.registerRemoteAudioElement("user_charlie", mockAudioEl2);

      audioManager.setVoiceVolume(0.5);
      expect(mockAudioEl1.volume).toBe(0.5);
      expect(mockAudioEl2.volume).toBe(0.5);

      audioManager.setVoiceVolume(1.8);
      // HTMLAudioElement volume is clamped to max 1.0
      expect(mockAudioEl1.volume).toBe(1.0);
      expect(audioManager.getState().voiceVolume).toBe(1.8);
    });

    it("persists all 3 volume settings in localStorage and restores on new instance", () => {
      audioManager.setMovieVolume(0.85);
      audioManager.setVoiceVolume(1.2);
      audioManager.setNotificationVolume(0.4);

      const saved = JSON.parse(localStorage.getItem("watchparty_audio_mixer_settings") || "{}");
      expect(saved.movieVolume).toBe(0.85);
      expect(saved.voiceVolume).toBe(1.2);
      expect(saved.notificationVolume).toBe(0.4);

      // Create new instance to test restoration
      const restoredManager = new CoWatchAudioManager();
      expect(restoredManager.getState().movieVolume).toBe(0.85);
      expect(restoredManager.getState().voiceVolume).toBe(1.2);
      expect(restoredManager.getState().notificationVolume).toBe(0.4);
      restoredManager.destroy();
    });

    it("plays synthesized notification sounds without errors", () => {
      expect(() => audioManager.playNotificationSound("message")).not.toThrow();
      expect(() => audioManager.playNotificationSound("join")).not.toThrow();
      expect(() => audioManager.playNotificationSound("leave")).not.toThrow();
      expect(() => audioManager.playNotificationSound("reaction")).not.toThrow();
    });
  });

  describe("2. Auto-Ducking Pipeline with Smooth Gain Ramps", () => {
    it("lowers movie volume by -12 dB (linear ~0.251) when someone speaks", () => {
      const mockVideo = { volume: 1.0 } as any;
      audioManager.attachMovieElement(mockVideo);
      audioManager.setMovieVolume(1.0);

      // User starts speaking
      audioManager.notifySpeakingChange(true);

      const state = audioManager.getState();
      expect(state.isDucked).toBe(true);
      // 10^(-12/20) approx 0.2511886
      expect(state.currentDuckingGain).toBeCloseTo(0.251, 2);
      expect(mockVideo.volume).toBeCloseTo(0.251, 2);
      expect(duckingChangedPayload?.isDucked).toBe(true);
      expect(duckingChangedPayload?.gain).toBeCloseTo(0.251, 2);
    });

    it("respects custom duckingAmountDb settings (e.g. -18 dB and -6 dB)", () => {
      audioManager.setDuckingAmountDb(-18);
      audioManager.notifySpeakingChange(true);

      // 10^(-18/20) approx 0.12589
      expect(audioManager.getState().currentDuckingGain).toBeCloseTo(0.1259, 2);

      audioManager.setDuckingAmountDb(-6);
      // 10^(-6/20) approx 0.50118
      expect(audioManager.getState().currentDuckingGain).toBeCloseTo(0.501, 2);
    });

    it("holds ducking during pauses between words (600ms hangover) and smoothly restores", () => {
      const mockVideo = { volume: 1.0 } as any;
      audioManager.attachMovieElement(mockVideo);

      audioManager.notifySpeakingChange(true);
      expect(audioManager.getState().isDucked).toBe(true);

      // Speech pauses briefly
      audioManager.notifySpeakingChange(false);
      // At 300ms (during hangover), still ducked
      vi.advanceTimersByTime(300);
      expect(audioManager.getState().isDucked).toBe(true);

      // Advance past 600ms hangover
      vi.advanceTimersByTime(350);
      expect(audioManager.getState().isDucked).toBe(false);
      expect(audioManager.getState().currentDuckingGain).toBe(1.0);
      expect(mockVideo.volume).toBeCloseTo(1.0, 2);
    });

    it("does not duck movie when autoDuckingEnabled is toggled off", () => {
      audioManager.setAutoDuckingEnabled(false);
      audioManager.notifySpeakingChange(true);

      expect(audioManager.getState().isDucked).toBe(false);
      expect(audioManager.getState().currentDuckingGain).toBe(1.0);
    });
  });

  describe("3. Quiet Mode Coordination", () => {
    it("activates quiet mode only when enabled AND movie is actively playing", () => {
      audioManager.setQuietModeEnabled(true);
      expect(audioManager.getState().isQuietModeActive).toBe(false); // movie not playing yet

      // Movie starts playing
      audioManager.notifyMoviePlaybackChange(true);
      expect(audioManager.getState().isQuietModeActive).toBe(true);
      expect(quietModeActive).toBe(true);

      // Movie pauses (hangout time)
      audioManager.notifyMoviePlaybackChange(false);
      expect(audioManager.getState().isQuietModeActive).toBe(false);
      expect(quietModeActive).toBe(false);
    });

    it("does not activate quiet mode when movie plays if quietModeEnabled is false", () => {
      audioManager.setQuietModeEnabled(false);
      audioManager.notifyMoviePlaybackChange(true);
      expect(audioManager.getState().isQuietModeActive).toBe(false);
    });
  });

  describe("4. Echo Detection Engine & Remediation", () => {
    it("handles echo dismissal and triggers push-to-talk remediation", () => {
      // Simulate state where echo was detected
      (audioManager as any).state.echoDetected = true;
      (audioManager as any).state.echoDetails = {
        correlation: 0.88,
        estimatedDelayMs: 60,
        confidence: "high",
        suggestAction: "push-to-talk",
      };

      expect(audioManager.getState().echoDetected).toBe(true);

      audioManager.applyEchoRemediation();
      expect(pttRequested).toBe(true);
      expect(audioManager.getState().echoDetected).toBe(false);
    });

    it("dismisses echo warning without switching to push-to-talk", () => {
      (audioManager as any).state.echoDetected = true;
      audioManager.dismissEchoWarning();
      expect(audioManager.getState().echoDetected).toBe(false);
      expect(pttRequested).toBe(false);
    });

    it("detects whether headphones or headset is used via audiooutput inspection", async () => {
      const isHeadphones = await audioManager.detectHeadphones();
      expect(isHeadphones).toBe(false); // "MacBook Pro Speakers" is not headphones

      // Change output device to AirPods
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValueOnce([
        { deviceId: "airpods_1", label: "John's AirPods Pro", kind: "audiooutput" },
      ]);

      const isAirpods = await audioManager.detectHeadphones();
      expect(isAirpods).toBe(true);
      expect(audioManager.getState().isHeadphonesConnected).toBe(true);
    });
  });

  describe("5. Screen Share Audio Mixing & Feedback Loop Elimination", () => {
    it("mutes local video element when sharing screen to eliminate local acoustic feedback", () => {
      const mockVideoElement = {
        srcObject: null,
        muted: false,
        autoplay: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as any;

      const mockScreenStream = {
        getTracks: () => [{ kind: "video", stop: vi.fn() }, { kind: "audio", stop: vi.fn() }],
        getVideoTracks: () => [{ kind: "video", addEventListener: vi.fn(), removeEventListener: vi.fn() }],
        getAudioTracks: () => [{ kind: "audio" }],
      } as any;

      const adapter = new ScreenShareAdapter({ videoElement: mockVideoElement });

      // Local sharer attaches stream
      adapter.setMediaStream(mockScreenStream, true); // isLocalSharer = true

      // Local video element MUST be muted so sharer's mic does not pick it up from speakers
      expect(mockVideoElement.muted).toBe(true);

      // Remote viewer attaches stream
      adapter.setMediaStream(mockScreenStream, false); // isLocalSharer = false
      expect(mockVideoElement.muted).toBe(false);
    });

    it("attaches remote screen share audio to duckable audio pipeline and detaches cleanly", () => {
      const mockStream = {
        getAudioTracks: () => [{ kind: "audio" }],
      } as any;

      expect(() => audioManager.attachRemoteScreenShareAudio(mockStream)).not.toThrow();
      expect(() => audioManager.detachRemoteScreenShareAudio()).not.toThrow();
    });
  });

  describe("6. Mobile Audio Lifecycle & User Gesture Unlock", () => {
    it("resumes suspended audio context via unlockMobileAudio()", async () => {
      (audioManager as any).audioContext.state = "suspended";
      const unlocked = await audioManager.unlockMobileAudio();
      expect(unlocked).toBe(true);
      expect(audioManager.getState().mobileAudioUnlocked).toBe(true);
    });
  });
});
