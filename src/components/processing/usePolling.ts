'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Calls `fn` every `intervalMs` while `enabled` (5× slower while the tab is hidden, immediately when it
 * becomes visible again). Calls never overlap. Returns `pollNow()` to trigger a call right away.
 *
 * `immediate` fires the first call as soon as polling starts (mount, or `enabled` turning true) – not when
 * only `intervalMs` changes, so a back-off that grows the interval does not cause extra requests.
 */
export function usePolling(fn: () => Promise<void>, intervalMs: number, enabled: boolean, opts: { immediate?: boolean } = {}): () => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const nowRef = useRef<() => void>(() => {});
  /** polling was already running before this effect run (interval change) */
  const runningRef = useRef(false);
  const immediate = opts.immediate ?? false;

  useEffect(() => {
    if (!enabled) {
      runningRef.current = false;
      nowRef.current = () => {};
      return;
    }
    let alive = true;
    let running = false;
    let again = false;
    let ticked = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startNow = immediate && !runningRef.current;
    runningRef.current = true;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => void tick(), ms);
    };

    const tick = async () => {
      if (!alive) return;
      ticked = true;
      if (running) {
        again = true;
        return;
      }
      running = true;
      clearTimeout(timer);
      try {
        await fnRef.current();
      } catch {
        /* the callback handles its own errors */
      } finally {
        running = false;
      }
      if (!alive) return;
      if (again) {
        again = false;
        schedule(0);
        return;
      }
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      schedule(hidden ? intervalMs * 5 : intervalMs);
    };

    nowRef.current = () => void tick();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    schedule(startNow ? 0 : intervalMs);

    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      nowRef.current = () => {};
      // torn down before the first call happened (React StrictMode re-runs effects): start fresh next time
      if (startNow && !ticked) runningRef.current = false;
    };
  }, [enabled, intervalMs, immediate]);

  // unmount: a later mount starts immediately again
  useEffect(
    () => () => {
      runningRef.current = false;
    },
    [],
  );

  return useCallback(() => nowRef.current(), []);
}
