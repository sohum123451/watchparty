import { z } from "zod";

const DEFAULT_JWT_SECRET = "watchparty_super_secret_jwt_key_at_least_32_characters_long_12345";
const DEFAULT_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/**
 * Strict Environment Configuration Schema for WatchParty Server.
 * Enforces production security constraints (strong secrets, required providers)
 * while providing effortless zero-config defaults in development and test modes.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    BASE_URL: z.string().url().default("http://localhost:3001"),
    PUBLIC_WS_URL: z.string().optional(),
    NODE_ID: z.string().default("node_main"),
    DATA_DIR: z.string().default("./.data"),

    // Database & Redis
    DATABASE_URL: z.string().optional(),
    REDIS_URL: z.string().optional(),

    // Security & Cryptography
    JWT_SECRET: z.string().min(16).default(DEFAULT_JWT_SECRET),
    ENCRYPTION_KEY: z.string().min(32).default(DEFAULT_ENCRYPTION_KEY),
    ENCRYPTION_KEY_FALLBACKS: z.string().optional(),
    CORS_ORIGIN: z.string().optional(),
    ALLOWED_ORIGINS: z.string().optional(),

    // Transactional Email Service
    MAILER_PROVIDER: z.enum(["console", "resend", "postmark", "smtp"]).default("console"),
    RESEND_API_KEY: z.string().optional(),
    POSTMARK_SERVER_TOKEN: z.string().optional(),
    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().default("WatchParty <no-reply@watchparty.app>"),

    // Web Push Notifications (RFC 8292 VAPID)
    VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_CONTACT_EMAIL: z.string().default("mailto:admin@watchparty.app"),

    // Optional Third-Party Integrations
    GOOGLE_SAFE_BROWSING_API_KEY: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().optional(),

    // LiveKit SFU & Media Plane
    MEDIA_PROVIDER: z.enum(["livekit", "mock"]).default("livekit"),
    LIVEKIT_URL: z.string().default("ws://localhost:7880"),
    LIVEKIT_API_KEY: z.string().default("devkey"),
    LIVEKIT_API_SECRET: z.string().default("secret"),

    // WebRTC STUN / TURN Fallback (Coturn / LiveKit TURN)
    COTURN_URL: z.string().optional(),
    COTURN_SECRET: z.string().optional(),
    COTURN_USERNAME: z.string().optional(),
    COTURN_CREDENTIAL: z.string().optional(),

    // Admin & Access Control
    ADMIN_SECRET: z.string().min(16).default("super-secret-admin-token-at-least-16-chars"),
    REGISTRATION_MODE: z.enum(["public", "invite_only", "disabled"]).default("public"),
    REGISTRATION_INVITE_CODE: z.string().optional(),

    // Observability & Sentry Error Tracking
    SENTRY_DSN: z.string().optional(),
    CLIENT_SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().default("production"),
    UPTIME_ALERT_WEBHOOK_URL: z.string().optional(),
    USAGE_ALERT_EMAIL: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Production Security Invariants
    if (data.NODE_ENV === "production") {
      if (data.JWT_SECRET === DEFAULT_JWT_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_SECRET"],
          message: "Production requires a high-entropy JWT_SECRET (not the default placeholder). Generate with: openssl rand -base64 32",
        });
      }
      if (data.JWT_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_SECRET"],
          message: "JWT_SECRET must be at least 32 characters in production.",
        });
      }
      if (data.ENCRYPTION_KEY === DEFAULT_ENCRYPTION_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ENCRYPTION_KEY"],
          message: "Production requires a unique ENCRYPTION_KEY (not the default placeholder). Generate with: openssl rand -hex 32",
        });
      }
      if (data.ADMIN_SECRET === "super-secret-admin-token-at-least-16-chars") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ADMIN_SECRET"],
          message: "Production requires a unique, secure ADMIN_SECRET (not the default placeholder). Generate with: openssl rand -hex 24",
        });
      }
      if (data.MAILER_PROVIDER === "resend" && !data.RESEND_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["RESEND_API_KEY"],
          message: "RESEND_API_KEY is required when MAILER_PROVIDER is set to 'resend'.",
        });
      }
      if (data.MAILER_PROVIDER === "postmark" && !data.POSTMARK_SERVER_TOKEN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["POSTMARK_SERVER_TOKEN"],
          message: "POSTMARK_SERVER_TOKEN is required when MAILER_PROVIDER is set to 'postmark'.",
        });
      }
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

import crypto from "node:crypto";

/**
 * Validates process.env against schema. Fails fast on startup with human-readable error descriptions.
 */
export function validateEnv(rawEnv: Record<string, string | undefined> = process.env): EnvConfig {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const errorMessages = result.error.issues.map((i) => ` ✗ [${i.path.join(".")}]: ${i.message}`).join("\n");
    console.error("\n=======================================================");
    console.error("FATAL: WATCHPARTY ENVIRONMENT CONFIGURATION INVALID");
    console.error("=======================================================");
    console.error(errorMessages);
    console.error("=======================================================\n");
    throw new Error(`Environment validation failed:\n${errorMessages}`);
  }

  return result.data;
}
