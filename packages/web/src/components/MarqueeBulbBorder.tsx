'use client';

/**
 * Marquee Bulbs Chasing Edge Component
 * Orchestrates a chasing light timeline along an edge using anime.js v4 stagger.
 */

import React from 'react';
import { useAnime } from '@/motion/useAnime';
import { stagger } from 'animejs';
import { useReducedMotion } from '@/motion/useReducedMotion';

export function MarqueeBulbBorder({
  count = 24,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();

  const { containerRef } = useAnime(
    ({ createTimeline }) => {
      if (reducedMotion) {
        return;
      }

      const tl = createTimeline({
        loop: true,
      });

      // Chasing light wave along the bulb array
      tl.add('.bulb-dot', {
        opacity: [0.35, 1, 0.35],
        scale: [0.85, 1.25, 0.85],
        delay: stagger(75),
        duration: 480,
        ease: 'easeInOutSine',
      });
    },
    [count, reducedMotion]
  );

  return (
    <div
      ref={containerRef}
      className={`flex items-center justify-between w-full overflow-hidden select-none py-1.5 px-3 border-y border-border-brass bg-[#0E0B09]/90 ${className}`}
    >
      {[...Array(count)].map((_, i) => (
        <div
          key={i}
          className="bulb-dot relative w-2 h-2 rounded-full bg-accent opacity-40 transition-transform"
          style={{
            boxShadow: '0 0 6px rgba(255, 159, 28, 0.65)',
          }}
        />
      ))}
    </div>
  );
}
