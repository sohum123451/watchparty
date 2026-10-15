'use client';

/**
 * Live Reaction Demo Strip Component
 * Displays live audience avatars reacting in real-time with synchronized timecode.
 */

import React, { useState, useEffect } from 'react';
import { useAnime } from '@/motion/useAnime';
import { MotionDurations, MotionEasings } from '@/motion/tokens';
import { stagger } from 'animejs';

interface ReactionItem {
  id: number;
  user: string;
  avatar: string;
  reaction: string;
  role?: string;
}

const SAMPLE_REACTIONS: ReactionItem[] = [
  { id: 1, user: 'Elena', avatar: 'E', reaction: 'In sync' },
  { id: 2, user: 'Marcus', avatar: 'M', reaction: 'Sharp grain' },
  { id: 3, user: 'Sophia', avatar: 'S', reaction: 'Great mix' },
  { id: 4, user: 'Leo', avatar: 'L', reaction: 'Roll reel' },
];

export function LiveReactionStrip({ className = '' }: { className?: string }) {
  const [activeReactions, setActiveReactions] = useState(SAMPLE_REACTIONS);
  const [timecode, setTimecode] = useState('01:24:18.04');

  // Clock progression
  useEffect(() => {
    let frame = 4;
    let sec = 18;
    const interval = setInterval(() => {
      frame = (frame + 1) % 24;
      if (frame === 0) sec = (sec + 1) % 60;
      setTimecode(`01:24:${sec < 10 ? '0' + sec : sec}.${frame < 10 ? '0' + frame : frame}`);
    }, 41); // ~24fps simulation

    return () => clearInterval(interval);
  }, []);

  const { containerRef } = useAnime(({ createTimeline }) => {
    const tl = createTimeline({ loop: true });

    tl.add('.reaction-chip', {
      translateY: [10, 0, -4, 0],
      opacity: [0.6, 1, 0.9, 1],
      delay: stagger(400),
      duration: 600,
      ease: MotionEasings.springy,
    });

    tl.add('.reaction-chip', {
      duration: 1800,
    });
  });

  return (
    <div
      ref={containerRef}
      className={`p-4 bg-surface-2 border border-border-brass rounded-sm shadow-velvet-raised flex flex-col md:flex-row md:items-center justify-between gap-4 ${className}`}
    >
      {/* Playback Clock & Format */}
      <div className="flex items-center gap-3">
        <div className="w-2.5 h-2.5 rounded-full bg-live shadow-cathode animate-pulse" />
        <div>
          <div className="flex items-center gap-2 font-mono text-xs text-text tabular-nums">
            <span className="text-accent font-semibold">{timecode}</span>
            <span className="text-muted-dark">/ 02:40:00.00</span>
          </div>
          <div className="font-mono text-[10px] text-muted">70mm 4K • 0.08ms Drift</div>
        </div>
      </div>

      {/* Avatars with Reaction Bubbles */}
      <div className="flex flex-wrap items-center gap-3">
        {activeReactions.map((item) => (
          <div
            key={item.id}
            className="reaction-chip flex items-center gap-2 px-2.5 py-1.5 bg-surface border border-border-subtle rounded-full text-xs shadow-sm hover:border-border-brass-bright transition-all"
          >
            {/* Avatar with live beacon */}
            <div className="relative">
              <div className="w-6 h-6 rounded-full bg-surface-3 border border-border-brass flex items-center justify-center font-display font-bold text-[11px] text-text">
                {item.avatar}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-live border border-bg" />
            </div>

            <div className="flex flex-col">
              <span className="text-[10px] font-mono text-muted leading-tight">
                {item.user}
              </span>
              <span className="font-semibold text-text text-[11px]">{item.reaction}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
