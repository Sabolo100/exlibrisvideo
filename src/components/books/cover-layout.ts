/**
 * Pure typography maths for the generated BookCover (no DOM, SSR-safe).
 */
export type CoverVariant = 'classic' | 'band' | 'label';

/** usable title width per composition, in cqw (container width = 100) */
const TITLE_WIDTH_CQW: Record<CoverVariant, number> = { classic: 76, band: 80, label: 63 };
/** generous average advance of Fraunces semibold, in em */
const TITLE_EM = 0.6;

/** Title size in cqw: by overall length, capped so the longest word never has to break mid-word. */
export function coverTitleSize(title: string, variant: CoverVariant): number {
  const len = title.length;
  const byLength = len <= 8 ? 14 : len <= 16 ? 11.5 : len <= 28 ? 9.5 : len <= 48 ? 8 : 6.8;
  const longestWord = title.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
  const byWord = longestWord > 0 ? TITLE_WIDTH_CQW[variant] / (longestWord * TITLE_EM) : byLength;
  return Math.round(Math.max(5.5, Math.min(byLength, byWord)) * 10) / 10;
}
