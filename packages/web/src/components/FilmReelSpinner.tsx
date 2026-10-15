'use client';

/**
 * 35mm Film Reel Spinner Component
 * Replaces generic circular spinners with an authentic 35mm cinema reel with rotating sprockets.
 */

import React from 'react';

export interface FilmReelSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  label?: string;
}

export function FilmReelSpinner({
  size = 'md',
  className = '',
  label,
}: FilmReelSpinnerProps) {
  const sizeMap = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24',
  };

  const pixelSizeMap = {
    sm: 24,
    md: 40,
    lg: 64,
    xl: 96,
  };

  const px = pixelSizeMap[size];

  return (
    <div className={`inline-flex flex-col items-center justify-center gap-3 ${className}`}>
      <div className={`relative ${sizeMap[size]} flex items-center justify-center`}>
        {/* Amber projector filament glow */}
        <div className="absolute inset-0 rounded-full bg-accent/20 blur-md animate-pulse" />

        {/* Rotating 35mm Reel SVG */}
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full animate-spin"
          style={{ animationDuration: '2.4s', animationTimingFunction: 'linear' }}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Outer Rim */}
          <circle cx="50" cy="50" r="46" stroke="#F3E9DC" strokeWidth="4" opacity="0.85" />
          <circle cx="50" cy="50" r="41" stroke="#FF9F1C" strokeWidth="1.5" opacity="0.6" />

          {/* 6 Peripheral Sprocket Windows */}
          {[0, 60, 120, 180, 240, 300].map((angle, i) => {
            const rad = (angle * Math.PI) / 180;
            const cx = 50 + 26 * Math.cos(rad);
            const cy = 50 + 26 * Math.sin(rad);
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r="7"
                fill="#0E0B09"
                stroke="#FF9F1C"
                strokeWidth="2"
              />
            );
          })}

          {/* Spokes connecting hub to rim */}
          {[30, 90, 150, 210, 270, 330].map((angle, i) => {
            const rad = (angle * Math.PI) / 180;
            const x2 = 50 + 44 * Math.cos(rad);
            const y2 = 50 + 44 * Math.sin(rad);
            return (
              <line
                key={i}
                x1="50"
                y1="50"
                x2={x2}
                y2={y2}
                stroke="#A89B8C"
                strokeWidth="2.5"
                opacity="0.75"
              />
            );
          })}

          {/* Center Spindle & Core Hub */}
          <circle cx="50" cy="50" r="14" fill="#261E19" stroke="#F3E9DC" strokeWidth="3" />
          <circle cx="50" cy="50" r="6" fill="#FF9F1C" />
          <circle cx="50" cy="50" r="2.5" fill="#0E0B09" />
        </svg>
      </div>

      {label && (
        <span className="font-mono text-xs text-muted tracking-wide flex items-center gap-1.5 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * 35mm Sprocket Border Skeleton Loader
 */
export function FilmReelSkeleton({
  className = '',
  sprockets = true,
}: {
  className?: string;
  sprockets?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-sm bg-surface-2 border border-border-brass ${className}`}
    >
      {/* Sprocket holes along top edge */}
      {sprockets && (
        <div className="absolute top-0 left-0 right-0 h-3 flex justify-between px-2 pt-0.5 pointer-events-none opacity-40">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="w-2 h-1.5 rounded-[1px] bg-bg border border-border-brass" />
          ))}
        </div>
      )}

      {/* Shimmer bar */}
      <div
        className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-accent/10 to-transparent"
        style={{
          backgroundImage:
            'linear-gradient(90deg, transparent 0%, rgba(255, 159, 28, 0.08) 50%, transparent 100%)',
        }}
      />
    </div>
  );
}
