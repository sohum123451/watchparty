import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { WebSocket } from "ws";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { WebSocketGateway } from "../src/gateway/WebSocketGateway.js";
import { ServerMessage, ClientMessage, ERROR_CODES } from "@watchparty/shared";

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function waitForMessage(
  ws: WebSocket,
  filter?: (msg: ServerMessage) => boolean
): Promise<ServerMessage> {
  return new Promise((resolve) => {
    const handler = (data: Buffer | string) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (!filter || filter(msg)) {
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

describe("WebSocket Gateway Integration", () => {
  let server: http.Server;
  let gateway: WebSocketGateway;
  let roomManager: RoomManager;
  let port: number;

  beforeAll(async () => {
    roomManager = new RoomManager();
    server = http.createServer();
    gateway = new WebSocketGateway(server, roomManager);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === "object") {
          port = address.port;
          roomManager.setBaseUrl(`http://localhost:${port}`);
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("handles NTP SYNC_PING with minimal round-trip latency", async () => {
    const ws = await connectWs(port);
    const t0 = Date.now();

    const pongPromise = waitForMessage(ws, (m) => m.type === "SYNC_PONG");
    ws.send(
      JSON.stringify({
        type: "SYNC_PING",
        payload: { clientSendTimeMs: t0 },
      })
    );

    const pongMsg = await pongPromise;
    expect(pongMsg.type).toBe("SYNC_PONG");
    if (pongMsg.type === "SYNC_PONG") {
      expect(pongMsg.payload.clientSendTimeMs).toBe(t0);
      expect(pongMsg.payload.serverReceiveTimeMs).toBeGreaterThanOrEqual(t0);
      expect(pongMsg.payload.serverSendTimeMs).toBeGreaterThanOrEqual(
        pongMsg.payload.serverReceiveTimeMs
      );
    }
    ws.close();
  });

  it("executes room creation, multi-client joining, and playback broadcasting", async () => {
    const hostWs = await connectWs(port);

    // 1. Host creates room
    const hostSnapshotPromise = waitForMessage(hostWs, (m) => m.type === "ROOM_SNAPSHOT");
    hostWs.send(
      JSON.stringify({
        type: "ROOM_CREATE",
        clientSeq: 1,
        payload: {
          userName: "AliceHost",
          roomName: "Premiere Night",
          controlMode: "host_only",
        },
      })
    );

    const hostSnapshot = await hostSnapshotPromise;
    expect(hostSnapshot.type).toBe("ROOM_SNAPSHOT");
    if (hostSnapshot.type !== "ROOM_SNAPSHOT") return;

    const roomCode = hostSnapshot.payload.roomCode;
    expect(roomCode).toHaveLength(6);
    expect(hostSnapshot.payload.controlMode).toBe("host_only");

    // 2. Peer joins room
    const peerWs = await connectWs(port);
    const peerSnapshotPromise = waitForMessage(peerWs, (m) => m.type === "ROOM_SNAPSHOT");
    const hostPeerJoinedPromise = waitForMessage(hostWs, (m) => m.type === "ROOM_MEMBER_JOINED");

    peerWs.send(
      JSON.stringify({
        type: "ROOM_JOIN",
        clientSeq: 1,
        payload: {
          roomCode,
          userName: "BobGuest",
        },
      })
    );

    const [peerSnapshot, hostPeerJoined] = await Promise.all([
      peerSnapshotPromise,
      hostPeerJoinedPromise,
    ]);

    expect(peerSnapshot.type).toBe("ROOM_SNAPSHOT");
    expect(hostPeerJoined.type).toBe("ROOM_MEMBER_JOINED");

    // 3. Peer attempts unauthorized seek in host_only room
    const peerErrorPromise = waitForMessage(peerWs, (m) => m.type === "ERROR");
    peerWs.send(
      JSON.stringify({
        type: "PLAYBACK_SEEK",
        clientSeq: 2,
        payload: {
          targetPositionMs: 50000,
        },
      })
    );

    const peerError = await peerErrorPromise;
    expect(peerError.type).toBe("ERROR");
    if (peerError.type === "ERROR") {
      expect(peerError.code).toBe(ERROR_CODES.PERMISSION_DENIED);
      expect(peerError.clientSeq).toBe(2);
    }

    // 4. Host issues seek -> broadcasts to both
    const hostUpdatePromise = waitForMessage(hostWs, (m) => m.type === "PLAYBACK_UPDATE");
    const peerUpdatePromise = waitForMessage(peerWs, (m) => m.type === "PLAYBACK_UPDATE");

    hostWs.send(
      JSON.stringify({
        type: "PLAYBACK_SEEK",
        clientSeq: 2,
        payload: {
          targetPositionMs: 65000,
        },
      })
    );

    const [hostUpdate, peerUpdate] = await Promise.all([hostUpdatePromise, peerUpdatePromise]);
    expect(hostUpdate.type).toBe("PLAYBACK_UPDATE");
    expect(peerUpdate.type).toBe("PLAYBACK_UPDATE");

    if (peerUpdate.type === "PLAYBACK_UPDATE") {
      expect(peerUpdate.payload.playback.positionMs).toBe(65000);
      expect(peerUpdate.payload.causedBy.clientSeq).toBe(2);
    }

    hostWs.close();
    peerWs.close();
  });

  it("enforces rate limits on flood traffic", async () => {
    const ws = await connectWs(port);

    // Send a burst exceeding token bucket capacity (30 tokens)
    let rateLimitedReceived = false;
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === "ERROR" && msg.code === ERROR_CODES.RATE_LIMITED) {
        rateLimitedReceived = true;
      }
    });

    for (let i = 0; i < 45; i++) {
      ws.send(
        JSON.stringify({
          type: "SYNC_PING",
          payload: { clientSendTimeMs: Date.now() },
        })
      );
    }

    for (let i = 0; i < 20 && !rateLimitedReceived; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(rateLimitedReceived).toBe(true);
    ws.close();
  });
});
