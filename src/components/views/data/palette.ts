/**
 * Chart colours of the stats dashboard (owner: views-data).
 *
 * Categorical slots (category donut) – a muted "library" set, validated with the dataviz
 * palette validator against the app surfaces (#fffaf1 light / #1c1813 dark): lightness band,
 * chroma floor, adjacent CVD ΔE ≥ 8.9 light / 9.0 dark, normal-vision ΔE ≥ 18.8 / 16.7.
 * The light ochre slot is below 3:1 on paper, so every chart ships a legend with visible counts
 * and a visually hidden data table (the relief channel).
 *
 * Reading statuses use their own validated 4-colour set (+ neutral for "unknown"), matching the
 * ReadingStatusBadge tones (green / blue / gold / red).
 *
 * Colours are CSS custom properties so light/dark switch with `[data-theme]`. Put
 * CHART_PALETTE_CLASS on a wrapper and reference `var(--viz-…)`.
 */
import type { ReadingStatus } from '@/lib/types';

export const CHART_PALETTE_CLASS = [
  '[--viz-1:#2f6fb0] [--viz-2:#c95f2c] [--viz-3:#2e9a72] [--viz-4:#c9951c] [--viz-5:#c2658e] [--viz-6:#3f7f2a] [--viz-7:#5a4aa6] [--viz-8:#b8423f]',
  'dark:[--viz-1:#4a8ad0] dark:[--viz-2:#d46a36] dark:[--viz-3:#2fa57b] dark:[--viz-4:#b8870f] dark:[--viz-5:#d0719a] dark:[--viz-6:#4f9a36] dark:[--viz-7:#8f82e0] dark:[--viz-8:#dd6a66]',
  '[--viz-read:#2e9a72] [--viz-reading:#2f6fb0] [--viz-to-read:#c9951c] [--viz-abandoned:#b8423f]',
  'dark:[--viz-read:#2fa57b] dark:[--viz-reading:#4a8ad0] dark:[--viz-to-read:#b8870f] dark:[--viz-abandoned:#c24a4a]',
  '[--viz-other:#a89c8c] dark:[--viz-other:#6b5f52] [--viz-none:#d9ccb8] dark:[--viz-none:#3d342a]',
  '[--viz-bar:var(--primary)] [--viz-bar-hover:var(--accent)] [--viz-grid:color-mix(in_oklab,var(--line)_75%,transparent)]',
  // bins that cover a wider span than their neighbours (centuries next to decades) are drawn one step lighter
  '[--viz-bar-muted:color-mix(in_oklab,var(--primary)_55%,var(--surface))]',
].join(' ');

/** Single-series magnitude marks (bars, columns) use one colour; hover/focus lifts them to the accent. */
export const BAR_COLOR = 'var(--viz-bar)';
export const BAR_MUTED_COLOR = 'var(--viz-bar-muted)';
export const BAR_HOVER_COLOR = 'var(--viz-bar-hover)';

const SLOT_VARS = ['--viz-1', '--viz-2', '--viz-3', '--viz-4', '--viz-5', '--viz-6', '--viz-7', '--viz-8'] as const;

/** Colour of a categorical slot (0-based); null → neutral "other". */
export function slotColor(slot: number | null): string {
  if (slot === null || slot < 0) return 'var(--viz-other)';
  return `var(${SLOT_VARS[slot % SLOT_VARS.length]})`;
}

export const STATUS_COLOR: Record<ReadingStatus, string> = {
  read: 'var(--viz-read)',
  reading: 'var(--viz-reading)',
  to_read: 'var(--viz-to-read)',
  abandoned: 'var(--viz-abandoned)',
  unknown: 'var(--viz-none)',
};

/** Ring order: progress first, "unknown" closes the ring. */
export const STATUS_RING_ORDER: readonly ReadingStatus[] = ['read', 'reading', 'to_read', 'abandoned', 'unknown'];

export const CONFIDENCE_COLOR = {
  low: 'var(--danger)',
  medium: 'var(--warning)',
  high: 'var(--success)',
} as const;
