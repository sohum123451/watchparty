import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { VoiceVideoManager, VoiceVideoState } from "../src/features/VoiceVideoManager.js";
import { MemberManager } from "../src/social/MemberManager.js";
import { ClientMessage, ParticipantMediaState } from "@watchparty/shared";

describe("VoiceVideoManager Client Feature", () => {
  let sentMessages: ClientMessage[];
  let manager: VoiceVideoManager;
  let currentState: VoiceVideoState;

  const mockTrack = (kind: "audio" | "video") => ({
    kind,
    enabled: true,
    stop: vi.fn(),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  });

  const mockMediaStream = (tracks: any[]) => ({
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    addTrack: vi.fn((t) => tracks.push(t)),
    removeTrack: vi.fn((t) => {
      const idx = tracks.indexOf(t);
      if (idx !== -1) tracks.splice(idx, 1);
    }),
  });

  beforeEach(() => {
    sentMessages = [];

    // Mock global navigator.mediaDevices
    const audioTrack = mockTrack("audio");
    const videoTrack = mockTrack("video");
    const stream = mockMediaStream([audioTrack]);

    Object.defineProperty(globalThis, "navigator", {
      value: {
        mediaDevices: {
          getUserMedia: vi.fn().mockImplementation((constraints: any) => {
            if (constraints.video) {
              return Promise.resolve(mockMediaStream([videoTrack]));
            }
            return Promise.resolve(stream);
          }),
          enumerateDevices: vi.fn().mockResolvedValue([
            { deviceId: "mic_1", label: "Studio Mic", kind: "audioinput" },
            { deviceId: "cam_1", label: "HD Webcam", kind: "videoinput" },
            { deviceId: "spk_1", label: "Headphones", kind: "audiooutput" },
          ]),
        },
      },
      configurable: true,
      writable: true,
    });

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

    // Mock fetch for token
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          provider: "livekit",
          serverUrl: "wss://livekit.watchparty.local",
          token: "mock_jwt_token",
          permissions: {
            canPublishAudio: true,
            canPublishVideo: true,
            canPublishScreen: true,
          },
        }),
    });

    manager = new VoiceVideoManager({
      localUserId: "user_alice",
      localUserName: "Alice",
      roomCode: "ROOM123",
      isHost: true,
      sendMessage: (msg) => {
        sentMessages.push(msg);
      },
      onStateChange: (state) => {
        currentState = { ...state };
      },
    });

    currentState = manager.getState();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe("1. Initial State & Configuration", () => {
    it("initializes disconnected from voice with standard audio constraints enabled", () => {
      const state = manager.getState();
      expect(state.inVoice).toBe(false);
      expect(state.audioMuted).toBe(false);
      expect(state.videoEnabled).toBe(false);
      expect(state.noiseSuppression).toBe(true);
      expect(state.echoCancellation).toBe(true);
      expect(state.autoGainControl).toBe(true);
      expect(state.layoutMode).toBe("theater");
    });

    it("enumerates available media devices", async () => {
      const devices = await manager.enumerateDevices();
      expect(devices.length).toBe(3);
      expect(devices.find((d) => d.kind === "audioinput")?.label).toBe("Studio Mic");
      expect(devices.find((d) => d.kind === "videoinput")?.label).toBe("HD Webcam");
      expect(devices.find((d) => d.kind === "audiooutput")?.label).toBe("Headphones");
    });
  });

  describe("2. Joining and Leaving Voice Channel", () => {
    it("joins voice channel, acquires mic, and broadcasts state update", async () => {
      await manager.joinVoice();

      const state = manager.getState();
      expect(state.inVoice).toBe(true);
      expect(state.audioMuted).toBe(false);

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].type).toBe("VOICE_STATE_UPDATE");
      expect((sentMessages[0] as any).payload.inVoice).toBe(true);
    });

    it("leaves voice channel, stops tracks, and broadcasts disconnected state", async () => {
      await manager.joinVoice();
      expect(manager.getState().inVoice).toBe(true);

      manager.leaveVoice();
      expect(manager.getState().inVoice).toBe(false);

      const lastMsg = sentMessages[sentMessages.length - 1];
      expect(lastMsg.type).toBe("VOICE_STATE_UPDATE");
      expect((lastMsg as any).payload.inVoice).toBe(false);
    });
  });

  describe("3. Audio & Video Controls (Mute, Camera, Push-to-Talk)", () => {
    it("toggles microphone mute state", async () => {
      await manager.joinVoice();
      expect(manager.getState().audioMuted).toBe(false);

      manager.toggleMute();
      expect(manager.getState().audioMuted).toBe(true);

      manager.toggleMute();
      expect(manager.getState().audioMuted).toBe(false);
    });

    it("supports Push-to-Talk with hold-to-speak mechanics", async () => {
      manager.setPushToTalk(true);
      expect(manager.getState().pushToTalkEnabled).toBe(true);

      await manager.joinVoice();
      // When PTT is enabled, initial voice state is muted
      expect(manager.getState().audioMuted).toBe(true);

      // Keydown / mouse down
      manager.setPttActive(true);
      expect(manager.getState().audioMuted).toBe(false);
      expect(manager.getState().pttActive).toBe(true);

      // Keyup / mouse up
      manager.setPttActive(false);
      expect(manager.getState().audioMuted).toBe(true);
      expect(manager.getState().pttActive).toBe(false);
    });

    it("toggles video camera on and off", async () => {
      await manager.joinVoice();
      expect(manager.getState().videoEnabled).toBe(false);

      await manager.toggleVideo();
      expect(manager.getState().videoEnabled).toBe(true);

      await manager.toggleVideo();
      expect(manager.getState().videoEnabled).toBe(false);
    });
  });

  describe("4. Moderator & Server State Handling", () => {
    it("dispatches moderator commands to server WebSocket", () => {
      manager.moderatorMuteVoice("user_bob");
      manager.moderatorRemoveVoice("user_charlie");
      manager.moderatorDisableRoomVideo(true);

      expect(sentMessages).toEqual([
        expect.objectContaining({
          type: "ROOM_MOD_MUTE_VOICE",
          payload: expect.objectContaining({ targetUserId: "user_bob" }),
        }),
        expect.objectContaining({
          type: "ROOM_MOD_REMOVE_VOICE",
          payload: { targetUserId: "user_charlie" },
        }),
        expect.objectContaining({
          type: "ROOM_MOD_DISABLE_ROOM_VIDEO",
          payload: { disabled: true },
        }),
      ]);
    });

    it("updates participant list and enforces server-wide room video disablement", async () => {
      await manager.joinVoice();
      await manager.toggleVideo();
      expect(manager.getState().videoEnabled).toBe(true);

      const participants: ParticipantMediaState[] = [
        {
          userId: "user_alice",
          userName: "Alice",
          role: "host",
          inVoice: true,
          audioMuted: false,
          videoEnabled: true,
          joinedAt: Date.now(),
        },
        {
          userId: "user_bob",
          userName: "Bob",
          role: "member",
          inVoice: true,
          audioMuted: true,
          videoEnabled: false,
          joinedAt: Date.now(),
        },
      ];

      // Server disables video for the room
      manager.handleServerVoiceStateUpdated(participants, true);

      const state = manager.getState();
      expect(state.videoDisabledForRoom).toBe(true);
      expect(state.videoEnabled).toBe(false); // auto-disabled
      expect(state.participants.length).toBe(2);
    });
  });

  describe("5. Per-Person Volume Controls & Persistence", () => {
    it("sets per-person volume multiplier and persists across sessions", () => {
      manager.setParticipantVolume("user_bob", 1.5);
      expect(manager.getState().remoteVolumes["user_bob"]).toBe(1.5);

      const saved = JSON.parse(localStorage.getItem("watchparty_voice_volumes") || "{}");
      expect(saved["user_bob"]).toBe(1.5);
    });

    it("toggles layout mode between theater and hangout grid", () => {
      expect(manager.getState().layoutMode).toBe("theater");
      manager.setLayoutMode("grid");
      expect(manager.getState().layoutMode).toBe("grid");

      manager.toggleFloatingStripCollapsed();
      expect(manager.getState().floatingStripCollapsed).toBe(true);

      manager.toggleFloatingStripPip();
      expect(manager.getState().floatingStripPip).toBe(true);
    });
  });

  describe("6. Blocked Users & Media Isolation", () => {
    it("mutes, pauses, and drops media streams from blocked users", () => {
      const mockAudioEl: any = {
        muted: false,
        volume: 1.0,
        pause: vi.fn(),
        play: vi.fn(),
      };

      // Block user_troll
      manager.blockUser("user_troll");
      expect(manager.isUserBlocked("user_troll")).toBe(true);

      // Attach remote audio element for blocked user
      manager.attachRemoteAudioElement("user_troll", mockAudioEl);
      expect(mockAudioEl.muted).toBe(true);
      expect(mockAudioEl.volume).toBe(0);
      expect(mockAudioEl.pause).toHaveBeenCalled();

      // Remote stream callback is dropped
      const onRemoteStreamSpy = vi.fn();
      const testManager = new VoiceVideoManager({
        localUserId: "user_alice",
        roomCode: "ROOM123",
        sendMessage: vi.fn(),
        onRemoteStream: onRemoteStreamSpy,
      });
      testManager.blockUser("user_troll");

      const dummyStream = {} as any;
      testManager.handleRemoteStream("user_troll", dummyStream);
      expect(onRemoteStreamSpy).not.toHaveBeenCalled();

      // Non-blocked user stream is received normally
      testManager.handleRemoteStream("user_bob", dummyStream);
      expect(onRemoteStreamSpy).toHaveBeenCalledWith("user_bob", dummyStream);

      // Volume for blocked user returns 0
      expect(manager.getParticipantVolume("user_troll")).toBe(0);

      // Unblocking restores audio capability
      manager.unblockUser("user_troll");
      expect(manager.isUserBlocked("user_troll")).toBe(false);
      expect(mockAudioEl.muted).toBe(false);

      testManager.destroy();
    });

    it("bulk configures blocked user IDs via setBlockedUserIds", () => {
      const mockAudioEl: any = {
        muted: false,
        volume: 1.0,
        pause: vi.fn(),
      };

      manager.attachRemoteAudioElement("user_bad_1", mockAudioEl);
      manager.setBlockedUserIds(["user_bad_1", "user_bad_2"]);

      expect(manager.isUserBlocked("user_bad_1")).toBe(true);
      expect(manager.isUserBlocked("user_bad_2")).toBe(true);
      expect(manager.isUserBlocked("user_good")).toBe(false);
      expect(mockAudioEl.muted).toBe(true);
      expect(mockAudioEl.volume).toBe(0);
      expect(mockAudioEl.pause).toHaveBeenCalled();
    });
  });

  describe("7. MemberManager Voice Presence Syncing", () => {
    it("synchronizes inVoice, isSpeaking, voiceMuted, and videoEnabled into Member objects", () => {
      const memberManager = new MemberManager({
        hostId: "user_alice",
        selfUserId: "user_alice",
      });

      memberManager.initMembers([
        {
          userId: "user_alice",
          userName: "Alice",
          role: "host",
          isHost: true,
          isConnected: true,
          isBuffering: false,
          isMuted: false,
          joinedAt: 1000,
        },
        {
          userId: "user_bob",
          userName: "Bob",
          role: "member",
          isHost: false,
          isConnected: true,
          isBuffering: false,
          isMuted: false,
          joinedAt: 2000,
        },
        {
          userId: "user_charlie",
          userName: "Charlie",
          role: "member",
          isHost: false,
          isConnected: true,
          isBuffering: false,
          isMuted: false,
          joinedAt: 3000,
        },
      ]);

      // Initially no one in voice
      expect(memberManager.getVoiceMembers().length).toBe(0);
      expect(memberManager.getSpeakingMembers().length).toBe(0);
      expect(memberManager.getMutedMembers().length).toBe(0);

      // Server voice update arrives
      const participants: ParticipantMediaState[] = [
        {
          userId: "user_alice",
          userName: "Alice",
          role: "host",
          inVoice: true,
          audioMuted: false,
          videoEnabled: true,
          isSpeaking: true,
        },
        {
          userId: "user_bob",
          userName: "Bob",
          role: "member",
          inVoice: true,
          audioMuted: true,
          videoEnabled: false,
          isSpeaking: false,
        },
      ];

      memberManager.handleVoiceStateUpdated(participants);

      // Verify presence getters
      const voiceMembers = memberManager.getVoiceMembers();
      expect(voiceMembers.length).toBe(2);
      expect(voiceMembers.map((m) => m.userId)).toContain("user_alice");
      expect(voiceMembers.map((m) => m.userId)).toContain("user_bob");

      const speakingMembers = memberManager.getSpeakingMembers();
      expect(speakingMembers.length).toBe(1);
      expect(speakingMembers[0].userId).toBe("user_alice");

      const mutedMembers = memberManager.getMutedMembers();
      expect(mutedMembers.length).toBe(1);
      expect(mutedMembers[0].userId).toBe("user_bob");

      // Verify specific member state
      const alice = memberManager.getMember("user_alice");
      expect(alice?.inVoice).toBe(true);
      expect(alice?.isSpeaking).toBe(true);
      expect(alice?.voiceMuted).toBe(false);
      expect(alice?.videoEnabled).toBe(true);

      const charlie = memberManager.getMember("user_charlie");
      expect(charlie?.inVoice).toBe(false);
      expect(charlie?.isSpeaking).toBe(false);
    });
  });
});
