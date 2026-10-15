import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "node:http";
import { Room, ActiveConnection } from "../src/rooms/Room.js";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { LiveKitMediaProvider } from "../src/media/LiveKitMediaProvider.js";
import { MediaService } from "../src/media/MediaService.js";
import { handleMediaRoute } from "../src/media/mediaRoutes.js";
import { auditLogger } from "../src/security/AuditLogger.js";
import { ServerMessage } from "@watchparty/shared";
import { jwtVerify } from "jose";

function createMockConnection(): { connection: ActiveConnection; messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  const connection: ActiveConnection = {
    isAlive: true,
    send: vi.fn((msg: ServerMessage) => {
      messages.push(msg);
    }),
    close: vi.fn(),
  };
  return { connection, messages };
}

function createMockHttp(method: string, url: string, bodyObj?: any, ip = "127.0.0.1") {
  const req: any = new http.IncomingMessage({} as any);
  req.method = method;
  req.url = url;
  req.headers = {
    "content-type": "application/json",
    "x-forwarded-for": ip,
  };
  req.socket = { remoteAddress: ip };

  if (bodyObj) {
    const jsonStr = JSON.stringify(bodyObj);
    req._read = function () {
      this.push(jsonStr);
      this.push(null);
    };
  } else {
    req._read = function () {
      this.push(null);
    };
  }

  let resData = "";
  let resStatus = 200;
  let resHeaders: any = {};

  const res: any = {
    writeHead: (status: number, h: any) => {
      resStatus = status;
      resHeaders = h;
    },
    end: (data: string) => {
      resData = data;
    },
    destroy: vi.fn(),
  };

  return {
    req,
    res,
    getStatus: () => resStatus,
    getBody: () => (resData ? JSON.parse(resData) : null),
  };
}

describe("Voice & Video Consent, Safety, Presence Sync & Security Suite", () => {
  let roomManager: RoomManager;
  let room: Room;
  let liveKitProvider: LiveKitMediaProvider;
  let mediaService: MediaService;

  const hostId = "user_host_100";
  let aliceId = "user_alice_200";
  let bobId = "user_bob_300";

  let hostMock: { connection: ActiveConnection; messages: ServerMessage[] };
  let aliceMock: { connection: ActiveConnection; messages: ServerMessage[] };
  let bobMock: { connection: ActiveConnection; messages: ServerMessage[] };

  let hostSessionToken: string;
  let aliceSessionToken: string;
  let bobSessionToken: string;

  const testApiKey = "devkey";
  const testApiSecret = "secret_key_123456789012345678901234";

  beforeEach(() => {
    roomManager = new RoomManager();
    const created = roomManager.createRoom({
      roomName: "Safety and Consent Room",
      hostUserId: hostId,
      hostUserName: "Host Safety",
      controlMode: "host_only",
    });
    room = created.room;
    hostSessionToken = created.hostSessionToken;

    hostMock = createMockConnection();
    const hostMember = room.getMember(hostId);
    if (hostMember) {
      hostMember.connection = hostMock.connection;
      hostMember.isConnected = true;
    }

    aliceMock = createMockConnection();
    const aliceRes = room.addMember("Alice", aliceMock.connection);
    if (aliceRes.success) {
      aliceId = aliceRes.member.userId;
      aliceSessionToken = aliceRes.sessionToken;
    }

    bobMock = createMockConnection();
    const bobRes = room.addMember("Bob", bobMock.connection);
    if (bobRes.success) {
      bobId = bobRes.member.userId;
      bobSessionToken = bobRes.sessionToken;
    }

    liveKitProvider = new LiveKitMediaProvider({
      apiKey: testApiKey,
      apiSecret: testApiSecret,
      serverUrl: "wss://livekit.watchparty.local",
    });

    mediaService = new MediaService({
      provider: liveKitProvider,
      roomManager,
    });
    room.setMediaService(mediaService);
  });

  // =========================================================================
  // 1. PRESENCE AND MEMBER LIST SYNCING
  // =========================================================================
  describe("1. Presence & Member List Syncing", () => {
    it("exposes voice state (inVoice, isSpeaking, voiceMuted, videoEnabled) in room members and snapshot", () => {
      // 1. Check initial state: no one is in voice or camera
      const snapInitial = room.getSnapshot(hostId, hostSessionToken);
      for (const m of snapInitial.members) {
        expect(m.inVoice).toBe(false);
        expect(m.isSpeaking).toBe(false);
        expect(m.videoEnabled).toBe(false);
      }

      // 2. Alice joins voice, unmuted, with camera
      room.updateVoiceState(aliceId, {
        inVoice: true,
        audioMuted: false,
        videoEnabled: true,
      });

      // 3. Bob joins voice, muted, audio-only
      room.updateVoiceState(bobId, {
        inVoice: true,
        audioMuted: true,
        videoEnabled: false,
      });

      // 4. Verify snapshot reflects synced presence
      const snapUpdated = room.getSnapshot(hostId, hostSessionToken);
      const alicePub = snapUpdated.members.find((m) => m.userId === aliceId);
      const bobPub = snapUpdated.members.find((m) => m.userId === bobId);
      const hostPub = snapUpdated.members.find((m) => m.userId === hostId);

      expect(alicePub?.inVoice).toBe(true);
      expect(alicePub?.voiceMuted).toBe(false);
      expect(alicePub?.videoEnabled).toBe(true);

      expect(bobPub?.inVoice).toBe(true);
      expect(bobPub?.voiceMuted).toBe(true);
      expect(bobPub?.videoEnabled).toBe(false);

      expect(hostPub?.inVoice).toBe(false);

      // 5. Verify ROOM_VOICE_STATE_UPDATED was broadcast to room connections
      const lastBroadcast = aliceMock.messages[aliceMock.messages.length - 1];
      expect(lastBroadcast.type).toBe("ROOM_VOICE_STATE_UPDATED");
      const payload = (lastBroadcast as any).payload;
      expect(payload.participants.length).toBe(2);
    });
  });

  // =========================================================================
  // 2. CONSENT & SAFETY (NO AUTO-JOIN, OPT-IN CAMERA)
  // =========================================================================
  describe("2. Consent & Safety", () => {
    it("strictly ensures no one is auto-joined to voice or video on room entry", () => {
      const charlieMock = createMockConnection();
      const charlieRes = room.addMember("Charlie", charlieMock.connection);
      expect(charlieRes.success).toBe(true);

      // Charlie must not be in voiceParticipants
      expect(room.voiceParticipants.has(charlieRes.member!.userId)).toBe(false);
      const charlieMember = room.getSnapshot(hostId, hostSessionToken).members.find(
        (m) => m.userId === charlieRes.member!.userId
      );
      expect(charlieMember?.inVoice).toBe(false);
      expect(charlieMember?.videoEnabled).toBe(false);
    });

    it("ensures the camera is strictly opt-in and can remain disabled while voice is active", () => {
      // Alice joins voice with videoEnabled explicitly false
      room.updateVoiceState(aliceId, {
        inVoice: true,
        audioMuted: false,
        videoEnabled: false,
      });

      const participant = room.voiceParticipants.get(aliceId);
      expect(participant?.inVoice).toBe(true);
      expect(participant?.videoEnabled).toBe(false);
    });
  });

  // =========================================================================
  // 3. NO RECORDING BY DEFAULT & 100% EXPLICIT CONSENT REQUIREMENT
  // =========================================================================
  describe("3. Room Recording Consent & Visible Banners", () => {
    it("is not recording by default", () => {
      const state = room.getRecordingState();
      expect(state.isRecording).toBe(false);
      expect(state.requestedBy).toBeUndefined();

      const snap = room.getSnapshot(hostId, hostSessionToken);
      expect(snap.recordingState?.isRecording).toBe(false);
    });

    it("requires 100% explicit consent from everyone in the room; aborts on single denial", () => {
      // 1. Host requests room recording
      const reqRes = room.requestRecording(hostId);
      expect(reqRes.success).toBe(true);

      // Verify ROOM_RECORDING_REQUESTED broadcast with visible banner
      const reqMsg = aliceMock.messages.find((m) => m.type === "ROOM_RECORDING_REQUESTED");
      expect(reqMsg).toBeDefined();
      expect((reqMsg as any).payload.bannerText).toContain("Explicit consent from everyone in the room is required");
      expect(room.getRecordingState().isRecording).toBe(false);

      // 2. Alice consents
      room.submitRecordingConsent(aliceId, true);
      expect(room.getRecordingState().isRecording).toBe(false); // Still waiting for Bob!

      // 3. Bob denies consent
      const denyRes = room.submitRecordingConsent(bobId, false);
      expect(denyRes.success).toBe(true);
      expect(denyRes.aborted).toBe(true);
      expect(denyRes.isRecording).toBe(false);

      // Verify ROOM_RECORDING_ABORTED broadcast
      const abortMsg = hostMock.messages.find((m) => m.type === "ROOM_RECORDING_ABORTED");
      expect(abortMsg).toBeDefined();
      expect((abortMsg as any).payload.reason).toContain("explicit consent was denied by a room member");
      expect(room.getRecordingState().isRecording).toBe(false);
    });

    it("starts recording with visible banner when 100% of room members consent", () => {
      // 1. Host requests recording
      room.requestRecording(hostId);

      // 2. Alice and Bob both consent
      room.submitRecordingConsent(aliceId, true);
      const bobRes = room.submitRecordingConsent(bobId, true);

      expect(bobRes.isRecording).toBe(true);
      expect(room.getRecordingState().isRecording).toBe(true);

      // 3. Verify ROOM_RECORDING_STARTED broadcast with prominent banner
      const startMsg = aliceMock.messages.find((m) => m.type === "ROOM_RECORDING_STARTED");
      expect(startMsg).toBeDefined();
      expect((startMsg as any).payload.isRecording).toBe(true);
      expect((startMsg as any).payload.bannerText).toContain("🔴 REC");

      // 4. Host stops recording
      const stopOk = room.stopRecording(hostId);
      expect(stopOk).toBe(true);
      expect(room.getRecordingState().isRecording).toBe(false);

      const stopMsg = bobMock.messages.find((m) => m.type === "ROOM_RECORDING_STOPPED");
      expect(stopMsg).toBeDefined();
    });
  });

  // =========================================================================
  // 4. METADATA-ONLY LOGGING (ZERO MEDIA CONTENT)
  // =========================================================================
  describe("4. Privacy & Retention: Metadata-Only Logging", () => {
    it("logs only join, leave, and mute metadata; never logs media content or audio/video bytes", () => {
      const auditSpy = vi.spyOn(auditLogger, "log");

      // 1. Alice joins voice
      room.updateVoiceState(aliceId, { inVoice: true, audioMuted: false, videoEnabled: false });

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "VOICE_PARTICIPANT_JOINED",
          actorId: aliceId,
          details: expect.objectContaining({
            roomId: room.roomId,
            roomCode: room.roomCode,
          }),
        })
      );

      // Verify no media payload was logged
      const joinCall = auditSpy.mock.calls.find((c) => c[0].type === "VOICE_PARTICIPANT_JOINED");
      expect(joinCall?.[0].details?.mediaContent).toBeUndefined();
      expect(joinCall?.[0].details?.audioData).toBeUndefined();
      expect(joinCall?.[0].details?.videoData).toBeUndefined();

      // 2. Host mutes Alice
      room.muteVoiceParticipant(hostId, aliceId);
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "VOICE_PARTICIPANT_MUTED",
          actorId: hostId,
          targetId: aliceId,
        })
      );

      // 3. Alice leaves voice
      room.updateVoiceState(aliceId, { inVoice: false, audioMuted: false, videoEnabled: false });
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "VOICE_PARTICIPANT_LEFT",
          actorId: aliceId,
          details: expect.objectContaining({
            roomId: room.roomId,
            durationMs: expect.any(Number),
          }),
        })
      );

      auditSpy.mockRestore();
    });
  });

  // =========================================================================
  // 5. SECURITY: EXPIRY, REVOCATION ON KICK/BAN, PERMISSIONS & RATE LIMITS
  // =========================================================================
  describe("5. Security Controls & Token Life Cycle", () => {
    it("generates LiveKit tokens with bounded expiry and validates room permissions", async () => {
      // 1. Valid member requests token
      const req = createMockHttp("POST", "/api/media/token", {
        roomCode: room.roomCode,
        userId: aliceId,
        sessionToken: aliceSessionToken,
      });

      const handled = await handleMediaRoute(req.req, req.res, mediaService, roomManager);
      expect(handled).toBe(true);
      expect(req.getStatus()).toBe(200);

      const body = req.getBody();
      expect(body.token).toBeDefined();
      expect(body.expiresAt).toBeGreaterThan(Date.now());

      // 2. Decode JWT to verify TTL/expiry claim
      const secretKey = new TextEncoder().encode(testApiSecret);
      const { payload } = await jwtVerify(body.token, secretKey);
      expect(payload.exp).toBeDefined();
      expect(payload.exp! * 1000).toBeGreaterThan(Date.now());

      // 3. Non-member request rejected with 401
      const rogueReq = createMockHttp("POST", "/api/media/token", {
        roomCode: room.roomCode,
        userId: "hacker_999",
      });
      await handleMediaRoute(rogueReq.req, rogueReq.res, mediaService, roomManager);
      expect(rogueReq.getStatus()).toBe(401);
      expect(rogueReq.getBody().code).toBe("UNAUTHORIZED");
    });

    it("revokes media tokens immediately when a member is kicked", async () => {
      // Alice is in voice
      room.updateVoiceState(aliceId, { inVoice: true, audioMuted: false, videoEnabled: false });

      // Host kicks Alice
      room.kickMember(hostId, 1, aliceId);

      // Verify token revocation in mediaService
      expect(mediaService.isUserRevoked(room.roomCode, aliceId)).toBe(true);

      // Subsequent token request is rejected with 403 TOKEN_REVOKED
      const req = createMockHttp("POST", "/api/media/token", {
        roomCode: room.roomCode,
        userId: aliceId,
        sessionToken: aliceSessionToken,
      });
      await handleMediaRoute(req.req, req.res, mediaService, roomManager);
      expect(req.getStatus()).toBe(403);
      expect(req.getBody().code).toBe("TOKEN_REVOKED");
    });

    it("revokes media tokens immediately when a member is banned and blocks re-entry", async () => {
      // Host bans Bob
      room.banMember(hostId, 1, bobId);

      // Verify token revocation
      expect(mediaService.isUserRevoked(room.roomCode, bobId)).toBe(true);

      // Subsequent token request is rejected with 403 USER_BANNED
      const req = createMockHttp("POST", "/api/media/token", {
        roomCode: room.roomCode,
        userId: bobId,
        sessionToken: bobSessionToken,
      });
      await handleMediaRoute(req.req, req.res, mediaService, roomManager);
      expect(req.getStatus()).toBe(403);
      expect(req.getBody().code).toBe("USER_BANNED");
    });

    it("enforces rate limits on media token requests (exceeding 30 req/min yields 429)", async () => {
      const clientIp = "192.168.1.55";

      // Make 30 allowed token requests
      for (let i = 0; i < 30; i++) {
        const req = createMockHttp(
          "POST",
          "/api/media/token",
          {
            roomCode: room.roomCode,
            userId: aliceId,
            sessionToken: aliceSessionToken,
          },
          clientIp
        );
        const handled = await handleMediaRoute(req.req, req.res, mediaService, roomManager);
        expect(handled).toBe(true);
        expect(req.getStatus()).toBe(200);
      }

      // 31st request from same IP within the minute window is rate limited
      const throttledReq = createMockHttp(
        "POST",
        "/api/media/token",
        {
          roomCode: room.roomCode,
          userId: aliceId,
          sessionToken: aliceSessionToken,
        },
        clientIp
      );
      await handleMediaRoute(throttledReq.req, throttledReq.res, mediaService, roomManager);
      expect(throttledReq.getStatus()).toBe(429);
      expect(throttledReq.getBody().code).toBe("RATE_LIMITED");
    });
  });
});
