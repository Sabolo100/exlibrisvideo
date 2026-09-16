/**
 * Pure statistics for the stats dashboard (owner: views-data).
 * No DOM, no React – deterministic, unit-tested in stats.test.ts.
 */
import {
  bookTopicKeys,
  centuryNumber,
  collator,
  decadeOf,
  foldForSearch,
  isPendingReview,
  seededRandom,
  splitAuthors,
  uniqueAuthors,
} from '@/lib/book-utils';
import type { BookDTO, BookSource, Locale, ReadingStatus } from '@/lib/types';
import { READING_STATUSES } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Average thickness of a book on a home shelf (cm) – "books × 2.7 cm". */
export const BOOK_THICKNESS_CM = 2.7;
/** Page count assumed for books without one when too few books carry a real value. */
export const DEFAULT_PAGE_COUNT = 250;
/** How many real page counts are needed before their median is trusted for the rest. */
export const MIN_KNOWN_PAGES_FOR_MEDIAN = 3;
/** "At 30 pages a day …" */
export const PAGES_PER_DAY = 30;
/**
 * Coloured category slices before the tail folds into "other" – a donut stays readable at a glance
 * with at most six coloured parts (plus the neutral "other" and "unclassified").
 */
export const MAX_CATEGORY_SLICES = 6;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export function share(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

/** Rounded percentage 0–100 (never shows 0 % for a non-zero count, never 100 % for a partial one). */
export function percent(count: number, total: number): number {
  if (total <= 0 || count <= 0) return 0;
  const p = Math.round((count / total) * 100);
  if (p === 0) return 1;
  if (p === 100 && count < total) return 99;
  return p;
}

function validYear(y: number | null | undefined): y is number {
  return typeof y === 'number' && Number.isInteger(y) && Math.abs(y) < 10000;
}

function validPages(p: number | null | undefined): p is number {
  return typeof p === 'number' && Number.isFinite(p) && p > 0 && p < 20000;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function normCode(code: string | null | undefined): string | null {
  const c = code?.trim();
  return c ? c.toLowerCase().replace('_', '-') : null;
}

function normCountry(code: string | null | undefined): string | null {
  const c = code?.trim().toUpperCase();
  if (!c) return null;
  const mapped = c === 'UK' ? 'GB' : c === 'EL' ? 'GR' : c;
  return /^[A-Z]{2}$/.test(mapped) ? mapped : null;
}

/* ------------------------------------------------------------------ */
/* Totals                                                              */
/* ------------------------------------------------------------------ */

export interface PageEstimate {
  /** sum of the real page counts */
  known: number;
  /** books with a real page count */
  knownBooks: number;
  /** pages assumed per book without a page count */
  perUnknownBook: number;
  /** known + estimated pages of every book */
  total: number;
  /** true when at least one book had no page count */
  isEstimate: boolean;
}

/** Real page counts plus the median of the known ones (or 250) for every book without one. */
export function estimatePages(books: readonly Pick<BookDTO, 'pageCount'>[]): PageEstimate {
  const known = books.map((b) => b.pageCount).filter(validPages);
  const knownSum = known.reduce((s, p) => s + p, 0);
  const perUnknownBook =
    known.length >= MIN_KNOWN_PAGES_FOR_MEDIAN ? Math.round(median(known)) : DEFAULT_PAGE_COUNT;
  const unknown = books.length - known.length;
  return {
    known: knownSum,
    knownBooks: known.length,
    perUnknownBook,
    total: Math.round(knownSum + unknown * perUnknownBook),
    isEstimate: unknown > 0,
  };
}

export function shelfLengthCm(bookCount: number): number {
  return Math.round(bookCount * BOOK_THICKNESS_CM * 10) / 10;
}

/** Splits a number of days into whole years and remaining days (365-day years). */
export function splitDays(days: number): { years: number; days: number } {
  const d = Math.max(0, Math.ceil(days));
  return { years: Math.floor(d / 365), days: d % 365 };
}

/* ------------------------------------------------------------------ */
/* Distributions                                                       */
/* ------------------------------------------------------------------ */

export interface CountEntry {
  key: string;
  count: number;
  /** 0..1 of the books in the analysed set */
  share: number;
}

function countEntries(counts: Map<string, number>, total: number, locale: Locale): CountEntry[] {
  const c = collator(locale);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, share: share(count, total) }))
    .sort((a, b) => b.count - a.count || c.compare(a.key, b.key));
}

/** The one taxonomy key a book is charted under: its category, else its first topic, else null. */
export function primaryCategory(book: Pick<BookDTO, 'category' | 'topics'>): string | null {
  return book.category || book.topics.find(Boolean) || null;
}

export interface CategorySlice {
  /** taxonomy key; "__other" for the folded tail; "__none" for books without any category */
  key: string;
  count: number;
  share: number;
  /** 0-based colour slot (0..MAX_CATEGORY_SLICES-1) or null for the neutral "other"/"none" slices */
  slot: number | null;
  /** keys folded into "__other" */
  members: string[];
}

export const OTHER_SLICE = '__other';
export const NONE_SLICE = '__none';

/**
 * Category donut data. Colour slots follow the entity, not the current rank: they are assigned
 * by rank in `paletteBooks` (normally the whole, unfiltered collection), so filtering never
 * repaints a category. Categories without a slot fold into "__other"; books without any
 * category form "__none". Slices are ordered by count (other/none last).
 */
export function categorySlices(
  books: readonly BookDTO[],
  paletteBooks: readonly BookDTO[] = books,
  locale: Locale = 'hu',
): CategorySlice[] {
  const rankCounts = new Map<string, number>();
  for (const b of paletteBooks) {
    const k = primaryCategory(b);
    if (k) rankCounts.set(k, (rankCounts.get(k) ?? 0) + 1);
  }
  const slotOf = new Map(
    countEntries(rankCounts, paletteBooks.length, locale)
      .slice(0, MAX_CATEGORY_SLICES)
      .map((e, i) => [e.key, i] as const),
  );

  const counts = new Map<string, number>();
  let none = 0;
  for (const b of books) {
    const k = primaryCategory(b);
    if (!k) none += 1;
    else counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const total = books.length;
  const slices: CategorySlice[] = [];
  const other: CategorySlice = { key: OTHER_SLICE, count: 0, share: 0, slot: null, members: [] };
  for (const e of countEntries(counts, total, locale)) {
    const slot = slotOf.get(e.key);
    if (slot === undefined) {
      other.count += e.count;
      other.members.push(e.key);
    } else {
      slices.push({ key: e.key, count: e.count, share: e.share, slot, members: [e.key] });
    }
  }
  if (other.count > 0) slices.push({ ...other, share: share(other.count, total) });
  if (none > 0) slices.push({ key: NONE_SLICE, count: none, share: share(none, total), slot: null, members: [] });
  return slices;
}

/** Books per language code (lower-case); books without a value are counted in `unknown`. */
export function languageCounts(
  books: readonly BookDTO[],
  field: 'language' | 'originalLanguage',
  locale: Locale = 'hu',
): { entries: CountEntry[]; unknown: number } {
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const b of books) {
    const code = normCode(b[field]);
    if (!code) unknown += 1;
    else counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return { entries: countEntries(counts, books.length, locale), unknown };
}

function baseLanguage(code: string): string {
  return code.split('-')[0];
}

/**
 * How many books are translations: among the books whose edition language and original language
 * are both known, those where the two differ (regional variants such as en-GB/en count as equal).
 */
export function translationStats(
  books: readonly Pick<BookDTO, 'language' | 'originalLanguage'>[],
): { translated: number; known: number; share: number } {
  let known = 0;
  let translated = 0;
  for (const b of books) {
    const lang = normCode(b.language);
    const original = normCode(b.originalLanguage);
    if (!lang || !original) continue;
    known += 1;
    if (baseLanguage(lang) !== baseLanguage(original)) translated += 1;
  }
  return { translated, known, share: share(translated, known) };
}

export interface CountryEntry {
  code: string;
  /** distinct individual authors from this country */
  authors: number;
  books: number;
}

/**
 * Author countries (ISO alpha-2). `authorCountry` describes the first author of a book, so each
 * book contributes its first author to that country. Sorted by authors, then books.
 */
export function countryCounts(books: readonly BookDTO[], locale: Locale = 'hu'): { entries: CountryEntry[]; unknownAuthors: number } {
  const byCountry = new Map<string, { authors: Set<string>; books: number }>();
  const unknown = new Set<string>();
  for (const b of books) {
    const first = splitAuthors(b.author)[0];
    const authorKey = first ? foldForSearch(first) : '';
    const code = normCountry(b.authorCountry);
    if (!code) {
      if (authorKey) unknown.add(authorKey);
      continue;
    }
    let e = byCountry.get(code);
    if (!e) {
      e = { authors: new Set(), books: 0 };
      byCountry.set(code, e);
    }
    e.books += 1;
    if (authorKey) e.authors.add(authorKey);
  }
  // an author counted under a country is not "unknown" just because another book lacks the code
  for (const e of byCountry.values()) for (const a of e.authors) unknown.delete(a);
  const c = collator(locale);
  const entries = [...byCountry.entries()]
    .map(([code, e]) => ({ code, authors: e.authors.size, books: e.books }))
    .sort((a, b) => b.authors - a.authors || b.books - a.books || c.compare(a.code, b.code));
  return { entries, unknownAuthors: unknown.size };
}

export interface YearBucket {
  /** stable key, e.g. "d1960" or "c1800" */
  key: string;
  kind: 'decade' | 'century';
  /** first year of the bucket */
  start: number;
  /** last year of the bucket (inclusive) */
  end: number;
  /** decade start years covered (for BookFilters.decades) */
  decades: number[];
  count: number;
}

/** At most this many decade columns; older books are grouped by century. */
export const MAX_DECADE_COLUMNS = 16;

/**
 * Histogram of first-publication years. Recent history is shown per decade (contiguous, empty
 * decades included); when the span is too wide, everything before the cut-off century is grouped
 * per century (only centuries that have books).
 */
export function yearHistogram(books: readonly Pick<BookDTO, 'firstPublishedYear'>[]): { buckets: YearBucket[]; unknown: number } {
  const decadeCounts = new Map<number, number>();
  let unknown = 0;
  for (const b of books) {
    const d = decadeOf(b.firstPublishedYear);
    if (d === null) unknown += 1;
    else decadeCounts.set(d, (decadeCounts.get(d) ?? 0) + 1);
  }
  if (decadeCounts.size === 0) return { buckets: [], unknown };
  const decades = [...decadeCounts.keys()].sort((a, b) => a - b);
  const min = decades[0];
  const max = decades[decades.length - 1];

  let cutoff = min;
  if ((max - min) / 10 + 1 > MAX_DECADE_COLUMNS) {
    // first century start such that the decade columns fit
    cutoff = Math.ceil((max - (MAX_DECADE_COLUMNS - 1) * 10) / 100) * 100;
  }

  const buckets: YearBucket[] = [];
  const centuries = new Map<number, number>();
  for (const d of decades) {
    if (d < cutoff) {
      const c = Math.floor(d / 100) * 100;
      centuries.set(c, (centuries.get(c) ?? 0) + (decadeCounts.get(d) ?? 0));
    }
  }
  for (const c of [...centuries.keys()].sort((a, b) => a - b)) {
    const covered = decades.filter((d) => d >= c && d < c + 100 && d < cutoff);
    buckets.push({
      key: `c${c}`,
      kind: 'century',
      start: c,
      end: Math.min(c + 99, cutoff - 1),
      decades: covered,
      count: centuries.get(c) ?? 0,
    });
  }
  for (let d = Math.max(min, cutoff); d <= max; d += 10) {
    buckets.push({ key: `d${d}`, kind: 'decade', start: d, end: d + 9, decades: [d], count: decadeCounts.get(d) ?? 0 });
  }
  return { buckets, unknown };
}

/** Ordinal century label parts: 1800 → { number: 19, bc: false }. */
export function centuryParts(start: number): { number: number; bc: boolean } {
  const n = centuryNumber(start >= 0 ? start + 1 : start) ?? 0;
  return { number: Math.abs(n), bc: n < 0 };
}

export function englishOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function statusCounts(books: readonly Pick<BookDTO, 'readingStatus'>[]): Record<ReadingStatus, number> {
  const out = Object.fromEntries(READING_STATUSES.map((s) => [s, 0])) as Record<ReadingStatus, number>;
  for (const b of books) out[READING_STATUSES.includes(b.readingStatus) ? b.readingStatus : 'unknown'] += 1;
  return out;
}

export type ConfidenceBand = 'low' | 'medium' | 'high';

export interface ConfidenceBucket {
  /** inclusive lower bound 0..1 */
  from: number;
  /** exclusive upper bound (inclusive for the last bucket) */
  to: number;
  level: ConfidenceBand;
  count: number;
}

const CONFIDENCE_EDGES: [number, number, ConfidenceBand][] = [
  [0, 0.2, 'low'],
  [0.2, 0.4, 'low'],
  [0.4, 0.6, 'low'],
  [0.6, 0.8, 'medium'],
  [0.8, 1, 'high'],
];

export interface RecognitionQuality {
  buckets: ConfidenceBucket[];
  /** mean confidence of recognised (non-manual) books, null when there are none */
  average: number | null;
  /** needsReview && !reviewed */
  pendingReview: number;
  reviewed: number;
  bySource: Record<BookSource, number>;
}

export function recognitionQuality(books: readonly BookDTO[]): RecognitionQuality {
  const buckets: ConfidenceBucket[] = CONFIDENCE_EDGES.map(([from, to, level]) => ({ from, to, level, count: 0 }));
  const bySource: Record<BookSource, number> = { video: 0, image: 0, manual: 0 };
  let sum = 0;
  let recognised = 0;
  let pendingReview = 0;
  let reviewed = 0;
  for (const b of books) {
    const v = Number.isFinite(b.confidence) ? Math.min(1, Math.max(0, b.confidence)) : 0;
    const idx = Math.min(buckets.length - 1, CONFIDENCE_EDGES.findIndex(([from, to], i) => v >= from && (v < to || i === CONFIDENCE_EDGES.length - 1)));
    buckets[Math.max(0, idx)].count += 1;
    bySource[b.source in bySource ? b.source : 'video'] += 1;
    if (b.source !== 'manual') {
      sum += v;
      recognised += 1;
    }
    if (isPendingReview(b)) pendingReview += 1;
    if (b.reviewed) reviewed += 1;
  }
  return { buckets, average: recognised ? sum / recognised : null, pendingReview, reviewed, bySource };
}

/* ------------------------------------------------------------------ */
/* Fun facts                                                           */
/* ------------------------------------------------------------------ */

/**
 * Words ignored for "most common title word": Hungarian and English function words (plus the
 * articles/prepositions of a few other languages that show up on Hungarian shelves).
 * Compared after lower-casing with accents kept (and additionally accent-folded).
 */
export const TITLE_STOP_WORDS: ReadonlySet<string> = new Set(
  [
    // Hungarian
    'a', 'az', 'egy', 'és', 'es', 's', 'is', 'meg', 'de', 'hogy', 'nem', 'van', 'volt', 'vagy', 'avagy', 'mint', 'ha',
    'csak', 'már', 'még', 'ki', 'be', 'el', 'fel', 'le', 'rá', 'át', 'ide', 'oda', 'azt', 'ezt', 'ez', 'ő', 'ők', 'én',
    'te', 'mi', 'ti', 'ön', 'maga', 'magát', 'azok', 'ezek', 'aki', 'akik', 'ami', 'amely', 'mely', 'mit', 'hol', 'hová',
    'honnan', 'mikor', 'miért', 'hogyan', 'nincs', 'lesz', 'lett', 'sem', 'se', 'pedig', 'tehát', 'így', 'úgy', 'ott',
    'itt', 'ahol', 'amit', 'akit', 'minden', 'mind', 'között', 'alatt', 'felett', 'fölött', 'után', 'előtt', 'mellett',
    'nélkül', 'szerint', 'által', 'miatt', 'helyett', 'óta', 'felé', 'keresztül', 'belül', 'kívül', 'iránt', 'ellen',
    'vagyis', 'azaz', 'illetve', 'valamint', 'ahogy', 'amíg', 'bár', 'hanem', 'sőt', 'avval', 'azzal', 'ezzel', 'vele',
    'neki', 'nekem', 'nekünk', 'rólam', 'róla', 'arról', 'erről', 'abban', 'ebben', 'oly', 'olyan', 'ilyen', 'milyen',
    'mennyi', 'sok', 'kevés', 'egyik', 'másik', 'más', 'saját', 'vagyok', 'vagy', 'vagyunk', 'vannak', 'volna', 'lenne',
    'kell', 'lehet', 'nagyon', 'igen', 'jaj', 'ó', 'óh', 'no', 'hát', 'ám', 'én', 'engem', 'téged', 'minket', 'titeket',
    'őket', 'mert', 'amikor', 'míg', 'aztán', 'akkor', 'most', 'mindig', 'soha', 'sehol', 'valami', 'semmi', 'bárki',
    'kötet', 'rész', 'könyv',
    // English
    'the', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'as', 'is', 'are', 'was', 'were',
    'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'our', 'their', 'i', 'you',
    'he', 'she', 'we', 'they', 'me', 'him', 'us', 'them', 'not', 'no', 'but', 'if', 'into', 'over', 'under', 'about',
    'after', 'before', 'up', 'down', 'out', 'off', 'all', 'any', 'some', 'what', 'when', 'where', 'who', 'why', 'how',
    'which', 'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must', 'do', 'does', 'did', 'has',
    'have', 'had', 'than', 'then', 'so', 'too', 'very', 'just', 'vol', 'volume', 'edition', 'book', 'part', 'one',
    'other', 'more', 'most', 'there', 'here', 'upon', 'through', 'between', 'without', 'within',
    // German, French, Italian, Spanish, Latin articles & prepositions
    'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'und', 'von', 'zu', 'mit', 'im', 'auf', 'le', 'la', 'les',
    'un', 'une', 'de', 'du', 'et', 'en', 'au', 'aux', 'il', 'lo', 'gli', 'di', 'del', 'della', 'e', 'el', 'los', 'las',
    'y', 'et', 'ad', 'cum', 'est',
  ].flatMap((w) => [w, foldForSearch(w)]),
);

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;

/**
 * The most frequent meaningful word across titles (≥ 3 letters, not a stop word, not a number,
 * counted once per book). Needs at least two occurrences. Ties: longer word, then alphabetical.
 */
export function mostCommonTitleWord(
  books: readonly Pick<BookDTO, 'title'>[],
  locale: Locale = 'hu',
): { word: string; count: number } | null {
  const counts = new Map<string, { count: number; forms: Map<string, number> }>();
  for (const b of books) {
    const seen = new Set<string>();
    for (const m of (b.title ?? '').matchAll(WORD_RE)) {
      const raw = m[0];
      const lower = raw.toLocaleLowerCase(locale === 'hu' ? 'hu-HU' : 'en-GB').replace(/['’].*$/u, '');
      if ([...lower].length < 3 || /^\p{N}+$/u.test(lower)) continue;
      if (TITLE_STOP_WORDS.has(lower) || TITLE_STOP_WORDS.has(foldForSearch(lower))) continue;
      if (seen.has(lower)) continue;
      seen.add(lower);
      let e = counts.get(lower);
      if (!e) {
        e = { count: 0, forms: new Map() };
        counts.set(lower, e);
      }
      e.count += 1;
      e.forms.set(raw, (e.forms.get(raw) ?? 0) + 1);
    }
  }
  const c = collator(locale);
  let best: { key: string; count: number } | null = null;
  for (const [key, e] of counts) {
    if (e.count < 2) continue;
    if (
      !best ||
      e.count > best.count ||
      (e.count === best.count && ([...key].length > [...best.key].length || ([...key].length === [...best.key].length && c.compare(key, best.key) < 0)))
    ) {
      best = { key, count: e.count };
    }
  }
  if (!best) return null;
  return { word: best.key, count: best.count };
}

export interface FunFacts {
  oldest: BookDTO | null;
  newest: BookDTO | null;
  longestTitle: BookDTO | null;
  commonWord: { word: string; count: number } | null;
  /** pages of the books not yet read (estimated) */
  unreadPages: number;
  unreadBooks: number;
  /** days needed at PAGES_PER_DAY for the unread pages (0 when nothing is left) */
  readingDays: number;
  /** decade with the most books */
  topDecade: { decade: number; count: number } | null;
}

function byYear(books: readonly BookDTO[], dir: 1 | -1, locale: Locale): BookDTO | null {
  const c = collator(locale);
  let best: BookDTO | null = null;
  for (const b of books) {
    if (!validYear(b.firstPublishedYear)) continue;
    if (
      !best ||
      (b.firstPublishedYear - (best.firstPublishedYear as number)) * dir < 0 ||
      (b.firstPublishedYear === best.firstPublishedYear && c.compare(b.title, best.title) < 0)
    ) {
      best = b;
    }
  }
  return best;
}

export function funFacts(books: readonly BookDTO[], locale: Locale = 'hu'): FunFacts {
  const c = collator(locale);
  let longestTitle: BookDTO | null = null;
  for (const b of books) {
    const len = [...(b.title ?? '').trim()].length;
    if (len === 0) continue;
    const bestLen = longestTitle ? [...longestTitle.title.trim()].length : -1;
    if (len > bestLen || (len === bestLen && longestTitle && c.compare(b.title, longestTitle.title) < 0)) longestTitle = b;
  }

  const unread = books.filter((b) => b.readingStatus !== 'read');
  const pages = estimatePages(books);
  const unreadPages = unread.reduce((s, b) => s + (validPages(b.pageCount) ? b.pageCount : pages.perUnknownBook), 0);

  const decades = new Map<number, number>();
  for (const b of books) {
    const d = decadeOf(b.firstPublishedYear);
    if (d !== null) decades.set(d, (decades.get(d) ?? 0) + 1);
  }
  let topDecade: FunFacts['topDecade'] = null;
  for (const [decade, count] of decades) {
    if (!topDecade || count > topDecade.count || (count === topDecade.count && decade > topDecade.decade)) topDecade = { decade, count };
  }

  return {
    oldest: byYear(books, 1, locale),
    newest: byYear(books, -1, locale),
    longestTitle,
    commonWord: mostCommonTitleWord(books, locale),
    unreadPages,
    unreadBooks: unread.length,
    readingDays: unreadPages > 0 ? Math.ceil(unreadPages / PAGES_PER_DAY) : 0,
    topDecade,
  };
}

/* ------------------------------------------------------------------ */
/* "What should I read today?"                                         */
/* ------------------------------------------------------------------ */

/** Books waiting to be read: the "to read" list when it has entries, else everything without a status. */
export function unreadPool<T extends Pick<BookDTO, 'readingStatus'>>(books: readonly T[]): T[] {
  const toRead = books.filter((b) => b.readingStatus === 'to_read');
  if (toRead.length > 0) return toRead;
  return books.filter((b) => b.readingStatus === 'unknown');
}

export type RecommendationMode = 'to_read' | 'unread' | 'reread' | 'none';

/**
 * Candidates for "What should I read today?": the to-read list, else books without a status,
 * else unfinished ones (reading / abandoned), else – everything read – the favourites among the
 * read books (or all of them) for a re-read.
 */
export function recommendationPool<T extends Pick<BookDTO, 'readingStatus' | 'favorite'>>(
  books: readonly T[],
): { mode: RecommendationMode; pool: T[] } {
  if (books.length === 0) return { mode: 'none', pool: [] };
  const toRead = books.filter((b) => b.readingStatus === 'to_read');
  if (toRead.length > 0) return { mode: 'to_read', pool: toRead };
  const unknown = books.filter((b) => b.readingStatus === 'unknown' || !READING_STATUSES.includes(b.readingStatus));
  if (unknown.length > 0) return { mode: 'unread', pool: unknown };
  const unfinished = books.filter((b) => b.readingStatus === 'reading' || b.readingStatus === 'abandoned');
  if (unfinished.length > 0) return { mode: 'unread', pool: unfinished };
  const favourites = books.filter((b) => b.favorite);
  return { mode: 'reread', pool: favourites.length > 0 ? favourites : [...books] };
}

/** Picks one book; `avoidId` is skipped when there is any alternative. */
export function pickFromPool<T extends Pick<BookDTO, 'id'>>(pool: readonly T[], rnd: () => number, avoidId?: string | null): T | null {
  if (pool.length === 0) return null;
  const candidates = pool.length > 1 && avoidId ? pool.filter((b) => b.id !== avoidId) : pool;
  const list = candidates.length > 0 ? candidates : pool;
  return list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
}

/** Deterministic "today's pick" seed: same collection + same local day → same book. */
export function dailySeed(collectionId: string, date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${collectionId}:${y}-${m}-${d}`;
}

/**
 * A short row of books for the shuffle animation: the pick in the middle, surrounded by other
 * books (unread ones first, then any), at most `size` long.
 */
export function shuffleRow<T extends Pick<BookDTO, 'id' | 'readingStatus'>>(
  pick: T,
  pool: readonly T[],
  all: readonly T[],
  size: number,
  seed: number | string,
): T[] {
  const rnd = seededRandom(seed);
  const others: T[] = [];
  const take = (list: readonly T[]) => {
    const copy = list.filter((b) => b.id !== pick.id && !others.some((o) => o.id === b.id));
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    for (const b of copy) {
      if (others.length >= size - 1) break;
      others.push(b);
    }
  };
  take(pool);
  take(all);
  const middle = Math.floor(others.length / 2);
  return [...others.slice(0, middle), pick, ...others.slice(middle)];
}

/**
 * Trims a row of items from its ends (alternating, the side farther from the kept item first) until
 * the widths plus gaps fit `maxWidth`. The `keepId` item always stays; the order is preserved.
 */
export function fitRow<T extends { id: string }>(
  items: readonly T[],
  keepId: string | null,
  widthOf: (item: T) => number,
  gap: number,
  maxWidth: number,
): T[] {
  const row = [...items];
  const total = () => row.reduce((s, it) => s + widthOf(it), 0) + Math.max(0, row.length - 1) * gap;
  while (row.length > 1 && total() > maxWidth) {
    const keep = keepId ? row.findIndex((it) => it.id === keepId) : -1;
    if (keep < 0) {
      row.pop();
      continue;
    }
    const leftCount = keep;
    const rightCount = row.length - 1 - keep;
    if (leftCount === 0 && rightCount === 0) break;
    if (rightCount >= leftCount) row.pop();
    else row.shift();
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* Everything at once                                                  */
/* ------------------------------------------------------------------ */

export interface CollectionStats {
  total: number;
  authorCount: number;
  /** average number of books per individual author (0 without authors) */
  booksPerAuthor: number;
  topicCount: number;
  /** the taxonomy key carried by the most books (category or topic) */
  topTopic: { key: string; count: number } | null;
  languageCount: number;
  pages: PageEstimate;
  shelfLengthCm: number;
  favorites: number;
  read: number;
  readShare: number;
  topAuthors: { author: string; count: number }[];
  categories: CategorySlice[];
  languages: { entries: CountEntry[]; unknown: number };
  originalLanguages: { entries: CountEntry[]; unknown: number };
  translation: { translated: number; known: number; share: number };
  countries: { entries: CountryEntry[]; unknownAuthors: number };
  years: { buckets: YearBucket[]; unknown: number };
  statuses: Record<ReadingStatus, number>;
  quality: RecognitionQuality;
  facts: FunFacts;
}

export function computeStats(books: readonly BookDTO[], opts: { locale: Locale; paletteBooks?: readonly BookDTO[] }): CollectionStats {
  const { locale } = opts;
  const authors = uniqueAuthors(books, locale);
  const topics = new Map<string, number>();
  const languages = new Set<string>();
  let favorites = 0;
  for (const b of books) {
    for (const k of bookTopicKeys(b)) topics.set(k, (topics.get(k) ?? 0) + 1);
    const l = normCode(b.language);
    if (l) languages.add(l);
    if (b.favorite) favorites += 1;
  }
  const statuses = statusCounts(books);
  const topTopicEntry = countEntries(topics, books.length, locale)[0];
  const authorLinks = authors.reduce((s, a) => s + a.count, 0);
  return {
    total: books.length,
    authorCount: authors.length,
    booksPerAuthor: authors.length > 0 ? authorLinks / authors.length : 0,
    topicCount: topics.size,
    topTopic: topTopicEntry ? { key: topTopicEntry.key, count: topTopicEntry.count } : null,
    languageCount: languages.size,
    pages: estimatePages(books),
    shelfLengthCm: shelfLengthCm(books.length),
    favorites,
    read: statuses.read,
    readShare: share(statuses.read, books.length),
    topAuthors: authors.slice(0, 10).map(({ author, count }) => ({ author, count })),
    categories: categorySlices(books, opts.paletteBooks ?? books, locale),
    languages: languageCounts(books, 'language', locale),
    originalLanguages: languageCounts(books, 'originalLanguage', locale),
    translation: translationStats(books),
    countries: countryCounts(books, locale),
    years: yearHistogram(books),
    statuses,
    quality: recognitionQuality(books),
    facts: funFacts(books, locale),
  };
}

