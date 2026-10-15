import crypto from "node:crypto";
import { ROOM_CONSTANTS } from "@watchparty/shared";

/**
 * Generates an unambiguous, human-friendly 6-character room code.
 * Excludes easily confusable characters (0, O, 1, I, L).
 */
export function generateRoomCode(): string {
  const chars = ROOM_CONSTANTS.ROOM_CODE_ALPHABET;
  let code = "";
  for (let i = 0; i < ROOM_CONSTANTS.ROOM_CODE_LENGTH; i++) {
    const randomIndex = crypto.randomInt(0, chars.length);
    code += chars[randomIndex];
  }
  return code;
}

/**
 * Generates an opaque, cryptographically secure session token for seamless reconnection.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Generates an entity ID with an optional prefix.
 */
export function generateId(prefix = "id"): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Generates a random cryptographic salt for room password hashing.
 */
export function generatePasswordSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Derives a PBKDF2 hash of a room password using HMAC-SHA256.
 */
export function hashRoomPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 32, "sha256").toString("hex");
}

/**
 * Securely verifies a plaintext room password against its expected hash using constant-time equality.
 */
export function verifyRoomPassword(password: string, salt: string, expectedHash: string): boolean {
  try {
    const computedHash = hashRoomPassword(password, salt);
    const computedBuffer = Buffer.from(computedHash, "hex");
    const expectedBuffer = Buffer.from(expectedHash, "hex");
    if (computedBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(computedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

