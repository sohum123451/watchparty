'use client';

/**
 * PosterTiltCard Component
 * Poster-style room tile featuring:
 * 1. CSS 3D perspective hover tilt based on cursor coordinates
 * 2. Specular light sweep sheen overlay
 * 3. Live cathode teal presence dots with participant counts
 * 4. Asymmetric editorial card layout
 */

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useReducedMotion } from '@/motion/useReducedMotion';

export interface RoomPosterItem {
  id: string;
  roomCode: string;
  title: string;
  hostName: string;
  posterUrl: string;
  format: '70mm' | '35mm' | '4K HDR' | 'Dolby Atmos';
  memberCount: number;
  members: Array<{ id: string; name: string; avatar: string; isLive?: boolean }>;
  timecode: string;
  layoutVariant?: 'tall' | 'wide' | 'feature' | 'standard';
}

export function PosterTiltCard({
  room,
  className = '',
}: {
  room: RoomPosterItem;
  className?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [transformStyle, setTransformStyle] = useState<string>('');
  const [lightCoords, setLightCoords] = useState<{ x: number; y: number } | null>(null);
  const reducedMotion = useReducedMotion();

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reducedMotion || !cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    const rotateX = ((0.5 - y) * 14).toFixed(2);
    const rotateY = ((x - 0.5) * 14).toFixed(2);

    setTransformStyle(
      `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`
    );
    setLightCoords({ x: +(x * 100).toFixed(1), y: +(y * 100).toFixed(1) });
  };

  const handleMouseLeave = () => {
    setTransformStyle('perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)');
    setLightCoords(null);
  };

  // Layout sizing variant
  const variantStyles = {
    tall: 'md:row-span-2 min-h-[380px]',
    wide: 'md:col-span-2 min-h-[220px]',
    feature: 'md:col-span-2 md:row-span-2 min-h-[420px]',
    standard: 'min-h-[260px]',
  }[room.layoutVariant || 'standard'];

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: transformStyle,
        transition: 'transform 0.15s ease-out',
        willChange: 'transform',
      }}
      className={`poster-tilt-card group relative overflow-hidden rounded-sm bg-surface border border-border-brass shadow-velvet-raised flex flex-col justify-between cursor-pointer ${variantStyles} ${className}`}
    >
      {/* Background Poster Image with Cinematic Gradient Overlay */}
      <div
        className="absolute inset-0 bg-cover bg-center transition-transform duration-700 ease-out group-hover:scale-105"
        style={{ backgroundImage: `url(${room.posterUrl})` }}
      />

      {/* Velvet Darkness & Lighting Overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0E0B09] via-[#0E0B09]/75 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0E0B09]/80 to-transparent" />

      {/* SPECULAR LIGHT SWEEP SHEEN */}
      {lightCoords && (
        <div
          className="absolute inset-0 pointer-events-none mix-blend-screen opacity-50 transition-opacity duration-200"
          style={{
            background: `radial-gradient(circle 280px at ${lightCoords.x}% ${lightCoords.y}%, rgba(255, 159, 28, 0.35) 0%, rgba(243, 233, 220, 0.15) 35%, transparent 70%)`,
          }}
        />
      )}

      {/* Diagonal Light Sweep Hover Line */}
      <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-tr from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transform duration-1000" />

      {/* TOP HEADER: Format Tag & Live Presence Dot */}
      <div className="relative z-10 p-4 flex justify-between items-start">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-bg/85 border border-border-brass rounded-sm font-mono text-[10px] text-accent tracking-wider uppercase backdrop-blur-sm">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
          <span>{room.format}</span>
        </span>

        {/* Live Presence Indicator */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-bg/90 border border-live/30 rounded-full font-mono text-[11px] text-live shadow-cathode backdrop-blur-sm">
          <span className="w-2 h-2 rounded-full bg-live animate-cathode-pulse" />
          <span>{room.memberCount} inside</span>
        </div>
      </div>

      {/* BOTTOM METADATA: Title, Host, Timecode, and Seat Trigger */}
      <div className="relative z-10 p-5 space-y-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-muted mb-1">
            <span>SUITE #{room.roomCode}</span>
            <span>&bull;</span>
            <span className="text-text font-medium">Host: {room.hostName}</span>
          </div>

          <h3 className="font-display font-bold text-xl md:text-2xl text-text leading-tight group-hover:text-accent transition-colors">
            {room.title}
          </h3>
        </div>

        {/* Members Avatars & Timecode */}
        <div className="flex items-center justify-between pt-2 border-t border-border-subtle/80 text-xs">
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1.5 overflow-hidden">
              {room.members.slice(0, 3).map((m) => (
                <div
                  key={m.id}
                  className="w-5 h-5 rounded-full bg-surface-3 border border-border-brass flex items-center justify-center font-display text-[9px] font-bold text-text"
                >
                  {m.avatar}
                </div>
              ))}
            </div>
            <span className="font-mono text-[10px] text-muted tabular-nums">
              {room.timecode}
            </span>
          </div>

          <Link
            href={`/join/${room.roomCode}`}
            className="px-3.5 py-2 min-h-[36px] bg-accent/90 hover:bg-accent active:bg-[#E6880C] text-[#0E0B09] font-display font-bold text-xs rounded-sm transition-all shadow-sm group-hover:shadow-projector inline-flex items-center justify-center gap-1"
            aria-label={`Take seat in suite ${room.roomCode}`}
          >
            <span>Take Seat</span>
            <span>&rarr;</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
