import { ReactionManager, ReactionHeatmapBucket } from "../social/ReactionManager.js";

export interface Hotspot {
  timeMs: number;
  timeFormatted: string;
  intensity: number; // 0.0 to 1.0
  reactionCount: number;
  topEmoji: string;
  description: string;
}

export interface HotspotJumpHandler {
  (targetTimeMs: number): void;
}

export class ReactionHeatmapTimeline {
  private reactionManager: ReactionManager;
  private onJump?: HotspotJumpHandler;

  constructor(options: {
    reactionManager: ReactionManager;
    onJump?: HotspotJumpHandler;
  }) {
    this.reactionManager = options.reactionManager;
    this.onJump = options.onJump;
  }

  /**
   * Generates hotspot markers along the video duration where the room reacted most intensely.
   */
  public getHotspots(videoDurationMs: number, thresholdIntensity = 0.4): Hotspot[] {
    const buckets = this.reactionManager.buildTimelineHeatmap(videoDurationMs, 5000);
    const hotspots: Hotspot[] = [];

    for (const b of buckets) {
      if (b.intensity >= thresholdIntensity && b.count > 0) {
        const midTimeMs = Math.round((b.startTimeMs + b.endTimeMs) / 2);
        const mins = Math.floor(midTimeMs / 60000);
        const secs = Math.floor((midTimeMs % 60000) / 1000);
        const timeFormatted = `${mins}:${secs.toString().padStart(2, "0")}`;

        hotspots.push({
          timeMs: midTimeMs,
          timeFormatted,
          intensity: Number(b.intensity.toFixed(2)),
          reactionCount: b.count,
          topEmoji: b.topEmoji,
          description: `${b.count} reaction${b.count > 1 ? "s" : ""} (${b.topEmoji}) at ${timeFormatted}`,
        });
      }
    }

    // Sort by intensity descending so the hottest peaks come first
    return hotspots.sort((a, b) => b.intensity - a.intensity);
  }

  /**
   * Triggers a synchronized seek jump to the hotspot for all party members.
   */
  public jumpToHotspot(hotspotTimeMs: number): void {
    if (this.onJump) {
      this.onJump(Math.max(0, hotspotTimeMs));
    }
  }

  /**
   * Renders SVG gradient / CSS bar background tokens for the seek bar.
   */
  public generateSeekBarGradient(videoDurationMs: number): string {
    const buckets = this.reactionManager.buildTimelineHeatmap(videoDurationMs, 10000);
    if (buckets.length === 0) return "transparent";

    const colorStops: string[] = [];
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      const percent = ((i / buckets.length) * 100).toFixed(1);
      // Alpha from 0.1 to 0.8 based on intensity
      const alpha = (0.15 + b.intensity * 0.75).toFixed(2);
      colorStops.push(`rgba(244, 63, 94, ${alpha}) ${percent}%`);
    }

    return `linear-gradient(to right, ${colorStops.join(", ")})`;
  }
}
