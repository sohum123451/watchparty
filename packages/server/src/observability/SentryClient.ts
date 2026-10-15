import crypto from "node:crypto";

export interface SentryConfig {
  dsn?: string;
  environment?: string;
  release?: string;
  serverName?: string;
  maxRecentEvents?: number;
}

export interface SentryBreadcrumb {
  timestamp?: number;
  category?: string;
  message: string;
  level?: "debug" | "info" | "warning" | "error";
  data?: Record<string, any>;
}

export interface SentryEventContext {
  roomId?: string;
  userId?: string;
  userEmail?: string;
  tags?: Record<string, string>;
  extra?: Record<string, any>;
  breadcrumbs?: SentryBreadcrumb[];
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  };
}

export interface CapturedSentryEvent {
  eventId: string;
  timestamp: string;
  level: "info" | "warning" | "error" | "fatal";
  message: string;
  stack?: string;
  roomId?: string;
  userId?: string;
  userEmail?: string;
  tags: Record<string, string>;
  extra: Record<string, any>;
  environment: string;
}

/**
 * Lightweight, zero-dependency Sentry error tracking client.
 * Works natively with Sentry free-tier accounts, formatting standard Sentry
 * event payloads and sending them via HTTP store protocol with structured
 * room and user correlation.
 */
export class SentryClient {
  private dsn?: string;
  private environment: string;
  private release: string;
  private serverName: string;
  private parsedDsn?: {
    protocol: string;
    publicKey: string;
    host: string;
    projectId: string;
  };
  private breadcrumbs: SentryBreadcrumb[] = [];
  private recentEvents: CapturedSentryEvent[] = [];
  private maxRecentEvents: number;
  private initialized = false;

  constructor(config: SentryConfig = {}) {
    this.environment = config.environment || process.env.NODE_ENV || "development";
    this.release = config.release || "watchparty@1.0.0";
    this.serverName = config.serverName || process.env.NODE_ID || "watchparty-node";
    this.maxRecentEvents = config.maxRecentEvents || 50;

    if (config.dsn) {
      this.setDsn(config.dsn);
    }
  }

  public setDsn(dsn: string): void {
    this.dsn = dsn.trim();
    this.parsedDsn = this.parseDsn(this.dsn);
  }

  private parseDsn(dsn: string): { protocol: string; publicKey: string; host: string; projectId: string } | undefined {
    try {
      const url = new URL(dsn);
      const publicKey = url.username;
      const host = url.host;
      const pathParts = url.pathname.split("/").filter(Boolean);
      const projectId = pathParts[pathParts.length - 1];

      if (!publicKey || !host || !projectId) {
        console.warn(`[Sentry] Invalid DSN format: ${dsn}`);
        return undefined;
      }

      return {
        protocol: url.protocol,
        publicKey,
        host,
        projectId,
      };
    } catch (e) {
      console.warn(`[Sentry] Failed to parse DSN: ${dsn}`);
      return undefined;
    }
  }

  public isEnabled(): boolean {
    return Boolean(this.parsedDsn);
  }

  public addBreadcrumb(breadcrumb: SentryBreadcrumb): void {
    this.breadcrumbs.push({
      timestamp: breadcrumb.timestamp || Date.now(),
      category: breadcrumb.category || "custom",
      level: breadcrumb.level || "info",
      message: breadcrumb.message,
      data: breadcrumb.data,
    });

    if (this.breadcrumbs.length > 50) {
      this.breadcrumbs.shift();
    }
  }

  public getRecentEvents(): CapturedSentryEvent[] {
    return [...this.recentEvents];
  }

  public async captureException(
    err: unknown,
    context: SentryEventContext = {}
  ): Promise<string> {
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const errorObj = err instanceof Error ? err : new Error(String(err));
    const timestamp = new Date().toISOString();

    const tags: Record<string, string> = {
      environment: this.environment,
      server_name: this.serverName,
      ...(context.roomId ? { roomId: context.roomId } : {}),
      ...(context.userId ? { userId: context.userId } : {}),
      ...(context.tags || {}),
    };

    const extra: Record<string, any> = {
      ...(context.extra || {}),
      roomId: context.roomId,
      userId: context.userId,
    };

    const recordedEvent: CapturedSentryEvent = {
      eventId,
      timestamp,
      level: "error",
      message: errorObj.message || "Unhandled exception",
      stack: errorObj.stack,
      roomId: context.roomId,
      userId: context.userId,
      userEmail: context.userEmail,
      tags,
      extra,
      environment: this.environment,
    };

    this.recordRecentEvent(recordedEvent);

    if (this.parsedDsn) {
      await this.sendToSentryStore({
        event_id: eventId,
        timestamp,
        platform: "node",
        level: "error",
        logger: "watchparty",
        server_name: this.serverName,
        release: this.release,
        environment: this.environment,
        message: errorObj.message,
        exception: {
          values: [
            {
              type: errorObj.name || "Error",
              value: errorObj.message,
              stacktrace: {
                frames: this.parseStackTrace(errorObj.stack),
              },
            },
          ],
        },
        tags,
        extra,
        user: context.userId ? { id: context.userId, email: context.userEmail } : undefined,
        breadcrumbs: [...this.breadcrumbs, ...(context.breadcrumbs || [])],
        request: context.request,
      });
    }

    return eventId;
  }

  public async captureMessage(
    message: string,
    level: "info" | "warning" | "error" | "fatal" = "info",
    context: SentryEventContext = {}
  ): Promise<string> {
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const timestamp = new Date().toISOString();

    const tags: Record<string, string> = {
      environment: this.environment,
      server_name: this.serverName,
      ...(context.roomId ? { roomId: context.roomId } : {}),
      ...(context.userId ? { userId: context.userId } : {}),
      ...(context.tags || {}),
    };

    const extra: Record<string, any> = {
      ...(context.extra || {}),
      roomId: context.roomId,
      userId: context.userId,
    };

    const recordedEvent: CapturedSentryEvent = {
      eventId,
      timestamp,
      level,
      message,
      roomId: context.roomId,
      userId: context.userId,
      userEmail: context.userEmail,
      tags,
      extra,
      environment: this.environment,
    };

    this.recordRecentEvent(recordedEvent);

    if (this.parsedDsn) {
      await this.sendToSentryStore({
        event_id: eventId,
        timestamp,
        platform: "node",
        level,
        logger: "watchparty",
        server_name: this.serverName,
        release: this.release,
        environment: this.environment,
        message,
        tags,
        extra,
        user: context.userId ? { id: context.userId, email: context.userEmail } : undefined,
        breadcrumbs: [...this.breadcrumbs, ...(context.breadcrumbs || [])],
        request: context.request,
      });
    }

    return eventId;
  }

  private recordRecentEvent(event: CapturedSentryEvent): void {
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.pop();
    }
  }

  private async sendToSentryStore(payload: Record<string, any>): Promise<void> {
    if (!this.parsedDsn) return;

    const { protocol, publicKey, host, projectId } = this.parsedDsn;
    const url = `${protocol}//${host}/api/${projectId}/store/`;
    const authHeader = `Sentry sentry_version=7, sentry_client=watchparty/1.0.0, sentry_key=${publicKey}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": authHeader,
          "User-Agent": "watchparty-sentry/1.0.0",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`[Sentry] Ingest returned HTTP ${res.status}: ${body}`);
      }
    } catch (err: any) {
      // Suppress any network errors when reaching Sentry to prevent cascading failure
      if (err.name !== "AbortError") {
        console.warn(`[Sentry] Failed to dispatch event: ${err.message}`);
      }
    }
  }

  private parseStackTrace(stack?: string): Array<{ filename: string; function: string; lineno?: number }> {
    if (!stack) return [];
    const lines = stack.split("\n").slice(1);
    const frames: Array<{ filename: string; function: string; lineno?: number }> = [];

    for (const line of lines) {
      const match = line.match(/^\s*at\s+(?:(.*?)\s+\()?([^:]+):(\d+):(\d+)\)?$/);
      if (match) {
        frames.unshift({
          function: match[1] || "<anonymous>",
          filename: match[2],
          lineno: parseInt(match[3], 10),
        });
      }
    }

    return frames;
  }

  public installGlobalHandlers(): void {
    if (this.initialized) return;
    this.initialized = true;

    process.on("unhandledRejection", (reason: any) => {
      this.captureException(reason, {
        tags: { handler: "unhandledRejection" },
      }).catch(console.error);
    });

    process.on("uncaughtException", (error: Error) => {
      this.captureException(error, {
        tags: { handler: "uncaughtException" },
      }).catch(console.error);
    });
  }
}

export const globalSentry = new SentryClient();
