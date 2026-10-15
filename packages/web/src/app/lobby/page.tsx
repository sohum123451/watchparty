'use client';

/**
 * Cinema Foyer / Lobby Page — Phase 2 & 3
 * Matched to approved Private Cinema reference frame.
 * Tokens: bg #0E0B09, surface #1A1512, surface-2 #261E19, line #3A2E26, text #F3E9DC, muted #A89B8C, amber #FF9F1C, red #E4572E, teal #2EC4B6.
 * Typography: Fraunces (display), DM Sans (UI), JetBrains Mono (codes).
 * Flat colour blocks, no gradients, no emojis.
 */

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

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

interface CatalogueItem {
  id: string;
  title: string;
  accentColor?: string;
  textColor?: string;
  isFree: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACCENT_CYCLE = [
  { bg: '#E4572E', text: '#0E0B09' },
  { bg: '#2EC4B6', text: '#0E0B09' },
  { bg: '#FF9F1C', text: '#0E0B09' },
  { bg: '#F3E9DC', text: '#0E0B09' },
  { bg: '#261E19', text: '#F3E9DC' },
];

function accentForIndex(i: number) {
  return ACCENT_CYCLE[i % ACCENT_CYCLE.length];
}

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

  // Catalogue from server
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);

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

    fetch('/api/friends', { headers, credentials: 'include' })
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
      .catch(() => {
        setFriendsError('Could not load friends.');
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
    fetch('/api/rooms')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (!cancelled && data.rooms) {
          setActiveRooms(data.rooms);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRoomsLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // Fetch movie catalogue
  useEffect(() => {
    let cancelled = false;
    setCatalogueLoading(true);
    setCatalogueError(null);

    fetch('/api/catalogue')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (!cancelled) {
          setCatalogue(
            (data.films || data.items || []).map((item: any, i: number) => ({
              id: item.id,
              title: item.title,
              isFree: item.isFree ?? item.free ?? true,
              accentColor: item.accentColor || ACCENT_CYCLE[i % ACCENT_CYCLE.length].bg,
              textColor: item.textColor || ACCENT_CYCLE[i % ACCENT_CYCLE.length].text,
            }))
          );
        }
      })
      .catch(() => {
        if (!cancelled) setCatalogueError('Could not load catalogue.');
      })
      .finally(() => { if (!cancelled) setCatalogueLoading(false); });

    return () => { cancelled = true; };
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleCreateRoom = async (filmId?: string) => {
    if (isCreating) return;
    setCreateError(null);
    try {
      setIsCreating(true);
      const storedName =
        user?.displayName ||
        (typeof window !== 'undefined' && localStorage.getItem('watchparty_username')) ||
        `Host-${Math.floor(100 + Math.random() * 900)}`;

      const body: Record<string, any> = { hostUserName: storedName };
      if (filmId) body.initialVideoId = filmId;

      const res = await fetch('/api/rooms', {
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
      setCreateError(err.message || 'Failed to create room');
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
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
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

      const res = await fetch('/api/friends/request', {
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
      await fetch(`/api/friends/${encodeURIComponent(friendId)}`, {
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

  const freeCatalogue = catalogue.filter((c) => c.isFree);
  const filteredCatalogue = (searchQuery.trim()
    ? freeCatalogue.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : freeCatalogue
  ).slice(0, 6);

  const featuredFilm = catalogue.find((c) => c.isFree) || null;
  const stackFilms = catalogue.filter((c) => c.isFree && c !== featuredFilm).slice(0, 2);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen box-border bg-[#0E0B09] text-[#F3E9DC] font-ui pb-12">
      {/* HEADER */}
      <header className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 px-6 sm:px-12 md:px-16 py-7">
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
            if (searchQuery.trim().length >= 4) {
              router.push(`/room/${encodeURIComponent(searchQuery.trim().toUpperCase())}`);
            }
          }}
          className="flex-1 max-w-md mx-0 sm:mx-6 flex gap-2"
        >
          <input
            type="text"
            aria-label="Search films or enter room code"
            placeholder="Search films or enter room code…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full box-border bg-[#1A1512] border border-[#3A2E26] rounded-xl px-4 py-3 text-[#F3E9DC] text-base font-ui placeholder-[#A89B8C] focus:outline-none focus:border-[#FF9F1C] transition-colors"
          />
          {searchQuery.trim().length >= 4 && (
            <button
              type="submit"
              className="bg-[#261E19] border border-[#3A2E26] text-[#FF9F1C] px-4 py-2 rounded-xl text-sm font-mono cursor-pointer hover:bg-[#342821] flex-shrink-0"
            >
              Join
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
                className="w-10 h-10 rounded-full bg-[#FF9F1C] flex items-center justify-center font-bold text-[#0E0B09] flex-shrink-0 select-none"
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

      {/* Create-room error */}
      {createError && (
        <div className="mx-6 sm:mx-12 md:mx-16 -mt-3 mb-4 text-xs font-mono text-[#E4572E] bg-[#1A1512] border border-[#E4572E]/30 rounded-lg px-4 py-2">
          {createError}
        </div>
      )}

      {/* MAIN CONTAINER */}
      <div className="flex flex-col lg:flex-row gap-8 px-6 sm:px-12 md:px-16 pt-3">
        {/* Left Column */}
        <div className="flex-1 min-w-0">
          {/* ACTIVE SCREENINGS / LIVE ROOMS (if any active rooms on server) */}
          {activeRooms.length > 0 && (
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-4">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2EC4B6] animate-pulse" />
                <h2 className="m-0 font-display font-semibold text-2xl text-[#F3E9DC]">Active auditories</h2>
                <span className="font-mono text-xs bg-[#261E19] text-[#2EC4B6] border border-[#2EC4B6]/30 px-2.5 py-0.5 rounded-full">
                  {activeRooms.length} live
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {activeRooms.map((r) => (
                  <div
                    key={r.roomCode}
                    onClick={() => router.push(`/room/${r.roomCode}`)}
                    className="bg-[#1A1512] hover:bg-[#261E19] border border-[#3A2E26] hover:border-[#FF9F1C] p-5 rounded-xl flex items-center justify-between cursor-pointer transition-all group"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-display font-semibold text-lg text-[#F3E9DC] group-hover:text-[#FF9F1C] truncate">
                          {r.roomName || `Room #${r.roomCode}`}
                        </h3>
                        <span className="font-mono text-xs bg-[#0E0B09] text-[#A89B8C] px-2 py-0.5 rounded">
                          {r.roomCode}
                        </span>
                      </div>
                      <div className="text-xs text-[#A89B8C] mt-1 flex items-center gap-3">
                        <span>Host: {r.hostUserName}</span>
                        <span>•</span>
                        <span>{r.memberCount} seated</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/room/${r.roomCode}`);
                      }}
                      className="bg-[#261E19] group-hover:bg-[#FF9F1C] text-[#FF9F1C] group-hover:text-[#0E0B09] font-bold text-xs px-4 py-2 rounded-full transition-all border border-[#3A2E26] cursor-pointer"
                    >
                      Enter
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* NOW SHOWING */}
          <div className="flex items-baseline gap-4">
            <h2 className="m-0 font-display font-semibold text-3xl sm:text-[44px] text-[#F3E9DC]">Now showing</h2>
          </div>

          {catalogueLoading ? (
            <div className="mt-5 h-[300px] bg-[#1A1512] rounded-[20px] flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-[#FF9F1C] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : catalogueError ? (
            <div className="mt-5 text-sm text-[#A89B8C] font-mono">{catalogueError}</div>
          ) : catalogue.length === 0 ? (
            <div className="mt-5 text-sm text-[#A89B8C] font-mono">No films in catalogue yet.</div>
          ) : (
            <div className="flex flex-col md:flex-row gap-5 mt-5">
              {/* Hero tile */}
              {featuredFilm && (() => {
                const ac = accentForIndex(0);
                return (
                  <div
                    className="flex-[2] min-h-[280px] sm:h-[300px] box-border rounded-[20px] p-6 sm:p-7 flex flex-col justify-between cursor-pointer hover:brightness-105 transition-all"
                    style={{ backgroundColor: featuredFilm.accentColor || ac.bg, color: featuredFilm.textColor || ac.text }}
                    onClick={() => handleCreateRoom(featuredFilm.id)}
                  >
                    <div className="font-mono text-xs sm:text-[13px] tracking-[0.12em] font-medium opacity-70">FREE</div>
                    <div>
                      <div className="font-display font-semibold text-4xl sm:text-6xl md:text-[68px] leading-[0.98] tracking-[-0.02em] my-3">
                        {featuredFilm.title}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-base font-medium opacity-80">Free library</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleCreateRoom(featuredFilm.id); }}
                          disabled={isCreating}
                          className="bg-[#0E0B09] text-[#F3E9DC] hover:text-[#FF9F1C] font-bold text-sm sm:text-base px-6 py-3 rounded-full transition-colors inline-block cursor-pointer border-none disabled:opacity-50"
                        >
                          Start room
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Stack tiles */}
              <div className="flex-1 flex flex-col gap-5">
                {stackFilms.length === 0 && (
                  <div className="flex-1 bg-[#261E19] rounded-[20px] p-5 flex items-center justify-center text-xs text-[#A89B8C] font-mono">
                    More films coming soon
                  </div>
                )}
                {stackFilms.map((film, i) => {
                  const ac = accentForIndex(i + 1);
                  return (
                    <div
                      key={film.id}
                      onClick={() => handleCreateRoom(film.id)}
                      className="flex-1 bg-[#261E19] hover:bg-[#2F2520] transition-colors rounded-[20px] p-5 flex flex-col justify-between min-h-[135px] cursor-pointer"
                    >
                      <div className="font-mono text-xs tracking-[0.12em]" style={{ color: ac.bg }}>FREE</div>
                      <div className="mt-2 font-display font-semibold text-2xl sm:text-[28px] leading-[1.1] text-[#F3E9DC]">
                        {film.title}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* FREE LIBRARY PICKS */}
          <div className="flex items-center gap-5 mt-10 mb-4">
            <h2 className="m-0 font-display font-semibold text-2xl sm:text-[34px] text-[#F3E9DC]">Free library</h2>
            <span className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-sm px-4 py-2 rounded-full">Free</span>
          </div>

          {catalogueLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-[250px] bg-[#1A1512] rounded-[16px] animate-pulse" />
              ))}
            </div>
          ) : filteredCatalogue.length === 0 ? (
            <div className="text-sm text-[#A89B8C] font-mono">
              {searchQuery ? 'No results found.' : 'No free films yet.'}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {filteredCatalogue.map((item, i) => {
                const ac = accentForIndex(i);
                return (
                  <div
                    key={item.id}
                    onClick={() => handleCreateRoom(item.id)}
                    style={{ backgroundColor: item.accentColor || ac.bg, color: item.textColor || ac.text }}
                    className="h-[250px] box-border rounded-[16px] p-4 flex flex-col justify-end hover:scale-[1.02] active:scale-[0.98] transition-transform cursor-pointer"
                  >
                    <div className="font-display font-semibold text-xl sm:text-[28px] leading-[1.05]">
                      {item.title}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT SIDEBAR: Friends */}
        <aside className="w-full lg:w-[320px] box-border self-start bg-[#1A1512] rounded-[20px] p-6 flex-shrink-0">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="m-0 font-display font-semibold text-2xl sm:text-[28px] text-[#F3E9DC]">Friends</h3>
          </div>

          {/* Join with code */}
          {showJoinInput ? (
            <div className="mb-4">
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
                  className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs px-3 py-2 rounded-full cursor-pointer border-none"
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
              className="w-full mb-4 text-center border-[1.5px] border-[#5A4A3E] hover:border-[#FF9F1C] hover:text-[#FF9F1C] text-[#F3E9DC] rounded-full py-2.5 text-[13px] transition-colors cursor-pointer bg-transparent"
            >
              Join with a code
            </button>
          )}

          {/* Friends list */}
          {friendsLoading ? (
            <div className="py-4 flex justify-center">
              <div className="w-6 h-6 border-2 border-[#FF9F1C] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : friendsError ? (
            <div className="text-xs font-mono text-[#A89B8C] py-2">{friendsError}</div>
          ) : friends.length === 0 ? (
            <div className="text-xs font-mono text-[#A89B8C] py-2">No friends yet. Add one below.</div>
          ) : (
            <div>
              {friends.map((friend, i) => {
                const dotColor = STATUS_COLOR[friend.status] || '#5A4A3E';
                const ac = accentForIndex(i);
                const statusLabel = friend.status.charAt(0).toUpperCase() + friend.status.slice(1);
                const isMenuOpen = activeFriendActionMenu === friend.userId;

                return (
                  <div key={friend.userId} className="relative flex items-center gap-3 py-3.5 border-t border-[#2A211B] first:border-t-0">
                    <span
                      style={{ backgroundColor: ac.bg, color: ac.text }}
                      className="relative w-[38px] h-[38px] rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 select-none"
                    >
                      {avatarInitial(friend.displayName)}
                      <span
                        style={{ backgroundColor: dotColor }}
                        className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full border-2 border-[#1A1512]"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-[15px] text-[#F3E9DC] truncate">{friend.displayName}</div>
                      <div className="text-[13px] text-[#A89B8C]">{statusLabel}</div>
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
                    {/* More actions dropdown button */}
                    <button
                      type="button"
                      onClick={() => setActiveFriendActionMenu(isMenuOpen ? null : friend.userId)}
                      className="text-[#A89B8C] hover:text-[#F3E9DC] text-xs bg-transparent border-none cursor-pointer px-1"
                    >
                      ⋮
                    </button>

                    {isMenuOpen && (
                      <div className="absolute right-0 top-12 z-20 bg-[#261E19] border border-[#3A2E26] rounded-lg p-1.5 shadow-lg flex flex-col gap-1 min-w-[120px]">
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

          {/* Add friend */}
          {!friendModalOpen ? (
            <button
              type="button"
              onClick={() => setFriendModalOpen(true)}
              className="w-full mt-3 text-center border-[1.5px] border-[#5A4A3E] hover:border-[#FF9F1C] hover:text-[#FF9F1C] text-[#F3E9DC] rounded-full py-3 text-[15px] transition-colors cursor-pointer bg-transparent"
            >
              Add friend
            </button>
          ) : (
            <div className="mt-3 flex flex-col gap-1.5">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Username"
                  value={friendInput}
                  onChange={(e) => { setFriendInput(e.target.value); setAddFriendError(null); }}
                  autoFocus
                  className="flex-1 bg-[#261E19] border border-[#3A2E26] rounded-full px-3.5 py-2 text-xs text-[#F3E9DC] focus:outline-none focus:border-[#FF9F1C]"
                />
                <button
                  type="button"
                  onClick={handleAddFriend}
                  disabled={addFriendLoading}
                  className="bg-[#FF9F1C] text-[#0E0B09] font-bold text-xs px-3 py-2 rounded-full cursor-pointer border-none disabled:opacity-50"
                >
                  {addFriendLoading ? '…' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => { setFriendModalOpen(false); setFriendInput(''); setAddFriendError(null); }}
                  className="text-[#A89B8C] text-xs cursor-pointer bg-transparent border-none"
                >
                  Cancel
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
