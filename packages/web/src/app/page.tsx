'use client';

/**
 * Watch Party Landing Page
 * Concept: "The Private Cinema"
 * - Asymmetric hero with large Fraunces display typography
 * - Looping 2D anime.js ticket tear sequence
 * - Marquee bulbs chasing along an edge with staggered opacity timeline
 * - Live reaction demo strip showing avatars reacting with timecode sync
 * - Short scroll narrative: Lobby -> Seats -> Lights Down -> Movie (No generic card grid!)
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MarqueeBulbBorder } from '@/components/MarqueeBulbBorder';
import { TicketTearLoop } from '@/components/TicketTearLoop';
import { LiveReactionStrip } from '@/components/LiveReactionStrip';
import { ProjectorLens3D } from '@/components/ProjectorLens3D';

export default function LandingPage() {
  const router = useRouter();
  const [quickRoomCode, setQuickRoomCode] = useState('');

  const handleQuickJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickRoomCode.trim()) return;
    router.push(`/join/${encodeURIComponent(quickRoomCode.trim())}`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text selection:bg-accent selection:text-bg">
      {/* 1. CHASING MARQUEE BULB TOP EDGE */}
      <MarqueeBulbBorder count={36} />

      {/* 2. GRAND FOYER HEADER & NAVIGATION */}
      <header className="border-b border-border-brass/80 bg-surface/75 backdrop-blur-md sticky top-0 z-50 px-6 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-accent shadow-projector animate-pulse" />
            <Link href="/" className="flex items-baseline gap-2 group">
              <span className="font-display font-extrabold text-xl tracking-tight-display text-text group-hover:text-accent transition-colors">
                WATCH PARTY
              </span>
              <span className="font-mono text-[10px] text-accent tracking-widest uppercase">
                THE PRIVATE CINEMA
              </span>
            </Link>
          </div>

          <nav className="flex items-center gap-3 sm:gap-4 text-xs font-mono">
            <Link
              href="/lobby"
              className="text-text hover:text-accent font-semibold transition-colors py-1.5 px-3 rounded-sm border border-border-brass bg-surface-2 hover:bg-surface-3 flex items-center gap-1.5 shadow-sm"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-live animate-cathode-pulse" />
              <span>Cinema Foyer</span>
            </Link>
            <Link
              href="/motion-demo"
              className="hidden sm:inline-flex text-muted hover:text-text transition-colors py-1.5 px-3 rounded-sm border border-transparent hover:border-border-brass"
            >
              Motion Atelier
            </Link>
            <Link
              href="/login"
              className="text-muted hover:text-text transition-colors py-1.5 px-3 rounded-sm border border-border-brass bg-surface-2 hover:bg-surface-3"
            >
              Will Call (Log In)
            </Link>
            <Link
              href="/signup"
              className="py-1.5 px-3.5 bg-accent text-[#0E0B09] font-semibold rounded-sm hover:shadow-projector transition-all"
            >
              Get Your Ticket
            </Link>
          </nav>
        </div>
      </header>

      {/* 3. ASYMMETRIC HERO SECTION */}
      <section className="relative px-6 pt-12 md:pt-20 pb-16 overflow-hidden">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* LEFT COLUMN: Large Display Typography (7 Columns) */}
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-2 border border-border-brass rounded-sm font-mono text-xs text-accent uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-live shadow-cathode" />
              <span>PRIVATE BALCONY SUITES &bull; ARCHIVAL 70MM</span>
            </div>

            <h1 className="font-display font-bold text-5xl sm:text-6xl md:text-7xl leading-[1.04] tracking-tight-display text-text">
              Cinema as it was meant to be shared.
            </h1>

            <p className="text-muted text-base md:text-lg leading-relaxed max-w-xl font-sans">
              An intimate screening room entered through a warm, dimly lit theatre lobby. Projector light, velvet, and friends across the globe sharing the exact same frame down to the millisecond.
            </p>

            {/* ACTION BUTTONS & ROOM CODE ENTRY */}
            <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <Link
                href="/signup"
                className="px-7 py-3.5 bg-accent hover:bg-[#FFAE38] active:bg-[#E6880C] text-[#0E0B09] font-display font-bold text-sm tracking-wide rounded-sm transition-all shadow-projector text-center"
              >
                Claim Your Balcony Pass
              </Link>

              {/* Quick Code Punch */}
              <form onSubmit={handleQuickJoin} className="flex items-center bg-surface-2 border border-border-brass rounded-sm overflow-hidden p-1 shadow-velvet-inset">
                <input
                  type="text"
                  placeholder="Enter Room Code..."
                  value={quickRoomCode}
                  onChange={(e) => setQuickRoomCode(e.target.value)}
                  className="bg-transparent border-none text-xs font-mono text-text placeholder-muted-dark px-3 py-1.5 focus:outline-none w-36 uppercase tracking-wider"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-surface-3 hover:bg-surface text-text font-mono text-xs font-semibold rounded-sm border border-border-brass transition-colors"
                >
                  Join
                </button>
              </form>
            </div>

            <div className="pt-2 flex items-center gap-4 text-xs font-mono text-muted-dark">
              <span>&bull; Zero Algorithms</span>
              <span>&bull; Lossless Spatial Audio</span>
              <span>&bull; E2EE Balcony Vaults</span>
            </div>
          </div>

          {/* RIGHT COLUMN: 2D Looping Ticket Tear Sequence (5 Columns) */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center relative">
            <TicketTearLoop />
            <span className="font-mono text-[10px] text-muted-dark mt-2 tracking-wider">
              AUTHENTIC PERFORATED ADMISSION PASS &bull; ANIMATED STUB
            </span>
          </div>
        </div>
      </section>

      {/* 4. LIVE REACTION DEMO STRIP */}
      <section className="px-6 py-6 border-y border-border-brass bg-surface/40">
        <div className="max-w-6xl mx-auto">
          <div className="text-[11px] font-mono text-muted uppercase tracking-widest mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-live" />
            <span>Auditorium Whisper Channel &bull; Live Synchronization Preview</span>
          </div>
          <LiveReactionStrip />
        </div>
      </section>

      {/* 5. PRODUCT STORY SCROLL NARRATIVE (NOT A GENERIC CARD GRID) */}
      <section className="px-6 py-24 space-y-28 max-w-5xl mx-auto">
        {/* NARRATIVE ACT I: THE LOBBY */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-5 space-y-3">
            <span className="font-mono text-xs text-accent uppercase tracking-widest block">
              Act I &bull; The Lobby
            </span>
            <h2 className="font-display font-bold text-3xl md:text-4xl text-text tracking-tight-display">
              Step across the velvet rope.
            </h2>
            <p className="text-muted text-sm leading-relaxed">
              No endless recommendation carousels or generic social feeds. You enter a physical foyer, generate a hand-pressed admission stub, and slip the code to the people you actually want to watch with.
            </p>
            <div className="pt-2 flex items-center gap-4">
              <Link
                href="/lobby"
                className="font-mono text-xs text-accent hover:underline inline-flex items-center gap-1.5"
              >
                <span>Enter Cinema Foyer</span>
                <span>&rarr;</span>
              </Link>
              <span className="text-muted text-xs">&bull;</span>
              <Link
                href="/join"
                className="font-mono text-xs text-muted hover:text-text inline-flex items-center gap-1.5"
              >
                <span>Preview Ticket Stub</span>
                <span>&rarr;</span>
              </Link>
            </div>
          </div>

          <div className="md:col-span-7 bg-surface p-6 border border-border-brass rounded-sm shadow-velvet-raised font-mono text-xs space-y-3">
            <div className="flex justify-between text-muted border-b border-border-subtle pb-2">
              <span>FOYER DISPATCH</span>
              <span>BALCONY SUITE 4</span>
            </div>
            <div className="text-text space-y-1">
              <div>&gt; Pass created: #CRITERION-70MM</div>
              <div>&gt; Encryption: AES-GCM-256 Balcony Key Exchanged</div>
              <div>&gt; Door locked to uninvited traffic</div>
            </div>
            <div className="text-live text-[11px] pt-1">
              &bull; Foyer illuminated and waiting for guests.
            </div>
          </div>
        </div>

        {/* NARRATIVE ACT II: THE SEATS */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-7 order-2 md:order-1 bg-surface-2 p-6 border border-border-brass rounded-sm shadow-velvet-raised">
            <div className="flex justify-between items-center text-xs font-mono text-muted mb-4 pb-2 border-b border-border-subtle">
              <span>SEATING ROSTER</span>
              <span className="text-live">4 OF 8 SEATS OCCUPIED</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-surface rounded-sm border border-border-brass flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-accent/20 border border-accent text-accent font-bold flex items-center justify-center text-[10px]">
                  E
                </div>
                <div>
                  <div className="font-semibold text-text">Elena (Host)</div>
                  <div className="font-mono text-[10px] text-accent">Projectionist</div>
                </div>
              </div>
              <div className="p-3 bg-surface rounded-sm border border-border-subtle flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-surface-3 text-text font-bold flex items-center justify-center text-[10px]">
                  M
                </div>
                <div>
                  <div className="font-semibold text-text">Marcus</div>
                  <div className="font-mono text-[10px] text-muted">Seat 2A</div>
                </div>
              </div>
            </div>
          </div>

          <div className="md:col-span-5 order-1 md:order-2 space-y-3">
            <span className="font-mono text-xs text-accent uppercase tracking-widest block">
              Act II &bull; The Seats
            </span>
            <h2 className="font-display font-bold text-3xl md:text-4xl text-text tracking-tight-display">
              The plush virtual couch.
            </h2>
            <p className="text-muted text-sm leading-relaxed">
              Spatial whisper audio makes side remarks feel like turning to your friend in the next seat. When the film gets intense, reaction ripples let you feel the room hold its breath in real time.
            </p>
          </div>
        </div>

        {/* NARRATIVE ACT III: LIGHTS DOWN */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-5 space-y-3">
            <span className="font-mono text-xs text-accent uppercase tracking-widest block">
              Act III &bull; Lights Down
            </span>
            <h2 className="font-display font-bold text-3xl md:text-4xl text-text tracking-tight-display">
              Clocks lock to the millisecond.
            </h2>
            <p className="text-muted text-sm leading-relaxed">
              The house lights dim and high-frequency NTP drift-compensation algorithms align every viewer&apos;s playback frame. Nobody laughs at a joke before you hear it; nobody gasps at a reveal before you see it.
            </p>
          </div>

          <div className="md:col-span-7 bg-surface p-6 border border-border-brass rounded-sm shadow-velvet-raised font-mono text-xs space-y-3">
            <div className="flex justify-between text-muted border-b border-border-subtle pb-2">
              <span>SYNC TELEMETRY ENGINE</span>
              <span className="text-live">CLOCK LOCKED</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center pt-1">
              <div className="p-2.5 bg-surface-2 rounded-sm border border-border-subtle">
                <span className="text-[10px] text-muted block">Max Drift</span>
                <span className="text-accent font-bold text-sm">0.08 ms</span>
              </div>
              <div className="p-2.5 bg-surface-2 rounded-sm border border-border-subtle">
                <span className="text-[10px] text-muted block">Frame Rate</span>
                <span className="text-text font-bold text-sm">60.0 FPS</span>
              </div>
              <div className="p-2.5 bg-surface-2 rounded-sm border border-border-subtle">
                <span className="text-[10px] text-muted block">Buffer Health</span>
                <span className="text-live font-bold text-sm">Optimal</span>
              </div>
            </div>
          </div>
        </div>

        {/* NARRATIVE ACT IV: THE MOVIE */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-7 flex justify-center order-2 md:order-1">
            <ProjectorLens3D className="w-72 h-72 shadow-velvet-raised" />
          </div>

          <div className="md:col-span-5 order-1 md:order-2 space-y-3">
            <span className="font-mono text-xs text-accent uppercase tracking-widest block">
              Act IV &bull; The Movie
            </span>
            <h2 className="font-display font-bold text-3xl md:text-4xl text-text tracking-tight-display">
              The projector shutter opens.
            </h2>
            <p className="text-muted text-sm leading-relaxed">
              YouTube, Criterion, personal Plex libraries, or streaming services via our lightweight browser extension. Pristine video and spatial sound, untouched until the credits roll.
            </p>
          </div>
        </div>
      </section>

      {/* 6. BOTTOM MARQUEE CHASER EDGE */}
      <MarqueeBulbBorder count={36} />

      {/* 7. FINAL CURTAIN CALL CTA */}
      <section className="px-6 py-20 bg-surface text-center border-b border-border-brass">
        <div className="max-w-xl mx-auto space-y-6">
          <span className="font-mono text-xs text-accent uppercase tracking-widest block">
            Admit One &bull; Balcony Suite Reserved
          </span>
          <h2 className="font-display font-bold text-4xl text-text tracking-tight-display">
            Ready to take your seat?
          </h2>
          <p className="text-muted text-sm leading-relaxed">
            Create your permanent box office pass in seconds, or join an active screening room directly with a stub code.
          </p>
          <div className="pt-2 flex justify-center gap-4">
            <Link
              href="/signup"
              className="px-8 py-3.5 bg-accent hover:bg-[#FFAE38] text-[#0E0B09] font-display font-bold text-sm tracking-wide rounded-sm transition-all shadow-projector"
            >
              Get Your Ticket
            </Link>
            <Link
              href="/join"
              className="px-6 py-3.5 bg-surface-2 hover:bg-surface-3 text-text font-mono text-xs rounded-sm border border-border-brass transition-all"
            >
              Enter With Pass
            </Link>
          </div>
        </div>
      </section>

      {/* 8. FOOTER */}
      <footer className="px-6 py-8 bg-[#0E0B09] text-muted-dark text-xs font-mono">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2 text-muted">
            <span className="font-display font-bold text-text">WATCH PARTY</span>
            <span>&bull; The Private Cinema Architecture</span>
          </div>

          <div className="flex items-center gap-6">
            <Link href="/login" className="hover:text-text transition-colors">Box Office</Link>
            <Link href="/signup" className="hover:text-text transition-colors">Claim Ticket</Link>
            <Link href="/join" className="hover:text-text transition-colors">Join Suite</Link>
            <Link href="/motion-demo" className="hover:text-text transition-colors">Motion Atelier</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
