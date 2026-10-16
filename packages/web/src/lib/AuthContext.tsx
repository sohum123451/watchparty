'use client';

/**
 * AuthContext – Phase 2
 * Manages: current user, guest identity, token refresh, sign-out.
 * Access token stored in memory only.
 * Refresh token in HttpOnly cookie (handled by server).
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

export interface WpUser {
  id: string;
  email?: string;
  displayName: string;
  username?: string;
  friendCode?: string;
  avatar?: string;
  isEmailVerified?: boolean;
  isGuest?: boolean;
}

interface AuthState {
  user: WpUser | null;
  accessToken: string | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string, inviteCode?: string) => Promise<void>;
  signOut: () => Promise<void>;
  continueAsGuest: (displayName?: string) => Promise<void>;
  refreshToken: () => Promise<string | null>;
  /** Non-null bearer header value when we have a token */
  authHeader: () => string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_API_URL || '');

async function apiFetch(path: string, opts: RequestInit = {}) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    ...opts,
    credentials: 'include', // send/receive HttpOnly cookies
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error || `Error ${res.status}`), { status: res.status });
  return data;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, accessToken: null, loading: true });
  const tokenRef = useRef<string | null>(null);

  // ── helpers ─────────────────────────────────────────────────────────────────

  const setSession = useCallback((user: WpUser | null, accessToken: string | null) => {
    tokenRef.current = accessToken;
    setState({ user, accessToken, loading: false });
    if (typeof window !== 'undefined') {
      if (user) {
        localStorage.setItem('watchparty_user', JSON.stringify(user));
        localStorage.setItem('watchparty_username', user.displayName);
        if (accessToken) sessionStorage.setItem('watchparty_token', accessToken);
      } else {
        localStorage.removeItem('watchparty_user');
        sessionStorage.removeItem('watchparty_token');
      }
    }
  }, []);

  // ── Initial session restore via refresh ────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Try to restore session using httpOnly refresh cookie
        const data = await apiFetch('/api/auth/refresh', { method: 'POST' });
        if (!cancelled && data.user && data.accessToken) {
          setSession(data.user, data.accessToken);
          return;
        }
      } catch {
        // No valid refresh cookie – check localStorage for guest identity
      }
      if (cancelled) return;
      // Restore guest from localStorage
      try {
        const stored = typeof window !== 'undefined' && localStorage.getItem('watchparty_user');
        if (stored) {
          const u: WpUser = JSON.parse(stored);
          if (u.isGuest) {
            const token = sessionStorage.getItem('watchparty_token');
            tokenRef.current = token;
            setState({ user: u, accessToken: token, loading: false });
            return;
          }
        }
      } catch {}
      if (!cancelled) setState((s) => ({ ...s, loading: false }));
    })();
    return () => { cancelled = true; };
  }, [setSession]);

  // ── Auto-refresh access token every 14 minutes ─────────────────────────────

  useEffect(() => {
    if (!state.user || state.user.isGuest) return;
    const id = setInterval(async () => {
      try {
        const data = await apiFetch('/api/auth/refresh', { method: 'POST' });
        if (data.accessToken) {
          tokenRef.current = data.accessToken;
          setState((s) => ({ ...s, accessToken: data.accessToken }));
          sessionStorage.setItem('watchparty_token', data.accessToken);
        }
      } catch {}
    }, 14 * 60 * 1000);
    return () => clearInterval(id);
  }, [state.user]);

  // ── Public API ─────────────────────────────────────────────────────────────

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    setSession(data.user, data.accessToken);
  }, [setSession]);

  const signUp = useCallback(async (email: string, password: string, displayName: string, inviteCode?: string) => {
    const data = await apiFetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName, ...(inviteCode ? { inviteCode } : {}) }),
    });
    setSession(data.user, data.accessToken);
  }, [setSession]);

  const signOut = useCallback(async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch {}
    setSession(null, null);
  }, [setSession]);

  const continueAsGuest = useCallback(async (displayName?: string) => {
    const name = displayName?.trim() || `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
    // Create a guest via server (falls back to local-only if endpoint doesn't exist)
    try {
      const data = await apiFetch('/api/auth/guest', { method: 'POST', body: JSON.stringify({ displayName: name }) });
      const guestUser: WpUser = {
        id: data.user?.id || `guest_${Date.now()}`,
        displayName: data.user?.displayName || name,
        isGuest: true,
      };
      setSession(guestUser, data.accessToken || null);
    } catch {
      // Server doesn't have /api/auth/guest yet – create local-only guest identity
      const guestUser: WpUser = { id: `guest_${Date.now()}`, displayName: name, isGuest: true };
      setSession(guestUser, null);
    }
  }, [setSession]);

  const refreshToken = useCallback(async (): Promise<string | null> => {
    try {
      const data = await apiFetch('/api/auth/refresh', { method: 'POST' });
      if (data.accessToken) {
        tokenRef.current = data.accessToken;
        setState((s) => ({ ...s, accessToken: data.accessToken }));
        sessionStorage.setItem('watchparty_token', data.accessToken);
        return data.accessToken;
      }
    } catch {}
    return null;
  }, []);

  const authHeader = useCallback((): string | null => {
    const t = tokenRef.current;
    return t ? `Bearer ${t}` : null;
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, signIn, signUp, signOut, continueAsGuest, refreshToken, authHeader }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
