'use client';

/**
 * 35mm Password Strength Film-Strip Meter
 * Visualizes password entropy as progressively developed 35mm film frames with sprockets.
 */

import React from 'react';

export function calculatePasswordStrength(password: string): {
  score: number; // 0 to 4
  label: string;
  color: string;
} {
  if (!password) {
    return { score: 0, label: 'Unexposed Film', color: '#675C51' };
  }

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[0-9]/.test(password) && /[a-zA-Z]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  const labels = [
    'Unexposed (Too Fragile)',
    'Developing... (Fair)',
    'Exposed (Cinema Grade)',
    'Archival Negative (Projectionist)',
    'Master Vault Key (Unbreakable)',
  ];

  const colors = [
    '#675C51', // muted dark
    '#E4572E', // marquee red
    '#FFB347', // amber light
    '#FF9F1C', // projector amber
    '#2EC4B6', // cathode live
  ];

  return {
    score,
    label: labels[score],
    color: colors[score],
  };
}

export function PasswordFilmStripMeter({ password = '' }: { password?: string }) {
  const { score, label, color } = calculatePasswordStrength(password);

  return (
    <div className="w-full my-3">
      {/* Label and Score Readout */}
      <div className="flex justify-between items-center text-xs font-mono mb-1.5">
        <span className="text-muted text-[11px] uppercase tracking-wider">
          Emulsion Strength:
        </span>
        <span style={{ color }} className="font-semibold transition-colors duration-300">
          {label}
        </span>
      </div>

      {/* 35mm Film Strip Frame Container */}
      <div className="relative bg-[#0E0B09] border border-border-brass rounded-sm p-1 shadow-inner">
        {/* Top Sprocket Hole Row */}
        <div className="flex justify-between px-2 mb-1 opacity-50">
          {[...Array(16)].map((_, i) => (
            <div key={i} className="w-1.5 h-1 rounded-[1px] bg-[#1A1512] border border-border-subtle" />
          ))}
        </div>

        {/* 4 Exposed 35mm Frames */}
        <div className="grid grid-cols-4 gap-1.5 px-1">
          {[1, 2, 3, 4].map((frameNum) => {
            const isExposed = score >= frameNum;
            return (
              <div
                key={frameNum}
                className={`relative h-6 rounded-[2px] border transition-all duration-300 flex items-center justify-center overflow-hidden ${
                  isExposed
                    ? 'border-accent/80 bg-accent/25 shadow-[0_0_8px_rgba(255,159,28,0.35)]'
                    : 'border-border-subtle bg-surface-2 opacity-40'
                }`}
              >
                {/* Frame number watermark */}
                <span className="font-mono text-[9px] text-muted-dark select-none">
                  F0{frameNum}
                </span>

                {/* Developer Chemical Shimmer if exposed */}
                {isExposed && (
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-accent/30 to-transparent animate-pulse" />
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom Sprocket Hole Row */}
        <div className="flex justify-between px-2 mt-1 opacity-50">
          {[...Array(16)].map((_, i) => (
            <div key={i} className="w-1.5 h-1 rounded-[1px] bg-[#1A1512] border border-border-subtle" />
          ))}
        </div>
      </div>
    </div>
  );
}
