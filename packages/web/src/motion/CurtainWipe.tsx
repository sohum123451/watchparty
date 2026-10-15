'use client';

/**
 * CurtainWipe Component
 * Theatrical Curtain Wipe Page Transition between Lobby and Room:
 * 1. Two velvet curtain panels (left & right) with brass fringe seam
 * 2. Driven by anime.js timeline with theatrical inOut easing
 * 3. Guaranteed under 800ms total duration (340ms close + 80ms pause + 360ms open)
 * 4. Skippable: Clicking anywhere immediately completes the transition
 * 5. Reduced-motion fallback: Instant fade
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createTimeline, cubicBezier } from 'animejs';
import { useReducedMotion } from './useReducedMotion';

export interface CurtainWipeProps {
  className?: string;
}

export function CurtainWipe({ className = '' }: CurtainWipeProps) {
  const [isActive, setIsActive] = useState(false);
  const leftCurtainRef = useRef<HTMLDivElement>(null);
  const rightCurtainRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<any>(null);
  const reducedMotion = useReducedMotion();

  /**
   * Triggers the theatrical curtain wipe
   * @param onMidpoint Callback fired when curtains are fully closed (e.g. route navigation)
   */
  const triggerCurtainWipe = useCallback(
    (onMidpoint?: () => void) => {
      if (reducedMotion) {
        onMidpoint?.();
        return;
      }

      setIsActive(true);

      if (timelineRef.current) {
        timelineRef.current.pause();
      }

      const tl = createTimeline({
        defaults: {
          ease: cubicBezier(0.65, 0, 0.35, 1),
        },
      });
      timelineRef.current = tl;

      const leftEl = leftCurtainRef.current;
      const rightEl = rightCurtainRef.current;
      if (!leftEl || !rightEl) {
        onMidpoint?.();
        setIsActive(false);
        return;
      }

      // Reset initial positions (open)
      leftEl.style.transform = 'translateX(-100%)';
      rightEl.style.transform = 'translateX(100%)';

      // 1. Curtains close to center (340ms)
      (tl as any).add(leftEl, {
        translateX: ['-100%', '0%'],
        duration: 340,
      }, 0);

      (tl as any).add(rightEl, {
        translateX: ['100%', '0%'],
        duration: 340,
      }, 0);

      // Midpoint trigger
      setTimeout(() => {
        onMidpoint?.();
      }, 340);

      // 2. Curtains part open to reveal destination (360ms) - Total duration: 780ms (< 800ms!)
      (tl as any).add(leftEl, {
        translateX: ['0%', '-100%'],
        duration: 360,
      }, 420);

      (tl as any).add(rightEl, {
        translateX: ['0%', '100%'],
        duration: 360,
        onComplete: () => {
          setIsActive(false);
          timelineRef.current = null;
        },
      }, 420);
    },
    [reducedMotion]
  );

  // Skip transition immediately on click
  const handleSkip = () => {
    if (timelineRef.current) {
      timelineRef.current.pause();
      timelineRef.current = null;
    }
    if (leftCurtainRef.current && rightCurtainRef.current) {
      leftCurtainRef.current.style.transform = 'translateX(-100%)';
      rightCurtainRef.current.style.transform = 'translateX(100%)';
    }
    setIsActive(false);
  };

  // Expose helper globally for route transitions
  useEffect(() => {
    (window as any).__TRIGGER_CURTAIN_WIPE__ = triggerCurtainWipe;
    return () => {
      delete (window as any).__TRIGGER_CURTAIN_WIPE__;
    };
  }, [triggerCurtainWipe]);

  if (!isActive && !timelineRef.current) return null;

  return (
    <div
      onClick={handleSkip}
      className={`curtain-wipe-container fixed inset-0 z-50 flex pointer-events-auto cursor-pointer ${className}`}
      title="Click to skip curtain transition"
    >
      {/* LEFT VELVET CURTAIN PANEL */}
      <div
        ref={leftCurtainRef}
        className="w-1/2 h-full bg-[#1A1512] border-r-2 border-border-brass-bright shadow-2xl relative flex flex-col justify-between p-6 overflow-hidden"
        style={{
          transform: 'translateX(-100%)',
          willChange: 'transform',
          backgroundImage:
            'repeating-linear-gradient(90deg, #1A1512 0px, #261E19 24px, #1A1512 48px)',
        }}
      >
        <div className="font-mono text-[10px] text-accent tracking-widest uppercase opacity-75">
          WATCH PARTY &bull; THE PRIVATE CINEMA
        </div>
        <div className="text-right font-display text-sm text-text/60">
          Act I
        </div>
      </div>

      {/* RIGHT VELVET CURTAIN PANEL */}
      <div
        ref={rightCurtainRef}
        className="w-1/2 h-full bg-[#1A1512] border-l-2 border-border-brass-bright shadow-2xl relative flex flex-col justify-between p-6 overflow-hidden"
        style={{
          transform: 'translateX(100%)',
          willChange: 'transform',
          backgroundImage:
            'repeating-linear-gradient(90deg, #1A1512 0px, #261E19 24px, #1A1512 48px)',
        }}
      >
        <div className="font-mono text-[10px] text-muted text-right tracking-widest uppercase opacity-75">
          ORCHESTRA SCREENING
        </div>
        <div className="font-display text-sm text-text/60">
          Lights Down
        </div>
      </div>
    </div>
  );
}

/**
 * Triggers the curtain wipe transition programmatically
 */
export function triggerCurtainWipe(onMidpoint?: () => void) {
  if (typeof window !== 'undefined' && (window as any).__TRIGGER_CURTAIN_WIPE__) {
    (window as any).__TRIGGER_CURTAIN_WIPE__(onMidpoint);
  } else {
    onMidpoint?.();
  }
}
