'use client';

/**
 * TheatreAuditorium Component
 * Fully connected real-time theatre auditorium:
 * 1. Loads real room by code from server; shows "Room not found" if missing.
 * 2. Connected to WebSocket: title, real room code, presence seats, cathode speaking rings.
 * 3. HTML5 synchronized video player with play/pause/seek sync and real drift indicator.
 * 4. Real chat, playlist queue, audience polls, and dynamic reaction heat track.
 * 5. Fixed layout: seats spaced evenly, pinned chat input, aligned reaction chip, no empty dead space.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  MOVIE_CATALOGUE,
  PlaylistItem,
  PollSummary,
  MemberPublicInfo,
  ReactionBurst,
} from '@watchparty/shared';
import { ReactionParticleOverlay } from './ReactionParticleOverlay';
import { TheatreSidebar, ChatEntry } from './TheatreSidebar';

export interface TheatreAuditoriumProps {
  roomCode: string;
  className?: string;
}

const AVATAR_PALETTE = [
  { bg: '#E4572E', text: '#0E0B09', nameColor: '#E4572E' },
  { bg: '#FF9F1C', text: '#0E0B09', nameColor: '#FF9F1C' },
  { bg: '#2EC4B6', text: '#0E0B09', nameColor: '#2EC4B6' },
  { bg: '#F3E9DC', text: '#0E0B09', nameColor: '#F3E9DC' },
  { bg: '#DDA15E', text: '#0E0B09', nameColor: '#DDA15E' },
  { bg: '#BC6C25', text: '#F3E9DC', nameColor: '#BC6C25' },
];

function getMemberPalette(userId?: string) {
  if (!userId) return AVATAR_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export function TheatreAuditorium({
  roomCode,
  className = '',
}: TheatreAuditoriumProps) {
  const [roomStatus, setRoomStatus] = useState<'loading' | 'not_found' | 'connected' | 'error'>('loading');
  const [roomTitle, setRoomTitle] = useState('');
  const [selfUserId, setSelfUserId] = useState('');
  const [members, setMembers] = useState<MemberPublicInfo[]>([]);
  const [speakingMap, setSpeakingMap] = useState<Record<string, boolean>>({});

  // Video & Playback state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoSrc, setVideoSrc] = useState(
    MOVIE_CATALOGUE[0]?.videoUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
  );
  const [videoTitle, setVideoTitle] = useState('Big Buck Bunny');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [driftMs, setDriftMs] = useState(0);
  const [showSyncDiagnostics, setShowSyncDiagnostics] = useState(false);

  // Social state: chat, reactions, queue, polls
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const [reactions, setReactions] = useState<ReactionBurst[]>([]);
  const [reactionCount, setReactionCount] = useState(0);
  const [queue, setQueue] = useState<PlaylistItem[]>([]);
  const [activePoll, setActivePoll] = useState<PollSummary | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  // Internal refs
  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(1);
  const clockOffsetRef = useRef(0);
  const seatRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const playbackRef = useRef<any>(null);

  const nextSeq = () => ++seqRef.current;

  const sendWs = useCallback((msg: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  // 1. Initial room verification via REST endpoint
  useEffect(() => {
    let cancelled = false;

    async function checkRoom() {
      if (!roomCode) {
        setRoomStatus('not_found');
        return;
      }

      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}`);
        if (cancelled) return;
        if (!res.ok) {
          setRoomStatus('not_found');
          return;
        }
        const data = await res.json();
        if (!data.exists) {
          setRoomStatus('not_found');
          return;
        }
        setRoomTitle(data.roomName || `Room ${roomCode}`);
      } catch (err) {
        if (!cancelled) setRoomStatus('not_found');
      }
    }

    checkRoom();
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  // 2. Connect to WebSocket when room exists
  useEffect(() => {
    if (roomStatus === 'not_found' || !roomCode) return;

    const envWsUrl = process.env.NEXT_PUBLIC_WS_URL;
    let wsUrl: string;
    if (envWsUrl) {
      wsUrl = envWsUrl.startsWith('ws://') || envWsUrl.startsWith('wss://')
        ? envWsUrl
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${envWsUrl}`;
    } else {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.port === '3000' ? `${window.location.hostname}:3001` : window.location.host;
      wsUrl = `${wsProtocol}//${wsHost}`;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Retrieve or generate stored username
    const storedName =
      (typeof window !== 'undefined' && localStorage.getItem('watchparty_username')) ||
      `Patron-${Math.floor(100 + Math.random() * 900)}`;
    if (typeof window !== 'undefined') {
      localStorage.setItem('watchparty_username', storedName);
    }

    const sessionToken =
      typeof window !== 'undefined'
        ? sessionStorage.getItem('wp_token_' + roomCode) || undefined
        : undefined;

    ws.onerror = (e) => console.error('[Auditorium WS error]', e);
    ws.onclose = (e) => console.log('[Auditorium WS close]', e.code, e.reason);

    ws.onopen = () => {
      console.log('[Auditorium WS open] sending ROOM_JOIN for', roomCode, storedName);
      if (isUnmounted) return;
      // Join Room
      ws.send(
        JSON.stringify({
          type: 'ROOM_JOIN',
          clientSeq: nextSeq(),
          payload: {
            roomCode,
            userName: storedName,
            reconnectToken: sessionToken,
            sessionToken,
          },
        })
      );
    };

    // NTP ping interval
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'SYNC_PING',
            payload: { clientSendTimeMs: Date.now() },
          })
        );
      }
    }, 5000);

    ws.onmessage = (event) => {
      if (isUnmounted) return;
      try {
        const msg = JSON.parse(event.data);
        console.log('[Auditorium WS msg]', msg.type);

        switch (msg.type) {
          case 'ERROR': {
            if (msg.code === 'ROOM_NOT_FOUND') {
              setRoomStatus('not_found');
            }
            break;
          }

          case 'SYNC_PONG': {
            const now = Date.now();
            const rtt = now - msg.payload.clientSendTimeMs;
            const offset =
              (msg.payload.serverReceiveTimeMs -
                msg.payload.clientSendTimeMs +
                (msg.payload.serverSendTimeMs - now)) /
              2;
            clockOffsetRef.current = offset;
            break;
          }

          case 'ROOM_SNAPSHOT': {
            const snap = msg.payload;
            if (snap.reconnectToken && typeof window !== 'undefined') {
              sessionStorage.setItem('wp_token_' + roomCode, snap.reconnectToken);
            }
            setRoomStatus('connected');
            setRoomTitle(snap.roomName);
            setSelfUserId(snap.selfUserId);
            setMembers(snap.members || []);
            setQueue(snap.playlist || []);
            setActivePoll(snap.activePoll || null);
            setReactionCount(snap.storedReactions?.length || 0);
            setReactions(snap.storedReactions || []);

            // Hydrate chat messages
            if (snap.chatHistory && Array.isArray(snap.chatHistory)) {
              setChatMessages(
                snap.chatHistory.map((m: any) => ({
                  id: m.id,
                  senderName: m.userName || 'Member',
                  senderColor: getMemberPalette(m.userId).nameColor,
                  text: m.text,
                }))
              );
            }

            // Hydrate playback
            if (snap.playback) {
              playbackRef.current = snap.playback;
              const matchedMovie = MOVIE_CATALOGUE.find((m) => m.id === snap.playback.videoId);
              if (matchedMovie?.videoUrl) {
                setVideoSrc(matchedMovie.videoUrl);
              } else if (snap.playback.sourceRef) {
                setVideoSrc(snap.playback.sourceRef);
              }
              setVideoTitle(snap.playback.title || matchedMovie?.title || 'Film Screening');

              if (videoRef.current) {
                const targetSec = snap.playback.positionMs / 1000;
                if (snap.playback.status === 'playing') {
                  const serverNow = Date.now() + clockOffsetRef.current;
                  const elapsed = Math.max(0, (serverNow - snap.playback.serverTimeMs) / 1000);
                  const currentSec = targetSec + elapsed * (snap.playback.playbackRate || 1.0);
                  videoRef.current.currentTime = currentSec;
                  videoRef.current.play().catch(() => {});
                  setIsPlaying(true);
                } else {
                  videoRef.current.currentTime = targetSec;
                  videoRef.current.pause();
                  setIsPlaying(false);
                }
              }
            }
            break;
          }

          case 'PLAYBACK_UPDATE': {
            const pb = msg.payload.playback;
            playbackRef.current = pb;

            const matchedMovie = MOVIE_CATALOGUE.find((m) => m.id === pb.videoId);
            if (matchedMovie?.videoUrl) {
              setVideoSrc(matchedMovie.videoUrl);
            } else if (pb.sourceRef) {
              setVideoSrc(pb.sourceRef);
            }
            if (pb.title || matchedMovie?.title) {
              setVideoTitle(pb.title || matchedMovie?.title);
            }

            if (videoRef.current) {
              if (pb.status === 'playing') {
                const serverNow = Date.now() + clockOffsetRef.current;
                const elapsed = Math.max(0, (serverNow - pb.serverTimeMs) / 1000);
                const targetSec = pb.positionMs / 1000 + elapsed * (pb.playbackRate || 1.0);
                const diff = Math.abs(videoRef.current.currentTime - targetSec);
                if (diff > 0.4 || videoRef.current.paused) {
                  videoRef.current.currentTime = targetSec;
                }
                videoRef.current.play().catch(() => {});
                setIsPlaying(true);
              } else if (pb.status === 'paused') {
                videoRef.current.currentTime = pb.positionMs / 1000;
                videoRef.current.pause();
                setIsPlaying(false);
              }
            }
            break;
          }

          case 'ROOM_MEMBER_JOINED': {
            setMembers((prev) => {
              const existingIdx = prev.findIndex((m) => m.userId === msg.payload.member.userId);
              if (existingIdx >= 0) {
                const updated = [...prev];
                updated[existingIdx] = msg.payload.member;
                return updated;
              }
              return [...prev, msg.payload.member];
            });
            break;
          }

          case 'ROOM_MEMBER_LEFT': {
            setMembers((prev) => prev.filter((m) => m.userId !== msg.payload.userId));
            break;
          }

          case 'ROOM_MEMBER_STATUS': {
            setMembers((prev) =>
              prev.map((m) =>
                m.userId === msg.payload.userId
                  ? { ...m, isConnected: msg.payload.isConnected }
                  : m
              )
            );
            break;
          }

          case 'ROOM_VOICE_STATE_UPDATED': {
            console.log('[Auditorium VOICE msg]', JSON.stringify(msg.payload));
            const map: Record<string, boolean> = {};
            if (Array.isArray(msg.payload.participants)) {
              for (const p of msg.payload.participants) {
                map[p.userId] = Boolean(p.isSpeaking);
              }
            }
            console.log('[Auditorium speakingMap]', JSON.stringify(map));
            setSpeakingMap(map);
            break;
          }

          case 'CHAT_BROADCAST': {
            const newChat: ChatEntry = {
              id: msg.payload.message.id,
              senderName: msg.payload.message.userName || 'Member',
              senderColor: getMemberPalette(msg.payload.message.userId).nameColor,
              text: msg.payload.message.text,
            };
            setChatMessages((prev) => [...prev, newChat]);
            break;
          }

          case 'REACTION_BROADCAST': {
            const reaction = msg.payload.reaction;
            setReactionCount((prev) => prev + 1);
            setReactions((prev) => [...prev, reaction]);

            // Spawn visual particles
            if (typeof window !== 'undefined' && (window as any).__WATCHPARTY_BURST__) {
              const burstSeat = seatRefs.current[reaction.userId] || Object.values(seatRefs.current)[0];
              if (burstSeat) {
                const rect = burstSeat.getBoundingClientRect();
                (window as any).__WATCHPARTY_BURST__(
                  reaction.emoji || '🔥',
                  rect.left + rect.width / 2,
                  rect.top,
                  4
                );
              } else {
                (window as any).__WATCHPARTY_BURST__(
                  reaction.emoji || '🔥',
                  window.innerWidth / 3,
                  window.innerHeight * 0.7,
                  4
                );
              }
            }
            break;
          }

          case 'PLAYLIST_UPDATED': {
            setQueue(msg.payload.playlist || []);
            break;
          }

          case 'POLL_UPDATED': {
            setActivePoll(msg.payload.poll || null);
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.error('Error handling WebSocket message', err);
      }
    };

    return () => {
      isUnmounted = true;
      clearInterval(pingInterval);
      ws.close();
    };
  }, [roomCode]);

  // Periodic drift computation
  useEffect(() => {
    const driftInterval = setInterval(() => {
      if (playbackRef.current && playbackRef.current.status === 'playing' && videoRef.current) {
        const serverNow = Date.now() + clockOffsetRef.current;
        const targetMs =
          playbackRef.current.positionMs +
          Math.max(0, (serverNow - playbackRef.current.serverTimeMs) * (playbackRef.current.playbackRate || 1.0));
        const currentMs = videoRef.current.currentTime * 1000;
        setDriftMs(Math.round(currentMs - targetMs));
      } else {
        setDriftMs(0);
      }
    }, 250);

    return () => clearInterval(driftInterval);
  }, []);

  const togglePlay = () => {
    if (!videoRef.current) return;
    const willPlay = !isPlaying;
    const posMs = Math.round(videoRef.current.currentTime * 1000);

    if (willPlay) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
      sendWs({
        type: 'PLAYBACK_PLAY',
        clientSeq: nextSeq(),
        payload: { positionMs: posMs },
      });
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      sendWs({
        type: 'PLAYBACK_PAUSE',
        clientSeq: nextSeq(),
        payload: { positionMs: posMs },
      });
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = pos * duration;
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);

    sendWs({
      type: 'PLAYBACK_SEEK',
      clientSeq: nextSeq(),
      payload: {
        targetPositionMs: Math.round(newTime * 1000),
        autoPlay: isPlaying,
      },
    });
  };

  const triggerReaction = (emoji = '🔥') => {
    const posMs = Math.round((videoRef.current?.currentTime || 0) * 1000);
    sendWs({
      type: 'REACTION_EMIT',
      clientSeq: nextSeq(),
      payload: { emoji, videoTimestampMs: posMs },
    });

    if (typeof window !== 'undefined' && (window as any).__WATCHPARTY_BURST__) {
      const mySeat = seatRefs.current[selfUserId] || Object.values(seatRefs.current)[0];
      if (mySeat) {
        const rect = mySeat.getBoundingClientRect();
        (window as any).__WATCHPARTY_BURST__(emoji, rect.left + rect.width / 2, rect.top, 5);
      }
    }
  };

  const toggleSelfSpeaking = () => {
    const isCurrentlySpeaking = Boolean(speakingMap[selfUserId]);
    const nextSpeaking = !isCurrentlySpeaking;
    setSpeakingMap((prev) => ({ ...prev, [selfUserId]: nextSpeaking }));
    sendWs({
      type: 'VOICE_STATE_UPDATE',
      clientSeq: nextSeq(),
      payload: {
        inVoice: true,
        isSpeaking: nextSpeaking,
        audioMuted: false,
        videoEnabled: false,
        screenSharing: false,
      },
    });
  };

  const handleSendMessage = (text: string) => {
    sendWs({
      type: 'CHAT_SEND',
      clientSeq: nextSeq(),
      payload: { text },
    });
  };

  const handleAddMovie = (videoId: string) => {
    const movie = MOVIE_CATALOGUE.find((m) => m.id === videoId);
    if (!movie) return;
    sendWs({
      type: 'PLAYLIST_ADD',
      clientSeq: nextSeq(),
      payload: {
        videoId: movie.id,
        title: movie.title,
        durationMs: (movie.runtime || 10) * 60 * 1000,
        provider: 'html5',
        sourceRef: movie.videoUrl,
      },
    });
  };

  const handleVotePoll = (pollId: string, optionIndex: number) => {
    sendWs({
      type: 'POLL_VOTE',
      clientSeq: nextSeq(),
      payload: { pollId, optionIndex },
    });
  };

  const handleCreatePoll = (question: string, options: string[]) => {
    sendWs({
      type: 'POLL_CREATE',
      clientSeq: nextSeq(),
      payload: { question, options, durationSeconds: 120 },
    });
  };

  const handleCopyInvite = () => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard?.writeText(window.location.href);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    }
  };

  const formatMinSec = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Real reaction heatmap calculation across duration
  const NUM_HEAT_SEGMENTS = 24;
  const heatmapSegments = Array.from({ length: NUM_HEAT_SEGMENTS }).map((_, i) => {
    if (duration <= 0) return { id: i, bg: '#2A211B', count: 0 };
    const segStart = (i / NUM_HEAT_SEGMENTS) * duration * 1000;
    const segEnd = ((i + 1) / NUM_HEAT_SEGMENTS) * duration * 1000;
    const count = reactions.filter(
      (r) => r.videoTimestampMs >= segStart && r.videoTimestampMs < segEnd
    ).length;
    let bg = '#2A211B';
    if (count >= 3) bg = '#E4572E';
    else if (count > 0) bg = '#FF9F1C';
    return { id: i, bg, count };
  });

  // 1. Room Not Found Screen
  if (roomStatus === 'not_found') {
    return (
      <div className="min-h-screen bg-[#0E0B09] text-[#F3E9DC] flex flex-col items-center justify-center p-6 text-center font-ui">
        <div className="w-16 h-16 rounded-full bg-[#1A1512] border border-[#3A2E26] flex items-center justify-center mb-6">
          <span className="w-3.5 h-3.5 rounded-full bg-[#E4572E]" />
        </div>
        <h1 className="font-display font-semibold text-3xl sm:text-4xl text-[#F3E9DC] mb-3">
          Room not found
        </h1>
        <p className="text-base text-[#A89B8C] max-w-md mb-8">
          No active screening room exists for code{' '}
          <span className="font-mono text-[#FF9F1C] bg-[#261E19] px-2 py-0.5 rounded">
            {roomCode}
          </span>
          . The room may have expired, or the code was mistyped.
        </p>
        <Link
          href="/lobby"
          className="bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-base px-7 py-3.5 rounded-full transition-all inline-block no-underline"
        >
          Back to lobby
        </Link>
      </div>
    );
  }

  // 2. Loading State
  if (roomStatus === 'loading') {
    return (
      <div className="min-h-screen bg-[#0E0B09] text-[#F3E9DC] flex flex-col items-center justify-center p-6 text-center font-ui">
        <div className="w-10 h-10 border-2 border-[#FF9F1C] border-t-transparent rounded-full animate-spin mb-4" />
        <div className="font-display italic text-2xl text-[#F3E9DC]">Entering auditorium...</div>
        <div className="font-mono text-xs text-[#A89B8C] mt-2">Connecting to suite #{roomCode}</div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen lg:h-screen flex flex-col bg-[#0E0B09] text-[#F3E9DC] font-ui overflow-hidden ${className}`}
    >
      <ReactionParticleOverlay />

      {/* HEADER */}
      <header className="flex-shrink-0 flex items-center justify-between px-6 sm:px-7 py-3.5 border-b border-[#2A211B] bg-[#0E0B09]">
        {/* Left: Title + Room Code */}
        <div className="flex items-center gap-4">
          <Link
            href="/lobby"
            className="font-display font-semibold text-xl sm:text-2xl text-[#F3E9DC] hover:text-[#FF9F1C] transition-colors truncate max-w-xs sm:max-w-md"
          >
            {roomTitle || `Suite #${roomCode}`}
          </Link>
          <span className="font-mono text-xs sm:text-[13px] bg-[#261E19] text-[#A89B8C] px-3 py-1.5 rounded-lg select-all">
            {roomCode}
          </span>
        </div>

        {/* Right: In Sync Pill (Clickable Diagnostics) + Invite Button */}
        <div className="flex items-center gap-3 sm:gap-4.5">
          <button
            type="button"
            onClick={() => setShowSyncDiagnostics(!showSyncDiagnostics)}
            className="flex items-center gap-2 font-mono text-xs sm:text-[13px] bg-[#12302D] text-[#2EC4B6] px-3.5 py-2 rounded-full cursor-pointer hover:brightness-110 transition-all border-none"
            title="Click to view sync diagnostics"
          >
            <span className="w-2 h-2 rounded-full bg-[#2EC4B6] animate-pulse" />
            <span>
              {showSyncDiagnostics
                ? `${Math.abs(driftMs)}ms drift`
                : Math.abs(driftMs) < 40
                ? 'In sync'
                : `${driftMs > 0 ? '+' : ''}${driftMs}ms`}
            </span>
          </button>

          <button
            type="button"
            onClick={handleCopyInvite}
            className="bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-sm sm:text-[15px] px-4.5 sm:px-5 py-2 rounded-full font-ui transition-all cursor-pointer border-none flex-shrink-0"
          >
            {inviteCopied ? 'Copied!' : 'Invite'}
          </button>
        </div>
      </header>

      {/* MAIN BODY: Player + Seats (Left) & Sidebar (Right) */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-hidden">
        {/* Left Column: Player Container & Seats Row */}
        <div className="flex-1 flex flex-col justify-between p-4 sm:p-6 min-h-0 overflow-y-auto">
          {/* THE SCREEN: Clean cinema stage without dead gap */}
          <div
            data-playing={isPlaying ? 'true' : 'false'}
            className="relative w-full aspect-video max-h-[500px] bg-black border border-[#2A211B] rounded-[14px] flex flex-col items-center justify-center overflow-hidden group flex-shrink-0 mx-auto"
          >
            {/* HTML5 Video Element */}
            <video
              ref={videoRef}
              src={videoSrc}
              playsInline
              muted
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
                isPlaying ? 'opacity-100' : 'opacity-25'
              }`}
            />

            {/* Centered Play Button & Title Overlay */}
            {!isPlaying && (
              <div
                data-testid="play-overlay"
                onClick={togglePlay}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 sm:gap-4.5 cursor-pointer pointer-events-auto"
              >
                <span className="w-16 h-16 sm:w-[84px] sm:h-[84px] rounded-full border-2 border-[#F3E9DC] flex items-center justify-center hover:scale-105 transition-transform bg-black/40">
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
                <div className="font-display italic font-medium text-2xl sm:text-4xl lg:text-[48px] text-[#F3E9DC] text-center px-4">
                  {videoTitle}
                </div>
              </div>
            )}

            {/* Bottom Scrubber & Reaction Heat Timeline */}
            <div
              style={{
                position: 'absolute',
                left: '20px',
                right: '20px',
                bottom: '14px',
                pointerEvents: 'auto',
              }}
            >
              {/* Dynamic Real Heatmap Bar Segments */}
              <div
                style={{
                  display: 'flex',
                  height: '12px',
                  borderRadius: '3px',
                  overflow: 'hidden',
                  gap: '2px',
                }}
              >
                {heatmapSegments.map((seg) => (
                  <div
                    key={seg.id}
                    style={{
                      flex: 1,
                      height: '12px',
                      backgroundColor: seg.bg,
                      transition: 'background-color 0.3s ease',
                    }}
                    title={seg.count > 0 ? `${seg.count} reaction${seg.count > 1 ? 's' : ''}` : undefined}
                  />
                ))}
              </div>

              {/* Progress Slider Track */}
              <div
                data-testid="scrubber-track"
                onClick={handleSeek}
                style={{
                  position: 'relative',
                  height: '6px',
                  borderRadius: '3px',
                  background: '#2A211B',
                  marginTop: '8px',
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

              {/* Real Timecode Indicators */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '8px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '12px',
                }}
              >
                <span>{formatMinSec(currentTime)}</span>
                <span style={{ color: '#A89B8C' }}>{formatMinSec(duration)}</span>
              </div>
            </div>
          </div>

          {/* AUDIENCE ROW: Seats Spaced Evenly + Aligned Flame Reaction Pill */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-4 mt-auto">
            {/* Seats Spaced Evenly with Gap */}
            <div className="flex items-center gap-5 overflow-x-auto pb-1 max-w-full">
              {members.length === 0 ? (
                <div className="text-xs text-[#A89B8C] font-mono py-2">
                  Waiting for room presence...
                </div>
              ) : (
                members.map((member) => {
                  const isSpeaking = Boolean(speakingMap[member.userId] || member.isSpeaking);
                  const isSelf = member.userId === selfUserId;
                  const palette = getMemberPalette(member.userId);
                  const initial = (member.userName || 'P')[0].toUpperCase();

                  return (
                    <div
                      key={member.userId}
                      data-seat="true"
                      data-speaking={isSpeaking ? 'true' : 'false'}
                      ref={(el) => {
                        seatRefs.current[member.userId] = el;
                      }}
                      onClick={isSelf ? toggleSelfSpeaking : undefined}
                      title={isSelf ? 'Click seat to toggle your microphone status' : member.userName}
                      className={`flex flex-col items-center gap-2 flex-shrink-0 ${
                        isSelf ? 'cursor-pointer' : ''
                      }`}
                    >
                      <div className="w-[84px] h-[70px] bg-[#261E19] rounded-t-[16px] rounded-b-[6px] flex items-center justify-center transition-all">
                        <span
                          style={{
                            backgroundColor: palette.bg,
                            color: palette.text,
                            boxShadow: isSpeaking ? '0 0 0 3px #2EC4B6' : 'none',
                            transition: 'box-shadow 0.2s ease',
                          }}
                          className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-base select-none"
                        >
                          {initial}
                        </span>
                      </div>
                      <span
                        style={{ color: member.isHost ? '#FF9F1C' : palette.nameColor }}
                        className="text-[13px] font-medium max-w-[84px] truncate text-center"
                      >
                        {member.userName} {isSelf ? '(You)' : ''}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Reaction Counter Pill - Horizontally aligned with seats */}
            <button
              type="button"
              onClick={() => triggerReaction('🔥')}
              className="flex items-center gap-2 bg-[#261E19] hover:bg-[#342821] active:scale-95 px-4 py-2.5 rounded-full text-sm text-[#F3E9DC] cursor-pointer transition-transform border-none flex-shrink-0 self-center"
              title="Click to react"
              aria-label="Click to react"
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

        {/* Right Column: Sidebar (Full Height & Pinned Input) */}
        <TheatreSidebar
          isOpen={true}
          currentRoomCode={roomCode}
          selfUserId={selfUserId}
          messages={chatMessages}
          onSendMessage={handleSendMessage}
          queue={queue}
          onAddMovie={handleAddMovie}
          activePoll={activePoll}
          onVotePoll={handleVotePoll}
          onCreatePoll={handleCreatePoll}
        />
      </div>
    </div>
  );
}

