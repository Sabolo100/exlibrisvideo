/**
 * Pure helpers for the book drawer, edit form, manual add, merge and review mode (owner: book-ux).
 * No DOM, no React – unit-tested in book-form-utils.test.ts.
 */
import { bookMatchesQuery, foldForSearch, foldText, isPendingReview } from '@/lib/book-utils';
import { authorsCompatible, titleNumbersConflict, titleSimilarity } from '@/lib/pipeline/text';
import { isTopicKey } from '@/lib/taxonomy';
import type { BBox, BookDTO, BookPatch, FrameDTO, Locale } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Limits (mirror src/lib/collections/validation.ts)                   */
/* ------------------------------------------------------------------ */

export const BOOK_LIMITS = {
  title: 500,
  subtitle: 500,
  author: 500,
  originalTitle: 500,
  series: 300,
  publisher: 300,
  notes: 5000,
  lentTo: 200,
  tag: 60,
  tags: 30,
  topics: 12,
  yearMin: 1000,
  yearMax: 2100,
  pagesMin: 1,
  pagesMax: 100_000,
} as const;

/* ------------------------------------------------------------------ */
/* ISBN                                                                */
/* ------------------------------------------------------------------ */

export type IsbnError = 'chars' | 'length' | 'checksum';

/** Removes an "ISBN" / "ISBN-13:" prefix, spaces, hyphens and dots; upper-cases a trailing x. */
export function normalizeIsbn(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/^isbn(?:[-\s]?1[03])?\s*:?\s*/i, '')
    .replace(/[\s\-‐‑‒–—.]/g, '')
    .toUpperCase();
}

/** ISBN-10 check: weights 10..1, X = 10 only in the last position, sum divisible by 11. */
export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = isbn[i];
    const v = ch === 'X' ? 10 : ch.charCodeAt(0) - 48;
    sum += v * (10 - i);
  }
  return sum % 11 === 0;
}

/** ISBN-13 (EAN-13) check: weights 1,3,1,3…, sum divisible by 10. */
export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += (isbn.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

/**
 * Validates a user-typed ISBN. Empty input is allowed (value null). Returns the normalised value
 * (digits + optional final X) when valid.
 */
export function validateIsbn(raw: string | null | undefined): { value: string | null; error: IsbnError | null } {
  const s = normalizeIsbn(raw);
  if (s === '') return { value: null, error: null };
  if (!/^[\dX]+$/.test(s) || s.slice(0, -1).includes('X')) return { value: null, error: 'chars' };
  if (s.length === 10) return isValidIsbn10(s) ? { value: s, error: null } : { value: null, error: 'checksum' };
  if (s.length === 13) {
    if (s.includes('X')) return { value: null, error: 'chars' };
    return isValidIsbn13(s) ? { value: s, error: null } : { value: null, error: 'checksum' };
  }
  return { value: null, error: 'length' };
}

/* ------------------------------------------------------------------ */
/* Numbers, tags, languages                                            */
/* ------------------------------------------------------------------ */

export type IntError = 'number' | 'range';

/** '' → null; otherwise a whole number within [min, max]. Accepts thin spaces / dots as thousand separators. */
export function parseOptionalInt(raw: string | null | undefined, min: number, max: number): { value: number | null; error: IntError | null } {
  const s = (raw ?? '').trim().replace(/[\s  .]/g, '');
  if (s === '') return { value: null, error: null };
  if (!/^\d+$/.test(s)) return { value: null, error: 'number' };
  const v = Number.parseInt(s, 10);
  if (!Number.isSafeInteger(v) || v < min || v > max) return { value: null, error: 'range' };
  return { value: v, error: null };
}

export type TagsError = 'tooMany' | 'tooLong';

/** Comma (or semicolon) separated tags → trimmed, whitespace-collapsed, case-insensitively de-duplicated list. */
export function parseTags(raw: string | null | undefined): { tags: string[]; error: TagsError | null } {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of (raw ?? '').split(/[,;\n]/)) {
    const tag = part.replace(/\s+/g, ' ').trim();
    if (!tag) continue;
    const key = foldText(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.some((t) => t.length > BOOK_LIMITS.tag)) return { tags, error: 'tooLong' };
  if (tags.length > BOOK_LIMITS.tags) return { tags, error: 'tooMany' };
  return { tags, error: null };
}

export function formatTags(tags: readonly string[] | null | undefined): string {
  return (tags ?? []).join(', ');
}

/** Languages offered in the select (ISO 639-1 unless only 639-2/3 exists), roughly by frequency in Hungarian homes. */
export const COMMON_LANGUAGE_CODES = [
  'hu',
  'en',
  'de',
  'fr',
  'it',
  'es',
  'pt',
  'ru',
  'pl',
  'cs',
  'sk',
  'ro',
  'hr',
  'sr',
  'sl',
  'uk',
  'nl',
  'sv',
  'da',
  'no',
  'fi',
  'et',
  'el',
  'la',
  'tr',
  'he',
  'ar',
  'ja',
  'zh',
  'ko',
  'eo',
] as const;

export function isLanguageCode(s: string): boolean {
  return /^[a-z]{2,3}$/.test(s);
}

/* ------------------------------------------------------------------ */
/* Edit form                                                           */
/* ------------------------------------------------------------------ */

export interface BookFormValues {
  title: string;
  subtitle: string;
  author: string;
  originalTitle: string;
  series: string;
  publisher: string;
  /** ISO code or '' */
  language: string;
  firstPublishedYear: string;
  editionYear: string;
  isbn: string;
  pageCount: string;
  /** taxonomy key or '' */
  category: string;
  topics: string[];
  /** comma separated */
  tags: string;
}

export type BookFormField = keyof BookFormValues;

export type BookFormError =
  | { code: 'required' }
  | { code: 'tooLong'; max: number }
  | { code: 'yearNumber' }
  | { code: 'yearRange'; min: number; max: number }
  | { code: 'pagesNumber' }
  | { code: 'pagesRange'; min: number; max: number }
  | { code: 'isbnChars' }
  | { code: 'isbnLength' }
  | { code: 'isbnChecksum' }
  | { code: 'languageCode' }
  | { code: 'tagsTooMany'; max: number }
  | { code: 'tagTooLong'; max: number }
  | { code: 'topicsTooMany'; max: number };

export type BookFormErrors = Partial<Record<BookFormField, BookFormError>>;

/** Fully parsed, normalised editable values (the shape a PATCH could carry). */
export interface ParsedBookForm {
  title: string;
  subtitle: string | null;
  author: string | null;
  originalTitle: string | null;
  series: string | null;
  publisher: string | null;
  language: string | null;
  firstPublishedYear: number | null;
  editionYear: number | null;
  isbn: string | null;
  pageCount: number | null;
  category: string | null;
  topics: string[];
  tags: string[];
}

export function bookToFormValues(book: BookDTO): BookFormValues {
  return {
    title: book.title ?? '',
    subtitle: book.subtitle ?? '',
    author: book.author ?? '',
    originalTitle: book.originalTitle ?? '',
    series: book.series ?? '',
    publisher: book.publisher ?? '',
    language: book.language ?? '',
    firstPublishedYear: book.firstPublishedYear?.toString() ?? '',
    editionYear: book.editionYear?.toString() ?? '',
    isbn: book.isbn ?? '',
    pageCount: book.pageCount?.toString() ?? '',
    category: book.category ?? '',
    topics: [...(book.topics ?? [])],
    tags: formatTags(book.tags),
  };
}

/** Trimmed text, '' → null (internal whitespace runs collapsed so " A  B " and "A B" compare equal). */
export function cleanText(s: string | null | undefined): string | null {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v === '' ? null : v;
}

function textError(value: string | null, max: number): BookFormError | undefined {
  return value !== null && value.length > max ? { code: 'tooLong', max } : undefined;
}

function yearError(e: IntError | null): BookFormError | undefined {
  if (e === 'number') return { code: 'yearNumber' };
  if (e === 'range') return { code: 'yearRange', min: BOOK_LIMITS.yearMin, max: BOOK_LIMITS.yearMax };
  return undefined;
}

/** Validates the edit form. `parsed` is null when there is at least one error. */
export function validateBookForm(values: BookFormValues): { errors: BookFormErrors; parsed: ParsedBookForm | null } {
  const errors: BookFormErrors = {};
  const set = (field: BookFormField, err: BookFormError | undefined) => {
    if (err && !errors[field]) errors[field] = err;
  };

  const title = cleanText(values.title);
  if (!title) set('title', { code: 'required' });
  set('title', textError(title, BOOK_LIMITS.title));
  const subtitle = cleanText(values.subtitle);
  set('subtitle', textError(subtitle, BOOK_LIMITS.subtitle));
  const author = cleanText(values.author);
  set('author', textError(author, BOOK_LIMITS.author));
  const originalTitle = cleanText(values.originalTitle);
  set('originalTitle', textError(originalTitle, BOOK_LIMITS.originalTitle));
  const series = cleanText(values.series);
  set('series', textError(series, BOOK_LIMITS.series));
  const publisher = cleanText(values.publisher);
  set('publisher', textError(publisher, BOOK_LIMITS.publisher));

  const languageRaw = (values.language ?? '').trim().toLowerCase();
  if (languageRaw !== '' && !isLanguageCode(languageRaw)) set('language', { code: 'languageCode' });

  const first = parseOptionalInt(values.firstPublishedYear, BOOK_LIMITS.yearMin, BOOK_LIMITS.yearMax);
  set('firstPublishedYear', yearError(first.error));
  const edition = parseOptionalInt(values.editionYear, BOOK_LIMITS.yearMin, BOOK_LIMITS.yearMax);
  set('editionYear', yearError(edition.error));

  const pages = parseOptionalInt(values.pageCount, BOOK_LIMITS.pagesMin, BOOK_LIMITS.pagesMax);
  if (pages.error === 'number') set('pageCount', { code: 'pagesNumber' });
  if (pages.error === 'range') set('pageCount', { code: 'pagesRange', min: BOOK_LIMITS.pagesMin, max: BOOK_LIMITS.pagesMax });

  const isbn = validateIsbn(values.isbn);
  if (isbn.error === 'chars') set('isbn', { code: 'isbnChars' });
  if (isbn.error === 'length') set('isbn', { code: 'isbnLength' });
  if (isbn.error === 'checksum') set('isbn', { code: 'isbnChecksum' });

  const category = values.category && isTopicKey(values.category) ? values.category : null;
  const topics = [...new Set(values.topics.filter((k) => isTopicKey(k)))];
  if (topics.length > BOOK_LIMITS.topics) set('topics', { code: 'topicsTooMany', max: BOOK_LIMITS.topics });

  const tags = parseTags(values.tags);
  if (tags.error === 'tooLong') set('tags', { code: 'tagTooLong', max: BOOK_LIMITS.tag });
  if (tags.error === 'tooMany') set('tags', { code: 'tagsTooMany', max: BOOK_LIMITS.tags });

  if (Object.keys(errors).length > 0 || !title) return { errors, parsed: null };
  return {
    errors,
    parsed: {
      title,
      subtitle,
      author,
      originalTitle,
      series,
      publisher,
      language: languageRaw === '' ? null : languageRaw,
      firstPublishedYear: first.value,
      editionYear: edition.value,
      isbn: isbn.value,
      pageCount: pages.value,
      category,
      topics,
      tags: tags.tags,
    },
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Only the fields that differ from the book (empty object when nothing changed). */
export function diffBookPatch(book: BookDTO, parsed: ParsedBookForm): BookPatch {
  const patch: BookPatch = {};
  if (parsed.title !== cleanText(book.title)) patch.title = parsed.title;
  const texts = ['subtitle', 'author', 'originalTitle', 'series', 'publisher'] as const;
  for (const key of texts) {
    if (parsed[key] !== cleanText(book[key])) patch[key] = parsed[key];
  }
  if (parsed.language !== (book.language ? book.language.toLowerCase() : null)) patch.language = parsed.language;
  if (parsed.firstPublishedYear !== book.firstPublishedYear) patch.firstPublishedYear = parsed.firstPublishedYear;
  if (parsed.editionYear !== book.editionYear) patch.editionYear = parsed.editionYear;
  if (parsed.isbn !== (book.isbn ? normalizeIsbn(book.isbn) : null)) patch.isbn = parsed.isbn;
  if (parsed.pageCount !== book.pageCount) patch.pageCount = parsed.pageCount;
  if (parsed.category !== (book.category ?? null)) patch.category = parsed.category;
  if (!sameSet(parsed.topics, book.topics ?? [])) patch.topics = parsed.topics;
  if (!sameList(parsed.tags, book.tags ?? [])) patch.tags = parsed.tags;
  return patch;
}

function sameFormValue(a: string | string[], b: string | string[]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return sameSet(a, b);
  return (cleanText(String(a)) ?? '') === (cleanText(String(b)) ?? '');
}

/** true when the form values differ from the book (unparseable input counts as a change). */
export function isFormDirty(book: BookDTO, values: BookFormValues): boolean {
  const initial = bookToFormValues(book);
  return (Object.keys(initial) as BookFormField[]).some((k) => !sameFormValue(initial[k], values[k]));
}

/**
 * The book changed on the server while its form is open (enrichment, another device, refresh):
 * fields the user has not touched follow the new values, edited fields keep the user's input.
 * Returns the same object when nothing changes.
 */
export function rebaseFormValues(previous: BookDTO, next: BookDTO, values: BookFormValues): BookFormValues {
  const before = bookToFormValues(previous);
  const after = bookToFormValues(next);
  let out: BookFormValues | null = null;
  for (const key of Object.keys(before) as BookFormField[]) {
    if (!sameFormValue(before[key], values[key]) || sameFormValue(before[key], after[key])) continue;
    out ??= { ...values };
    (out as unknown as Record<string, string | string[]>)[key] = after[key];
  }
  return out ?? values;
}

/* ------------------------------------------------------------------ */
/* Duplicates & merge candidates                                       */
/* ------------------------------------------------------------------ */

const ARTICLES = new Set(['a', 'az', 'the', 'an', 'der', 'die', 'das', 'le', 'la', 'les', 'il', 'el', 'lo', 'gli', 'i']);

/** Folded comparison key of a title: accents and punctuation removed, leading article dropped. */
export function titleKey(title: string | null | undefined): string {
  const folded = foldForSearch(title);
  const sp = folded.indexOf(' ');
  if (sp > 0 && ARTICLES.has(folded.slice(0, sp))) return folded.slice(sp + 1);
  return folded;
}

/**
 * true when the shorter title is a whole-word prefix of the longer one after folding – the same book
 * with and without its subtitle ("Seveneves" / "Seveneves: Hét Éva"). Very short titles never count.
 */
export function isTitlePrefix(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = titleKey(a);
  const kb = titleKey(b);
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (short === long || short.replace(/\s/g, '').length < 6) return false;
  return long.startsWith(`${short} `);
}

/** Similarity of two titles for suggestions: the pipeline's measure, raised for subtitle-only differences. */
function suggestionTitleScore(a: string | null | undefined, b: string | null | undefined): number {
  const sim = titleSimilarity(a ?? '', b ?? '');
  return isTitlePrefix(a, b) ? Math.max(sim, 0.8) : sim;
}

export interface DuplicateMatch {
  book: BookDTO;
  /** exact: same folded title (and compatible authors); similar: title similarity ≥ 0.85 or the same title with a subtitle */
  kind: 'exact' | 'similar';
  score: number;
}

/**
 * Books that look like the same work as `input` (live duplicate warning of the manual add dialog).
 * Same rule as the pipeline merge: title similarity ≥ 0.85, authors compatible (either missing or
 * matching family names), different volume numbers never match. Exact matches first.
 */
export function findDuplicates(
  books: readonly BookDTO[],
  input: { title: string | null | undefined; author?: string | null },
  opts: { excludeIds?: readonly string[]; limit?: number; threshold?: number } = {},
): DuplicateMatch[] {
  const key = titleKey(input.title);
  if (key.replace(/\s/g, '').length < 2) return [];
  const exclude = new Set(opts.excludeIds ?? []);
  const threshold = opts.threshold ?? 0.85;
  const author = cleanText(input.author ?? null);
  const out: DuplicateMatch[] = [];
  for (const book of books) {
    if (exclude.has(book.id)) continue;
    if (!authorsCompatible(author, book.author)) continue;
    const otherKey = titleKey(book.title);
    if (!otherKey) continue;
    if (otherKey === key || (book.originalTitle && titleKey(book.originalTitle) === key)) {
      out.push({ book, kind: 'exact', score: 1 });
      continue;
    }
    if (titleNumbersConflict(input.title, book.title)) continue;
    // very short titles only match exactly ("Ő" vs "Ók")
    if (Math.min(key.length, otherKey.length) < 4) continue;
    const score = suggestionTitleScore(input.title, book.title);
    if (score >= threshold || isTitlePrefix(input.title, book.title)) out.push({ book, kind: 'similar', score });
  }
  out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'exact' ? -1 : 1) || b.score - a.score || a.book.shelfPosition - b.book.shelfPosition);
  return out.slice(0, opts.limit ?? 3);
}

/**
 * Books a review item could be "the same as". With a query: accent-insensitive search ranked by
 * similarity to the target. Without: likely duplicates (similar title with compatible authors, or
 * same author right next to it on the shelf).
 */
export function mergeCandidates(books: readonly BookDTO[], target: BookDTO, query: string, limit = 8): BookDTO[] {
  const q = query.trim();
  const scored: { book: BookDTO; score: number }[] = [];
  for (const book of books) {
    if (book.id === target.id) continue;
    const titleSim = suggestionTitleScore(target.title, book.title);
    const compatible = authorsCompatible(target.author, book.author);
    const bothAuthors = Boolean(target.author && book.author);
    const distance = Math.abs(book.shelfPosition - target.shelfPosition);
    const proximity = distance <= 3 ? 0.08 : distance <= 12 ? 0.04 : 0;
    const score = titleSim * (compatible ? 1 : 0.55) + (compatible && bothAuthors ? 0.12 : 0) + proximity;
    if (q) {
      if (bookMatchesQuery(book, q)) scored.push({ book, score });
    } else if ((titleSim >= 0.6 && compatible) || (compatible && bothAuthors && distance <= 2 && titleSim >= 0.35)) {
      scored.push({ book, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.book.shelfPosition - b.book.shelfPosition);
  return scored.slice(0, limit).map((s) => s.book);
}

/* ------------------------------------------------------------------ */
/* Merge preview (mirrors mergeBooks in src/lib/collections/service.ts) */
/* ------------------------------------------------------------------ */

/** true when the owner has put personal data on the book (kept only on the surviving entry of a merge). */
export function hasOwnerData(book: BookDTO): boolean {
  return Boolean(
    book.rating ||
      book.favorite ||
      book.readingStatus !== 'unknown' ||
      book.notes?.trim() ||
      book.lentTo?.trim() ||
      book.lentAt ||
      (book.tags?.length ?? 0) > 0,
  );
}

/**
 * Which entry to keep by default: the one carrying the owner's data, then an already reviewed or
 * manual one, then one with a spine photo / cover, then the most confident.
 */
export function pickDefaultKeep(books: readonly BookDTO[]): BookDTO | null {
  if (books.length === 0) return null;
  const score = (b: BookDTO) =>
    (hasOwnerData(b) ? 8 : 0) +
    (!isPendingReview(b) ? 4 : 0) +
    (b.source === 'manual' ? 1 : 0) +
    (b.spineImage ? 1 : 0) +
    (b.coverImage ? 0.5 : 0) +
    b.confidence;
  return [...books].sort((a, b) => score(b) - score(a) || a.shelfPosition - b.shelfPosition)[0];
}

export const MERGE_FILL_FIELDS = [
  'author',
  'subtitle',
  'originalTitle',
  'series',
  'publisher',
  'language',
  'firstPublishedYear',
  'editionYear',
  'isbn',
  'pageCount',
  'category',
] as const;
export type MergeFillField = (typeof MERGE_FILL_FIELDS)[number];

export interface MergePreview {
  keep: BookDTO;
  others: BookDTO[];
  detectionCount: number;
  confidence: number;
  topics: string[];
  tags: string[];
  /** empty fields of the kept book filled from another entry */
  filled: { field: MergeFillField; value: string | number; from: BookDTO }[];
  /** the book whose spine photo / frame evidence ends up on the result */
  evidenceFrom: BookDTO | null;
  coverFrom: BookDTO | null;
  /** removed entries that carry owner data (rating, notes …) which will be lost */
  lostOwnerData: BookDTO[];
}

function union(...lists: (readonly string[] | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const list of lists) for (const v of list ?? []) if (!out.includes(v)) out.push(v);
  return out;
}

export function previewMerge(keep: BookDTO, others: readonly BookDTO[]): MergePreview {
  const rest = others.filter((b) => b.id !== keep.id).sort((a, b) => b.confidence - a.confidence);
  const all = [keep, ...rest];
  const byConfidence = [...all].sort((a, b) => b.confidence - a.confidence || (a.id === keep.id ? -1 : b.id === keep.id ? 1 : 0));
  const evidenceFrom = byConfidence.find((b) => b.spineImage) ?? byConfidence.find((b) => b.bestBbox) ?? null;
  const filled: MergePreview['filled'] = [];
  for (const field of MERGE_FILL_FIELDS) {
    if (keep[field] !== null && keep[field] !== undefined && keep[field] !== '') continue;
    const donor = rest.find((b) => b[field] !== null && b[field] !== undefined && b[field] !== '');
    if (donor) filled.push({ field, value: donor[field] as string | number, from: donor });
  }
  return {
    keep,
    others: rest,
    detectionCount: all.reduce((s, b) => s + (b.detectionCount ?? 0), 0),
    confidence: Math.max(...all.map((b) => b.confidence)),
    topics: union(keep.topics, ...rest.map((b) => b.topics)),
    tags: union(keep.tags, ...rest.map((b) => b.tags)),
    filled,
    evidenceFrom,
    coverFrom: keep.coverImage ? keep : (rest.find((b) => b.coverImage) ?? null),
    lostOwnerData: rest.filter(hasOwnerData),
  };
}

/* ------------------------------------------------------------------ */
/* Evidence frames                                                     */
/* ------------------------------------------------------------------ */

export interface FramesPayload {
  frames: FrameDTO[];
  detections: { frameId: string; bookId: string | null; bbox: BBox | null }[];
}

/** Percent rectangle (0–100) of a pixel bbox inside a frame of width × height; null when unusable. */
export function bboxToPercentRect(
  bbox: BBox | null | undefined,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } | null {
  if (!bbox || !(width > 0) || !(height > 0)) return null;
  const vals = [bbox.x0, bbox.y0, bbox.x1, bbox.y1];
  if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const clampX = (v: number) => Math.min(width, Math.max(0, v));
  const clampY = (v: number) => Math.min(height, Math.max(0, v));
  const x0 = clampX(Math.min(bbox.x0, bbox.x1));
  const x1 = clampX(Math.max(bbox.x0, bbox.x1));
  const y0 = clampY(Math.min(bbox.y0, bbox.y1));
  const y1 = clampY(Math.max(bbox.y0, bbox.y1));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { left: r((x0 / width) * 100), top: r((y0 / height) * 100), width: r(((x1 - x0) / width) * 100), height: r(((y1 - y0) / height) * 100) };
}

/**
 * The frame that shows the book best: its `bestFrameId` (with `bestBbox`), otherwise the frame of
 * its largest detection box (e.g. after a merge moved the evidence). null when there is none.
 */
export function findEvidenceFrame(
  book: Pick<BookDTO, 'id' | 'bestFrameId' | 'bestBbox'>,
  data: FramesPayload | null | undefined,
  frameIndex?: ReadonlyMap<string, FrameDTO>,
): { frame: FrameDTO; bbox: BBox | null } | null {
  if (!data) return null;
  const byId = frameIndex ?? new Map(data.frames.map((f) => [f.id, f]));
  if (book.bestFrameId) {
    const frame = byId.get(book.bestFrameId);
    if (frame) {
      const own = book.bestBbox ?? data.detections.find((d) => d.frameId === frame.id && d.bookId === book.id && d.bbox)?.bbox ?? null;
      return { frame, bbox: own };
    }
  }
  let best: { frame: FrameDTO; bbox: BBox; area: number } | null = null;
  for (const d of data.detections) {
    if (d.bookId !== book.id || !d.bbox) continue;
    const frame = byId.get(d.frameId);
    if (!frame) continue;
    const area = Math.abs((d.bbox.x1 - d.bbox.x0) * (d.bbox.y1 - d.bbox.y0));
    if (!best || area > best.area) best = { frame, bbox: d.bbox, area };
  }
  return best ? { frame: best.frame, bbox: best.bbox } : null;
}

/* ------------------------------------------------------------------ */
/* Readable spine strip                                                */
/* ------------------------------------------------------------------ */

/** Clockwise rotation applied to an upright spine crop so its lettering reads left to right. */
export type SpineTurn = 0 | 90 | 270;

/** A crop of a standing book (clearly taller than wide) – only those are turned into a horizontal strip. */
export function isUprightCrop(width: number, height: number): boolean {
  return width > 0 && height > width * 1.2;
}

/**
 * Which way the spine lettering probably runs: English-language editions print top-to-bottom (turn the
 * photo 270°, i.e. counter-clockwise), continental European ones – Hungarian included – bottom-to-top
 * (turn 90° clockwise). The user can flip it when the guess is wrong.
 */
export function defaultSpineTurn(book: Pick<BookDTO, 'language'>): Exclude<SpineTurn, 0> {
  return book.language?.toLowerCase() === 'en' ? 270 : 90;
}

/* ------------------------------------------------------------------ */
/* Drawer & review navigation                                          */
/* ------------------------------------------------------------------ */

/** Description in the UI locale, falling back to the other locale. */
export function localizedDescription(
  book: Pick<BookDTO, 'descriptionHu' | 'descriptionEn'>,
  locale: Locale,
): { text: string; lang: Locale; isFallback: boolean } | null {
  const hu = book.descriptionHu?.trim();
  const en = book.descriptionEn?.trim();
  const own = locale === 'hu' ? hu : en;
  if (own) return { text: own, lang: locale, isFallback: false };
  const other = locale === 'hu' ? en : hu;
  if (other) return { text: other, lang: locale === 'hu' ? 'en' : 'hu', isFallback: true };
  return null;
}

/** prev / next ids around `id` in `list` (no wrap-around); index is 0-based, -1 when absent. */
export function neighbourIds(list: readonly { id: string }[], id: string | null): { prev: string | null; next: string | null; index: number; total: number } {
  const index = id ? list.findIndex((b) => b.id === id) : -1;
  return {
    prev: index > 0 ? list[index - 1].id : null,
    next: index >= 0 && index < list.length - 1 ? list[index + 1].id : null,
    index,
    total: list.length,
  };
}

/** Books waiting for review, in shelf order. */
export function reviewQueue(books: readonly BookDTO[]): BookDTO[] {
  return books
    .filter(isPendingReview)
    .sort((a, b) => a.shelfPosition - b.shelfPosition || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
}

/** The item to show after `id` leaves the queue: the following one, else the previous one, else null. */
export function nextAfterRemoval(queue: readonly { id: string }[], id: string): string | null {
  const index = queue.findIndex((b) => b.id === id);
  if (index < 0) return queue[0]?.id ?? null;
  return queue[index + 1]?.id ?? queue[index - 1]?.id ?? null;
}

/** Local calendar date as YYYY-MM-DD (for lentAt). */
export function todayIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 75.4 → "1:15", 3725 → "1:02:05". */
export function formatTimecode(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** true when the keyboard event target is a text field or a widget that owns arrow / Enter keys. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as { closest?: unknown }).closest !== 'function') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(el.closest('[role="radiogroup"],[role="tablist"],[role="menu"],[role="listbox"],[role="slider"],[role="grid"],[contenteditable="true"]'));
}
