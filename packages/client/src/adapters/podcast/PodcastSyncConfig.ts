import { SyncEngineConfig } from "../../sync/types.js";

/**
 * Audio-specific sync tuning parameters.
 * Audio phase differences and acoustic echoes are much more perceptible to the human ear
 * than video frame offsets. Therefore:
 * - deadZoneMs is tighter (20ms instead of 40ms) to maintain acoustic coherence.
 * - hysteresisZoneMs is tighter (10ms instead of 20ms).
 * - playbackRate nudging is prioritized with preservesPitch = true to avoid audio pitch shifting.
 * - hardSeekThresholdMs is higher (1500ms) to avoid jarring audio DSP decoder clicks/rebuffering,
 *   relying on smooth rate nudging for minor and moderate drifts.
 */
export const PODCAST_SYNC_CONFIG: Partial<SyncEngineConfig> = {
  deadZoneMs: 20,
  hysteresisZoneMs: 10,
  hardSeekThresholdMs: 1500,
  maxRateAdjustment: 0.05,
  driftIntervalMs: 150,
};
