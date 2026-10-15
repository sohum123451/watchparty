export interface LocalFileFingerprint {
  fileName: string;
  fileSize: number;
  fileType: string;
  durationMs: number;
  headSha256: string;
  tailSha256: string;
  combinedFingerprint: string;
  fingerprint?: string;
}

export type FingerprintMatchStatus = "match" | "different_version" | "mismatch";

export interface FingerprintComparisonResult {
  status: FingerprintMatchStatus;
  message: string;
  durationDiffMs: number;
  sizeDiffBytes: number;
  headMatched: boolean;
  tailMatched: boolean;
  suggestedOffsetMs?: number;
}

export interface SubtitleCue {
  id?: string;
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Fast SHA-256 helper for ArrayBuffers using Web Crypto Subtle API
 */
export async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Simple fallback hash for headless non-crypto environments
  let hash = 0;
  const view = new Uint8Array(buffer);
  for (let i = 0; i < view.length; i++) {
    hash = (hash << 5) - hash + view[i];
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, "0");
}

/**
 * Creates an inline Web Worker for background SHA-256 hashing without blocking UI/audio threads
 */
export function createHasherWorker(): Worker | null {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
    return null;
  }
  try {
    const workerCode = `
      self.onmessage = async (e) => {
        const { headBuffer, tailBuffer, fileSize, durationMs } = e.data;
        try {
          const toHex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
          const headHash = await crypto.subtle.digest('SHA-256', headBuffer);
          const tailHash = await crypto.subtle.digest('SHA-256', tailBuffer);
          const headSha256 = toHex(headHash);
          const tailSha256 = toHex(tailHash);
          const combinedFingerprint = 'v1:' + fileSize + ':' + Math.round(durationMs) + ':' + headSha256.slice(0, 32) + ':' + tailSha256.slice(0, 32);
          self.postMessage({ success: true, headSha256, tailSha256, combinedFingerprint });
        } catch (err) {
          self.postMessage({ success: false, error: String(err) });
        }
      };
    `;
    const blob = new Blob([workerCode], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    // Cleanup URL object reference after worker creation
    URL.revokeObjectURL(url);
    return worker;
  } catch {
    return null;
  }
}

/**
 * Computes a fast fingerprint of a local video file:
 * (duration + file size + SHA-256 of first and last 1 MB, computed via Web Worker or async Crypto).
 */
export async function computeFileFingerprint(
  file: File | Blob,
  knownDurationMs?: number
): Promise<LocalFileFingerprint> {
  const CHUNK_SIZE = 1024 * 1024; // 1 MB
  const fileSize = file.size;
  const fileName = "name" in file ? (file as File).name : "local-video.mp4";
  const fileType = file.type || "video/mp4";

  // Slice first 1 MB and last 1 MB
  const headSlice = file.slice(0, Math.min(fileSize, CHUNK_SIZE));
  const tailSlice = file.slice(Math.max(0, fileSize - CHUNK_SIZE));

  const [headBuffer, tailBuffer] = await Promise.all([
    headSlice.arrayBuffer(),
    tailSlice.arrayBuffer(),
  ]);

  let durationMs = knownDurationMs ?? 0;
  if (!durationMs && typeof document !== "undefined") {
    durationMs = await extractDurationFromBlob(file).catch(() => 0);
  }

  const worker = createHasherWorker();

  if (worker) {
    try {
      const result = await new Promise<{ headSha256: string; tailSha256: string; combinedFingerprint: string }>(
        (resolve, reject) => {
          worker.onmessage = (e) => {
            if (e.data?.success) {
              resolve(e.data);
            } else {
              reject(new Error(e.data?.error || "Worker hashing failed"));
            }
          };
          worker.onerror = (err) => reject(err);
          // Transfer buffers for zero-copy high performance
          worker.postMessage({ headBuffer, tailBuffer, fileSize, durationMs }, [headBuffer, tailBuffer]);
        }
      );
      worker.terminate();

      return {
        fileName,
        fileSize,
        fileType,
        durationMs,
        headSha256: result.headSha256,
        tailSha256: result.tailSha256,
        combinedFingerprint: result.combinedFingerprint,
        fingerprint: result.combinedFingerprint,
      };
    } catch {
      worker.terminate();
      // Fallback to main thread SubtleCrypto
    }
  }

  // Main thread async hashing fallback
  const [headSha256, tailSha256] = await Promise.all([
    computeSha256Hex(headBuffer),
    computeSha256Hex(tailBuffer),
  ]);

  const combinedFingerprint = `v1:${fileSize}:${Math.round(durationMs)}:${headSha256.slice(0, 32)}:${tailSha256.slice(0, 32)}`;

  return {
    fileName,
    fileSize,
    fileType,
    durationMs,
    headSha256,
    tailSha256,
    combinedFingerprint,
    fingerprint: combinedFingerprint,
  };
}

/**
 * Extracts duration in milliseconds from a media blob using a detached HTMLVideoElement
 */
function extractDurationFromBlob(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined" || typeof URL === "undefined") {
      return resolve(0);
    }
    const tempVideo = document.createElement("video");
    tempVideo.preload = "metadata";
    const objectUrl = URL.createObjectURL(blob);
    tempVideo.src = objectUrl;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      tempVideo.remove();
    };

    tempVideo.onloadedmetadata = () => {
      const dur = tempVideo.duration;
      cleanup();
      resolve(dur && !isNaN(dur) && isFinite(dur) ? Math.round(dur * 1000) : 0);
    };

    tempVideo.onerror = () => {
      cleanup();
      resolve(0);
    };

    // Timeout after 3 seconds
    setTimeout(() => {
      cleanup();
      resolve(0);
    }, 3000);
  });
}

/**
 * Compares two fingerprints and returns "match", "different_version", or "mismatch"
 */
export function compareFingerprints(
  hostFp: LocalFileFingerprint,
  guestFp: LocalFileFingerprint
): FingerprintComparisonResult {
  const sizeDiffBytes = guestFp.fileSize - hostFp.fileSize;
  const durationDiffMs = guestFp.durationMs - hostFp.durationMs;
  const headMatched = hostFp.headSha256.toLowerCase() === guestFp.headSha256.toLowerCase();
  const tailMatched = hostFp.tailSha256.toLowerCase() === guestFp.tailSha256.toLowerCase();

  // 1. Exact Match: head + tail hashes match, identical size, duration within 1s
  if (headMatched && tailMatched && Math.abs(sizeDiffBytes) === 0 && Math.abs(durationDiffMs) < 1000) {
    return {
      status: "match",
      message: "Exact file match! Synchronized playback is ready.",
      durationDiffMs,
      sizeDiffBytes,
      headMatched: true,
      tailMatched: true,
      suggestedOffsetMs: 0,
    };
  }

  // 2. Different Version (Offset Suspected):
  // - Head matches but tail differs (extended cut, different outro/credits)
  // - Tail matches but head differs (different intro/bumper - duration difference gives offset!)
  // - Duration is within 3 minutes (180,000 ms) and ratio is close (>= 0.9 and <= 1.1)
  const durationClose = Math.abs(durationDiffMs) <= 180000;
  const durationRatio = hostFp.durationMs > 0 ? guestFp.durationMs / hostFp.durationMs : 1;
  const ratioClose = durationRatio >= 0.9 && durationRatio <= 1.1;

  if (headMatched || tailMatched || (durationClose && ratioClose)) {
    const suggestedOffsetMs = tailMatched ? durationDiffMs : 0;
    return {
      status: "different_version",
      message: "Different cut or encode detected. A manual time offset may be required to align scenes.",
      durationDiffMs,
      sizeDiffBytes,
      headMatched,
      tailMatched,
      suggestedOffsetMs,
    };
  }

  // 3. Complete Mismatch
  return {
    status: "mismatch",
    message: "File mismatch: The selected file has differing duration and content hashes.",
    durationDiffMs,
    sizeDiffBytes,
    headMatched: false,
    tailMatched: false,
  };
}

/**
 * Storage for user time offsets, persisted per fingerprint in localStorage
 */
export class LocalOffsetStore {
  private static readonly STORAGE_PREFIX = "wp_local_offset_";

  public static getOffset(fingerprint: string): number {
    if (typeof localStorage === "undefined" || !fingerprint) return 0;
    try {
      const val = localStorage.getItem(this.STORAGE_PREFIX + fingerprint);
      return val ? parseInt(val, 10) || 0 : 0;
    } catch {
      return 0;
    }
  }

  public static setOffset(fingerprint: string, offsetMs: number): void {
    if (typeof localStorage === "undefined" || !fingerprint) return;
    try {
      localStorage.setItem(this.STORAGE_PREFIX + fingerprint, String(Math.round(offsetMs)));
    } catch {}
  }

  public static clearOffset(fingerprint: string): void {
    if (typeof localStorage === "undefined" || !fingerprint) return;
    try {
      localStorage.removeItem(this.STORAGE_PREFIX + fingerprint);
    } catch {}
  }
}

/**
 * Parses timestamp string "00:01:23,456" or "00:01:23.456" or "01:23.456" into milliseconds
 */
export function parseSubtitleTimestamp(timeStr: string): number {
  const normalized = timeStr.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return Math.round(parseFloat(h) * 3600000 + parseFloat(m) * 60000 + parseFloat(s) * 1000);
  } else if (parts.length === 2) {
    const [m, s] = parts;
    return Math.round(parseFloat(m) * 60000 + parseFloat(s) * 1000);
  }
  return 0;
}

/**
 * Converts SubRip (.srt) format to standard WebVTT (.vtt) format
 */
export function convertSrtToVtt(srtContent: string): string {
  const normalized = srtContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  // Replace SRT comma timestamp separator with VTT period
  const convertedTimestamps = normalized.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    "$1.$2 --> $3.$4"
  );
  if (!convertedTimestamps.startsWith("WEBVTT")) {
    return "WEBVTT\n\n" + convertedTimestamps;
  }
  return convertedTimestamps;
}

/**
 * Parses SRT or VTT content into structured SubtitleCue items
 */
export function parseSubtitleCues(rawText: string): SubtitleCue[] {
  const text = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const blocks = text.split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    let timeLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("-->")) {
        timeLineIndex = i;
        break;
      }
    }

    if (timeLineIndex === -1) continue;

    const timeLine = lines[timeLineIndex];
    const [startStr, endStr] = timeLine.split("-->").map((s) => s.trim().split(" ")[0]);
    const startMs = parseSubtitleTimestamp(startStr);
    const endMs = parseSubtitleTimestamp(endStr);

    const cueId = timeLineIndex > 0 ? lines[0] : undefined;
    const cueText = lines.slice(timeLineIndex + 1).join("\n");

    if (endMs > startMs) {
      cues.push({
        id: cueId,
        startMs,
        endMs,
        text: cueText,
      });
    }
  }

  return cues.sort((a, b) => a.startMs - b.startMs);
}
