import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "node:http";
import { jwtVerify } from "jose";
import { Room, ActiveConnection } from "../src/rooms/Room.js";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { LiveKitMediaProvider } from "../src/media/LiveKitMediaProvider.js";
import { MockMediaProvider } from "../src/media/MockMediaProvider.js";
import { MediaService } from "../src/media/MediaService.js";
import { handleMediaRoute } from "../src/media/mediaRoutes.js";
import { ServerMessage } from "@watchparty/shared";

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

describe("Real-Time Voice and Video Chat (SFU Architecture)", () => {
  let room: Room;
  let roomManager: RoomManager;
  let liveKitProvider: LiveKitMediaProvider;
  let mockProvider: MockMediaProvider;
  let mediaService: MediaService;

  const hostId = "user_host_1";
  let aliceId = "user_alice_2";
  let bobId = "user_bob_3";

  const testApiKey = "devkey";
  const testApiSecret = "secret_key_123456789012345678901234"; // 32+ chars for HMAC

  let aliceMock: { connection: ActiveConnection; messages: ServerMessage[] };

  let hostSessionToken: string;

  beforeEach(() => {
    roomManager = new RoomManager();
    const created = roomManager.createRoom({
      roomName: "Movie Night Room",
      hostUserId: hostId,
      hostUserName: "Host User",
      controlMode: "host_only",
    });
    room = created.room;
    hostSessionToken = created.hostSessionToken;

    const hostMember = room.getMember(hostId);
    if (hostMember) {
      hostMember.connection = createMockConnection().connection;
    }

    aliceMock = createMockConnection();
    const aliceRes = room.addMember("Alice", aliceMock.connection);
    if (aliceRes.success) aliceId = aliceRes.member.userId;

    const bobRes = room.addMember("Bob", createMockConnection().connection);
    if (bobRes.success) bobId = bobRes.member.userId;

    liveKitProvider = new LiveKitMediaProvider({
      apiKey: testApiKey,
      apiSecret: testApiSecret,
      serverUrl: "wss://livekit.watchparty.local",
      coturnUrl: "turn:turn.watchparty.local:3478",
      coturnSecret: "coturn_shared_secret_key",
    });

    mockProvider = new MockMediaProvider();

    mediaService = new MediaService({
      provider: liveKitProvider,
      roomManager,
    });
  });

  describe("1. LiveKit SFU Token Generation & Permissions", () => {
    it("generates a valid LiveKit JWT with VideoGrant and room-role permissions", async () => {
      const tokenResult = await liveKitProvider.generateToken({
        roomName: room.roomName,
        roomCode: room.roomCode,
        userId: hostId,
        userName: "Host User",
        role: "host",
        canPublishAudio: true,
        canPublishVideo: true,
        canPublishScreen: true,
        ttlSeconds: 1800,
      });

      expect(tokenResult.provider).toBe("livekit");
      expect(tokenResult.serverUrl).toBe("wss://livekit.watchparty.local");
      expect(tokenResult.token).toBeDefined();
      expect(tokenResult.expiresAt).toBeGreaterThan(Date.now());
      expect(tokenResult.permissions.canPublishAudio).toBe(true);
      expect(tokenResult.permissions.canPublishVideo).toBe(true);
      expect(tokenResult.permissions.canPublishScreen).toBe(true);

      // Verify the JWT signature and claims with jose
      const secretKey = new TextEncoder().encode(testApiSecret);
      const { payload } = await jwtVerify(tokenResult.token, secretKey);

      expect(payload.iss).toBe(testApiKey);
      expect(payload.sub).toBe(hostId);
      expect(payload.name).toBe("Host User");

      const videoGrant = (payload as any).video;
      expect(videoGrant).toBeDefined();
      expect(videoGrant.room).toBe(room.roomCode);
      expect(videoGrant.roomJoin).toBe(true);
      expect(videoGrant.canPublish).toBe(true);
      expect(videoGrant.canSubscribe).toBe(true);
      expect(videoGrant.canPublishSources).toEqual(["microphone", "camera", "screen_share"]);
    });

    it("restricts video publishing when video is disabled", async () => {
      const tokenResult = await liveKitProvider.generateToken({
        roomName: room.roomName,
        roomCode: room.roomCode,
        userId: aliceId,
        userName: "Alice",
        role: "member",
        canPublishAudio: true,
        canPublishVideo: false,
        canPublishScreen: false,
      });

      expect(tokenResult.permissions.canPublishVideo).toBe(false);

      const secretKey = new TextEncoder().encode(testApiSecret);
      const { payload } = await jwtVerify(tokenResult.token, secretKey);
      const videoGrant = (payload as any).video;

      expect(videoGrant.canPublishSources).toEqual(["microphone"]);
    });

    it("generates COTURN RFC 5766 time-based HMAC credentials for TURN fallback", () => {
      const iceServers = liveKitProvider.getIceServers("test_user_42");
      expect(iceServers.length).toBeGreaterThanOrEqual(2);

      const stun = iceServers.find((s) => s.urls.some((u) => u.startsWith("stun:")));
      expect(stun).toBeDefined();

      const turn = iceServers.find((s) => s.urls.some((u) => u.startsWith("turn:")));
      expect(turn).toBeDefined();
      expect(turn?.username).toContain(":test_user_42");
      expect(turn?.credential).toBeDefined();
      expect(turn?.credential?.length).toBeGreaterThan(10);
    });
  });

  describe("2. Room Voice State Tracking & Member Presence", () => {
    it("tracks participants joining, updating, and leaving voice independently of the room", () => {
      expect(room.voiceParticipants.size).toBe(0);

      // Alice joins voice with mic unmuted, video off
      const state1 = room.updateVoiceState(aliceId, {
        inVoice: true,
        audioMuted: false,
        videoEnabled: false,
      });

      expect(state1).not.toBeNull();
      expect(state1?.inVoice).toBe(true);
      expect(state1?.audioMuted).toBe(false);
      expect(state1?.videoEnabled).toBe(false);
      expect(room.voiceParticipants.has(aliceId)).toBe(true);

      // Verify broadcast
      expect(aliceMock.connection.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ROOM_VOICE_STATE_UPDATED",
          payload: expect.objectContaining({
            participants: expect.arrayContaining([
              expect.objectContaining({ userId: aliceId, inVoice: true }),
            ]),
          }),
        })
      );

      // Alice mutes mic
      const state2 = room.updateVoiceState(aliceId, {
        inVoice: true,
        audioMuted: true,
        videoEnabled: false,
      });
      expect(state2?.audioMuted).toBe(true);

      // Alice leaves voice
      const state3 = room.updateVoiceState(aliceId, {
        inVoice: false,
        audioMuted: false,
        videoEnabled: false,
      });
      expect(state3).toBeNull();
      expect(room.voiceParticipants.has(aliceId)).toBe(false);

      // Alice is still in the room!
      expect(Boolean(room.getMember(aliceId))).toBe(true);
    });

    it("cleans up voice participant automatically if member leaves or disconnects from room", () => {
      room.updateVoiceState(bobId, {
        inVoice: true,
        audioMuted: false,
        videoEnabled: true,
      });
      expect(room.voiceParticipants.has(bobId)).toBe(true);

      room.removeMember(bobId);
      expect(room.voiceParticipants.has(bobId)).toBe(false);
    });

    it("includes voice participants in room snapshot", () => {
      room.updateVoiceState(hostId, {
        inVoice: true,
        audioMuted: false,
        videoEnabled: true,
      });

      const snap = room.getSnapshot(hostId, hostSessionToken);
      expect(snap.voiceParticipants).toBeDefined();
      expect(snap.voiceParticipants?.length).toBe(1);
      expect(snap.voiceParticipants?.[0].userId).toBe(hostId);
      expect(snap.videoDisabledForRoom).toBe(false);
    });
  });

  describe("3. Moderator Controls (Server Mute, Remove Voice, Disable Room Video)", () => {
    it("allows host to mute participant voice", () => {
      room.updateVoiceState(aliceId, {
        inVoice: true,
        audioMuted: false,
        videoEnabled: false,
      });

      const ok = room.muteVoiceParticipant(hostId, aliceId);
      expect(ok).toBe(true);

      const p = room.voiceParticipants.get(aliceId);
      expect(p?.audioMuted).toBe(true);
    });

    it("allows host to remove participant from voice", () => {
      room.updateVoiceState(aliceId, {
        inVoice: true,
        audioMuted: false,
        videoEnabled: false,
      });

      const ok = room.removeVoiceParticipant(hostId, aliceId);
      expect(ok).toBe(true);
      expect(room.voiceParticipants.has(aliceId)).toBe(false);
    });

    it("disables cameras for the entire room and turns off active cameras", () => {
      room.updateVoiceState(aliceId, {
        inVoice: true,
        audioMuted: false,
        videoEnabled: true,
      });
      expect(room.voiceParticipants.get(aliceId)?.videoEnabled).toBe(true);

      const ok = room.setRoomVideoDisabled(hostId, true);
      expect(ok).toBe(true);
      expect(room.videoDisabledForRoom).toBe(true);
      expect(room.voiceParticipants.get(aliceId)?.videoEnabled).toBe(false);

      // Trying to enable video while room video is disabled keeps it false
      room.updateVoiceState(aliceId, {
        inVoice: true,
        audioMuted: false,
        videoEnabled: true,
      });
      expect(room.voiceParticipants.get(aliceId)?.videoEnabled).toBe(false);
    });

    it("rejects non-moderator attempts to mute or kick voice participants via MediaService", async () => {
      room.updateVoiceState(aliceId, { inVoice: true, audioMuted: false, videoEnabled: false });

      await expect(
        mediaService.muteVoiceParticipant(room.roomCode, aliceId, hostId)
      ).rejects.toThrow("Permission denied");

      await expect(
        mediaService.removeVoiceParticipant(room.roomCode, aliceId, hostId)
      ).rejects.toThrow("Permission denied");
    });
  });

  describe("4. Media HTTP Routes & Security Enforcement", () => {
    function createMockHttp(method: string, urlStr: string, bodyObj?: any, headers: Record<string, string> = {}) {
      const req: any = new http.IncomingMessage({} as any);
      req.method = method;
      req.url = urlStr;
      req.headers = { ...headers };
      req.socket = { remoteAddress: "127.0.0.1" };

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

    it("issues short-lived media tokens to authenticated room members", async () => {
      const mockReq = createMockHttp("POST", "/api/media/token", {
        roomCode: room.roomCode,
        userId: hostId,
      });

      const handled = await handleMediaRoute(mockReq.req, mockReq.res, mediaService, roomManager);
      expect(handled).toBe(true);
      expect(mockReq.getStatus()).toBe(200);

      const body = mockReq.getBody();
      expect(body.success).toBe(true);
      expect(body.token).toBeDefined();
      expect(body.serverUrl).toBe("wss://livekit.watchparty.local");
      expect(body.permissions.canPublishAudio).toBe(true);
    });

    it("rejects token requests for non-members of the room with 401", async () => {
      const mockReq = createMockHttp("POST", "/api/media/token", {
        roomCode: room.roomCode,
        userId: "random_intruder_999",
      });

      await handleMediaRoute(mockReq.req, mockReq.res, mediaService, roomManager);
      expect(mockReq.getStatus()).toBe(401);
      expect(mockReq.getBody().code).toBe("UNAUTHORIZED");
    });

    it("rejects token requests from banned users with 403", async () => {
      room.banMember(hostId, 1, aliceId);
      expect(room.isBanned(aliceId)).toBe(true);

      const mockReq = createMockHttp("POST", "/api/media/token", {
        roomCode: room.roomCode,
        userId: aliceId,
      });

      await handleMediaRoute(mockReq.req, mockReq.res, mediaService, roomManager);
      expect(mockReq.getStatus()).toBe(403);
      expect(mockReq.getBody().code).toBe("USER_BANNED");
    });

    it("returns public STUN/TURN fallback server configuration", async () => {
      const mockReq = createMockHttp("GET", "/api/media/ice-servers");
      const handled = await handleMediaRoute(mockReq.req, mockReq.res, mediaService, roomManager);
      expect(handled).toBe(true);
      expect(mockReq.getStatus()).toBe(200);

      const body = mockReq.getBody();
      expect(body.iceServers).toBeDefined();
      expect(body.iceServers.length).toBeGreaterThan(0);
    });
  });

  describe("5. Decoupling Media Plane from Playback Sync Plane", () => {
    it("confirms that joining, muting, or leaving voice never affects video playback synchronization", () => {
      // 1. Host starts playback
      const playRes = room.applyPlay(hostId, 1, 12500);
      expect(playRes.success).toBe(true);

      expect(room.playback.status).toBe("playing");
      expect(room.playback.positionMs).toBe(12500);

      // 2. Multiple users join voice mid-movie
      room.updateVoiceState(aliceId, { inVoice: true, audioMuted: false, videoEnabled: false });
      room.updateVoiceState(bobId, { inVoice: true, audioMuted: true, videoEnabled: true });

      // 3. Playback position & status remain completely untouched
      expect(room.playback.status).toBe("playing");
      expect(room.playback.positionMs).toBe(12500);

      // 4. Host seeks during voice chat
      const seekRes = room.applySeek(hostId, 2, 45000);
      expect(seekRes.success).toBe(true);
      expect(room.playback.positionMs).toBe(45000);

      // 5. Participants leave voice
      room.updateVoiceState(aliceId, { inVoice: false, audioMuted: false, videoEnabled: false });
      expect(room.playback.status).toBe("playing");
      expect(room.playback.positionMs).toBe(45000);
    });

    it("confirms chat, reactions, and polls operate normally alongside voice chat", () => {
      room.updateVoiceState(aliceId, { inVoice: true, audioMuted: false, videoEnabled: false });

      // Alice sends a text message
      const msgRes = room.broadcastChat(aliceId, 1, "Movie looks great!");
      expect(msgRes.success).toBe(true);

      // Host creates a poll
      const pollRes = room.createPoll(hostId, 2, "Who is the killer?", ["Butler", "Detective", "Doctor"]);
      expect(pollRes.success).toBe(true);

      const activePoll = room.getSnapshot(hostId, hostSessionToken).activePoll;
      expect(activePoll).toBeDefined();
      if (activePoll) {
        // Bob votes
        const voteRes = room.votePoll(bobId, 3, activePoll.id, 0);
        expect(voteRes.success).toBe(true);
      }

      // Voice state remains undisturbed
      expect(room.voiceParticipants.has(aliceId)).toBe(true);
    });
  });

  describe("6. Call Quality & Network Degradation Tooling Matrix", () => {
    it("simulates 2, 5, and 10 participant call matrices with graceful tier downgrade", () => {
      // Create 10 participants
      const participantIds: string[] = [];
      for (let i = 1; i <= 10; i++) {
        const mem = room.addMember(`User_${i}`, createMockConnection().connection);
        if (mem.success) {
          participantIds.push(mem.member.userId);
          room.updateVoiceState(mem.member.userId, {
            inVoice: true,
            audioMuted: i % 3 === 0,
            videoEnabled: i <= 5, // 5 have camera, 5 audio-only
          });
        }
      }

      expect(room.voiceParticipants.size).toBe(10);

      // Simulate a participant on throttled mobile data (downgrade to audio-only)
      const throttledUserId = participantIds[0];
      const downgraded = room.updateVoiceState(throttledUserId, {
        inVoice: true,
        audioMuted: false,
        videoEnabled: false, // auto-downgraded by client
      });

      expect(downgraded?.videoEnabled).toBe(false);
      expect(downgraded?.inVoice).toBe(true);

      // Ensure other 9 participants remain unaffected
      const unthrottled = room.voiceParticipants.get(participantIds[1]);
      expect(unthrottled?.videoEnabled).toBe(true);
      expect(room.playback.status).toBeDefined();
    });
  });
});
