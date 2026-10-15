'use client';

/**
 * TheatreSeatMap2D Component
 * Ultra-performant 2D architectural cinema seating fallback:
 * - Used automatically on mobile devices, low-power mode, or when prefers-reduced-motion is active
 * - Displays screen orientation bar, seat rows, speaking rings, and patron presence
 * - Zero WebGL overhead with 100% interactive parity
 */

import React from 'react';
import { TheatreMember3D } from './TheatreScene3D';

export interface TheatreSeatMap2DProps {
  members?: TheatreMember3D[];
  onSelectSeat?: (row: number, col: number) => void;
  className?: string;
}

const ROWS = 4;
const COLS = 6;

export function TheatreSeatMap2D({
  members = [],
  onSelectSeat,
  className = '',
}: TheatreSeatMap2DProps) {
  // Map members by seat key "row-col"
  const memberBySeat = new Map<string, TheatreMember3D>();
  for (const m of members) {
    memberBySeat.set(`${m.seatRow}-${m.seatCol}`, m);
  }

  return (
    <div className={`theatre-seat-map-2d bg-surface border border-border-brass rounded-sm p-4 flex flex-col items-center justify-between shadow-velvet-raised ${className}`}>
      {/* 1. CINEMA SCREEN INDICATOR (FRONT OF AUDITORIUM) */}
      <div className="w-full max-w-md mb-6 text-center">
        <div className="h-2 rounded-full bg-accent/30 border border-accent/60 shadow-[0_0_16px_rgba(255,159,28,0.4)]" />
        <span className="font-mono text-[9px] text-accent uppercase tracking-widest block mt-1.5">
          PROJECTION SCREEN
        </span>
      </div>

      {/* 2. SEAT ROWS MATRIX */}
      <div className="space-y-3 w-full max-w-md">
        {Array.from({ length: ROWS }).map((_, rIndex) => {
          const rowNum = rIndex + 1;
          return (
            <div key={rowNum} className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-muted w-8 flex-shrink-0">
                Row {rowNum}
              </span>

              <div className="flex-1 grid grid-cols-6 gap-2">
                {Array.from({ length: COLS }).map((_, cIndex) => {
                  const colNum = cIndex + 1;
                  const seatKey = `${rowNum}-${colNum}`;
                  const occupant = memberBySeat.get(seatKey);

                  return (
                    <button
                      key={colNum}
                      onClick={() => onSelectSeat?.(rowNum, colNum)}
                      className={`relative aspect-square rounded-sm border flex items-center justify-center transition-all cursor-pointer ${
                        occupant
                          ? occupant.isSpeaking
                            ? 'bg-surface-3 border-live ring-2 ring-live shadow-cathode scale-105'
                            : 'bg-surface-2 border-border-brass hover:border-accent'
                          : 'bg-bg/60 border-border-subtle hover:border-border-brass/70 opacity-70'
                      }`}
                      title={
                        occupant
                          ? `${occupant.name} (${occupant.isSpeaking ? 'Speaking' : 'Seated'})`
                          : `Row ${rowNum}, Seat ${colNum} (Vacant)`
                      }
                    >
                      {occupant ? (
                        <span className="font-display font-bold text-[10px] text-text">
                          {occupant.avatar}
                        </span>
                      ) : (
                        <span className="text-[8px] font-mono text-muted/50">
                          {colNum}
                        </span>
                      )}

                      {/* Speaking Pulse Dot */}
                      {occupant?.isSpeaking && (
                        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-live animate-ping" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. SEATING LEGEND */}
      <div className="mt-5 pt-3 border-t border-border-brass/60 w-full flex justify-between items-center text-[10px] font-mono text-muted">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-surface-2 border border-border-brass" />
          <span>Occupied</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-surface-3 border-live ring-1 ring-live" />
          <span>Speaking</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-bg border border-border-subtle" />
          <span>Vacant</span>
        </div>
      </div>
    </div>
  );
}
