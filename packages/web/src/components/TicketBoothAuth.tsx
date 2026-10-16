'use client';

/**
 * TicketBoothAuth – Phase 2
 * Real auth using AuthContext: signIn, signUp, continueAsGuest.
 * Screens: sign-in, sign-up, forgot-password, verify-email.
 * No mock data. Inline errors. Loading states. No explainer paragraphs.
 */

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PasswordFilmStripMeter, calculatePasswordStrength } from './PasswordFilmStripMeter';
import { FilmReelSpinner } from './FilmReelSpinner';
import { useAuth } from '@/lib/AuthContext';
import { animate } from 'animejs';
import { MotionDurations, MotionEasings } from '@/motion/tokens';

export type AuthMode = 'login' | 'signup' | 'forgot' | 'verify';

export interface TicketBoothAuthProps {
  initialMode?: AuthMode;
}

const API = process.env.NEXT_PUBLIC_API_URL || '';

async function postJson(path: string, body: object) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

function TicketBoothAuthInner({ initialMode = 'signup' }: TicketBoothAuthProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, signUp, continueAsGuest } = useAuth();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [guestName, setGuestName] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const emailRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLDivElement>(null);

  const shake = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return;
    animate(ref.current, {
      translateX: [-8, 8, -6, 6, -3, 3, 0],
      duration: MotionDurations.snappy,
      ease: MotionEasings.snappyOut,
    });
  };

  const redirect = () => {
    const next = searchParams?.get('next') || '/lobby';
    router.push(next);
  };

  // ── Sign in ─────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.includes('@')) { setErrorMsg('Enter a valid email'); shake(emailRef); return; }
    if (password.length < 8) { setErrorMsg('Password too short'); shake(passwordRef); return; }
    setLoading(true);
    try {
      await signIn(email, password);
      redirect();
    } catch (err: any) {
      setErrorMsg(err.message || 'Sign in failed');
      shake(passwordRef);
    } finally { setLoading(false); }
  };

  // ── Sign up ─────────────────────────────────────────────────────────────────
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.includes('@')) { setErrorMsg('Enter a valid email'); shake(emailRef); return; }
    if (password.length < 8) { setErrorMsg('Password too short'); shake(passwordRef); return; }
    const { score } = calculatePasswordStrength(password);
    if (score < 2) { setErrorMsg('Password too weak — add numbers or symbols'); shake(passwordRef); return; }
    setLoading(true);
    try {
      await signUp(email, password, displayName || email.split('@')[0], inviteCode || undefined);
      redirect();
    } catch (err: any) {
      setErrorMsg(err.message || 'Sign up failed');
      shake(passwordRef);
    } finally { setLoading(false); }
  };

  // ── Forgot password ─────────────────────────────────────────────────────────
  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.includes('@')) { setErrorMsg('Enter a valid email'); shake(emailRef); return; }
    setLoading(true);
    try {
      await postJson('/api/auth/forgot-password', { email });
      setSuccessMsg('Reset link sent — check your email.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Request failed');
    } finally { setLoading(false); }
  };

  // ── Guest ───────────────────────────────────────────────────────────────────
  const handleGuest = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      await continueAsGuest(guestName || undefined);
      redirect();
    } catch (err: any) {
      setErrorMsg(err.message || 'Guest login failed');
    } finally { setLoading(false); }
  };

  // ── Mode helpers ────────────────────────────────────────────────────────────
  const switchMode = (m: AuthMode) => { setMode(m); setErrorMsg(null); setSuccessMsg(null); };

  return (
    <div className="w-full max-w-lg mx-auto">
      <div className="relative bg-[#1A1512] border-2 border-[#3A2E26] rounded-sm shadow-[0_30px_60px_rgba(0,0,0,0.5)] overflow-hidden">

        {/* Header */}
        <div className="bg-[#0E0B09] border-b-2 border-[#3A2E26] px-6 py-4 flex flex-col items-center text-center">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-[#FF9F1C] animate-pulse" />
            <span className="font-mono text-[10px] text-[#FF9F1C] uppercase tracking-widest">
              BOX OFFICE · WILL CALL WINDOW
            </span>
            <span className="w-2 h-2 rounded-full bg-[#FF9F1C] animate-pulse" />
          </div>
          <h2 className="font-display font-semibold text-2xl text-[#F3E9DC]">
            {mode === 'login' && 'Sign in'}
            {mode === 'signup' && 'Get your ticket'}
            {mode === 'forgot' && 'Reset password'}
            {mode === 'verify' && 'Verify email'}
          </h2>

          {/* Mode tabs */}
          {(mode === 'login' || mode === 'signup') && (
            <div className="flex gap-2 mt-4 p-1 bg-[#261E19] rounded-full border border-[#3A2E26]">
              <button type="button" onClick={() => switchMode('signup')}
                className={`px-4 py-1 text-xs font-medium rounded-full transition-all ${mode === 'signup' ? 'bg-[#FF9F1C] text-[#0E0B09] font-bold' : 'text-[#A89B8C] hover:text-[#F3E9DC]'}`}>
                Sign up
              </button>
              <button type="button" onClick={() => switchMode('login')}
                className={`px-4 py-1 text-xs font-medium rounded-full transition-all ${mode === 'login' ? 'bg-[#FF9F1C] text-[#0E0B09] font-bold' : 'text-[#A89B8C] hover:text-[#F3E9DC]'}`}>
                Sign in
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-6 md:p-8 space-y-5">

          {/* Success banner */}
          {successMsg && (
            <div className="p-3 bg-[#2EC4B6]/15 border border-[#2EC4B6]/40 rounded-sm text-xs font-mono text-[#2EC4B6]">
              {successMsg}
            </div>
          )}

          {/* Error banner */}
          {errorMsg && (
            <div className="p-3 bg-[#E4572E]/15 border border-[#E4572E]/40 rounded-sm text-xs text-[#E4572E] flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {errorMsg}
            </div>
          )}

          {/* ── Verify email screen ── */}
          {mode === 'verify' && (
            <div className="text-center space-y-4 py-4">
              <p className="text-sm text-[#A89B8C]">Check your inbox and click the verification link.</p>
              <button type="button" onClick={() => switchMode('login')}
                className="text-[#FF9F1C] font-mono text-sm underline cursor-pointer bg-transparent border-none">
                Back to sign in
              </button>
            </div>
          )}

          {/* ── Forgot password screen ── */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4">
              <div ref={emailRef}>
                <label className="block text-xs font-mono text-[#A89B8C] uppercase tracking-wider mb-1.5">Email</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="patron@watchparty.live"
                  className="w-full bg-[#261E19] border border-[#3A2E26] rounded-sm px-3.5 py-2.5 text-sm text-[#F3E9DC] placeholder-[#5A4A3E] focus:border-[#FF9F1C] outline-none" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full py-3 bg-[#FF9F1C] hover:brightness-105 text-[#0E0B09] font-bold rounded-sm flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer border-none">
                {loading ? <FilmReelSpinner size="sm" /> : 'Send reset link'}
              </button>
              <button type="button" onClick={() => switchMode('login')}
                className="w-full text-center text-xs font-mono text-[#A89B8C] hover:text-[#F3E9DC] cursor-pointer bg-transparent border-none">
                Back to sign in
              </button>
            </form>
          )}

          {/* ── Sign in / Sign up forms ── */}
          {(mode === 'login' || mode === 'signup') && (
            <>
              <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-4">
                {mode === 'signup' && (
                  <div>
                    <label className="block text-xs font-mono text-[#A89B8C] uppercase tracking-wider mb-1.5">Name</label>
                    <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your display name"
                      className="w-full bg-[#261E19] border border-[#3A2E26] rounded-sm px-3.5 py-2.5 text-sm text-[#F3E9DC] placeholder-[#5A4A3E] focus:border-[#FF9F1C] outline-none" />
                  </div>
                )}

                <div ref={emailRef}>
                  <label className="block text-xs font-mono text-[#A89B8C] uppercase tracking-wider mb-1.5">Email</label>
                  <div className="flex items-stretch bg-[#201813] border border-[#3A2E26] rounded-sm overflow-hidden">
                    <div className="bg-[#140F0C] border-r border-dashed border-[#3A2E26] px-3 flex flex-col justify-center items-center relative">
                      <span className="font-mono text-[9px] text-[#FF9F1C] tracking-widest uppercase rotate-180 [writing-mode:vertical-rl]">ADMIT</span>
                      <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#1A1512] border border-[#3A2E26]" />
                    </div>
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="patron@watchparty.live"
                      className="flex-1 bg-transparent border-none px-4 py-2.5 text-sm text-[#F3E9DC] placeholder-[#5A4A3E] focus:outline-none" />
                  </div>
                </div>

                <div ref={passwordRef}>
                  <label className="block text-xs font-mono text-[#A89B8C] uppercase tracking-wider mb-1.5">Password</label>
                  <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full bg-[#261E19] border border-[#3A2E26] rounded-sm px-3.5 py-2.5 text-sm text-[#F3E9DC] placeholder-[#5A4A3E] focus:border-[#FF9F1C] outline-none" />
                  {mode === 'signup' && <PasswordFilmStripMeter password={password} />}
                </div>

                {mode === 'signup' && (
                  <div>
                    <label className="block text-xs font-mono text-[#A89B8C] uppercase tracking-wider mb-1.5">Invite code (optional)</label>
                    <input type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="Enter invite code if you have one"
                      className="w-full bg-[#261E19] border border-[#3A2E26] rounded-sm px-3.5 py-2.5 text-sm text-[#F3E9DC] placeholder-[#5A4A3E] focus:border-[#FF9F1C] outline-none font-mono uppercase tracking-wider" />
                  </div>
                )}

                <button type="submit" disabled={loading}
                  className="w-full py-3 bg-[#FF9F1C] hover:brightness-105 active:brightness-90 text-[#0E0B09] font-display font-bold text-base rounded-sm flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer border-none transition-all">
                  {loading ? <FilmReelSpinner size="sm" /> : mode === 'login' ? 'Enter' : 'Get your ticket'}
                </button>
              </form>

              {/* Forgot password link */}
              {mode === 'login' && (
                <div className="text-center">
                  <button type="button" onClick={() => switchMode('forgot')}
                    className="text-xs font-mono text-[#A89B8C] hover:text-[#FF9F1C] cursor-pointer bg-transparent border-none">
                    Forgot password?
                  </button>
                </div>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[#3A2E26]/60" />
                <span className="text-[10px] font-mono uppercase tracking-widest text-[#A89B8C]">or</span>
                <div className="flex-1 h-px bg-[#3A2E26]/60" />
              </div>

              {/* Guest */}
              <div className="space-y-2">
                <input type="text" value={guestName} onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Guest name (optional)"
                  className="w-full bg-[#261E19] border border-[#3A2E26] rounded-sm px-3.5 py-2 text-sm text-[#F3E9DC] placeholder-[#5A4A3E] focus:border-[#FF9F1C] outline-none" />
                <button type="button" onClick={handleGuest} disabled={loading}
                  className="w-full py-2.5 bg-[#261E19] hover:bg-[#2F251F] border border-[#3A2E26] hover:border-[#FF9F1C] text-[#F3E9DC] font-ui font-medium text-sm rounded-sm flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50 border-solid">
                  {loading ? <FilmReelSpinner size="sm" /> : 'Continue as guest'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function TicketBoothAuth(props: TicketBoothAuthProps) {
  return (
    <React.Suspense fallback={<div className="w-full max-w-lg mx-auto py-12 text-center font-mono text-xs text-[#A89B8C]">Loading box office...</div>}>
      <TicketBoothAuthInner {...props} />
    </React.Suspense>
  );
}
