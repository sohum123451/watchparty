import { WebSocket } from "ws";
import { ServerMessage, ERROR_CODES, WS_CLOSE_CODES } from "@watchparty/shared";
import { TokenBucketRateLimiter } from "../utils/rateLimiter.js";
import { ActiveConnection } from "../rooms/Room.js";

export interface AuthenticatedUserInfo {
  id: string;
  email: string;
  displayName: string;
  avatar: string | null;
  isEmailVerified: boolean;
  isGuest?: boolean;
}

export class Connection implements ActiveConnection {
  public readonly ws: WebSocket;
  public readonly rateLimiter: TokenBucketRateLimiter;
  public isAlive: boolean;
  public roomId?: string;
  public userId?: string;
  public authUser?: AuthenticatedUserInfo;
  public isGuest = true;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.rateLimiter = new TokenBucketRateLimiter();
    this.isAlive = true;
  }

  public send(message: ServerMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  public sendAck(clientSeq: number, version: number): void {
    this.send({
      type: "ACK",
      clientSeq,
      version,
    });
  }

  public sendError(code: string, message: string, clientSeq?: number, details?: unknown): void {
    this.send({
      type: "ERROR",
      clientSeq,
      code,
      message,
      details,
    });
  }

  public close(code: number = WS_CLOSE_CODES.NORMAL_CLOSURE, reason = "Closing"): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(code, reason);
    }
  }
}
