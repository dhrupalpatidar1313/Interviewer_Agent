'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Onboarding, User } from './types';

interface MeResponse {
  user: User;
  onboarding: Onboarding;
}

interface AuthContextValue {
  loading: boolean;
  user: User | null;
  onboarding: Onboarding | null;
  refresh: () => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ loading: boolean; user: User | null; onboarding: Onboarding | null }>({
    loading: true,
    user: null,
    onboarding: null,
  });

  const refresh = useCallback(async () => {
    try {
      const data = await api<MeResponse>('/auth/me');
      setState({ loading: false, user: data.user, onboarding: data.onboarding });
    } catch {
      setState({ loading: false, user: null, onboarding: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      refresh,
      async signup(name, email, password) {
        await api('/auth/signup', { method: 'POST', body: { name, email, password } });
        await refresh();
      },
      async login(email, password) {
        await api('/auth/login', { method: 'POST', body: { email, password } });
        await refresh();
      },
      async logout() {
        await api('/auth/logout', { method: 'POST', body: {} });
        setState({ loading: false, user: null, onboarding: null });
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
