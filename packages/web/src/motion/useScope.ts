'use client';

/**
 * Watch Party `useScope` Hook
 * Wraps anime.js v4 createScope for React component encapsulation.
 * Ensures strict scoping to the component's DOM container and zero-leak cleanup.
 * 100% React Strict Mode resilient.
 */

import { useRef, useEffect, useState, useLayoutEffect, type RefObject } from 'react';
import { createScope, Scope, animate, createTimeline } from 'animejs';
import { assertNonVideoTarget } from './videoGuard';

// Isomorphic layout effect
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface UseScopeReturn<T extends HTMLElement = HTMLDivElement> {
  /**
   * Attach this ref to the component's outer container element.
   * All query selectors passed to anime.js within this scope will be restricted to this element.
   */
  containerRef: RefObject<T | null>;

  /**
   * The underlying anime.js Scope instance.
   */
  scopeRef: RefObject<Scope | null>;

  /**
   * Current scope getter.
   */
  getScope: () => Scope | null;

  /**
   * Reverts all animations currently tracked by this scope.
   */
  revert: () => void;
}

/**
 * Creates an isolated anime.js scope per component.
 * Automatically cleans up (reverts) all child animations on unmount or re-render.
 */
export function useScope<T extends HTMLElement = HTMLDivElement>(): UseScopeReturn<T> {
  const containerRef = useRef<T | null>(null);
  const scopeRef = useRef<Scope | null>(null);

  useIsomorphicLayoutEffect(() => {
    // Instantiate anime.js scope rooted at the container ref
    const scope = createScope({
      root: containerRef.current || undefined,
    });
    scopeRef.current = scope;

    return () => {
      // Revert all animations and clean up timers/listeners on unmount
      if (scopeRef.current) {
        scopeRef.current.revert();
        scopeRef.current = null;
      }
    };
  }, []);

  const revert = () => {
    if (scopeRef.current) {
      scopeRef.current.revert();
    }
  };

  const getScope = () => scopeRef.current;

  return {
    containerRef,
    scopeRef,
    getScope,
    revert,
  };
}
