'use client';

import React, { useState, useEffect } from 'react';
import { CloseIcon, FilmIcon } from '@/components/icons/CinemaIcons';

/**
 * InstallAppBanner Component
 * Unobtrusive perforated brass cinema pass prompting users on Android, Chrome, and iOS Safari
 * to install WatchParty to their home screen / dock for standalone fullscreen screening.
 */
export function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Register service worker for PWA installability and Web Push
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.debug('[SW] Registration failed:', err);
      });
    }

    // Check if already in standalone PWA mode
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    ) {
      setIsStandalone(true);
      return;
    }

    // Check if dismissed in this session
    if (sessionStorage.getItem('wp_install_banner_dismissed')) {
      setDismissed(true);
      return;
    }

    // Capture Chrome/Edge/Android beforeinstallprompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // Detect iOS Safari
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isAppleDevice = /iphone|ipad|ipod/.test(userAgent);
    const isSafari = isAppleDevice && !/crios|fxios|opios/.test(userAgent);
    if (isSafari) {
      setIsIOS(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('wp_install_banner_dismissed', 'true');
  };

  if (isStandalone || dismissed || (!deferredPrompt && !isIOS)) {
    return null;
  }

  return (
    <aside
      aria-label="Install WatchParty App"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-96 z-40 bg-surface-2 border border-border-brass rounded-ticket shadow-surface p-4 transition-all duration-300 backdrop-blur-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-10 h-10 rounded-sm bg-surface-3 border border-border-brass flex items-center justify-center text-accent flex-shrink-0">
          <FilmIcon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-accent uppercase tracking-wider font-semibold">
              Physical Pass
            </span>
            <span className="text-muted-dark">•</span>
            <span className="font-mono text-[10px] text-muted">Fullscreen Mode</span>
          </div>
          <h4 className="font-display font-semibold text-sm text-text mt-0.5">
            Install WatchParty App
          </h4>
          <p className="text-xs text-muted mt-1 leading-relaxed">
            {isIOS
              ? 'Tap Share ⎋ then "Add to Home Screen" for zero URL bar and cinema immersion.'
              : 'Add to your device for zero URL bar, native lockscreen controls, and uninterrupted screenings.'}
          </p>

          <div className="flex items-center gap-2 mt-3">
            {deferredPrompt && (
              <button
                type="button"
                onClick={handleInstallClick}
                className="min-h-[36px] py-1.5 px-3 bg-accent hover:bg-accent/90 active:scale-95 text-[#0E0B09] font-mono font-bold text-xs rounded-sm shadow-projector transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span>Add to Home Screen</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleDismiss}
              className="min-h-[36px] py-1.5 px-3 bg-surface-3 hover:bg-surface-3/80 border border-border-brass text-muted hover:text-text font-mono text-xs rounded-sm transition-all cursor-pointer"
            >
              Maybe Later
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="min-h-[36px] min-w-[36px] flex items-center justify-center text-muted-dark hover:text-text transition-colors"
          title="Dismiss banner"
          aria-label="Dismiss banner"
        >
          <CloseIcon size={14} />
        </button>
      </div>
    </aside>
  );
}
