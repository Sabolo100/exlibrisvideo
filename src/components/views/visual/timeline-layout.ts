/**
 * Pure model of the timeline view: century bands, decade (or century) columns, piles, the
 * histogram and the oldest/newest books. Plus the localized period labels. No DOM – unit-tested.
 */
import type { Translator } from '@/i18n';
import { centuryNumber, centuryOf, collator, decadeOf, titleSortName } from '@/lib/book-utils';
import type { BookDTO, Locale } from '@/lib/types';

export type TimelineZoom = 'century' | 'decade';
export const TIMELINE_ZOOMS: readonly TimelineZoom[] = ['century', 'decade'];

export interface TimelineColumn {
  /** "d1960" / "c1900" */
  key: string;
  /** first year of the period (1960 / 1900) */
  start: number;
  span: 10 | 100;
  /** oldest first */
  books: BookDTO[];
}

export interface TimelineBand {
  /** century start year (1900) */
  century: number;
  columns: TimelineColumn[];
  count: number;
}

export interface HistogramBin {
  decade: number;
  count: number;
}

export interface TimelineModel {
  bands: TimelineBand[];
  /** books without a usable first-publication year (input order) */
  unknown: BookDTO[];
  dated: number;
  oldest: BookDTO | null;
  newest: BookDTO | null;
  /** every decade between the oldest and newest decade, zeros included */
  histogram: HistogramBin[];
  maxBin: number;
}

function usableYear(book: Pick<BookDTO, 'firstPublishedYear'>): number | null {
  // decadeOf validates (integer, |year| < 10000); years in the future are data errors
  const y = book.firstPublishedYear;
  if (decadeOf(y) === null || y === null) return null;
  return y > new Date().getUTCFullYear() + 1 ? null : y;
}

/**
 * Builds the timeline. Decade zoom: one column per decade from the band's first to last decade
 * with books (empty decades in between are kept so the axis keeps its scale). Century zoom: one
 * column per century. Bands of centuries without books are omitted (the view shows a gap).
 */
export function buildTimeline(books: readonly BookDTO[], zoom: TimelineZoom, locale: Locale): TimelineModel {
  const c = collator(locale);
  const dated: { book: BookDTO; year: number }[] = [];
  const unknown: BookDTO[] = [];
  for (const book of books) {
    const year = usableYear(book);
    if (year === null) unknown.push(book);
    else dated.push({ book, year });
  }
  dated.sort((a, b) => a.year - b.year || c.compare(titleSortName(a.book), titleSortName(b.book)));

  const bandMap = new Map<number, Map<number, BookDTO[]>>();
  const decadeCounts = new Map<number, number>();
  for (const { book, year } of dated) {
    const century = centuryOf(year) as number;
    const decade = decadeOf(year) as number;
    decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1);
    let cols = bandMap.get(century);
    if (!cols) {
      cols = new Map();
      bandMap.set(century, cols);
    }
    const colKey = zoom === 'decade' ? decade : century;
    const list = cols.get(colKey);
    if (list) list.push(book);
    else cols.set(colKey, [book]);
  }

  const bands: TimelineBand[] = [...bandMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([century, cols]) => {
      let columns: TimelineColumn[];
      if (zoom === 'century') {
        columns = [{ key: `c${century}`, start: century, span: 100, books: cols.get(century) ?? [] }];
      } else {
        const decades = [...cols.keys()].sort((a, b) => a - b);
        columns = [];
        for (let d = decades[0]; d <= decades[decades.length - 1]; d += 10) {
          columns.push({ key: `d${d}`, start: d, span: 10, books: cols.get(d) ?? [] });
        }
      }
      return { century, columns, count: columns.reduce((s, col) => s + col.books.length, 0) };
    });

  const histogram: HistogramBin[] = [];
  if (dated.length > 0) {
    const first = decadeOf(dated[0].year) as number;
    const last = decadeOf(dated[dated.length - 1].year) as number;
    for (let d = first; d <= last; d += 10) histogram.push({ decade: d, count: decadeCounts.get(d) ?? 0 });
  }

  return {
    bands,
    unknown,
    dated: dated.length,
    oldest: dated[0]?.book ?? null,
    newest: dated[dated.length - 1]?.book ?? null,
    histogram,
    maxBin: histogram.reduce((m, b) => Math.max(m, b.count), 0),
  };
}

/**
 * Splits a column's books into piles of `perPile` (bottom = first). With `maxPiles` only that many
 * piles are returned and the number of books left out is reported.
 */
export function splitPiles<T>(items: readonly T[], perPile: number, maxPiles?: number): { piles: T[][]; hidden: number } {
  const size = Math.max(1, Math.floor(perPile));
  const piles: T[][] = [];
  for (let i = 0; i < items.length; i += size) piles.push(items.slice(i, i + size));
  if (maxPiles === undefined || piles.length <= maxPiles) return { piles, hidden: 0 };
  const kept = piles.slice(0, Math.max(0, maxPiles));
  return { piles: kept, hidden: items.length - kept.reduce((s, p) => s + p.length, 0) };
}

/** Years skipped between two consecutive bands (0 when they are adjacent centuries). */
export function bandGapYears(previousCentury: number, century: number): number {
  return Math.max(0, century - previousCentury - 100);
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/**
 * Hungarian adjective suffix of a number ending in zero, by vowel harmony of how it is read:
 * 10 tízes, 20 húszas, 30 harmincas, 40 negyvenes, 50 ötvenes, 60 hatvanas, 70 hetvenes,
 * 80 nyolcvanas, 90 kilencvenes, x00 …százas, x000 …ezres.
 */
export function huDecadeSuffix(decade: number): 'as' | 'es' | 's' {
  // only meaningful for multiples of ten (decade start years)
  const n = Math.abs(Math.trunc(decade / 10) * 10);
  if (n === 0) return 's';
  const tens = Math.floor(n / 10) % 10;
  if (tens !== 0) return [1, 4, 5, 7, 9].includes(tens) ? 'es' : 'as';
  const hundreds = Math.floor(n / 100) % 10;
  if (hundreds !== 0) return 'as';
  return 'es';
}

/** English ordinal: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st … */
export function englishOrdinal(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${abs}th`;
  switch (abs % 10) {
    case 1:
      return `${abs}st`;
    case 2:
      return `${abs}nd`;
    case 3:
      return `${abs}rd`;
    default:
      return `${abs}th`;
  }
}

type T = Translator['t'];

/** Century band label via i18n (1900 → "20. század" / "20th century", BC aware). */
export function centuryLabel(centuryStart: number, locale: Locale, t: T): string {
  // the band [start, start + 99] is named by the ordinal of its middle year: 1900–1999 → 20th,
  // -800…-701 (800–701 BC) → 8th century BC
  const ord = centuryNumber(centuryStart + 50) ?? 0;
  const abs = Math.abs(ord);
  const ordinal = locale === 'hu' ? `${abs}.` : englishOrdinal(abs);
  return t(ord < 0 ? 'visual.timeline.centuryBc' : 'visual.timeline.century', { ordinal });
}

/** Decade label via i18n: "1960-as évek" / "1960s"; decadeOf(-745) = -750 → "i. e. 750-es évek" / "750s BC". */
export function decadeLabel(decadeStart: number, t: T): string {
  const abs = Math.abs(decadeStart);
  return t(decadeStart < 0 ? 'visual.timeline.decadeBc' : 'visual.timeline.decade', {
    decade: abs,
    suffix: huDecadeSuffix(abs),
  });
}

/** A single year: 1605 / "i. e. 750" / "750 BC". */
export function yearLabel(year: number, t: T): string {
  return year >= 0 ? String(year) : t('visual.timeline.yearBc', { year: Math.abs(year) });
}

/** Label of a column (its decade or century). */
export function columnLabel(column: Pick<TimelineColumn, 'start' | 'span'>, locale: Locale, t: T): string {
  return column.span === 100 ? centuryLabel(column.start, locale, t) : decadeLabel(column.start, t);
}
