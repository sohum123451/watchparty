import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { WebSocket } from "ws";
import {
  defaultSecurityMiddleware,
  SecurityMiddleware,
} from "../src/security/headers.js";
import { FieldEncryption } from "../src/security/FieldEncryption.js";
import { AuditLogger } from "../src/security/AuditLogger.js";
import { RoomManager } from "../src/rooms/RoomManager.js";
import { WebSocketGateway } from "../src/gateway/WebSocketGateway.js";
import { ERROR_CODES, WS_CLOSE_CODES, safeJsonParse, sanitizeObject } from "@watchparty/shared";

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function sendJson(ws: WebSocket, payload: any): void {
  ws.send(JSON.stringify(payload));
}

function waitForMessage<T = any>(ws: WebSocket, predicate?: (msg: T) => boolean): Promise<T> {
  return new Promise((resolve) => {
    const handler = (data: any) => {
      const parsed = JSON.parse(data.toString());
      if (!predicate || predicate(parsed)) {
        ws.off("message", handler);
        resolve(parsed);
      }
    };
    ws.on("message", handler);
  });
}

describe("App Security & Transport Hardening Suite", () => {
  // ==========================================
  // 1. TRANSPORT SECURITY & HELMET HEADERS
  // ==========================================
  describe("Security Headers & Transport Controls", () => {
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
      server = http.createServer((req, res) => {
        const handled = defaultSecurityMiddleware.handleRequest(req, res);
        if (handled) return;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      });

      await new Promise<void>((resolve) => {
        server.listen(0, () => {
          port = (server.address() as any).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("enforces strict transport security (HSTS) and modern Helmet headers", async () => {
      const res = await fetch(`http://localhost:${port}/health`);
      expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("permissions-policy")).toContain("camera=()");
      expect(res.headers.get("permissions-policy")).toContain("microphone=()");
      expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(res.headers.get("x-request-id")).toBeDefined();
    });

    it("allows trusted origins with credentials and rejects untrusted origins", async () => {
      // 1. Allowed origin (localhost:3000 in dev)
      const allowedRes = await fetch(`http://localhost:${port}/health`, {
        headers: { Origin: "http://localhost:3000" },
      });
      expect(allowedRes.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
      expect(allowedRes.headers.get("access-control-allow-credentials")).toBe("true");

      // 2. Untrusted origin
      const untrustedRes = await fetch(`http://localhost:${port}/health`, {
        headers: { Origin: "https://evil-attacker-site.com" },
      });
      expect(untrustedRes.headers.get("access-control-allow-origin")).toBeNull();
      expect(untrustedRes.headers.get("access-control-allow-credentials")).toBeNull();

      // 3. Random vercel.app subdomain is strictly rejected (wildcard removed)
      const vercelWildcardRes = await fetch(`http://localhost:${port}/health`, {
        headers: { Origin: "https://malicious-clone.vercel.app" },
      });
      expect(vercelWildcardRes.headers.get("access-control-allow-origin")).toBeNull();
      expect(vercelWildcardRes.headers.get("access-control-allow-credentials")).toBeNull();

      // 4. Exact origin configured in ALLOWED_ORIGINS
      const customMiddleware = new SecurityMiddleware({
        allowedOrigins: ["https://watchparty-nine-coral.vercel.app"],
      });
      expect(customMiddleware.isOriginAllowed("https://watchparty-nine-coral.vercel.app")).toBe(true);
      expect(customMiddleware.isOriginAllowed("https://random-other.vercel.app")).toBe(false);
    });

    it("enforces CSRF protection on state-modifying endpoints using auth cookies", async () => {
      // POST with auth cookie but missing anti-CSRF header -> 403 Forbidden
      const rejectedRes = await fetch(`http://localhost:${port}/api/action`, {
        method: "POST",
        headers: {
          Cookie: "refreshToken=abc123secret",
        },
      });
      expect(rejectedRes.status).toBe(403);
      const rejectedBody = await rejectedRes.json();
      expect(rejectedBody.error).toContain("CSRF verification failed");

      // POST with auth cookie AND custom anti-CSRF header -> 200 OK
      const acceptedRes = await fetch(`http://localhost:${port}/api/action`, {
        method: "POST",
        headers: {
          Cookie: "refreshToken=abc123secret",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      expect(acceptedRes.status).toBe(200);
    });
  });

  // ==========================================
  // 2. FIELD ENCRYPTION AT REST & KEY ROTATION
  // ==========================================
  describe("Field Encryption At Rest (AES-256-GCM)", () => {
    const primaryKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const oldKeyHex = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    it("encrypts and decrypts sensitive data using AES-256-GCM with authenticated tags", () => {
      const crypto = new FieldEncryption({ primaryKey: primaryKeyHex });
      const sensitiveToken = "super-secret-email-verification-token-998877";

      const encrypted = crypto.encrypt(sensitiveToken);
      expect(encrypted).toMatch(/^v1:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/);

      const decrypted = crypto.decrypt(encrypted);
      expect(decrypted).toBe(sensitiveToken);
    });

    it("fails decryption if ciphertext or authentication tag is tampered with", () => {
      const crypto = new FieldEncryption({ primaryKey: primaryKeyHex });
      const encrypted = crypto.encrypt("private-user-data");

      // Tamper with the last character
      const tampered = encrypted.slice(0, -1) + (encrypted.endsWith("a") ? "b" : "a");
      expect(() => crypto.decrypt(tampered)).toThrow();
    });

    it("supports zero-downtime key rotation via fallback keys", () => {
      // Encrypt with old key
      const oldCrypto = new FieldEncryption({ primaryKey: oldKeyHex });
      const legacyRecord = oldCrypto.encrypt("sensitive-pii-record");

      // New system configured with new primary key and old key in fallback keys
      const newCrypto = new FieldEncryption({
        primaryKey: primaryKeyHex,
        fallbackKeys: [oldKeyHex],
      });

      // Decrypt succeeds via fallback key
      const decrypted = newCrypto.decrypt(legacyRecord);
      expect(decrypted).toBe("sensitive-pii-record");

      // Rotate/re-encrypt with new primary key
      const reEncrypted = newCrypto.rotate(legacyRecord);
      expect(newCrypto.decrypt(reEncrypted)).toBe("sensitive-pii-record");
    });
  });

  // ==========================================
  // 3. AUDIT LOGGING OF SECURITY EVENTS
  // ==========================================
  describe("Security Event Audit Logging", () => {
    it("records structured audit logs for authentication, moderation, and room lifecycle", () => {
      const logger = new AuditLogger(50);

      logger.log({
        type: "AUTH_LOGIN_SUCCESS",
        actorId: "usr_alice",
        outcome: "SUCCESS",
        details: { ip: "127.0.0.1" },
      });

      logger.log({
        type: "ROOM_MEMBER_KICKED",
        actorId: "usr_host",
        targetId: "usr_badactor",
        outcome: "SUCCESS",
        details: { roomId: "room_123", reason: "Spamming chat" },
      });

      const logs = logger.getLogs();
      expect(logs.length).toBe(2);
      expect(logs[0].type).toBe("AUTH_LOGIN_SUCCESS");
      expect(logs[1].type).toBe("ROOM_MEMBER_KICKED");
      expect(logs[1].targetId).toBe("usr_badactor");
    });
  });

  // ==========================================
  // 4. WEBSOCKET SECURITY SAFEGUARDS
  // ==========================================
  describe("WebSocket Security & IDOR Safeguards", () => {
    let server: http.Server;
    let gateway: WebSocketGateway;
    let roomManager: RoomManager;
    let port: number;

    beforeEach(async () => {
      server = http.createServer();
      roomManager = new RoomManager();
      gateway = new WebSocketGateway(server, roomManager);

      await new Promise<void>((resolve) => {
        server.listen(0, () => {
          port = (server.address() as any).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      gateway.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("enforces 64KB frame size limit against buffer overflow attacks", async () => {
      const ws = await connectWs(port);
      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      });

      // Send 70KB oversized payload
      const hugeString = "x".repeat(70000);
      ws.send(hugeString);

      const closeEvent = await closePromise;
      expect(closeEvent.code).toBe(1009); // MESSAGE_TOO_BIG
      expect(closeEvent.reason).toContain("Message too large");
    });

    it("prevents prototype pollution via safeJsonParse", () => {
      const maliciousPayload = '{"type":"SYNC_PING","clientSeq":1,"payload":{"clientSendTimeMs":100},"__proto__":{"polluted":true}}';
      const parsed = safeJsonParse(maliciousPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect((parsed.data as any).__proto__.polluted).toBeUndefined();
        expect(({} as any).polluted).toBeUndefined();
      }
    });

    it("enforces authorization checks on host-only commands (IDOR & kick authorization)", async () => {
      const hostWs = await connectWs(port);
      const peerWs = await connectWs(port);

      // 1. Host creates room
      sendJson(hostWs, {
        type: "ROOM_CREATE",
        clientSeq: 1,
        payload: { userName: "AliceHost", roomName: "Auth Room", controlMode: "host_only" },
      });
      const snapshot = await waitForMessage(hostWs, (m) => m.type === "ROOM_SNAPSHOT");
      const roomCode = snapshot.payload.roomCode;

      // 2. Peer joins room
      sendJson(peerWs, {
        type: "ROOM_JOIN",
        clientSeq: 1,
        payload: { roomCode, userName: "BobPeer" },
      });
      const peerSnapshot = await waitForMessage(peerWs, (m) => m.type === "ROOM_SNAPSHOT");
      const peerUserId = peerSnapshot.payload.selfUserId;

      // 3. Peer attempts to kick host -> PERMISSION_DENIED
      sendJson(peerWs, {
        type: "ROOM_KICK_MEMBER",
        clientSeq: 2,
        payload: { targetUserId: snapshot.payload.hostId, reason: "Unauthorized attempt" },
      });
      const err = await waitForMessage(peerWs, (m) => m.type === "ERROR");
      expect(err.code).toBe(ERROR_CODES.PERMISSION_DENIED);

      // 4. Host kicks peer -> succeeds, peer socket disconnected
      const peerClosePromise = new Promise<{ code: number }>((resolve) => {
        peerWs.on("close", (code) => resolve({ code }));
      });

      sendJson(hostWs, {
        type: "ROOM_KICK_MEMBER",
        clientSeq: 2,
        payload: { targetUserId: peerUserId, reason: "Rule violation" },
      });

      const ack = await waitForMessage(hostWs, (m) => m.type === "ACK" && m.clientSeq === 2);
      expect(ack).toBeDefined();

      const closeEvent = await peerClosePromise;
      expect([4003, WS_CLOSE_CODES.USER_KICKED]).toContain(closeEvent.code);

      hostWs.close();
    });
  });
});
