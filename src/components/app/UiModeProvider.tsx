'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { UI_MODE_COOKIE, type UiMode } from './ui-mode';

interface UiModeValue {
  mode: UiMode;
  /** saves the choice for a year and reloads so the server renders the other shell */
  switchTo: (mode: UiMode) => void;
}

const UiModeContext = createContext<UiModeValue>({ mode: 'web', switchTo: () => undefined });

export function UiModeProvider({ mode, children }: { mode: UiMode; children: ReactNode }) {
  const switchTo = useCallback((next: UiMode) => {
    document.cookie = `${UI_MODE_COOKIE}=${next}; path=/; max-age=${365 * 24 * 3600}; samesite=lax`;
    window.location.reload();
  }, []);
  const value = useMemo(() => ({ mode, switchTo }), [mode, switchTo]);
  return <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>;
}

export function useUiMode(): UiModeValue {
  return useContext(UiModeContext);
}
