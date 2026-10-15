'use client';

/**
 * Watch Party `useAnime` Hook
 * High-level animation hook combining:
 * 1. Component anime.js scope lifecycle (zero memory leaks, strict-mode proof)
 * 2. Automatic prefers-reduced-motion fallback
 * 3. Video element protection & GPU transform/opacity validation
 */

import { useRef, useEffect, useLayoutEffect, type DependencyList, type RefObject } from 'react';
import { createScope, Scope, animate as rawAnimate, createTimeline as rawCreateTimeline } from 'animejs';
import { getAccessibleMotionParams, isReducedMotion } from './useReducedMotion';
import { assertNonVideoTarget, assertHardwareAcceleratedProps } from './videoGuard';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface AnimeContext {
  scope: Scope;
  container: HTMLElement | null;
  /**
   * Accessible & guarded anime.js animate function.
   * Enforces hardware-accelerated transforms and respects reduced motion.
   */
  animate: (target: any, params: Record<string, any>) => any;
  /**
   * Accessible & guarded anime.js createTimeline function.
   */
  createTimeline: (params?: Record<string, any>) => any;
  /**
   * True if reduced motion is currently active.
   */
  reducedMotion: boolean;
}

export type AnimeCallback = (context: AnimeContext) => void | (() => void);

export interface UseAnimeOptions<T extends HTMLElement = HTMLDivElement> {
  /**
   * Optional existing container ref to attach to.
   */
  containerRef?: RefObject<T | null>;
  /**
   * Whether to re-run the animation when reduced-motion preference changes.
   * Default: true
   */
  watchReducedMotion?: boolean;
}

/**
 * Executes an anime.js animation lifecycle bound to a component scope.
 * 
 * @example
 * ```tsx
 * const { containerRef } = useAnime(({ animate }) => {
 *   animate('.ticket-card', {
 *     opacity: [0, 1],
 *     translateY: [12, 0],
 *     duration: MotionDurations.cinematic,
 *     ease: MotionEasings.snappyOut,
 *   });
 * });
 * return <div ref={containerRef}><div className="ticket-card">Pass</div></div>;
 * ```
 */
export function useAnime<T extends HTMLElement = HTMLDivElement>(
  callback: AnimeCallback,
  deps: DependencyList = [],
  options?: UseAnimeOptions<T>
): { containerRef: RefObject<T | null>; scopeRef: RefObject<Scope | null> } {
  const internalRef = useRef<T | null>(null);
  const containerRef = options?.containerRef || internalRef;
  const scopeRef = useRef<Scope | null>(null);

  useIsomorphicLayoutEffect(() => {
    const container = containerRef.current;

    // Create a new scope rooted at this container
    const scope = createScope({
      root: container || undefined,
    });
    scopeRef.current = scope;

    let cleanupCallback: void | (() => void);

    // Guarded animate wrapper
    const safeAnimate = (target: any, params: Record<string, any>) => {
      assertNonVideoTarget(target);
      assertHardwareAcceleratedProps(params);
      const safeParams = getAccessibleMotionParams(params);
      return rawAnimate(target, safeParams);
    };

    // Guarded timeline wrapper
    const safeCreateTimeline = (params: Record<string, any> = {}) => {
      const safeParams = getAccessibleMotionParams(params);
      const tl = rawCreateTimeline(safeParams);
      const originalAdd = tl.add.bind(tl);
      
      (tl as any).add = (target: any, itemParams: any = {}, timeOffset?: any) => {
        assertNonVideoTarget(target);
        if (itemParams && typeof itemParams === 'object') {
          assertHardwareAcceleratedProps(itemParams);
          const safeItemParams = getAccessibleMotionParams(itemParams);
          return originalAdd(target, safeItemParams, timeOffset);
        }
        return originalAdd(target, itemParams, timeOffset);
      };

      return tl;
    };

    // Execute within the scope
    scope.add(() => {
      cleanupCallback = callback({
        scope,
        container,
        animate: safeAnimate,
        createTimeline: safeCreateTimeline,
        reducedMotion: isReducedMotion(),
      });
    });

    return () => {
      if (typeof cleanupCallback === 'function') {
        try {
          cleanupCallback();
        } catch (err) {
          console.error('[useAnime] Error in custom cleanup:', err);
        }
      }
      if (scopeRef.current) {
        scopeRef.current.revert();
        scopeRef.current = null;
      }
    };
  }, deps);

  return { containerRef, scopeRef };
}
