export interface NtpSample {
  offsetMs: number;
  rttMs: number;
}

/**
 * Standard NTP offset and RTT calculation from 4 timestamps:
 * t0: Client send time
 * t1: Server receive time
 * t2: Server response send time
 * t3: Client receive time
 */
export function calculateNtpSample(
  t0: number,
  t1: number,
  t2: number,
  t3: number
): NtpSample {
  const rttMs = Math.max(0, (t3 - t0) - (t2 - t1));
  const offsetMs = ((t1 - t0) + (t2 - t3)) / 2;
  return { offsetMs, rttMs };
}

/**
 * Calculates the robust median offset from a collection of samples,
 * prioritizing lower RTT samples and eliminating extreme outliers.
 */
export function calculateRobustMedianOffset(samples: NtpSample[]): number {
  if (samples.length === 0) return 0;
  if (samples.length === 1) return samples[0].offsetMs;

  // Sort primarily by RTT to pick the cleanest network transit times
  const sortedByRtt = [...samples].sort((a, b) => a.rttMs - b.rttMs);
  
  // Take the best 60% of samples (minimum 3 samples if available)
  const countToKeep = Math.max(1, Math.min(sortedByRtt.length, Math.ceil(sortedByRtt.length * 0.6)));
  const bestSamples = sortedByRtt.slice(0, countToKeep);

  // Compute median of the offsets of the best samples
  const offsets = bestSamples.map(s => s.offsetMs).sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);
  
  if (offsets.length % 2 !== 0) {
    return offsets[mid];
  }
  return (offsets[mid - 1] + offsets[mid]) / 2;
}

export function estimateServerTime(localTimeMs: number, clockOffsetMs: number): number {
  return localTimeMs + clockOffsetMs;
}
