'use client';

/**
 * Small DOM hooks shared by the visual views (shelf, covers, timeline, frames).
 */
import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefCallback,
} from 'react';

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/* ------------------------------------------------------------------ */
/* Element width (ResizeObserver)                                      */
/* ------------------------------------------------------------------ */

/**
 * Content-box width of an element, floored to whole pixels (null until measured).
 * Measures synchronously on attach (no skeleton flash on client navigation) and then follows
 * ResizeObserver, coalesced to one update per animation frame.
 */
export function useElementWidth<T extends HTMLElement>(): [RefCallback<T>, number | null] {
  const [width, setWidth] = useState<number | null>(null);
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((el: T | null) => setNode(el), []);

  useIsoLayoutEffect(() => {
    if (!node) return;
    const measure = () => {
      const style = window.getComputedStyle(node);
      const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const border = (Number.parseFloat(style.borderLeftWidth) || 0) + (Number.parseFloat(style.borderRightWidth) || 0);
      const w = Math.max(0, Math.floor(node.getBoundingClientRect().width - padding - border));
      setWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const box = entry?.contentBoxSize?.[0];
      const w = Math.max(0, Math.floor(box ? box.inlineSize : entry.contentRect.width));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setWidth((prev) => (prev === w ? prev : w)));
    });
    ro.observe(node);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [node]);

  return [ref, width];
}

/** window.innerHeight, following resizes (fallback before mount). */
export function useViewportHeight(fallback = 800): number {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener('resize', cb);
    return () => window.removeEventListener('resize', cb);
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => window.innerHeight,
    () => fallback,
  );
}

/* ------------------------------------------------------------------ */
/* Persisted preferences (localStorage, SSR-safe, cross-tab)           */
/* ------------------------------------------------------------------ */

const STORAGE_EVENT = 'exl-visual-pref';
/** used when localStorage is unavailable (private mode, blocked storage) */
const memoryStore = new Map<string, string>();

function readRaw(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    if (v !== null) return v;
  } catch {
    /* storage blocked – fall through to memory */
  }
  return memoryStore.get(key) ?? null;
}

function writeRaw(key: string, value: string): void {
  memoryStore.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota / blocked: the in-memory value still applies for this tab */
  }
  window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: key }));
}

/**
 * A view preference persisted in localStorage under `key` (JSON). The server render and the
 * hydration pass use `fallback`; the stored value applies right after hydration.
 * Invalid / foreign stored values are ignored.
 */
export function useStoredState<T>(key: string, fallback: T, isValid: (v: unknown) => v is T): [T, (next: T) => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
      const onStorage = (e: StorageEvent) => {
        if (e.key === null || e.key === key) cb();
      };
      const onLocal = (e: Event) => {
        if ((e as CustomEvent<string>).detail === key) cb();
      };
      window.addEventListener('storage', onStorage);
      window.addEventListener(STORAGE_EVENT, onLocal);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(STORAGE_EVENT, onLocal);
      };
    },
    [key],
  );
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  let value = fallback;
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isValid(parsed)) value = parsed;
    } catch {
      /* ignore malformed values */
    }
  }
  const set = useCallback((next: T) => writeRaw(key, JSON.stringify(next)), [key]);
  return [value, set];
}

export const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (values as readonly string[]).includes(v);

export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

/* ------------------------------------------------------------------ */
/* Near-viewport detection (shared IntersectionObservers)              */
/* ------------------------------------------------------------------ */

type NearCallback = (near: boolean) => void;

interface SharedObserver {
  io: IntersectionObserver;
  callbacks: Map<Element, NearCallback>;
}

/** one observer per (root, rootMargin) – hundreds of rows cost a single IntersectionObserver */
const documentObservers = new Map<string, SharedObserver>();
const elementObservers = new WeakMap<Element, Map<string, SharedObserver>>();

function sharedObserver(root: Element | null, rootMargin: string): SharedObserver {
  let registry: Map<string, SharedObserver>;
  if (root) {
    registry = elementObservers.get(root) ?? new Map();
    elementObservers.set(root, registry);
  } else {
    registry = documentObservers;
  }
  let shared = registry.get(rootMargin);
  if (!shared) {
    const callbacks = new Map<Element, NearCallback>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin, threshold: 0 },
    );
    shared = { io, callbacks };
    registry.set(rootMargin, shared);
  }
  return shared;
}

/*
 * Mounts are staggered: one element becomes "near" per animation frame (FIFO), so a fast scroll
 * that brings ten rows of motion-driven spines into range commits them one row at a time instead of
 * in one long task. Leaving is applied at once. The latest wish per element wins, so a row that
 * scrolled in and straight out again never mounts.
 */
interface NearWish {
  near: boolean;
  /** waiting in the mount queue */
  queued: boolean;
  apply: (near: boolean) => void;
}

const mountQueue: Element[] = [];
const wishes = new Map<Element, NearWish>();
let mountPumpScheduled = false;

function pumpMounts() {
  mountPumpScheduled = false;
  while (mountQueue.length > 0) {
    const el = mountQueue.shift()!;
    const wish = wishes.get(el);
    if (!wish) continue; // unmounted meanwhile
    wish.queued = false;
    if (wish.near) {
      wish.apply(true);
      break;
    }
  }
  if (mountQueue.length > 0) scheduleMountPump();
}

function scheduleMountPump() {
  if (mountPumpScheduled) return;
  mountPumpScheduled = true;
  // one mount per frame, after that frame's paint (rAF, then a macrotask); the timer is a fallback
  // for documents that paint without animation frames (rAF is paused in hidden tabs / previews)
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    window.clearTimeout(fallback);
    pumpMounts();
  };
  const fallback = window.setTimeout(run, 64);
  requestAnimationFrame(() => window.setTimeout(run, 0));
}

function requestNear(el: Element, near: boolean, apply: (near: boolean) => void) {
  let wish = wishes.get(el);
  if (!wish) {
    wish = { near: false, queued: false, apply };
    wishes.set(el, wish);
  }
  wish.apply = apply;
  wish.near = near;
  if (!near) {
    apply(false);
    return;
  }
  if (wish.queued) return;
  wish.queued = true;
  mountQueue.push(el);
  scheduleMountPump();
}

function forgetNear(el: Element) {
  wishes.delete(el);
}

export interface NearViewportOptions {
  /** margin around the root, e.g. "150% 0px" (percentages of the root size) */
  rootMargin?: string;
  /** scroll container; null = the viewport */
  root?: Element | null;
  /** value before the first observation (SSR / first paint) */
  initial?: boolean;
}

/**
 * true while the element is within `rootMargin` of the viewport (or `root`). Used to mount heavy
 * content (interactive spines, covers) progressively and to unmount it again far away.
 * Without IntersectionObserver support everything counts as near.
 */
export function useNearViewport<T extends Element>({
  rootMargin = '120% 0px',
  root = null,
  initial = false,
}: NearViewportOptions = {}): [RefCallback<T>, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [near, setNear] = useState(initial);
  const ref = useCallback((el: T | null) => setNode(el), []);

  useEffect(() => {
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const shared = sharedObserver(root, rootMargin);
    // transitions: the heavy content renders interruptibly (React yields between components);
    // requestNear additionally staggers mounts to one element per frame
    const apply = (v: boolean) => startTransition(() => setNear((prev) => (prev === v ? prev : v)));
    shared.callbacks.set(node, (v) => requestNear(node, v, apply));
    shared.io.observe(node);
    return () => {
      shared.io.unobserve(node);
      shared.callbacks.delete(node);
      forgetNear(node);
    };
  }, [node, root, rootMargin]);

  return [ref, near];
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

/**
 * 'smooth' unless the user prefers reduced motion (the global CSS rule cannot tame script-driven
 * smooth scrolling, so every scrollTo / scrollIntoView of the views goes through this).
 */
export function scrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined' || !window.matchMedia) return 'auto';
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/** Keeps the latest value in a ref (for stable event handlers). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useIsoLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** true when the key event comes from a text field or a widget that owns the arrow keys. */
export function isEditableOrWidgetTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(
    target.closest(
      '[role="radiogroup"],[role="tablist"],[role="menu"],[role="menubar"],[role="listbox"],[role="slider"],[role="grid"],[role="dialog"],[contenteditable="true"]',
    ),
  );
}

export { useIsoLayoutEffect };
