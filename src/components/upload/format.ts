/**
 * Formatting helpers for file sizes, durations and remaining time. Pure – unit tested.
 */
import type { Locale } from '@/lib/types';

function nf(locale: Locale, maximumFractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(locale === 'hu' ? 'hu-HU' : 'en-GB', { maximumFractionDigits, minimumFractionDigits: 0 });
}

/** 532 KB · 12,4 MB · 1,02 GB (binary units, locale decimal separator). */
export function formatBytes(bytes: number, locale: Locale): string {
  const b = Math.max(0, bytes);
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (b < KB) return `${nf(locale, 0).format(b)} B`;
  if (b < MB) return `${nf(locale, 0).format(Math.max(1, Math.round(b / KB)))} KB`;
  if (b < GB) {
    const v = b / MB;
    return `${nf(locale, v >= 100 ? 0 : 1).format(v)} MB`;
  }
  return `${nf(locale, 2).format(b / GB)} GB`;
}

/** 0:42 · 3:07 · 1:02:05 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Remaining time bucketed for display: { unit: 'seconds' | 'minutes' | 'hours', count }. */
export function etaParts(seconds: number | null): { unit: 'seconds' | 'minutes' | 'hours'; count: number } | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 55) return { unit: 'seconds', count: Math.max(5, Math.ceil(seconds / 5) * 5) };
  if (seconds < 3600) return { unit: 'minutes', count: Math.max(1, Math.round(seconds / 60)) };
  return { unit: 'hours', count: Math.max(1, Math.round(seconds / 360) / 10) };
}
