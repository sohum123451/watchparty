import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { validateEnv, envSchema } from "../src/config/env.js";
import { runMigrations, MIGRATIONS } from "../src/db/migrate.js";
import { createMailer, PostmarkMailer, ResendMailer, ConsoleMailer, SmtpMailer } from "../src/auth/mailer/Mailer.js";
import { getStatusHtml, formatUptime, StatusDetails } from "../src/ui/StatusPage.js";

describe("Production Deployment & Runtime Hardening Suite", () => {
  // =========================================================================
  // 1. Environment Config & Fail-Fast Validation
  // =========================================================================
  describe("Environment Config & Validation (env.ts)", () => {
    it("parses valid development configuration with safe defaults", () => {
      const config = validateEnv({
        NODE_ENV: "development",
        PORT: "3001",
      });

      expect(config.NODE_ENV).toBe("development");
      expect(config.PORT).toBe(3001);
      expect(config.BASE_URL).toBe("http://localhost:3001");
      expect(config.MAILER_PROVIDER).toBe("console");
    });

    it("fails fast in production if JWT_SECRET is placeholder or shorter than 32 chars", () => {
      expect(() => {
        validateEnv({
          NODE_ENV: "production",
          JWT_SECRET: "watchparty_super_secret_jwt_key_at_least_32_characters_long_12345", // default placeholder
        });
      }).toThrow(/Production requires a high-entropy JWT_SECRET/);

      expect(() => {
        validateEnv({
          NODE_ENV: "production",
          JWT_SECRET: "too_short_secret",
        });
      }).toThrow(/JWT_SECRET must be at least 32 characters/);
    });

    it("fails fast in production if ENCRYPTION_KEY is default placeholder", () => {
      expect(() => {
        validateEnv({
          NODE_ENV: "production",
          JWT_SECRET: "valid_production_secret_key_exceeding_32_characters_long",
          ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", // default placeholder
        });
      }).toThrow(/Production requires a unique ENCRYPTION_KEY/);
    });

    it("fails fast in production if transactional mailer API key is missing", () => {
      expect(() => {
        validateEnv({
          NODE_ENV: "production",
          JWT_SECRET: "valid_production_secret_key_exceeding_32_characters_long",
          ENCRYPTION_KEY: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
          MAILER_PROVIDER: "resend",
          // Missing RESEND_API_KEY
        });
      }).toThrow(/RESEND_API_KEY is required/);

      expect(() => {
        validateEnv({
          NODE_ENV: "production",
          JWT_SECRET: "valid_production_secret_key_exceeding_32_characters_long",
          ENCRYPTION_KEY: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
          MAILER_PROVIDER: "postmark",
          // Missing POSTMARK_SERVER_TOKEN
        });
      }).toThrow(/POSTMARK_SERVER_TOKEN is required/);
    });

    it("accepts hardened, production-ready configuration", () => {
      const validProd = validateEnv({
        NODE_ENV: "production",
        PORT: "4000",
        BASE_URL: "https://watchparty.live",
        JWT_SECRET: "a_very_secure_high_entropy_random_jwt_secret_token_1234567890",
        ENCRYPTION_KEY: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        ADMIN_SECRET: "strong_production_admin_secret_9876543210",
        MAILER_PROVIDER: "resend",
        RESEND_API_KEY: "re_live_secret_key_12345",
      });

      expect(validProd.NODE_ENV).toBe("production");
      expect(validProd.PORT).toBe(4000);
      expect(validProd.BASE_URL).toBe("https://watchparty.live");
      expect(validProd.MAILER_PROVIDER).toBe("resend");
    });
  });

  // =========================================================================
  // 2. Transactional Mail Service & Postmark Adapter
  // =========================================================================
  describe("Transactional Mail Service (Resend, Postmark, Smtp, Console)", () => {
    it("instantiates correct mailer based on provider option", () => {
      const consoleMailer = createMailer({ provider: "console" });
      expect(consoleMailer instanceof ConsoleMailer).toBe(true);

      const resendMailer = createMailer({ provider: "resend", resendApiKey: "re_test" });
      expect(resendMailer instanceof ResendMailer).toBe(true);

      const postmarkMailer = createMailer({ provider: "postmark", postmarkToken: "pm_test" });
      expect(postmarkMailer instanceof PostmarkMailer).toBe(true);

      const smtpMailer = createMailer({ provider: "smtp", smtpHost: "mail.example.com" });
      expect(smtpMailer instanceof SmtpMailer).toBe(true);
    });

    it("PostmarkMailer dispatches RFC-compliant payload with X-Postmark-Server-Token", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ MessageID: "pm_msg_12345" }),
        text: async () => "OK",
      } as any);

      const mailer = new PostmarkMailer("pm_secret_token_xyz", "WatchParty <no-reply@watchparty.app>");

      await mailer.sendVerificationEmail("alice@example.com", "token123", "https://watchparty.app/verify?token=token123");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.postmarkapp.com/email",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Postmark-Server-Token": "pm_secret_token_xyz",
            "Content-Type": "application/json",
          }),
        })
      );

      const callArgs = fetchSpy.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);
      expect(body.To).toBe("alice@example.com");
      expect(body.From).toBe("WatchParty <no-reply@watchparty.app>");
      expect(body.Subject).toContain("Verify your WatchParty email");
      expect(body.HtmlBody).toContain("https://watchparty.app/verify?token=token123");
    });
  });

  // =========================================================================
  // 3. Database Migration Definitions & Runner
  // =========================================================================
  describe("Database Migration Engine (migrate.ts)", () => {
    it("defines valid, non-empty idempotent SQL migrations", () => {
      expect(MIGRATIONS.length).toBeGreaterThanOrEqual(2);
      for (const m of MIGRATIONS) {
        expect(m.version).toBeDefined();
        expect(m.name).toBeDefined();
        expect(m.sql).toContain("CREATE TABLE IF NOT EXISTS");
      }
    });

    it("skips migrations gracefully when DATABASE_URL is not set", async () => {
      const res = await runMigrations(undefined);
      expect(res.applied).toBe(0);
      expect(res.total).toBe(MIGRATIONS.length);
    });
  });

  // =========================================================================
  // 4. Status Page & Health Visualization
  // =========================================================================
  describe("System Status & Health Reporting (StatusPage.ts)", () => {
    it("formats uptime seconds into human-readable duration", () => {
      expect(formatUptime(45)).toBe("45s");
      expect(formatUptime(125)).toBe("2m 5s");
      expect(formatUptime(3665)).toBe("1h 1m 5s");
      expect(formatUptime(90061)).toBe("1d 1h 1m 1s");
    });

    it("renders valid dark-mode status page HTML with operational indicators", () => {
      const details: StatusDetails = {
        status: "operational",
        nodeId: "node_prod_1",
        uptimeSeconds: 125000,
        activeRooms: 12,
        connectedSockets: 48,
        database: {
          status: "connected",
          type: "postgresql",
        },
        redis: {
          status: "connected",
          type: "standalone_or_cluster",
        },
        mailer: {
          provider: "resend",
        },
        version: "1.0.0",
        timestamp: Date.now(),
      };

      const html = getStatusHtml(details);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("WatchParty System Status");
      expect(html).toContain("All Systems Operational");
      expect(html).toContain("node_prod_1");
      expect(html).toContain("12"); // Active rooms
      expect(html).toContain("48"); // Connected sockets
      expect(html).toContain("PostgreSQL Relational Storage");
      expect(html).toContain("Redis Pub/Sub");
      expect(html).toContain("resend");
    });
  });
});
