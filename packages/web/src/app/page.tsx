'use client';

/**
 * Watch Party Landing Page
 * Matched to approved Private Cinema reference frame.
 * Tokens: bg #0E0B09, surface #1A1512, surface-2 #261E19, line #3A2E26, text #F3E9DC, muted #A89B8C, amber #FF9F1C, red #E4572E, teal #2EC4B6.
 * Typography: Fraunces (display), DM Sans (UI), JetBrains Mono (codes).
 * Flat colour blocks, no gradients, no emojis.
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';

export default function LandingPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const code = roomCode.trim().toUpperCase();
    if (!code) { setJoinError('Enter a room code'); return; }
    setJoinError(null);
    router.push(`/room/${encodeURIComponent(code)}`);
  };

  const handleCreateRoom = async () => {
    if (isCreating) return;
    setCreateError(null);
    try {
      setIsCreating(true);
      const storedName =
        (typeof window !== 'undefined' && localStorage.getItem('watchparty_username')) ||
        `Host-${Math.floor(100 + Math.random() * 900)}`;
      if (typeof window !== 'undefined') {
        localStorage.setItem('watchparty_username', storedName);
      }
      const API = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_API_URL || '');
      const res = await fetch(`${API}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostUserName: storedName }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      if (data?.room?.roomCode) {
        if (data?.hostSessionToken && typeof window !== 'undefined') {
          sessionStorage.setItem('wp_token_' + data.room.roomCode, data.hostSessionToken);
        }
        router.push(`/room/${data.room.roomCode}`);
      } else {
        throw new Error('No room code returned');
      }
    } catch (err: any) {
      console.error('[Landing Create Room Error Details]:', err);
      setCreateError("Can't reach server");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="relative min-h-screen box-border bg-[#0E0B09] text-[#F3E9DC] font-ui overflow-hidden flex flex-col justify-between pb-12">
      {/* NAVIGATION */}
      <nav className="relative flex items-center justify-between px-6 sm:px-12 md:px-16 py-7">
        <Link
          href="/"
          className="flex items-center gap-3 font-display italic font-medium text-2xl sm:text-[28px] text-[#F3E9DC] hover:text-[#FF9F1C] transition-colors"
        >
          <span className="w-3.5 h-3.5 rounded-full bg-[#FF9F1C] inline-block flex-shrink-0" />
          <span>Watch Party</span>
        </Link>
        <div className="flex items-center gap-4 sm:gap-6 text-base">
          <Link
            href="/lobby"
            className="text-[#F3E9DC] hover:text-[#FF9F1C] transition-colors font-medium text-sm sm:text-base"
          >
            Lobby
          </Link>
          {user ? (
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-full bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs flex items-center justify-center">
                {(user.displayName || '?')[0].toUpperCase()}
              </span>
              <button
                type="button"
                onClick={() => signOut()}
                className="text-xs font-mono text-[#A89B8C] hover:text-[#E4572E] transition-colors cursor-pointer bg-transparent border-none"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="text-[#A89B8C] hover:text-[#FF9F1C] transition-colors font-medium text-sm sm:text-base"
            >
              Sign in
            </Link>
          )}
          <button
            type="button"
            onClick={handleCreateRoom}
            disabled={isCreating}
            className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-sm sm:text-base px-5 sm:px-5.5 py-2.5 sm:py-3 rounded-full hover:brightness-105 active:scale-95 transition-all shadow-none border-none cursor-pointer"
          >
            {isCreating ? 'Creating...' : 'Get your ticket'}
          </button>
        </div>
      </nav>
      {/* Global create-room error (nav area) */}
      {createError && (
        <div className="mx-6 sm:mx-12 md:mx-16 -mt-3 mb-2 text-xs font-mono text-[#E4572E] bg-[#1A1512] border border-[#E4572E]/30 rounded-lg px-4 py-2">
          {createError}
        </div>
      )}

      {/* HERO SECTION */}
      <main className="relative flex flex-col lg:flex-row items-start lg:items-center gap-12 px-6 sm:px-12 md:px-16 pt-4 md:pt-10">
        {/* Left Column: Display Typography & Tagline */}
        <div className="flex-[1.15] max-w-2xl">
          <h1 className="my-5 font-display font-semibold text-5xl sm:text-7xl lg:text-[104px] leading-[0.96] tracking-[-0.03em] text-[#F3E9DC]">
            Lights down.
            <br />
            <span className="italic font-medium text-[#FF9F1C]">Everyone’s in.</span>
          </h1>
          <p className="mb-9 text-lg sm:text-xl leading-[1.55] text-[#A89B8C]">
            Watch together, perfectly in sync.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleCreateRoom}
              disabled={isCreating}
              className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-base sm:text-lg px-7 py-4 rounded-full hover:brightness-105 active:scale-95 transition-all inline-flex items-center justify-center text-center border-none cursor-pointer"
            >
              {isCreating ? 'Preparing Suite...' : 'Get your ticket'}
            </button>
            {!showCodeInput ? (
              <button
                type="button"
                onClick={() => setShowCodeInput(true)}
                className="border-[1.5px] border-[#5A4A3E] text-[#F3E9DC] hover:border-[#FF9F1C] hover:text-[#FF9F1C] text-base sm:text-lg px-7 py-4 rounded-full transition-colors inline-flex items-center justify-center bg-transparent cursor-pointer"
              >
                Join with a code
              </button>
            ) : (
              <div className="flex flex-col gap-1">
                <form onSubmit={handleJoin} className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="ENTER CODE"
                    value={roomCode}
                    onChange={(e) => { setRoomCode(e.target.value); setJoinError(null); }}
                    autoFocus
                    className="bg-[#1A1512] border border-[#3A2E26] rounded-full px-5 py-3.5 text-[#F3E9DC] font-mono text-base uppercase tracking-wider focus:outline-none focus:border-[#FF9F1C] w-36 sm:w-44"
                    aria-label="Room code"
                  />
                  <button
                    type="submit"
                    className="bg-[#261E19] hover:bg-[#3A2E26] text-[#F3E9DC] border border-[#3A2E26] font-mono text-sm px-4 py-3.5 rounded-full transition-colors cursor-pointer"
                  >
                    Go
                  </button>
                </form>
                {joinError && (
                  <span className="font-mono text-xs text-[#E4572E] pl-2">{joinError}</span>
                )}
              </div>
            )}
          </div>

          {/* Supported Media Capabilities */}
          <div className="mt-8 flex flex-wrap items-center gap-2.5 text-xs font-mono">
            <span className="text-[#A89B8C] uppercase tracking-wider text-[11px] mr-1">Supported:</span>
            <span className="bg-[#1A1512] border border-[#3A2E26] text-[#F3E9DC] px-3 py-1.5 rounded-full flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#E4572E]" />
              YouTube Direct Sync
            </span>
            <span className="bg-[#1A1512] border border-[#3A2E26] text-[#F3E9DC] px-3 py-1.5 rounded-full flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#2EC4B6]" />
              Netflix &amp; JioHotstar Tab Stream
            </span>
            <span className="bg-[#1A1512] border border-[#3A2E26] text-[#F3E9DC] px-3 py-1.5 rounded-full flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#FF9F1C]" />
              SRT/VTT Subtitles (Howard Chung Engine)
            </span>
            <span className="bg-[#1A1512] border border-[#3A2E26] text-[#F3E9DC] px-3 py-1.5 rounded-full flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#DDA15E]" />
              Local File Sync
            </span>
          </div>
          {createError && (
            <div className="flex items-center gap-2 mt-4 font-mono text-xs text-[#E4572E]">
              <span>{createError}</span>
              <button
                type="button"
                onClick={handleCreateRoom}
                className="text-[#FF9F1C] hover:underline font-bold bg-transparent border-none cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Asymmetric Tilted Ticket Stub Graphic */}
        <div className="flex-1 relative w-full h-[300px] sm:h-[470px] max-w-[520px] mx-auto lg:mx-0 scale-[0.68] sm:scale-100 origin-top-left sm:origin-center mb-6 sm:mb-0">
          {/* Amber tilted back card */}
          <div
            className="absolute left-6 sm:left-11 top-14 sm:top-20 w-[300px] sm:w-[470px] h-[190px] sm:h-[250px] bg-[#FF9F1C] rounded-[18px] pointer-events-none"
            style={{ transform: 'rotate(4deg)' }}
          />

          {/* Cream admission ticket stub with circular cutouts */}
          <div
            onClick={handleCreateRoom}
            className="absolute left-0 top-6 sm:top-10 w-[320px] sm:w-[490px] flex bg-[#F3E9DC] text-[#0E0B09] rounded-[18px] shadow-[0_30px_60px_rgba(0,0,0,0.5)] cursor-pointer hover:scale-[1.02] transition-transform select-none"
            style={{ transform: 'rotate(-4deg)' }}
          >
            <div className="flex-1 p-5 sm:p-8">
              <div className="mb-4 sm:mb-5 font-display font-semibold text-2xl sm:text-[44px] leading-[1.02] text-[#0E0B09]">
                Private Screening
              </div>
              <div className="flex gap-6 sm:gap-8 font-mono text-xs sm:text-[13px] text-[#0E0B09]">
                <div>
                  SUITE
                  <br />
                  <b className="text-base sm:text-xl font-bold">CLICK TO ENTER</b>
                </div>
                <div>
                  PASS
                  <br />
                  <b className="text-base sm:text-xl font-bold">VIP</b>
                </div>
              </div>
            </div>

            {/* Perforation section with circular cutouts and vertical ADMIT ONE */}
            <div className="relative w-16 sm:w-24 border-l-[3px] border-dashed border-[#0E0B09] flex items-center justify-center flex-shrink-0">
              <span className="absolute -left-[17px] -top-[16px] w-[30px] height-[30px] h-[30px] rounded-full bg-[#0E0B09]" />
              <span className="absolute -left-[17px] -bottom-[16px] w-[30px] height-[30px] h-[30px] rounded-full bg-[#0E0B09]" />
              <span
                className="font-mono text-[10px] sm:text-xs tracking-[0.3em] font-medium text-[#0E0B09]"
                style={{ writingMode: 'vertical-rl' }}
              >
                ADMIT ONE
              </span>
            </div>
          </div>

          {/* Patrons inside stacked badge */}
          <div className="absolute left-3.5 bottom-4 sm:bottom-7 flex items-center">
            <span className="w-9 sm:w-10 h-9 sm:h-10 rounded-full bg-[#E4572E] border-[3px] border-[#0E0B09] -mr-2.5 flex items-center justify-center font-bold text-xs sm:text-sm text-[#0E0B09]">
              W
            </span>
            <span className="w-9 sm:w-10 h-9 sm:h-10 rounded-full bg-[#2EC4B6] border-[3px] border-[#0E0B09] -mr-2.5 flex items-center justify-center font-bold text-xs sm:text-sm text-[#0E0B09]">
              P
            </span>
            <span className="w-9 sm:w-10 h-9 sm:h-10 rounded-full bg-[#F3E9DC] border-[3px] border-[#0E0B09] -mr-2.5 flex items-center justify-center font-bold text-xs sm:text-sm text-[#0E0B09]">
              S
            </span>
            <span className="ml-5 text-sm sm:text-[15px] text-[#A89B8C]">Take your seat</span>
          </div>
        </div>
      </main>

      {/* FEATURED STREAMING MARQUEE */}
      <section className="px-6 sm:px-12 md:px-16 pt-8 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#E50914]" />
            <h2 className="font-display font-semibold text-xl sm:text-2xl text-[#F3E9DC]">
              Trending on Netflix &amp; JioHotstar Tonight
            </h2>
          </div>
          <span className="text-xs font-mono text-[#A89B8C] hidden sm:inline">Click any title to enter co-watch suite</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { title: 'Stranger Things', platform: 'Netflix', tagBg: '#E50914', year: 2022, img: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=500&auto=format&fit=crop' },
            { title: 'Squid Game', platform: 'Netflix', tagBg: '#E50914', year: 2021, img: 'https://images.unsplash.com/photo-1634157703702-3c124b455499?w=500&auto=format&fit=crop' },
            { title: 'Money Heist', platform: 'Netflix', tagBg: '#E50914', year: 2021, img: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop' },
            { title: 'Special OPS', platform: 'Hotstar', tagBg: '#0063E5', year: 2020, img: 'https://images.unsplash.com/photo-1578328819058-b69f3a3b0f6b?w=500&auto=format&fit=crop' },
            { title: 'The Night Manager', platform: 'Hotstar', tagBg: '#0063E5', year: 2023, img: 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=500&auto=format&fit=crop' },
            { title: 'Kung Fury (Full)', platform: 'YouTube', tagBg: '#E4572E', year: 2015, img: 'https://images.unsplash.com/photo-1509281373149-e957c6296406?w=500&auto=format&fit=crop' },
          ].map((item) => (
            <div
              key={item.title}
              onClick={handleCreateRoom}
              className="bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] hover:border-[#FF9F1C] rounded-xl overflow-hidden cursor-pointer transition-all group flex flex-col justify-between"
            >
              <div className="relative aspect-[3/4] bg-black overflow-hidden">
                <img
                  src={item.img}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80"
                />
                <span
                  style={{ backgroundColor: item.tagBg }}
                  className="absolute top-2 left-2 text-white font-mono text-[9px] font-bold px-2 py-0.5 rounded uppercase"
                >
                  {item.platform}
                </span>
              </div>
              <div className="p-3">
                <h3 className="font-display font-medium text-sm text-[#F3E9DC] group-hover:text-[#FF9F1C] transition-colors truncate">
                  {item.title}
                </h3>
                <div className="flex items-center justify-between text-[11px] font-mono text-[#A89B8C] mt-1">
                  <span>{item.year}</span>
                  <span className="text-[#FF9F1C] group-hover:underline">Co-watch →</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3 STEPS STRIP */}
      <div className="relative flex flex-col sm:flex-row gap-8 sm:gap-12 px-6 sm:px-12 md:px-16 pt-8 sm:pt-12 mt-28 sm:mt-0">
        <div className="flex-1 border-t border-[#3A2E26] pt-4">
          <div className="font-mono text-xs sm:text-[13px] text-[#FF9F1C]">01</div>
          <div className="my-1.5 font-display font-semibold text-xl sm:text-[26px] text-[#F3E9DC]">
            Grab a seat
          </div>
        </div>
        <div className="flex-1 border-t border-[#3A2E26] pt-4">
          <div className="font-mono text-xs sm:text-[13px] text-[#FF9F1C]">02</div>
          <div className="my-1.5 font-display font-semibold text-xl sm:text-[26px] text-[#F3E9DC]">
            Pick the picture
          </div>
        </div>
        <div className="flex-1 border-t border-[#3A2E26] pt-4">
          <div className="font-mono text-xs sm:text-[13px] text-[#FF9F1C]">03</div>
          <div className="my-1.5 font-display font-semibold text-xl sm:text-[26px] text-[#F3E9DC]">
            Lights down
          </div>
        </div>
      </div>

      {/* 41 MARQUEE BULBS BOTTOM ACCENT */}
      <div
        className="hidden sm:flex px-16 h-2.5 justify-between items-center mt-8 pointer-events-none"
        aria-hidden="true"
      >
        {Array.from({ length: 41 }).map((_, i) => (
          <span
            key={i}
            className="w-2.5 h-2.5 rounded-full bg-[#FF9F1C] flex-shrink-0"
          />
        ))}
      </div>
    </div>
  );
}
