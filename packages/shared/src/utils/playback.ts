import { PlaybackState } from "../models.js";

/**
 * Derives the exact video playback position in milliseconds given the current authoritative server time.
 * Position is derived, never continuously streamed.
 */
export function derivePlaybackPositionMs(
  playback: PlaybackState,
  currentServerTimeMs: number
): number {
  if (playback.status === "playing") {
    const elapsed = Math.max(0, currentServerTimeMs - playback.serverTimeMs);
    return Math.max(0, playback.positionMs + elapsed * (playback.playbackRate || 1.0));
  }
  return playback.positionMs;
}

export type DriftAction =
  | { type: "IN_SYNC"; driftMs: number }
  | { type: "SOFT_ADJUST"; driftMs: number; suggestedPlaybackRate: number; durationMs: number }
  | { type: "HARD_SEEK"; driftMs: number; targetPositionMs: number };

/**
 * Classifies playback drift between the client's HTML5 <video> tag and the authoritative position.
 * - Under 100ms: in-sync (do nothing)
 * - 100ms - 500ms: micro-rate nudging (1.05x or 0.95x) to avoid audio stutter
 * - Over 500ms: hard seek to target
 */
export function evaluateDrift(
  localVideoCurrentTimeSec: number,
  playback: PlaybackState,
  currentServerTimeMs: number
): DriftAction {
  const targetMs = derivePlaybackPositionMs(playback, currentServerTimeMs);
  const localMs = localVideoCurrentTimeSec * 1000;
  const driftMs = localMs - targetMs;
  const absDriftMs = Math.abs(driftMs);

  if (absDriftMs <= 100) {
    return { type: "IN_SYNC", driftMs };
  }

  if (absDriftMs <= 500) {
    // If client is ahead (drift > 0), slow down to 0.95x; if behind (drift < 0), speed up to 1.05x
    const rate = driftMs > 0 ? 0.95 : 1.05;
    const deltaRate = Math.abs(rate - 1.0);
    // Time needed to bridge the drift: duration = abs(drift) / deltaRate
    const durationMs = Math.min(5000, Math.round(absDriftMs / deltaRate));
    return {
      type: "SOFT_ADJUST",
      driftMs,
      suggestedPlaybackRate: rate,
      durationMs,
    };
  }

  return {
    type: "HARD_SEEK",
    driftMs,
    targetPositionMs: targetMs,
  };
}
