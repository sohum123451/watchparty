'use client';

/**
 * ReactionParticleOverlay Component
 * Emoji burst particle engine:
 * 1. Spawns bursts originating from the sender's exact seat position
 * 2. Capped particle pool (max 24) for zero garbage-collection jitter
 * 3. Randomized, eased floating paths upwards with sway and rotation
 * 4. Strict GPU hardware-accelerated transforms (translateY, translateX, rotate, opacity)
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useReducedMotion } from '@/motion/useReducedMotion';

export interface ReactionParticle {
  id: string;
  emoji: string;
  startX: number; // Pixels from viewport left or container left
  startY: number; // Pixels from viewport top
  driftX: number; // Random horizontal sway
  driftY: number; // Upward float distance (-200px to -320px)
  rotation: number;
  scale: number;
  durationMs: number;
}

export interface ReactionParticleOverlayProps {
  className?: string;
}

const MAX_PARTICLES = 24;

export function ReactionParticleOverlay({
  className = '',
}: ReactionParticleOverlayProps) {
  const [particles, setParticles] = useState<ReactionParticle[]>([]);
  const reducedMotion = useReducedMotion();
  const poolCounterRef = useRef(0);

  /**
   * Spawns an emoji burst from a specific seat origin coordinate
   */
  const spawnBurst = useCallback(
    (emoji: string, originX: number, originY: number, count = 4) => {
      if (reducedMotion) return;

      const newParticles: ReactionParticle[] = [];
      const baseTime = Date.now();

      for (let i = 0; i < count; i++) {
        poolCounterRef.current += 1;
        const id = `p_${baseTime}_${poolCounterRef.current}_${i}`;

        // Randomized physics parameters
        const driftX = (Math.random() - 0.5) * 80; // -40px to +40px horizontal sway
        const driftY = -(180 + Math.random() * 120); // -180px to -300px upward float
        const rotation = (Math.random() - 0.5) * 36; // -18deg to +18deg
        const scale = 0.85 + Math.random() * 0.45; // 0.85x to 1.3x size
        const durationMs = 1500 + Math.random() * 600; // 1.5s to 2.1s lifespan

        newParticles.push({
          id,
          emoji,
          startX: originX + (Math.random() - 0.5) * 20,
          startY: originY,
          driftX,
          driftY,
          rotation,
          scale,
          durationMs,
        });
      }

      setParticles((prev) => {
        // Enforce max particle pool cap (discard oldest if exceeding limit)
        const combined = [...prev, ...newParticles];
        if (combined.length > MAX_PARTICLES) {
          return combined.slice(combined.length - MAX_PARTICLES);
        }
        return combined;
      });

      // Schedule cleanup for this burst
      setTimeout(() => {
        const idsToRemove = new Set(newParticles.map((p) => p.id));
        setParticles((prev) => prev.filter((p) => !idsToRemove.has(p.id)));
      }, 2200);
    },
    [reducedMotion]
  );

  // Expose global window helper for testing and auditorium interactions
  useEffect(() => {
    (window as any).__WATCHPARTY_BURST__ = spawnBurst;
    return () => {
      delete (window as any).__WATCHPARTY_BURST__;
    };
  }, [spawnBurst]);

  return (
    <div
      className={`reaction-particle-overlay pointer-events-none fixed inset-0 z-50 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      {particles.map((p) => (
        <div
          key={p.id}
          className="reaction-particle absolute select-none text-2xl filter drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)]"
          style={{
            left: `${p.startX}px`,
            top: `${p.startY}px`,
            animation: `floatReaction ${p.durationMs}ms cubic-bezier(0.16, 1, 0.3, 1) forwards`,
            ['--drift-x' as any]: `${p.driftX}px`,
            ['--drift-y' as any]: `${p.driftY}px`,
            ['--rot' as any]: `${p.rotation}deg`,
            ['--scale' as any]: p.scale,
          }}
        >
          {p.emoji}
        </div>
      ))}

      {/* Embedded Hardware-Accelerated Keyframe Animation */}
      <style jsx global>{`
        @keyframes floatReaction {
          0% {
            opacity: 0;
            transform: translate3d(0, 0, 0) scale(0.4) rotate(0deg);
          }
          15% {
            opacity: 1;
            transform: translate3d(calc(var(--drift-x) * 0.2), calc(var(--drift-y) * 0.2), 0) scale(var(--scale)) rotate(calc(var(--rot) * 0.3));
          }
          75% {
            opacity: 0.95;
            transform: translate3d(calc(var(--drift-x) * 0.8), calc(var(--drift-y) * 0.8), 0) scale(var(--scale)) rotate(var(--rot));
          }
          100% {
            opacity: 0;
            transform: translate3d(var(--drift-x), var(--drift-y), 0) scale(calc(var(--scale) * 0.8)) rotate(var(--rot));
          }
        }
      `}</style>
    </div>
  );
}
