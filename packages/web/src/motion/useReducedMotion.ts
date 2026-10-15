'use client';

/**
 * Watch Party Reduced Motion System
 * Enforces accessibility compliance across all components and animations.
 * Provides a global flag, media-query listener, and parameter normalization.
 */

import { useState, useEffect, useSyncExternalStore } from 'react';
import { MotionDurations, MotionEasings } from './tokens';

// Global state store for reduced motion (syncs system preference + user override)
type Listener = () => void;
const listeners = new Set<Listener>();

let userOverride: boolean | null = null;
let systemPreference = false;

function notify() {
  listeners.forEach((listener) => listener());
}

// Initialize system preference if window is available
if (typeof window !== 'undefined') {
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  systemPreference = mediaQuery.matches;

  mediaQuery.addEventListener('change', (e) => {
    systemPreference = e.matches;
    notify();
  });
}

/**
 * Global synchronous query for reduced motion state.
 * Safe to call inside event handlers, animation loops, and utilities.
 */
export function isReducedMotion(): boolean {
  if (userOverride !== null) {
    return userOverride;
  }
  return systemPreference;
}

/**
 * Allows user-level override (e.g., from an accessibility toolbar or demo toggle).
 */
export function setReducedMotionOverride(override: boolean | null): void {
  userOverride = override;
  notify();
}

/**
 * React hook that subscribes to the global reduced motion state.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    () => isReducedMotion(),
    () => false // Server snapshot defaults to false
  );
}

/**
 * Normalizes animation parameters against reduced motion rules:
 * - If reduced motion is active:
 *   1. Suppresses spatial translations, rotations, and scales.
 *   2. Replaces complex easings with linear.
 *   3. Reduces duration to 0 (instant) or 120ms for gentle opacity fade.
 * - Otherwise:
 *   Returns the original parameters intact.
 */
export function getAccessibleMotionParams<T extends Record<string, any>>(
  params: T,
  options?: { allowFade?: boolean }
): Record<string, any> {
  if (!isReducedMotion()) {
    return params;
  }

  const allowFade = options?.allowFade ?? true;
  const filtered: Record<string, any> = {};

  // Preserve non-transform properties
  for (const [key, value] of Object.entries(params)) {
    // Spatial transform keys to strip
    if (
      key.startsWith('translate') ||
      key.startsWith('scale') ||
      key.startsWith('rotate') ||
      key.startsWith('skew') ||
      key === 'transform'
    ) {
      continue;
    }

    if (key === 'opacity' && allowFade) {
      filtered.opacity = value;
    } else if (key === 'duration') {
      filtered.duration = allowFade ? MotionDurations.micro : MotionDurations.instant;
    } else if (key === 'ease') {
      filtered.ease = MotionEasings.linear;
    } else if (key === 'delay') {
      filtered.delay = 0;
    } else {
      filtered[key] = value;
    }
  }

  if (!allowFade) {
    filtered.duration = MotionDurations.instant;
    filtered.delay = 0;
  }

  return filtered;
}
