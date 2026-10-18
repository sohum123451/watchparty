import http from "node:http";

/**
 * Extracts client IP safely respecting TRUST_PROXY and cloud proxy headers (Fly-Client-IP, X-Forwarded-For, X-Real-IP).
 */
export function getClientIp(req: http.IncomingMessage): string {
  const trustProxy = process.env.TRUST_PROXY === "true" || process.env.NODE_ENV === "production";

  if (trustProxy) {
    const flyClientIp = req.headers["fly-client-ip"];
    if (typeof flyClientIp === "string" && flyClientIp.trim()) {
      return flyClientIp.trim();
    }

    const xForwardedFor = req.headers["x-forwarded-for"];
    if (typeof xForwardedFor === "string") {
      const firstHop = xForwardedFor.split(",")[0]?.trim();
      if (firstHop) return firstHop;
    }

    const xRealIp = req.headers["x-real-ip"];
    if (typeof xRealIp === "string" && xRealIp.trim()) {
      return xRealIp.trim();
    }
  }

  return req.socket?.remoteAddress || "127.0.0.1";
}
