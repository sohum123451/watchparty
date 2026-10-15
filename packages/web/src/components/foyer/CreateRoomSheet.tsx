'use client';

/**
 * CreateRoomSheet Component
 * 3-step slide-over cinema drawer with:
 * 1. Realistic 35mm Progress Film Strip with authentic sprockets and frame exposures
 * 2. Step 1: Film Source (Repertory catalogue or custom MP4/HLS stream URL)
 * 3. Step 2: Suite & Access (Public Foyer, Friends Only, Secret E2EE Vault)
 * 4. Step 3: Sound & Acoustics (Drift sync slider, whisper chat toggle, host lock)
 * 5. Anime.js step transitions and punch-ticket submission flow
 */

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { MOVIE_CATALOGUE, Movie } from '@watchparty/shared';
import { useAnime } from '@/motion/useAnime';
import { MotionDurations, MotionEasings, MotionStaggers } from '@/motion/tokens';
import { stagger } from 'animejs';

export interface CreateRoomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  initialMovie?: Movie | null;
}

export type AccessTier = 'public' | 'friends' | 'secret';

export function CreateRoomSheet({
  isOpen,
  onClose,
  initialMovie = null,
}: CreateRoomSheetProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Step 1: Film Source
  const [selectedMovie, setSelectedMovie] = useState<Movie>(initialMovie || MOVIE_CATALOGUE[0]);
  const [customStreamUrl, setCustomStreamUrl] = useState('');
  const [useCustomStream, setUseCustomStream] = useState(false);
  const [projectionFormat, setProjectionFormat] = useState<'70mm' | '35mm' | '4K HDR' | 'Dolby Atmos'>('70mm');

  // Step 2: Suite & Access
  const [suiteName, setSuiteName] = useState(`${selectedMovie.title} Screening`);
  const [hostName, setHostName] = useState('Projectionist');
  const [accessTier, setAccessTier] = useState<AccessTier>('public');
  const [roomCode, setRoomCode] = useState('');
  const [passphrase, setPassphrase] = useState('');

  // Step 3: Acoustics & Projection Rules
  const [driftToleranceMs, setDriftToleranceMs] = useState(120);
  const [whisperChat, setWhisperChat] = useState(true);
  const [hostLock, setHostLock] = useState(false);
  const [ambientGlow, setAmbientGlow] = useState(true);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update initial movie when prop changes
  useEffect(() => {
    if (initialMovie) {
      setSelectedMovie(initialMovie);
      setSuiteName(`${initialMovie.title} Screening`);
    }
  }, [initialMovie]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Animate step form entrance
  const formContainerRef = useRef<HTMLDivElement>(null);
  useAnime(
    ({ animate, reducedMotion }) => {
      if (reducedMotion) return;
      animate('.step-field-entrance', {
        opacity: [0, 1],
        translateX: [16, 0],
        delay: stagger(MotionStaggers.tight, { start: 20 }),
        duration: MotionDurations.cinematic,
        ease: MotionEasings.snappyOut,
      });
    },
    [currentStep],
    { containerRef: formContainerRef }
  );

  const generateRandomCode = () => {
    const prefixes = ['CRITERION', 'IMAX', 'DECK', 'TICKET', 'CINEMA', 'REEL'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    setRoomCode(`${prefix}-${num}`);
  };

  const handleFinishAndIlluminate = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Punch ticket sound & transition
    setTimeout(() => {
      const code = roomCode.trim();
      if (code) {
        router.push(`/join/${encodeURIComponent(code)}`);
      }
    }, 450);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      {/* 1. WARM VELVET BACKDROP */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-[#0E0B09]/80 backdrop-blur-md transition-opacity duration-300"
      />

      {/* 2. SLIDE-OVER SHEET DRAWER */}
      <div className="relative z-50 w-full max-w-xl bg-surface border-l border-border-brass flex flex-col justify-between shadow-velvet-raised overflow-hidden">
        {/* TOP: 35MM PROGRESS FILM STRIP HEADER */}
        <div>
          {/* Authentic Sprocket Hole Row (Top Margin) */}
          <div className="h-4 bg-[#0E0B09] flex items-center justify-between px-3 border-b border-border-subtle overflow-hidden">
            <span className="font-mono text-[9px] text-muted tracking-widest uppercase">
              35mm KODAK SAFETY FILM 400
            </span>
            <div className="flex gap-2">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="w-2.5 h-1.5 rounded-[1px] bg-surface-3 border border-border-brass/40" />
              ))}
            </div>
          </div>

          {/* Film Strip Progress Frames */}
          <div className="p-4 bg-surface-2 border-b border-border-brass">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                <span className="font-display font-bold text-sm text-text">
                  SUITE COMMISSIONING REEL
                </span>
              </div>
              <button
                onClick={onClose}
                className="p-1 px-2 text-muted hover:text-text hover:bg-surface-3 rounded-sm font-mono text-sm cursor-pointer"
                title="Close Drawer (Esc)"
              >
                ✕
              </button>
            </div>

            {/* 3 Physical 35mm Progress Frames */}
            <div className="grid grid-cols-3 gap-2">
              {/* Frame 01 */}
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className={`p-2.5 rounded-sm border text-left transition-all relative overflow-hidden cursor-pointer ${
                  currentStep === 1
                    ? 'bg-surface-3 border-accent text-accent shadow-projector'
                    : currentStep > 1
                    ? 'bg-surface-3/60 border-live/50 text-live'
                    : 'bg-bg/60 border-border-subtle opacity-60 text-muted'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                  <span>FRAME 01</span>
                  {currentStep > 1 && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                <div className="font-display font-bold text-xs">
                  Film Source
                </div>
                <div className="text-[10px] font-mono text-muted truncate mt-0.5">
                  {useCustomStream ? 'Custom URL' : selectedMovie.title}
                </div>
              </button>

              {/* Frame 02 */}
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className={`p-2.5 rounded-sm border text-left transition-all relative overflow-hidden cursor-pointer ${
                  currentStep === 2
                    ? 'bg-surface-3 border-accent text-accent shadow-projector'
                    : currentStep > 2
                    ? 'bg-surface-3/60 border-live/50 text-live'
                    : 'bg-bg/60 border-border-subtle opacity-60 text-muted'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                  <span>FRAME 02</span>
                  {currentStep > 2 && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                <div className="font-display font-bold text-xs">
                  Suite & Access
                </div>
                <div className="text-[10px] font-mono text-muted truncate mt-0.5 uppercase">
                  {accessTier} tier
                </div>
              </button>

              {/* Frame 03 */}
              <button
                type="button"
                onClick={() => setCurrentStep(3)}
                className={`p-2.5 rounded-sm border text-left transition-all relative overflow-hidden cursor-pointer ${
                  currentStep === 3
                    ? 'bg-surface-3 border-accent text-accent shadow-projector'
                    : 'bg-bg/60 border-border-subtle opacity-60 text-muted'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                  <span>FRAME 03</span>
                </div>
                <div className="font-display font-bold text-xs">
                  Acoustics
                </div>
                <div className="text-[10px] font-mono text-muted truncate mt-0.5">
                  {driftToleranceMs}ms Sync
                </div>
              </button>
            </div>
          </div>

          {/* Authentic Sprocket Hole Row (Bottom Margin) */}
          <div className="h-3 bg-[#0E0B09] flex items-center justify-between px-3 border-b border-border-brass overflow-hidden">
            <div className="flex gap-2">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="w-2.5 h-1.5 rounded-[1px] bg-surface-3 border border-border-brass/40" />
              ))}
            </div>
            <span className="font-mono text-[9px] text-muted tracking-widest uppercase">
              REEL SYNCHRONOUS
            </span>
          </div>
        </div>

        {/* MIDDLE: INTERACTIVE STEP FORM CONTENT */}
        <div ref={formContainerRef} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* ================= STEP 1: FILM SOURCE ================= */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="step-field-entrance">
                <span className="text-xs font-mono text-accent uppercase tracking-widest">
                  Step 1 of 3
                </span>
                <h3 className="font-display font-bold text-xl text-text mt-1">
                  Load Projection Print
                </h3>
                <p className="text-xs text-muted font-sans mt-1">
                  Choose a restored print from our 35mm/70mm archives or provide an external MP4 stream.
                </p>
              </div>

              {/* Toggle: Archive vs Custom Stream */}
              <div className="step-field-entrance grid grid-cols-2 gap-2 p-1 bg-surface-2 border border-border-subtle rounded-sm font-mono text-xs">
                <button
                  type="button"
                  onClick={() => setUseCustomStream(false)}
                  className={`py-1.5 text-center rounded-[2px] transition-all cursor-pointer ${
                    !useCustomStream
                      ? 'bg-accent text-bg font-bold shadow-sm'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  Vault
                </button>
                <button
                  type="button"
                  onClick={() => setUseCustomStream(true)}
                  className={`py-1.5 text-center rounded-[2px] transition-all cursor-pointer ${
                    useCustomStream
                      ? 'bg-accent text-bg font-bold shadow-sm'
                      : 'text-muted hover:text-text'
                  }`}
                >
                  Stream URL
                </button>
              </div>

              {!useCustomStream ? (
                /* Select From Catalogue */
                <div className="step-field-entrance space-y-3">
                  <label className="text-xs font-mono text-muted uppercase">
                    Selected Print:
                  </label>
                  <div className="flex items-center gap-4 p-3 bg-surface-2 border border-border-brass rounded-sm">
                    <img
                      src={selectedMovie.posterUrl}
                      alt={selectedMovie.title}
                      className="w-16 h-24 object-cover rounded-sm border border-border-brass"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-display font-bold text-base text-text">
                          {selectedMovie.title}
                        </span>
                        <span className="text-[10px] font-mono text-accent">
                          ★ {selectedMovie.rating}
                        </span>
                      </div>
                      <div className="text-xs font-sans text-muted mt-1">
                        Dir. {selectedMovie.director} &bull; {selectedMovie.year} &bull; {selectedMovie.runtime}m
                      </div>
                      <div className="text-[11px] font-mono text-live mt-1 flex items-center gap-1">
                        <span>● Playable MP4 Stream Synced</span>
                      </div>
                    </div>
                  </div>

                  {/* Quick selection chips for other popular titles */}
                  <div>
                    <label className="text-xs font-mono text-muted uppercase block mb-2">
                      Swap with other vault titles:
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {MOVIE_CATALOGUE.slice(0, 6).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedMovie(m);
                            setSuiteName(`${m.title} Screening`);
                          }}
                          className={`p-2 rounded-sm border text-left transition-all text-xs font-sans cursor-pointer active:scale-95 ${
                            selectedMovie.id === m.id
                              ? 'bg-surface-3 border-accent text-accent font-semibold'
                              : 'bg-surface-2 border-border-subtle text-muted hover:text-text hover:border-border-brass'
                          }`}
                        >
                          <div className="truncate font-medium">{m.title}</div>
                          <div className="text-[10px] font-mono text-muted">{m.year}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Custom Stream URL Input */
                <div className="step-field-entrance space-y-4">
                  <div>
                    <label className="text-xs font-mono text-muted uppercase block mb-1.5">
                      Direct MP4 / HLS Video URL:
                    </label>
                    <input
                      type="url"
                      value={customStreamUrl}
                      onChange={(e) => setCustomStreamUrl(e.target.value)}
                      placeholder="https://commondatastorage.googleapis.com/.../movie.mp4"
                      className="w-full px-3 py-2 bg-bg border border-border-brass rounded-sm font-mono text-xs text-text placeholder-muted focus:outline-none focus:border-accent"
                    />
                    <span className="text-[10px] font-mono text-muted mt-1 block">
                      Compatible with HTML5 MP4, WebM, and standard video streaming CDNs.
                    </span>
                  </div>

                  <div>
                    <label className="text-xs font-mono text-muted uppercase block mb-1.5">
                      Film Title / Label:
                    </label>
                    <input
                      type="text"
                      value={suiteName}
                      onChange={(e) => setSuiteName(e.target.value)}
                      className="w-full px-3 py-2 bg-bg border border-border-brass rounded-sm font-sans text-sm text-text focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              )}

              {/* Format Tag Selector */}
              <div className="step-field-entrance">
                <label className="text-xs font-mono text-muted uppercase block mb-2">
                  Emulsion & Sound Standard:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['70mm', '35mm', '4K HDR', 'Dolby Atmos'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setProjectionFormat(fmt)}
                      className={`p-2.5 rounded-sm border text-left font-mono text-xs transition-all cursor-pointer active:scale-95 ${
                        projectionFormat === fmt
                          ? 'bg-surface-3 border-accent text-accent font-bold shadow-sm'
                          : 'bg-surface-2 border-border-subtle text-muted hover:text-text hover:border-border-brass'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
                        <span>{fmt}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================= STEP 2: SUITE & ACCESS ================= */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="step-field-entrance">
                <span className="text-xs font-mono text-accent uppercase tracking-widest">
                  Step 2 of 3
                </span>
                <h3 className="font-display font-bold text-xl text-text mt-1">
                  Suite Credentials & Access
                </h3>
                <p className="text-xs text-muted font-sans mt-1">
                  Name your private suite and choose who is admitted through the foyer velvet ropes.
                </p>
              </div>

              {/* Suite Name & Host Alias */}
              <div className="step-field-entrance space-y-4">
                <div>
                  <label className="text-xs font-mono text-muted uppercase block mb-1.5">
                    Suite Name:
                  </label>
                  <input
                    type="text"
                    value={suiteName}
                    onChange={(e) => setSuiteName(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border-brass rounded-sm font-sans text-sm text-text focus:outline-none focus:border-accent"
                  />
                </div>

                <div>
                  <label className="text-xs font-mono text-muted uppercase block mb-1.5">
                    Projectionist Host Call-Sign:
                  </label>
                  <input
                    type="text"
                    value={hostName}
                    onChange={(e) => setHostName(e.target.value)}
                    className="w-full px-3 py-2 bg-bg border border-border-brass rounded-sm font-sans text-sm text-text focus:outline-none focus:border-accent"
                  />
                </div>
              </div>

              {/* Access Tier Radio Options */}
              <div className="step-field-entrance space-y-2">
                <label className="text-xs font-mono text-muted uppercase block mb-1">
                  Admission Policy:
                </label>

                {/* Tier 1: Public */}
                <div
                  onClick={() => setAccessTier('public')}
                  className={`p-3 rounded-sm border cursor-pointer transition-all flex items-start gap-3 active:scale-98 ${
                    accessTier === 'public'
                      ? 'bg-surface-3 border-accent text-text shadow-sm'
                      : 'bg-surface-2 border-border-subtle text-muted hover:border-border-brass'
                  }`}
                >
                  <span className="text-live text-lg">●</span>
                  <div>
                    <div className="font-display font-bold text-sm text-text">
                      Public Foyer
                    </div>
                    <div className="text-xs font-sans text-muted mt-0.5">
                      Visible in Now Showing lobby. Any patron with the suite pass code can enter.
                    </div>
                  </div>
                </div>

                {/* Tier 2: Friends Only */}
                <div
                  onClick={() => setAccessTier('friends')}
                  className={`p-3 rounded-sm border cursor-pointer transition-all flex items-start gap-3 active:scale-98 ${
                    accessTier === 'friends'
                      ? 'bg-surface-3 border-accent text-text shadow-sm'
                      : 'bg-surface-2 border-border-subtle text-muted hover:border-border-brass'
                  }`}
                >
                  <span className="text-accent text-lg">●</span>
                  <div>
                    <div className="font-display font-bold text-sm text-text">
                      Foyer Circle Only
                    </div>
                    <div className="text-xs font-sans text-muted mt-0.5">
                      Only patrons in your friend circle receive ticket stubs to join.
                    </div>
                  </div>
                </div>

                {/* Tier 3: Secret Vault */}
                <div
                  onClick={() => setAccessTier('secret')}
                  className={`p-3 rounded-sm border cursor-pointer transition-all flex items-start gap-3 active:scale-98 ${
                    accessTier === 'secret'
                      ? 'bg-surface-3 border-accent text-text shadow-sm'
                      : 'bg-surface-2 border-border-subtle text-muted hover:border-border-brass'
                  }`}
                >
                  <span className="text-accent-2 text-lg">●</span>
                  <div>
                    <div className="font-display font-bold text-sm text-text">
                      Encrypted Secret Vault (E2EE)
                    </div>
                    <div className="text-xs font-sans text-muted mt-0.5">
                      End-to-End Encrypted via WebCrypto AES-GCM. Requires a secret passphrase.
                    </div>
                  </div>
                </div>
              </div>

              {/* Passphrase field if secret */}
              {accessTier === 'secret' && (
                <div className="step-field-entrance">
                  <label className="text-xs font-mono text-accent-2 uppercase block mb-1.5">
                    Secret Admission Passphrase:
                  </label>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter cryptographic secret..."
                    className="w-full px-3 py-2 bg-bg border border-accent-2 rounded-sm font-mono text-xs text-text focus:outline-none"
                  />
                </div>
              )}

              {/* Room Code */}
              <div className="step-field-entrance pt-2 border-t border-border-brass">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-mono text-muted uppercase">
                    Admission Ticket Stub Code:
                  </label>
                  <button
                    type="button"
                    onClick={generateRandomCode}
                    className="text-[10px] font-mono text-accent hover:underline cursor-pointer"
                  >
                    New code
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    className="flex-1 px-3 py-2 bg-bg border border-border-brass rounded-sm font-mono text-sm tracking-wider text-accent font-bold uppercase focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ================= STEP 3: SOUND & ACOUSTICS ================= */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="step-field-entrance">
                <span className="text-xs font-mono text-accent uppercase tracking-widest">
                  Step 3 of 3
                </span>
                <h3 className="font-display font-bold text-xl text-text mt-1">
                  Acoustic & Sync Rules
                </h3>
                <p className="text-xs text-muted font-sans mt-1">
                  Fine-tune playback synchronization and patron interaction policies for this screening.
                </p>
              </div>

              {/* Drift Threshold Slider */}
              <div className="step-field-entrance space-y-2 p-3 bg-surface-2 border border-border-brass rounded-sm">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-mono text-text font-bold">
                    Drift Sync Tolerance:
                  </span>
                  <span className="text-xs font-mono text-accent font-bold">
                    {driftToleranceMs} ms
                  </span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="400"
                  step="10"
                  value={driftToleranceMs}
                  onChange={(e) => setDriftToleranceMs(Number(e.target.value))}
                  className="w-full accent-accent cursor-pointer"
                />
                <div className="flex justify-between text-[10px] font-mono text-muted">
                  <span>40ms (Frame Tight)</span>
                  <span>120ms (Auditorium Default)</span>
                  <span>400ms (High Latency)</span>
                </div>
              </div>

              {/* Interactive Policy Toggles */}
              <div className="step-field-entrance space-y-3">
                {/* Spatial Whisper */}
                <div
                  onClick={() => setWhisperChat(!whisperChat)}
                  className="p-3 bg-surface-2 border border-border-subtle rounded-sm flex items-center justify-between cursor-pointer hover:border-border-brass transition-all"
                >
                  <div className="space-y-0.5">
                    <div className="font-display font-bold text-sm text-text">
                      Spatial Whisper Chat
                    </div>
                    <div className="text-xs font-sans text-muted">
                      Allows patrons to whisper without speaking over dramatic dialogue.
                    </div>
                  </div>
                  <div
                    className={`w-9 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                      whisperChat ? 'bg-live justify-end' : 'bg-surface-3 justify-start'
                    }`}
                  >
                    <div className="w-4 h-4 rounded-full bg-text shadow-sm" />
                  </div>
                </div>

                {/* Host Shutter Lock */}
                <div
                  onClick={() => setHostLock(!hostLock)}
                  className="p-3 bg-surface-2 border border-border-subtle rounded-sm flex items-center justify-between cursor-pointer hover:border-border-brass transition-all"
                >
                  <div className="space-y-0.5">
                    <div className="font-display font-bold text-sm text-text">
                      Master Projectionist Control Lock
                    </div>
                    <div className="text-xs font-sans text-muted">
                      Only host can pause, seek, or change film reels during playback.
                    </div>
                  </div>
                  <div
                    className={`w-9 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                      hostLock ? 'bg-live justify-end' : 'bg-surface-3 justify-start'
                    }`}
                  >
                    <div className="w-4 h-4 rounded-full bg-text shadow-sm" />
                  </div>
                </div>

                {/* Ambient Marquee Glow */}
                <div
                  onClick={() => setAmbientGlow(!ambientGlow)}
                  className="p-3 bg-surface-2 border border-border-subtle rounded-sm flex items-center justify-between cursor-pointer hover:border-border-brass transition-all"
                >
                  <div className="space-y-0.5">
                    <div className="font-display font-bold text-sm text-text">
                      Projector Ambient Reflection
                    </div>
                    <div className="text-xs font-sans text-muted">
                      Casts dynamic light sheens onto cinema borders based on film colors.
                    </div>
                  </div>
                  <div
                    className={`w-9 h-5 rounded-full transition-colors p-0.5 flex items-center ${
                      ambientGlow ? 'bg-live justify-end' : 'bg-surface-3 justify-start'
                    }`}
                  >
                    <div className="w-4 h-4 rounded-full bg-text shadow-sm" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* BOTTOM: FOOTER NAVIGATION CONTROLS */}
        <div className="p-4 bg-surface-2 border-t border-border-brass flex items-center justify-between gap-3">
          {currentStep > 1 ? (
            <button
              type="button"
              onClick={() => setCurrentStep((prev) => (prev - 1) as 1 | 2)}
              className="py-2.5 px-4 bg-surface-3 hover:bg-surface border border-border-brass rounded-sm font-mono text-xs text-text transition-all cursor-pointer active:scale-95"
            >
              ⮌ Back
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 bg-surface-3 hover:bg-surface border border-border-brass rounded-sm font-mono text-xs text-muted hover:text-text transition-all cursor-pointer active:scale-95"
            >
              Cancel
            </button>
          )}

          {currentStep < 3 ? (
            <button
              type="button"
              onClick={() => setCurrentStep((prev) => (prev + 1) as 2 | 3)}
              className="flex-1 py-2.5 px-4 bg-accent hover:bg-accent/90 active:scale-95 text-[#0E0B09] font-mono font-bold text-xs rounded-sm shadow-projector transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Next Frame</span>
              <span>➔</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinishAndIlluminate}
              disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 bg-accent hover:bg-accent/90 active:scale-95 disabled:opacity-50 text-[#0E0B09] font-mono font-bold text-xs rounded-sm shadow-projector transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
              <span>
                {isSubmitting
                  ? 'Punching...'
                  : 'Punch Ticket'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
