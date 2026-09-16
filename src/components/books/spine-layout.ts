/**
 * Pure geometry for BookSpine / Shelf (no DOM, deterministic, SSR-safe).
 */
import {
  foldForSearch,
  hash01,
  isDarkColor,
  readableTextColor,
  shadeColor,
  spineColor,
  spineDimensions,
} from '@/lib/book-utils';
import type { BookDTO } from '@/lib/types';

export type SpineSize = 'xs' | 'sm' | 'md' | 'lg';

/** Full height and base thickness of a spine per size (px). */
export const SPINE_SIZES: Record<SpineSize, { height: number; width: number }> = {
  xs: { height: 64, width: 13 },
  sm: { height: 112, width: 20 },
  md: { height: 180, width: 31 },
  lg: { height: 252, width: 41 },
};

/** Shelf geometry per spine size: space above the tallest book, plank thickness, side walls, top board (px). */
export const SHELF_GEOMETRY: Record<SpineSize, { headroom: number; plank: number; side: number; top: number }> = {
  xs: { headroom: 10, plank: 8, side: 6, top: 6 },
  sm: { headroom: 14, plank: 11, side: 8, top: 8 },
  md: { headroom: 20, plank: 15, side: 12, top: 10 },
  lg: { headroom: 26, plank: 18, side: 14, top: 12 },
};

export function shelfRowHeight(size: SpineSize): number {
  const g = SHELF_GEOMETRY[size];
  return SPINE_SIZES[size].height + g.headroom + g.plank;
}

/** Rendered spine box in px for a book at a size. */
export function spineBox(book: Pick<BookDTO, 'pageCount' | 'title' | 'author'>, size: SpineSize): { width: number; height: number } {
  const d = spineDimensions(book);
  const base = SPINE_SIZES[size];
  return { width: Math.round(base.width * d.widthRatio), height: Math.round(base.height * d.heightRatio) };
}

export type SpineVariant = 'cloth' | 'label' | 'paperback' | 'leather';

export interface SpineTextLayout {
  /**
   * none: no text (xs / too thin) · title: title only · title2: title broken into two parallel lines ·
   * single: author + title along one line · double: title and author as two parallel lines (thick spines)
   */
  mode: 'none' | 'title' | 'title2' | 'single' | 'double';
  titleSize: number;
  authorSize: number;
  /** the title as printed: one entry, or two for "title2" */
  titleLines: string[];
  /** the author text to print (full name, or just the family name when space is short) */
  authorText: string | null;
  /** inset from the head (top) and tail (bottom) in px */
  head: number;
  tail: number;
}

const MAX_TITLE: Record<SpineSize, number> = { xs: 0, sm: 10.5, md: 14.5, lg: 18 };
const MIN_FONT = 7.5;
/** average advance of Fraunces semibold (measured in Chrome, p90) */
const TITLE_EM = 0.56;
/** average advance of Inter semibold upper-case with 0.07em tracking (measured, p90) */
const AUTHOR_EM = 0.76;
const MIN_SCALE = 0.72;

/** Splits a title into two lines at the space closest to the middle (null when there is no space). */
export function splitTitle(title: string): [string, string] | null {
  const t = title.trim();
  const mid = t.length / 2;
  let best = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  if (best <= 0) return null;
  return [t.slice(0, best).trim(), t.slice(best + 1).trim()];
}

/**
 * Chooses how the spine text is set. Titles win over authors: the author is shortened to the
 * family name or dropped before the title shrinks below 72 %; long titles break into two lines
 * when the spine is thick enough. Whatever still does not fit is ellipsised by CSS.
 */
export function spineTextLayout(opts: {
  width: number;
  height: number;
  title: string;
  author: string | null;
  /** family name only (see authorFamilyName) – used when the full name does not fit */
  authorShort?: string | null;
  size: SpineSize;
  variant: SpineVariant;
}): SpineTextLayout {
  const { width, height, size, variant } = opts;
  const title = opts.title.trim();
  const author = opts.author?.trim() || null;
  const authorShort = opts.authorShort?.trim() || author;
  const head = Math.round(height * (variant === 'paperback' ? 0.07 : variant === 'label' ? 0.22 : 0.13));
  const tail = Math.round(height * (variant === 'paperback' ? 0.12 : variant === 'label' ? 0.22 : 0.11));
  const avail = Math.max(0, height - head - tail);
  const result = (partial: Omit<SpineTextLayout, 'head' | 'tail'>): SpineTextLayout => ({
    ...partial,
    titleSize: round1(partial.titleSize),
    authorSize: round1(partial.authorSize),
    head,
    tail,
  });

  if (size === 'xs' || width < 15 || !title) {
    return result({ mode: 'none', titleSize: 0, authorSize: 0, titleLines: [], authorText: null });
  }

  const titleLen = (fs: number, text = title) => text.length * TITLE_EM * fs;
  // usable thickness for parallel lines (inner margin for the rounded edges)
  const thickness = width * 0.84;

  if (width >= 46 && author) {
    let titleSize = Math.min(width * 0.3, MAX_TITLE[size]);
    const needed = titleLen(titleSize);
    if (needed > avail) titleSize = Math.max(MIN_FONT, titleSize * Math.max(MIN_SCALE, avail / needed));
    const authorSize = Math.max(MIN_FONT, Math.min(width * 0.19, titleSize * 0.72));
    const fullFits = author.length * AUTHOR_EM * authorSize <= avail;
    return result({
      mode: 'double',
      titleSize,
      authorSize,
      titleLines: [title],
      authorText: fullFits ? author : authorShort,
    });
  }

  const baseTitle = Math.min(width * 0.48, MAX_TITLE[size]);
  const baseAuthor = Math.min(width * 0.34, baseTitle * 0.74);
  const withAuthor = (name: string) => titleLen(baseTitle) + name.length * AUTHOR_EM * baseAuthor + baseTitle * 0.9;
  const fit = (need: number) => (need <= 0 ? 1 : Math.min(1, avail / need));
  const canShowAuthor = Boolean(author) && size !== 'sm' && width >= 22;

  if (canShowAuthor && author) {
    if (fit(withAuthor(author)) >= 0.82) {
      const s = fit(withAuthor(author));
      return result({ mode: 'single', titleSize: baseTitle * s, authorSize: baseAuthor * s, titleLines: [title], authorText: author });
    }
    if (authorShort && fit(withAuthor(authorShort)) >= MIN_SCALE) {
      const s = fit(withAuthor(authorShort));
      return result({
        mode: 'single',
        titleSize: Math.max(MIN_FONT, baseTitle * s),
        authorSize: Math.max(MIN_FONT, baseAuthor * s),
        titleLines: [title],
        authorText: authorShort,
      });
    }
  }

  const titleScale = fit(titleLen(baseTitle));
  if (titleScale >= MIN_SCALE) {
    const titleSize = Math.max(MIN_FONT, baseTitle * titleScale);
    // the title keeps its size; squeeze the family name into what is left, in a smaller size
    // (never below the minimum – otherwise it is dropped rather than printed as "Kras…")
    if (canShowAuthor && authorShort) {
      const leftover = avail - titleLen(titleSize) - titleSize * 0.9;
      const authorSize = Math.min(baseAuthor * titleScale, leftover / (authorShort.length * AUTHOR_EM));
      if (authorSize >= MIN_FONT) {
        return result({ mode: 'single', titleSize, authorSize, titleLines: [title], authorText: authorShort });
      }
    }
    return result({ mode: 'title', titleSize, authorSize: 0, titleLines: [title], authorText: null });
  }

  // long title: two parallel lines when the spine is thick enough
  const lines = splitTitle(title);
  if (lines) {
    const longest = Math.max(lines[0].length, lines[1].length);
    const byLength = avail / (longest * TITLE_EM);
    const byThickness = thickness / (2 * 1.08);
    const fs = Math.min(baseTitle, byLength, byThickness);
    const oneLine = Math.max(MIN_FONT, baseTitle * MIN_SCALE);
    // only worth it when the two-line setting is not much smaller than the clipped single line
    if (fs >= MIN_FONT && fs >= oneLine * 0.8) {
      return result({ mode: 'title2', titleSize: fs, authorSize: 0, titleLines: lines, authorText: null });
    }
  }

  return result({
    mode: 'title',
    titleSize: Math.max(MIN_FONT, baseTitle * MIN_SCALE),
    authorSize: 0,
    titleLines: [title],
    authorText: null,
  });
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export interface SpineAppearance {
  base: string;
  dark: boolean;
  ink: string;
  variant: SpineVariant;
  /** decorative band / ornament colour */
  ornament: string;
  /** title uses gold foil */
  foil: boolean;
  /** label panel colour (variant label) */
  labelColor: string;
  edge: string;
  /** 0..1 deterministic jitter for small details (band position, logo) */
  seed: number;
}

/** Deterministic look of a spine: variant, colours, foil. */
export function spineAppearance(book: Pick<BookDTO, 'spineColor' | 'author' | 'title' | 'id'>): SpineAppearance {
  const base = spineColor(book);
  const dark = isDarkColor(base);
  const key = `${foldForSearch(book.author)}|${foldForSearch(book.title)}`;
  const r = hash01(key, 7);
  let variant: SpineVariant = r < 0.38 ? 'cloth' : r < 0.58 ? 'label' : r < 0.84 ? 'paperback' : 'leather';
  // pasted paper labels only suit short titles
  if (variant === 'label' && book.title.trim().length > 18) variant = 'cloth';
  const foil = dark && (variant === 'cloth' || variant === 'leather');
  return {
    base,
    dark,
    ink: readableTextColor(base),
    variant,
    ornament: dark ? '#d4ad62' : shadeColor(base, -0.42),
    foil,
    labelColor: '#efe4c9',
    edge: shadeColor(base, -0.45),
    seed: hash01(key, 11),
  };
}
