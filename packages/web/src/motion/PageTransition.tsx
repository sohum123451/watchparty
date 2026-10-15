'use client';

/**
 * Watch Party PageTransition Component (U5 Route Changes)
 * Orchestrates cinematic route transitions for Next.js App Router.
 * - Smoothly fades & glides new route content into the private cinema viewport.
 * - Respects prefers-reduced-motion (collapses to instant or subtle fade).
 * - Restricts transitions strictly to GPU-composited transform & opacity.
 */

import React, { useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAnime } from './useAnime';
import { MotionDurations, MotionEasings, MotionPresets } from './tokens';
import { useReducedMotion } from './useReducedMotion';

export interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

export function PageTransition({ children, className = '' }: PageTransitionProps) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();

  // Run transition animation whenever the route pathname changes
  const { containerRef } = useAnime(
    ({ animate }) => {
      if (reducedMotion) {
        // Reduced motion: subtle instant/micro fade
        animate(containerRef.current, {
          opacity: [0, 1],
          duration: MotionDurations.micro,
          ease: MotionEasings.linear,
        });
      } else {
        // Cinematic entry: 480ms graceful glide
        animate(containerRef.current, {
          opacity: [0, 1],
          translateY: [8, 0],
          duration: MotionDurations.cinematic,
          ease: MotionEasings.snappyOut,
        });
      }
    },
    [pathname, reducedMotion]
  );

  return (
    <div
      ref={containerRef}
      key={pathname}
      className={`page-transition-wrapper ${className}`}
      style={{ willChange: 'opacity, transform' }}
    >
      {children}
    </div>
  );
}
