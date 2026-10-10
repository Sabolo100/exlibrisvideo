'use client';

/**
 * The signed-in user (Google account) for client components. Filled by app/layout.tsx from the session
 * cookie, so the first paint already knows who is signed in.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { api } from '@/lib/client/api';
import type { SessionUserDTO } from '@/lib/types';

interface SessionValue {
  user: SessionUserDTO | null;
  /** sign-in with Google is configured on the server */
  authEnabled: boolean;
  /** signs out on this device and reloads the home page */
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({ user: null, authEnabled: false, signOut: async () => {} });

export function SessionProvider({ user, authEnabled, children }: { user: SessionUserDTO | null; authEnabled: boolean; children: ReactNode }) {
  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // a full load: every server-rendered page has to forget the owner view
      window.location.assign('/');
    }
  }, []);
  const value = useMemo(() => ({ user, authEnabled, signOut }), [user, authEnabled, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

/** Where the "Sign in with Google" link points (`next`: a same-site path to open afterwards). */
export function signInHref(next?: string | null): string {
  return next ? `/api/auth/google?next=${encodeURIComponent(next)}` : '/api/auth/google';
}
