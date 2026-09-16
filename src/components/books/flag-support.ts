'use client';

import { useSyncExternalStore } from 'react';

let cached: boolean | null = null;

/**
 * true when the platform draws flag emoji (🇭🇺) as one glyph. Windows does not – it prints the two
 * regional-indicator letters instead – so callers can show a neat code badge there.
 * Canvas measurement, cached; assumes support when it cannot measure.
 */
export function detectFlagEmojiSupport(): boolean {
  if (cached !== null) return cached;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return (cached = true);
    ctx.font = '32px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    const pair = ctx.measureText('\u{1F1ED}\u{1F1FA}').width;
    const single = ctx.measureText('\u{1F1ED}').width;
    cached = single <= 0 || pair < single * 1.5;
  } catch {
    cached = true;
  }
  return cached;
}

const noopSubscribe = () => () => {};

/** Hydration-safe hook: true on the server and during hydration, then the measured value. */
export function useFlagEmojiSupport(): boolean {
  return useSyncExternalStore(noopSubscribe, detectFlagEmojiSupport, () => true);
}
