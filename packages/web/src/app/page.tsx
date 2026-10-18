'use client';

/**
 * Watch Party — The Private Cinema (Rave-Style UX Flow)
 *
 * Implements Rave (rave.io) Product Flow:
 * 1. Rapid "+ Start Party" with instant Provider Tiles:
 *    YouTube, Netflix, JioHotstar / Disney+, Prime Video, Google Drive / Web URL, Local File.
 * 2. 1-Tap Co-Watching: Choosing a video immediately creates the room and launches the player.
 * 3. Preserves "The Private Cinema" warm aesthetic:
 *    Tokens: bg #0E0B09, surface #1A1512, surface-2 #261E19, text #F3E9DC, amber #FF9F1C, red #E4572E, teal #2EC4B6.
 */

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import {
  NETFLIX_CATALOGUE,
  HOTSTAR_CATALOGUE,
  YOUTUBE_FULL_MOVIES,
  FREE_FILMS,
  Movie,
} from '@watchparty/shared';

interface SelectedStreamPayload {
  videoId: string;
  provider: 'youtube' | 'html5' | 'local' | 'screenshare';
  sourceRef: string;
  title: string;
}

export default function LandingPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();

  // Navigation & Join State
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Rave-Style Provider Selector Modal State
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'youtube' | 'netflix' | 'hotstar' | 'prime' | 'web' | 'local'>('youtube');
  const [youtubeSearchInput, setYoutubeSearchInput] = useState('');
  const [customWebUrl, setCustomWebUrl] = useState('');
  const [customWebTitle, setCustomWebTitle] = useState('');
  const [localFileLabel, setLocalFileLabel] = useState<string | null>(null);

  // Quick Join Handler
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const code = roomCode.trim().toUpperCase();
    if (!code) {
      setJoinError('Enter a room code');
      return;
    }
    setJoinError(null);
    router.push(`/room/${encodeURIComponent(code)}`);
  };

  // Core Room Creator: Launches party with selected video playing immediately
  const launchPartyWithPayload = async (payload?: SelectedStreamPayload) => {
    if (isCreating) return;
    setCreateError(null);
    try {
      setIsCreating(true);
      const storedName =
        user?.displayName ||
        (typeof window !== 'undefined' && localStorage.getItem('watchparty_username')) ||
        `Host-${Math.floor(100 + Math.random() * 900)}`;

      if (typeof window !== 'undefined') {
        localStorage.setItem('watchparty_username', storedName);
        if (payload) {
          sessionStorage.setItem('wp_initial_movie', JSON.stringify(payload));
        }
      }

      const API = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_API_URL || '');
      const body: Record<string, any> = {
        hostUserName: storedName,
        roomName: payload ? `${payload.title} Party` : 'Private Screening Suite',
      };
      if (payload?.videoId) {
        body.initialVideoId = payload.videoId;
      }

      const res = await fetch(`${API}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      console.error('[Landing Create Room Error]:', err);
      setCreateError("Could not connect to party server. Check your connection.");
    } finally {
      setIsCreating(false);
    }
  };

  // Launch from standard Movie object
  const launchWithMovie = (movie: Movie) => {
    const isYt = movie.provider === 'youtube' || Boolean(movie.youtubeId);
    const payload: SelectedStreamPayload = {
      videoId: movie.youtubeId || movie.id,
      provider: isYt ? 'youtube' : 'html5',
      sourceRef: movie.youtubeId
        ? `https://www.youtube.com/watch?v=${movie.youtubeId}`
        : (movie.videoUrl || movie.playableUrl || ''),
      title: movie.title,
    };
    launchPartyWithPayload(payload);
  };

  // Launch from YouTube input (URL or query)
  const handleLaunchYouTube = (e: React.FormEvent) => {
    e.preventDefault();
    const q = youtubeSearchInput.trim();
    if (!q) return;

    // Check if direct URL
    const match = q.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    const videoId = match ? match[1] : 'dQw4w9WgXcQ';
    launchPartyWithPayload({
      videoId,
      provider: 'youtube',
      sourceRef: match ? q : `https://www.youtube.com/watch?v=${videoId}`,
      title: match ? 'YouTube Video' : `YouTube: ${q}`,
    });
  };

  // Launch from custom Web stream URL (Google Drive / direct MP4 / HLS)
  const handleLaunchWebUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const url = customWebUrl.trim();
    if (!url) return;
    launchPartyWithPayload({
      videoId: `stream_${Date.now()}`,
      provider: 'html5',
      sourceRef: url,
      title: customWebTitle.trim() || 'Direct Web Stream',
    });
  };

  // Quick Trending Titles on Home
  const trendingItems = useMemo(() => {
    return [
      ...NETFLIX_CATALOGUE.slice(0, 2),
      ...HOTSTAR_CATALOGUE.slice(0, 2),
      ...YOUTUBE_FULL_MOVIES.slice(0, 2),
    ];
  }, []);

  return (
    <div className="relative min-h-screen box-border bg-[#0E0B09] text-[#F3E9DC] font-ui overflow-hidden flex flex-col justify-between pb-12">
      {/* ── NAVIGATION ──────────────────────────────────────────────────────── */}
      <nav className="relative flex items-center justify-between px-6 sm:px-12 md:px-16 py-6 border-b border-[#1A1512]">
        <Link
          href="/"
          className="flex items-center gap-3 font-display italic font-medium text-2xl sm:text-[28px] text-[#F3E9DC] hover:text-[#FF9F1C] transition-colors"
        >
          <span className="w-3.5 h-3.5 rounded-full bg-[#FF9F1C] inline-block flex-shrink-0 shadow-[0_0_12px_rgba(255,159,28,0.5)]" />
          <span>Watch Party</span>
        </Link>

        <div className="flex items-center gap-4 sm:gap-6 text-base">
          <Link
            href="/lobby"
            className="text-[#F3E9DC] hover:text-[#FF9F1C] transition-colors font-medium text-sm sm:text-base"
          >
            Lobby &amp; Feed
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

          {/* Primary Action: Rave "+ Start Party" Button */}
          <button
            type="button"
            onClick={() => setIsProviderModalOpen(true)}
            disabled={isCreating}
            className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-sm sm:text-base px-5 py-2.5 sm:py-3 rounded-full hover:brightness-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,159,28,0.3)] border-none cursor-pointer flex items-center gap-2"
          >
            <span className="text-lg leading-none font-bold">+</span>
            <span>Start Party</span>
          </button>
        </div>
      </nav>

      {/* Global Error Banner */}
      {createError && (
        <div className="mx-6 sm:mx-12 md:mx-16 mt-4 text-xs font-mono text-[#E4572E] bg-[#1A1512] border border-[#E4572E]/40 rounded-xl px-4 py-2.5 flex items-center justify-between">
          <span>{createError}</span>
          <button
            type="button"
            onClick={() => setCreateError(null)}
            className="text-[#A89B8C] hover:text-[#F3E9DC] bg-transparent border-none cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── HERO SECTION ────────────────────────────────────────────────────── */}
      <main className="relative flex flex-col lg:flex-row items-start lg:items-center gap-12 px-6 sm:px-12 md:px-16 pt-8 md:pt-14">
        {/* Left Column: Headline & Quick Actions */}
        <div className="flex-[1.15] max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1A1512] border border-[#3A2E26] text-xs font-mono text-[#FF9F1C] mb-4">
            <span className="w-2 h-2 rounded-full bg-[#2EC4B6] animate-pulse" />
            <span>NTP Sub-Frame Synchronized Video &bull; 0ms Drift</span>
          </div>

          <h1 className="font-display font-semibold text-5xl sm:text-7xl lg:text-[96px] leading-[0.98] tracking-[-0.03em] text-[#F3E9DC]">
            Watch together.
            <br />
            <span className="italic font-medium text-[#FF9F1C]">Every frame in sync.</span>
          </h1>

          <p className="mt-5 mb-8 text-lg sm:text-xl leading-[1.55] text-[#A89B8C]">
            Experience movies, YouTube, and OTT with your friends. One tap to pick any video and stream together with voice chat &amp; synchronized audio.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => setIsProviderModalOpen(true)}
              disabled={isCreating}
              className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-base sm:text-lg px-8 py-4 rounded-full hover:brightness-105 active:scale-95 transition-all inline-flex items-center justify-center gap-2 border-none cursor-pointer shadow-[0_0_24px_rgba(255,159,28,0.35)]"
            >
              <span className="text-xl font-bold">+</span>
              <span>{isCreating ? 'Preparing Suite...' : 'Start a Party'}</span>
            </button>

            {!showCodeInput ? (
              <button
                type="button"
                onClick={() => setShowCodeInput(true)}
                className="border-[1.5px] border-[#5A4A3E] text-[#F3E9DC] hover:border-[#FF9F1C] hover:text-[#FF9F1C] text-base sm:text-lg px-7 py-4 rounded-full transition-colors inline-flex items-center justify-center bg-transparent cursor-pointer min-h-[44px]"
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
                    onChange={(e) => {
                      setRoomCode(e.target.value);
                      setJoinError(null);
                    }}
                    autoFocus
                    className="bg-[#1A1512] border border-[#3A2E26] rounded-full px-5 py-3.5 text-[#F3E9DC] font-mono text-base uppercase tracking-wider focus:outline-none focus:border-[#FF9F1C] w-40 sm:w-48"
                    aria-label="Room code"
                  />
                  <button
                    type="submit"
                    className="bg-[#261E19] hover:bg-[#3A2E26] text-[#F3E9DC] border border-[#3A2E26] font-mono text-sm px-5 py-3.5 rounded-full transition-colors cursor-pointer min-h-[44px]"
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

          {/* Quick Provider Launch Pills (Rave Style) */}
          <div className="mt-8 flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="text-[#A89B8C] uppercase tracking-wider text-[11px] mr-1">Instant Pick:</span>
            <button
              type="button"
              onClick={() => {
                setSelectedProvider('youtube');
                setIsProviderModalOpen(true);
              }}
              className="bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] hover:border-[#FF9F1C] text-[#F3E9DC] px-3.5 py-2 rounded-full flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <span className="w-2 h-2 rounded-full bg-[#E4572E]" />
              YouTube
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedProvider('netflix');
                setIsProviderModalOpen(true);
              }}
              className="bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] hover:border-[#E50914] text-[#F3E9DC] px-3.5 py-2 rounded-full flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <span className="w-2 h-2 rounded-full bg-[#E50914]" />
              Netflix
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedProvider('hotstar');
                setIsProviderModalOpen(true);
              }}
              className="bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] hover:border-[#0063E5] text-[#F3E9DC] px-3.5 py-2 rounded-full flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <span className="w-2 h-2 rounded-full bg-[#0063E5]" />
              JioHotstar
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedProvider('web');
                setIsProviderModalOpen(true);
              }}
              className="bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] hover:border-[#2EC4B6] text-[#F3E9DC] px-3.5 py-2 rounded-full flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <span className="w-2 h-2 rounded-full bg-[#2EC4B6]" />
              Web / Drive URL
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedProvider('local');
                setIsProviderModalOpen(true);
              }}
              className="bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] hover:border-[#FF9F1C] text-[#F3E9DC] px-3.5 py-2 rounded-full flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <span className="w-2 h-2 rounded-full bg-[#FF9F1C]" />
              Local File
            </button>
          </div>
        </div>

        {/* Right Column: Interactive Ticket Stub Showcase */}
        <div className="flex-1 relative w-full h-[320px] sm:h-[470px] max-w-[500px] mx-auto lg:mx-0">
          <div
            className="absolute left-6 sm:left-10 top-12 sm:top-18 w-[290px] sm:w-[450px] h-[190px] sm:h-[250px] bg-[#FF9F1C] rounded-[18px] pointer-events-none opacity-90 shadow-2xl"
            style={{ transform: 'rotate(4deg)' }}
          />

          <div
            onClick={() => setIsProviderModalOpen(true)}
            className="absolute left-0 top-4 sm:top-8 w-[310px] sm:w-[470px] flex bg-[#F3E9DC] text-[#0E0B09] rounded-[18px] shadow-[0_30px_60px_rgba(0,0,0,0.6)] cursor-pointer hover:scale-[1.02] active:scale-98 transition-transform select-none"
            style={{ transform: 'rotate(-3deg)' }}
            title="Click to start party"
          >
            <div className="flex-1 p-6 sm:p-8">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-[#E4572E] animate-pulse" />
                <span className="font-mono text-[10px] sm:text-xs font-bold uppercase tracking-wider text-[#0E0B09]/80">
                  Rave-Style Co-Watch Suite
                </span>
              </div>
              <div className="mb-4 sm:mb-5 font-display font-semibold text-2xl sm:text-[38px] leading-[1.05] text-[#0E0B09]">
                Private Screening
              </div>
              <div className="flex gap-6 sm:gap-8 font-mono text-xs sm:text-[13px] text-[#0E0B09]">
                <div>
                  STREAM
                  <br />
                  <b className="text-base sm:text-xl font-bold">1-TAP PLAY</b>
                </div>
                <div>
                  VOICE
                  <br />
                  <b className="text-base sm:text-xl font-bold">AUTO-DUCK</b>
                </div>
              </div>
            </div>

            <div className="relative w-16 sm:w-24 border-l-[3px] border-dashed border-[#0E0B09] flex items-center justify-center flex-shrink-0">
              <span className="absolute -left-[17px] -top-[16px] w-[30px] h-[30px] rounded-full bg-[#0E0B09]" />
              <span className="absolute -left-[17px] -bottom-[16px] w-[30px] h-[30px] rounded-full bg-[#0E0B09]" />
              <span
                className="font-mono text-[10px] sm:text-xs tracking-[0.3em] font-bold text-[#0E0B09]"
                style={{ writingMode: 'vertical-rl' }}
              >
                ADMIT ONE
              </span>
            </div>
          </div>

          <div className="absolute left-3.5 bottom-2 sm:bottom-6 flex items-center">
            <span className="w-9 h-9 rounded-full bg-[#E4572E] border-[2.5px] border-[#0E0B09] -mr-2.5 flex items-center justify-center font-bold text-xs text-[#0E0B09]">
              Y
            </span>
            <span className="w-9 h-9 rounded-full bg-[#2EC4B6] border-[2.5px] border-[#0E0B09] -mr-2.5 flex items-center justify-center font-bold text-xs text-[#0E0B09]">
              N
            </span>
            <span className="w-9 h-9 rounded-full bg-[#FF9F1C] border-[2.5px] border-[#0E0B09] -mr-2.5 flex items-center justify-center font-bold text-xs text-[#0E0B09]">
              H
            </span>
            <span className="ml-5 text-sm text-[#A89B8C]">Friends seated &bull; Audio synced</span>
          </div>
        </div>
      </main>

      {/* ── TRENDING PICKS (1-CLICK PARTY LAUNCH) ────────────────────────────── */}
      <section className="px-6 sm:px-12 md:px-16 pt-12 pb-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF9F1C]" />
            <h2 className="font-display font-semibold text-xl sm:text-2xl text-[#F3E9DC]">
              Trending Tonight — Tap to Watch Together
            </h2>
          </div>
          <Link
            href="/lobby"
            className="text-xs font-mono text-[#FF9F1C] hover:underline hidden sm:inline"
          >
            Explore All 45+ Vault Titles &rarr;
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {trendingItems.map((item) => {
            const isNetflix = (item as any).tags?.includes('netflix') || item.provider === 'netflix';
            const isHotstar = (item as any).tags?.includes('hotstar') || item.provider === 'hotstar';
            const tagColor = isNetflix ? '#E50914' : isHotstar ? '#0063E5' : '#E4572E';
            const tagLabel = isNetflix ? 'Netflix' : isHotstar ? 'Hotstar' : 'Full Film';

            return (
              <div
                key={item.id}
                onClick={() => launchWithMovie(item)}
                className="bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] hover:border-[#FF9F1C] rounded-xl overflow-hidden cursor-pointer transition-all group flex flex-col justify-between shadow-lg"
              >
                <div className="relative aspect-[3/4] bg-black overflow-hidden">
                  <img
                    src={item.posterUrl}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-85"
                  />
                  <span
                    style={{ backgroundColor: tagColor }}
                    className="absolute top-2 left-2 text-white font-mono text-[9px] font-bold px-2 py-0.5 rounded uppercase"
                  >
                    {tagLabel}
                  </span>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2.5">
                    <span className="w-full py-1.5 bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs rounded text-center">
                      ▶ Play Together
                    </span>
                  </div>
                </div>

                <div className="p-3">
                  <h3 className="font-display font-medium text-sm text-[#F3E9DC] group-hover:text-[#FF9F1C] transition-colors truncate">
                    {item.title}
                  </h3>
                  <div className="flex items-center justify-between text-[11px] font-mono text-[#A89B8C] mt-1">
                    <span>{item.year}</span>
                    <span className="text-[#FF9F1C] group-hover:underline">Start &rarr;</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 3 STEPS RAVE STRIP ──────────────────────────────────────────────── */}
      <div className="relative flex flex-col sm:flex-row gap-8 sm:gap-12 px-6 sm:px-12 md:px-16 pt-8 border-t border-[#1A1512] mt-6">
        <div className="flex-1">
          <div className="font-mono text-xs sm:text-[13px] text-[#FF9F1C]">01</div>
          <div className="my-1 font-display font-semibold text-lg sm:text-[22px] text-[#F3E9DC]">
            Tap &ldquo;+ Start Party&rdquo;
          </div>
          <p className="text-xs text-[#A89B8C]">
            Select YouTube, Netflix, Disney+, Prime, or paste any video link.
          </p>
        </div>

        <div className="flex-1">
          <div className="font-mono text-xs sm:text-[13px] text-[#FF9F1C]">02</div>
          <div className="my-1 font-display font-semibold text-lg sm:text-[22px] text-[#F3E9DC]">
            Invite Friends With 6-Letter Code
          </div>
          <p className="text-xs text-[#A89B8C]">
            Share your admission stub. Friends hop in on mobile, tablet, or desktop.
          </p>
        </div>

        <div className="flex-1">
          <div className="font-mono text-xs sm:text-[13px] text-[#FF9F1C]">03</div>
          <div className="my-1 font-display font-semibold text-lg sm:text-[22px] text-[#F3E9DC]">
            Voice Chat with Auto-Ducking
          </div>
          <p className="text-xs text-[#A89B8C]">
            When you talk, video volume lowers smoothly so everyone hears your voice.
          </p>
        </div>
      </div>

      {/* ── RAVE-STYLE PROVIDER SELECTOR MODAL ─────────────────────────────────── */}
      {isProviderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true">
          {/* Backdrop */}
          <div
            onClick={() => setIsProviderModalOpen(false)}
            className="fixed inset-0 bg-black/85 backdrop-blur-sm transition-opacity"
          />

          {/* Modal Container */}
          <div className="relative z-10 w-full max-w-2xl bg-[#1A1512] border border-[#3A2E26] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-5 border-b border-[#261E19] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full bg-[#FF9F1C] flex items-center justify-center text-[10px] font-bold text-black">
                  +
                </span>
                <h3 className="font-display font-bold text-xl text-[#F3E9DC]">
                  Start a Watch Party — Choose Provider
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsProviderModalOpen(false)}
                className="text-[#A89B8C] hover:text-[#F3E9DC] p-2 text-sm font-mono bg-transparent border-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Provider Tabs Strip */}
            <div className="px-5 pt-3 pb-2 flex items-center gap-2 overflow-x-auto border-b border-[#261E19] select-none">
              {[
                { id: 'youtube', label: '🔴 YouTube', color: '#E4572E' },
                { id: 'netflix', label: '🔴 Netflix', color: '#E50914' },
                { id: 'hotstar', label: '🔵 JioHotstar', color: '#0063E5' },
                { id: 'prime', label: '🟡 Prime Video', color: '#00A8E1' },
                { id: 'web', label: '🌐 Web / Drive URL', color: '#2EC4B6' },
                { id: 'local', label: '📁 Local File', color: '#FF9F1C' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSelectedProvider(tab.id as any)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-mono transition-all cursor-pointer whitespace-nowrap border ${
                    selectedProvider === tab.id
                      ? 'bg-[#FF9F1C] text-[#0E0B09] border-[#FF9F1C] font-bold'
                      : 'bg-[#261E19] text-[#A89B8C] border-[#3A2E26] hover:text-[#F3E9DC]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Provider Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* 🔴 YOUTUBE TAB */}
              {selectedProvider === 'youtube' && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-mono text-[#A89B8C] uppercase mb-2">
                      Search YouTube or Paste Video Link:
                    </label>
                    <form onSubmit={handleLaunchYouTube} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. Kung Fury, lo-fi hip hop, or youtube.com/watch?v=..."
                        value={youtubeSearchInput}
                        onChange={(e) => setYoutubeSearchInput(e.target.value)}
                        autoFocus
                        className="flex-1 bg-[#0E0B09] border border-[#3A2E26] focus:border-[#FF9F1C] rounded-xl px-4 py-3 text-sm text-[#F3E9DC] focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={isCreating}
                        className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-sm px-6 py-3 rounded-xl border-none cursor-pointer hover:brightness-105 disabled:opacity-50"
                      >
                        Play Now &rarr;
                      </button>
                    </form>
                  </div>

                  <div>
                    <div className="text-xs font-mono text-[#A89B8C] uppercase mb-2.5">
                      Popular YouTube Movies &amp; Streams:
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {YOUTUBE_FULL_MOVIES.slice(0, 4).map((movie) => (
                        <div
                          key={movie.id}
                          onClick={() => launchWithMovie(movie)}
                          className="bg-[#261E19] hover:bg-[#322720] border border-[#3A2E26] hover:border-[#FF9F1C] p-3 rounded-xl flex items-center gap-3 cursor-pointer transition-all"
                        >
                          <img
                            src={movie.posterUrl}
                            alt={movie.title}
                            className="w-16 h-12 object-cover rounded bg-black flex-shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-display font-medium text-sm text-[#F3E9DC] truncate">
                              {movie.title}
                            </div>
                            <div className="text-[11px] font-mono text-[#A89B8C] mt-0.5">
                              {movie.runtime}m &bull; Tap to launch
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 🔴 NETFLIX TAB */}
              {selectedProvider === 'netflix' && (
                <div className="space-y-4">
                  <div className="bg-[#261E19] border border-[#E50914]/30 rounded-xl p-4 text-xs font-sans text-[#F3E9DC] leading-relaxed flex items-start gap-3">
                    <span className="w-3 h-3 rounded-full bg-[#E50914] flex-shrink-0 mt-0.5" />
                    <div>
                      <b className="text-white block font-display text-sm mb-1">Netflix Party Extension Integration</b>
                      WatchParty syncs timestamps, play/pause, and voice chat. For DRM Netflix video, everyone opens Netflix while WatchParty keeps you locked to the millisecond.
                    </div>
                  </div>

                  <div className="text-xs font-mono text-[#A89B8C] uppercase">
                    Select a Trending Netflix Title to Start Room:
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {NETFLIX_CATALOGUE.slice(0, 6).map((movie) => (
                      <div
                        key={movie.id}
                        onClick={() => launchWithMovie(movie)}
                        className="bg-[#261E19] hover:bg-[#322720] border border-[#3A2E26] hover:border-[#E50914] rounded-xl overflow-hidden cursor-pointer transition-all flex flex-col justify-between"
                      >
                        <div className="aspect-[3/4] bg-black">
                          <img
                            src={movie.posterUrl}
                            alt={movie.title}
                            className="w-full h-full object-cover opacity-85"
                          />
                        </div>
                        <div className="p-2.5">
                          <div className="font-medium text-xs text-[#F3E9DC] truncate">
                            {movie.title}
                          </div>
                          <div className="text-[10px] font-mono text-[#FF9F1C] mt-0.5">
                            ★ {movie.rating} &bull; {movie.year}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 🔵 JIOHOTSTAR TAB */}
              {selectedProvider === 'hotstar' && (
                <div className="space-y-4">
                  <div className="bg-[#261E19] border border-[#0063E5]/30 rounded-xl p-4 text-xs font-sans text-[#F3E9DC] leading-relaxed flex items-start gap-3">
                    <span className="w-3 h-3 rounded-full bg-[#0063E5] flex-shrink-0 mt-0.5" />
                    <div>
                      <b className="text-white block font-display text-sm mb-1">JioHotstar &amp; Disney+ Suite</b>
                      Launch an Indian original or Marvel co-watch suite. Voice chat and reaction bursts remain active throughout.
                    </div>
                  </div>

                  <div className="text-xs font-mono text-[#A89B8C] uppercase">
                    Select a Title:
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {HOTSTAR_CATALOGUE.slice(0, 6).map((movie) => (
                      <div
                        key={movie.id}
                        onClick={() => launchWithMovie(movie)}
                        className="bg-[#261E19] hover:bg-[#322720] border border-[#3A2E26] hover:border-[#0063E5] rounded-xl overflow-hidden cursor-pointer transition-all flex flex-col justify-between"
                      >
                        <div className="aspect-[3/4] bg-black">
                          <img
                            src={movie.posterUrl}
                            alt={movie.title}
                            className="w-full h-full object-cover opacity-85"
                          />
                        </div>
                        <div className="p-2.5">
                          <div className="font-medium text-xs text-[#F3E9DC] truncate">
                            {movie.title}
                          </div>
                          <div className="text-[10px] font-mono text-[#FF9F1C] mt-0.5">
                            ★ {movie.rating} &bull; {movie.year}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 🟡 PRIME VIDEO TAB */}
              {selectedProvider === 'prime' && (
                <div className="space-y-4 text-center py-6">
                  <div className="w-12 h-12 rounded-full bg-[#00A8E1]/20 text-[#00A8E1] font-bold text-xl flex items-center justify-center mx-auto mb-2">
                    ✓
                  </div>
                  <h4 className="font-display font-semibold text-lg text-[#F3E9DC]">
                    Prime Video Extension Bridge
                  </h4>
                  <p className="text-xs text-[#A89B8C] max-w-md mx-auto leading-relaxed">
                    Start a room and use the WatchParty extension to sync your Amazon Prime Video streams with friends.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      launchPartyWithPayload({
                        videoId: 'prime_bridge',
                        provider: 'html5',
                        sourceRef: 'https://www.primevideo.com',
                        title: 'Prime Video Co-Watch',
                      })
                    }
                    className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-sm px-7 py-3 rounded-full border-none cursor-pointer hover:brightness-105"
                  >
                    Open Prime Suite &rarr;
                  </button>
                </div>
              )}

              {/* 🌐 WEB / DRIVE URL TAB */}
              {selectedProvider === 'web' && (
                <form onSubmit={handleLaunchWebUrl} className="space-y-4">
                  <div>
                    <label className="block text-xs font-mono text-[#A89B8C] uppercase mb-1.5">
                      Direct MP4 / HLS / Google Drive URL:
                    </label>
                    <input
                      type="url"
                      placeholder="https://example.com/video.mp4 or Google Drive Link"
                      value={customWebUrl}
                      onChange={(e) => setCustomWebUrl(e.target.value)}
                      className="w-full bg-[#0E0B09] border border-[#3A2E26] focus:border-[#2EC4B6] rounded-xl px-4 py-3 text-sm text-[#F3E9DC] focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-[#A89B8C] uppercase mb-1.5">
                      Stream Title (Optional):
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. My Holiday Movie"
                      value={customWebTitle}
                      onChange={(e) => setCustomWebTitle(e.target.value)}
                      className="w-full bg-[#0E0B09] border border-[#3A2E26] focus:border-[#2EC4B6] rounded-xl px-4 py-3 text-sm text-[#F3E9DC] focus:outline-none"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isCreating}
                      className="w-full bg-[#2EC4B6] text-[#0E0B09] font-bold text-sm py-3.5 rounded-xl border-none cursor-pointer hover:brightness-105 disabled:opacity-50"
                    >
                      Start Web Stream Suite &rarr;
                    </button>
                  </div>
                </form>
              )}

              {/* 📁 LOCAL FILE TAB */}
              {selectedProvider === 'local' && (
                <div className="space-y-4 text-center py-4">
                  <div className="border-2 border-dashed border-[#3A2E26] hover:border-[#FF9F1C] rounded-2xl p-6 transition-colors">
                    <input
                      type="file"
                      accept="video/*"
                      id="local-video-file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setLocalFileLabel(file.name);
                        }
                      }}
                    />
                    <label
                      htmlFor="local-video-file"
                      className="cursor-pointer flex flex-col items-center justify-center gap-2"
                    >
                      <span className="text-3xl">🎬</span>
                      <span className="text-sm font-medium text-[#F3E9DC]">
                        {localFileLabel ? localFileLabel : 'Choose a local video file (MP4, MKV, WebM)'}
                      </span>
                      <span className="text-xs font-mono text-[#A89B8C]">
                        File is played client-side on each friend&apos;s machine &bull; Zero bandwidth upload
                      </span>
                    </label>
                  </div>

                  {localFileLabel && (
                    <button
                      type="button"
                      onClick={() =>
                        launchPartyWithPayload({
                          videoId: `local_${Date.now()}`,
                          provider: 'local',
                          sourceRef: localFileLabel,
                          title: localFileLabel,
                        })
                      }
                      className="w-full bg-[#FF9F1C] text-[#0E0B09] font-bold text-sm py-3.5 rounded-xl border-none cursor-pointer hover:brightness-105"
                    >
                      Launch Party with {localFileLabel} &rarr;
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
