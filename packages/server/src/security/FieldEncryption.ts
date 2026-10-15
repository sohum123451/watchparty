import crypto from "node:crypto";

/**
 * Production-grade AES-256-GCM Field-Level Encryption at Rest.
 * Supports zero-downtime key rotation via primary key and fallback keys.
 */
export class FieldEncryption {
  private primaryKey: Buffer;
  private fallbackKeys: Buffer[];

  constructor(
    optionsOrPrimaryKey?: string | { primaryKey?: string; fallbackKeys?: string[] },
    fallbackKeysStr?: string
  ) {
    let primaryKeyInput: string | undefined;
    let fallbackKeysInput: string[] = [];

    if (typeof optionsOrPrimaryKey === "object" && optionsOrPrimaryKey !== null) {
      primaryKeyInput = optionsOrPrimaryKey.primaryKey;
      fallbackKeysInput = optionsOrPrimaryKey.fallbackKeys || [];
    } else {
      primaryKeyInput = optionsOrPrimaryKey;
      if (fallbackKeysStr) {
        fallbackKeysInput = fallbackKeysStr.split(",").map((k) => k.trim()).filter(Boolean);
      }
    }

    const rawKey = primaryKeyInput || process.env.ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    this.primaryKey = this.parseKey(rawKey);

    const envFallbacks = process.env.ENCRYPTION_KEY_FALLBACKS
      ? process.env.ENCRYPTION_KEY_FALLBACKS.split(",").map((k) => k.trim()).filter(Boolean)
      : [];

    const allFallbacks = [...fallbackKeysInput, ...envFallbacks];
    this.fallbackKeys = allFallbacks.map((k) => this.parseKey(k));
  }

  private parseKey(keyStr: string): Buffer {
    let buf: Buffer;
    if (keyStr.length === 64) {
      buf = Buffer.from(keyStr, "hex");
    } else {
      buf = Buffer.from(keyStr, "base64");
    }
    if (buf.length !== 32) {
      // If key length is not exactly 32 bytes (256 bits), derive 32-byte key via SHA-256
      buf = crypto.createHash("sha256").update(keyStr).digest();
    }
    return buf;
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   * Format: `v1:ivHex:authTagHex:ciphertextHex`
   */
  public encrypt(plaintext: string): string {
    if (!plaintext) return "";
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.primaryKey, iv);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return `v1:${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
  }

  /**
   * Decrypts ciphertext formatted as `v1:ivHex:authTagHex:ciphertextHex`.
   * Automatically iterates through fallback keys for transparent key rotation.
   */
  public decrypt(encryptedStr: string): string {
    if (!encryptedStr || !encryptedStr.startsWith("v1:")) {
      return encryptedStr; // Return as-is if not encrypted
    }

    const parts = encryptedStr.split(":");
    if (parts.length !== 4) {
      throw new Error("Invalid encrypted format");
    }

    const [, ivHex, tagHex, cipherHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");
    const ciphertext = Buffer.from(cipherHex, "hex");

    // 1. Try primary key
    try {
      return this.decryptWithKey(ciphertext, iv, authTag, this.primaryKey);
    } catch {
      // 2. Try fallback keys for zero-downtime rotation
      for (const fallbackKey of this.fallbackKeys) {
        try {
          return this.decryptWithKey(ciphertext, iv, authTag, fallbackKey);
        } catch {
          // continue
        }
      }
      throw new Error("Decryption failed: authentication tag verification failed across all available keys");
    }
  }

  private decryptWithKey(
    ciphertext: Buffer,
    iv: Buffer,
    authTag: Buffer,
    key: Buffer
  ): string {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final("utf8");
  }

  /**
   * Returns true if a string is encrypted under the v1 format.
   */
  public isEncrypted(str: string): boolean {
    return typeof str === "string" && str.startsWith("v1:") && str.split(":").length === 4;
  }

  /**
   * Re-encrypts an encrypted string with the current primary key.
   */
  public reencrypt(encryptedStr: string): string {
    const plaintext = this.decrypt(encryptedStr);
    return this.encrypt(plaintext);
  }

  public rotate(encryptedStr: string): string {
    return this.reencrypt(encryptedStr);
  }
}

export const defaultFieldEncryption = new FieldEncryption();
