'use client';

import type { AuthError } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api } from './api';
import { getSupabase } from './supabase';
import type { Onboarding, User } from './types';

interface MeResponse {
  user: User;
  onboarding: Onboarding;
}

/** Thrown by login when the account exists but the email address has not been confirmed yet. */
export class EmailNotConfirmedError extends Error {
  constructor() {
    super('Please confirm your email address first. We sent you a link when you signed up.');
  }
}

interface AuthContextValue {
  loading: boolean;
  user: User | null;
  onboarding: Onboarding | null;
  refresh: () => Promise<void>;
  /** Resolves with needsConfirmation=true when Supabase is waiting for the email link to be opened. */
  signup: (name: string, email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Supabase's error codes are stable; its messages are not, and they are written for developers. */
function friendlyAuthError(error: AuthError): Error {
  switch (error.code) {
    case 'email_not_confirmed':
      return new EmailNotConfirmedError();
    case 'invalid_credentials':
      return new Error('Invalid email or password.');
    case 'user_already_exists':
    case 'email_exists':
      return new Error('An account with this email already exists. Try signing in.');
    case 'weak_password':
      return new Error('That password is too easy to guess. Use at least 8 characters and mix letters and numbers.');
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return new Error('Too many attempts. Please wait a few minutes and try again.');
    case 'same_password':
      return new Error('Choose a password you have not used before.');
    default:
      return new Error(error.message || 'Something went wrong. Please try again.');
  }
}

function origin(): string {
  return window.location.origin;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ loading: boolean; user: User | null; onboarding: Onboarding | null }>({
    loading: true,
    user: null,
    onboarding: null,
  });

  const refresh = useCallback(async () => {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setState({ loading: false, user: null, onboarding: null });
      return;
    }
    try {
      const me = await api<MeResponse>('/auth/me');
      setState({ loading: false, user: me.user, onboarding: me.onboarding });
    } catch (err) {
      // A rejected token means the session is no good any more; anything else (offline, API down) leaves it alone.
      if (err instanceof ApiError && err.status === 401) await supabase.auth.signOut({ scope: 'local' });
      setState({ loading: false, user: null, onboarding: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const { data } = getSupabase().auth.onAuthStateChange((event) => {
      // Supabase warns against calling its own methods inside this callback, so defer to the next tick.
      if (event === 'SIGNED_OUT') {
        setState({ loading: false, user: null, onboarding: null });
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        setTimeout(() => void refresh(), 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      refresh,
      async signup(name, email, password) {
        const { data, error } = await getSupabase().auth.signUp({
          email,
          password,
          options: { data: { name }, emailRedirectTo: `${origin()}/dashboard` },
        });
        if (error) throw friendlyAuthError(error);
        if (data.session) {
          await refresh();
          return { needsConfirmation: false };
        }
        return { needsConfirmation: true };
      },
      async login(email, password) {
        const { error } = await getSupabase().auth.signInWithPassword({ email, password });
        if (error) throw friendlyAuthError(error);
        await refresh();
      },
      async logout() {
        await getSupabase().auth.signOut();
        setState({ loading: false, user: null, onboarding: null });
      },
      async resendConfirmation(email) {
        const { error } = await getSupabase().auth.resend({
          type: 'signup',
          email,
          options: { emailRedirectTo: `${origin()}/dashboard` },
        });
        if (error) throw friendlyAuthError(error);
      },
      async requestPasswordReset(email) {
        const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
          redirectTo: `${origin()}/reset-password`,
        });
        if (error) throw friendlyAuthError(error);
      },
      async updatePassword(password) {
        const { error } = await getSupabase().auth.updateUser({ password });
        if (error) throw friendlyAuthError(error);
      },
    }),
    [state, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
