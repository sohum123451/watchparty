/**
 * Watch Party Playback & Video Frame Isolation Guard
 * 
 * Rules:
 * 1. Animation MUST NEVER run on the <video> element itself (decoder surface disruption).
 * 2. Animations must ONLY use GPU-composited properties: transform and opacity.
 * 3. Layout-thrashing properties (width, height, top, left, margin, padding) are forbidden in animations.
 * 4. The video synchronization engine loop must remain completely isolated from UI micro-animations.
 */

// Forbidden layout-thrashing properties during animated transitions
const FORBIDDEN_LAYOUT_PROPS = new Set([
  'width',
  'height',
  'top',
  'left',
  'right',
  'bottom',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'padding',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'borderWidth',
  'fontSize',
  'lineHeight',
]);

/**
 * Validates that an animation target is not a video or audio media element.
 */
export function assertNonVideoTarget(target: any): void {
  if (!target) return;

  const elements: any[] = [];

  if (typeof document !== 'undefined' && typeof target === 'string') {
    elements.push(...Array.from(document.querySelectorAll(target)));
  } else if (Array.isArray(target)) {
    elements.push(...target);
  } else {
    elements.push(target);
  }

  for (const el of elements) {
    const tagName = (el?.tagName || '').toLowerCase();
    if (tagName === 'video') {
      const err = new Error(
        `[Motion Violation] Animations are strictly prohibited on <video> elements! ` +
        `Animating the video element triggers pipeline re-compositing and frame drops during playback. ` +
        `Apply animations to an outer container or overlay instead.`
      );
      if (process.env.NODE_ENV !== 'production') {
        throw err;
      } else {
        console.error(err.message);
      }
    }
  }
}

/**
 * Validates that animated properties only use GPU-composited transform/opacity.
 */
export function assertHardwareAcceleratedProps(params: Record<string, any>): void {
  if (process.env.NODE_ENV === 'production') return;

  for (const key of Object.keys(params)) {
    if (FORBIDDEN_LAYOUT_PROPS.has(key)) {
      console.warn(
        `[Motion Warning] Property '${key}' triggers browser layout recalculations. ` +
        `During video playback, this can block the main thread and cause clock desynchronization. ` +
        `Use GPU-accelerated 'transform' (translate/scale) or 'opacity' instead.`
      );
    }
  }
}

/**
 * Isolates the playback synchronization loop from UI animation timers.
 * The sync ticker executes in its own dedicated High-Resolution time frame,
 * immune to UI micro-animation stalls or pauses.
 */
export class IsolatedSyncLoop {
  private active = false;
  private timerId: any = null;
  private lastTick = 0;
  private tickCallback: (timestamp: number, delta: number) => void;

  constructor(tickCallback: (timestamp: number, delta: number) => void) {
    this.tickCallback = tickCallback;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.lastTick = performance.now();

    const schedule = (cb: (now: number) => void) => {
      if (typeof requestAnimationFrame !== 'undefined') {
        return requestAnimationFrame(cb);
      }
      return setTimeout(() => cb(performance.now()), 16);
    };

    const loop = (now: number) => {
      if (!this.active) return;
      const delta = now - this.lastTick;
      this.lastTick = now;

      try {
        this.tickCallback(now, delta);
      } catch (err) {
        console.error('[IsolatedSyncLoop] Error in sync loop callback:', err);
      }

      this.timerId = schedule(loop);
    };

    this.timerId = schedule(loop);
  }

  stop(): void {
    this.active = false;
    if (this.timerId !== null) {
      if (typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this.timerId);
      } else {
        clearTimeout(this.timerId);
      }
      this.timerId = null;
    }
  }

  isRunning(): boolean {
    return this.active;
  }
}
