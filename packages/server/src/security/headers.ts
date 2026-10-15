import http from "node:http";
import crypto from "node:crypto";

export interface SecurityOptions {
  allowedOrigins?: string[];
  enforceHttps?: boolean;
  allowInlineScripts?: boolean;
}

export class SecurityMiddleware {
  private allowedOrigins: Set<string>;
  private enforceHttps: boolean;
  private allowInlineScripts: boolean;

  constructor(options: SecurityOptions = {}) {
    const defaultOrigins = [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
    ];

    const envOrigins = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
      : [];

    const finalOrigins = options.allowedOrigins || [...defaultOrigins, ...envOrigins];
    this.allowedOrigins = new Set(finalOrigins);
    this.enforceHttps = options.enforceHttps ?? process.env.NODE_ENV === "production";
    this.allowInlineScripts = options.allowInlineScripts ?? true;
  }

  public isOriginAllowed(origin?: string): boolean {
    if (!origin) return false;
    return this.allowedOrigins.has(origin);
  }

  public handleRequest(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    // 1. Assign or propagate Request ID
    const incomingReqId = (req.headers["x-request-id"] as string) || crypto.randomUUID();
    res.setHeader("X-Request-Id", incomingReqId);

    // 2. Enforce HTTPS in production via reverse-proxy header
    if (this.enforceHttps && req.headers["x-forwarded-proto"] === "http") {
      const host = req.headers.host || "localhost";
      res.writeHead(301, {
        Location: `https://${host}${req.url}`,
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
      });
      res.end();
      return true;
    }

    // 3. Strict Transport & Storage Security Headers (Helmet Equivalents)
    const scriptSrc = this.allowInlineScripts ? "'self' 'unsafe-inline'" : "'self'";
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ws: wss:; font-src 'self' https: data:; media-src 'self' https: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';`
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

    // 4. Strict CORS Configuration (Allowlist validation, credentials support)
    const requestOrigin = req.headers.origin;
    if (requestOrigin && this.isOriginAllowed(requestOrigin)) {
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-WS-Ticket, X-Requested-With, X-CSRF-Token, X-WatchParty-Client"
      );
      res.setHeader("Vary", "Origin");
    }

    // 5. Preflight OPTIONS handling
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return true;
    }

    // 6. CSRF Protection for state-modifying cookie endpoints
    const isStateModifying = ["POST", "PUT", "DELETE", "PATCH"].includes(req.method || "");
    const hasAuthCookie = Boolean(req.headers.cookie && req.headers.cookie.includes("refreshToken"));

    if (isStateModifying && hasAuthCookie) {
      const hasCustomHeader = Boolean(
        req.headers["x-requested-with"] ||
        req.headers["x-csrf-token"] ||
        req.headers["x-watchparty-client"]
      );

      // Browsers disallow cross-origin forms from setting custom headers
      if (!hasCustomHeader) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "CSRF verification failed: custom anti-CSRF header required for cookie-authenticated actions",
          })
        );
        return true;
      }
    }

    return false; // Continue route handling
  }
}

export const defaultSecurityMiddleware = new SecurityMiddleware();
