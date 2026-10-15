'use client';

/**
 * TheatreAuditorium Component
 * The Private Cinema Theatre Experience:
 * 1. Layout: The video IS the screen, framed by atmospheric auditorium house lights
 * 2. Lights-down moment: Playback start triggers anime.js timeline fading chrome & dimming house lights; pause brings lights back up
 * 3. Reactions: Emoji burst from the sender's seat position and float up with randomized eased paths (particle pool, capped count)
 * 4. Sync status: Projector indicator whose flicker rate reflects drift (steady = in sync, flicker = correcting)
 * 5. Voice speakers: Glowing cathode teal ring around active speaking seats/avatars
 * 6. Slide-in sidebar on desktop, responsive bottom sheet on mobile, fully collapsible in Cinema Mode
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { MOVIE_CATALOGUE } from '@watchparty/shared';
import { useAnime } from '@/motion/useAnime';
import { MotionDurations, MotionEasings } from '@/motion/tokens';
import { ProjectorSyncBadge } from './ProjectorSyncBadge';
import { ReactionParticleOverlay } from './ReactionParticleOverlay';
import { TheatreSidebar } from './TheatreSidebar';

export interface TheatreAuditoriumProps {
  roomCode?: string;
  initialTitle?: string;
  className?: string;
}

interface SeatPatron {
  id: string;
  name: string;
  avatar: string;
  seatNumber: string;
  isHost?: boolean;
  isSpeaking?: boolean;
}

const INITIAL_SEATS: SeatPatron[] = [
  { id: 'seat_1', name: 'Elena Rostova', avatar: 'E', seatNumber: 'Row A • 1', isHost: true },
  { id: 'seat_2', name: 'Marcus Vance', avatar: 'M', seatNumber: 'Row A • 2', isSpeaking: true },
  { id: 'seat_3', name: 'Sophia Chen', avatar: 'S', seatNumber: 'Row A • 3' },
  { id: 'seat_4', name: 'Dmitri K.', avatar: 'D', seatNumber: 'Row A • 4' },
  { id: 'seat_me', name: 'You', avatar: 'Y', seatNumber: 'Row A • 5' },
];

export function TheatreAuditorium({
  roomCode = 'CRITERION-70MM',
  initialTitle = 'Blade Runner (Final Cut): 70mm Restoration',
  className = '',
}: TheatreAuditoriumProps) {
  // Video & Playback state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(117 * 60); // 117 mins
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [controlsHovered, setControlsHovered] = useState(false);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // House Lights & Cinema Mode
  const [cinemaMode, setCinemaMode] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Sync Diagnostics state
  const [driftMs, setDriftMs] = useState(14); // 14ms (in sync)

  // Voice Speaking state
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [seats, setSeats] = useState<SeatPatron[]>(INITIAL_SEATS);

  // Seat DOM refs for computing reaction burst origins
  const seatRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // 1. ANIME.JS LIGHTS-DOWN / LIGHTS-UP TIMELINE
  const { containerRef: auditoriumRef } = useAnime(
    ({ animate, reducedMotion }) => {
      if (reducedMotion) return;

      if (isPlaying) {
        // LIGHTS DOWN: Fade out house lights sconces, dim the room, fade chrome
        animate('.theatre-house-lights', {
          opacity: [1, 0.05],
          translateY: [0, -6],
          duration: MotionDurations.cinematic,
          ease: MotionEasings.cinematicInOut,
        });

        animate('.theatre-wall-dimmer', {
          opacity: [0, 0.88],
          duration: MotionDurations.cinematic,
          ease: MotionEasings.cinematicInOut,
        });

        if (!controlsHovered) {
          animate('.theatre-chrome-top', {
            opacity: [1, 0],
            translateY: [0, -10],
            duration: MotionDurations.cinematic,
            ease: MotionEasings.cinematicInOut,
          });
          animate('.theatre-chrome-bottom', {
            opacity: [1, 0.15],
            translateY: [0, 6],
            duration: MotionDurations.cinematic,
            ease: MotionEasings.cinematicInOut,
          });
        }
      } else {
        // LIGHTS UP: Restore house lights, warm amber illumination, full chrome
        animate('.theatre-house-lights', {
          opacity: [0.05, 1],
          translateY: [-6, 0],
          duration: MotionDurations.cinematic,
          ease: MotionEasings.snappyOut,
        });

        animate('.theatre-wall-dimmer', {
          opacity: [0.88, 0],
          duration: MotionDurations.cinematic,
          ease: MotionEasings.snappyOut,
        });

        animate('.theatre-chrome-top', {
          opacity: [0, 1],
          translateY: [-10, 0],
          duration: MotionDurations.cinematic,
          ease: MotionEasings.snappyOut,
        });

        animate('.theatre-chrome-bottom', {
          opacity: [0.15, 1],
          translateY: [6, 0],
          duration: MotionDurations.cinematic,
          ease: MotionEasings.snappyOut,
        });
      }
    },
    [isPlaying, controlsHovered]
  );

  // Play / Pause handling
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  // Cursor move auto-reveals controls temporarily during playback
  const handleMouseMove = () => {
    if (!isPlaying) return;
    setControlsHovered(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      setControlsHovered(false);
    }, 3200);
  };

  // Trigger Reaction Burst from a specific seat coordinate
  const triggerReactionFromSeat = (emoji: string, seatId = 'seat_me') => {
    const el = seatRefs.current[seatId];
    if (el && typeof window !== 'undefined' && (window as any).__WATCHPARTY_BURST__) {
      const rect = el.getBoundingClientRect();
      const originX = rect.left + rect.width / 2;
      const originY = rect.top;
      (window as any).__WATCHPARTY_BURST__(emoji, originX, originY, 4);
    }
  };

  // Periodic subtle drift simulation (fluctuates between +12ms and +48ms)
  useEffect(() => {
    const interval = setInterval(() => {
      setDriftMs((prev) => {
        const delta = Math.floor((Math.random() - 0.48) * 8);
        return Math.max(8, Math.min(prev + delta, 95));
      });
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Periodic simulated reactions from Marcus or Elena
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isPlaying) return;
      const senderSeat = Math.random() > 0.5 ? 'seat_2' : 'seat_1';
      const emojis = ['🍿', '👏', '🔥', '✨', '❤️'];
      const chosen = emojis[Math.floor(Math.random() * emojis.length)];
      triggerReactionFromSeat(chosen, senderSeat);
    }, 8500);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Format time (seconds to HH:MM:SS)
  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Toggle user microphone state
  const handleToggleUserSpeaking = () => {
    setIsUserSpeaking((prev) => !prev);
    setSeats((prev) =>
      prev.map((s) => (s.id === 'seat_me' ? { ...s, isSpeaking: !isUserSpeaking } : s))
    );
  };

  const sampleStreamUrl =
    MOVIE_CATALOGUE[0]?.videoUrl ||
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4';

  return (
    <div
      ref={auditoriumRef}
      onMouseMove={handleMouseMove}
      className={`theatre-auditorium relative min-h-screen w-full bg-[#0E0B09] text-text flex overflow-hidden select-none ${className}`}
    >
      {/* 1. REACTION FLOATING PARTICLE POOL OVERLAY */}
      <ReactionParticleOverlay />

      {/* 2. THEATRE WALL DIMMER (LIGHTS-DOWN ATMOSPHERE) */}
      <div className="theatre-wall-dimmer pointer-events-none fixed inset-0 z-10 bg-[#060403] opacity-0 transition-opacity" />

      {/* 3. HOUSE LIGHTS SCONCES (LEFT & RIGHT WALLS) */}
      <div className="theatre-house-lights pointer-events-none fixed inset-y-0 left-3 z-15 flex flex-col justify-around opacity-100 transition-opacity">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2.5 h-6 rounded-full bg-accent/80 shadow-[0_0_24px_rgba(255,159,28,0.7)] border border-border-brass-bright" />
          </div>
        ))}
      </div>

      <div className="theatre-house-lights pointer-events-none fixed inset-y-0 right-3 z-15 flex flex-col justify-around opacity-100 transition-opacity">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-2.5 h-6 rounded-full bg-accent/80 shadow-[0_0_24px_rgba(255,159,28,0.7)] border border-border-brass-bright" />
          </div>
        ))}
      </div>

      {/* 4. MAIN AUDITORIUM CHAMBER (SCREEN & ORCHESTRA SEATING) */}
      <div className="flex-1 flex flex-col justify-between relative z-20 overflow-hidden">
        {/* TOP THEATRE CHROME (HEADER & NAVIGATION) */}
        <header className="theatre-chrome-top px-6 py-3 border-b border-border-brass/70 bg-surface/80 backdrop-blur-md flex justify-between items-center transition-all">
          <div className="flex items-center gap-3">
            <Link
              href="/lobby"
              className="text-xs font-mono text-muted hover:text-accent transition-colors flex items-center gap-1.5"
            >
              <span>←</span>
              <span>Cinema Foyer</span>
            </Link>
            <span className="text-border-brass text-xs">•</span>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-sm text-text truncate max-w-xs md:max-w-md">
                {initialTitle}
              </span>
              <span className="px-2 py-0.5 bg-bg/90 border border-border-brass rounded-sm font-mono text-[10px] text-accent uppercase">
                70mm Atmos
              </span>
            </div>
          </div>

          {/* Sync Status Projector Indicator & Cinema Mode Toggle */}
          <div className="flex items-center gap-3">
            <ProjectorSyncBadge
              driftMs={driftMs}
              serverTimecode={formatTime(currentTime)}
              clientTimecode={formatTime(currentTime)}
              onManualResync={() => {
                setDriftMs(8);
              }}
            />

            <button
              onClick={() => {
                setCinemaMode(!cinemaMode);
                setIsSidebarOpen(!isSidebarOpen);
              }}
              className={`px-3 py-1.5 rounded-sm font-mono text-xs border transition-all flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                cinemaMode
                  ? 'bg-accent text-[#0E0B09] font-bold border-accent shadow-projector'
                  : 'bg-surface-2 hover:bg-surface-3 text-text border-border-brass'
              }`}
              title="Toggle Fullscreen Cinema Mode"
            >
              <span>{cinemaMode ? 'Exit Cinema Mode' : 'Cinema Mode'}</span>
              <span>{cinemaMode ? '⛶' : '🗖'}</span>
            </button>
          </div>
        </header>

        {/* CINEMA SCREEN PROJECTION PLATFORM */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 relative">
          {/* Ambient Projector Halo Behind Screen */}
          <div className="absolute inset-x-12 inset-y-8 bg-accent/5 rounded-full blur-3xl pointer-events-none" />

          {/* THE SCREEN (16:9 Cinema Aspect Ratio) */}
          <div className="theatre-screen-frame relative w-full max-w-5xl aspect-video bg-black rounded-sm border-2 border-border-brass/80 shadow-[0_24px_70px_rgba(0,0,0,0.98)] overflow-hidden flex items-center justify-center group">
            {/* Playable HTML5 Video */}
            <video
              ref={videoRef}
              src={sampleStreamUrl}
              playsInline
              onTimeUpdate={() => {
                if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
              }}
              onLoadedMetadata={() => {
                if (videoRef.current) setDuration(videoRef.current.duration || 117 * 60);
              }}
              onClick={togglePlay}
              className="w-full h-full object-contain cursor-pointer"
            />

            {/* Play Overlay Button if Paused */}
            {!isPlaying && (
              <div
                onClick={togglePlay}
                className="absolute inset-0 bg-[#0E0B09]/45 backdrop-blur-xs flex flex-col items-center justify-center cursor-pointer transition-opacity"
              >
                <div className="w-16 h-16 rounded-full bg-accent text-[#0E0B09] flex items-center justify-center text-2xl pl-1 shadow-projector hover:scale-110 active:scale-95 transition-all">
                  ▶
                </div>
                <span className="font-mono text-xs text-text font-bold mt-3 tracking-widest uppercase">
                  Lights Down • Roll Reel
                </span>
              </div>
            )}
          </div>

          {/* ORCHESTRA SEATING ROW (AVATARS WITH GLOWING VOICE RINGS) */}
          <div className="w-full max-w-5xl mt-4 px-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-mono text-muted uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-live" />
              <span>Orchestra Row A</span>
            </div>

            {/* Avatars */}
            <div className="flex items-center gap-3">
              {seats.map((seat) => {
                const isSpeaking = seat.id === 'seat_me' ? isUserSpeaking : seat.isSpeaking;

                return (
                  <div
                    key={seat.id}
                    ref={(el) => {
                      seatRefs.current[seat.id] = el;
                    }}
                    className="group relative flex flex-col items-center"
                  >
                    {/* Seat Avatar with Glowing Voice Ring */}
                    <div
                      className={`relative w-8 h-8 rounded-full flex items-center justify-center font-display text-xs font-bold transition-all duration-300 cursor-pointer ${
                        isSpeaking
                          ? 'ring-2 ring-live shadow-[0_0_16px_rgba(46,196,182,0.85)] scale-110 bg-surface-3 text-text'
                          : 'bg-surface-2 border border-border-brass text-text'
                      }`}
                      onClick={() => {
                        if (seat.id === 'seat_me') handleToggleUserSpeaking();
                      }}
                      title={`${seat.name} (${seat.seatNumber})`}
                    >
                      {seat.avatar}
                      {/* Cathode speaking pulse dot */}
                      {isSpeaking && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-live animate-ping" />
                      )}
                    </div>

                    {/* Patron Name Tooltip on Hover */}
                    <span className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity bg-surface px-1.5 py-0.5 rounded border border-border-brass text-[10px] font-mono text-text whitespace-nowrap pointer-events-none">
                      {seat.name} {isSpeaking ? '(Speaking)' : ''}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Quick Mic Action */}
            <button
              onClick={handleToggleUserSpeaking}
              className={`px-2.5 py-1 rounded-sm font-mono text-[10px] transition-all cursor-pointer flex items-center gap-1 active:scale-95 ${
                isUserSpeaking
                  ? 'bg-live text-[#0E0B09] font-bold shadow-cathode'
                  : 'bg-surface-2 text-muted hover:text-text border border-border-brass'
              }`}
            >
              <span>{isUserSpeaking ? '🎙 Mic Live' : '🔇 Muted'}</span>
            </button>
          </div>
        </div>

        {/* BOTTOM THEATRE CHROME (TRANSPORT CONTROLS & REACTION DOCK) */}
        <footer className="theatre-chrome-bottom px-6 py-3 border-t border-border-brass/70 bg-surface/85 backdrop-blur-md flex flex-wrap items-center justify-between gap-4 transition-all">
          {/* Transport Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="p-2 px-3.5 bg-accent hover:bg-accent/90 active:scale-95 text-[#0E0B09] rounded-sm font-bold text-sm shadow-projector transition-all cursor-pointer"
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>

            {/* Scrubber & Timecode */}
            <div className="flex items-center gap-2 font-mono text-xs text-muted">
              <span className="text-text tabular-nums">{formatTime(currentTime)}</span>
              <span>/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* REACTION DOCK (BURSTS FROM SENDER'S SEAT) */}
          <div className="flex items-center gap-1.5 p-1 bg-surface-2 border border-border-brass rounded-sm">
            <span className="text-[10px] font-mono text-muted px-1.5 uppercase hidden sm:inline">
              React:
            </span>
            {(['🍿', '🔥', '👏', '❤️', '😱', '🎞'] as const).map((emoji) => (
              <button
                key={emoji}
                onClick={() => triggerReactionFromSeat(emoji, 'seat_me')}
                className="w-8 h-8 rounded-sm hover:bg-surface-3 active:scale-90 text-lg transition-transform flex items-center justify-center cursor-pointer shadow-xs"
                title={`Send ${emoji} burst from seat`}
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* Right Controls: Sidebar Toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={`px-3 py-1.5 rounded-sm font-mono text-xs border transition-all cursor-pointer flex items-center gap-1.5 active:scale-95 ${
                isSidebarOpen
                  ? 'bg-surface-3 border-accent text-accent'
                  : 'bg-surface-2 border-border-brass text-muted hover:text-text'
              }`}
            >
              <span>Whisper &amp; Reels Console</span>
              <span>{isSidebarOpen ? '◀' : '▶'}</span>
            </button>
          </div>
        </footer>
      </div>

      {/* 5. SLIDE-IN THEATRE SIDEBAR / MOBILE BOTTOM SHEET */}
      <TheatreSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        isMobileSheet={false}
        currentRoomCode={roomCode}
        isUserSpeaking={isUserSpeaking}
        onToggleUserSpeaking={handleToggleUserSpeaking}
      />
    </div>
  );
}
