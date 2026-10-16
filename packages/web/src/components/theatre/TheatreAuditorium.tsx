'use client';

/**
 * TheatreAuditorium Component
 * Fully connected real-time theatre auditorium:
 * 1. Loads real room by code from server; shows "Room not found" if missing.
 * 2. Connected via useRoomSocket (Phase 1 state machine): idle → connecting →
 *    connected ↔ reconnecting → left | kicked | banned.
 * 3. HTML5 synchronized video player with play/pause/seek sync and real drift indicator.
 * 4. Real chat, playlist queue, audience polls, and dynamic reaction heat track.
 * 5. Fixed layout: seats spaced evenly, pinned chat input, aligned reaction chip, no dead space.
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
import { useRouter } from 'next/navigation';
import { ReactionParticleOverlay } from './ReactionParticleOverlay';
import { TheatreSidebar, ChatEntry } from './TheatreSidebar';
import { SourcePickerSheet, SourceSelection } from './SourcePickerSheet';
import { useRoomSocket } from '@/lib/useRoomSocket';
import { useAuth } from '@/lib/AuthContext';

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

function extractYouTubeId(urlOrId: string): string | null {
  if (!urlOrId) return null;
  const match = urlOrId.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
  if (match) return match[1];
  if (/^[\w-]{11}$/.test(urlOrId) && !urlOrId.includes('.') && !urlOrId.startsWith('room_') && !urlOrId.startsWith('user_') && !urlOrId.startsWith('stream_')) return urlOrId;
  return null;
}

export function TheatreAuditorium({
  roomCode,
  className = '',
}: TheatreAuditoriumProps) {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [showSourcePicker, setShowSourcePicker] = useState(false);

  // Route protection: require session or guest identity
  useEffect(() => {
    if (!authLoading && !user) {
      router.push(`/login?next=/room/${encodeURIComponent(roomCode)}`);
    }
  }, [user, authLoading, roomCode, router]);

  // ── Auth / identity ────────────────────────────────────────────────────────
  const [selfUserId, setSelfUserId] = useState('');
  const [roomTitle, setRoomTitle] = useState('');
  const [members, setMembers] = useState<MemberPublicInfo[]>([]);
  const [speakingMap, setSpeakingMap] = useState<Record<string, boolean>>({});

  // Resolve username
  const userName = user?.displayName || (typeof window !== 'undefined' ? localStorage.getItem('watchparty_username') || `Patron-${Math.floor(100 + Math.random() * 900)}` : 'Patron');

  const authToken =
    typeof window !== 'undefined'
      ? sessionStorage.getItem('watchparty_token') ?? undefined
      : undefined;

  // ── Video & Playback ───────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const screenContainerRef = useRef<HTMLDivElement>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const sendRef = useRef<(msg: any) => void>(() => {});
  const [provider, setProvider] = useState<'html5' | 'youtube' | 'screenshare'>('html5');
  const [youtubeId, setYoutubeId] = useState<string | null>(null);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);

  const [videoSrc, setVideoSrc] = useState(
    MOVIE_CATALOGUE[0]?.videoUrl || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
  );
  const [videoTitle, setVideoTitle] = useState(MOVIE_CATALOGUE[0]?.title || 'Big Buck Bunny');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [driftMs, setDriftMs] = useState(0);
  const [showSyncDiagnostics, setShowSyncDiagnostics] = useState(false);

  const handleSubtitleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      let content = (event.target?.result as string) || '';
      if (file.name.toLowerCase().endsWith('.srt')) {
        content = 'WEBVTT\n\n' + content.replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');
      }
      const blob = new Blob([content], { type: 'text/vtt' });
      setSubtitleUrl(URL.createObjectURL(blob));
      setSubtitlesEnabled(true);
    };
    reader.readAsText(file);
  };

  const clockOffsetRef = useRef(0);
  const playbackRef = useRef<any>(null);
  const seqRef = useRef(1);
  const nextSeq = () => ++seqRef.current;

  // YouTube postMessage command dispatcher
  const sendYouTubeCommand = useCallback((func: string, args: any[] = []) => {
    const iframe = document.getElementById('yt-player-frame') as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        '*'
      );
    }
  }, []);

  // Listen for YouTube IFrame player state updates
  useEffect(() => {
    const handleWindowMessage = (e: MessageEvent) => {
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (data?.event === 'infoDelivery' && data?.info) {
          if (typeof data.info.currentTime === 'number') setCurrentTime(data.info.currentTime);
          if (typeof data.info.duration === 'number' && data.info.duration > 0) setDuration(data.info.duration);
          if (data.info.playerState === 1) setIsPlaying(true);
          else if (data.info.playerState === 2) setIsPlaying(false);
        }
      } catch {}
    };
    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, []);

  // ── Social ─────────────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const [reactions, setReactions] = useState<ReactionBurst[]>([]);
  const [reactionCount, setReactionCount] = useState(0);
  const [queue, setQueue] = useState<PlaylistItem[]>([]);
  const [activePoll, setActivePoll] = useState<PollSummary | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  const seatRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ── Message handler (stable ref) ───────────────────────────────────────────
  const handleMessage = useCallback((msg: any) => {
    switch (msg.type) {
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
        setRoomTitle(snap.roomName || `Room ${roomCode}`);
        setSelfUserId(snap.selfUserId || '');
        setMembers(snap.members || []);
        setQueue(snap.playlist || []);
        setActivePoll(snap.activePoll || null);
        setReactionCount(snap.storedReactions?.length || 0);
        setReactions(snap.storedReactions || []);

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

        if (snap.playback) {
          playbackRef.current = snap.playback;
          const matchedMovie = MOVIE_CATALOGUE.find((m) => m.id === snap.playback.videoId);
          const resolvedUrl = snap.playback.sourceRef || matchedMovie?.videoUrl || '';
          const ytId = extractYouTubeId(resolvedUrl || snap.playback.videoId);

          if (ytId || snap.playback.provider === 'youtube') {
            setProvider('youtube');
            if (ytId) setYoutubeId(ytId);
            setVideoTitle(snap.playback.title || 'YouTube Stream');
            if (snap.playback.status === 'playing') {
              setIsPlaying(true);
              sendYouTubeCommand('playVideo');
            } else {
              setIsPlaying(false);
              sendYouTubeCommand('pauseVideo');
            }
          } else if (snap.playback.provider === 'screenshare') {
            setProvider('screenshare');
            setVideoTitle(snap.playback.title || 'Live Screen Stream');
          } else {
            setProvider('html5');
            if (matchedMovie?.videoUrl) setVideoSrc(matchedMovie.videoUrl);
            else if (snap.playback.sourceRef) setVideoSrc(snap.playback.sourceRef);
            setVideoTitle(snap.playback.title || matchedMovie?.title || '');

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
        }
        break;
      }

      case 'PLAYBACK_UPDATE': {
        const pb = msg.payload.playback;
        playbackRef.current = pb;
        const matchedMovie = MOVIE_CATALOGUE.find((m) => m.id === pb.videoId);
        const resolvedUrl = pb.sourceRef || matchedMovie?.videoUrl || '';
        const ytId = extractYouTubeId(resolvedUrl || pb.videoId);

        if (ytId || pb.provider === 'youtube') {
          setProvider('youtube');
          if (ytId) setYoutubeId(ytId);
          if (pb.title) setVideoTitle(pb.title);

          const targetSec = (pb.positionMs || 0) / 1000;
          if (pb.status === 'playing') {
            setIsPlaying(true);
            sendYouTubeCommand('playVideo');
            sendYouTubeCommand('seekTo', [targetSec, true]);
          } else if (pb.status === 'paused') {
            setIsPlaying(false);
            sendYouTubeCommand('pauseVideo');
            sendYouTubeCommand('seekTo', [targetSec, true]);
          }
        } else if (pb.provider === 'screenshare') {
          setProvider('screenshare');
          if (pb.title) setVideoTitle(pb.title);
        } else {
          setProvider('html5');
          if (matchedMovie?.videoUrl) setVideoSrc(matchedMovie.videoUrl);
          else if (pb.sourceRef) setVideoSrc(pb.sourceRef);
          if (pb.title || matchedMovie?.title) setVideoTitle(pb.title || matchedMovie?.title);

          if (videoRef.current) {
            if (pb.status === 'playing') {
              const serverNow = Date.now() + clockOffsetRef.current;
              const elapsed = Math.max(0, (serverNow - pb.serverTimeMs) / 1000);
              const targetSec = pb.positionMs / 1000 + elapsed * (pb.playbackRate || 1.0);
              const diff = Math.abs(videoRef.current.currentTime - targetSec);
              if (diff > 0.4 || videoRef.current.paused) videoRef.current.currentTime = targetSec;
              videoRef.current.play().catch(() => {});
              setIsPlaying(true);
            } else if (pb.status === 'paused') {
              videoRef.current.currentTime = pb.positionMs / 1000;
              videoRef.current.pause();
              setIsPlaying(false);
            }
          }
        }
        break;
      }

      case 'ROOM_MEMBER_JOINED':
        setMembers((prev) => {
          const idx = prev.findIndex((m) => m.userId === msg.payload.member.userId);
          if (idx >= 0) {
            const upd = [...prev];
            upd[idx] = msg.payload.member;
            return upd;
          }
          return [...prev, msg.payload.member];
        });
        if (isScreenSharing && screenStreamRef.current) {
          initiateSharerPeerConnection(msg.payload.member.userId, screenStreamRef.current);
        }
        break;

      case 'SCREEN_SHARE_STARTED': {
        const session = msg.payload;
        if (session.sharerUserId !== selfUserId) {
          setProvider('screenshare');
          setVideoTitle(session.title || 'Live Screen Stream');
        }
        break;
      }

      case 'SCREEN_SHARE_STOPPED': {
        setProvider('html5');
        setIsScreenSharing(false);
        if (videoRef.current) videoRef.current.srcObject = null;
        peerConnectionsRef.current.forEach((pc) => pc.close());
        peerConnectionsRef.current.clear();
        break;
      }

      case 'WEBRTC_SIGNAL': {
        const { fromUserId, signalType, signalData } = msg.payload || {};
        if (!fromUserId) break;

        if (isScreenSharing) {
          const pc = peerConnectionsRef.current.get(fromUserId);
          if (pc) {
            if (signalType === 'answer' && signalData) {
              pc.setRemoteDescription(new RTCSessionDescription(signalData)).catch(() => {});
            } else if (signalType === 'ice-candidate' && signalData) {
              pc.addIceCandidate(new RTCIceCandidate(signalData)).catch(() => {});
            }
          }
        } else {
          let pc = peerConnectionsRef.current.get(fromUserId);
          if (!pc && typeof window !== 'undefined' && window.RTCPeerConnection) {
            pc = new RTCPeerConnection({
              iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            });
            peerConnectionsRef.current.set(fromUserId, pc);

            if (pc.addTransceiver) {
              pc.addTransceiver('video', { direction: 'recvonly' });
              pc.addTransceiver('audio', { direction: 'recvonly' });
            }

            pc.ontrack = (event) => {
              if (videoRef.current) {
                if (event.streams && event.streams[0]) {
                  videoRef.current.srcObject = event.streams[0];
                } else {
                  if (!videoRef.current.srcObject && typeof MediaStream !== 'undefined') {
                    videoRef.current.srcObject = new MediaStream();
                  }
                  if (videoRef.current.srcObject instanceof MediaStream) {
                    videoRef.current.srcObject.addTrack(event.track);
                  }
                }
                videoRef.current.play().catch(() => {});
              }
            };

            pc.onicecandidate = (e) => {
              if (e.candidate) {
                sendRef.current({
                  type: 'WEBRTC_SIGNAL',
                  payload: {
                    targetUserId: fromUserId,
                    signalType: 'ice-candidate',
                    signalData: e.candidate.toJSON(),
                  },
                });
              }
            };
          }

          if (pc) {
            if (signalType === 'offer' && signalData) {
              pc.setRemoteDescription(new RTCSessionDescription(signalData))
                .then(() => pc!.createAnswer())
                .then((answer) => pc!.setLocalDescription(answer))
                .then(() => {
                  sendRef.current({
                    type: 'WEBRTC_SIGNAL',
                    payload: {
                      targetUserId: fromUserId,
                      signalType: 'answer',
                      signalData: pc!.localDescription,
                    },
                  });
                })
                .catch((e) => console.warn('WebRTC signal offer handling error', e));
            } else if (signalType === 'ice-candidate' && signalData) {
              pc.addIceCandidate(new RTCIceCandidate(signalData)).catch(() => {});
            }
          }
        }
        break;
      }

      case 'ROOM_MEMBER_LEFT':
        setMembers((prev) => prev.filter((m) => m.userId !== msg.payload.userId));
        break;

      case 'ROOM_MEMBER_STATUS':
        setMembers((prev) =>
          prev.map((m) =>
            m.userId === msg.payload.userId ? { ...m, isConnected: msg.payload.isConnected } : m
          )
        );
        break;

      case 'ROOM_VOICE_STATE_UPDATED': {
        const map: Record<string, boolean> = {};
        if (Array.isArray(msg.payload.participants)) {
          for (const p of msg.payload.participants) {
            map[p.userId] = Boolean(p.isSpeaking);
          }
        }
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
        if (typeof window !== 'undefined' && (window as any).__WATCHPARTY_BURST__) {
          const burstSeat = seatRefs.current[reaction.userId] || Object.values(seatRefs.current)[0];
          if (burstSeat) {
            const rect = burstSeat.getBoundingClientRect();
            (window as any).__WATCHPARTY_BURST__(reaction.emoji || '🔥', rect.left + rect.width / 2, rect.top, 4);
          } else {
            (window as any).__WATCHPARTY_BURST__(reaction.emoji || '🔥', window.innerWidth / 3, window.innerHeight * 0.7, 4);
          }
        }
        break;
      }

      case 'PLAYLIST_UPDATED':
        setQueue(msg.payload.playlist || []);
        break;

      case 'POLL_UPDATED':
        setActivePoll(msg.payload.poll || null);
        break;

      default:
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // ── WebSocket via state-machine hook ──────────────────────────────────────
  const { state: connState, roomError, send, leave, retry } = useRoomSocket({
    roomCode,
    authToken,
    userName,
    onMessage: handleMessage,
  });

  sendRef.current = send;

  // ── NTP ping interval (runs while socket is open) ─────────────────────────
  useEffect(() => {
    if (connState !== 'connected') return;
    const interval = setInterval(() => {
      send({ type: 'SYNC_PING', payload: { clientSendTimeMs: Date.now() } });
    }, 5000);
    return () => clearInterval(interval);
  }, [connState, send]);

  // ── Periodic drift computation ────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (playbackRef.current?.status === 'playing' && videoRef.current) {
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
    return () => clearInterval(interval);
  }, []);

  // ── Playback actions ──────────────────────────────────────────────────────
  const togglePlay = () => {
    const willPlay = !isPlaying;

    if (provider === 'youtube') {
      sendYouTubeCommand(willPlay ? 'playVideo' : 'pauseVideo');
      setIsPlaying(willPlay);
      send({
        type: willPlay ? 'PLAYBACK_PLAY' : 'PLAYBACK_PAUSE',
        clientSeq: nextSeq(),
        payload: { positionMs: Math.round(currentTime * 1000) },
      });
      return;
    }

    if (!videoRef.current) return;
    const posMs = Math.round(videoRef.current.currentTime * 1000);
    if (willPlay) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
      send({ type: 'PLAYBACK_PLAY', clientSeq: nextSeq(), payload: { positionMs: posMs } });
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      send({ type: 'PLAYBACK_PAUSE', clientSeq: nextSeq(), payload: { positionMs: posMs } });
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    if (provider === 'youtube') {
      const targetSec = duration > 0 ? pos * duration : pos * 300;
      setCurrentTime(targetSec);
      sendYouTubeCommand('seekTo', [targetSec, true]);
      send({
        type: 'PLAYBACK_SEEK',
        clientSeq: nextSeq(),
        payload: { targetPositionMs: Math.round(targetSec * 1000), autoPlay: isPlaying },
      });
      return;
    }

    if (!videoRef.current || duration <= 0) return;
    const newTime = pos * duration;
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    send({
      type: 'PLAYBACK_SEEK',
      clientSeq: nextSeq(),
      payload: { targetPositionMs: Math.round(newTime * 1000), autoPlay: isPlaying },
    });
  };

  // ── WebRTC Sharer Peer Connection Helper ─────────────────────────────────
  const initiateSharerPeerConnection = useCallback((targetUserId: string, stream: MediaStream) => {
    if (typeof window === 'undefined' || !window.RTCPeerConnection) return;
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      peerConnectionsRef.current.set(targetUserId, pc);

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendRef.current({
            type: 'WEBRTC_SIGNAL',
            payload: {
              targetUserId,
              signalType: 'ice-candidate',
              signalData: e.candidate.toJSON(),
            },
          });
        }
      };

      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          sendRef.current({
            type: 'WEBRTC_SIGNAL',
            payload: {
              targetUserId,
              signalType: 'offer',
              signalData: pc.localDescription,
            },
          });
        })
        .catch((e) => console.warn('WebRTC create offer error for', targetUserId, e));
    } catch (e) {
      console.warn('Failed to initiate WebRTC connection for', targetUserId, e);
    }
  }, []);

  const handleStopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => {
        try { t.stop(); } catch {}
      });
      screenStreamRef.current = null;
    }
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
    setIsScreenSharing(false);
    setProvider('html5');
    if (videoRef.current) videoRef.current.srcObject = null;
    sendRef.current({
      type: 'SCREEN_SHARE_STOP',
      clientSeq: nextSeq(),
      payload: { reason: 'user_stopped' },
    });
  }, []);

  // ── Screen / Tab Share (No Extension Required) ───────────────────────────
  const handleStartScreenShare = async () => {
    try {
      if (isScreenSharing) {
        handleStopScreenShare();
        return;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      }).catch(async () => {
        return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      });

      screenStreamRef.current = stream;
      setIsScreenSharing(true);
      setProvider('screenshare');
      setVideoTitle(`${userName}'s Stream`);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true; // Local preview is muted to prevent audio feedback loop
        videoRef.current.play().catch(() => {});
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          handleStopScreenShare();
        });
      }

      sendRef.current({
        type: 'SCREEN_SHARE_START',
        clientSeq: nextSeq(),
        payload: {
          title: `${userName}'s Stream`,
          hasAudio: stream.getAudioTracks().length > 0,
        },
      });

      // Send offer to all current members
      members.forEach((m) => {
        if (m.userId !== selfUserId) {
          initiateSharerPeerConnection(m.userId, stream);
        }
      });
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError') {
        console.warn('Screen share cancelled or not allowed', err);
      }
    }
  };

  const toggleFullscreen = () => {
    const el = screenContainerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const triggerReaction = (emoji = '🔥') => {
    const posMs = Math.round((videoRef.current?.currentTime || currentTime || 0) * 1000);
    send({ type: 'REACTION_EMIT', clientSeq: nextSeq(), payload: { emoji, videoTimestampMs: posMs } });
    if (typeof window !== 'undefined' && (window as any).__WATCHPARTY_BURST__) {
      const mySeat = seatRefs.current[selfUserId] || Object.values(seatRefs.current)[0];
      if (mySeat) {
        const rect = mySeat.getBoundingClientRect();
        (window as any).__WATCHPARTY_BURST__(emoji, rect.left + rect.width / 2, rect.top, 5);
      }
    }
  };

  const toggleSelfSpeaking = () => {
    const isSpeaking = Boolean(speakingMap[selfUserId]);
    setSpeakingMap((prev) => ({ ...prev, [selfUserId]: !isSpeaking }));
    send({
      type: 'VOICE_STATE_UPDATE',
      clientSeq: nextSeq(),
      payload: { inVoice: true, isSpeaking: !isSpeaking, audioMuted: false, videoEnabled: false, screenSharing: false },
    });
  };

  const handleSendMessage = (text: string) => {
    send({ type: 'CHAT_SEND', clientSeq: nextSeq(), payload: { text } });
  };

  const handleAddMovie = (videoId: string) => {
    const movie = MOVIE_CATALOGUE.find((m) => m.id === videoId);
    if (!movie) return;
    send({
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
    send({ type: 'POLL_VOTE', clientSeq: nextSeq(), payload: { pollId, optionIndex } });
  };

  const handleCreatePoll = (question: string, options: string[]) => {
    send({ type: 'POLL_CREATE', clientSeq: nextSeq(), payload: { question, options, durationSeconds: 120 } });
  };

  const handleSelectSource = (src: SourceSelection) => {
    setVideoTitle(src.title);
    const ytId = extractYouTubeId(src.sourceRef || src.videoId);

    if (ytId || src.provider === 'youtube') {
      setProvider('youtube');
      if (ytId) setYoutubeId(ytId);
    } else {
      setProvider('html5');
      if (src.sourceRef) setVideoSrc(src.sourceRef);
    }

    send({
      type: 'PLAYBACK_CHANGE_VIDEO',
      clientSeq: nextSeq(),
      payload: {
        videoId: ytId || src.videoId,
        provider: ytId ? 'youtube' : (src.provider || 'html5'),
        sourceRef: src.sourceRef,
        title: src.title,
        autoPlay: true,
      },
    });
  };

  const handleAddToQueueFromPicker = (src: SourceSelection) => {
    send({
      type: 'PLAYLIST_ADD',
      clientSeq: nextSeq(),
      payload: {
        videoId: src.videoId,
        provider: src.provider || 'html5',
        sourceRef: src.sourceRef,
        title: src.title,
        durationMs: 0,
      },
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

  const NUM_HEAT_SEGMENTS = 24;
  const heatmapSegments = Array.from({ length: NUM_HEAT_SEGMENTS }).map((_, i) => {
    if (duration <= 0) return { id: i, bg: '#2A211B', count: 0 };
    const segStart = (i / NUM_HEAT_SEGMENTS) * duration * 1000;
    const segEnd = ((i + 1) / NUM_HEAT_SEGMENTS) * duration * 1000;
    const count = reactions.filter((r) => r.videoTimestampMs >= segStart && r.videoTimestampMs < segEnd).length;
    let bg = '#2A211B';
    if (count >= 3) bg = '#E4572E';
    else if (count > 0) bg = '#FF9F1C';
    return { id: i, bg, count };
  });

  // ── Full-screen state screens ─────────────────────────────────────────────

  // Not found (from WS error message)
  if (connState === 'kicked' && roomError === 'Room not found.') {
    return (
      <div className="min-h-screen bg-[#0E0B09] text-[#F3E9DC] flex flex-col items-center justify-center p-6 text-center font-ui">
        <div className="w-16 h-16 rounded-full bg-[#1A1512] border border-[#3A2E26] flex items-center justify-center mb-6">
          <span className="w-3.5 h-3.5 rounded-full bg-[#E4572E]" />
        </div>
        <h1 className="font-display font-semibold text-3xl sm:text-4xl text-[#F3E9DC] mb-3">Room not found</h1>
        <p className="text-base text-[#A89B8C] max-w-sm mb-8">
          No active room exists for code{' '}
          <span className="font-mono text-[#FF9F1C] bg-[#261E19] px-2 py-0.5 rounded">{roomCode}</span>.
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

  // Banned
  if (connState === 'banned') {
    return (
      <div className="min-h-screen bg-[#0E0B09] text-[#F3E9DC] flex flex-col items-center justify-center p-6 text-center font-ui">
        <div className="w-16 h-16 rounded-full bg-[#1A1512] border border-[#E4572E] flex items-center justify-center mb-6">
          <span className="w-3.5 h-3.5 rounded-full bg-[#E4572E]" />
        </div>
        <h1 className="font-display font-semibold text-3xl text-[#E4572E] mb-2">Banned</h1>
        <p className="text-sm text-[#A89B8C] max-w-sm mb-6">{roomError}</p>
        <Link href="/lobby" className="text-[#FF9F1C] font-mono text-sm underline">Back to lobby</Link>
      </div>
    );
  }

  // Kicked (non-not-found)
  if (connState === 'kicked' && roomError && roomError !== 'Room not found.') {
    return (
      <div className="min-h-screen bg-[#0E0B09] text-[#F3E9DC] flex flex-col items-center justify-center p-6 text-center font-ui">
        <h1 className="font-display font-semibold text-3xl text-[#FF9F1C] mb-2">Removed</h1>
        <p className="text-sm text-[#A89B8C] max-w-sm mb-6">{roomError}</p>
        <Link href="/lobby" className="text-[#FF9F1C] font-mono text-sm underline">Back to lobby</Link>
      </div>
    );
  }

  // Connecting (first ever connect)
  if (connState === 'connecting') {
    return (
      <div className="min-h-screen bg-[#0E0B09] text-[#F3E9DC] flex flex-col items-center justify-center p-6 text-center font-ui">
        <div className="w-10 h-10 border-2 border-[#FF9F1C] border-t-transparent rounded-full animate-spin mb-4" />
        <div className="font-display italic text-2xl text-[#F3E9DC]">Entering auditorium…</div>
        <div className="font-mono text-xs text-[#A89B8C] mt-2">Connecting to suite #{roomCode}</div>
      </div>
    );
  }

  // Left intentionally
  if (connState === 'left') {
    return (
      <div className="min-h-screen bg-[#0E0B09] text-[#F3E9DC] flex flex-col items-center justify-center p-6 text-center font-ui">
        <div className="font-display italic text-2xl text-[#F3E9DC] mb-4">You left the room.</div>
        <Link href="/lobby" className="bg-[#FF9F1C] text-[#0E0B09] font-bold px-6 py-3 rounded-full text-base">Back to lobby</Link>
      </div>
    );
  }

  // ── Main auditorium UI ────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen lg:h-screen flex flex-col bg-[#0E0B09] text-[#F3E9DC] font-ui overflow-hidden ${className}`}>
      <ReactionParticleOverlay />

      {/* Reconnecting banner – shown inside the room UI without destroying it */}
      {connState === 'reconnecting' && (
        <div className="flex-shrink-0 flex items-center justify-center gap-3 bg-[#261E19] border-b border-[#3A2E26] py-2 px-4 text-xs font-mono text-[#FF9F1C]">
          <span className="w-2 h-2 rounded-full bg-[#FF9F1C] animate-pulse" />
          <span>Reconnecting…</span>
          <button
            type="button"
            onClick={retry}
            className="ml-2 underline text-[#F3E9DC] cursor-pointer bg-transparent border-none"
          >
            Retry now
          </button>
        </div>
      )}

      {/* Can't connect banner – initial connect failed + still reconnecting */}
      {connState === 'idle' && roomCode && (
        <div className="flex-shrink-0 flex items-center justify-center gap-3 bg-[#1A1512] border border-[#E4572E]/40 py-3 px-4 text-sm font-ui text-[#E4572E]">
          Can't connect to server.
          <button type="button" onClick={retry} className="ml-2 font-bold underline cursor-pointer bg-transparent border-none text-[#FF9F1C]">
            Retry
          </button>
        </div>
      )}

      {/* HEADER */}
      <header className="flex-shrink-0 flex items-center justify-between px-6 sm:px-7 py-3.5 border-b border-[#2A211B] bg-[#0E0B09]">
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

        <div className="flex items-center gap-3 sm:gap-4">
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
            onClick={handleStartScreenShare}
            className={`flex items-center gap-1.5 font-ui text-xs sm:text-[13px] border rounded-full px-3.5 py-2 cursor-pointer transition-all ${
              isScreenSharing
                ? 'bg-[#E4572E] text-[#0E0B09] border-[#E4572E] font-bold animate-pulse'
                : 'bg-[#261E19] hover:bg-[#342821] border-[#3A2E26] hover:border-[#2EC4B6] text-[#2EC4B6]'
            }`}
            title="Stream your Netflix, Hotstar, Prime Video or browser tab with audio"
          >
            <span>{isScreenSharing ? '⏹' : '📺'}</span>
            <span>{isScreenSharing ? 'Stop Stream' : 'Stream Tab'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSourcePicker(true)}
            className="flex items-center gap-1.5 font-ui text-xs sm:text-[13px] bg-[#261E19] hover:bg-[#342821] border border-[#3A2E26] hover:border-[#FF9F1C] text-[#F3E9DC] px-3.5 py-2 rounded-full cursor-pointer transition-colors"
            title="Add media source"
          >
            <span className="text-[#FF9F1C] font-bold">＋</span>
            <span>Source</span>
          </button>

          <button
            type="button"
            onClick={handleCopyInvite}
            className="bg-[#FF9F1C] hover:brightness-105 active:scale-95 text-[#0E0B09] font-bold text-sm sm:text-[15px] px-4 sm:px-5 py-2 rounded-full font-ui transition-all cursor-pointer border-none flex-shrink-0"
          >
            {inviteCopied ? 'Copied!' : 'Invite'}
          </button>
        </div>
      </header>

      {/* MAIN BODY */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-hidden">
        {/* Left Column */}
        <div className="flex-1 flex flex-col justify-between p-4 sm:p-6 min-h-0 overflow-y-auto">
          {/* THE SCREEN */}
          <div
            ref={screenContainerRef}
            data-playing={isPlaying ? 'true' : 'false'}
            className="relative w-full aspect-video max-h-[500px] bg-black border border-[#2A211B] rounded-[14px] flex flex-col items-center justify-center overflow-hidden group flex-shrink-0 mx-auto shadow-[0_0_50px_rgba(0,0,0,0.8),0_0_80px_rgba(255,159,28,0.08)]"
          >
            {/* Ambient source badge */}
            <div className="absolute top-3 left-3 z-20 flex items-center gap-2 bg-[#0E0B09]/85 backdrop-blur-md border border-[#3A2E26] text-[#F3E9DC] font-mono text-[11px] px-3 py-1 rounded-full pointer-events-none">
              {provider === 'youtube' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-[#E4572E] animate-pulse" />
                  <span className="text-[#FF9F1C] font-semibold">YouTube Direct</span>
                </>
              ) : provider === 'screenshare' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-[#2EC4B6] animate-pulse" />
                  <span className="text-[#2EC4B6] font-semibold">Live Tab Stream (Audio + Video)</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-[#FF9F1C]" />
                  <span className="text-[#A89B8C]">Cinema Player</span>
                </>
              )}
            </div>

            {/* Quick Unmute pill if playing muted */}
            {isMuted && (isPlaying || provider === 'screenshare') && (
              <button
                type="button"
                onClick={() => {
                  setIsMuted(false);
                  if (videoRef.current) videoRef.current.muted = false;
                }}
                className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-[#FF9F1C] hover:brightness-110 active:scale-95 text-[#0E0B09] font-bold font-ui text-xs px-3.5 py-1.5 rounded-full shadow-lg cursor-pointer border-none transition-all"
              >
                <span>🔊</span>
                <span>Unmute Audio</span>
              </button>
            )}

            {/* Video or YouTube Frame */}
            {provider === 'youtube' && youtubeId ? (
              <iframe
                id="yt-player-frame"
                src={`https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&autoplay=1&playsinline=1`}
                title={videoTitle || 'YouTube Video'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="w-full h-full border-0 rounded-[14px]"
              />
            ) : (
              <video
                ref={videoRef}
                src={provider === 'screenshare' ? undefined : videoSrc}
                playsInline
                muted={isMuted}
                onTimeUpdate={() => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime); }}
                onLoadedMetadata={() => { if (videoRef.current?.duration) setDuration(videoRef.current.duration); }}
                onClick={togglePlay}
                className={`w-full h-full object-contain cursor-pointer transition-opacity duration-300 ${
                  isPlaying || provider === 'screenshare' ? 'opacity-100' : 'opacity-40'
                }`}
              >
                {subtitleUrl && subtitlesEnabled && (
                  <track
                    kind="subtitles"
                    src={subtitleUrl}
                    srcLang="en"
                    label="Subtitles"
                    default
                  />
                )}
              </video>
            )}

            {/* Centered Play Button overlay for HTML5 when paused */}
            {provider !== 'youtube' && !isPlaying && provider !== 'screenshare' && (
              <div
                data-testid="play-overlay"
                onClick={togglePlay}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 sm:gap-4 cursor-pointer pointer-events-auto bg-black/30 backdrop-blur-[2px]"
              >
                <span className="w-16 h-16 sm:w-[84px] sm:h-[84px] rounded-full border-2 border-[#F3E9DC] flex items-center justify-center hover:scale-105 transition-transform bg-black/60 shadow-xl">
                  <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="#F3E9DC" className="ml-1">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
                {videoTitle && (
                  <div className="font-display italic font-medium text-2xl sm:text-4xl lg:text-[44px] text-[#F3E9DC] text-center px-4 max-w-2xl drop-shadow-md">
                    {videoTitle}
                  </div>
                )}
              </div>
            )}

            {/* Bottom controls bar */}
            <div className="absolute left-4 right-4 sm:left-5 sm:right-5 bottom-3 pointer-events-auto z-20">
              {/* Heatmap */}
              <div style={{ display: 'flex', height: '10px', borderRadius: '3px', overflow: 'hidden', gap: '2px' }}>
                {heatmapSegments.map((seg) => (
                  <div
                    key={seg.id}
                    style={{ flex: 1, height: '10px', backgroundColor: seg.bg, transition: 'background-color 0.3s ease' }}
                    title={seg.count > 0 ? `${seg.count} reaction${seg.count > 1 ? 's' : ''}` : undefined}
                  />
                ))}
              </div>

              {/* Scrubber */}
              <div
                data-testid="scrubber-track"
                onClick={handleSeek}
                style={{ position: 'relative', height: '6px', borderRadius: '3px', background: '#2A211B', marginTop: '6px', cursor: 'pointer' }}
              >
                <div style={{ width: `${progressPercent}%`, height: '6px', borderRadius: '3px', background: '#FF9F1C' }} />
                <span
                  style={{
                    position: 'absolute', left: `${progressPercent}%`, top: '-4px',
                    width: '14px', height: '14px', borderRadius: '50%', background: '#F3E9DC', transform: 'translateX(-50%)',
                    boxShadow: '0 0 8px rgba(0,0,0,0.7)',
                  }}
                />
              </div>

              {/* Timecodes & player utilities */}
              <div className="flex items-center justify-between mt-2 font-mono text-xs text-[#A89B8C]">
                <div className="flex items-center gap-3">
                  {provider !== 'youtube' && (
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="text-[#F3E9DC] hover:text-[#FF9F1C] cursor-pointer bg-transparent border-none p-0 text-sm font-bold"
                      title={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying ? '⏸' : '▶'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const nextMuted = !isMuted;
                      setIsMuted(nextMuted);
                      if (videoRef.current) videoRef.current.muted = nextMuted;
                    }}
                    className="text-[#F3E9DC] hover:text-[#FF9F1C] cursor-pointer bg-transparent border-none p-0 text-sm"
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? '🔇' : '🔊'}
                  </button>
                  <span>{formatMinSec(currentTime)} / {formatMinSec(duration)}</span>
                </div>

                <div className="flex items-center gap-3">
                  <label
                    className="text-[#F3E9DC] hover:text-[#FF9F1C] cursor-pointer text-[11px] font-mono border border-[#3A2E26] hover:border-[#FF9F1C] px-2 py-0.5 rounded transition-colors flex items-center gap-1 select-none"
                    title="Upload subtitles (.srt or .vtt)"
                  >
                    <span>CC</span>
                    <input
                      type="file"
                      accept=".srt,.vtt"
                      onChange={handleSubtitleUpload}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="text-[#F3E9DC] hover:text-[#FF9F1C] cursor-pointer bg-transparent border-none p-0 text-sm"
                    title="Fullscreen mode"
                  >
                    ⛶
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* AUDIENCE ROW */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-4 mt-auto">
            <div className="flex items-center gap-5 overflow-x-auto pb-1 max-w-full">
              {members.length === 0 ? (
                <div className="text-xs text-[#A89B8C] font-mono py-2">Waiting for members…</div>
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
                      ref={(el) => { seatRefs.current[member.userId] = el; }}
                      onClick={isSelf ? toggleSelfSpeaking : undefined}
                      title={isSelf ? 'Click to toggle mic status' : member.userName}
                      className={`flex flex-col items-center gap-2 flex-shrink-0 ${isSelf ? 'cursor-pointer' : ''}`}
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
                        {member.userName}{isSelf ? ' (You)' : ''}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Reaction pill */}
            <button
              type="button"
              onClick={() => triggerReaction('🔥')}
              className="flex items-center gap-2 bg-[#261E19] hover:bg-[#342821] active:scale-95 px-4 py-2.5 rounded-full text-sm text-[#F3E9DC] cursor-pointer transition-transform border-none flex-shrink-0 self-center"
              title="React"
              aria-label="React"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF9F1C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />
              </svg>
              <span>{reactionCount}</span>
            </button>
          </div>
        </div>

        {/* Sidebar */}
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

      {/* Source Picker Sheet */}
      <SourcePickerSheet
        isOpen={showSourcePicker}
        onClose={() => setShowSourcePicker(false)}
        onSelectSource={handleSelectSource}
        onAddToQueue={handleAddToQueueFromPicker}
        onStartScreenShare={handleStartScreenShare}
        roomCode={roomCode}
      />
    </div>
  );
}
