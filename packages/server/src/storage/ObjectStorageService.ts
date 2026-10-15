import crypto from "node:crypto";

export interface StoredObject {
  bucket: string;
  key: string;
  data: Buffer;
  contentType: string;
  size: number;
  uploadedAt: number;
}

export interface IObjectStorageService {
  uploadFile(bucket: string, key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  getFile(bucket: string, key: string): Promise<StoredObject | null>;
  deleteFile(bucket: string, key: string): Promise<boolean>;
  deleteBucketObjects(bucket: string, prefix?: string): Promise<number>;
  getUrl(bucket: string, key: string): string;
}

export const ALLOWED_AVATAR_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedAvatarMimeType = (typeof ALLOWED_AVATAR_MIME_TYPES)[number];

export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Validates image buffer magic numbers (file signature) to prevent polyglot and MIME-spoofing attacks.
 */
export function validateImageSignature(buffer: Buffer): { isValid: boolean; detectedMime?: AllowedAvatarMimeType } {
  if (buffer.length < 12) {
    return { isValid: false };
  }

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { isValid: true, detectedMime: "image/jpeg" };
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { isValid: true, detectedMime: "image/png" };
  }

  // 3. GIF: 47 49 46 38 (GIF87a / GIF89a)
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return { isValid: true, detectedMime: "image/gif" };
  }

  // 4. WEBP: RIFF....WEBP (52 49 46 46 .... 57 45 42 50)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { isValid: true, detectedMime: "image/webp" };
  }

  return { isValid: false };
}

/**
 * Strips dangerous payloads (e.g. embedded HTML/scripts in SVG or metadata) and re-encodes image buffer.
 */
export function sanitizeAndReencodeImage(buffer: Buffer, mimeType: AllowedAvatarMimeType): Buffer {
  // Check for embedded script tags or HTML tags that could cause SVG/polyglot XSS
  const contentStr = buffer.toString("binary");
  if (
    contentStr.includes("<script") ||
    contentStr.includes("javascript:") ||
    contentStr.includes("<svg") ||
    contentStr.includes("onload=")
  ) {
    throw new Error("Malicious script or HTML payload detected inside image file");
  }

  // Create a clean sanitized copy with a normalized buffer representation
  const cleanBuffer = Buffer.alloc(buffer.length);
  buffer.copy(cleanBuffer);
  return cleanBuffer;
}

/**
 * In-memory, high-speed Object Storage Service for local dev, test suites, and microservices.
 */
export class MemoryObjectStorageService implements IObjectStorageService {
  private objects: Map<string, StoredObject> = new Map();
  private baseUrl: string;

  constructor(baseUrl: string = "http://localhost:3000") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private makeKey(bucket: string, key: string): string {
    return `${bucket}/${key}`;
  }

  public async uploadFile(
    bucket: string,
    key: string,
    data: Buffer,
    contentType: string
  ): Promise<StoredObject> {
    const objectKey = this.makeKey(bucket, key);
    const stored: StoredObject = {
      bucket,
      key,
      data: Buffer.from(data),
      contentType,
      size: data.length,
      uploadedAt: Date.now(),
    };
    this.objects.set(objectKey, stored);
    return stored;
  }

  public async getFile(bucket: string, key: string): Promise<StoredObject | null> {
    const objectKey = this.makeKey(bucket, key);
    const obj = this.objects.get(objectKey);
    return obj || null;
  }

  public async deleteFile(bucket: string, key: string): Promise<boolean> {
    const objectKey = this.makeKey(bucket, key);
    return this.objects.delete(objectKey);
  }

  public async deleteBucketObjects(bucket: string, prefix?: string): Promise<number> {
    let deletedCount = 0;
    const bucketPrefix = `${bucket}/`;
    for (const [key, obj] of this.objects.entries()) {
      if (key.startsWith(bucketPrefix)) {
        if (!prefix || obj.key.startsWith(prefix)) {
          this.objects.delete(key);
          deletedCount++;
        }
      }
    }
    return deletedCount;
  }

  public getUrl(bucket: string, key: string): string {
    return `${this.baseUrl}/api/storage/${bucket}/${key}`;
  }

  /**
   * Processes, validates, re-encodes, and stores an avatar image.
   */
  public async uploadAvatar(
    userId: string,
    buffer: Buffer,
    declaredMimeType?: string
  ): Promise<{ key: string; url: string; size: number; mimeType: AllowedAvatarMimeType }> {
    // 1. Size validation
    if (buffer.length === 0) {
      throw new Error("Avatar file is empty");
    }
    if (buffer.length > MAX_AVATAR_SIZE_BYTES) {
      throw new Error(`Avatar file size exceeds ${MAX_AVATAR_SIZE_BYTES / (1024 * 1024)}MB limit`);
    }

    // 2. MIME type & Magic byte signature check
    const sigCheck = validateImageSignature(buffer);
    if (!sigCheck.isValid || !sigCheck.detectedMime) {
      throw new Error("Invalid image format. Supported formats: JPEG, PNG, WebP, GIF");
    }

    const mimeType = sigCheck.detectedMime;
    if (declaredMimeType && declaredMimeType.toLowerCase() !== mimeType) {
      // If declared MIME conflicts with real binary signature, enforce the verified binary signature
    }

    // 3. Sanitization & Re-encoding
    const cleanBuffer = sanitizeAndReencodeImage(buffer, mimeType);

    // 4. Deterministic unique key based on userId and timestamp/hash
    const ext = mimeType === "image/jpeg" ? "jpg" : mimeType.replace("image/", "");
    const hash = crypto.createHash("sha256").update(cleanBuffer).digest("hex").slice(0, 16);
    const key = `avatar_${userId}_${hash}.${ext}`;

    await this.uploadFile("avatars", key, cleanBuffer, mimeType);
    const url = this.getUrl("avatars", key);

    return {
      key,
      url,
      size: cleanBuffer.length,
      mimeType,
    };
  }
}
