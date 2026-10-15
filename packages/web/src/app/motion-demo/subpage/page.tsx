'use client';

import React from 'react';
import Link from 'next/link';
import { useAnime } from '@/motion/useAnime';
import { MotionDurations, MotionEasings } from '@/motion/tokens';

export default function MotionDemoSubpage() {
  const { containerRef } = useAnime(({ animate }) => {
    animate('.subpage-badge', {
      opacity: [0, 1],
      scale: [0.92, 1],
      duration: MotionDurations.cinematic,
      ease: MotionEasings.springy,
    });
  });

  return (
    <div ref={containerRef} className="max-w-4xl mx-auto px-6 py-16">
      <div className="subpage-badge p-8 bg-surface border border-border-brass rounded-sm shadow-velvet-raised text-center">
        <span className="font-mono text-xs text-accent uppercase tracking-widest block mb-2">
          Route Change Verified • U5 PageTransition Active
        </span>
        <h1 className="font-display text-3xl font-bold text-text mb-4">
          Balcony Suite 4 — Sub-Auditorium
        </h1>
        <p className="text-muted text-sm max-w-md mx-auto mb-8 leading-relaxed">
          You just transitioned routes. The &lt;PageTransition&gt; wrapper orchestrated the entrance fade and glide without layout thrashing.
        </p>

        <Link
          href="/motion-demo"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-accent text-bg font-semibold rounded-sm text-sm hover:shadow-projector transition-all"
        >
          ← Return to Motion System Atelier
        </Link>
      </div>
    </div>
  );
}
