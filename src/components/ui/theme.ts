'use client';

/**
 * Theme preference store: localStorage "exl_theme" (light | dark | system) →
 * document.documentElement.dataset.theme (light | dark). The inline script in layout.tsx
 * applies it before paint; this module keeps it in sync afterwards (toggle, OS change, other tabs).
 */
import { useCallback, useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'exl_theme';
const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#f6efe2', dark: '#13100c' };

function isPreference(v: unknown): v is ThemePreference {
  return v === 'light' || v === 'dark' || v === 'system';
}

export function readThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

/** Writes data-theme on <html> and updates the browser UI colour. */
export function applyTheme(pref: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;
  if (root.dataset.theme !== resolved) root.dataset.theme = resolved;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.content = THEME_COLORS[resolved];
  });
  return resolved;
}

const listeners = new Set<() => void>();
let current: ThemePreference | null = null;
let detach: (() => void) | null = null;

function emit() {
  listeners.forEach((l) => l());
}

function attachGlobalListeners() {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystem = () => {
    if ((current ?? readThemePreference()) === 'system') {
      applyTheme('system');
      emit();
    }
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    current = isPreference(e.newValue) ? e.newValue : 'system';
    applyTheme(current);
    emit();
  };
  mql.addEventListener('change', onSystem);
  window.addEventListener('storage', onStorage);
  return () => {
    mql.removeEventListener('change', onSystem);
    window.removeEventListener('storage', onStorage);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!detach && typeof window !== 'undefined') {
    current = readThemePreference();
    applyTheme(current);
    detach = attachGlobalListeners();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && detach) {
      detach();
      detach = null;
    }
  };
}

export function setThemePreference(pref: ThemePreference): void {
  current = pref;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* storage blocked – still apply for this page view */
  }
  applyTheme(pref);
  emit();
}

function getPreferenceSnapshot(): ThemePreference {
  return current ?? readThemePreference();
}

function getResolvedSnapshot(): ResolvedTheme {
  const attr = typeof document !== 'undefined' ? document.documentElement.dataset.theme : undefined;
  return attr === 'dark' ? 'dark' : 'light';
}

/**
 * { preference, resolved, setPreference }. While mounted it also follows the OS setting in
 * "system" mode and syncs across tabs. Server snapshot: system / light.
 */
export function useTheme() {
  const preference = useSyncExternalStore(subscribe, getPreferenceSnapshot, () => 'system' as ThemePreference);
  const resolved = useSyncExternalStore(subscribe, getResolvedSnapshot, () => 'light' as ResolvedTheme);
  const setPreference = useCallback((pref: ThemePreference) => setThemePreference(pref), []);
  return { preference, resolved, setPreference };
}
