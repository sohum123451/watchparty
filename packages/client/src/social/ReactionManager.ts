import { ReactionBurst, isValidEmoji } from "@watchparty/shared";

export interface FloatingParticle {
  id: string;
  emoji: string;
  userName?: string;
  xPercent: number;        // 0 to 100% horizontal position
  yPercent: number;        // 0 to 100% vertical position (100 = bottom)
  vxPercentPerSec: number; // horizontal drift speed
  vyPercentPerSec: number; // upward float speed (positive = upwards)
  opacity: number;         // 1.0 -> 0.0
  scale: number;           // starts 0.5 -> 1.2 -> 1.0
  rotationDeg: number;     // -30deg to +30deg
  swayFreq: number;        // sinusoidal wobble frequency
  swayAmp: number;         // wobble amplitude
  createdAt: number;
  lifetimeMs: number;
  ageMs: number;
}

export interface ReactionHeatmapBucket {
  bucketIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  count: number;
  intensity: number; // 0.0 to 1.0 relative to peak
  topEmoji: string;
  breakdown: Record<string, number>;
}

export interface ReactionSendHandler {
  (emoji: string, videoTimestampMs: number): void;
}

export class ReactionManager {
  private particles: Map<string, FloatingParticle> = new Map();
  private storedReactions: ReactionBurst[] = [];
  private particleListeners: Set<(particles: FloatingParticle[]) => void> = new Set();
  private timelineListeners: Set<(heatmap: ReactionHeatmapBucket[]) => void> = new Set();

  private sendHandler?: ReactionSendHandler;

  // Client-side rate limiting: max 5 reactions per 2 seconds
  private outgoingReactionTimestamps: number[] = [];

  // Animation frame loop
  private animationFrameId: any = null;
  private lastTickTime = 0;
  private isTicking = false;

  constructor(options?: {
    initialReactions?: ReactionBurst[];
    sendHandler?: ReactionSendHandler;
  }) {
    if (options?.initialReactions) {
      this.initStoredReactions(options.initialReactions);
    }
    this.sendHandler = options?.sendHandler;
  }

  public initStoredReactions(reactions: ReactionBurst[]): void {
    this.storedReactions = [...reactions];
    this.notifyTimelineChange();
  }

  public getStoredReactions(): ReactionBurst[] {
    return [...this.storedReactions];
  }

  /**
   * Emit an emoji reaction with client-side throttling.
   */
  public emit(emoji: string, currentVideoTimeMs: number): boolean {
    if (!isValidEmoji(emoji)) {
      return false;
    }

    const now = Date.now();
    this.outgoingReactionTimestamps = this.outgoingReactionTimestamps.filter(
      (t) => now - t < 2000
    );

    if (this.outgoingReactionTimestamps.length >= 5) {
      return false; // Throttled
    }

    this.outgoingReactionTimestamps.push(now);

    // Spawn local preview immediately
    this.spawnParticle(emoji);

    // Send to server
    this.sendHandler?.(emoji, Math.max(0, currentVideoTimeMs));
    return true;
  }

  /**
   * Handle incoming reaction broadcast from peer or self.
   */
  public handleIncomingReaction(reaction: ReactionBurst): void {
    this.storedReactions.push(reaction);
    if (this.storedReactions.length > 1000) {
      this.storedReactions.shift();
    }

    this.spawnParticle(reaction.emoji, reaction.userName);
    this.notifyTimelineChange();
  }

  /**
   * Spawns a floating particle with natural floating physics and slight wobble.
   */
  public spawnParticle(
    emoji: string,
    userName?: string,
    options?: { lifetimeMs?: number; xPercent?: number; yPercent?: number }
  ): FloatingParticle {
    const id = `pt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    // Spread across bottom 20% to 80% of width
    const xPercent = options?.xPercent ?? (25 + Math.random() * 50);
    const yPercent = options?.yPercent ?? (90 + Math.random() * 5);
    const lifetimeMs = options?.lifetimeMs ?? (2000 + Math.random() * 800); // 2.0s - 2.8s

    const particle: FloatingParticle = {
      id,
      emoji,
      userName,
      xPercent,
      yPercent,
      vxPercentPerSec: (Math.random() - 0.5) * 6,
      vyPercentPerSec: 30 + Math.random() * 20, // 30-50% screen height per second
      opacity: 1.0,
      scale: 0.6,
      rotationDeg: (Math.random() - 0.5) * 30,
      swayFreq: 2 + Math.random() * 2,
      swayAmp: 1.5 + Math.random() * 2.0,
      createdAt: Date.now(),
      lifetimeMs,
      ageMs: 0,
    };

    this.particles.set(id, particle);
    this.ensureAnimationLoop();
    this.notifyParticlesChange();

    return particle;
  }

  /**
   * Physics step for particle simulations.
   */
  public step(deltaSeconds: number): void {
    if (this.particles.size === 0) return;

    const toRemove: string[] = [];

    for (const [id, p] of this.particles.entries()) {
      p.ageMs += deltaSeconds * 1000;
      const progress = p.ageMs / p.lifetimeMs;

      if (progress >= 1.0) {
        p.opacity = 0;
        toRemove.push(id);
        continue;
      }

      // Move upward
      p.yPercent -= p.vyPercentPerSec * deltaSeconds;

      // Sinusoidal sway
      const sway = Math.sin((p.ageMs / 1000) * p.swayFreq * Math.PI) * p.swayAmp;
      p.xPercent += (p.vxPercentPerSec + sway) * deltaSeconds;

      // Scale pop-in: 0.6 -> 1.3 in first 20%, then settles to 1.0
      if (progress < 0.2) {
        p.scale = 0.6 + (progress / 0.2) * 0.7;
      } else {
        p.scale = 1.3 - ((progress - 0.2) / 0.8) * 0.3;
      }

      // Opacity fade-out: solid until 60%, then fades to 0
      if (progress > 0.6) {
        p.opacity = 1.0 - (progress - 0.6) / 0.4;
      } else {
        p.opacity = 1.0;
      }
    }

    for (const id of toRemove) {
      this.particles.delete(id);
    }

    this.notifyParticlesChange();

    if (this.particles.size === 0) {
      this.stopAnimationLoop();
    }
  }

  private ensureAnimationLoop(): void {
    if (this.isTicking) return;
    this.isTicking = true;
    this.lastTickTime = performance.now();

    const loop = (now: number) => {
      if (!this.isTicking) return;
      const deltaSeconds = Math.min(0.1, (now - this.lastTickTime) / 1000);
      this.lastTickTime = now;

      this.step(deltaSeconds);

      if (this.particles.size > 0) {
        if (typeof requestAnimationFrame !== "undefined") {
          this.animationFrameId = requestAnimationFrame(loop);
        } else {
          this.animationFrameId = setTimeout(() => loop(performance.now()), 16);
        }
      } else {
        this.stopAnimationLoop();
      }
    };

    if (typeof requestAnimationFrame !== "undefined") {
      this.animationFrameId = requestAnimationFrame(loop);
    } else {
      this.animationFrameId = setTimeout(() => loop(performance.now()), 16);
    }
  }

  private stopAnimationLoop(): void {
    this.isTicking = false;
    if (this.animationFrameId !== null) {
      if (typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(this.animationFrameId);
      } else {
        clearTimeout(this.animationFrameId);
      }
      this.animationFrameId = null;
    }
  }

  public getActiveParticles(): FloatingParticle[] {
    return Array.from(this.particles.values());
  }

  /**
   * Computes reaction heatmap buckets along video duration for the scrubber timeline.
   */
  public buildTimelineHeatmap(
    videoDurationMs: number,
    bucketDurationMs = 5000
  ): ReactionHeatmapBucket[] {
    if (videoDurationMs <= 0 || this.storedReactions.length === 0) {
      return [];
    }

    const bucketCount = Math.max(1, Math.ceil(videoDurationMs / bucketDurationMs));
    const buckets: ReactionHeatmapBucket[] = Array.from({ length: bucketCount }, (_, idx) => ({
      bucketIndex: idx,
      startTimeMs: idx * bucketDurationMs,
      endTimeMs: Math.min(videoDurationMs, (idx + 1) * bucketDurationMs),
      count: 0,
      intensity: 0,
      topEmoji: "❤️",
      breakdown: {},
    }));

    for (const rx of this.storedReactions) {
      const idx = Math.min(
        bucketCount - 1,
        Math.max(0, Math.floor(rx.videoTimestampMs / bucketDurationMs))
      );
      const b = buckets[idx];
      b.count++;
      b.breakdown[rx.emoji] = (b.breakdown[rx.emoji] || 0) + 1;
    }

    let maxCount = 0;
    for (const b of buckets) {
      if (b.count > maxCount) {
        maxCount = b.count;
      }
      // Determine top emoji
      let topEmoji = "❤️";
      let topCount = 0;
      for (const [em, cnt] of Object.entries(b.breakdown)) {
        if (cnt > topCount) {
          topCount = cnt;
          topEmoji = em;
        }
      }
      b.topEmoji = topEmoji;
    }

    if (maxCount > 0) {
      for (const b of buckets) {
        b.intensity = b.count / maxCount;
      }
    }

    return buckets;
  }

  /**
   * Retrieves reactions within windowMs of video timestamp for playback replay.
   */
  public getReactionsNearTimestamp(timestampMs: number, windowMs = 2000): ReactionBurst[] {
    return this.storedReactions.filter(
      (r) => Math.abs(r.videoTimestampMs - timestampMs) <= windowMs
    );
  }

  public subscribeParticles(listener: (particles: FloatingParticle[]) => void): () => void {
    this.particleListeners.add(listener);
    listener(this.getActiveParticles());
    return () => this.particleListeners.delete(listener);
  }

  public subscribeTimeline(listener: (heatmap: ReactionHeatmapBucket[]) => void): () => void {
    this.timelineListeners.add(listener);
    return () => this.timelineListeners.delete(listener);
  }

  private notifyParticlesChange(): void {
    const list = this.getActiveParticles();
    for (const listener of this.particleListeners) {
      listener(list);
    }
  }

  private notifyTimelineChange(): void {
    for (const listener of this.timelineListeners) {
      listener(this.buildTimelineHeatmap(600000));
    }
  }

  public destroy(): void {
    this.stopAnimationLoop();
    this.particles.clear();
    this.particleListeners.clear();
    this.timelineListeners.clear();
  }
}
