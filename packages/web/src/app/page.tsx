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

export default function LandingPage() {
  const router = useRouter();
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [roomCode, setRoomCode] = useState('');

  const [isCreating, setIsCreating] = useState(false);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) return;
    router.push(`/room/${encodeURIComponent(roomCode.trim().toUpperCase())}`);
  };

  const handleCreateRoom = async () => {
    if (isCreating) return;
    try {
      setIsCreating(true);
      const storedName =
        (typeof window !== 'undefined' && localStorage.getItem('watchparty_username')) ||
        `Host-${Math.floor(100 + Math.random() * 900)}`;
      if (typeof window !== 'undefined') {
        localStorage.setItem('watchparty_username', storedName);
      }
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: 'Grand Auditorium',
          hostUserName: storedName,
          initialVideoId: 'big_buck_bunny',
        }),
      });
      const data = await res.json();
      if (data?.room?.roomCode) {
        if (data?.hostSessionToken && typeof window !== 'undefined') {
          sessionStorage.setItem('wp_token_' + data.room.roomCode, data.hostSessionToken);
        }
        router.push(`/room/${data.room.roomCode}`);
      }
    } catch (err) {
      console.error('Failed to create room', err);
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
        <div className="flex items-center gap-6 sm:gap-8 text-base">
          <Link
            href="/lobby"
            className="text-[#F3E9DC] hover:text-[#FF9F1C] transition-colors font-medium"
          >
            Lobby
          </Link>
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
              <form onSubmit={handleJoin} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="ENTER CODE"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
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
            )}
          </div>
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
                Grand Auditorium
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
