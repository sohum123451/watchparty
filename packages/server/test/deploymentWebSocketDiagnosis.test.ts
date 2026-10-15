import { describe, it, expect, vi } from "vitest";
import { defaultSecurityMiddleware, SecurityMiddleware } from "../src/security/headers.js";
import { getAppHtml } from "../src/ui/AppPage.js";

describe("Deployment, Caddy & WebSocket Diagnosis Suite", () => {
  describe("CORS and WebSocket Origin Validation", () => {
    it("allows origins matching BASE_URL", () => {
      process.env.BASE_URL = "https://54.210.10.5.sslip.io";
      const middleware = new SecurityMiddleware();

      expect(middleware.isOriginAllowed("https://54.210.10.5.sslip.io")).toBe(true);
    });

    it("allows origins matching the request's own Host header (same-host)", () => {
      const middleware = new SecurityMiddleware();

      expect(middleware.isOriginAllowed("https://54.210.10.5.sslip.io", "54.210.10.5.sslip.io")).toBe(true);
      expect(middleware.isOriginAllowed("http://custom-domain.org:3000", "custom-domain.org:3000")).toBe(true);
    });

    it("allows sslip.io and nip.io dynamic DNS domains used for cloud deployments", () => {
      const middleware = new SecurityMiddleware();

      expect(middleware.isOriginAllowed("https://12.34.56.78.sslip.io")).toBe(true);
      expect(middleware.isOriginAllowed("https://subdomain.12.34.56.78.sslip.io")).toBe(true);
      expect(middleware.isOriginAllowed("https://12.34.56.78.nip.io")).toBe(true);
    });

    it("allows wildcard patterns configured via CORS_ORIGIN", () => {
      process.env.CORS_ORIGIN = "*.watchparty.app,https://*.customcloud.com";
      const middleware = new SecurityMiddleware();

      expect(middleware.isOriginAllowed("https://beta.watchparty.app")).toBe(true);
      expect(middleware.isOriginAllowed("https://room-123.customcloud.com")).toBe(true);
    });

    it("rejects untrusted third-party origins", () => {
      const middleware = new SecurityMiddleware();

      expect(middleware.isOriginAllowed("https://malicious-attacker.com")).toBe(false);
      expect(middleware.isOriginAllowed("http://evil-site.net")).toBe(false);
      expect(middleware.isOriginAllowed(undefined)).toBe(false);
    });
  });

  describe("Client HTML Environment Injection & WebSocket Configuration", () => {
    it("injects window.__ENV__ with configured wsUrl and baseUrl", () => {
      const html = getAppHtml({
        wsUrl: "wss://54.210.10.5.sslip.io",
        baseUrl: "https://54.210.10.5.sslip.io",
      });

      expect(html).toContain('id="wp-env-config"');
      expect(html).toContain('WS_URL: "wss://54.210.10.5.sslip.io"');
      expect(html).toContain('BASE_URL: "https://54.210.10.5.sslip.io"');
    });

    it("injects window.__ENV__ structure cleanly into HTML document", () => {
      const html = getAppHtml({ wsUrl: "" });
      expect(html).toContain('id="wp-env-config"');
      expect(html).toContain('window.__ENV__');
      expect(html).toContain('WS_URL: ""');
    });

    it("contains connection logging on connect and failure", () => {
      const html = getAppHtml();

      expect(html).toContain("console.log('[WS] Connecting to WebSocket endpoint:', wsUrl);");
      expect(html).toContain("console.log('[WS] Connected successfully to:', wsUrl);");
      expect(html).toContain("console.warn(");
      expect(html).toContain("'[WS] Connection closed / failed. URL:', wsUrl");
      expect(html).toContain("'CloseCode:', event.code");
    });

    it("implements exponential backoff with jitter on reconnect", () => {
      const html = getAppHtml();

      // Verify jitter calculation in client script
      expect(html).toContain("const baseDelay = 1000;");
      expect(html).toContain("const maxDelay = 15000;");
      expect(html).toContain("const expBackoff = Math.min(maxDelay, baseDelay * Math.pow(1.8, Math.min(reconnectAttempts, 6)));");
      expect(html).toContain("const jitter = Math.random() * (expBackoff * 0.5);");
      expect(html).toContain("const delay = Math.round(expBackoff * 0.5 + jitter);");
      expect(html).toContain("with jitter");
    });

    it("exposes runConnectionDiagnostics helper on window", () => {
      const html = getAppHtml();

      expect(html).toContain("window.runConnectionDiagnostics = async function()");
      expect(html).toContain("fetch('/health')");
    });
  });

  describe("Simulated Reconnect Backoff with Jitter", () => {
    it("computes bounded delays with positive jitter across retries", () => {
      const baseDelay = 1000;
      const maxDelay = 15000;

      for (let attempt = 0; attempt < 10; attempt++) {
        const expBackoff = Math.min(maxDelay, baseDelay * Math.pow(1.8, Math.min(attempt, 6)));
        const jitter = Math.random() * (expBackoff * 0.5);
        const delay = Math.round(expBackoff * 0.5 + jitter);

        // Delay must be at least 50% of the backoff and never exceed 15000ms
        expect(delay).toBeGreaterThanOrEqual(Math.round(expBackoff * 0.5));
        expect(delay).toBeLessThanOrEqual(maxDelay);
      }
    });
  });
});
