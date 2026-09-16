/**
 * Pure, DOM-free helpers for working with books in the UI (owner: ui-kit).
 *
 * Safe to import from server components, client components, route handlers and tests.
 * Everything here is deterministic: the same book always gets the same colour, size and
 * initial, so shelves look identical on every device and every render.
 */
import type { BookFilters, SortKey } from '@/components/collection/context';
import type { BookDTO, Locale } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Text folding & search                                               */
/* ------------------------------------------------------------------ */

/** Letters that NFD does not decompose into base + combining mark. */
const SPECIAL_LETTERS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};
const SPECIAL_RE = /[ßæœøłđðþı]/g;

/**
 * Lower-case, accents folded (á→a, ő→o, ű→u, ß→ss …), whitespace collapsed, trimmed.
 * Punctuation is kept – use {@link foldForSearch} when it should be ignored.
 */
export function foldText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(SPECIAL_RE, (c) => SPECIAL_LETTERS[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim();
}

/** {@link foldText} + every non letter/digit replaced by a space (then collapsed). */
export function foldForSearch(s: string | null | undefined): string {
  return foldText(s)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compact(s: string): string {
  return s.replace(/\s+/g, '');
}

/** The text a free-text query is matched against. */
function searchHaystack(book: BookDTO): string {
  return foldForSearch(
    [
      book.title,
      book.subtitle,
      book.author,
      book.series,
      book.publisher,
      book.originalTitle,
      book.spineTitle,
      book.spineAuthor,
      book.isbn,
    ]
      .filter(Boolean)
      .join('  '),
  );
}

/**
 * Accent- and case-insensitive search over title, subtitle, author, series, publisher,
 * original title, the raw spine reading and ISBN. Every whitespace-separated term of the
 * query must occur (AND). Punctuation is ignored, so "sci-fi" matches "scifi" and vice versa.
 * An empty query matches everything.
 */
export function bookMatchesQuery(book: BookDTO, query: string): boolean {
  const q = foldForSearch(query);
  if (!q) return true;
  const hay = searchHaystack(book);
  const hayCompact = compact(hay);
  return q.split(' ').every((term) => hay.includes(term) || hayCompact.includes(term));
}

/* ------------------------------------------------------------------ */
/* Authors                                                             */
/* ------------------------------------------------------------------ */

/** Splits a display author value ("A; B", "A & B") into individual names. */
export function splitAuthors(author: string | null | undefined): string[] {
  if (!author) return [];
  return author
    .split(/\s*(?:;|\s&\s|\s\+\s)\s*/)
    .map((a) => a.trim())
    .filter(Boolean);
}

/**
 * Author name in family-name-first order *with accents preserved*, for collation.
 * Uses `authorSort` (folded, family name first) to learn the order and maps its tokens
 * back to the original accented tokens ("ferrante elena" + "Elena Ferrante" → "Ferrante Elena").
 * Falls back to `authorSort`, then the display author.
 */
export function authorSortName(book: Pick<BookDTO, 'author' | 'authorSort'>): string | null {
  const first = splitAuthors(book.author)[0] ?? null;
  const sort = foldForSearch(book.authorSort) || null;
  if (!first) return sort;
  if (!sort) return first;
  // word tokens with accents preserved ("J.R.R. Tolkien" → J, R, R, Tolkien)
  const pool = first
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((token) => ({ token, key: foldForSearch(token) }));
  const out: string[] = [];
  for (const key of sort.split(' ')) {
    const idx = pool.findIndex((p) => p.key === key);
    // authorSort describes a different name (e.g. stale after an edit): its order is all we know
    if (idx < 0) return sort;
    out.push(pool[idx].token);
    pool.splice(idx, 1);
  }
  // tokens that were not part of the sort key keep their relative order at the end
  return [...out, ...pool.map((p) => p.token)].join(' ');
}

/**
 * Family name of the (first) author, accents preserved – what a spine prints when space is short.
 * Learns the name order from `authorSort`: "Gabriel García Márquez" + "garcia marquez gabriel" →
 * "García Márquez"; family-first names ("Nemes Nagy Ágnes") drop the last (given) name.
 * Without `authorSort` the order is unknown and the full name is returned.
 */
export function authorFamilyName(book: Pick<BookDTO, 'author' | 'authorSort'>): string | null {
  const first = splitAuthors(book.author)[0] ?? null;
  if (!first) return null;
  if (!book.authorSort) return first;
  const display = first.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const sorted = (authorSortName(book) ?? '').split(' ').filter(Boolean);
  if (display.length < 2 || sorted.length < 2) return first;
  const displayKeys = display.map(foldForSearch);
  const sortedKeys = sorted.map(foldForSearch);
  if (displayKeys.join(' ') === sortedKeys.join(' ')) {
    // already family-first (Hungarian order): everything but the last given name
    return display.slice(0, -1).join(' ');
  }
  const firstGiven = sortedKeys.indexOf(foldForSearch(display[0]));
  if (firstGiven <= 0) return first;
  return sorted.slice(0, firstGiven).join(' ');
}

const LETTER_RE = /\p{L}/u;
const HU_DIGRAPHS = ['dzs', 'cs', 'dz', 'gy', 'ly', 'ny', 'sz', 'ty', 'zs'];

/**
 * A–Z index letter for a book's (first) author, family name first.
 * Hungarian digraph aware (Cs, Dz, Dzs, Gy, Ly, Ny, Sz, Ty, Zs); accented letters are grouped
 * with their base letter (Á→A, Ö/Ő→O …); books without an author or starting with a
 * non-letter get "#".
 */
export function authorInitial(
  book: Pick<BookDTO, 'author' | 'authorSort'>,
  opts: { digraphs?: boolean } = {},
): string {
  const name = authorSortName(book);
  return initialOf(name, opts.digraphs ?? true);
}

/** Index letter for any string (see {@link authorInitial}). */
export function initialOf(value: string | null | undefined, digraphs = true): string {
  if (!value) return '#';
  const trimmed = value.replace(/^[\s"'„“”‚‘’«»‹›()[\]{}<>¿¡*_\-–—.,:;!?]+/u, '');
  const first = trimmed.charAt(0);
  if (!first || !LETTER_RE.test(first)) return '#';
  const folded = foldText(trimmed.slice(0, 3));
  if (digraphs) {
    for (const dg of HU_DIGRAPHS) {
      if (folded.startsWith(dg)) return dg.charAt(0).toUpperCase() + dg.slice(1);
    }
  }
  const base = folded.charAt(0);
  if (!base || !LETTER_RE.test(base)) return '#';
  // ß folds to "ss", æ to "ae" … keep the first letter only
  return base.toUpperCase();
}

/** Order of index letters (Hungarian alphabet order for digraphs, "#" last). */
export function compareInitials(a: string, b: string, locale: Locale = 'hu'): number {
  if (a === b) return 0;
  if (a === '#') return 1;
  if (b === '#') return -1;
  return collator(locale).compare(a, b);
}

export interface AuthorGroup {
  author: string;
  count: number;
  books: BookDTO[];
}

/**
 * One entry per individual author (multi-author values are split on ";"), with their books.
 * Sorted by count (desc), then by family-name-first collation. Books without author are skipped.
 */
export function uniqueAuthors(books: readonly BookDTO[], locale: Locale = 'hu'): AuthorGroup[] {
  const map = new Map<string, AuthorGroup & { sortName: string }>();
  for (const book of books) {
    const names = splitAuthors(book.author);
    names.forEach((name, i) => {
      const key = foldForSearch(name);
      if (!key) return;
      let group = map.get(key);
      if (!group) {
        const sortName = i === 0 ? (authorSortName(book) ?? name) : name;
        group = { author: name, count: 0, books: [], sortName };
        map.set(key, group);
      }
      if (!group.books.includes(book)) {
        group.books.push(book);
        group.count += 1;
      }
    });
  }
  const c = collator(locale);
  return [...map.values()]
    .sort((a, b) => b.count - a.count || c.compare(a.sortName, b.sortName))
    .map(({ author, count, books: list }) => ({ author, count, books: list }));
}

/* ------------------------------------------------------------------ */
/* Topics, years                                                       */
/* ------------------------------------------------------------------ */

/** Every taxonomy key of a book (category first, then topics, de-duplicated). */
export function bookTopicKeys(book: Pick<BookDTO, 'category' | 'topics'>): string[] {
  const keys: string[] = [];
  if (book.category) keys.push(book.category);
  for (const t of book.topics ?? []) if (t && !keys.includes(t)) keys.push(t);
  return keys;
}

/**
 * How many books carry each taxonomy key (category or topics; a book counts once per key).
 * Books without any key are counted under "other". Sorted by count desc, then key.
 */
export function topicCounts(books: readonly BookDTO[]): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const book of books) {
    const keys = bookTopicKeys(book);
    if (keys.length === 0) keys.push('other');
    for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function validYear(year: number | null | undefined): year is number {
  return typeof year === 'number' && Number.isFinite(year) && Number.isInteger(year) && Math.abs(year) < 10000;
}

/** Decade start year (1968 → 1960), or null. */
export function decadeOf(year: number | null | undefined): number | null {
  return validYear(year) ? Math.floor(year / 10) * 10 : null;
}

/** Century start year (1968 → 1900, 2000 → 2000), or null. */
export function centuryOf(year: number | null | undefined): number | null {
  return validYear(year) ? Math.floor(year / 100) * 100 : null;
}

/** Ordinal century number as used in "20. század" / "20th century" (1968 → 20, 2000 → 20, 2001 → 21). */
export function centuryNumber(year: number | null | undefined): number | null {
  if (!validYear(year)) return null;
  return year > 0 ? Math.floor((year - 1) / 100) + 1 : -(Math.floor(-year / 100) + 1);
}

/* ------------------------------------------------------------------ */
/* Filtering & sorting                                                 */
/* ------------------------------------------------------------------ */

/** true when the book needs a human look and has not been reviewed yet */
export function isPendingReview(book: Pick<BookDTO, 'needsReview' | 'reviewed'>): boolean {
  return book.needsReview && !book.reviewed;
}

export function isLent(book: Pick<BookDTO, 'lentTo' | 'lentAt'>): boolean {
  return Boolean(book.lentTo?.trim() || book.lentAt);
}

/**
 * Applies {@link BookFilters}. Within one filter the values are OR-ed (any selected topic),
 * different filters are AND-ed. Keeps the input order.
 */
export function applyFilters(books: readonly BookDTO[], filters: BookFilters): BookDTO[] {
  const q = foldForSearch(filters.q);
  const topics = new Set(filters.topics);
  const statuses = new Set(filters.statuses);
  const authors = new Set(filters.authors.map(foldForSearch));
  const languages = new Set(filters.languages.map((l) => l.toLowerCase()));
  const decades = new Set(filters.decades);

  return books.filter((book) => {
    if (q && !bookMatchesQuery(book, q)) return false;
    if (topics.size > 0 && !bookTopicKeys(book).some((k) => topics.has(k))) {
      // books without any key are shown under "other"
      if (!(topics.has('other') && bookTopicKeys(book).length === 0)) return false;
    }
    if (statuses.size > 0 && !statuses.has(book.readingStatus)) return false;
    if (authors.size > 0) {
      const whole = foldForSearch(book.author);
      const parts = splitAuthors(book.author).map(foldForSearch);
      if (!authors.has(whole) && !parts.some((p) => authors.has(p))) return false;
    }
    if (languages.size > 0 && !(book.language && languages.has(book.language.toLowerCase()))) return false;
    if (decades.size > 0) {
      const decade = decadeOf(book.firstPublishedYear);
      if (decade === null || !decades.has(decade)) return false;
    }
    if (filters.needsReview && !isPendingReview(book)) return false;
    if (filters.favorites && !book.favorite) return false;
    if (filters.lent && !isLent(book)) return false;
    return true;
  });
}

/** Number of active filter groups (the search text counts as one). */
export function countActiveFilters(filters: BookFilters): number {
  return (
    (filters.q.trim() ? 1 : 0) +
    (filters.topics.length ? 1 : 0) +
    (filters.statuses.length ? 1 : 0) +
    (filters.authors.length ? 1 : 0) +
    (filters.languages.length ? 1 : 0) +
    (filters.decades.length ? 1 : 0) +
    (filters.needsReview ? 1 : 0) +
    (filters.favorites ? 1 : 0) +
    (filters.lent ? 1 : 0)
  );
}

const collators = new Map<Locale, Intl.Collator>();

/** Cached Intl.Collator for the UI locale ("hu" knows cs/sz/zs… and ö/ő ordering). */
export function collator(locale: Locale): Intl.Collator {
  let c = collators.get(locale);
  if (!c) {
    try {
      c = new Intl.Collator(locale === 'hu' ? 'hu-HU' : 'en-GB', { numeric: true, usage: 'sort' });
    } catch {
      c = new Intl.Collator(undefined, { numeric: true });
    }
    collators.set(locale, c);
  }
  return c;
}

const LEADING_ARTICLE_RE = /^(?:(?:a|az|the|an|der|die|das|le|la|les)\s+|l['’])/i;

/** Title without a leading article ("A", "Az", "The", "Der", "L'" …), accents preserved (for collation). */
export function titleSortName(book: Pick<BookDTO, 'title'>): string {
  const t = (book.title ?? '').trim().replace(/^["'„“‚‘«»(\[]+/u, '');
  const stripped = t.replace(LEADING_ARTICLE_RE, '').trim();
  return stripped || t;
}

function timeValue(iso: string | null | undefined): number {
  if (!iso) return 0;
  const v = Date.parse(iso);
  return Number.isNaN(v) ? 0 : v;
}

/** Returns a new sorted array. Missing values (no author, no year, no rating) always go last. */
export function sortBooks(books: readonly BookDTO[], sort: SortKey, locale: Locale): BookDTO[] {
  const c = collator(locale);
  const byTitle = (a: BookDTO, b: BookDTO) => c.compare(titleSortName(a), titleSortName(b));
  const byAuthor = (a: BookDTO, b: BookDTO) => {
    const an = authorSortName(a);
    const bn = authorSortName(b);
    if (!an && !bn) return 0;
    if (!an) return 1;
    if (!bn) return -1;
    return c.compare(an, bn);
  };
  const byShelf = (a: BookDTO, b: BookDTO) =>
    a.shelfPosition - b.shelfPosition || timeValue(a.createdAt) - timeValue(b.createdAt);

  const list = [...books];
  switch (sort) {
    case 'author':
      return list.sort((a, b) => byAuthor(a, b) || byTitle(a, b) || byShelf(a, b));
    case 'title':
      return list.sort((a, b) => byTitle(a, b) || byAuthor(a, b) || byShelf(a, b));
    case 'year':
      return list.sort((a, b) => {
        const ay = validYear(a.firstPublishedYear) ? a.firstPublishedYear : null;
        const by = validYear(b.firstPublishedYear) ? b.firstPublishedYear : null;
        if (ay === null && by !== null) return 1;
        if (by === null && ay !== null) return -1;
        return (ay ?? 0) - (by ?? 0) || byAuthor(a, b) || byTitle(a, b);
      });
    case 'added':
      return list.sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt) || byShelf(a, b));
    case 'rating':
      return list.sort((a, b) => {
        const ar = a.rating ?? null;
        const br = b.rating ?? null;
        if (ar === null && br !== null) return 1;
        if (br === null && ar !== null) return -1;
        return (br ?? 0) - (ar ?? 0) || Number(b.favorite) - Number(a.favorite) || byTitle(a, b);
      });
    case 'shelf':
    default:
      return list.sort(byShelf);
  }
}

/* ------------------------------------------------------------------ */
/* Hashing & seeded randomness                                         */
/* ------------------------------------------------------------------ */

/** 32-bit FNV-1a hash (unsigned). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic 0..1 value derived from a string and a "salt" (for per-book variety). */
export function hash01(s: string, salt = 0): number {
  return hashString(`${salt}:${s}`) / 0x100000000;
}

/** mulberry32 PRNG → function returning floats in [0, 1). */
export function seededRandom(seed: number | string): () => number {
  let a = (typeof seed === 'string' ? hashString(seed) : Math.floor(seed)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle into a new array; same seed → same order. */
export function shuffle<T>(items: readonly T[], seed: number | string = Date.now()): T[] {
  const rnd = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** One random element (seeded when a seed is given), or undefined for an empty list. */
export function pickRandom<T>(items: readonly T[], seed?: number | string): T | undefined {
  if (items.length === 0) return undefined;
  const rnd = seed === undefined ? Math.random : seededRandom(seed);
  return items[Math.floor(rnd() * items.length)];
}

/* ------------------------------------------------------------------ */
/* Colour                                                              */
/* ------------------------------------------------------------------ */

/**
 * Warm "old library" palette used when a book has no measured spine colour:
 * oxblood, bottle green, navy, ochre, tobacco, teal, plum, vellum, terracotta, olive,
 * mustard, dusty rose, ink, sage, cornflower, burgundy.
 */
export const SPINE_PALETTE: readonly string[] = [
  '#6e2a2f',
  '#1f4d3a',
  '#1f3552',
  '#b5832a',
  '#7a4b2a',
  '#2f5d62',
  '#4f2f4a',
  '#e6d8b8',
  '#a4552f',
  '#5d6232',
  '#c9a13b',
  '#c4887e',
  '#262320',
  '#8a9a7b',
  '#4d6a92',
  '#7a2e3a',
];

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parses #rgb / #rrggbb / #rrggbbaa (alpha ignored). Returns null for anything else. */
export function parseHexColor(hex: string | null | undefined): Rgb | null {
  if (!hex) return null;
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear mix of two colours, t = 0 → a, t = 1 → b. */
export function mixColors(a: string, b: string, t: number): string {
  const ca = parseHexColor(a) ?? { r: 0, g: 0, b: 0 };
  const cb = parseHexColor(b) ?? { r: 0, g: 0, b: 0 };
  const k = Math.min(1, Math.max(0, t));
  return rgbToHex({ r: ca.r + (cb.r - ca.r) * k, g: ca.g + (cb.g - ca.g) * k, b: ca.b + (cb.b - ca.b) * k });
}

/** Darken (amount < 0, towards near-black) or lighten (amount > 0, towards warm white). */
export function shadeColor(hex: string, amount: number): string {
  return amount < 0 ? mixColors(hex, '#0d0a07', -amount) : mixColors(hex, '#fff8ea', amount);
}

/** WCAG relative luminance 0..1. */
export function relativeLuminance(hex: string): number {
  const c = parseHexColor(hex);
  if (!c) return 0;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const INK_DARK = '#1e1914';
export const INK_LIGHT = '#fbf6ec';

/** Dark ink or light paper colour – whichever contrasts more with `bg`. */
export function readableTextColor(bg: string): string {
  return contrastRatio(bg, INK_DARK) >= contrastRatio(bg, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

/** true when light text reads better on this colour. */
export function isDarkColor(hex: string): boolean {
  return readableTextColor(hex) === INK_LIGHT;
}

/**
 * The colour a book is drawn in: its measured `spineColor` (normalised to #rrggbb) or a
 * deterministic warm-library palette colour chosen by hash of author (or title when no author),
 * so books by the same author share a colour.
 */
export function spineColor(book: Pick<BookDTO, 'spineColor' | 'author' | 'title'>): string {
  const measured = parseHexColor(book.spineColor);
  if (measured) return rgbToHex(measured);
  const key = foldForSearch(book.author) || foldForSearch(book.title) || '?';
  return SPINE_PALETTE[hashString(key) % SPINE_PALETTE.length];
}

/* ------------------------------------------------------------------ */
/* Spine geometry                                                      */
/* ------------------------------------------------------------------ */

export interface SpineDimensions {
  /** 0.78 – 1 of the size's full height */
  heightRatio: number;
  /** 0.7 – 1.35 of the size's base thickness */
  widthRatio: number;
}

const HEIGHT_FORMATS = [0.78, 0.83, 0.87, 0.9, 0.93, 0.96, 1] as const;
const HEIGHT_WEIGHTS = [1, 2, 3, 4, 4, 3, 2] as const;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Deterministic relative spine size. Thickness follows `pageCount` (log scale, 60 → 0.7,
 * ~1200+ → 1.35) or, without it, the title length (so long titles get room); height picks
 * a common book format by hash of author + title.
 */
export function spineDimensions(book: Pick<BookDTO, 'pageCount' | 'title' | 'author'>): SpineDimensions {
  const key = `${foldForSearch(book.author)}|${foldForSearch(book.title)}`;

  // height: weighted pick of typical formats
  const total = HEIGHT_WEIGHTS.reduce((s, w) => s + w, 0);
  let pick = hash01(key, 1) * total;
  let heightRatio: number = HEIGHT_FORMATS[HEIGHT_FORMATS.length - 1];
  for (let i = 0; i < HEIGHT_FORMATS.length; i++) {
    pick -= HEIGHT_WEIGHTS[i];
    if (pick < 0) {
      heightRatio = HEIGHT_FORMATS[i];
      break;
    }
  }

  let widthRatio: number;
  const pages = book.pageCount;
  if (typeof pages === 'number' && Number.isFinite(pages) && pages > 0) {
    const t = (Math.log(Math.max(60, pages)) - Math.log(60)) / (Math.log(1200) - Math.log(60));
    widthRatio = 0.7 + Math.min(1, t) * 0.65;
  } else {
    const len = Math.min(60, (book.title ?? '').trim().length + (book.author ?? '').trim().length * 0.35);
    const jitter = (hash01(key, 2) - 0.5) * 0.18;
    widthRatio = 0.74 + (len / 60) * 0.5 + jitter;
  }
  return {
    heightRatio: round2(Math.min(1, Math.max(0.78, heightRatio))),
    widthRatio: round2(Math.min(1.35, Math.max(0.7, widthRatio))),
  };
}

/* ------------------------------------------------------------------ */
/* Countries & languages                                               */
/* ------------------------------------------------------------------ */

const COUNTRY_ALIASES: Record<string, string> = { UK: 'GB', EL: 'GR' };

function normaliseCountry(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  const mapped = COUNTRY_ALIASES[c] ?? c;
  return /^[A-Z]{2}$/.test(mapped) ? mapped : null;
}

/** ISO 3166-1 alpha-2 → flag emoji ("hu" → 🇭🇺). Empty string for invalid codes. */
export function countryFlagEmoji(code: string | null | undefined): string {
  const c = normaliseCountry(code);
  if (!c) return '';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

const displayNames = new Map<string, Intl.DisplayNames | null>();

function getDisplayNames(locale: Locale, type: 'region' | 'language'): Intl.DisplayNames | null {
  const k = `${locale}:${type}`;
  if (!displayNames.has(k)) {
    try {
      displayNames.set(k, new Intl.DisplayNames([locale === 'hu' ? 'hu-HU' : 'en-GB'], { type, fallback: 'none' }));
    } catch {
      displayNames.set(k, null);
    }
  }
  return displayNames.get(k) ?? null;
}

function upperFirst(s: string, locale: Locale): string {
  return s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s;
}

/**
 * Localised country name ("HU" → "Magyarország" / "Hungary"). Returns the upper-cased code
 * when the name is unknown and "" for empty input.
 */
export function countryName(code: string | null | undefined, locale: Locale): string {
  if (!code?.trim()) return '';
  const c = normaliseCountry(code);
  if (!c) return code.trim().toUpperCase();
  try {
    return getDisplayNames(locale, 'region')?.of(c) ?? c;
  } catch {
    return c;
  }
}

/**
 * Localised language name, first letter capitalised ("hu" → "Magyar" / "Hungarian").
 * Returns the code when unknown and "" for empty input.
 */
export function languageName(code: string | null | undefined, locale: Locale): string {
  const c = code?.trim();
  if (!c) return '';
  try {
    const name = getDisplayNames(locale, 'language')?.of(c.replace('_', '-'));
    return name ? upperFirst(name, locale) : c;
  } catch {
    return c;
  }
}
