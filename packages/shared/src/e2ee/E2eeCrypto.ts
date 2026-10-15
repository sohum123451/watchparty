/**
 * End-to-End Encrypted (E2EE) Chat Cryptography Module.
 * Standard WebCrypto implementation (ECDH P-256 + HKDF + AES-GCM-256).
 * Compatible across modern browsers and Node.js 18+.
 */

export interface EncryptedChatPayload {
  ciphertext: string; // Base64
  iv: string; // Base64 (12 bytes)
  keyVersion: number;
  authorId: string;
  timestamp: number;
}

export interface WrappedKeyPackage {
  targetUserId: string;
  wrappedKey: string; // Base64
  iv: string; // Base64
}

function getSubtle(): SubtleCrypto {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error("WebCrypto SubtleCrypto is not available in the current environment");
}

function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class E2eeCrypto {
  /**
   * Generates an ephemeral ECDH P-256 key pair for a room member.
   */
  public static async generateMemberKeyPair(): Promise<CryptoKeyPair> {
    const subtle = getSubtle();
    return subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
  }

  /**
   * Exports an ECDH public key to base64 SPKI format.
   */
  public static async exportPublicKey(publicKey: CryptoKey): Promise<string> {
    const subtle = getSubtle();
    const spki = await subtle.exportKey("spki", publicKey);
    return bufferToBase64(spki);
  }

  /**
   * Imports an ECDH public key from base64 SPKI format.
   */
  public static async importPublicKey(base64Spki: string): Promise<CryptoKey> {
    const subtle = getSubtle();
    const buffer = base64ToBuffer(base64Spki);
    return subtle.importKey(
      "spki",
      buffer as any,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      []
    );
  }

  /**
   * Generates a 256-bit AES-GCM room key for encrypting messages.
   */
  public static async generateRoomKey(): Promise<CryptoKey> {
    const subtle = getSubtle();
    return subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Derives a dedicated wrapping key between host and peer using ECDH and HKDF-SHA-256.
   */
  public static async deriveSharedWrappingKey(
    privateKey: CryptoKey,
    peerPublicKey: CryptoKey
  ): Promise<CryptoKey> {
    const subtle = getSubtle();

    // 1. Derive 256 bits of shared secret via ECDH
    const sharedBits = await subtle.deriveBits(
      { name: "ECDH", public: peerPublicKey },
      privateKey,
      256
    );

    // 2. Import shared bits into HKDF key
    const hkdfKey = await subtle.importKey(
      "raw",
      sharedBits,
      "HKDF",
      false,
      ["deriveKey"]
    );

    // 3. Expand using HKDF into AES-GCM wrapping key
    return subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(32), // Constant salt
        info: new TextEncoder().encode("watchparty-e2ee-room-key-v1"),
      },
      hkdfKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Wraps the raw AES-GCM room key for distribution using the derived wrapping key.
   */
  public static async wrapRoomKey(
    roomKey: CryptoKey,
    wrappingKey: CryptoKey
  ): Promise<{ wrappedKey: string; iv: string }> {
    const subtle = getSubtle();
    const rawKey = await subtle.exportKey("raw", roomKey);

    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);

    const ciphertext = await subtle.encrypt(
      { name: "AES-GCM", iv },
      wrappingKey,
      rawKey
    );

    return {
      wrappedKey: bufferToBase64(ciphertext),
      iv: bufferToBase64(iv),
    };
  }

  /**
   * Unwraps the received AES-GCM room key using the member's derived wrapping key.
   */
  public static async unwrapRoomKey(
    wrappedKeyBase64: string,
    ivBase64: string,
    wrappingKey: CryptoKey
  ): Promise<CryptoKey> {
    const subtle = getSubtle();
    const ciphertext = base64ToBuffer(wrappedKeyBase64);
    const iv = base64ToBuffer(ivBase64);

    const rawKey = await subtle.decrypt(
      { name: "AES-GCM", iv: iv as any },
      wrappingKey,
      ciphertext as any
    );

    return subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Encrypts a chat message with AES-GCM using the active room key and a fresh 12-byte IV.
   */
  public static async encryptChatMessage(
    text: string,
    roomKey: CryptoKey,
    keyVersion: number,
    authorId: string
  ): Promise<EncryptedChatPayload> {
    const subtle = getSubtle();
    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);

    const encoded = new TextEncoder().encode(text);
    const ciphertext = await subtle.encrypt(
      { name: "AES-GCM", iv },
      roomKey,
      encoded
    );

    return {
      ciphertext: bufferToBase64(ciphertext),
      iv: bufferToBase64(iv),
      keyVersion,
      authorId,
      timestamp: Date.now(),
    };
  }

  /**
   * Decrypts an incoming encrypted chat message using the corresponding room key version.
   */
  public static async decryptChatMessage(
    payload: EncryptedChatPayload,
    roomKey: CryptoKey
  ): Promise<string> {
    const subtle = getSubtle();
    const ciphertext = base64ToBuffer(payload.ciphertext);
    const iv = base64ToBuffer(payload.iv);

    const decrypted = await subtle.decrypt(
      { name: "AES-GCM", iv: iv as any },
      roomKey,
      ciphertext as any
    );

    return new TextDecoder().decode(decrypted);
  }

  /**
   * Generates a verifiable safety code (fingerprint) for out-of-band MITM verification.
   * Deterministically sorts public keys and hashes them into 6 blocks of 5 digits.
   * Example: "38291 94820 18274 58291 03847 29184"
   */
  public static async generateSafetyFingerprint(
    roomId: string,
    memberPublicKeys: string[]
  ): Promise<string> {
    const subtle = getSubtle();
    const sortedKeys = [...memberPublicKeys].sort();
    const seed = `${roomId}:${sortedKeys.join("|")}`;
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(seed));
    const bytes = new Uint8Array(digest);

    // Convert bytes into 30 decimal digits
    let digits = "";
    for (let i = 0; i < 15; i++) {
      const val = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
      digits += val.toString().padStart(5, "0").slice(0, 5);
    }
    digits = digits.slice(0, 30);

    // Format as 6 blocks of 5 digits
    return (
      digits.match(/.{1,5}/g)?.join(" ") ||
      "00000 00000 00000 00000 00000 00000"
    );
  }
}
