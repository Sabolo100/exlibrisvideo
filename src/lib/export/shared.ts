/**
 * Shared helpers for all export formats: localized labels, catalogue ordering,
 * author / topic statistics and value formatting. Pure – no I/O, no env access.
 */
import { getTranslator, type MessageKey, type Translator } from '@/i18n';
import { authorSortKey as pipelineAuthorSortKey, familyName as familyNameOf } from '@/lib/pipeline/text';
import { topicDef, topicLabel } from '@/lib/taxonomy';
import type { BookDTO, BookSource, CollectionWithBooksDTO, ExportFormat, Locale, ReadingStatus } from '@/lib/types';

/** Time zone used for calendar dates in exports (the service's home). */
export const EXPORT_TIME_ZONE = 'Europe/Budapest';

export interface ExportOptions {
  /** include owner-only columns/fields (notes, lent to, lent on). Defaults to `collection.isOwner`. */
  isOwner?: boolean;
  /** clock override (tests) */
  now?: Date;
}

export interface ExportContext {
  collection: CollectionWithBooksDTO;
  locale: Locale;
  isOwner: boolean;
  now: Date;
  tr: Translator;
  t: (key: MessageKey, vars?: Record<string, string | number | null | undefined>) => string;
  /** origin of the public URL, e.g. "https://www.exlibrisvideo.hu" (used to absolutize /api/media links) */
  origin: string;
  collator: Intl.Collator;
  /** books in catalogue order (author family name, title, shelf position) */
  books: BookDTO[];
  title: string;
}

export function createExportContext(
  collection: CollectionWithBooksDTO,
  locale: Locale,
  opts: ExportOptions = {},
): ExportContext {
  const tr = getTranslator(locale);
  const collator = new Intl.Collator(locale === 'hu' ? 'hu' : 'en', { sensitivity: 'base', numeric: true });
  const books = sortBooksForCatalogue(collection.books ?? [], locale, collator);
  return {
    collection,
    locale,
    isOwner: opts.isOwner ?? collection.isOwner,
    now: opts.now ?? new Date(),
    tr,
    t: tr.t,
    origin: originOf(collection.publicUrl),
    collator,
    books,
    title: collectionTitle(collection, locale),
  };
}

export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  xlsx: 'xlsx',
  csv: 'csv',
  json: 'json',
  pdf: 'pdf',
  goodreads: 'csv',
};

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  pdf: 'application/pdf',
  goodreads: 'text/csv; charset=utf-8',
};

/** `exlibris-<id>.<ext>`, Goodreads: `exlibris-<id>-goodreads.csv` */
export function exportFilename(collectionId: string, format: ExportFormat): string {
  const safeId = String(collectionId).replace(/[^A-Za-z0-9_-]/g, '') || 'catalogue';
  const suffix = format === 'goodreads' ? '-goodreads' : '';
  return `exlibris-${safeId}${suffix}.${EXPORT_EXTENSIONS[format]}`;
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export function collectionTitle(collection: Pick<CollectionWithBooksDTO, 'title' | 'ownerName'>, locale: Locale): string {
  const title = collection.title?.trim();
  if (title) return title;
  const tr = getTranslator(locale);
  const owner = collection.ownerName?.trim();
  return owner ? tr.t('exporting.untitledOwner', { name: owner }) : tr.t('exporting.untitled');
}

export function readingStatusLabel(status: ReadingStatus, locale: Locale): string {
  const key = `exporting.status.${status}` as MessageKey;
  return getTranslator(locale).t(key);
}

export function sourceLabel(source: BookSource, locale: Locale): string {
  const key = `exporting.source.${source}` as MessageKey;
  return getTranslator(locale).t(key);
}

export function yesNo(value: boolean, locale: Locale): string {
  return getTranslator(locale).t(value ? 'exporting.value.yes' : 'exporting.value.no');
}

const displayNamesCache = new Map<Locale, Intl.DisplayNames | null>();

/** Localized language name for an ISO 639 code ("hu" → "magyar" / "Hungarian"); unknown codes are returned as-is. */
export function languageName(code: string | null | undefined, locale: Locale): string {
  const c = code?.trim();
  if (!c) return '';
  let dn = displayNamesCache.get(locale);
  if (dn === undefined) {
    try {
      dn = new Intl.DisplayNames([locale === 'hu' ? 'hu' : 'en'], { type: 'language', fallback: 'code' });
    } catch {
      dn = null;
    }
    displayNamesCache.set(locale, dn);
  }
  if (!dn) return c;
  try {
    return dn.of(c) ?? c;
  } catch {
    return c;
  }
}

/** Primary topic label ('' when none). */
export function primaryTopicLabel(book: BookDTO, locale: Locale): string {
  return book.category ? topicLabel(book.category, locale) : '';
}

/** Additional topic keys (excluding the primary category, deduplicated). */
export function secondaryTopicKeys(book: BookDTO): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of book.topics ?? []) {
    if (!k || k === book.category || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export function secondaryTopicLabels(book: BookDTO, locale: Locale): string[] {
  return secondaryTopicKeys(book).map((k) => topicLabel(k, locale));
}

export function ratingStars(rating: number | null | undefined): string {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) return '';
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

/* ------------------------------------------------------------------ */
/* URLs & dates                                                        */
/* ------------------------------------------------------------------ */

export function originOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Makes `/api/media/...` absolute; returns null for anything that is not http(s). */
export function absoluteUrl(url: string | null | undefined, origin: string): string | null {
  const u = url?.trim();
  if (!u) return null;
  try {
    const parsed = u.startsWith('/') ? new URL(u, origin || 'http://localhost') : new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (u.startsWith('/') && !origin) return u;
    return parsed.toString();
  } catch {
    return null;
  }
}

export interface YMD {
  y: number;
  m: number;
  d: number;
}

const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: EXPORT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date of an instant in the export time zone. */
export function calendarDate(value: string | Date | null | undefined): YMD | null {
  if (!value) return null;
  // plain dates ("2026-09-13") are already calendar dates
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = ymdFormatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const y = get('year');
  const m = get('month');
  const d = get('day');
  if (!y || !m || !d) return null;
  return { y, m, d };
}

export function isoDate(value: string | Date | null | undefined, sep = '-'): string {
  const c = calendarDate(value);
  if (!c) return '';
  return [String(c.y).padStart(4, '0'), String(c.m).padStart(2, '0'), String(c.d).padStart(2, '0')].join(sep);
}

/** A Date at UTC midnight of the calendar day (spreadsheet cells are timezone-less). */
export function utcDateOf(value: string | Date | null | undefined): Date | null {
  const c = calendarDate(value);
  return c ? new Date(Date.UTC(c.y, c.m - 1, c.d)) : null;
}

export function longDate(value: Date | string, locale: Locale): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale === 'hu' ? 'hu-HU' : 'en-GB', {
    dateStyle: 'long',
    timeZone: EXPORT_TIME_ZONE,
  }).format(date);
}

/* ------------------------------------------------------------------ */
/* Text folding, authors                                               */
/* ------------------------------------------------------------------ */

/** lower-case, accents stripped (ő→o, ű→u), whitespace collapsed */
export function fold(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "A; B" → ["A", "B"] */
export function splitAuthors(author: string | null | undefined): string[] {
  if (!author) return [];
  return author
    .split(';')
    .map((a) => a.trim())
    .filter(Boolean);
}

export function primaryAuthor(book: Pick<BookDTO, 'author'>): string | null {
  return splitAuthors(book.author)[0] ?? null;
}

function tokens(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

function stripPunct(s: string): string {
  return s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** folded, letters and digits only ("Cserna-Szabó" → "csernaszabo") */
function compact(s: string): string {
  return fold(s).replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * The family-name token of the primary author as displayed (keeps accents), using the
 * family-first `authorSort` key when available.
 */
export function familyNameToken(book: Pick<BookDTO, 'author' | 'authorSort' | 'language' | 'authorCountry'>): string | null {
  const author = primaryAuthor(book);
  if (!author) return null;
  const parts = tokens(author).map(stripPunct).filter(Boolean);
  if (parts.length === 0) return null;
  const sortFirst = compact(tokens(fold(book.authorSort ?? ''))[0] ?? '');
  if (sortFirst) {
    const hit =
      parts.find((p) => compact(p) === sortFirst) ??
      parts.find((p) => compact(p).length > 1 && sortFirst.startsWith(compact(p)));
    if (hit) return hit;
  }
  // no usable sort key: the pipeline's name-order heuristic (given-name list + orthography)
  const family = compact(tokens(familyNameOf(author, book.language) ?? '')[0] ?? '');
  if (family) {
    const hit = parts.find((p) => compact(p) === family);
    if (hit) return hit;
  }
  const country = book.authorCountry?.trim().toUpperCase();
  const hungarianOrder = country ? country === 'HU' : book.language === 'hu';
  return hungarianOrder ? parts[0] : parts[parts.length - 1];
}

/**
 * True when the display author is written family name first (Hungarian order),
 * e.g. "Szabó Magda" with authorSort "szabo magda".
 */
export function isFamilyNameFirst(book: Pick<BookDTO, 'author' | 'authorSort' | 'language' | 'authorCountry'>): boolean {
  const author = primaryAuthor(book);
  if (!author) return false;
  const parts = tokens(author).map(stripPunct).filter(Boolean);
  if (parts.length < 2) return false;
  const family = familyNameToken(book);
  return family !== null && family === parts[0] && fold(parts[0]) !== fold(parts[parts.length - 1]);
}

/* ------------------------------------------------------------------ */
/* Catalogue grouping & ordering                                       */
/* ------------------------------------------------------------------ */

const HU_ALPHABET = [
  'A', 'B', 'C', 'Cs', 'D', 'Dz', 'Dzs', 'E', 'F', 'G', 'Gy', 'H', 'I', 'J', 'K', 'L', 'Ly', 'M', 'N', 'Ny',
  'O', 'Ö', 'P', 'Q', 'R', 'S', 'Sz', 'T', 'Ty', 'U', 'Ü', 'V', 'W', 'X', 'Y', 'Z', 'Zs',
];
const EN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const HU_DIGRAPHS = ['dzs', 'cs', 'dz', 'gy', 'ly', 'ny', 'sz', 'ty', 'zs'];

export const OTHER_GROUP = '#';
export const NO_AUTHOR_GROUP = '∅';

export interface AuthorGroup {
  /** letter shown as header ("Cs", "Ö", "#"), or NO_AUTHOR_GROUP */
  key: string;
  order: number;
}

function initialOf(word: string, locale: Locale): string {
  const w = word.trim();
  if (!w) return OTHER_GROUP;
  if (locale === 'hu') {
    const lower = w.toLowerCase();
    for (const dg of HU_DIGRAPHS) {
      if (lower.startsWith(dg) && lower.length > dg.length) {
        return dg[0].toUpperCase() + dg.slice(1);
      }
    }
    const ch = lower[0];
    if (ch === 'ö' || ch === 'ő') return 'Ö';
    if (ch === 'ü' || ch === 'ű') return 'Ü';
  }
  const base = fold(w[0]).toUpperCase();
  return /^[A-Z]$/.test(base) ? base : OTHER_GROUP;
}

/** Letter group of a book's primary author (family-name initial, Hungarian digraphs for hu). */
export function authorGroupOf(book: BookDTO, locale: Locale): AuthorGroup {
  const family = familyNameToken(book);
  if (!family) {
    return { key: NO_AUTHOR_GROUP, order: 10_001 };
  }
  const key = initialOf(family, locale);
  if (key === OTHER_GROUP) return { key, order: 10_000 };
  const alphabet = locale === 'hu' ? HU_ALPHABET : EN_ALPHABET;
  const idx = alphabet.indexOf(key);
  return { key, order: idx >= 0 ? idx : 9_999 };
}

function authorSortValue(book: BookDTO): string {
  if (book.authorSort) return book.authorSort;
  const derived = pipelineAuthorSortKey(book.author, book.language);
  if (derived) return derived;
  const family = familyNameToken(book);
  const author = primaryAuthor(book) ?? '';
  if (!family) return fold(author);
  const rest = tokens(author).filter((t) => stripPunct(t) !== family);
  return fold([family, ...rest].join(' '));
}

function titleSortValue(book: BookDTO): string {
  return book.titleSort || fold(book.title);
}

export function sortBooksForCatalogue(books: BookDTO[], locale: Locale, collator?: Intl.Collator): BookDTO[] {
  const coll = collator ?? new Intl.Collator(locale === 'hu' ? 'hu' : 'en', { sensitivity: 'base', numeric: true });
  const decorated = books.map((b) => ({
    b,
    group: authorGroupOf(b, locale),
    author: authorSortValue(b),
    title: titleSortValue(b),
  }));
  decorated.sort(
    (x, y) =>
      x.group.order - y.group.order ||
      coll.compare(x.author, y.author) ||
      coll.compare(x.title, y.title) ||
      (x.b.shelfPosition ?? 0) - (y.b.shelfPosition ?? 0) ||
      x.b.id.localeCompare(y.b.id),
  );
  return decorated.map((d) => d.b);
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

export interface AuthorStat {
  name: string;
  count: number;
  titles: string[];
}

/**
 * Every credited author (multi-author books count for each), sorted by count desc, then by
 * family name ("Agatha Christie" files under C). The book's `authorSort` is used for its
 * primary author; co-authors get a derived family-name-first key.
 */
export function authorStats(books: BookDTO[], collator: Intl.Collator): AuthorStat[] {
  const map = new Map<string, AuthorStat & { sortKey: string; explicitSort: boolean }>();
  for (const b of books) {
    splitAuthors(b.author).forEach((name, i) => {
      const key = fold(name);
      const explicit = i === 0 && Boolean(b.authorSort?.trim());
      let s = map.get(key);
      if (!s) {
        s = { name, count: 0, titles: [], sortKey: authorNameSortKey(b, name, i === 0), explicitSort: explicit };
        map.set(key, s);
      } else if (explicit && !s.explicitSort) {
        s.sortKey = authorNameSortKey(b, name, true);
        s.explicitSort = true;
      }
      s.count += 1;
      s.titles.push(b.title);
    });
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || collator.compare(a.sortKey, b.sortKey) || collator.compare(a.name, b.name))
    .map(({ name, count, titles }) => ({ name, count, titles: [...titles].sort((x, y) => collator.compare(x, y)) }));
}

function authorNameSortKey(book: BookDTO, name: string, isPrimary: boolean): string {
  if (isPrimary && book.authorSort?.trim()) return book.authorSort;
  return authorSortValue({ ...book, author: name, authorSort: null });
}

export interface TopicStat {
  /** taxonomy key, or null for uncategorised */
  key: string | null;
  label: string;
  icon: string;
  /** books with this primary category */
  count: number;
  /** count / total books (0..1) */
  share: number;
  /** books listing it as an additional topic */
  secondary: number;
}

/** Primary-category counts (sum = book count), sorted by count desc, uncategorised last. */
export function topicStats(books: BookDTO[], locale: Locale, collator: Intl.Collator): TopicStat[] {
  const total = books.length;
  const primary = new Map<string | null, number>();
  const secondary = new Map<string, number>();
  for (const b of books) {
    const key = b.category || null;
    primary.set(key, (primary.get(key) ?? 0) + 1);
    for (const k of secondaryTopicKeys(b)) secondary.set(k, (secondary.get(k) ?? 0) + 1);
  }
  const keys = new Set<string | null>([...primary.keys(), ...secondary.keys()]);
  const uncategorised = getTranslator(locale).t('exporting.value.uncategorised');
  const stats: TopicStat[] = [...keys].map((key) => ({
    key,
    label: key ? topicLabel(key, locale) : uncategorised,
    icon: topicDef(key)?.icon ?? '',
    count: primary.get(key) ?? 0,
    share: total > 0 ? (primary.get(key) ?? 0) / total : 0,
    secondary: key ? secondary.get(key) ?? 0 : 0,
  }));
  return stats.sort((a, b) => {
    if ((a.key === null) !== (b.key === null)) return a.key === null ? 1 : -1;
    return b.count - a.count || b.secondary - a.secondary || collator.compare(a.label, b.label);
  });
}

export function distinctAuthorCount(books: BookDTO[]): number {
  const set = new Set<string>();
  for (const b of books) for (const a of splitAuthors(b.author)) set.add(fold(a));
  return set.size;
}

export function distinctTopicCount(books: BookDTO[]): number {
  const set = new Set<string>();
  for (const b of books) if (b.category) set.add(b.category);
  return set.size;
}

/** Excel cells hold at most 32 767 characters. */
export function clampText(s: string, max = 32_000): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
