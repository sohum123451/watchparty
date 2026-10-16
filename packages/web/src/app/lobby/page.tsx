'use client';

/**
 * Cinema Foyer / Lobby Page
 * Luxury Velvet & Brass dark cinema styling with REAL streaming platforms:
 * 1. Trending on Netflix (Stranger Things, Squid Game, Money Heist, Wednesday, Extraction 2)
 * 2. Trending on JioHotstar & Disney+ (Special OPS, The Night Manager, Loki, Avengers: Endgame, Brahmāstra)
 * 3. 100% Free Full Movies on YouTube (Kung Fury, Night of the Living Dead, Charade, The General)
 * 4. Classic Cinema Vault with real photographic poster art (Sintel, Tears of Steel, Big Buck Bunny)
 * 5. Real-time active auditories & friends presence sidebar.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import {
  MOVIE_CATALOGUE,
  NETFLIX_CATALOGUE,
  HOTSTAR_CATALOGUE,
  YOUTUBE_FULL_MOVIES,
  FREE_FILMS,
  Movie,
} from '@watchparty/shared';

const API = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_API_URL || '');

// ─── Types ────────────────────────────────────────────────────────────────────

interface FriendPresence {
  userId: string;
  displayName: string;
  status: 'watching' | 'listening' | 'online' | 'offline';
  roomCode?: string;
}

interface ActiveRoom {
  roomId: string;
  roomCode: string;
  roomName: string;
  hostUserName: string;
  memberCount: number;
  mediaTitle: string;
  controlMode: string;
}

type PlatformFilter = 'all' | 'netflix' | 'hotstar' | 'youtube' | 'archive';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avatarInitial(name: string) {
  return (name || '?')[0].toUpperCase();
}

const STATUS_COLOR: Record<string, string> = {
  watching: '#2EC4B6',
  listening: '#2EC4B6',
  online: '#2EC4B6',
  offline: '#5A4A3E',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function LobbyPage() {
  const router = useRouter();
  const { user, loading: authLoading, signOut, authHeader } = useAuth();

  // Route protection: lobby requires a session or guest identity
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login?next=/lobby');
    }
  }, [user, authLoading, router]);

  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);

  // Active rooms from server
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);

  // Friends presence from server
  const [friends, setFriends] = useState<FriendPresence[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendsError, setFriendsError] = useState<string | null>(null);

  // Add-friend modal
  const [friendModalOpen, setFriendModalOpen] = useState(false);
  const [friendInput, setFriendInput] = useState('');
  const [addFriendLoading, setAddFriendLoading] = useState(false);
  const [addFriendError, setAddFriendError] = useState<string | null>(null);
  const [activeFriendActionMenu, setActiveFriendActionMenu] = useState<string | null>(null);

  // ── Data fetching ────────────────────────────────────────────────────────────

  const refreshFriends = useCallback(() => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = authHeader();
    if (token) headers['Authorization'] = token;

    setFriendsLoading(true);
    setFriendsError(null);

    fetch(`${API}/api/friends`, { headers, credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        setFriends(
          (data.friends || []).map((f: any) => ({
            userId: f.userId,
            displayName: f.displayName || f.userName || 'Unknown',
            status: f.presence?.status || 'offline',
            roomCode: f.presence?.roomCode,
          }))
        );
      })
      .catch((err) => {
        console.error('[Friends Fetch Error Details]:', err);
        setFriends([]);
      })
      .finally(() => {
        setFriendsLoading(false);
      });
  }, [authHeader]);

  useEffect(() => {
    refreshFriends();
  }, [refreshFriends]);

  // Fetch active rooms
  useEffect(() => {
    let cancelled = false;
    setRoomsLoading(true);
    fetch(`${API}/api/rooms`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (!cancelled && data.rooms) {
          setActiveRooms(data.rooms);
        }
      })
      .catch((err) => {
        console.error('[Rooms Fetch Error Details]:', err);
      })
      .finally(() => {
        if (!cancelled) setRoomsLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleCreateRoom = async (movie?: Movie) => {
    if (isCreating) return;
    setCreateError(null);
    try {
      setIsCreating(true);
      const storedName =
        user?.displayName ||
        (typeof window !== 'undefined' && localStorage.getItem('watchparty_username')) ||
        `Host-${Math.floor(100 + Math.random() * 900)}`;

      if (movie && typeof window !== 'undefined') {
        sessionStorage.setItem('wp_initial_movie', JSON.stringify({
          videoId: movie.youtubeId || movie.id,
          provider: movie.provider === 'youtube' || movie.youtubeId ? 'youtube' : 'html5',
          sourceRef: movie.youtubeId ? `https://www.youtube.com/watch?v=${movie.youtubeId}` : (movie.videoUrl || movie.playableUrl),
          title: movie.title,
        }));
      }

      const body: Record<string, any> = { hostUserName: storedName };
      if (movie) body.initialVideoId = movie.id;

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
      console.error('[Create Room Error Details]:', err);
      setCreateError("Can't reach server");
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) { setJoinError('Enter a code'); return; }
    setJoinError(null);

    try {
      const res = await fetch(`${API}/api/rooms/${encodeURIComponent(code)}`);
      if (!res.ok) {
        setJoinError('Room not found.');
        return;
      }
      const data = await res.json();
      if (data.exists) {
        router.push(`/room/${encodeURIComponent(code)}`);
      } else {
        setJoinError('Room not found.');
      }
    } catch {
      setJoinError('Room not found.');
    }
  };

  const handleAddFriend = async () => {
    const val = friendInput.trim();
    if (!val) { setAddFriendError('Enter a username'); return; }
    setAddFriendLoading(true);
    setAddFriendError(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = authHeader();
      if (token) headers['Authorization'] = token;

      const res = await fetch(`${API}/api/friends/request`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ username: val }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || 'User not found');
      }
      setFriendModalOpen(false);
      setFriendInput('');
      refreshFriends();
    } catch (err: any) {
      setAddFriendError(err.message || 'Failed to add friend');
    } finally {
      setAddFriendLoading(false);
    }
  };

  const handleRemoveFriend = async (friendId: string) => {
    try {
      const headers: Record<string, string> = {};
      const token = authHeader();
      if (token) headers['Authorization'] = token;
      await fetch(`${API}/api/friends/${encodeURIComponent(friendId)}`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });
      setFriends((prev) => prev.filter((f) => f.userId !== friendId));
      setActiveFriendActionMenu(null);
    } catch {}
  };

  const handleBlockFriend = async (friendId: string) => {
    try {
      const headers: Record<string, string> = {};
      const token = authHeader();
      if (token) headers['Authorization'] = token;
      await fetch(`/api/friends/${encodeURIComponent(friendId)}/block`, {
        method: 'POST',
        headers,
        credentials: 'include',
      });
      setFriends((prev) => prev.filter((f) => f.userId !== friendId));
      setActiveFriendActionMenu(null);
    } catch {}
  };

  // ── Filtering ────────────────────────────────────────────────────────────────

  const q = searchQuery.trim().toLowerCase();

  const filterList = (list: Movie[]) => {
    if (!q) return list;
    return list.filter((m) =>
      m.title.toLowerCase().includes(q) ||
      m.description?.toLowerCase().includes(q) ||
      m.genres?.some((g) => g.toLowerCase().includes(q))
    );
  };

  const netflixFiltered = useMemo(() => filterList(NETFLIX_CATALOGUE), [q]);
  const hotstarFiltered = useMemo(() => filterList(HOTSTAR_CATALOGUE), [q]);
  const youtubeFiltered = useMemo(() => filterList(YOUTUBE_FULL_MOVIES), [q]);
  const archiveFiltered = useMemo(() => filterList(FREE_FILMS), [q]);

  // Featured Spotlight Film
  const spotlightFilm = NETFLIX_CATALOGUE[0];

  return (
    <div className="min-h-screen box-border bg-[#0E0B09] text-[#F3E9DC] font-ui pb-16">
      {/* HEADER */}
      <header className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 px-6 sm:px-12 md:px-16 py-7 border-b border-[#1A1512]">
        <Link
          href="/"
          className="flex items-center gap-3 font-display italic font-medium text-2xl sm:text-[28px] text-[#F3E9DC] hover:text-[#FF9F1C] transition-colors"
        >
          <span className="w-3.5 h-3.5 rounded-full bg-[#FF9F1C] inline-block flex-shrink-0" />
          <span>Watch Party</span>
        </Link>

        {/* Search */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (searchQuery.trim().length === 6) {
              router.push(`/room/${encodeURIComponent(searchQuery.trim().toUpperCase())}`);
            }
          }}
          className="flex-1 max-w-lg mx-0 sm:mx-6 flex gap-2"
        >
          <input
            type="text"
            aria-label="Search movies, shows, or room code"
            placeholder="Search Netflix, Hotstar, YouTube movies, or 6-digit room code…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full box-border bg-[#1A1512] border border-[#3A2E26] rounded-xl px-4 py-3 text-[#F3E9DC] text-sm font-ui placeholder-[#A89B8C] focus:outline-none focus:border-[#FF9F1C] transition-colors"
          />
          {searchQuery.trim().length === 6 && (
            <button
              type="submit"
              className="bg-[#FF9F1C] text-[#0E0B09] px-4 py-2 rounded-xl text-xs font-mono font-bold cursor-pointer hover:brightness-110 flex-shrink-0 border-none"
            >
              Join Room
            </button>
          )}
        </form>

        {/* Create + Avatar + Sign out */}
        <div className="flex items-center justify-end gap-3 text-[15px] text-[#A89B8C]">
          <button
            type="button"
            onClick={() => handleCreateRoom()}
            disabled={isCreating}
            className="bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-sm sm:text-base px-5 py-2.5 rounded-full transition-all cursor-pointer border-none flex-shrink-0 disabled:opacity-60"
          >
            {isCreating ? 'Creating…' : '+ Create room'}
          </button>

          {user ? (
            <div className="flex items-center gap-2">
              <span
                className="w-9 h-9 rounded-full bg-[#FF9F1C] flex items-center justify-center font-bold text-[#0E0B09] text-xs flex-shrink-0 select-none"
                title={user.displayName}
              >
                {avatarInitial(user.displayName)}
              </span>
              <button
                type="button"
                onClick={() => signOut()}
                className="text-xs font-mono text-[#A89B8C] hover:text-[#E4572E] cursor-pointer bg-transparent border-none ml-1 transition-colors"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login?next=/lobby"
              className="text-sm font-medium text-[#A89B8C] hover:text-[#FF9F1C] transition-colors"
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      {/* PLATFORM FILTER TABS */}
      <div className="px-6 sm:px-12 md:px-16 pt-5 pb-2 flex items-center gap-2 sm:gap-3 overflow-x-auto select-none border-b border-[#1A1512]/60">
        {[
          { id: 'all', label: '✦ All Platforms' },
          { id: 'netflix', label: '🔴 Netflix Party' },
          { id: 'hotstar', label: '🔵 JioHotstar & Disney+' },
          { id: 'youtube', label: '▶ YouTube Full Movies' },
          { id: 'archive', label: '🎬 Open Cinema Vault' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPlatformFilter(tab.id as PlatformFilter)}
            className={`px-4 py-2 rounded-full text-xs font-mono transition-all cursor-pointer whitespace-nowrap border ${
              platformFilter === tab.id
                ? 'bg-[#FF9F1C] text-[#0E0B09] border-[#FF9F1C] font-bold shadow-[0_0_15px_rgba(255,159,28,0.3)]'
                : 'bg-[#1A1512] text-[#A89B8C] border-[#3A2E26] hover:text-[#F3E9DC] hover:border-[#5A4A3E]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* MAIN LAYOUT */}
      <div className="flex flex-col lg:flex-row gap-8 px-6 sm:px-12 md:px-16 pt-6">
        {/* Left Column: Movies & OTT */}
        <div className="flex-1 min-w-0 space-y-10">

          {/* ACTIVE AUDITORIUMS (if any live on server) */}
          {activeRooms.length > 0 && (
            <div className="bg-[#1A1512]/60 border border-[#3A2E26] rounded-2xl p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2EC4B6] animate-pulse" />
                <h2 className="font-display font-semibold text-lg text-[#F3E9DC]">Live Screening Suites</h2>
                <span className="font-mono text-xs bg-[#261E19] text-[#2EC4B6] px-2 py-0.5 rounded-full">
                  {activeRooms.length} Active
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {activeRooms.map((r) => (
                  <div
                    key={r.roomCode}
                    onClick={() => router.push(`/room/${r.roomCode}`)}
                    className="bg-[#261E19] hover:bg-[#2F251F] border border-[#3A2E26] hover:border-[#2EC4B6] p-4 rounded-xl flex items-center justify-between cursor-pointer transition-all"
                  >
                    <div>
                      <div className="font-display font-semibold text-sm text-[#F3E9DC] truncate">
                        {r.roomName || `Room #${r.roomCode}`}
                      </div>
                      <div className="text-[11px] font-mono text-[#A89B8C] mt-1 flex items-center gap-2">
                        <span>Code: <b className="text-[#FF9F1C]">{r.roomCode}</b></span>
                        <span>•</span>
                        <span>{r.memberCount} seated</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="px-3.5 py-1.5 rounded-full bg-[#2EC4B6] text-[#0E0B09] font-bold text-xs border-none cursor-pointer hover:brightness-110"
                    >
                      Enter Suite
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* HERO SPOTLIGHT CARD */}
          {!q && (platformFilter === 'all' || platformFilter === 'netflix') && spotlightFilm && (
            <div className="relative rounded-2xl overflow-hidden border border-[#3A2E26] bg-[#140F0C] min-h-[320px] sm:min-h-[380px] flex flex-col justify-end p-6 sm:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.8)] group">
              <img
                src={spotlightFilm.posterUrl}
                alt={spotlightFilm.title}
                className="absolute inset-0 w-full h-full object-cover opacity-35 group-hover:scale-105 transition-transform duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0E0B09] via-[#0E0B09]/80 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0E0B09] via-[#0E0B09]/60 to-transparent" />

              <div className="relative z-10 max-w-2xl space-y-3">
                <div className="flex items-center gap-2.5">
                  <span className="bg-[#E50914] text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                    Netflix Original
                  </span>
                  <span className="text-[#FF9F1C] font-mono text-xs">
                    ★ {spotlightFilm.rating} • {spotlightFilm.year} • {spotlightFilm.genres?.join(', ')}
                  </span>
                </div>
                <h1 className="font-display font-semibold text-3xl sm:text-5xl lg:text-6xl text-[#F3E9DC] leading-[1.02]">
                  {spotlightFilm.title}
                </h1>
                <p className="text-xs sm:text-sm text-[#A89B8C] leading-relaxed line-clamp-3">
                  {spotlightFilm.description}
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => handleCreateRoom(spotlightFilm)}
                    disabled={isCreating}
                    className="px-6 py-3 bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-sm rounded-full transition-all border-none cursor-pointer flex items-center gap-2 shadow-[0_0_20px_rgba(255,159,28,0.3)]"
                  >
                    <span>▶</span>
                    <span>Start Co-Watch Suite</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCreateRoom(spotlightFilm)}
                    className="px-4 py-3 bg-[#261E19] hover:bg-[#342821] border border-[#3A2E26] hover:border-[#2EC4B6] text-[#2EC4B6] text-xs font-mono rounded-full transition-colors cursor-pointer"
                  >
                    📺 Stream Tab with Audio
                  </button>
                  <a
                    href={spotlightFilm.platformUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-3 bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] text-[#A89B8C] hover:text-[#F3E9DC] text-xs font-mono rounded-full transition-colors no-underline"
                  >
                    ↗ Netflix
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* SHELF 1: 🔴 NETFLIX PARTY */}
          {(platformFilter === 'all' || platformFilter === 'netflix') && netflixFiltered.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#2A211B] pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#E50914]" />
                  <h2 className="font-display font-semibold text-2xl text-[#F3E9DC]">Trending on Netflix</h2>
                </div>
                <span className="text-xs font-mono text-[#A89B8C]">Stream tab with audio or watch preview in sync</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {netflixFiltered.map((movie) => (
                  <div
                    key={movie.id}
                    onClick={() => handleCreateRoom(movie)}
                    className="bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] hover:border-[#E50914] rounded-xl overflow-hidden cursor-pointer transition-all flex flex-col justify-between group shadow-lg"
                  >
                    <div className="relative aspect-[3/4] bg-black overflow-hidden">
                      <img
                        src={movie.posterUrl}
                        alt={movie.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-85"
                      />
                      <span className="absolute top-2 left-2 bg-[#E50914] text-white font-mono text-[9px] font-bold px-2 py-0.5 rounded uppercase">
                        Netflix
                      </span>
                      <span className="absolute top-2 right-2 bg-black/75 backdrop-blur-sm text-[#FF9F1C] text-[10px] font-mono px-1.5 py-0.5 rounded">
                        ★ {movie.rating}
                      </span>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                        <span className="w-full py-2 bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs rounded-lg text-center shadow-lg">
                          Co-Watch Suite →
                        </span>
                      </div>
                    </div>
                    <div className="p-3">
                      <h3 className="font-display font-semibold text-sm text-[#F3E9DC] group-hover:text-[#FF9F1C] transition-colors truncate">
                        {movie.title}
                      </h3>
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#A89B8C] mt-1">
                        <span>{movie.year}</span>
                        <span>{movie.runtime}m</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* SHELF 2: 🔵 JIOHOTSTAR & DISNEY+ */}
          {(platformFilter === 'all' || platformFilter === 'hotstar') && hotstarFiltered.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#2A211B] pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#0063E5]" />
                  <h2 className="font-display font-semibold text-2xl text-[#F3E9DC]">Trending on JioHotstar &amp; Disney+</h2>
                </div>
                <span className="text-xs font-mono text-[#A89B8C]">Indian originals, Marvel &amp; Disney+ co-watching</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {hotstarFiltered.map((movie) => (
                  <div
                    key={movie.id}
                    onClick={() => handleCreateRoom(movie)}
                    className="bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] hover:border-[#0063E5] rounded-xl overflow-hidden cursor-pointer transition-all flex flex-col justify-between group shadow-lg"
                  >
                    <div className="relative aspect-[3/4] bg-black overflow-hidden">
                      <img
                        src={movie.posterUrl}
                        alt={movie.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-85"
                      />
                      <span className="absolute top-2 left-2 bg-[#0063E5] text-white font-mono text-[9px] font-bold px-2 py-0.5 rounded uppercase">
                        Hotstar
                      </span>
                      <span className="absolute top-2 right-2 bg-black/75 backdrop-blur-sm text-[#FF9F1C] text-[10px] font-mono px-1.5 py-0.5 rounded">
                        ★ {movie.rating}
                      </span>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                        <span className="w-full py-2 bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs rounded-lg text-center shadow-lg">
                          Co-Watch Suite →
                        </span>
                      </div>
                    </div>
                    <div className="p-3">
                      <h3 className="font-display font-semibold text-sm text-[#F3E9DC] group-hover:text-[#FF9F1C] transition-colors truncate">
                        {movie.title}
                      </h3>
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#A89B8C] mt-1">
                        <span>{movie.year}</span>
                        <span>{movie.runtime}m</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* SHELF 3: ▶ 100% FREE FULL MOVIES ON YOUTUBE */}
          {(platformFilter === 'all' || platformFilter === 'youtube') && youtubeFiltered.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#2A211B] pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#E4572E]" />
                  <h2 className="font-display font-semibold text-2xl text-[#F3E9DC]">Full Movies on YouTube (No Subscription)</h2>
                </div>
                <span className="text-xs font-mono text-[#A89B8C]">Play full-length features in direct sync</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {youtubeFiltered.map((movie) => (
                  <div
                    key={movie.id}
                    onClick={() => handleCreateRoom(movie)}
                    className="bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] hover:border-[#E4572E] rounded-xl overflow-hidden cursor-pointer transition-all flex flex-col justify-between group shadow-lg"
                  >
                    <div className="relative aspect-video bg-black overflow-hidden">
                      <img
                        src={movie.posterUrl}
                        alt={movie.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-85"
                      />
                      <span className="absolute top-2 left-2 bg-[#E4572E] text-white font-mono text-[9px] font-bold px-2 py-0.5 rounded uppercase">
                        Full Movie
                      </span>
                      <span className="absolute bottom-2 right-2 bg-black/80 font-mono text-[10px] text-[#F3E9DC] px-2 py-0.5 rounded">
                        {movie.runtime}m
                      </span>
                    </div>
                    <div className="p-3.5 flex flex-col justify-between flex-1">
                      <div>
                        <h3 className="font-display font-semibold text-base text-[#F3E9DC] group-hover:text-[#FF9F1C] transition-colors leading-tight">
                          {movie.title}
                        </h3>
                        <p className="text-xs text-[#A89B8C] mt-1.5 line-clamp-2">
                          {movie.description}
                        </p>
                      </div>
                      <div className="mt-3 pt-2 border-t border-[#2A211B] flex items-center justify-between text-xs font-mono">
                        <span className="text-[#A89B8C]">{movie.year}</span>
                        <span className="text-[#FF9F1C] group-hover:underline font-bold">Play Movie →</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* SHELF 4: 🎬 OPEN CINEMA VAULT */}
          {(platformFilter === 'all' || platformFilter === 'archive') && archiveFiltered.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#2A211B] pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#2EC4B6]" />
                  <h2 className="font-display font-semibold text-2xl text-[#F3E9DC]">Cinema Archive &amp; Master Prints</h2>
                </div>
                <span className="text-xs font-mono text-[#A89B8C]">Blender 3D open movies &amp; public domain classics</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {archiveFiltered.map((movie) => (
                  <div
                    key={movie.id}
                    onClick={() => handleCreateRoom(movie)}
                    className="bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] hover:border-[#2EC4B6] rounded-xl overflow-hidden cursor-pointer transition-all flex flex-col justify-between group shadow-lg"
                  >
                    <div className="relative aspect-[3/4] bg-black overflow-hidden">
                      <img
                        src={movie.posterUrl}
                        alt={movie.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-85"
                      />
                      <span className="absolute top-2 left-2 bg-[#2EC4B6] text-[#0E0B09] font-mono text-[9px] font-bold px-2 py-0.5 rounded uppercase">
                        {movie.license ? movie.license.split('(')[0].trim() : 'Free'}
                      </span>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                        <span className="w-full py-2 bg-[#2EC4B6] text-[#0E0B09] font-bold text-xs rounded-lg text-center shadow-lg">
                          Screen Film →
                        </span>
                      </div>
                    </div>
                    <div className="p-3">
                      <h3 className="font-display font-semibold text-sm text-[#F3E9DC] group-hover:text-[#2EC4B6] transition-colors truncate">
                        {movie.title}
                      </h3>
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#A89B8C] mt-1">
                        <span>{movie.year}</span>
                        <span>{movie.runtime}m</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Empty search fallback */}
          {q &&
            netflixFiltered.length === 0 &&
            hotstarFiltered.length === 0 &&
            youtubeFiltered.length === 0 &&
            archiveFiltered.length === 0 && (
              <div className="py-16 text-center text-sm font-mono text-[#A89B8C] bg-[#1A1512] border border-[#3A2E26] rounded-2xl">
                No titles matching &quot;{searchQuery}&quot;. Try searching for &quot;Stranger Things&quot;, &quot;Special OPS&quot;, or &quot;Kung Fury&quot;.
              </div>
            )}
        </div>

        {/* RIGHT SIDEBAR: Friends & Codes */}
        <aside className="w-full lg:w-[320px] box-border self-start bg-[#1A1512] border border-[#3A2E26] rounded-2xl p-6 flex-shrink-0 space-y-5">
          <div className="flex items-baseline justify-between border-b border-[#2A211B] pb-3">
            <h3 className="font-display font-semibold text-xl text-[#F3E9DC]">Friends</h3>
            <span className="font-mono text-xs text-[#A89B8C]">
              {friends.filter((f) => f.status !== 'offline').length} Online
            </span>
          </div>

          {/* Join with code */}
          {showJoinInput ? (
            <div>
              <form onSubmit={handleJoinWithCode} className="flex gap-2">
                <input
                  type="text"
                  placeholder="ROOM CODE"
                  value={joinCode}
                  onChange={(e) => { setJoinCode(e.target.value); setJoinError(null); }}
                  autoFocus
                  className="flex-1 bg-[#261E19] border border-[#3A2E26] rounded-full px-3.5 py-2 text-xs font-mono text-[#F3E9DC] focus:outline-none focus:border-[#FF9F1C] uppercase tracking-wider"
                />
                <button
                  type="submit"
                  className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs px-3.5 py-2 rounded-full cursor-pointer border-none"
                >
                  Go
                </button>
              </form>
              {joinError && <span className="text-xs font-mono text-[#E4572E] mt-1.5 block">{joinError}</span>}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowJoinInput(true)}
              className="w-full text-center border border-[#3A2E26] hover:border-[#FF9F1C] hover:text-[#FF9F1C] text-[#F3E9DC] rounded-full py-2.5 text-xs font-mono transition-colors cursor-pointer bg-[#261E19]"
            >
              Join with Room Code
            </button>
          )}

          {/* Friends list */}
          {friendsLoading ? (
            <div className="py-4 flex justify-center">
              <div className="w-6 h-6 border-2 border-[#FF9F1C] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : friendsError ? (
            <div className="text-xs font-mono text-[#A89B8C] py-2 flex items-center justify-between">
              <span>{friendsError}</span>
              <button
                type="button"
                onClick={() => refreshFriends()}
                className="text-[#FF9F1C] hover:underline font-bold bg-transparent border-none cursor-pointer text-xs ml-2"
              >
                Retry
              </button>
            </div>
          ) : friends.length === 0 ? (
            <div className="text-xs font-mono text-[#A89B8C] py-3 text-center border border-dashed border-[#2A211B] rounded-xl">
              No friends online yet. Invite friends with room codes!
            </div>
          ) : (
            <div className="space-y-1">
              {friends.map((friend) => {
                const dotColor = STATUS_COLOR[friend.status] || '#5A4A3E';
                const statusLabel = friend.status.charAt(0).toUpperCase() + friend.status.slice(1);
                const isMenuOpen = activeFriendActionMenu === friend.userId;

                return (
                  <div key={friend.userId} className="relative flex items-center gap-3 py-3 border-t border-[#2A211B] first:border-t-0">
                    <span className="relative w-8 h-8 rounded-full bg-[#FF9F1C] text-[#0E0B09] flex items-center justify-center font-bold text-xs flex-shrink-0 select-none">
                      {avatarInitial(friend.displayName)}
                      <span
                        style={{ backgroundColor: dotColor }}
                        className="absolute -right-0.5 -bottom-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#1A1512]"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-[#F3E9DC] truncate">{friend.displayName}</div>
                      <div className="text-xs text-[#A89B8C]">{statusLabel}</div>
                    </div>
                    {friend.roomCode && (
                      <button
                        type="button"
                        onClick={() => router.push(`/room/${friend.roomCode}`)}
                        className="text-xs font-mono text-[#FF9F1C] underline cursor-pointer bg-transparent border-none flex-shrink-0"
                      >
                        Join
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveFriendActionMenu(isMenuOpen ? null : friend.userId)}
                      className="text-[#A89B8C] hover:text-[#F3E9DC] text-xs bg-transparent border-none cursor-pointer px-1"
                    >
                      ⋮
                    </button>

                    {isMenuOpen && (
                      <div className="absolute right-0 top-10 z-20 bg-[#261E19] border border-[#3A2E26] rounded-lg p-1.5 shadow-lg flex flex-col gap-1 min-w-[120px]">
                        <button
                          type="button"
                          onClick={() => handleRemoveFriend(friend.userId)}
                          className="text-left text-xs text-[#A89B8C] hover:text-[#E4572E] px-2.5 py-1.5 rounded hover:bg-[#1A1512] bg-transparent border-none cursor-pointer"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBlockFriend(friend.userId)}
                          className="text-left text-xs text-[#A89B8C] hover:text-[#E4572E] px-2.5 py-1.5 rounded hover:bg-[#1A1512] bg-transparent border-none cursor-pointer"
                        >
                          Block
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Add friend button / form */}
          {!friendModalOpen ? (
            <button
              type="button"
              onClick={() => setFriendModalOpen(true)}
              className="w-full text-center border border-[#3A2E26] hover:border-[#FF9F1C] hover:text-[#FF9F1C] text-[#F3E9DC] rounded-full py-2.5 text-xs font-mono transition-colors cursor-pointer bg-transparent"
            >
              + Add Friend
            </button>
          ) : (
            <div className="flex flex-col gap-1.5 pt-1">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Username"
                  value={friendInput}
                  onChange={(e) => { setFriendInput(e.target.value); setAddFriendError(null); }}
                  autoFocus
                  className="flex-1 bg-[#261E19] border border-[#3A2E26] rounded-full px-3 py-1.5 text-xs text-[#F3E9DC] focus:outline-none focus:border-[#FF9F1C]"
                />
                <button
                  type="button"
                  onClick={handleAddFriend}
                  disabled={addFriendLoading}
                  className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs px-3 py-1.5 rounded-full cursor-pointer border-none disabled:opacity-50"
                >
                  {addFriendLoading ? '…' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => { setFriendModalOpen(false); setFriendInput(''); setAddFriendError(null); }}
                  className="text-[#A89B8C] text-xs cursor-pointer bg-transparent border-none"
                >
                  ✕
                </button>
              </div>
              {addFriendError && <span className="text-xs font-mono text-[#E4572E]">{addFriendError}</span>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
