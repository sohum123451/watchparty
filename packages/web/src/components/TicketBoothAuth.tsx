'use client';

/**
 * Ticket Booth Authentication Component (Login & Signup)
 * Styled like a physical cinema Box Office window.
 * - The email field is an authentic ticket stub with perforated seam.
 * - Password strength is visualized via a 35mm film-strip meter.
 * - Errors trigger an inline anime.js tactile shake animation.
 * - The submit action is "Get your ticket".
 */

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PasswordFilmStripMeter, calculatePasswordStrength } from './PasswordFilmStripMeter';
import { FilmReelSpinner } from './FilmReelSpinner';
import { useAnime } from '@/motion/useAnime';
import { MotionDurations, MotionEasings } from '@/motion/tokens';
import { animate } from 'animejs';

export interface TicketBoothAuthProps {
  initialMode?: 'login' | 'signup';
}

export function TicketBoothAuth({ initialMode = 'signup' }: TicketBoothAuthProps) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ticketIssued, setTicketIssued] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const emailStubRef = useRef<HTMLDivElement>(null);
  const passwordGroupRef = useRef<HTMLDivElement>(null);

  // Trigger tactile error shake
  const triggerErrorShake = (fieldRef: React.RefObject<HTMLDivElement | null>) => {
    if (!fieldRef.current) return;
    animate(fieldRef.current, {
      translateX: [-8, 8, -6, 6, -3, 3, 0],
      duration: MotionDurations.snappy,
      ease: MotionEasings.snappyOut,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    // Validation
    if (!email || !email.includes('@')) {
      setErrorMsg('Please punch a valid email onto your admission pass.');
      triggerErrorShake(emailStubRef);
      return;
    }

    if (password.length < 8) {
      setErrorMsg('Passphrase must be at least 8 characters long (35mm emulsion density).');
      triggerErrorShake(passwordGroupRef);
      return;
    }

    if (mode === 'signup') {
      const { score } = calculatePasswordStrength(password);
      if (score < 2) {
        setErrorMsg('Passphrase emulsion is too fragile. Add numbers or special characters.');
        triggerErrorShake(passwordGroupRef);
        return;
      }
    }

    setLoading(true);

    try {
      // In development or local mode, call server auth endpoint or simulate instant ticket issue
      const endpoint = mode === 'signup' ? '/api/auth/register' : '/api/auth/login';
      const payload = mode === 'signup'
        ? { email, password, displayName: displayName || email.split('@')[0] }
        : { email, password };

      const res = await fetch(`http://localhost:3001${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => null);

      if (res && !res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Box office admission rejected. Check your credentials.');
      }

      setTicketIssued(true);
      setTimeout(() => {
        router.push('/');
      }, 1600);
    } catch (err: any) {
      setErrorMsg(err.message || 'Box office request failed. Please check your credentials.');
      triggerErrorShake(passwordGroupRef);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* TICKET BOOTH ARCHITECTURE FAÇADE */}
      <div className="relative bg-surface border-2 border-border-brass rounded-sm shadow-velvet-raised overflow-hidden">
        {/* Overhead Brass Marquee Sign */}
        <div className="bg-[#0E0B09] border-b-2 border-border-brass px-6 py-4 flex flex-col items-center justify-center text-center relative">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="font-mono text-[10px] text-accent uppercase tracking-widest">
              BOX OFFICE &bull; WILL CALL WINDOW
            </span>
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          </div>
          <h2 className="font-display font-semibold text-2xl text-text">
            {mode === 'signup' ? 'Get your ticket' : 'Sign in'}
          </h2>
          <p className="text-sm text-muted mt-1">
            {mode === 'signup'
              ? 'Claim your admission pass.'
              : 'Enter your room.'}
          </p>

          {/* Mode Switcher Tabs */}
          <div className="flex gap-2 mt-4 p-1 bg-surface-2 rounded-full border border-border-brass">
            <button
              type="button"
              onClick={() => { setMode('signup'); setErrorMsg(null); }}
              className={`px-4 py-1 text-xs font-ui font-medium rounded-full transition-all ${
                mode === 'signup'
                  ? 'bg-accent text-[#0E0B09] font-bold shadow-none'
                  : 'text-muted hover:text-text'
              }`}
            >
              Sign up
            </button>
            <button
              type="button"
              onClick={() => { setMode('login'); setErrorMsg(null); }}
              className={`px-4 py-1 text-xs font-ui font-medium rounded-full transition-all ${
                mode === 'login'
                  ? 'bg-accent text-[#0E0B09] font-bold shadow-none'
                  : 'text-muted hover:text-text'
              }`}
            >
              Sign in
            </button>
          </div>
        </div>

        {/* BOX OFFICE FORM BODY */}
        <form ref={formRef} onSubmit={handleSubmit} className="p-6 md:p-8 space-y-6">
          {/* TICKET ISSUED SUCCESS BANNER */}
          {ticketIssued && (
            <div className="p-4 bg-accent/20 border border-accent rounded-sm text-center animate-pulse">
              <span className="font-mono text-xs text-accent font-bold block mb-1">
                ADMISSION GRANTED • TICKET PUNCHED
              </span>
              <p className="text-xs text-text">
                Welcome to the auditorium. Ushering you into Balcony Suite...
              </p>
            </div>
          )}

          {/* DISPLAY NAME (Only for Sign Up) */}
          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-mono text-muted uppercase tracking-wider mb-1.5">
                Name
              </label>
              <input
                type="text"
                placeholder="e.g. Elena Rostova"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-surface-2 border border-border-brass rounded-sm px-3.5 py-2.5 text-sm text-text placeholder-muted-dark focus:border-accent focus:shadow-projector outline-none transition-all shadow-velvet-inset"
              />
            </div>
          )}

          {/* EMAIL FIELD AS AN AUTHENTIC TICKET STUB */}
          <div ref={emailStubRef} className="relative">
            <label className="block text-xs font-mono text-muted uppercase tracking-wider mb-1.5">
              Email
            </label>

            {/* The Ticket Stub Container */}
            <div className="relative bg-[#201813] border border-border-brass rounded-sm overflow-hidden flex items-stretch shadow-velvet-raised">
              {/* Left Stub Badge */}
              <div className="bg-[#140F0C] border-r border-dashed border-border-brass px-3 py-3 flex flex-col justify-center items-center select-none relative">
                <span className="font-mono text-[9px] text-accent tracking-widest uppercase rotate-180 [writing-mode:vertical-rl]">
                  ADMIT ONE
                </span>
                {/* Semicircular Perforation Notch */}
                <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-surface border border-border-brass" />
              </div>

              {/* Stub Input Body */}
              <div className="flex-1 p-3 flex flex-col justify-center pl-4">
                <input
                  type="email"
                  required
                  placeholder="patron@watchparty.live"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-transparent border-none text-text text-sm font-sans placeholder-muted-dark focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* PASSWORD FIELD WITH FILM-STRIP METER */}
          <div ref={passwordGroupRef}>
            <label className="block text-xs font-mono text-muted uppercase tracking-wider mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface-2 border border-border-brass rounded-sm px-3.5 py-2.5 text-sm text-text placeholder-muted-dark focus:border-accent focus:shadow-projector outline-none transition-all shadow-velvet-inset"
            />

            {/* Film-Strip Password Strength Meter */}
            {mode === 'signup' && (
              <PasswordFilmStripMeter password={password} />
            )}
          </div>

          {/* INLINE ERROR WITH MARQUEE ALERT */}
          {errorMsg && (
            <div className="p-3 bg-danger/15 border border-danger/50 rounded-sm flex items-center gap-2.5 text-xs text-[#FF5A6E] animate-fadeIn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" className="flex-shrink-0">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{errorMsg}</span>
            </div>
          )}

          {/* SUBMIT BUTTON: "Get your ticket" */}
          <button
            type="submit"
            disabled={loading || ticketIssued}
            className="w-full py-3.5 bg-accent hover:bg-[#FFAE38] active:bg-[#E6880C] text-[#0E0B09] font-display font-bold text-base tracking-wide rounded-sm transition-all shadow-projector flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {loading ? (
              <FilmReelSpinner size="sm" />
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
                <span>{mode === 'signup' ? 'Get your ticket' : 'Enter'}</span>
              </>
            )}
          </button>

        </form>
      </div>
    </div>
  );
}
