'use client';

/**
 * Cinema Foyer (Home / Lobby Page)
 * Concept: "The Private Cinema"
 * 
 * Features:
 * 1. "Now showing" rooms from friends as poster-style tiles with:
 *    - CSS 3D perspective hover tilt
 *    - Specular light sweep sheen
 *    - Live cathode teal presence dots (pulsing)
 *    - Asymmetric editorial masonry layout (not an identical grid!)
 * 2. Friends rail with:
 *    - Live presence pulse ONLY for live friends (steady for idle/offline)
 *    - Quick invite ("Slip Ticket" admission pass)
 *    - Notifications as perforated cinema ticket stubs
 * 3. Movie discovery with:
 *    - Big poster art
 *    - Category carousel with momentum scrolling and brass controls
 *    - Fuzzy search with anime.js stagger entrance & highlighted matches
 *    - Filter chips with smooth transitions
 * 4. Create-room flow:
 *    - 3-step slide-over sheet with progress 35mm film strip
 * 5. Anime.js stagger on all list entrances, hover & press states on all interactive elements.
 */

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { MarqueeBulbBorder } from '@/components/MarqueeBulbBorder';
import { PosterTiltCard, RoomPosterItem } from '@/components/foyer/PosterTiltCard';
import { FriendsRail } from '@/components/foyer/FriendsRail';
import { MovieDiscovery } from '@/components/foyer/MovieDiscovery';
import { CreateRoomSheet } from '@/components/foyer/CreateRoomSheet';
import { useAnime } from '@/motion/useAnime';
import { MotionDurations, MotionEasings, MotionStaggers } from '@/motion/tokens';
import { stagger } from 'animejs';
import { Movie } from '@watchparty/shared';

// Rich editorial "Now Showing" room data from friends
const NOW_SHOWING_ROOMS: RoomPosterItem[] = [
  {
    id: 'room_blade_runner',
    roomCode: 'CRITERION-70MM',
    title: 'Blade Runner (Final Cut): The 70mm Restoration',
    hostName: 'Elena Rostova',
    posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1000&auto=format&fit=crop',
    format: '70mm',
    memberCount: 6,
    members: [
      { id: 'm1', name: 'Elena', avatar: 'E', isLive: true },
      { id: 'm2', name: 'Marcus', avatar: 'M', isLive: true },
      { id: 'm3', name: 'Sophia', avatar: 'S', isLive: true },
      { id: 'm4', name: 'Leo', avatar: 'L', isLive: true },
    ],
    timecode: '01:24:18',
    layoutVariant: 'feature', // Spans 2 cols, 2 rows in editorial grid
  },
  {
    id: 'room_stalker',
    roomCode: 'ZONE-1979',
    title: 'Stalker (1979) Tarkovsky 4K Remaster',
    hostName: 'Dmitri K.',
    posterUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop',
    format: '4K HDR',
    memberCount: 4,
    members: [
      { id: 'm5', name: 'Dmitri', avatar: 'D', isLive: true },
      { id: 'm6', name: 'Anna', avatar: 'A', isLive: true },
    ],
    timecode: '02:08:44',
    layoutVariant: 'tall', // Tall column spanning 2 rows
  },
  {
    id: 'room_inception',
    roomCode: 'DREAM-IMAX',
    title: 'Inception: 70mm IMAX Synchronous',
    hostName: 'Marcus Vance',
    posterUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&auto=format&fit=crop',
    format: '70mm',
    memberCount: 8,
    members: [
      { id: 'm7', name: 'Marcus', avatar: 'M', isLive: true },
      { id: 'm8', name: 'Arthur', avatar: 'A', isLive: true },
      { id: 'm9', name: 'Ariadne', avatar: 'R', isLive: true },
    ],
    timecode: '00:48:12',
    layoutVariant: 'wide', // Wide tile spanning 2 columns
  },
  {
    id: 'room_matrix',
    roomCode: 'NEO-1999',
    title: 'The Matrix: 35mm Nitrate Print',
    hostName: 'Cipher',
    posterUrl: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&auto=format&fit=crop',
    format: '35mm',
    memberCount: 3,
    members: [
      { id: 'm10', name: 'Neo', avatar: 'N', isLive: true },
      { id: 'm11', name: 'Trinity', avatar: 'T', isLive: true },
    ],
    timecode: '01:15:30',
    layoutVariant: 'standard',
  },
  {
    id: 'room_interstellar',
    roomCode: 'GARGANTUA',
    title: 'Interstellar: 70mm Sound Stage',
    hostName: 'Cooper',
    posterUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop',
    format: 'Dolby Atmos',
    memberCount: 5,
    members: [
      { id: 'm12', name: 'Brand', avatar: 'B', isLive: true },
      { id: 'm13', name: 'Murph', avatar: 'M', isLive: true },
    ],
    timecode: '02:11:05',
    layoutVariant: 'standard',
  },
];

export default function CinemaFoyerPage() {
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);
  const [selectedMovieForSuite, setSelectedMovieForSuite] = useState<Movie | null>(null);
  const [foyerTimecode, setFoyerTimecode] = useState('00:00:00');

  // Real-time ticking foyer timecode
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      setFoyerTimecode(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Anime.js stagger entrance for the "Now Showing" editorial tiles
  const { containerRef: editorialGridRef } = useAnime(({ animate, reducedMotion }) => {
    if (reducedMotion) return;
    animate('.foyer-stagger-card', {
      opacity: [0, 1],
      translateY: [24, 0],
      scale: [0.97, 1],
      delay: stagger(MotionStaggers.cinematic, { start: 100 }),
      duration: MotionDurations.cinematic,
      ease: MotionEasings.snappyOut,
    });
  });

  const handleOpenCreateWithMovie = (movie: Movie) => {
    setSelectedMovieForSuite(movie);
    setIsCreateSheetOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text selection:bg-accent selection:text-bg">
      {/* 1. CHASING MARQUEE BULB TOP BORDER */}
      <MarqueeBulbBorder count={36} />

      {/* 2. GRAND FOYER HEADER & TICKETING BAR */}
      <header className="border-b border-border-brass/80 bg-surface/85 backdrop-blur-md sticky top-0 z-40 px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          {/* Logo & Foyer Identity */}
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-accent shadow-projector animate-pulse" />
            <Link href="/" className="flex items-baseline gap-2 group">
              <span className="font-display font-extrabold text-xl tracking-tight-display text-text group-hover:text-accent transition-colors">
                WATCH PARTY
              </span>
              <span className="font-mono text-[10px] text-accent tracking-widest uppercase hidden sm:inline">
                THE PRIVATE CINEMA
              </span>
            </Link>
            <span className="px-2 py-0.5 bg-surface-2 border border-border-brass rounded-sm font-mono text-[10px] text-live uppercase tracking-wider hidden md:inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-live animate-cathode-pulse" />
              <span>FOYER LIVE</span>
            </span>
          </div>

          {/* Master Projection Clock & Action Buttons */}
          <div className="flex items-center gap-4">
            {/* Live Ticking Timecode */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-surface-2 border border-border-brass rounded-sm font-mono text-xs text-muted">
              <span className="text-accent">REEL #04</span>
              <span>&bull;</span>
              <span className="text-text tabular-nums">{foyerTimecode}</span>
            </div>

            {/* Navigation Shortcuts */}
            <nav className="flex items-center gap-3 text-xs font-mono">
              <a
                href="#movie-vault"
                className="hidden lg:inline-flex text-muted hover:text-text transition-colors py-1.5 px-3 rounded-sm border border-transparent hover:border-border-brass"
              >
                Repertory Vault
              </a>
              <Link
                href="/login"
                className="text-muted hover:text-text transition-colors py-1.5 px-3 rounded-sm border border-border-brass bg-surface-2 hover:bg-surface-3 active:scale-95"
              >
                Will Call
              </Link>
              {/* PRIMARY ACTION: OPEN PRIVATE SUITE */}
              <button
                onClick={() => {
                  setSelectedMovieForSuite(null);
                  setIsCreateSheetOpen(true);
                }}
                className="py-1.5 px-3.5 bg-accent hover:bg-accent/90 active:scale-95 text-[#0E0B09] font-bold rounded-sm shadow-projector transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>✂</span>
                <span>Open Private Suite</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* 3. MAIN CINEMA FOYER CONTENT */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8 space-y-12">
        {/* FOYER MARQUEE WELCOME */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-border-brass">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-surface-2 border border-border-brass rounded-sm font-mono text-xs text-accent uppercase tracking-widest mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-live shadow-cathode animate-cathode-pulse" />
              <span>Cinematheque Main Concourse</span>
            </div>
            <h1 className="font-display font-black text-3xl md:text-5xl text-text tracking-tight leading-none">
              The Grand Foyer
            </h1>
            <p className="text-sm font-sans text-muted max-w-2xl mt-2 leading-relaxed">
              Step out of the cold into warm velvet darkness. Choose an illuminated suite hosted by your circle, or commission a new 35mm projection print from the archives.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedMovieForSuite(null);
                setIsCreateSheetOpen(true);
              }}
              className="px-4 py-2 bg-surface-2 hover:bg-surface-3 active:scale-95 border border-border-brass rounded-sm font-mono text-xs text-text hover:text-accent transition-all flex items-center gap-2 cursor-pointer shadow-sm"
            >
              <span>🎟</span>
              <span>Commission New Suite</span>
            </button>
          </div>
        </div>

        {/* SECTION 1: "NOW SHOWING" EDITORIAL MASONRY TILES */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-live shadow-cathode animate-cathode-pulse" />
              <h2 className="font-display font-bold text-2xl text-text">
                Now Showing in Private Suites
              </h2>
              <span className="text-xs font-mono text-muted">
                ({NOW_SHOWING_ROOMS.length} Friends Projecting)
              </span>
            </div>
            <span className="text-xs font-mono text-muted hidden sm:inline">
              Hover to tilt • Light sheen coordinates • Click to join
            </span>
          </div>

          {/* ASYMMETRIC EDITORIAL MASONRY GRID (NOT AN IDENTICAL GRID) */}
          <div
            ref={editorialGridRef}
            className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-5 auto-rows-[220px]"
          >
            {NOW_SHOWING_ROOMS.map((room) => (
              <div key={room.id} className="foyer-stagger-card h-full">
                <PosterTiltCard room={room} className="h-full" />
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 2: SPLIT LOWER CONCOURSE (MOVIE DISCOVERY + FRIENDS RAIL) */}
        <div id="movie-vault" className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* LEFT: MOVIE DISCOVERY (8 COLUMNS ON LG) */}
          <div className="lg:col-span-8 xl:col-span-8">
            <MovieDiscovery
              onSelectMovieForSuite={handleOpenCreateWithMovie}
              className="w-full"
            />
          </div>

          {/* RIGHT: FRIENDS RAIL & NOTIFICATION STUBS (4 COLUMNS ON LG) */}
          <div className="lg:col-span-4 xl:col-span-4 sticky top-20">
            <FriendsRail className="w-full" />
          </div>
        </div>
      </main>

      {/* 4. PERSISTENT 3-STEP CREATE ROOM DRAWER (WITH 35MM PROGRESS FILM STRIP) */}
      <CreateRoomSheet
        isOpen={isCreateSheetOpen}
        onClose={() => setIsCreateSheetOpen(false)}
        initialMovie={selectedMovieForSuite}
      />

      {/* 5. CINEMA FOYER FOOTER */}
      <footer className="border-t border-border-brass/70 bg-surface/90 py-8 px-6 mt-16 text-center text-xs font-mono text-muted">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-accent">🎞</span>
            <span>WATCH PARTY FOYER • ARCHIVE PRINT SPECIFICATION V4.5</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-text transition-colors">
              Marquee Entrance
            </Link>
            <span>&bull;</span>
            <Link href="/motion-demo" className="hover:text-text transition-colors">
              Motion Atelier
            </Link>
            <span>&bull;</span>
            <Link href="/join" className="hover:text-text transition-colors">
              Will Call Pass
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
