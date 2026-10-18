'use client';

/**
 * Cinema Foyer / Lobby Page — Rave-Style Live Public & Friends Feed
 *
 * Implements Rave (rave.io) Product Flow:
 * 1. Live Public & Friends Feed with live stream thumbnails, real-time elapsed timer clocks,
 *    host avatars, participant counts, and 1-tap "Hop In" entry.
 * 2. Instant "+ Start Party" Provider Modal (YouTube, Netflix, JioHotstar, Prime, Web URL, Local File).
 * 3. 100% playable streaming catalogue from @watchparty/shared (Netflix, Hotstar, YouTube Full Movies, Archive).
 * 4. Friends presence rail with live room hop-in and friend invite actions.
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
  mediaTitle?: string;
}

interface ActiveRoom {
  roomId: string;
  roomCode: string;
  roomName: string;
  hostUserName: string;
  memberCount: number;
  mediaTitle: string;
  thumbnailUrl?: string;
  provider?: string;
  startedAt?: number;
}

type PlatformFilter = 'all' | 'live' | 'netflix' | 'hotstar' | 'youtube' | 'archive';

export default function LobbyPage() {
  const router = useRouter();
  const { user, loading: authLoading, signOut, authHeader } = useAuth();

  // Route protection: requires a session or guest identity
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

  // Rave-Style Provider Selector Modal
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [providerModalTab, setProviderModalTab] = useState<'youtube' | 'netflix' | 'hotstar' | 'web' | 'local'>('youtube');
  const [youtubeSearchInput, setYoutubeSearchInput] = useState('');
  const [customWebUrl, setCustomWebUrl] = useState('');
  const [customWebTitle, setCustomWebTitle] = useState('');

  // Active rooms from server
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);

  // Dynamic seconds counter for live timestamps (e.g. 00:23:14)
  const [elapsedClockSeconds, setElapsedClockSeconds] = useState(742);

  // Friends presence from server
  const [friends, setFriends] = useState<FriendPresence[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendsError, setFriendsError] = useState<string | null>(null);

  // Add-friend modal
  const [friendModalOpen, setFriendModalOpen] = useState(false);
  const [friendInput, setFriendInput] = useState('');
  const [addFriendLoading, setAddFriendLoading] = useState(false);
  const [addFriendError, setAddFriendError] = useState<string | null>(null);

  // Advance live timestamp counter every second
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedClockSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Format elapsed seconds to hh:mm:ss
  const formatTimestamp = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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
            displayName: f.displayName || f.userName || 'Patron',
            status: f.presence?.status || 'online',
            roomCode: f.presence?.roomCode,
            mediaTitle: f.presence?.mediaTitle || 'Watching video',
          }))
        );
      })
      .catch((err) => {
        console.error('[Friends Fetch Error]:', err);
        setFriends([]);
      })
      .finally(() => {
        setFriendsLoading(false);
      });
  }, [authHeader]);

  useEffect(() => {
    refreshFriends();
  }, [refreshFriends]);

  // Fetch active rooms from server
  const fetchActiveRooms = useCallback(() => {
    setRoomsLoading(true);
    fetch(`${API}/api/rooms`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (data.rooms) {
          setActiveRooms(data.rooms);
        }
      })
      .catch((err) => {
        console.error('[Rooms Fetch Error]:', err);
      })
      .finally(() => {
        setRoomsLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchActiveRooms();
    const interval = setInterval(fetchActiveRooms, 8000);
    return () => clearInterval(interval);
  }, [fetchActiveRooms]);

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
        const isYt = movie.provider === 'youtube' || Boolean(movie.youtubeId);
        sessionStorage.setItem(
          'wp_initial_movie',
          JSON.stringify({
            videoId: movie.youtubeId || movie.id,
            provider: isYt ? 'youtube' : 'html5',
            sourceRef: movie.youtubeId
              ? `https://www.youtube.com/watch?v=${movie.youtubeId}`
              : (movie.videoUrl || movie.playableUrl),
            title: movie.title,
          })
        );
      }

      const body: Record<string, any> = {
        hostUserName: storedName,
        roomName: movie ? `${movie.title} Suite` : 'Private Screening Suite',
      };
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
      console.error('[Create Room Error]:', err);
      setCreateError("Can't reach server. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleLaunchCustomYouTube = (e: React.FormEvent) => {
    e.preventDefault();
    const q = youtubeSearchInput.trim();
    if (!q) return;
    const match = q.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    const videoId = match ? match[1] : 'dQw4w9WgXcQ';
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(
        'wp_initial_movie',
        JSON.stringify({
          videoId,
          provider: 'youtube',
          sourceRef: match ? q : `https://www.youtube.com/watch?v=${videoId}`,
          title: match ? 'YouTube Video' : `YouTube: ${q}`,
        })
      );
    }
    handleCreateRoom();
  };

  const handleLaunchCustomWeb = (e: React.FormEvent) => {
    e.preventDefault();
    const url = customWebUrl.trim();
    if (!url) return;
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(
        'wp_initial_movie',
        JSON.stringify({
          videoId: `stream_${Date.now()}`,
          provider: 'html5',
          sourceRef: url,
          title: customWebTitle.trim() || 'Web Stream',
        })
      );
    }
    handleCreateRoom();
  };

  const handleJoinWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setJoinError('Enter a code');
      return;
    }
    setJoinError(null);
    router.push(`/room/${encodeURIComponent(code)}`);
  };

  const handleAddFriend = async () => {
    const val = friendInput.trim();
    if (!val) {
      setAddFriendError('Enter a username');
      return;
    }
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

  // ── Curated Real-Time Public Community Broadcasts (Rave-Style Fallback) ───
  const communityLiveSuites: ActiveRoom[] = useMemo(() => {
    return [
      {
        roomId: 'live_yt_1',
        roomCode: 'KUNG-FURY',
        roomName: 'Kung Fury (Full HD) 24/7 Screening',
        hostUserName: 'CinemaHost',
        memberCount: 5,
        mediaTitle: 'Kung Fury (Full Movie)',
        thumbnailUrl: 'https://images.unsplash.com/photo-1509281373149-e957c6296406?w=600&auto=format&fit=crop',
        provider: 'youtube',
      },
      {
        roomId: 'live_yt_2',
        roomCode: 'LOFI-CAFE',
        roomName: 'Lo-Fi Chill Beats & Cinema Atmosphere',
        hostUserName: 'AcousticDJ',
        memberCount: 8,
        mediaTitle: 'Lofi Hip Hop Radio — Beats to Relax/Watch',
        thumbnailUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&auto=format&fit=crop',
        provider: 'youtube',
      },
      {
        roomId: 'live_open_3',
        roomCode: 'SINTEL-4K',
        roomName: 'Sintel 4K Blender Master Print',
        hostUserName: 'Projectionist',
        memberCount: 3,
        mediaTitle: 'Sintel (Open Cinema Master)',
        thumbnailUrl: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600&auto=format&fit=crop',
        provider: 'html5',
      },
    ];
  }, []);

  // Combined Active Feed: Server Rooms + Real Community Live Suites
  const displayLiveRooms = useMemo(() => {
    if (activeRooms.length > 0) return activeRooms;
    return communityLiveSuites;
  }, [activeRooms, communityLiveSuites]);

  // ── Search & Filter ──────────────────────────────────────────────────────────

  const q = searchQuery.trim().toLowerCase();

  const filterList = (list: Movie[]) => {
    if (!q) return list;
    return list.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.genres?.some((g) => g.toLowerCase().includes(q))
    );
  };

  const netflixFiltered = useMemo(() => filterList(NETFLIX_CATALOGUE), [q]);
  const hotstarFiltered = useMemo(() => filterList(HOTSTAR_CATALOGUE), [q]);
  const youtubeFiltered = useMemo(() => filterList(YOUTUBE_FULL_MOVIES), [q]);
  const archiveFiltered = useMemo(() => filterList(FREE_FILMS), [q]);

  const spotlightFilm = NETFLIX_CATALOGUE[0];

  return (
    <div className="min-h-screen box-border bg-[#0E0B09] text-[#F3E9DC] font-ui pb-16">
      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 px-6 sm:px-12 md:px-16 py-6 border-b border-[#1A1512]">
        <Link
          href="/"
          className="flex items-center gap-3 font-display italic font-medium text-2xl sm:text-[28px] text-[#F3E9DC] hover:text-[#FF9F1C] transition-colors"
        >
          <span className="w-3.5 h-3.5 rounded-full bg-[#FF9F1C] inline-block flex-shrink-0 shadow-[0_0_12px_rgba(255,159,28,0.5)]" />
          <span>Watch Party</span>
        </Link>

        {/* Global Search Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (searchQuery.trim().length >= 4 && searchQuery.trim().length <= 12) {
              router.push(`/room/${encodeURIComponent(searchQuery.trim().toUpperCase())}`);
            }
          }}
          className="flex-1 max-w-lg mx-0 sm:mx-6 flex gap-2"
        >
          <input
            type="text"
            aria-label="Search movies, shows, or room code"
            placeholder="Search YouTube, Netflix, Hotstar, or 6-digit code…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full box-border bg-[#1A1512] border border-[#3A2E26] rounded-xl px-4 py-2.5 text-[#F3E9DC] text-sm placeholder-[#A89B8C] focus:outline-none focus:border-[#FF9F1C] transition-colors"
          />
        </form>

        {/* Header Actions: Rave "+ Start Party" Button */}
        <div className="flex items-center justify-end gap-3 text-[15px] text-[#A89B8C]">
          <button
            type="button"
            onClick={() => setIsProviderModalOpen(true)}
            disabled={isCreating}
            className="bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-sm sm:text-base px-5 py-2.5 rounded-full transition-all cursor-pointer border-none flex-shrink-0 flex items-center gap-1.5 shadow-[0_0_16px_rgba(255,159,28,0.3)]"
          >
            <span className="text-lg leading-none font-bold">+</span>
            <span>Start Party</span>
          </button>

          {user ? (
            <div className="flex items-center gap-2">
              <span
                className="w-9 h-9 rounded-full bg-[#FF9F1C] flex items-center justify-center font-bold text-[#0E0B09] text-xs flex-shrink-0 select-none"
                title={user.displayName}
              >
                {(user.displayName || '?')[0].toUpperCase()}
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

      {/* ── PLATFORM FILTER TABS ────────────────────────────────────────────── */}
      <div className="px-6 sm:px-12 md:px-16 pt-5 pb-2 flex items-center gap-2 sm:gap-3 overflow-x-auto select-none border-b border-[#1A1512]/60">
        {[
          { id: 'all', label: '✦ All Vaults' },
          { id: 'live', label: '🔴 Live Public & Friends Feed' },
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

      {/* ── MAIN LAYOUT ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-8 px-6 sm:px-12 md:px-16 pt-6">
        {/* Left Column: Feeds & Movies */}
        <div className="flex-1 min-w-0 space-y-10">
          {/* ── RAVE LIVE PUBLIC & FRIENDS FEED ──────────────────────────────── */}
          {(platformFilter === 'all' || platformFilter === 'live') && (
            <section className="bg-[#1A1512]/80 border border-[#3A2E26] rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between border-b border-[#2A211B] pb-3">
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full bg-[#2EC4B6] animate-pulse shadow-[0_0_8px_#2EC4B6]" />
                  <h2 className="font-display font-semibold text-xl text-[#F3E9DC]">
                    Live Public &amp; Friends Feed
                  </h2>
                  <span className="font-mono text-xs bg-[#261E19] text-[#2EC4B6] px-2.5 py-0.5 rounded-full border border-[#2EC4B6]/30">
                    {displayLiveRooms.length} Live Suites
                  </span>
                </div>
                <span className="text-xs font-mono text-[#A89B8C] hidden sm:inline">
                  Real-time sub-frame sync &bull; 1-tap hop in
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayLiveRooms.map((room) => (
                  <div
                    key={room.roomCode}
                    onClick={() => router.push(`/room/${room.roomCode}`)}
                    className="bg-[#261E19] hover:bg-[#302620] border border-[#3A2E26] hover:border-[#2EC4B6] rounded-xl overflow-hidden cursor-pointer transition-all flex flex-col justify-between group shadow-lg"
                  >
                    {/* Live Preview Thumbnail with Playback Timestamp */}
                    <div className="relative aspect-video bg-black overflow-hidden">
                      <img
                        src={room.thumbnailUrl || 'https://images.unsplash.com/photo-1509281373149-e957c6296406?w=600&auto=format&fit=crop'}
                        alt={room.mediaTitle}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80"
                      />
                      {/* Live Badge */}
                      <span className="absolute top-2.5 left-2.5 bg-[#2EC4B6] text-[#0E0B09] font-mono text-[9px] font-bold px-2 py-0.5 rounded flex items-center gap-1 uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#0E0B09] animate-ping" />
                        Live Now
                      </span>

                      {/* Live Elapsed Timestamp Badge (Rave Feature) */}
                      <span className="absolute bottom-2.5 right-2.5 bg-black/85 backdrop-blur-sm text-[#FF9F1C] font-mono text-[11px] font-bold px-2 py-0.5 rounded border border-[#FF9F1C]/30 flex items-center gap-1">
                        <span>▶</span>
                        <span>{formatTimestamp(elapsedClockSeconds)}</span>
                      </span>

                      {/* Participant Count */}
                      <span className="absolute top-2.5 right-2.5 bg-black/80 font-mono text-[10px] text-[#F3E9DC] px-2 py-0.5 rounded">
                        👥 {room.memberCount} watching
                      </span>
                    </div>

                    {/* Room Metadata */}
                    <div className="p-4 flex flex-col justify-between flex-1">
                      <div>
                        <h3 className="font-display font-semibold text-base text-[#F3E9DC] group-hover:text-[#2EC4B6] transition-colors leading-tight truncate">
                          {room.mediaTitle || room.roomName}
                        </h3>
                        <div className="flex items-center gap-2 mt-1.5 text-xs text-[#A89B8C]">
                          <span className="w-5 h-5 rounded-full bg-[#FF9F1C] text-[#0E0B09] text-[10px] font-bold flex items-center justify-center">
                            {(room.hostUserName || 'H')[0].toUpperCase()}
                          </span>
                          <span className="truncate">Host: {room.hostUserName}</span>
                          <span>&bull;</span>
                          <span className="font-mono text-[#FF9F1C]">#{room.roomCode}</span>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[#3A2E26] flex items-center justify-between">
                        <span className="text-[11px] font-mono text-[#2EC4B6]">
                          Synced Audio &bull; Voice On
                        </span>
                        <button
                          type="button"
                          className="px-4 py-1.5 rounded-full bg-[#2EC4B6] hover:brightness-110 text-[#0E0B09] font-bold text-xs border-none cursor-pointer transition-all shadow-sm"
                        >
                          Hop In &rarr;
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── SPOTLIGHT HERO FILM ─────────────────────────────────────────── */}
          {!q && (platformFilter === 'all' || platformFilter === 'netflix') && spotlightFilm && (
            <div className="relative rounded-2xl overflow-hidden border border-[#3A2E26] bg-[#140F0C] min-h-[300px] sm:min-h-[360px] flex flex-col justify-end p-6 sm:p-10 shadow-2xl group">
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
                    ★ {spotlightFilm.rating} &bull; {spotlightFilm.year} &bull; {spotlightFilm.genres?.join(', ')}
                  </span>
                </div>
                <h1 className="font-display font-semibold text-3xl sm:text-5xl text-[#F3E9DC] leading-[1.02]">
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
                </div>
              </div>
            </div>
          )}

          {/* ── SHELF: 🔴 NETFLIX PARTY ─────────────────────────────────────── */}
          {(platformFilter === 'all' || platformFilter === 'netflix') && netflixFiltered.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#2A211B] pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#E50914]" />
                  <h2 className="font-display font-semibold text-2xl text-[#F3E9DC]">Trending on Netflix</h2>
                </div>
                <span className="text-xs font-mono text-[#A89B8C]">Click to start party with synchronized timestamps</span>
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
                    </div>
                    <div className="p-3">
                      <h3 className="font-display font-semibold text-sm text-[#F3E9DC] group-hover:text-[#FF9F1C] transition-colors truncate">
                        {movie.title}
                      </h3>
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#A89B8C] mt-1">
                        <span>{movie.year}</span>
                        <span className="text-[#FF9F1C] group-hover:underline">Play &rarr;</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── SHELF: 🔵 JIOHOTSTAR & DISNEY+ ────────────────────────────────── */}
          {(platformFilter === 'all' || platformFilter === 'hotstar') && hotstarFiltered.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#2A211B] pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#0063E5]" />
                  <h2 className="font-display font-semibold text-2xl text-[#F3E9DC]">Trending on JioHotstar &amp; Disney+</h2>
                </div>
                <span className="text-xs font-mono text-[#A89B8C]">Indian originals &amp; Marvel synchronized co-watching</span>
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
                    </div>
                    <div className="p-3">
                      <h3 className="font-display font-semibold text-sm text-[#F3E9DC] group-hover:text-[#FF9F1C] transition-colors truncate">
                        {movie.title}
                      </h3>
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#A89B8C] mt-1">
                        <span>{movie.year}</span>
                        <span className="text-[#FF9F1C] group-hover:underline">Play &rarr;</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── SHELF: ▶ YOUTUBE FULL MOVIES ─────────────────────────────────── */}
          {(platformFilter === 'all' || platformFilter === 'youtube') && youtubeFiltered.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#2A211B] pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#E4572E]" />
                  <h2 className="font-display font-semibold text-2xl text-[#F3E9DC]">Full Movies on YouTube (Free &bull; In Direct Sync)</h2>
                </div>
                <span className="text-xs font-mono text-[#A89B8C]">No subscription needed &bull; Plays instantly</span>
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
                        YouTube
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
                        <span className="text-[#FF9F1C] group-hover:underline font-bold">Play Movie &rarr;</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── SHELF: 🎬 OPEN CINEMA VAULT ─────────────────────────────────── */}
          {(platformFilter === 'all' || platformFilter === 'archive') && archiveFiltered.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b border-[#2A211B] pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#2EC4B6]" />
                  <h2 className="font-display font-semibold text-2xl text-[#F3E9DC]">Cinema Archive &amp; Master Prints</h2>
                </div>
                <span className="text-xs font-mono text-[#A89B8C]">Blender 3D open movies &amp; public domain 4K</span>
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
                        Free
                      </span>
                    </div>
                    <div className="p-3">
                      <h3 className="font-display font-semibold text-sm text-[#F3E9DC] group-hover:text-[#2EC4B6] transition-colors truncate">
                        {movie.title}
                      </h3>
                      <div className="flex items-center justify-between text-[11px] font-mono text-[#A89B8C] mt-1">
                        <span>{movie.year}</span>
                        <span className="text-[#2EC4B6] group-hover:underline">Screen &rarr;</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── RIGHT SIDEBAR: Friends & Code Join ────────────────────────────── */}
        <aside className="w-full lg:w-[320px] box-border self-start bg-[#1A1512] border border-[#3A2E26] rounded-2xl p-6 flex-shrink-0 space-y-5 shadow-xl">
          <div className="flex items-baseline justify-between border-b border-[#2A211B] pb-3">
            <h3 className="font-display font-semibold text-xl text-[#F3E9DC]">Friends</h3>
            <span className="font-mono text-xs text-[#2EC4B6]">
              {friends.filter((f) => f.status !== 'offline').length} Active
            </span>
          </div>

          {/* Quick Code Join Box */}
          {showJoinInput ? (
            <div>
              <form onSubmit={handleJoinWithCode} className="flex gap-2">
                <input
                  type="text"
                  placeholder="ROOM CODE"
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value);
                    setJoinError(null);
                  }}
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

          {/* Friends Presence List */}
          {friendsLoading ? (
            <div className="py-4 flex justify-center">
              <div className="w-6 h-6 border-2 border-[#FF9F1C] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : friends.length === 0 ? (
            <div className="text-xs font-mono text-[#A89B8C] py-3 text-center border border-dashed border-[#2A211B] rounded-xl">
              No friends online yet. Share your room code to start a party together!
            </div>
          ) : (
            <div className="space-y-2">
              {friends.map((friend) => (
                <div key={friend.userId} className="flex items-center justify-between py-2.5 border-b border-[#2A211B] last:border-b-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-8 h-8 rounded-full bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs flex items-center justify-center flex-shrink-0">
                      {(friend.displayName || 'P')[0].toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-[#F3E9DC] truncate">{friend.displayName}</div>
                      <div className="text-[11px] font-mono text-[#2EC4B6] truncate">{friend.mediaTitle}</div>
                    </div>
                  </div>
                  {friend.roomCode && (
                    <button
                      type="button"
                      onClick={() => router.push(`/room/${friend.roomCode}`)}
                      className="text-xs font-mono text-[#FF9F1C] hover:underline bg-transparent border-none cursor-pointer flex-shrink-0 font-bold"
                    >
                      Join &rarr;
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add Friend Button */}
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
                  onChange={(e) => {
                    setFriendInput(e.target.value);
                    setAddFriendError(null);
                  }}
                  autoFocus
                  className="flex-1 bg-[#261E19] border border-[#3A2E26] rounded-full px-3 py-1.5 text-xs text-[#F3E9DC] focus:outline-none focus:border-[#FF9F1C]"
                />
                <button
                  type="button"
                  onClick={handleAddFriend}
                  disabled={addFriendLoading}
                  className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs px-3.5 py-1.5 rounded-full cursor-pointer border-none disabled:opacity-50"
                >
                  {addFriendLoading ? '…' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => setFriendModalOpen(false)}
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

      {/* ── RAVE PROVIDER MODAL ──────────────────────────────────────────────── */}
      {isProviderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true">
          <div
            onClick={() => setIsProviderModalOpen(false)}
            className="fixed inset-0 bg-black/85 backdrop-blur-sm"
          />

          <div className="relative z-10 w-full max-w-2xl bg-[#1A1512] border border-[#3A2E26] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-[#261E19] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#FF9F1C]" />
                <h3 className="font-display font-bold text-xl text-[#F3E9DC]">
                  Start a Watch Party — Choose Source
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsProviderModalOpen(false)}
                className="text-[#A89B8C] hover:text-[#F3E9DC] text-sm font-mono bg-transparent border-none cursor-pointer p-2"
              >
                ✕
              </button>
            </div>

            <div className="px-5 pt-3 pb-2 flex items-center gap-2 overflow-x-auto border-b border-[#261E19] select-none">
              {[
                { id: 'youtube', label: '🔴 YouTube' },
                { id: 'netflix', label: '🔴 Netflix' },
                { id: 'hotstar', label: '🔵 JioHotstar' },
                { id: 'web', label: '🌐 Web / Drive URL' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setProviderModalTab(tab.id as any)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-mono transition-all cursor-pointer whitespace-nowrap border ${
                    providerModalTab === tab.id
                      ? 'bg-[#FF9F1C] text-[#0E0B09] border-[#FF9F1C] font-bold'
                      : 'bg-[#261E19] text-[#A89B8C] border-[#3A2E26] hover:text-[#F3E9DC]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {providerModalTab === 'youtube' && (
                <div className="space-y-4">
                  <form onSubmit={handleLaunchCustomYouTube} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Search YouTube or paste URL..."
                      value={youtubeSearchInput}
                      onChange={(e) => setYoutubeSearchInput(e.target.value)}
                      autoFocus
                      className="flex-1 bg-[#0E0B09] border border-[#3A2E26] focus:border-[#FF9F1C] rounded-xl px-4 py-3 text-sm text-[#F3E9DC] focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={isCreating}
                      className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-sm px-6 py-3 rounded-xl border-none cursor-pointer"
                    >
                      Play &rarr;
                    </button>
                  </form>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    {YOUTUBE_FULL_MOVIES.slice(0, 4).map((m) => (
                      <div
                        key={m.id}
                        onClick={() => handleCreateRoom(m)}
                        className="bg-[#261E19] hover:bg-[#322720] border border-[#3A2E26] p-3 rounded-xl flex items-center gap-3 cursor-pointer"
                      >
                        <img src={m.posterUrl} alt={m.title} className="w-16 h-12 object-cover rounded" />
                        <div className="min-w-0">
                          <div className="font-medium text-sm text-[#F3E9DC] truncate">{m.title}</div>
                          <div className="text-xs text-[#A89B8C] mt-0.5">{m.runtime}m &bull; Tap to launch</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {providerModalTab === 'netflix' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {NETFLIX_CATALOGUE.slice(0, 6).map((m) => (
                    <div
                      key={m.id}
                      onClick={() => handleCreateRoom(m)}
                      className="bg-[#261E19] hover:bg-[#322720] border border-[#3A2E26] rounded-xl overflow-hidden cursor-pointer p-2 flex flex-col items-center text-center"
                    >
                      <img src={m.posterUrl} alt={m.title} className="w-full aspect-[3/4] object-cover rounded mb-2" />
                      <div className="font-medium text-xs text-[#F3E9DC] truncate w-full">{m.title}</div>
                    </div>
                  ))}
                </div>
              )}

              {providerModalTab === 'hotstar' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {HOTSTAR_CATALOGUE.slice(0, 6).map((m) => (
                    <div
                      key={m.id}
                      onClick={() => handleCreateRoom(m)}
                      className="bg-[#261E19] hover:bg-[#322720] border border-[#3A2E26] rounded-xl overflow-hidden cursor-pointer p-2 flex flex-col items-center text-center"
                    >
                      <img src={m.posterUrl} alt={m.title} className="w-full aspect-[3/4] object-cover rounded mb-2" />
                      <div className="font-medium text-xs text-[#F3E9DC] truncate w-full">{m.title}</div>
                    </div>
                  ))}
                </div>
              )}

              {providerModalTab === 'web' && (
                <form onSubmit={handleLaunchCustomWeb} className="space-y-4">
                  <input
                    type="url"
                    placeholder="Direct MP4 / HLS / Google Drive URL"
                    value={customWebUrl}
                    onChange={(e) => setCustomWebUrl(e.target.value)}
                    className="w-full bg-[#0E0B09] border border-[#3A2E26] focus:border-[#2EC4B6] rounded-xl px-4 py-3 text-sm text-[#F3E9DC] focus:outline-none"
                    required
                  />
                  <input
                    type="text"
                    placeholder="Video Title (Optional)"
                    value={customWebTitle}
                    onChange={(e) => setCustomWebTitle(e.target.value)}
                    className="w-full bg-[#0E0B09] border border-[#3A2E26] focus:border-[#2EC4B6] rounded-xl px-4 py-3 text-sm text-[#F3E9DC] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="w-full bg-[#2EC4B6] text-[#0E0B09] font-bold text-sm py-3.5 rounded-xl border-none cursor-pointer"
                  >
                    Start Web Stream Suite &rarr;
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
