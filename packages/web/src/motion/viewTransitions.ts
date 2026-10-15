'use client';

/**
 * View Transitions & Shared-Element Transition Engine
 * 1. Native View Transitions API for shared-element morphing (poster -> room header)
 * 2. Anime.js fallback for browsers without View Transitions support
 * 3. Quick fade for settings / sub-tabs (< 240ms)
 * 4. All transitions under 800ms and skippable
 */

import { isReducedMotion } from './useReducedMotion';
import { animate, cubicBezier } from 'animejs';

export interface SharedTransitionOptions {
  sharedElementSelector?: string;
  fallbackDurationMs?: number;
  onFinished?: () => void;
}

/**
 * Executes a shared-element view transition with progressive enhancement
 */
export function executeSharedTransition(
  updateDOM: () => void | Promise<void>,
  options: SharedTransitionOptions = {}
): Promise<void> {
  const { fallbackDurationMs = 240, onFinished } = options;

  // 1. Reduced Motion: Execute immediately without transition
  if (isReducedMotion()) {
    return Promise.resolve(updateDOM()).then(() => onFinished?.());
  }

  // 2. Native View Transitions API (Chrome 111+, Safari 18+, Edge)
  if (typeof document !== 'undefined' && 'startViewTransition' in document) {
    const transition = (document as any).startViewTransition(async () => {
      await updateDOM();
    });

    return transition.finished
      .then(() => onFinished?.())
      .catch(() => {
        // Safe fallback if transition was skipped/aborted
        onFinished?.();
      });
  }

  // 3. Anime.js Fallback for browsers without native View Transitions
  return Promise.resolve(updateDOM()).then(() => {
    if (typeof document !== 'undefined' && options.sharedElementSelector) {
      const el = document.querySelector(options.sharedElementSelector);
      if (el) {
        animate(el, {
          opacity: [0.3, 1],
          scale: [0.94, 1],
          duration: Math.min(fallbackDurationMs, 750),
          ease: cubicBezier(0.16, 1, 0.3, 1),
          onComplete: () => {
            onFinished?.();
          },
        } as any);
        return;
      }
    }
    onFinished?.();
  });
}

/**
 * Quick fade transition for settings sub-pages (< 240ms)
 */
export function quickSettingsFade(target: any, onComplete?: () => void) {
  if (isReducedMotion()) {
    onComplete?.();
    return;
  }

  animate(target, {
    opacity: [0, 1],
    translateX: [6, 0],
    duration: 220,
    ease: cubicBezier(0.16, 1, 0.3, 1),
    onComplete: () => {
      onComplete?.();
    },
  } as any);
}
