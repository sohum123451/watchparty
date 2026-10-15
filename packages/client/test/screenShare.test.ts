import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MeshScreenShareTransport,
  SfuScreenShareTransport,
  ScreenShareManager,
  BITRATE_PRESET_MAP,
  ScreenShareAdapter,
  SyncHealthMonitor,
  ClockSync,
  PlaybackSyncEngine,
} from "../src/index.js";
import { ServerMessage, ClientMessage } from "@watchparty/shared";

describe("Client Screen Share Transport & Manager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("1. MeshScreenShareTransport", () => {
    it("reports mesh mode and transmits signaling to peer viewers", async () => {
      const signals: any[] = [];
      const transport = new MeshScreenShareTransport({
        localUserId: "user_sharer",
        isPublisher: true,
        peerUserIds: ["viewer_1", "viewer_2"],
        sendSignal: (targetUserId, signalType, signalData) => {
          signals.push({ targetUserId, signalType, signalData });
        },
      });

      expect(transport.mode).toBe("mesh");

      // In publisher mode, publishing stream sends offers to peers
      await transport.publishStream({
        id: "stream_1",
        getTracks: () => [],
      } as any);

      // Verify signals generated for peers
      expect(signals.length).toBeGreaterThanOrEqual(1);

      // Bitrate adaptation
      await transport.setBitrate(1_500_000);

      // Stats collection
      const stats = await transport.getStats();
      expect(stats).not.toBeNull();
      if (stats) {
        expect(stats.rttMs).toBeGreaterThan(0);
        expect(stats.liveDelayMs).toBeGreaterThan(0);
        expect(stats.bitrateBps).toBe(1_500_000);
      }

      transport.destroy();
    });

    it("subscribes to remote stream as viewer and delivers tracks", async () => {
      const signals: any[] = [];
      const transport = new MeshScreenShareTransport({
        localUserId: "viewer_1",
        isPublisher: false,
        sharerUserId: "user_sharer",
        sendSignal: (targetUserId, signalType, signalData) => {
          signals.push({ targetUserId, signalType, signalData });
        },
      });

      expect(transport.mode).toBe("mesh");
      let remoteStreamReceived = false;
      transport.onRemoteStream((_stream) => {
        remoteStreamReceived = true;
      });

      await transport.subscribeStream();
      transport.destroy();
    });
  });

  describe("2. SfuScreenShareTransport", () => {
    it("reports sfu mode and adapts bitrate layers (High, Medium, Low)", async () => {
      const signals: any[] = [];
      const transport = new SfuScreenShareTransport({
        localUserId: "user_sharer",
        isPublisher: true,
        sendSignal: (targetUserId, signalType, signalData) => {
          signals.push({ targetUserId, signalType, signalData });
        },
      });

      expect(transport.mode).toBe("sfu");

      // High layer (3.0 Mbps)
      await transport.setBitrate(3_000_000);
      let stats = await transport.getStats();
      expect(stats?.resolution).toBe("1920x1080");
      expect(stats?.fps).toBe(30);

      // Low layer (500 kbps)
      await transport.setBitrate(500_000);
      stats = await transport.getStats();
      expect(stats?.resolution).toBe("854x480");
      expect(stats?.fps).toBe(15);

      transport.destroy();
    });

    it("subscribes downstream through SFU router for high room viewer counts", async () => {
      const signals: any[] = [];
      const transport = new SfuScreenShareTransport({
        localUserId: "viewer_10",
        isPublisher: false,
        sendSignal: (targetUserId, signalType, signalData) => {
          signals.push({ targetUserId, signalType, signalData });
        },
      });

      await transport.subscribeStream();
      expect(signals.some((s) => s.targetUserId === "sfu-router")).toBe(true);

      const stats = await transport.getStats();
      expect(stats?.liveDelayMs).toBeLessThanOrEqual(50);

      transport.destroy();
    });
  });

  describe("3. ScreenShareManager Orchestration & Access Control", () => {
    it("enforces permission access: denies unapproved member and authorizes host", () => {
      const hostManager = new ScreenShareManager({
        localUserId: "user_host",
        localUserName: "Host",
        isHost: true,
        getMemberCount: () => 3,
        getMemberIds: () => ["user_host", "viewer_1", "viewer_2"],
        sendMessage: vi.fn(),
      });

      expect(hostManager.canShare()).toBe(true);

      const guestManager = new ScreenShareManager({
        localUserId: "viewer_1",
        localUserName: "Guest Alice",
        isHost: false,
        getMemberCount: () => 3,
        getMemberIds: () => ["user_host", "viewer_1", "viewer_2"],
        sendMessage: vi.fn(),
      });

      expect(guestManager.canShare()).toBe(false);

      // Guest granted permission
      guestManager.handleServerMessage({
        type: "SCREEN_SHARE_PERMISSION_GRANTED",
        payload: { targetUserId: "viewer_1", grantedBy: "user_host" },
      });
      expect(guestManager.canShare()).toBe(true);

      // Guest revoked permission
      guestManager.handleServerMessage({
        type: "SCREEN_SHARE_PERMISSION_REVOKED",
        payload: { targetUserId: "viewer_1", revokedBy: "user_host" },
      });
      expect(guestManager.canShare()).toBe(false);
    });

    it("automatically selects Mesh transport for <10 members and SFU for >=10 members", async () => {
      const sentMessages: ClientMessage[] = [];
      let memberCount = 5;

      const manager = new ScreenShareManager({
        localUserId: "user_host",
        localUserName: "Host",
        isHost: true,
        getMemberCount: () => memberCount,
        getMemberIds: () => ["user_host", "m1", "m2", "m3", "m4"],
        sendMessage: (msg) => sentMessages.push(msg),
      });

      // Start in small room (<10 members)
      await manager.startScreenShare({ title: "Mesh Presentation" });
      expect(manager.getState().transportMode).toBe("mesh");
      expect(sentMessages.some((m) => m.type === "SCREEN_SHARE_START")).toBe(true);

      manager.stopScreenShare();

      // Now expand room to 12 members
      memberCount = 12;
      await manager.startScreenShare({ title: "SFU Auditorium" });
      expect(manager.getState().transportMode).toBe("sfu");

      manager.destroy();
    });

    it("adapts bitrate presets (high: 3.0M, medium: 1.5M, low: 500k)", async () => {
      const manager = new ScreenShareManager({
        localUserId: "user_host",
        localUserName: "Host",
        isHost: true,
        getMemberCount: () => 4,
        getMemberIds: () => ["user_host", "m1", "m2", "m3"],
        sendMessage: vi.fn(),
      });

      await manager.startScreenShare();

      await manager.setBitratePreset("medium");
      expect(manager.getState().bitratePreset).toBe("medium");

      await manager.setBitratePreset("low");
      expect(manager.getState().bitratePreset).toBe("low");

      manager.destroy();
    });

    it("handles viewer mode and updates sync health monitor with live edge metrics", async () => {
      const clockSync = new ClockSync({ sendPing: vi.fn() });
      const adapter = new ScreenShareAdapter();
      const syncEngine = new PlaybackSyncEngine({
        adapter,
        sendPing: vi.fn(),
      });
      const healthMonitor = new SyncHealthMonitor({
        clockSync,
        syncEngine,
      });

      const sentMessages: ClientMessage[] = [];
      const viewerManager = new ScreenShareManager({
        localUserId: "viewer_1",
        localUserName: "Viewer Bob",
        isHost: false,
        getMemberCount: () => 3,
        getMemberIds: () => ["host_1", "viewer_1", "viewer_2"],
        sendMessage: (msg) => sentMessages.push(msg),
        syncHealthMonitor: healthMonitor,
      });

      // Host starts screen share
      await viewerManager.handleServerMessage({
        type: "SCREEN_SHARE_STARTED",
        payload: {
          sharerUserId: "host_1",
          sharerUserName: "Host",
          title: "Product Keynote",
          hasAudio: true,
          transportMode: "mesh",
          startedAtMs: Date.now(),
        },
      });

      expect(viewerManager.getState().activeSession?.sharerUserId).toBe("host_1");
      expect(viewerManager.getState().isSharing).toBe(false);

      // Advance timer to trigger periodic metrics reporting loop
      await vi.advanceTimersByTimeAsync(2100);

      // Health monitor should reflect the live edge delay (<100ms)
      const summary = healthMonitor.getSummary();
      expect(summary.p50DriftMs).toBeGreaterThan(0);
      expect(summary.p50DriftMs).toBeLessThanOrEqual(100);

      // Verify that metrics report was sent to server
      expect(sentMessages.some((m) => m.type === "SCREEN_SHARE_METRICS_REPORT")).toBe(true);

      // Host stops screen share
      await viewerManager.handleServerMessage({
        type: "SCREEN_SHARE_STOPPED",
        payload: { sharerUserId: "host_1", reason: "user_stopped" },
      });

      expect(viewerManager.getState().activeSession).toBeNull();
      viewerManager.destroy();
    });
  });
});
