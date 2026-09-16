'use client';

/**
 * Internal hooks shared by the UI kit (layers, focus trap, scroll lock, floating positioning,
 * controllable state, i18n fallback). Exported from the barrel for advanced use.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { getTranslator, DEFAULT_LOCALE, type Translator } from '@/i18n';
import { useI18n } from '@/i18n/client';
import { computeFloatingPosition, type Align, type Side } from './floating';

export const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/* ------------------------------------------------------------------ */

const noopSubscribe = () => () => {};

/** false during SSR and hydration, true afterwards. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** Live `matchMedia` result (false on the server). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Controlled when `value` is defined, otherwise internal state seeded with `defaultValue`. */
export function useControllableState<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void] {
  const [inner, setInner] = useState<T>(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? (value as T) : inner;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const set = useCallback(
    (next: T) => {
      if (!controlled) setInner(next);
      onChangeRef.current?.(next);
    },
    [controlled],
  );
  return [current, set];
}

/** Calls the user handler first; ours runs unless the user called preventDefault(). */
export function composeHandlers<E extends SyntheticEvent>(
  theirs: ((e: E) => void) | undefined,
  ours: (e: E) => void,
): (e: E) => void {
  return (e: E) => {
    theirs?.(e);
    if (!e.defaultPrevented) ours(e);
  };
}

/* ------------------------------------------------------------------ */
/* Layer stack: only the top-most layer reacts to Esc / traps focus.   */
/* ------------------------------------------------------------------ */

const layerStack: string[] = [];

export function isTopLayer(id: string): boolean {
  return layerStack[layerStack.length - 1] === id;
}

export function hasOpenLayers(): boolean {
  return layerStack.length > 0;
}

/** Registers a layer while `active`; returns its id. */
export function useLayer(active: boolean): string {
  const id = useId();
  useIsoLayoutEffect(() => {
    if (!active) return;
    layerStack.push(id);
    return () => {
      const i = layerStack.lastIndexOf(id);
      if (i >= 0) layerStack.splice(i, 1);
    };
  }, [active, id]);
  return id;
}

/** Esc handler that only fires for the top-most layer. */
export function useEscape(active: boolean, layerId: string, handler: () => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !isTopLayer(layerId)) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, layerId]);
}

/* ------------------------------------------------------------------ */
/* Focus management                                                    */
/* ------------------------------------------------------------------ */

const TABBABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, audio[controls], video[controls], summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';

export function getTabbables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest('[inert]'),
  );
}

interface FocusTrapOptions {
  initialFocus?: RefObject<HTMLElement | null>;
  /** restore focus to the previously focused element on deactivate (default true) */
  restoreFocus?: boolean;
}

/**
 * Keeps keyboard focus inside `ref` while active and top-most. Focuses `initialFocus`, the
 * first element marked `data-autofocus`, the first tabbable element, or the container.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  layerId: string,
  { initialFocus, restoreFocus = true }: FocusTrapOptions = {},
): void {
  useEffect(() => {
    if (!active) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    let raf = 0;
    const focusInitial = () => {
      const container = ref.current;
      if (!container) return;
      if (container.contains(document.activeElement)) return;
      const target =
        initialFocus?.current ??
        container.querySelector<HTMLElement>('[data-autofocus]') ??
        getTabbables(container)[0] ??
        container;
      target.focus({ preventScroll: true });
    };
    raf = requestAnimationFrame(focusInitial);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTopLayer(layerId)) return;
      const container = ref.current;
      if (!container) return;
      const items = getTabbables(container);
      if (items.length === 0) {
        e.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const inside = current ? container.contains(current) : false;
      if (e.shiftKey && (current === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const container = ref.current;
      if (!container || !isTopLayer(layerId)) return;
      const target = e.target as Node | null;
      if (target && !container.contains(target) && !(target as Element).closest?.('[data-exl-toast-region]')) {
        const items = getTabbables(container);
        (items[0] ?? container).focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      if (restoreFocus && previouslyFocused && previouslyFocused.isConnected) {
        // after the exit render so the element is focusable again
        requestAnimationFrame(() => previouslyFocused.focus({ preventScroll: true }));
      }
    };
  }, [active, layerId, ref, initialFocus, restoreFocus]);
}

/* ------------------------------------------------------------------ */
/* Scroll lock (ref-counted)                                           */
/* ------------------------------------------------------------------ */

let lockCount = 0;
let savedStyles: { overflow: string; paddingRight: string } | null = null;

export function useScrollLock(active: boolean): void {
  useIsoLayoutEffect(() => {
    if (!active) return;
    const body = document.body;
    if (lockCount === 0) {
      const scrollbar = window.innerWidth - document.documentElement.clientWidth;
      savedStyles = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
      body.style.overflow = 'hidden';
      // only a real classic scrollbar (a page that overflows horizontally would report its overflow here)
      if (scrollbar > 0 && scrollbar <= 32) body.style.paddingRight = `${scrollbar}px`;
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0 && savedStyles) {
        body.style.overflow = savedStyles.overflow;
        body.style.paddingRight = savedStyles.paddingRight;
        savedStyles = null;
      }
    };
  }, [active]);
}

/* ------------------------------------------------------------------ */
/* Outside click                                                       */
/* ------------------------------------------------------------------ */

export function useOutsidePointerDown(
  active: boolean,
  refs: RefObject<HTMLElement | null>[],
  handler: (e: PointerEvent) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const refsRef = useRef(refs);
  refsRef.current = refs;
  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (refsRef.current.some((r) => r.current?.contains(target))) return;
      handlerRef.current(e);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [active]);
}

/* ------------------------------------------------------------------ */
/* Floating position                                                   */
/* ------------------------------------------------------------------ */

export interface UseFloatingOptions {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  floatingRef: RefObject<HTMLElement | null>;
  side?: Side;
  align?: Align;
  offset?: number;
  padding?: number;
}

export interface FloatingState {
  x: number;
  y: number;
  side: Side;
  available: number;
  /** false until the first measurement (render hidden until then) */
  ready: boolean;
  anchorWidth: number;
}

export function useFloating({
  open,
  anchorRef,
  floatingRef,
  side = 'bottom',
  align = 'center',
  offset = 8,
  padding = 8,
}: UseFloatingOptions): FloatingState {
  const [state, setState] = useState<FloatingState>({ x: 0, y: 0, side, available: 0, ready: false, anchorWidth: 0 });

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;
    const a = anchor.getBoundingClientRect();
    const f = { width: floating.offsetWidth, height: floating.offsetHeight };
    const vv = window.visualViewport;
    const pos = computeFloatingPosition(
      { top: a.top, left: a.left, width: a.width, height: a.height },
      f,
      {
        side,
        align,
        offset,
        padding,
        viewport: { width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight },
      },
    );
    setState((prev) =>
      prev.ready &&
      prev.x === pos.x &&
      prev.y === pos.y &&
      prev.side === pos.side &&
      prev.available === pos.available &&
      prev.anchorWidth === a.width
        ? prev
        : { ...pos, ready: true, anchorWidth: a.width },
    );
  }, [anchorRef, floatingRef, side, align, offset, padding]);

  useIsoLayoutEffect(() => {
    if (!open) {
      setState((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }
    update();
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (anchorRef.current) ro?.observe(anchorRef.current);
    if (floatingRef.current) ro?.observe(floatingRef.current);
    // the floating element may mount one frame later (portal)
    const late = requestAnimationFrame(() => {
      if (floatingRef.current) ro?.observe(floatingRef.current);
      update();
    });
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(late);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
    };
  }, [open, update, anchorRef, floatingRef]);

  return state;
}

/* ------------------------------------------------------------------ */
/* i18n with a safe fallback (components stay usable outside the provider) */
/* ------------------------------------------------------------------ */

const fallbackTranslator = getTranslator(DEFAULT_LOCALE);

export function useUiTranslator(): Translator {
  try {
    // useI18n always calls useContext first, so the hook order is stable even when it throws
    return useI18n();
  } catch {
    return fallbackTranslator;
  }
}
