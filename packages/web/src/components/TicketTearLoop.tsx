'use client';

/**
 * Looping 2D Ticket Tear Animation Component
 * Built with anime.js v4 timeline orchestration.
 * Demonstrates a tactile cinema ticket being separated along a perforated seam and dropped into the box.
 */

import React from 'react';
import { useAnime } from '@/motion/useAnime';
import { MotionDurations, MotionEasings } from '@/motion/tokens';
import { useReducedMotion } from '@/motion/useReducedMotion';

export function TicketTearLoop({ className = '' }: { className?: string }) {
  const reducedMotion = useReducedMotion();

  const { containerRef } = useAnime(
    ({ createTimeline }) => {
      if (reducedMotion) {
        // Reduced motion: gentle static presentation without continuous tearing loop
        return;
      }

      const tl = createTimeline({
        loop: true,
        defaults: {
          ease: MotionEasings.snappyOut,
        },
      });

      // 1. Initial intact hold
      tl.add('.tear-stub-right', { duration: 1400 });

      // 2. Pre-tear tension vibration
      tl.add('.tear-ticket-wrapper', {
        translateX: [-1, 1.5, -1, 0.5, 0],
        duration: 320,
        ease: 'linear',
      });

      // 3. Crisp mechanical tear separation
      tl.add(
        '.tear-stub-right',
        {
          translateX: [0, 46],
          translateY: [0, 6],
          rotate: [0, 4.5],
          duration: MotionDurations.cinematic,
          ease: MotionEasings.springy,
        },
        '-=100'
      );

      tl.add(
        '.tear-ticket-left',
        {
          translateX: [0, -10],
          duration: MotionDurations.snappy,
          ease: MotionEasings.snappyOut,
        },
        '-=400'
      );

      tl.add(
        '.tear-seam-flash',
        {
          opacity: [0, 1, 0],
          duration: 200,
        },
        '-=450'
      );

      // 4. Stub drops into the box office slot
      tl.add('.tear-stub-right', {
        translateY: [6, 32],
        opacity: [1, 0.45],
        duration: 480,
        ease: MotionEasings.cinematicInOut,
      });

      // 5. Hold separated
      tl.add('.tear-stub-right', { duration: 1200 });

      // 6. Reset back to intact state
      tl.add('.tear-stub-right', {
        translateX: 0,
        translateY: 0,
        rotate: 0,
        opacity: 1,
        duration: 520,
        ease: MotionEasings.springy,
      });

      tl.add(
        '.tear-ticket-left',
        {
          translateX: 0,
          duration: 400,
          ease: MotionEasings.snappyOut,
        },
        '-=400'
      );
    },
    [reducedMotion]
  );

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center justify-center p-4 ${className}`}
    >
      <div className="tear-ticket-wrapper relative flex items-stretch filter drop-shadow-[0_8px_24px_rgba(0,0,0,0.85)]">
        {/* LEFT TICKET BODY (70% of ticket) */}
        <div className="tear-ticket-left relative w-64 p-5 bg-surface-2 border border-border-brass rounded-l-md overflow-hidden flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center text-[10px] font-mono text-accent mb-2">
              <span className="tracking-widest uppercase">ADMISSION PASS</span>
              <span>NO. 004812</span>
            </div>
            <div className="font-display font-bold text-xl text-text leading-tight mb-1">
              Cinema Royale
            </div>
            <div className="text-xs text-muted font-sans">
              Balcony Suite 4 • 70mm Roadshow Cut
            </div>
          </div>

          <div className="mt-6 flex justify-between items-end text-[10px] font-mono text-muted-dark border-t border-border-subtle pt-3">
            <div>ROW A • SEAT 14</div>
            <div className="text-live">SYNC MASTER</div>
          </div>

          {/* Semicircular Perforation Notch (Right edge of left half) */}
          <div className="absolute top-1/2 -right-2.5 -translate-y-1/2 w-5 h-5 rounded-full bg-bg border border-border-brass pointer-events-none" />
        </div>

        {/* PERFORATION SEAM FLASH EFFECT */}
        <div className="tear-seam-flash absolute left-64 top-0 bottom-0 w-1 bg-accent/80 opacity-0 pointer-events-none blur-[1px]" />

        {/* RIGHT TICKET STUB (Tear-off piece) */}
        <div className="tear-stub-right relative w-28 p-4 bg-surface border border-l-0 border-border-brass rounded-r-md flex flex-col justify-between items-center text-center origin-top-left">
          {/* Dashed Tear Line indicator */}
          <div className="absolute left-0 top-0 bottom-0 w-[1px] border-l border-dashed border-border-brass-bright" />

          {/* Semicircular Perforation Notch (Left edge of stub) */}
          <div className="absolute top-1/2 -left-2.5 -translate-y-1/2 w-5 h-5 rounded-full bg-bg border border-border-brass pointer-events-none" />

          <div className="font-mono text-[9px] text-accent uppercase tracking-widest">
            ADMIT ONE
          </div>

          {/* Barcode lines */}
          <div className="flex gap-1 h-10 my-2 items-stretch opacity-75">
            <div className="w-1 bg-muted" />
            <div className="w-0.5 bg-muted" />
            <div className="w-1.5 bg-muted" />
            <div className="w-0.5 bg-muted" />
            <div className="w-1 bg-muted" />
            <div className="w-2 bg-muted" />
            <div className="w-0.5 bg-muted" />
            <div className="w-1 bg-muted" />
          </div>

          <div className="font-mono text-[8px] text-muted-dark tracking-wider">
            STUB #004812
          </div>
        </div>
      </div>
    </div>
  );
}
