'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * Screen WakeLock Hook
 * Automatically prevents the device display from dimming or locking during active playback.
 * Automatically releases on pause or unmount, and re-acquires on document visibility return.
 */
export function useWakeLock(isActive: boolean = true) {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const isAcquiringRef = useRef(false);

  const requestWakeLock = useCallback(async () => {
    if (typeof window === 'undefined' || !('wakeLock' in navigator)) {
      return;
    }

    if (sentinelRef.current && !sentinelRef.current.released) {
      return;
    }

    if (isAcquiringRef.current) return;
    isAcquiringRef.current = true;

    try {
      const sentinel = await navigator.wakeLock.request('screen');
      sentinelRef.current = sentinel;

      sentinel.addEventListener('release', () => {
        sentinelRef.current = null;
      });
    } catch (err) {
      // WakeLock request can fail if page is not active or battery saver is active
      console.warn('[WakeLock] Unable to acquire screen wake lock:', err);
    } finally {
      isAcquiringRef.current = false;
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (sentinelRef.current) {
      try {
        await sentinelRef.current.release();
      } catch (err) {
        console.warn('[WakeLock] Release error:', err);
      } finally {
        sentinelRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isActive) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [isActive, requestWakeLock, releaseWakeLock]);

  return {
    isSupported: typeof window !== 'undefined' && 'wakeLock' in navigator,
  };
}
