'use client';

/**
 * "Install the app" (PWA): Chrome fires `beforeinstallprompt` once, early – often before the button that
 * wants it is on screen – so it is caught here at start-up and kept. Also registers the service worker.
 */
import { useEffect, useState } from 'react';

export type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

/** Called once from the root layout. */
export function startPwa(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }
}

/** Shows the browser's install dialog; false when the browser did not offer one (iOS, already installed). */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  notify();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

export function useInstallState(): { canPrompt: boolean; standalone: boolean; ios: boolean } {
  const [state, setState] = useState({ canPrompt: false, standalone: false, ios: false });
  useEffect(() => {
    const update = () =>
      setState({ canPrompt: !!deferred, standalone: isStandalone(), ios: /iphone|ipad|ipod/i.test(navigator.userAgent) });
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return state;
}
