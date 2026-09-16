'use client';

/**
 * Client hooks shared by the data views (table, authors, topics, stats).
 */
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefCallback } from 'react';

export const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/* ------------------------------------------------------------------ */
/* Persisted view preferences                                          */
/* ------------------------------------------------------------------ */

const PREF_EVENT = 'exl-data-pref';
/** fallback when localStorage is blocked (private mode, disabled storage) */
const memory = new Map<string, string>();

function readPref(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    /* storage unavailable */
  }
  return memory.get(key) ?? null;
}

function writePref(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota exceeded / blocked – the in-memory value still applies in this tab */
  }
  window.dispatchEvent(new CustomEvent<string>(PREF_EVENT, { detail: key }));
}

/**
 * A preference stored as JSON in localStorage (synchronised across tabs and components).
 * Server render and hydration use `fallback`; invalid stored values are ignored.
 */
export function usePersistentState<T>(key: string, fallback: T, isValid: (v: unknown) => v is T): [T, (next: T) => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === key) cb();
      };
      const onLocal = (e: Event) => {
        if ((e as CustomEvent<string>).detail === key) cb();
      };
      window.addEventListener('storage', onStorage);
      window.addEventListener(PREF_EVENT, onLocal);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(PREF_EVENT, onLocal);
      };
    },
    [key],
  );
  const raw = useSyncExternalStore(
    subscribe,
    () => readPref(key),
    () => null,
  );
  let value = fallback;
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isValid(parsed)) value = parsed;
    } catch {
      /* malformed – keep the fallback */
    }
  }
  const set = useCallback((next: T) => writePref(key, JSON.stringify(next)), [key]);
  return [value, set];
}

export const oneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (values as readonly string[]).includes(v);

/* ------------------------------------------------------------------ */
/* Measuring                                                           */
/* ------------------------------------------------------------------ */

/** Content-box size of an element via ResizeObserver (null until measured). */
export function useElementSize<T extends HTMLElement>(): [RefCallback<T>, { width: number; height: number } | null] {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const ref = useCallback((el: T | null) => setNode(el), []);

  useIsoLayoutEffect(() => {
    if (!node) return;
    const update = (width: number, height: number) =>
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    const rect = node.getBoundingClientRect();
    update(Math.floor(node.clientWidth || rect.width), Math.floor(node.clientHeight || rect.height));
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => update(Math.floor(node.clientWidth), Math.floor(node.clientHeight));
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const box = entry.contentBoxSize?.[0];
      const width = Math.floor(box ? box.inlineSize : entry.contentRect.width);
      const height = Math.floor(box ? box.blockSize : entry.contentRect.height);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => update(width, height));
    });
    ro.observe(node);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [node]);

  return [ref, size];
}

/**
 * Pixels at the top of the viewport covered by the page's sticky chrome: the collection toolbar
 * (which sticks under the site header) or, without it, the sticky site header. Sticky elements of a
 * view (index rails, scroll margins) sit below this line. Updates when the chrome resizes.
 */
export function useStickyChromeOffset(toolbarId: string, fallback = 64): number {
  const [offset, setOffset] = useState(fallback);
  useEffect(() => {
    const find = () => document.getElementById(toolbarId) ?? document.querySelector<HTMLElement>('body header.sticky');
    const measure = () => {
      const el = find();
      if (!el) {
        setOffset(0);
        return;
      }
      const top = Number.parseFloat(getComputedStyle(el).top);
      setOffset(Math.max(0, Math.round((Number.isFinite(top) ? top : 0) + el.offsetHeight)));
    };
    measure();
    const el = find();
    const ro = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (el && ro) ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [toolbarId]);
  return offset;
}

/* ------------------------------------------------------------------ */
/* Motion                                                              */
/* ------------------------------------------------------------------ */

/** true when the user asked for reduced motion (false on the server). */
export function usePrefersReducedMotion(): boolean {
  return useReducedMotion() === true;
}

/** Keeps the latest value in a ref for stable callbacks. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useIsoLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** Smooth scrolling unless reduced motion is preferred. */
export function scrollBehavior(reduced: boolean): ScrollBehavior {
  return reduced ? 'auto' : 'smooth';
}
