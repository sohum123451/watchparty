'use client';

import { useEffect } from 'react';

export interface MediaSessionOptions {
  title?: string;
  roomCode?: string;
  posterUrl?: string;
  isPlaying?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onSeekBackward?: () => void;
  onSeekForward?: () => void;
}

/**
 * useMediaSession Hook
 * Integrates browser MediaSession API with OS-level lockscreen, Bluetooth, and taskbar controls.
 */
export function useMediaSession({
  title = 'Cinema Screening',
  roomCode = '',
  posterUrl = '',
  isPlaying = false,
  onPlay,
  onPause,
  onSeekBackward,
  onSeekForward,
}: MediaSessionOptions) {
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    try {
      const artwork = posterUrl
        ? [
            { src: posterUrl, sizes: '512x512', type: 'image/jpeg' },
            { src: posterUrl, sizes: '256x256', type: 'image/jpeg' },
          ]
        : [
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
          ];

      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: roomCode ? `Room #${roomCode}` : 'WatchParty Theatre',
        album: 'WatchParty Private Cinema',
        artwork,
      });

      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

      if (onPlay) {
        navigator.mediaSession.setActionHandler('play', onPlay);
      } else {
        navigator.mediaSession.setActionHandler('play', null);
      }

      if (onPause) {
        navigator.mediaSession.setActionHandler('pause', onPause);
      } else {
        navigator.mediaSession.setActionHandler('pause', null);
      }

      if (onSeekBackward) {
        navigator.mediaSession.setActionHandler('seekbackward', onSeekBackward);
      } else {
        navigator.mediaSession.setActionHandler('seekbackward', null);
      }

      if (onSeekForward) {
        navigator.mediaSession.setActionHandler('seekforward', onSeekForward);
      } else {
        navigator.mediaSession.setActionHandler('seekforward', null);
      }
    } catch (err) {
      console.warn('[MediaSession] Failed to configure media session handlers:', err);
    }

    return () => {
      if (typeof window !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.setActionHandler('play', null);
          navigator.mediaSession.setActionHandler('pause', null);
          navigator.mediaSession.setActionHandler('seekbackward', null);
          navigator.mediaSession.setActionHandler('seekforward', null);
        } catch {
          // Ignore unregister errors
        }
      }
    };
  }, [title, roomCode, posterUrl, isPlaying, onPlay, onPause, onSeekBackward, onSeekForward]);
}
