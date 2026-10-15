import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { WebSocket } from "ws";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { WebSocketGateway } from "../src/gateway/WebSocketGateway.js";
import { MemoryRedisService } from "../src/redis/RedisService.js";
import { RedisRoomAdapter } from "../src/redis/RedisRoomAdapter.js";
import { MetricsCollector } from "../src/metrics/MetricsCollector.js";
import { getGrafanaDashboardJson, getDashboardHtml } from "../src/metrics/DashboardPage.js";
import { WS_CLOSE_CODES, ServerMessage } from "@watchparty/shared";

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.on("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

describe("Redis Persistence & Multi-Node Observability Suite", () => {
  let redis: MemoryRedisService;
  let adapterNode1: RedisRoomAdapter;
  let adapterNode2: RedisRoomAdapter;
  let roomManager1: RoomManager;
  let roomManager2: RoomManager;

  let server: http.Server;
  let gateway: WebSocketGateway;
  let metricsCollector: MetricsCollector;
  let port: number;
  let isDraining = false;

  beforeAll(async () => {
    // 1. Shared In-Memory Redis
    redis = new MemoryRedisService();

    // 2. Node 1 Setup
    adapterNode1 = new RedisRoomAdapter(redis, "node-1");
    await adapterNode1.init();
    roomManager1 = new RoomManager("http://localhost:4001");
    roomManager1.setRedisAdapter(adapterNode1);

    // 3. Node 2 Setup (Simulates multi-instance or replacement server)
    adapterNode2 = new RedisRoomAdapter(redis, "node-2");
    await adapterNode2.init();
    roomManager2 = new RoomManager("http://localhost:4002");
    roomManager2.setRedisAdapter(adapterNode2);

    // 4. Test HTTP Server with Observability Endpoints
    metricsCollector = new MetricsCollector();
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      if (url.pathname === "/health") {
        metricsCollector.setActiveRooms(roomManager1.getActiveRoomCount());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "healthy",
            nodeId: "node-1",
            uptimeSeconds: 120,
            activeRooms: roomManager1.getActiveRoomCount(),
            connectedSockets: metricsCollector.getSummaryJson().connectedSockets,
          })
        );
        return;
      }

      if (url.pathname === "/ready") {
        if (isDraining) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "draining", ready: false }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ready", ready: true }));
        return;
      }

      if (url.pathname === "/metrics") {
        metricsCollector.setActiveRooms(roomManager1.getActiveRoomCount());
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
        res.end(metricsCollector.toPrometheusFormat());
        return;
      }

      if (url.pathname === "/api/metrics/summary") {
        metricsCollector.setActiveRooms(roomManager1.getActiveRoomCount());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(metricsCollector.getSummaryJson()));
        return;
      }

      if (url.pathname === "/api/metrics/dashboard.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(getGrafanaDashboardJson()));
        return;
      }

      if (url.pathname === "/dashboard") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getDashboardHtml());
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    gateway = new WebSocketGateway(server, roomManager1, {
      metricsCollector,
      redisAdapter: adapterNode1,
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await adapterNode1.disconnect();
    await adapterNode2.disconnect();
    await redis.disconnect();
    gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ==========================================
  // 1. REDIS SERVICE & DISTRIBUTED LOCKING
  // ==========================================
  describe("MemoryRedisService core contract", () => {
    it("handles key expiration and wildcard keys() matching", async () => {
      await redis.set("test:foo:1", "val1");
      await redis.set("test:foo:2", "val2");
      await redis.set("test:bar:1", "val3");

      const matched = await redis.keys("test:foo:*");
      expect(matched).toContain("test:foo:1");
      expect(matched).toContain("test:foo:2");
      expect(matched).not.toContain("test:bar:1");

      expect(await redis.get("test:foo:1")).toBe("val1");
      await redis.del("test:foo:1");
      expect(await redis.get("test:foo:1")).toBeNull();
    });

    it("guarantees single-owner atomic distributed locking", async () => {
      const lockKey = "lock:room_order_test";

      // Node 1 acquires lock
      const acquired1 = await redis.acquireLock(lockKey, "node-1", 5000);
      expect(acquired1).toBe(true);

      // Node 2 tries to acquire same lock -> rejected
      const acquired2 = await redis.acquireLock(lockKey, "node-2", 5000);
      expect(acquired2).toBe(false);

      // Node 2 cannot release Node 1's lock
      const releaseNode2 = await redis.releaseLock(lockKey, "node-2");
      expect(releaseNode2).toBe(false);

      // Node 1 renews its lock
      const renewed = await redis.renewLock(lockKey, "node-1", 6000);
      expect(renewed).toBe(true);

      // Node 1 releases lock
      const released = await redis.releaseLock(lockKey, "node-1");
      expect(released).toBe(true);

      // Now Node 2 can acquire lock
      const acquiredAfterRelease = await redis.acquireLock(lockKey, "node-2", 5000);
      expect(acquiredAfterRelease).toBe(true);
      await redis.releaseLock(lockKey, "node-2");
    });
  });

  // ==========================================
  // 2. ROOM PERSISTENCE & RESTORE ON RESTART
  // ==========================================
  describe("Redis Room Snapshot Persistence & Server Restart Restore", () => {
    it("saves room state snapshot to Redis and restores accurately on another node", async () => {
      // Create room on Node 1
      const { room } = roomManager1.createRoom({
        hostUserName: "Alice",
        roomName: "Movie Night 2026",
        controlMode: "host_only",
        roomPassword: "SuperSecretPassword123",
        initialVideoId: "elephants_dream",
      });

      // Update room state
      room.playback = {
        videoId: "elephants_dream",
        status: "playing",
        positionMs: 42000,
        playbackRate: 1.25,
        serverTimeMs: Date.now(),
      };
      room.playlist.push({
        id: "pl_demo_2",
        videoId: "sintel",
        title: "Sintel",
        durationMs: 312000,
        addedByUserId: room.hostId,
        addedByUserName: "Alice",
        order: 2000,
      });

      // Explicitly save snapshot to Redis
      await adapterNode1.saveRoomSnapshot(room);

      // Verify snapshot exists in Redis storage
      const snapshot = await adapterNode1.loadRoomSnapshot(room.roomId);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.roomName).toBe("Movie Night 2026");
      expect(snapshot!.playback.positionMs).toBe(42000);
      expect(snapshot!.playback.status).toBe("playing");
      expect(snapshot!.playlist.length).toBe(2);

      // Simulate Node 2 starting up (or server restart) and restoring rooms from Redis
      const restoredCount = await adapterNode2.restoreRooms(roomManager2);
      expect(restoredCount).toBeGreaterThanOrEqual(1);

      const restoredRoom = roomManager2.getRoomById(room.roomId);
      expect(restoredRoom).toBeDefined();
      expect(restoredRoom!.roomName).toBe("Movie Night 2026");
      expect(restoredRoom!.controlMode).toBe("host_only");
      expect(restoredRoom!.playback.videoId).toBe("elephants_dream");
      expect(restoredRoom!.playback.positionMs).toBe(42000);
      expect(restoredRoom!.playback.playbackRate).toBe(1.25);
      expect(restoredRoom!.playlist.length).toBe(2);
      expect(restoredRoom!.playlist[1].title).toBe("Sintel");

      // Verify lookup by room code works on Node 2
      const byCode = roomManager2.getRoomByCode(room.roomCode);
      expect(byCode).toBeDefined();
      expect(byCode!.roomId).toBe(room.roomId);
    });
  });

  // ==========================================
  // 3. MULTI-NODE REDIS PUB/SUB BROADCASTING
  // ==========================================
  describe("Multi-Node Cluster Broadcasting", () => {
    it("propagates room broadcasts across cluster nodes via Redis pub/sub", async () => {
      let receivedOnNode2: ServerMessage | null = null;
      adapterNode2.setRemoteBroadcastHandler((roomId, message) => {
        if (roomId === "room_cluster_test") {
          receivedOnNode2 = message;
        }
      });

      const broadcastMsg: ServerMessage = {
        type: "PLAYBACK_STATE",
        version: 5,
        payload: {
          videoId: "big_buck_bunny",
          status: "playing",
          positionMs: 15000,
          serverTimeMs: Date.now(),
          playbackRate: 1.0,
        },
      };

      // Node 1 publishes to cluster
      await adapterNode1.publishRoomBroadcast("room_cluster_test", broadcastMsg);

      // Give event loop tick for Redis pub/sub delivery
      await new Promise((r) => setTimeout(r, 20));

      expect(receivedOnNode2).not.toBeNull();
      expect(receivedOnNode2!.type).toBe("PLAYBACK_STATE");
      expect(receivedOnNode2!.version).toBe(5);
    });
  });

  // ==========================================
  // 4. OBSERVABILITY ENDPOINTS & PROMETHEUS
  // ==========================================
  describe("Observability Endpoints (/health, /ready, /metrics, /dashboard)", () => {
    it("serves liveness health probe (/health)", async () => {
      const res = await fetch(`http://localhost:${port}/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("healthy");
      expect(data.nodeId).toBe("node-1");
      expect(typeof data.uptimeSeconds).toBe("number");
    });

    it("serves readiness probe (/ready) and handles draining state", async () => {
      // 1. Initial ready state
      isDraining = false;
      const resReady = await fetch(`http://localhost:${port}/ready`);
      expect(resReady.status).toBe(200);
      const readyData = await resReady.json();
      expect(readyData.ready).toBe(true);

      // 2. Draining state returns 503
      isDraining = true;
      const resDraining = await fetch(`http://localhost:${port}/ready`);
      expect(resDraining.status).toBe(503);
      const drainData = await resDraining.json();
      expect(drainData.ready).toBe(false);
      expect(drainData.status).toBe("draining");

      // Reset
      isDraining = false;
    });

    it("exposes standard Prometheus OpenMetrics text format at /metrics", async () => {
      // Record sample metrics
      metricsCollector.setConnectedSockets(42);
      metricsCollector.setActiveRooms(5);
      metricsCollector.recordCommandLatency("PLAYBACK_PLAY", 0.015);
      metricsCollector.recordCommandLatency("CHAT_SEND", 0.008);
      metricsCollector.recordDrift(12.5);
      metricsCollector.recordReconnect(true);
      metricsCollector.recordError("RATE_LIMITED");

      const res = await fetch(`http://localhost:${port}/metrics`);
      expect(res.status).toBe(200);
      const text = await res.text();

      // Check key Prometheus metrics
      expect(text).toContain("# HELP watchparty_connected_sockets");
      expect(text).toContain("watchparty_connected_sockets 42");
      expect(text).toContain("# HELP watchparty_active_rooms");
      expect(text).toContain("watchparty_active_rooms");
      expect(text).toContain("# HELP watchparty_command_latency_seconds");
      expect(text).toContain("watchparty_command_latency_seconds_bucket");
      expect(text).toContain("# HELP watchparty_drift_milliseconds");
      expect(text).toContain("watchparty_drift_milliseconds_bucket");
      expect(text).toContain("watchparty_reconnect_total{status=\"success\"}");
      expect(text).toContain("watchparty_errors_total{code=\"RATE_LIMITED\"}");
    });

    it("exports JSON metrics summary with percentiles (/api/metrics/summary)", async () => {
      const res = await fetch(`http://localhost:${port}/api/metrics/summary`);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(typeof data.uptimeSeconds).toBe("number");
      expect(typeof data.connectedSockets).toBe("number");
      expect(typeof data.commandLatency.avgMs).toBe("number");
      expect(typeof data.commandLatency.p95).toBe("number");
      expect(typeof data.drift.avgMs).toBe("number");
      expect(typeof data.drift.maxMs).toBe("number");
    });

    it("exports Grafana Dashboard JSON model (/api/metrics/dashboard.json)", async () => {
      const res = await fetch(`http://localhost:${port}/api/metrics/dashboard.json`);
      expect(res.status).toBe(200);
      const json = await res.json();

      expect(json.panels).toBeDefined();
      expect(json.panels.length).toBeGreaterThanOrEqual(6);
      const titles = json.panels.map((p: any) => p.title);
      expect(titles).toContain("Active Rooms");
      expect(titles).toContain("Connected Sockets");
      expect(titles).toContain("Latency (p95)");
    });

    it("serves interactive HTML dashboard page (/dashboard)", async () => {
      const res = await fetch(`http://localhost:${port}/dashboard`);
      expect(res.status).toBe(200);
      const html = await res.text();

      expect(html).toContain("WatchParty - Metrics & Cluster Dashboard");
      expect(html).toContain("id=\"connectedSockets\"");
      expect(html).toContain("id=\"latencyP95\"");
      expect(html).toContain("id=\"maxDrift\"");
    });
  });

  // ==========================================
  // 5. GRACEFUL DRAIN & RECONNECT NOTIFICATION
  // ==========================================
  describe("Graceful Shutdown & Connection Drain", () => {
    it("notifies connected clients with code 1012 SERVICE_RESTART when draining", async () => {
      const ws = await connectWs(port);
      const closePromise = waitForClose(ws);

      // Initiate graceful drain with SERVICE_RESTART (1012)
      await gateway.drainAndClose(WS_CLOSE_CODES.SERVICE_RESTART, "Server is restarting, please reconnect");

      const closeEvent = await closePromise;
      expect(closeEvent.code).toBe(1012);
      expect(closeEvent.reason).toContain("Server is restarting");
    });
  });
});
