import crypto from "node:crypto";
import { WebSocket } from "ws";
import { WS_CLOSE_CODES } from "@watchparty/shared";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  avatar: string | null;
  isEmailVerified: boolean;
  isGuest?: boolean;
}

interface WsTicket {
  ticket: string;
  user: AuthenticatedUser;
  deviceInfo?: string;
  expiresAt: number;
}

export class WsTicketService {
  private tickets: Map<string, WsTicket> = new Map();
  private userSockets: Map<string, Set<WebSocket>> = new Map();
  private readonly ticketTtlMs: number;

  constructor(ticketTtlMs = 30_000) {
    this.ticketTtlMs = ticketTtlMs;
  }

  /**
   * Generates a single-use, 30-second expiring WebSocket connection ticket.
   */
  public createTicket(user: AuthenticatedUser, deviceInfo?: string): string {
    const ticket = `wst_${crypto.randomBytes(24).toString("hex")}`;
    this.tickets.set(ticket, {
      ticket,
      user,
      deviceInfo,
      expiresAt: Date.now() + this.ticketTtlMs,
    });
    return ticket;
  }

  /**
   * Validates and redeems a single-use ticket. Immediately consumes the ticket.
   */
  public redeemTicket(ticket: string): AuthenticatedUser | null {
    const item = this.tickets.get(ticket);
    if (!item) return null;

    // Remove immediately (single use)
    this.tickets.delete(ticket);

    if (item.expiresAt < Date.now()) {
      return null;
    }

    return item.user;
  }

  /**
   * Registers an active authenticated WebSocket connection for session tracking.
   */
  public registerSocket(userId: string, ws: WebSocket): void {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(ws);

    ws.once("close", () => {
      const set = this.userSockets.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          this.userSockets.delete(userId);
        }
      }
    });
  }

  /**
   * Closes all active WebSocket connections for a user with a typed close code.
   * Invoked upon logout-everywhere, session revocation, or password reset.
   */
  public terminateUserConnections(
    userId: string,
    code: number = WS_CLOSE_CODES.POLICY_VIOLATION,
    reason = "Session revoked"
  ): number {
    const set = this.userSockets.get(userId);
    if (!set) return 0;

    let closed = 0;
    for (const ws of set) {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(code, reason);
          closed++;
        }
      } catch {
        // ignore
      }
    }
    this.userSockets.delete(userId);
    return closed;
  }

  public clear(): void {
    this.tickets.clear();
    this.userSockets.clear();
  }
}
