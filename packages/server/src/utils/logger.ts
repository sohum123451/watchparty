import crypto from "node:crypto";
import http from "node:http";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  traceId?: string;
  requestId?: string;
  roomId?: string;
  userId?: string;
  clientSeq?: number;
  latencyMs?: number;
  statusCode?: number;
  method?: string;
  path?: string;
  ip?: string;
  [key: string]: any;
}

export interface LogEntry extends LogContext {
  timestamp: string;
  level: LogLevel;
  message: string;
}

export class Logger {
  private defaultContext: LogContext;
  private isProduction: boolean;

  constructor(defaultContext: LogContext = {}) {
    this.defaultContext = defaultContext;
    this.isProduction = process.env.NODE_ENV === "production";
  }

  public child(context: LogContext): Logger {
    return new Logger({
      ...this.defaultContext,
      ...context,
    });
  }

  /**
   * Creates a contextual child logger with explicit room and user tracking.
   */
  public withRoomAndUser(roomId?: string, userId?: string, extraContext: LogContext = {}): Logger {
    return this.child({
      ...(roomId ? { roomId } : {}),
      ...(userId ? { userId } : {}),
      ...extraContext,
    });
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.defaultContext,
      ...context,
    };

    const line = JSON.stringify(entry);

    if (level === "error") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  }

  public debug(message: string, context?: LogContext): void {
    if (process.env.LOG_LEVEL === "debug" || !this.isProduction) {
      this.write("debug", message, context);
    }
  }

  public info(message: string, context?: LogContext): void {
    this.write("info", message, context);
  }

  public warn(message: string, context?: LogContext): void {
    this.write("warn", message, context);
  }

  public error(message: string, context?: LogContext, err?: Error): void {
    const merged = { ...this.defaultContext, ...context };
    const errorDetails = err
      ? {
          errorName: err.name,
          errorMessage: err.message,
          errorStack: err.stack,
        }
      : {};
    this.write("error", message, { ...merged, ...errorDetails });

    // Forward to Sentry if available
    try {
      // Dynamic import or global reference
      import("../observability/SentryClient.js").then(({ globalSentry }) => {
        if (err) {
          globalSentry.captureException(err, {
            roomId: merged.roomId,
            userId: merged.userId,
            extra: { ...merged, message },
          }).catch(() => {});
        } else {
          globalSentry.captureMessage(message, "error", {
            roomId: merged.roomId,
            userId: merged.userId,
            extra: merged,
          }).catch(() => {});
        }
      }).catch(() => {});
    } catch {
      // Sentry forward fail-safe
    }
  }

  public static generateId(prefix = "req"): string {
    return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
  }
}

export const rootLogger = new Logger();

/**
 * Middleware that attaches a structured logger, records latency, and emits structured access logs.
 */
export function requestLoggingMiddleware(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  onFinished?: (reqLogger: Logger, latencyMs: number) => void
): Logger {
  const startTime = performance.now();
  const requestId =
    (req.headers["x-request-id"] as string) ||
    (req.headers["x-trace-id"] as string) ||
    Logger.generateId("req");

  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "127.0.0.1";

  const reqLogger = rootLogger.child({
    requestId,
    traceId: requestId,
    method: req.method,
    path: req.url?.split("?")[0],
    ip: clientIp,
  });

  res.setHeader("X-Request-Id", requestId);

  res.on("finish", () => {
    const latencyMs = Number((performance.now() - startTime).toFixed(2));
    reqLogger.info("HTTP Request Completed", {
      statusCode: res.statusCode,
      latencyMs,
    });
    onFinished?.(reqLogger, latencyMs);
  });

  return reqLogger;
}
