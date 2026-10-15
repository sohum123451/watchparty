'use client';

/**
 * ProjectorSyncBadge Component
 * Tasteful "projector" sync indicator:
 * - Steady golden beam when in sync (drift < 40ms)
 * - Rhythmic shutter flicker when correcting minor drift (40ms - 140ms)
 * - Rapid lens flicker when actively re-syncing (> 140ms)
 * - Expandable panel with detailed millisecond diagnostics & resync trigger
 */

import React, { useState, useEffect } from 'react';

export interface ProjectorSyncBadgeProps {
  driftMs: number;
  rttMs?: number;
  serverTimecode?: string;
  clientTimecode?: string;
  onManualResync?: () => void;
  className?: string;
}

export function ProjectorSyncBadge({
  driftMs,
  rttMs = 24,
  serverTimecode = '01:24:18.04',
  clientTimecode = '01:24:18.02',
  onManualResync,
  className = '',
}: ProjectorSyncBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isResyncing, setIsResyncing] = useState(false);

  // Determine sync state
  const absDrift = Math.abs(driftMs);
  const isOptimal = absDrift < 40;
  const isMinorDrift = absDrift >= 40 && absDrift < 140;
  const isHighDrift = absDrift >= 140;

  const handleResync = () => {
    setIsResyncing(true);
    onManualResync?.();
    setTimeout(() => {
      setIsResyncing(false);
    }, 600);
  };

  return (
    <div className={`relative inline-block ${className}`}>
      {/* 1. TASTEFUL PROJECTOR STATUS BADGE */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-2.5 py-1.5 bg-surface/90 hover:bg-surface-2 active:scale-95 border border-border-brass rounded-sm font-mono text-xs transition-all shadow-sm cursor-pointer group"
        title="Playback Synchronization Indicator (Click for Diagnostics)"
      >
        {/* Projector Icon with Shutter Beam */}
        <div className="relative flex items-center justify-center w-4 h-4">
          {/* Projector Body */}
          <span className="text-xs">📽</span>

          {/* Light Beam Cone Indicator */}
          <div
            className={`absolute left-3.5 w-3 h-2 -translate-y-0.5 pointer-events-none transition-opacity ${
              isOptimal
                ? 'opacity-80'
                : isMinorDrift
                ? 'animate-pulse opacity-90'
                : 'animate-ping opacity-100'
            }`}
          >
            <div
              className={`w-full h-full ${
                isOptimal
                  ? 'bg-gradient-to-r from-accent to-transparent'
                  : isMinorDrift
                  ? 'bg-gradient-to-r from-accent to-transparent'
                  : 'bg-gradient-to-r from-accent-2 to-transparent'
              }`}
              style={{
                clipPath: 'polygon(0% 30%, 100% 0%, 100% 100%, 0% 70%)',
              }}
            />
          </div>
        </div>

        {/* Sync Label */}
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isOptimal
                ? 'bg-live shadow-cathode'
                : isMinorDrift
                ? 'bg-accent animate-pulse'
                : 'bg-accent-2 animate-ping'
            }`}
          />
          <span className="text-[11px] text-text font-medium group-hover:text-accent transition-colors">
            {isOptimal ? 'In Sync' : isMinorDrift ? 'Correcting' : 'Resyncing'}
          </span>
          <span className="text-[10px] text-muted font-mono tabular-nums">
            {driftMs >= 0 ? `+${driftMs}ms` : `${driftMs}ms`}
          </span>
        </div>

        {/* Expand Chevron */}
        <span className="text-[9px] text-muted group-hover:text-text transition-transform duration-200">
          {isExpanded ? '▲' : '▼'}
        </span>
      </button>

      {/* 2. EXPANDABLE SYNCHRONIZATION DIAGNOSTICS PANEL */}
      {isExpanded && (
        <div className="absolute top-full left-0 mt-2 w-72 p-3.5 bg-surface border border-border-brass rounded-sm shadow-velvet-raised z-50 font-mono text-xs space-y-3 backdrop-blur-md">
          {/* Header */}
          <div className="flex justify-between items-center pb-2 border-b border-border-brass">
            <span className="text-accent font-bold text-[10px] uppercase tracking-wider">
              PROJECTOR SYNCHRONIZATION
            </span>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-muted hover:text-text text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>

          {/* Timecodes */}
          <div className="space-y-1 text-[11px]">
            <div className="flex justify-between text-muted">
              <span>Master Reel:</span>
              <span className="text-text font-semibold">{serverTimecode}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Local Projector:</span>
              <span className="text-text font-semibold">{clientTimecode}</span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Offset Drift:</span>
              <span
                className={`font-bold ${
                  isOptimal
                    ? 'text-live'
                    : isMinorDrift
                    ? 'text-accent'
                    : 'text-accent-2'
                }`}
              >
                {driftMs >= 0 ? `+${driftMs} ms` : `${driftMs} ms`}
              </span>
            </div>
            <div className="flex justify-between text-muted">
              <span>Network RTT:</span>
              <span className="text-text">{rttMs} ms</span>
            </div>
          </div>

          {/* Status Explanation */}
          <div className="p-2 bg-surface-2 border border-border-subtle rounded-sm text-[10px] text-muted leading-relaxed">
            {isOptimal && (
              <span className="text-live">
                ● Phase-locked to master server. Beam is steady with zero visible stutter.
              </span>
            )}
            {isMinorDrift && (
              <span className="text-accent">
                ● Catching up with micro-playbackRate trim ({driftMs > 0 ? '+1.5%' : '-1.5%'}).
              </span>
            )}
            {isHighDrift && (
              <span className="text-accent-2">
                ● Drift exceeds 140ms threshold. Hard frame seek engaged.
              </span>
            )}
          </div>

          {/* Actions */}
          <button
            onClick={handleResync}
            disabled={isResyncing}
            className="w-full py-1.5 px-3 bg-surface-2 hover:bg-surface-3 active:scale-95 text-text border border-border-brass rounded-sm text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <span>🎞</span>
            <span>{isResyncing ? 'Calibrating Reel...' : 'Force Resync Reel'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
