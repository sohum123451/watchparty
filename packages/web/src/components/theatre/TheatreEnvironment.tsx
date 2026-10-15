'use client';

/**
 * TheatreEnvironment Component
 * Manages the 3D vs 2D cinema atmosphere layer:
 * 1. Lazy-loads the 3D scene with dynamic import (SSR disabled)
 * 2. Mobile and low-power fallback: switches to 2D seat map when GPU is weak, screen is mobile, or reduced-motion is set
 * 3. Settings toggle: "3D: Auto / On / Off"
 * 4. Passes member presence, speaking glow, and reactions
 */

import React, { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useReducedMotion } from '@/motion/useReducedMotion';
import { TheatreMember3D } from './TheatreScene3D';
import { TheatreSeatMap2D } from './TheatreSeatMap2D';
import { FilmReelSpinner } from '@/components/FilmReelSpinner';

// Lazy-load the 3D scene (zero initial bundle weight on first load)
const LazyTheatreScene3D = dynamic(() => import('./TheatreScene3D'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center bg-[#0E0B09] border border-border-brass rounded-sm">
      <FilmReelSpinner size="md" />
      <span className="font-mono text-xs text-muted mt-3">
        Loading 3D Projection Chamber...
      </span>
    </div>
  ),
});

export type ThreeDMode = 'auto' | 'on' | 'off';

export interface TheatreEnvironmentProps {
  members?: TheatreMember3D[];
  className?: string;
}

export function TheatreEnvironment({
  members,
  className = '',
}: TheatreEnvironmentProps) {
  const [threeDSetting, setThreeDSetting] = useState<ThreeDMode>('auto');
  const [isMobile, setIsMobile] = useState(false);
  const [hasWebGL, setHasWebGL] = useState(true);
  const [mounted, setMounted] = useState(false);
  const reducedMotion = useReducedMotion();

  // Detect mobile & WebGL capability on mount
  useEffect(() => {
    setMounted(true);

    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);

    // Detect WebGL
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      setHasWebGL(Boolean(gl));
    } catch {
      setHasWebGL(false);
    }

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Determine whether 3D is active
  const shouldRender3D = useMemo(() => {
    if (!hasWebGL) return false;
    if (threeDSetting === 'on') return true;
    if (threeDSetting === 'off') return false;

    // "auto" mode: disable on reduced motion or mobile viewports
    if (reducedMotion || isMobile) return false;
    return true;
  }, [threeDSetting, hasWebGL, reducedMotion, isMobile]);

  return (
    <div className={`theatre-environment relative w-full h-full flex flex-col ${className}`}>
      {/* 1. TOP 3D MODE SETTINGS TOGGLE */}
      <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5 p-1 bg-surface-2/85 border border-border-brass rounded-sm font-mono text-[10px] backdrop-blur-md shadow-sm">
        <span className="text-muted px-1">3D Engine:</span>
        {(['auto', 'on', 'off'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setThreeDSetting(mode)}
            className={`px-2 py-0.5 rounded-[2px] uppercase transition-all cursor-pointer ${
              threeDSetting === mode
                ? 'bg-accent text-[#0E0B09] font-bold shadow-xs'
                : 'text-muted hover:text-text'
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* 2. ATMOSPHERE VIEWPORT: 3D SCENE OR 2D SEAT MAP */}
      <div className="flex-1 w-full h-full min-h-[320px] relative">
        {mounted && shouldRender3D ? (
          <LazyTheatreScene3D members={members} />
        ) : (
          <div className="w-full h-full p-4 flex items-center justify-center">
            <TheatreSeatMap2D members={members} className="w-full max-w-lg" />
          </div>
        )}
      </div>
    </div>
  );
}
