import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { Room } from "../src/rooms/Room.js";
import { DurableRoomStorage, serializeRoom, deserializeRoom } from "../src/storage/DurableRoomStorage.js";

describe("Production Hardening: Reliability, Low Ops & Safe Defaults", () => {
  let tempStorageDir: string;
  let tempStorageFile: string;

  beforeEach(() => {
    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-durable-test-"));
    tempStorageFile = path.join(tempStorageDir, "rooms_state.json");
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempStorageDir)) {
        fs.rmSync(tempStorageDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe("Safe Defaults (Friends Inviting Friends of Friends)", () => {
    it("defaults requireLinkApproval and profanityFilterEnabled to true in newly created rooms", () => {
      const roomManager = new RoomManager();
      const { room } = roomManager.createRoom({
        hostUserName: "Alice",
        roomName: "Movie Night",
      });

      // Safe defaults: unapproved members must not be able to spam unvetted media
      expect(room.requireLinkApproval).toBe(true);
      expect(room.profanityFilterEnabled).toBe(true);
    });

    it("allows host to override requireLinkApproval or profanity filter if desired", () => {
      const roomManager = new RoomManager();
      const { room } = roomManager.createRoom({
        hostUserName: "Bob",
        roomName: "Open Room",
        requireLinkApproval: false,
        profanityFilterEnabled: false,
      });

      expect(room.requireLinkApproval).toBe(false);
      expect(room.profanityFilterEnabled).toBe(false);
    });
  });

  describe("Zero State Loss Across Server Restarts / Redeploys", () => {
    it("serializes and deserializes complete room state with high fidelity", () => {
      const roomManager = new RoomManager();
      const { room } = roomManager.createRoom({
        hostUserName: "HostUser",
        roomName: "Durable Room",
        initialVideoId: "movie_1",
      });

      // Add chat message
      room.broadcastChat(room.hostId, 1, "Hello world from host!");

      // Update playback
      room.applyPlay(room.hostId, 2, 25000);

      // Serialize
      const snapshot = serializeRoom(room);
      expect(snapshot.roomId).toBe(room.roomId);
      expect(snapshot.roomCode).toBe(room.roomCode);
      expect(snapshot.playback.status).toBe("playing");
      expect(snapshot.playback.positionMs).toBe(25000);
      expect(snapshot.chatHistory.length).toBeGreaterThan(0);
      expect(snapshot.members.length).toBe(1);

      // Deserialize into a fresh RoomManager instance
      const freshManager = new RoomManager();
      const restored = deserializeRoom(snapshot, freshManager);

      expect(restored.roomId).toBe(room.roomId);
      expect(restored.roomCode).toBe(room.roomCode);
      expect(restored.roomName).toBe("Durable Room");
      expect(restored.playback.status).toBe("playing");
      expect(restored.chatHistory.length).toBe(room.chatHistory.length);
      expect(restored.requireLinkApproval).toBe(true);
    });

    it("calculates elapsed playback position on silent resumption if video was playing", async () => {
      const now = Date.now();
      const snapshot = {
        roomId: "room_test_elapsed",
        roomCode: "ELAPSE",
        roomName: "Elapsed Test",
        baseUrl: "http://localhost:3000",
        hostId: "usr_host",
        version: 1,
        controlMode: "public" as const,
        roomType: "public" as const,
        maxMembers: 20,
        waitingRoomEnabled: false,
        autoApproveFriends: true,
        profanityFilterEnabled: true,
        slowModeSeconds: 0,
        requireLinkApproval: true,
        e2eeEnabled: false,
        playback: {
          videoId: "bunny",
          status: "playing" as const,
          positionMs: 10000,
          playbackRate: 1.0,
          serverTimeMs: now - 3500, // 3.5 seconds ago
        },
        playlist: [],
        members: [
          {
            userId: "usr_host",
            userName: "Host",
            role: "host" as const,
            isHost: true,
            sessionToken: "tok_host",
            joinedAt: now - 10000,
          },
        ],
        chatHistory: [],
        bannedUserIds: [],
        bannedAccountIds: [],
        bannedSessionTokens: [],
        snapshotTimestamp: now - 3500,
      };

      const freshManager = new RoomManager();
      const restored = deserializeRoom(snapshot, freshManager);

      // Restored position should account for the 3.5 seconds elapsed during restart
      expect(restored.playback.status).toBe("playing");
      expect(restored.playback.positionMs).toBeGreaterThanOrEqual(13400);
      expect(restored.playback.positionMs).toBeLessThanOrEqual(13600);
    });

    it("persists room state to durable disk storage and restores upon manager restart", async () => {
      // 1. Initial server run
      const storage1 = new DurableRoomStorage({
        storageFile: tempStorageFile,
        debounceMs: 0, // sync write for tests
      });
      const manager1 = new RoomManager();
      manager1.setRoomStorage(storage1);

      const { room: originalRoom, hostSessionToken } = manager1.createRoom({
        hostUserName: "Alice",
        roomName: "Friday Watch",
      });

      originalRoom.broadcastChat(originalRoom.hostId, 1, "Let's start the show!");
      originalRoom.applyPlay(originalRoom.hostId, 2, 42000);

      // Force flush to file
      await storage1.flush();
      expect(fs.existsSync(tempStorageFile)).toBe(true);

      // 2. Simulate server restart / container crash: new manager and storage instance
      const storage2 = new DurableRoomStorage({
        storageFile: tempStorageFile,
        debounceMs: 0,
      });
      const manager2 = new RoomManager();
      manager2.setRoomStorage(storage2);

      const restoredCount = await storage2.restoreRooms(manager2);
      expect(restoredCount).toBe(1);

      const restoredRoom = manager2.getRoomByCode(originalRoom.roomCode);
      expect(restoredRoom).toBeDefined();
      expect(restoredRoom?.roomId).toBe(originalRoom.roomId);
      expect(restoredRoom?.roomName).toBe("Friday Watch");
      expect(restoredRoom?.playback.status).toBe("playing");
      expect(restoredRoom?.playback.positionMs).toBeGreaterThanOrEqual(42000);

      // Verify host member was restored with exact session token so client silently reconnects
      const hostMember = restoredRoom?.getMember(originalRoom.hostId);
      expect(hostMember).toBeDefined();
      expect(hostMember?.sessionToken).toBe(hostSessionToken);
    });

    it("deletes room from durable storage when destroyed", async () => {
      const storage = new DurableRoomStorage({
        storageFile: tempStorageFile,
        debounceMs: 0,
      });
      const manager = new RoomManager();
      manager.setRoomStorage(storage);

      const { room } = manager.createRoom({
        hostUserName: "Charlie",
        roomName: "Temporary Room",
      });

      const loadedBefore = await storage.loadRoomSnapshot(room.roomId);
      expect(loadedBefore).toBeDefined();

      // Destroy room
      manager.removeRoom(room.roomId);

      const loadedAfter = await storage.loadRoomSnapshot(room.roomId);
      expect(loadedAfter).toBeNull();
    });
  });
});
