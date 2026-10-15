'use client';

/**
 * TheatreAuditorium Component
 * Aligned to approved reference frame:
 * 1. Header: Friday Night Screening, RM-4F7K, "In sync" expandable pill, Invite button
 * 2. Player: 470px black stage, centered 84px play button + Fraunces title, reaction heat segments, scrubber & timecodes
 * 3. Seats: 84x70px chairs, 40px avatars, speaker cathode glow, and flame reaction counter
 * 4. Sidebar: 3 tabs (Chat, Queue, Polls) without timestamps
 * 5. All video logic, playback events, and sync untouched
 */

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { MOVIE_CATALOGUE } from '@watchparty/shared';
import { ReactionParticleOverlay } from './ReactionParticleOverlay';
import { TheatreSidebar } from './TheatreSidebar';

export interface TheatreAuditoriumProps {
  roomCode?: string;
  initialTitle?: string;
  className?: string;
}

interface PatronSeat {
  id: string;
  name: string;
  avatar: string;
  avatarBg: string;
  avatarColor: string;
  nameColor?: string;
  isSpeaking?: boolean;
}

const PATRON_SEATS: PatronSeat[] = [
  {
    id: 'seat_priya',
    name: 'Priya',
    avatar: 'P',
    avatarBg: '#E4572E',
    avatarColor: '#0E0B09',
    nameColor: '#2EC4B6',
    isSpeaking: true,
  },
  {
    id: 'seat_aarav',
    name: 'Aarav',
    avatar: 'A',
    avatarBg: '#FF9F1C',
    avatarColor: '#0E0B09',
  },
  {
    id: 'seat_sam',
    name: 'Sam',
    avatar: 'S',
    avatarBg: '#2EC4B6',
    avatarColor: '#0E0B09',
  },
  {
    id: 'seat_meera',
    name: 'Meera',
    avatar: 'M',
    avatarBg: '#F3E9DC',
    avatarColor: '#0E0B09',
    nameColor: '#A89B8C',
  },
];

export function TheatreAuditorium({
  roomCode = 'RM-4F7K',
  initialTitle = 'Friday Night Screening',
  className = '',
}: TheatreAuditoriumProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(252); // 04:12 in seconds
  const [duration, setDuration] = useState(596); // 09:56 in seconds
  const [showSyncDiagnostics, setShowSyncDiagnostics] = useState(false);
  const [reactionCount, setReactionCount] = useState(12);
  const [inviteCopied, setInviteCopied] = useState(false);
  const seatRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const newTime = Math.max(0, Math.min(pos * duration, duration));
    if (videoRef.current) {
      videoRef.current.currentTime = newTime;
    }
    setCurrentTime(newTime);
  };

  const triggerReaction = (emoji = '🔥') => {
    setReactionCount((prev) => prev + 1);
    if (typeof window !== 'undefined' && (window as any).__WATCHPARTY_BURST__) {
      const el = seatRefs.current['seat_sam'];
      if (el) {
        const rect = el.getBoundingClientRect();
        (window as any).__WATCHPARTY_BURST__(emoji, rect.left + rect.width / 2, rect.top, 4);
      }
    }
  };

  const handleCopyInvite = () => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard?.writeText(window.location.href);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    }
  };

  const formatMinSec = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 42;

  const sampleStreamUrl =
    MOVIE_CATALOGUE[0]?.videoUrl ||
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

  return (
    <div
      className={`min-h-[900px] box-border flex flex-col bg-[#0E0B09] text-[#F3E9DC] font-ui ${className}`}
    >
      <ReactionParticleOverlay />

      {/* HEADER */}
      <header className="flex items-center justify-between px-7 py-4 border-b border-[#2A211B]">
        {/* Left: Title + Room Code */}
        <div className="flex items-center gap-4">
          <Link
            href="/lobby"
            className="font-display font-semibold text-2xl text-[#F3E9DC] hover:text-[#FF9F1C] transition-colors"
          >
            {initialTitle}
          </Link>
          <span className="font-mono text-[13px] bg-[#261E19] text-[#A89B8C] px-3 py-1.5 rounded-lg">
            {roomCode}
          </span>
        </div>

        {/* Right: In Sync Pill (Clickable) + Invite Button */}
        <div className="flex items-center gap-4.5">
          <button
            type="button"
            onClick={() => setShowSyncDiagnostics(!showSyncDiagnostics)}
            className="flex items-center gap-2 font-mono text-[13px] bg-[#12302D] text-[#2EC4B6] px-3.5 py-2 rounded-full cursor-pointer hover:brightness-110 transition-all border-none"
            title="Click to view sync diagnostics"
          >
            <span className="w-2 h-2 rounded-full bg-[#2EC4B6] animate-pulse" />
            <span>{showSyncDiagnostics ? '14ms drift' : 'In sync'}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyInvite}
            className="bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-[15px] px-5 py-2.5 rounded-full font-ui transition-all cursor-pointer border-none"
          >
            {inviteCopied ? 'Copied!' : 'Invite'}
          </button>
        </div>
      </header>

      {/* MAIN BODY: Player + Audience Row (Left) & Sidebar (Right) */}
      <div className="flex flex-col lg:flex-row flex-1">
        {/* Left Column: Player Container & Seats */}
        <div className="flex-1 flex flex-col gap-5.5 p-6 md:p-7">
          {/* THE SCREEN (470px Black Stage) */}
          <div className="relative h-[340px] sm:h-[470px] box-border bg-black border border-[#2A211B] rounded-[14px] flex flex-col items-center justify-center gap-4.5 overflow-hidden group">
            {/* Playable HTML5 Video Element (Preserved) */}
            <video
              ref={videoRef}
              src={sampleStreamUrl}
              playsInline
              onTimeUpdate={() => {
                if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
              }}
              onLoadedMetadata={() => {
                if (videoRef.current && videoRef.current.duration) {
                  setDuration(videoRef.current.duration);
                }
              }}
              onClick={togglePlay}
              className={`w-full h-full object-contain cursor-pointer ${
                isPlaying ? 'opacity-100' : 'opacity-20'
              }`}
            />

            {/* Centered Play Button & Fraunces Title Overlay */}
            {!isPlaying && (
              <div
                onClick={togglePlay}
                className="absolute inset-0 flex flex-col items-center justify-center gap-4.5 cursor-pointer pointer-events-auto"
              >
                <span className="w-[84px] h-[84px] rounded-full border-2 border-[#F3E9DC] flex items-center justify-center hover:scale-105 transition-transform">
                  <svg
                    aria-hidden="true"
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="#F3E9DC"
                    className="ml-1"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
                <div className="font-display italic font-medium text-3xl sm:text-[52px] text-[#F3E9DC] text-center px-4">
                  Big Buck Bunny
                </div>
              </div>
            )}

            {/* Bottom Scrubber & Reaction Timeline */}
            <div
              style={{
                position: 'absolute',
                left: '22px',
                right: '22px',
                bottom: '16px',
                pointerEvents: 'auto',
              }}
            >
              {/* Heatmap Bar Segments */}
              <div
                style={{
                  display: 'flex',
                  height: '14px',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}
              >
                <div style={{ width: '18%', height: '14px', background: '#2A211B' }} />
                <div style={{ width: '6%', height: '14px', background: '#E4572E' }} />
                <div style={{ width: '17%', height: '14px', background: '#2A211B' }} />
                <div style={{ width: '11%', height: '14px', background: '#FF9F1C' }} />
                <div style={{ width: '4%', height: '14px', background: '#E4572E' }} />
                <div style={{ width: '22%', height: '14px', background: '#2A211B' }} />
                <div style={{ width: '12%', height: '14px', background: '#FF9F1C' }} />
                <div style={{ width: '10%', height: '14px', background: '#2A211B' }} />
              </div>

              {/* Progress Slider Track */}
              <div
                onClick={handleSeek}
                style={{
                  position: 'relative',
                  height: '6px',
                  borderRadius: '3px',
                  background: '#2A211B',
                  marginTop: '10px',
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    width: `${progressPercent}%`,
                    height: '6px',
                    borderRadius: '3px',
                    background: '#F3E9DC',
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    left: `${progressPercent}%`,
                    top: '-4px',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    background: '#F3E9DC',
                    transform: 'translateX(-50%)',
                  }}
                />
              </div>

              {/* Timecode Indicators */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '10px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '12px',
                }}
              >
                <span>{formatMinSec(currentTime)}</span>
                <span style={{ color: '#A89B8C' }}>{formatMinSec(duration)}</span>
              </div>
            </div>
          </div>

          {/* AUDIENCE ROW: 4 Seats + Flame Reaction Pill */}
          <div className="flex flex-wrap items-end justify-between gap-4.5">
            {/* Left: Row of 4 Chairs */}
            <div className="flex gap-4.5 overflow-x-auto pb-1">
              {PATRON_SEATS.map((seat) => (
                <div
                  key={seat.id}
                  ref={(el) => {
                    seatRefs.current[seat.id] = el;
                  }}
                  className="flex flex-col items-center gap-2 flex-shrink-0"
                >
                  <div className="w-[84px] h-[70px] bg-[#261E19] rounded-t-[16px] rounded-b-[6px] flex items-center justify-center">
                    <span
                      style={{
                        backgroundColor: seat.avatarBg,
                        color: seat.avatarColor,
                        boxShadow: seat.isSpeaking ? '0 0 0 3px #2EC4B6' : 'none',
                      }}
                      className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-base"
                    >
                      {seat.avatar}
                    </span>
                  </div>
                  <span
                    style={{ color: seat.nameColor || '#F3E9DC' }}
                    className="text-[13px] font-medium"
                  >
                    {seat.name}
                  </span>
                </div>
              ))}
            </div>

            {/* Right: Flame Reaction Counter Pill */}
            <button
              type="button"
              onClick={() => triggerReaction('🔥')}
              className="flex items-center gap-2 bg-[#261E19] hover:bg-[#342821] active:scale-95 px-4 py-2.5 rounded-full text-sm text-[#F3E9DC] cursor-pointer transition-transform border-none flex-shrink-0"
              title="Click to react"
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#FF9F1C"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />
              </svg>
              <span>{reactionCount}</span>
            </button>
          </div>
        </div>

        {/* Right Column: 360px Sidebar */}
        <TheatreSidebar
          isOpen={true}
          currentRoomCode={roomCode}
        />
      </div>
    </div>
  );
}
