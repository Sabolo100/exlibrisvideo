/**
 * Cover lookup (SPEC §4.6.2): Open Library search, then Google Books; strict acceptance
 * (normalised title similarity ≥ 0.8 AND compatible authors), plus a safe downloader that re-encodes
 * the image to a small JPEG under STORAGE_DIR.
 *
 * - every outgoing request (search + image) goes through ONE global limiter (≤ 3 requests / s) and has
 *   an 8 s timeout; Open Library 429/5xx is retried once; a Google Books quota error pauses Google;
 * - search responses are cached in-process for an hour (identical copies, re-runs);
 * - image downloads: https only, known cover hosts only (redirects re-checked), `image/*`, ≤ 2 MB,
 *   decoded and re-encoded with sharp (JPEG, at most 600 px tall) – the original bytes are never stored.
 *
 * Owner: merge-enrich.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { env } from '@/lib/env';
import { ensureDirFor } from '@/lib/storage';
import {
  LEADING_ARTICLES,
  authorsCompatible,
  familyName,
  foldForCompare,
  normalizeTitle,
  titleNumbersConflict,
  titleSimilarity,
} from './text';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export type CoverSource = 'openlibrary' | 'google';

export interface CoverQuery {
  author: string | null;
  title: string;
  isbn?: string | null;
  /** original-language title (from classification): last-resort lookup of the same work */
  originalTitle?: string | null;
  /** ISO 639-1 language of this edition ("hu"): editions in other languages never lend their cover / ISBN */
  language?: string | null;
  /** ISO 639-1 language the work was written in */
  originalLanguage?: string | null;
}

export interface CoverMatch {
  /** https URL of the cover image */
  url: string;
  source: CoverSource;
  /** ISBN of the matched edition (only when the edition itself matched) */
  isbn?: string;
  pageCount?: number;
  /** first publication year of the work (Open Library works only) */
  firstPublishYear?: number;
  /** Open Library work key, e.g. "/works/OL1674588W" */
  openLibraryKey?: string;
  /** Open Library edition key, e.g. "/books/OL1470253M" */
  openLibraryEditionKey?: string;
  googleVolumeId?: string;
  /** title / authors of the accepted record (evidence) */
  matchedTitle: string;
  matchedAuthors: string[];
  /** normalised title similarity of the accepted record (0..1) */
  titleScore: number;
  /** ISO 639 code(s) reported by the source */
  language?: string;
  /** which lookup found it */
  via: 'isbn' | 'title_author' | 'title' | 'original_title';
}

export interface DownloadedCover {
  /** relative storage path (forward slashes) */
  path: string;
  width: number;
  height: number;
  bytes: number;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const COVER_USER_AGENT = 'ExLibrisVideo/1.0 (+https://www.exlibrisvideo.hu)';
/** strict acceptance threshold on normalised titles */
export const COVER_TITLE_THRESHOLD = 0.8;
/** without any author to check, the title alone must be this close (and long enough) */
const AUTHORLESS_TITLE_THRESHOLD = 0.92;
const AUTHORLESS_MIN_LETTERS = 10;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_REQUESTS_PER_SECOND = 3;
const MAX_COVER_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const COVER_MAX_HEIGHT = 600;
const COVER_MAX_WIDTH = 1200;
/** smaller images are placeholders ("no cover" pixels, 1×1 GIFs) */
const COVER_MIN_EDGE = 50;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const GOOGLE_QUOTA_PAUSE_MS = 60 * 60 * 1000;
const GOOGLE_ERROR_PAUSE_MS = 5 * 60 * 1000;

const OL_SEARCH_FIELDS = [
  'key',
  'title',
  'subtitle',
  'author_name',
  'first_publish_year',
  'cover_i',
  'number_of_pages_median',
  'language',
  'editions',
  'editions.key',
  'editions.title',
  'editions.subtitle',
  'editions.cover_i',
  'editions.language',
  'editions.isbn',
].join(',');

const GOOGLE_FIELDS = 'items(id,volumeInfo(title,subtitle,authors,publishedDate,industryIdentifiers,pageCount,imageLinks,language))';

/** hosts a cover image (or one of its redirects) may come from */
const ALLOWED_IMAGE_HOSTS = ['openlibrary.org', 'archive.org', 'books.google.com', 'googleusercontent.com', 'googleapis.com'];

/* ------------------------------------------------------------------ */
/* Global limiter, cache, Google pause                                 */
/* ------------------------------------------------------------------ */

let minIntervalMs = Math.ceil(1000 / MAX_REQUESTS_PER_SECOND);
let nextSlotAt = 0;
let googlePausedUntil = 0;
const searchCache = new Map<string, { at: number; value: unknown }>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let limiterChain: Promise<void> = Promise.resolve();

/**
 * Waits for the next slot of the global limiter: callers are served in order and consecutive request
 * starts are at least 1000/3 ms apart (measured on the actual start times, so timer jitter can never
 * squeeze two requests closer together).
 */
function throttle(): Promise<void> {
  const turn = limiterChain.then(async () => {
    for (;;) {
      const wait = nextSlotAt - Date.now();
      if (wait <= 0) break;
      await sleep(wait);
    }
    nextSlotAt = Date.now() + minIntervalMs;
  });
  limiterChain = turn.catch(() => {});
  return turn;
}

/** Test hooks: reset module state, change the limiter spacing. Not used by application code. */
export const coverClientInternals = {
  reset(): void {
    nextSlotAt = 0;
    googlePausedUntil = 0;
    searchCache.clear();
    minIntervalMs = Math.ceil(1000 / MAX_REQUESTS_PER_SECOND);
  },
  setMinIntervalMs(ms: number): void {
    minIntervalMs = Math.max(0, ms);
  },
  googlePaused(): boolean {
    return Date.now() < googlePausedUntil;
  },
};

function cacheGet(url: string): unknown | undefined {
  const hit = searchCache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    searchCache.delete(url);
    return undefined;
  }
  // LRU: re-insert as most recent
  searchCache.delete(url);
  searchCache.set(url, hit);
  return hit.value;
}

function cacheSet(url: string, value: unknown): void {
  searchCache.set(url, { at: Date.now(), value });
  while (searchCache.size > CACHE_MAX_ENTRIES) {
    const oldest = searchCache.keys().next().value;
    if (oldest === undefined) break;
    searchCache.delete(oldest);
  }
}

function describeErr(e: unknown): string {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

/** Removes secrets (API key) from a URL before it is logged. */
function redactUrl(url: string): string {
  return url.replace(/([?&]key=)[^&]+/g, '$1***');
}

function timeoutSignal(external?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return external ? AbortSignal.any([t, external]) : t;
}

class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
    readonly body: string,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusError';
  }
}

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get('retry-after');
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(h);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/** Reads a response body with a hard byte cap (rejects when exceeded). */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`response too large (${declared} bytes)`);
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`response too large (> ${maxBytes} bytes)`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/** Throttled JSON GET; retries once on 429 / 5xx / network errors (Open Library) when `retry` is set. */
async function getJson(url: string, opts: { retry: boolean; signal?: AbortSignal }): Promise<unknown> {
  const cached = cacheGet(url);
  if (cached !== undefined) return cached;
  let attempt = 0;
  for (;;) {
    attempt++;
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': COVER_USER_AGENT, Accept: 'application/json' },
        redirect: 'follow',
        signal: timeoutSignal(opts.signal),
      });
      if (!res.ok) {
        const body = (await readCapped(res, 64 * 1024).catch(() => Buffer.alloc(0))).toString('utf8');
        throw new HttpStatusError(res.status, retryAfterMs(res), body.slice(0, 500));
      }
      const text = (await readCapped(res, MAX_JSON_BYTES)).toString('utf8');
      const json: unknown = JSON.parse(text);
      cacheSet(url, json);
      return json;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      const transient =
        e instanceof HttpStatusError ? e.status === 429 || e.status >= 500 : !(e instanceof SyntaxError);
      if (!opts.retry || attempt >= 2 || !transient) throw e;
      const wait = e instanceof HttpStatusError && e.retryAfterMs !== null ? Math.min(10_000, e.retryAfterMs) : 2000;
      await sleep(wait);
    }
  }
}

/* ------------------------------------------------------------------ */
/* ISBN helpers                                                        */
/* ------------------------------------------------------------------ */

/** Cleans an ISBN-10/13 (hyphens, spaces, "ISBN" prefix) and validates its checksum; null when invalid. */
export function normalizeIsbn(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/^ISBN(?:-1[03])?:?/, '').replace(/[\s-]/g, '');
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
    return sum % 11 === 0 ? s : null;
  }
  if (/^\d{13}$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
    return sum % 10 === 0 && (s.startsWith('978') || s.startsWith('979')) ? s : null;
  }
  return null;
}

/** Both forms of a valid ISBN (13 first; 10 only for 978-prefixed numbers). */
export function isbnVariants(isbn: string): string[] {
  const n = normalizeIsbn(isbn);
  if (!n) return [];
  if (n.length === 10) {
    const body = `978${n.slice(0, 9)}`;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
    return [`${body}${(10 - (sum % 10)) % 10}`, n];
  }
  if (n.startsWith('978')) {
    const body = n.slice(3, 12);
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(body[i]) * (10 - i);
    const check = (11 - (sum % 11)) % 11;
    return [n, `${body}${check === 10 ? 'X' : String(check)}`];
  }
  return [n];
}

function pickIsbn(list: unknown): string | undefined {
  if (!Array.isArray(list)) return undefined;
  const valid = list.map((v) => (typeof v === 'string' ? normalizeIsbn(v) : null)).filter((v): v is string => !!v);
  return valid.find((v) => v.length === 13) ?? valid[0];
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : []);
const posInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;

/** Comparable forms of a record title: full, "title: subtitle", main title before ":" / " - " / " = ", without brackets. */
function titleVariants(title: string | null, subtitle: string | null): string[] {
  if (!title) return [];
  const out = new Set<string>([title]);
  if (subtitle) out.add(`${title}: ${subtitle}`);
  const noBrackets = title.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').trim();
  if (noBrackets) out.add(noBrackets);
  for (const sep of [':', ' / ', ' = ', ' - ', ' – ', ' — ', '. ']) {
    const i = title.indexOf(sep);
    if (i > 0) {
      const main = title.slice(0, i).trim();
      if (normalizeTitle(main).replace(/\s/g, '').length >= 3) out.add(main);
    }
  }
  return [...out];
}

function bestTitleScore(queryTitle: string, variants: string[]): { score: number; variant: string | null } {
  let best = 0;
  let variant: string | null = null;
  for (const v of variants) {
    if (titleNumbersConflict(queryTitle, v)) continue;
    const s = titleSimilarity(queryTitle, v);
    if (s > best) {
      best = s;
      variant = v;
    }
  }
  return { score: best, variant };
}

/** ISO 639-1 → MARC / ISO 639-2 bibliographic codes used by Open Library */
const MARC_LANGUAGE: Record<string, string> = {
  hu: 'hun', en: 'eng', de: 'ger', fr: 'fre', it: 'ita', es: 'spa', pt: 'por', ru: 'rus', pl: 'pol', cs: 'cze',
  sk: 'slo', ro: 'rum', nl: 'dut', sv: 'swe', da: 'dan', no: 'nor', nb: 'nor', fi: 'fin', et: 'est', lv: 'lav',
  lt: 'lit', el: 'gre', tr: 'tur', he: 'heb', ar: 'ara', fa: 'per', hi: 'hin', ja: 'jpn', zh: 'chi', ko: 'kor',
  la: 'lat', hr: 'hrv', sr: 'srp', sl: 'slv', bg: 'bul', uk: 'ukr', be: 'bel', ca: 'cat', eo: 'epo', ga: 'gle',
  is: 'ice', sq: 'alb', mk: 'mac', grc: 'grc', yi: 'yid',
};

/** Normalised set of acceptable language codes (both 2- and 3-letter forms); empty = unknown. */
export function languageSet(...codes: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const raw of codes) {
    const c = raw?.trim().toLowerCase().split(/[-_]/)[0];
    if (!c) continue;
    out.add(c);
    const marc = MARC_LANGUAGE[c];
    if (marc) out.add(marc);
    for (const [two, three] of Object.entries(MARC_LANGUAGE)) if (three === c) out.add(two);
  }
  return out;
}

/** two-letter ISO 639-1 code or null */
function iso639_1(code: string | null | undefined): string | null {
  const c = code?.trim().toLowerCase().split(/[-_]/)[0];
  if (!c) return null;
  if (/^[a-z]{2}$/.test(c)) return c;
  for (const [two, three] of Object.entries(MARC_LANGUAGE)) if (three === c) return two;
  return null;
}

function languagesIntersect(recordLanguages: string[], accepted: Set<string>): boolean {
  return recordLanguages.some((l) => accepted.has(l.trim().toLowerCase()));
}

interface Acceptance {
  title: string;
  author: string | null;
  /** looser title rule for exact identifier matches (ISBN) */
  identifierMatch?: boolean;
  /** languages whose editions may lend their cover (book + original language); empty = unknown */
  languages: Set<string>;
  /** language codes of this very edition (an ISBN is only taken from a record in this language) */
  bookLanguages: Set<string>;
}

function titleAccepted(score: number, a: Acceptance): boolean {
  if (a.identifierMatch) return score >= 0.5;
  if (!a.author) {
    const letters = normalizeTitle(a.title).replace(/\s/g, '').length;
    return score >= AUTHORLESS_TITLE_THRESHOLD && letters >= AUTHORLESS_MIN_LETTERS;
  }
  return score >= COVER_TITLE_THRESHOLD;
}

function authorAccepted(queryAuthor: string | null, recordAuthors: string[]): boolean {
  if (!queryAuthor) return true;
  // a record without authors cannot confirm the author of a book whose author is known
  if (!recordAuthors.length) return false;
  return authorsCompatible(queryAuthor, recordAuthors.join('; '));
}

interface Scored {
  match: CoverMatch;
  score: number;
}

function olCoverUrl(id: number): string {
  return `https://covers.openlibrary.org/b/id/${id}-L.jpg`;
}

/**
 * May a record in `recordLanguages` lend its cover? Exact identifier matches always may; otherwise
 * the record must be in the book's or the original language (records without a language only when the
 * book's languages are unknown too).
 */
function coverLanguageOk(recordLanguages: string[], a: Acceptance): boolean {
  if (a.identifierMatch || a.languages.size === 0) return true;
  return languagesIntersect(recordLanguages, a.languages);
}

/** An ISBN identifies an edition: only taken from a title match in this book's own language. */
function isbnAllowed(recordLanguages: string[], a: Acceptance, via: CoverMatch['via']): boolean {
  if (via === 'isbn') return true;
  if (via === 'original_title') return false;
  return a.bookLanguages.size > 0 && languagesIntersect(recordLanguages, a.bookLanguages);
}

/** Evaluates Open Library search docs; returns the best accepted record that has a usable cover. */
export function evaluateOpenLibraryDocs(docs: unknown, a: Acceptance, via: CoverMatch['via']): CoverMatch | null {
  if (!Array.isArray(docs)) return null;
  const scored: Scored[] = [];
  docs.forEach((raw, rank) => {
    if (!raw || typeof raw !== 'object') return;
    const d = raw as Record<string, unknown>;
    const workTitle = str(d.title);
    const authors = strList(d.author_name);
    if (!authorAccepted(a.author, authors)) return;
    const editionsObj = d.editions && typeof d.editions === 'object' ? (d.editions as Record<string, unknown>) : null;
    const editions = Array.isArray(editionsObj?.docs) ? (editionsObj!.docs as unknown[]) : [];
    const workCover = posInt(d.cover_i);
    const base = {
      source: 'openlibrary' as const,
      pageCount: posInt(d.number_of_pages_median),
      firstPublishYear: posInt(d.first_publish_year),
      openLibraryKey: str(d.key) ?? undefined,
      matchedAuthors: authors,
      via,
    };
    let best: Scored | null = null;
    const consider = (candidate: Scored) => {
      if (!best || candidate.score > best.score) best = candidate;
    };

    // edition-level matches (translations are indexed as editions of the original work)
    for (const rawEd of editions) {
      if (!rawEd || typeof rawEd !== 'object') continue;
      const e = rawEd as Record<string, unknown>;
      const { score } = bestTitleScore(a.title, titleVariants(str(e.title), str(e.subtitle)));
      if (!titleAccepted(score, a)) continue;
      const langs = strList(e.language);
      const editionCover = posInt(e.cover_i);
      const rounded = Math.round(score * 1000) / 1000;
      if (editionCover && coverLanguageOk(langs, a)) {
        const own = languagesIntersect(langs, a.bookLanguages);
        consider({
          score: score + 0.05 + (own ? 0.03 : 0) - rank * 0.001,
          match: {
            ...base,
            url: olCoverUrl(editionCover),
            isbn: isbnAllowed(langs, a, via) ? pickIsbn(e.isbn) : undefined,
            openLibraryEditionKey: str(e.key) ?? undefined,
            matchedTitle: str(e.title) ?? workTitle ?? a.title,
            titleScore: rounded,
            language: langs.join(',') || undefined,
          },
        });
      } else if (workCover) {
        // the edition matched but cannot lend a cover: the work's representative cover
        consider({
          score: score - 0.01 - rank * 0.001,
          match: {
            ...base,
            url: olCoverUrl(workCover),
            openLibraryEditionKey: str(e.key) ?? undefined,
            matchedTitle: str(e.title) ?? workTitle ?? a.title,
            titleScore: rounded,
            language: langs.join(',') || undefined,
          },
        });
      }
    }
    // work-level match
    const { score: workScore } = bestTitleScore(a.title, titleVariants(workTitle, str(d.subtitle)));
    if (workCover && titleAccepted(workScore, a)) {
      const workLangs = strList(d.language);
      consider({
        // stray translation-only work records (no language, or other languages) lose ties to the main work
        score: workScore + (languagesIntersect(workLangs, a.bookLanguages) ? 0.03 : 0) - (workLangs.length ? 0 : 0.02) - rank * 0.001,
        match: {
          ...base,
          url: olCoverUrl(workCover),
          matchedTitle: workTitle ?? a.title,
          titleScore: Math.round(workScore * 1000) / 1000,
          language: workLangs.join(',') || undefined,
        },
      });
    }
    if (best) scored.push(best);
  });
  scored.sort((x, y) => y.score - x.score);
  return scored[0]?.match ?? null;
}

/** Evaluates Google Books volumes; returns the best accepted volume that has a thumbnail. */
export function evaluateGoogleItems(items: unknown, a: Acceptance, via: CoverMatch['via']): CoverMatch | null {
  if (!Array.isArray(items)) return null;
  const scored: Scored[] = [];
  items.forEach((raw, rank) => {
    if (!raw || typeof raw !== 'object') return;
    const item = raw as Record<string, unknown>;
    const info = item.volumeInfo && typeof item.volumeInfo === 'object' ? (item.volumeInfo as Record<string, unknown>) : null;
    if (!info) return;
    const title = str(info.title);
    const authors = strList(info.authors);
    if (!authorAccepted(a.author, authors)) return;
    const { score } = bestTitleScore(a.title, titleVariants(title, str(info.subtitle)));
    if (!titleAccepted(score, a)) return;
    const langs = strList([info.language]);
    if (!coverLanguageOk(langs, a) && !(langs.length === 0 && via !== 'original_title')) return;
    const links = info.imageLinks && typeof info.imageLinks === 'object' ? (info.imageLinks as Record<string, unknown>) : {};
    const thumb = str(links.thumbnail) ?? str(links.smallThumbnail);
    const url = thumb ? googleImageUrl(thumb) : null;
    if (!url) return;
    const ids = Array.isArray(info.industryIdentifiers) ? (info.industryIdentifiers as unknown[]) : [];
    const isbnList = ids
      .map((x) => (x && typeof x === 'object' ? str((x as Record<string, unknown>).identifier) : null))
      .filter((x): x is string => !!x);
    const own = languagesIntersect(langs, a.bookLanguages);
    scored.push({
      score: score + (own ? 0.03 : 0) - rank * 0.001,
      match: {
        url,
        source: 'google',
        isbn: isbnAllowed(langs, a, via) ? pickIsbn(isbnList) : undefined,
        pageCount: posInt(info.pageCount),
        googleVolumeId: str(item.id) ?? undefined,
        matchedTitle: title ?? a.title,
        matchedAuthors: authors,
        titleScore: Math.round(score * 1000) / 1000,
        language: langs.join(',') || undefined,
        via,
      },
    });
  });
  scored.sort((x, y) => y.score - x.score);
  return scored[0]?.match ?? null;
}


/** Google thumbnail → https, no page-curl effect; null when the URL is not a Google image URL. */
function googleImageUrl(raw: string): string | null {
  try {
    const u = new URL(raw.replace(/^http:\/\//i, 'https://'));
    if (u.protocol !== 'https:' || !hostAllowed(u.hostname)) return null;
    u.searchParams.delete('edge');
    return u.toString();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

interface SearchResult {
  /** number of records returned (0 = "returned nothing") */
  count: number;
  match: CoverMatch | null;
}

/** Search text for APIs: drop brackets / trailing punctuation that confuse the search engines. */
function searchText(s: string): string {
  return s
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ')
    .replace(/["„”“«»]/g, ' ')
    .replace(/[!?.…:;,]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function openLibrarySearch(
  params: Record<string, string>,
  a: Acceptance,
  via: CoverMatch['via'],
  limit: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const qs = new URLSearchParams({ ...params, limit: String(limit), fields: OL_SEARCH_FIELDS });
  const url = `https://openlibrary.org/search.json?${qs.toString()}`;
  try {
    const json = (await getJson(url, { retry: true, signal })) as Record<string, unknown> | null;
    const docs = json && Array.isArray(json.docs) ? json.docs : [];
    return { count: docs.length, match: evaluateOpenLibraryDocs(docs, a, via) };
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn('[covers] open library search failed', { url: redactUrl(url), error: describeErr(e) });
    return { count: 0, match: null };
  }
}

function googleQuoted(s: string): string {
  const clean = searchText(s).replace(/"/g, ' ').trim();
  return clean.includes(' ') ? `"${clean}"` : clean;
}

async function googleSearch(
  q: string,
  a: Acceptance,
  via: CoverMatch['via'],
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  if (Date.now() < googlePausedUntil) return { count: 0, match: null };
  const qs = new URLSearchParams({ q, maxResults: String(maxResults), printType: 'books', fields: GOOGLE_FIELDS });
  const key = env().GOOGLE_BOOKS_API_KEY;
  if (key) qs.set('key', key);
  const url = `https://www.googleapis.com/books/v1/volumes?${qs.toString()}`;
  try {
    const json = (await getJson(url, { retry: false, signal })) as Record<string, unknown> | null;
    const items = json && Array.isArray(json.items) ? json.items : [];
    return { count: items.length, match: evaluateGoogleItems(items, a, via) };
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof HttpStatusError && (e.status === 429 || e.status === 403)) {
      const quota = /quota|rateLimitExceeded|RESOURCE_EXHAUSTED|dailyLimit/i.test(e.body);
      const wasPaused = Date.now() < googlePausedUntil;
      googlePausedUntil = Date.now() + (quota ? GOOGLE_QUOTA_PAUSE_MS : GOOGLE_ERROR_PAUSE_MS);
      // concurrent lookups can all hit the limit before the first answer arrives: log only once
      if (!wasPaused) console.warn('[covers] google books paused', {
        status: e.status,
        minutes: Math.round((googlePausedUntil - Date.now()) / 60000),
        hasKey: !!key,
      });
    } else {
      console.warn('[covers] google books search failed', { url: redactUrl(url), error: describeErr(e) });
    }
    return { count: 0, match: null };
  }
}

/* ------------------------------------------------------------------ */
/* findCover                                                           */
/* ------------------------------------------------------------------ */

/**
 * Finds a cover for a book. Order: ISBN (when known) → Open Library title+author → Google Books
 * title+author → (only when both returned no records) title-only on both, still requiring a compatible
 * author → original title + author. Accepts a record only when the normalised title similarity is
 * ≥ 0.8 and the authors are compatible; returns null when nothing trustworthy was found.
 */
export async function findCover(query: CoverQuery, opts: { signal?: AbortSignal } = {}): Promise<CoverMatch | null> {
  const title = searchText(query.title ?? '');
  if (normalizeTitle(title).replace(/\s/g, '').length < 2) return null;
  const author = query.author && foldForCompare(query.author) ? query.author.trim() : null;
  const family = author ? familyName(author) : null;
  const signal = opts.signal;
  const languages = languageSet(query.language, query.originalLanguage);
  const bookLanguages = languageSet(query.language);
  // Open Library picks the edition it returns by the preferred language (it does not filter)
  const lang = iso639_1(query.language);
  const originalLang = iso639_1(query.originalLanguage) ?? lang;
  const withLang = (params: Record<string, string>, l: string | null) => (l ? { ...params, lang: l } : params);

  // 1. exact identifier
  const isbns = query.isbn ? isbnVariants(query.isbn) : [];
  if (isbns.length) {
    const a: Acceptance = { title, author, identifierMatch: true, languages, bookLanguages };
    const ol = await openLibrarySearch({ q: `isbn:(${isbns.join(' OR ')})` }, a, 'isbn', 3, signal);
    if (ol.match) return ol.match;
    const g = await googleSearch(`isbn:${isbns[0]}`, a, 'isbn', 3, signal);
    if (g.match) return g.match;
  }

  const a: Acceptance = { title, author, languages, bookLanguages };
  // the catalogue title searches are strict: "The Lusitania" finds nothing where "Lusitania" does
  const qTitle = withoutArticle(title);
  if (author && family) {
    // 2. title + author
    // 10 records: translations, box sets and stray records often outrank the edition we are after
    const ol = await openLibrarySearch(withLang({ title: qTitle, author: family }, lang), a, 'title_author', 10, signal);
    if (ol.match) return ol.match;
    const g = await googleSearch(`intitle:${googleQuoted(qTitle)} inauthor:${googleQuoted(family)}`, a, 'title_author', 5, signal);
    if (g.match) return g.match;
    // 3. title only when the author queries returned nothing (the author spelling may differ in the catalogue)
    if (ol.count === 0 && g.count === 0) {
      const olT = await openLibrarySearch(withLang({ title: qTitle }, lang), a, 'title', 10, signal);
      if (olT.match) return olT.match;
      const gT = await googleSearch(`intitle:${googleQuoted(qTitle)}`, a, 'title', 10, signal);
      if (gT.match) return gT.match;
    }
    // 4. the original work (translations are often missing from the catalogues)
    const original = query.originalTitle ? searchText(query.originalTitle) : '';
    if (original && normalizeTitle(original) && normalizeTitle(original) !== normalizeTitle(title)) {
      const ao: Acceptance = { title: original, author, languages, bookLanguages };
      const qOriginal = withoutArticle(original);
      const olO = await openLibrarySearch(
        withLang({ title: qOriginal, author: family }, originalLang),
        ao,
        'original_title',
        10,
        signal,
      );
      if (olO.match) return olO.match;
      const gO = await googleSearch(
        `intitle:${googleQuoted(qOriginal)} inauthor:${googleQuoted(family)}`,
        ao,
        'original_title',
        5,
        signal,
      );
      if (gO.match) return gO.match;
    }
    return null;
  }

  // no author: title-only with the strict authorless rule
  const olT = await openLibrarySearch(withLang({ title: qTitle }, lang), a, 'title', 10, signal);
  if (olT.match) return olT.match;
  const gT = await googleSearch(`intitle:${googleQuoted(qTitle)}`, a, 'title', 10, signal);
  return gT.match;
}

/** Drops a leading article ("A", "Az", "The", "Der", …) from a search text when more words follow. */
function withoutArticle(s: string): string {
  const words = s.split(' ');
  if (words.length > 1 && LEADING_ARTICLES.has(foldForCompare(words[0]))) return words.slice(1).join(' ');
  return s;
}

/* ------------------------------------------------------------------ */
/* downloadCover                                                       */
/* ------------------------------------------------------------------ */

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return ALLOWED_IMAGE_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

function checkImageUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('invalid URL');
  }
  if (u.protocol !== 'https:') throw new Error(`refusing non-https URL (${u.protocol})`);
  if (u.username || u.password) throw new Error('refusing URL with credentials');
  if (!hostAllowed(u.hostname)) throw new Error(`host not allowed: ${u.hostname}`);
  return u;
}

/**
 * Downloads a cover image and stores it as JPEG (≤ 600 px tall) at `destRel` (relative to STORAGE_DIR).
 * Returns null (and logs) when the URL/host is not allowed, the response is not an image, larger than
 * 2 MB, a placeholder, undecodable, or the request fails.
 */
export async function downloadCover(
  url: string,
  destRel: string,
  opts: { signal?: AbortSignal } = {},
): Promise<DownloadedCover | null> {
  try {
    let current = checkImageUrl(url);
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await throttle();
      res = await fetch(current, {
        headers: { 'User-Agent': COVER_USER_AGENT, Accept: 'image/*' },
        redirect: 'manual',
        signal: timeoutSignal(opts.signal),
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!location) throw new Error(`redirect without location (${res.status})`);
        if (hop === MAX_REDIRECTS) throw new Error('too many redirects');
        current = checkImageUrl(new URL(location, current).toString());
        res = null;
        continue;
      }
      break;
    }
    if (!res) throw new Error('no response');
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!type.startsWith('image/')) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`not an image (content-type "${type || 'missing'}")`);
    }
    const input = await readCapped(res, MAX_COVER_BYTES);
    if (!input.length) throw new Error('empty image');

    const image = sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' });
    const meta = await image.metadata();
    const w = meta.autoOrient?.width ?? meta.width ?? 0;
    const h = meta.autoOrient?.height ?? meta.height ?? 0;
    if (w < COVER_MIN_EDGE || h < COVER_MIN_EDGE) throw new Error(`placeholder image (${w}×${h})`);

    const { data, info } = await image
      .rotate()
      .resize({ width: COVER_MAX_WIDTH, height: COVER_MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    const relPath = destRel.replace(/\\/g, '/').replace(/^\/+/, '');
    const full = await ensureDirFor(relPath);
    const tmp = `${full}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, full);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    return { path: relPath, width: info.width, height: info.height, bytes: data.length };
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    console.warn('[covers] download rejected', { url: redactUrl(url), error: describeErr(e) });
    return null;
  }
}
