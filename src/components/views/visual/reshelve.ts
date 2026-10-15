'use client';

/**
 * Re-shelving: when the books on a shelf are rearranged (a filter, the order, a grouping or layout setting – told
 * apart by `signature`), the old arrangement stays on screen for a blink while its books leave together
 * (`phase: 'out'`), then the new one is put back book by book (`phase: 'in'`). The CSS lives in globals.css
 * ("Re-shelving"): put `className` on the shelf container, `exl-rs` + `--rs-i` (the book's place) on every book.
 * Changes that keep the signature (an edited book, a new cover) show at once, without any animation.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';

export type ReshelvePhase = 'idle' | 'out' | 'in';

/** how long the old books take to leave (matches `exl-rs-out` in globals.css) */
export const RESHELVE_OUT_MS = 170;
/** after this the in-animation classes are dropped (books mounted later must not replay it) */
const RESHELVE_IN_MS = 2400;

interface State<T> {
  signature: string;
  phase: ReshelvePhase;
  /** the arrangement shown during the out phase */
  outgoing: T | null;
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useReshelve<T>(value: T, signature: string): { shown: T; phase: ReshelvePhase; className: string } {
  const [state, setState] = useState<State<T>>({ signature, phase: 'idle', outgoing: null });
  /** what was on screen in the last commit */
  const lastShown = useRef(value);

  let current = state;
  if (signature !== state.signature) {
    current = reducedMotion()
      ? { signature, phase: 'idle', outgoing: null }
      : // a change during the out phase keeps the books that are leaving
        { signature, phase: 'out', outgoing: state.phase === 'out' ? state.outgoing : lastShown.current };
    setState(current);
  }
  const shown = current.phase === 'out' && current.outgoing !== null ? current.outgoing : value;

  useEffect(() => {
    lastShown.current = shown;
  });

  useEffect(() => {
    if (current.phase === 'idle') return;
    const timer = window.setTimeout(
      () => setState((s) => (s.phase === 'out' ? { ...s, phase: 'in', outgoing: null } : { ...s, phase: 'idle' })),
      current.phase === 'out' ? RESHELVE_OUT_MS : RESHELVE_IN_MS,
    );
    return () => window.clearTimeout(timer);
  }, [current.phase, current.signature]);

  return { shown, phase: current.phase, className: current.phase === 'idle' ? '' : `exl-rs-${current.phase}` };
}

/** Style of a book with its place in the re-shelving order. */
export function reshelveStyle(index: number, base?: CSSProperties): CSSProperties {
  return { ...base, '--rs-i': index } as CSSProperties;
}
