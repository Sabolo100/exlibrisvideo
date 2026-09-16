/**
 * enrich_collection (SPEC §4.6): classifies the not-yet-enriched books of a collection with the text
 * provider (taxonomy topics, canonical author, original title, languages, country, year, short
 * descriptions) and looks up covers. Owner edits are protected PER FIELD
 * (`enrichment.userEditedFields`, see `ownerEditedFields`): manual and edited books are still
 * classified and get covers, only their listed fields are never written. Values are only filled where
 * the book has none – with one exception: a partial / misspelt author reading of the same person may
 * be completed ("HAMANN" → "Brigitte Hamann"), never replaced by a different person.
 *
 * Owner: merge-enrich.
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import fs from 'node:fs/promises';
import { db } from '@/db';
import { books, collections, type BookRow, type NewBookRow } from '@/db/schema';
import { getTextProvider } from '@/lib/ai';
import type { AiUsage, BookClassification, BookForClassification, TextProvider } from '@/lib/ai/types';
import { recordUsage } from '@/lib/ai/usage';
import { env } from '@/lib/env';
import { abs, rel } from '@/lib/storage';
import { isTopicKey } from '@/lib/taxonomy';
import type { Locale } from '@/lib/types';
import { downloadCover, findCover, normalizeIsbn, type CoverMatch, type DownloadedCover } from './covers';
import { isFieldProtected, ownerEditedFields, type OwnerEditGuard } from './merge';
import { authorSortKey, authorsCompatible, foldForCompare, levenshteinRatio, nameCase, normalizeTitle } from './text';

/** books per classification request (SPEC §4.6.1) */
export const CLASSIFY_BATCH_SIZE = 40;
/** parallel cover lookups (the HTTP limiter in covers.ts keeps the global rate ≤ 3 req/s) */
export const COVER_CONCURRENCY = 3;
export const DESCRIPTION_MAX_CHARS = 200;
const CLASSIFY_RETRY_DELAY_MS = 1500;
const MAX_TOPICS = 3;
const MAX_NAME_CHARS = 300;
const MAX_TITLE_CHARS = 500;
/** progress share of the classification phase when covers are looked up too */
const CLASSIFY_SHARE_WITH_COVERS = 0.4;

/* ================================================================== */
/* Pure helpers (exported for tests)                                   */
/* ================================================================== */

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max).trim() : s;
};

const ISO_639_2_TO_1: Record<string, string> = {
  hun: 'hu', eng: 'en', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', ita: 'it', spa: 'es', por: 'pt', rus: 'ru',
  pol: 'pl', cze: 'cs', ces: 'cs', slo: 'sk', slk: 'sk', rum: 'ro', ron: 'ro', dut: 'nl', nld: 'nl', swe: 'sv',
  dan: 'da', nor: 'no', fin: 'fi', est: 'et', lav: 'lv', lit: 'lt', gre: 'el', ell: 'el', tur: 'tr', heb: 'he',
  ara: 'ar', per: 'fa', fas: 'fa', hin: 'hi', jpn: 'ja', chi: 'zh', zho: 'zh', kor: 'ko', lat: 'la', hrv: 'hr',
  srp: 'sr', slv: 'sl', bul: 'bg', ukr: 'uk', cat: 'ca', epo: 'eo', ice: 'is', isl: 'is', alb: 'sq', sqi: 'sq',
  grc: 'el', yid: 'yi',
};
const LANGUAGE_NAMES: Record<string, string> = {
  hungarian: 'hu', magyar: 'hu', english: 'en', angol: 'en', german: 'de', nemet: 'de', french: 'fr', francia: 'fr',
  italian: 'it', olasz: 'it', spanish: 'es', spanyol: 'es', russian: 'ru', orosz: 'ru', latin: 'la', greek: 'el',
  gorog: 'el', polish: 'pl', lengyel: 'pl', czech: 'cs', cseh: 'cs', japanese: 'ja', japan: 'ja', chinese: 'zh',
  kinai: 'zh', swedish: 'sv', sved: 'sv', dutch: 'nl', holland: 'nl', portuguese: 'pt', portugal: 'pt',
};

/** ISO 639-1 code ("hu") from "hu", "HU-hu", "hun", "Hungarian"; null when not recognisable. */
export function normalizeLanguageCode(v: unknown): string | null {
  const s = clean(v, 40);
  if (!s) return null;
  const lower = s.toLowerCase();
  const primary = lower.split(/[-_]/)[0];
  if (/^[a-z]{2}$/.test(primary)) return primary;
  if (/^[a-z]{3}$/.test(primary) && ISO_639_2_TO_1[primary]) return ISO_639_2_TO_1[primary];
  return LANGUAGE_NAMES[foldForCompare(lower)] ?? null;
}

const COUNTRY_ALIASES: Record<string, string> = {
  UK: 'GB', EL: 'GR', HUN: 'HU', USA: 'US', GBR: 'GB', DEU: 'DE', GER: 'DE', FRA: 'FR', ITA: 'IT', ESP: 'ES',
  AUT: 'AT', RUS: 'RU', POL: 'PL', CZE: 'CZ', SVK: 'SK', ROU: 'RO', SRB: 'RS', HRV: 'HR', SWE: 'SE', NOR: 'NO',
  DNK: 'DK', FIN: 'FI', NLD: 'NL', BEL: 'BE', CHE: 'CH', IRL: 'IE', CAN: 'CA', AUS: 'AU', JPN: 'JP', CHN: 'CN',
  ISR: 'IL', IND: 'IN', BRA: 'BR', ARG: 'AR', COL: 'CO', MEX: 'MX', GRC: 'GR', TUR: 'TR', UKR: 'UA', PRT: 'PT',
  NZL: 'NZ', ZAF: 'ZA', MKD: 'MK', CHL: 'CL', PER: 'PE', ISL: 'IS', SVN: 'SI', BGR: 'BG', EST: 'EE', LVA: 'LV',
  LTU: 'LT', KOR: 'KR', EGY: 'EG', IRN: 'IR', NGA: 'NG', SAU: 'SA', VNM: 'VN',
};

/** ISO 3166-1 alpha-2 ("HU") from "hu", "HUN", "UK"; null otherwise (the column is 2 characters). */
export function normalizeCountryCode(v: unknown): string | null {
  const s = clean(v, 10);
  if (!s) return null;
  const up = s.toUpperCase().replace(/[^A-Z]/g, '');
  if (COUNTRY_ALIASES[up]) return COUNTRY_ALIASES[up];
  return /^[A-Z]{2}$/.test(up) ? up : null;
}

/** Plausible first-publication year (negative = BCE); null otherwise. */
export function normalizeYear(v: unknown, now: Date = new Date()): number | null {
  const n = typeof v === 'string' && /^\s*-?\d{1,4}\s*$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n === 0 || n < -3000 || n > now.getUTCFullYear() + 1) return null;
  return n;
}

/** Trimmed description of at most `max` characters (cut at a word boundary with an ellipsis). */
export function cleanDescription(v: unknown, max = DESCRIPTION_MAX_CHARS): string | null {
  const s = clean(v, 5000);
  if (!s) return null;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.–-]+$/u, '')}…`;
}

/** Taxonomy-validated category (unknown → "other") and up to 3 distinct extra topics (unknown → "other"). */
export function sanitizeTopics(category: unknown, topics: unknown): { category: string; topics: string[] } {
  const key = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const k = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!k) return null;
    return isTopicKey(k) ? k : 'other';
  };
  const cat = key(category) ?? 'other';
  const out: string[] = [];
  for (const t of Array.isArray(topics) ? topics : []) {
    const k = key(t);
    if (!k || k === cat || out.includes(k)) continue;
    out.push(k);
    if (out.length >= MAX_TOPICS) break;
  }
  return { category: cat, topics: out };
}

function diacritics(s: string): number {
  let n = 0;
  for (const ch of s) if (ch.normalize('NFD').length > 1) n++;
  return n;
}

function isAllCaps(s: string): boolean {
  return s !== s.toLowerCase() && s === s.toUpperCase();
}

function nameTokens(s: string): string[] {
  return foldForCompare(s.replace(/\.(?=\p{L})/gu, '. ')).split(' ').filter(Boolean);
}

/**
 * true when `proposed` is the same person(s) as `current`, written more completely or more correctly:
 * extra given names / co-authors ("HAMANN" → "Brigitte Hamann"), expanded initials ("H. Perruchot" →
 * "Henri Perruchot"), restored accents or casing ("ESTERHAZY PETER" → "Esterházy Péter"), a fixed typo.
 * A mere reordering of the same names, a downgrade or a different person is never an upgrade.
 */
export function authorUpgrade(current: string, proposed: string): boolean {
  const cur = clean(current, MAX_NAME_CHARS);
  const next = clean(proposed, MAX_NAME_CHARS);
  if (!cur || !next || cur === next) return false;
  if (!authorsCompatible(cur, next)) return false;
  const ct = nameTokens(cur);
  const pt = nameTokens(next);
  if (!ct.length || !pt.length || pt.length < ct.length) return false;

  const pool = pt.map((t, i) => ({ t, i }));
  let expandedInitial = false;
  let fixedTypo = false;
  const matchedIdx: number[] = [];
  for (const c of ct) {
    let best = -1;
    let bestKind: 'exact' | 'initial' | 'typo' | null = null;
    for (let k = 0; k < pool.length; k++) {
      const p = pool[k].t;
      if (p === c) {
        best = k;
        bestKind = 'exact';
        break;
      }
      if (c.length === 1 && p.length > 1 && p.startsWith(c) && bestKind !== 'typo') {
        best = k;
        bestKind = 'initial';
      } else if (c.length >= 4 && p.length >= 4 && levenshteinRatio(c, p) >= 0.8 && best < 0) {
        best = k;
        bestKind = 'typo';
      }
    }
    if (best < 0) return false;
    if (bestKind === 'initial') expandedInitial = true;
    if (bestKind === 'typo') fixedTypo = true;
    matchedIdx.push(pool[best].i);
    pool.splice(best, 1);
  }
  const moreNames = pt.length > ct.length;
  const sameTokensReordered =
    !moreNames && !expandedInitial && !fixedTypo && matchedIdx.some((idx, k) => k > 0 && idx < matchedIdx[k - 1]);
  if (sameTokensReordered) return false;
  return (
    moreNames ||
    expandedInitial ||
    fixedTypo ||
    diacritics(next) > diacritics(cur) ||
    (isAllCaps(cur) && !isAllCaps(next))
  );
}

type BookFields = Pick<
  BookRow,
  | 'title'
  | 'author'
  | 'spineAuthor'
  | 'category'
  | 'topics'
  | 'originalTitle'
  | 'language'
  | 'originalLanguage'
  | 'authorCountry'
  | 'firstPublishedYear'
  | 'descriptionHu'
  | 'descriptionEn'
  | 'isbn'
  | 'pageCount'
  | 'enrichment'
  | 'reviewed'
>;

const empty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Fields a classification may write on a book: only empty, unprotected fields (see module comment).
 * Returns the patch (without enrichment bookkeeping); authorSort is recomputed when author/language change.
 */
export function planClassificationPatch(book: BookFields, cls: BookClassification, guard: OwnerEditGuard = ownerEditedFields(book)): Partial<NewBookRow> {
  const patch: Partial<NewBookRow> = {};
  const can = (field: string) => !isFieldProtected(guard, field);

  const { category, topics } = sanitizeTopics(cls.category, cls.topics);
  if (can('category') && empty(book.category)) patch.category = category;
  const finalCategory = patch.category ?? book.category;
  if (can('topics') && (!Array.isArray(book.topics) || book.topics.length === 0)) {
    const extra = topics.filter((t) => t !== finalCategory);
    if (extra.length) patch.topics = extra;
  }

  const rawAuthor = clean(cls.author, MAX_NAME_CHARS);
  const proposedAuthor = rawAuthor ? (isAllCaps(rawAuthor) ? nameCase(rawAuthor) : rawAuthor) : null;
  if (proposedAuthor && can('author')) {
    if (empty(book.author)) {
      // never attribute the book to someone the spine contradicts
      if (authorsCompatible(book.spineAuthor, proposedAuthor)) patch.author = proposedAuthor;
    } else if (!guard.reviewed && authorUpgrade(book.author!, proposedAuthor)) {
      patch.author = proposedAuthor;
    }
  }

  const language = normalizeLanguageCode(cls.language);
  if (language && can('language') && empty(book.language)) patch.language = language;
  const originalLanguage = normalizeLanguageCode(cls.originalLanguage);
  if (originalLanguage && can('originalLanguage') && empty(book.originalLanguage)) patch.originalLanguage = originalLanguage;
  const country = normalizeCountryCode(cls.authorCountry);
  if (country && can('authorCountry') && empty(book.authorCountry)) patch.authorCountry = country;
  const year = normalizeYear(cls.firstPublishedYear);
  if (year !== null && can('firstPublishedYear') && book.firstPublishedYear === null) patch.firstPublishedYear = year;

  const originalTitle = clean(cls.originalTitle, MAX_TITLE_CHARS);
  if (
    originalTitle &&
    can('originalTitle') &&
    empty(book.originalTitle) &&
    normalizeTitle(originalTitle) !== '' &&
    normalizeTitle(originalTitle) !== normalizeTitle(book.title)
  ) {
    patch.originalTitle = originalTitle;
  }

  const hu = cleanDescription(cls.descriptionHu);
  if (hu && can('descriptionHu') && empty(book.descriptionHu)) patch.descriptionHu = hu;
  const en = cleanDescription(cls.descriptionEn);
  if (en && can('descriptionEn') && empty(book.descriptionEn)) patch.descriptionEn = en;

  if (patch.author !== undefined || patch.language !== undefined) {
    const nextAuthor = patch.author ?? book.author ?? book.spineAuthor;
    patch.authorSort = authorSortKey(nextAuthor, patch.language ?? book.language);
  }
  return patch;
}

/** Fields a cover match may write: coverUrl / coverPath, plus ISBN, page count and year where empty and unprotected. */
export function planCoverPatch(
  book: BookFields,
  match: CoverMatch,
  download: DownloadedCover | null,
  guard: OwnerEditGuard = ownerEditedFields(book),
): Partial<NewBookRow> {
  const can = (field: string) => !isFieldProtected(guard, field);
  const patch: Partial<NewBookRow> = { coverUrl: match.url };
  if (download) patch.coverPath = download.path;
  // an ISBN identifies one edition: never taken from a record of the original-language work
  const isbn = match.via === 'original_title' ? null : normalizeIsbn(match.isbn);
  if (isbn && can('isbn') && empty(book.isbn)) patch.isbn = isbn;
  if (match.pageCount && match.pageCount > 0 && match.pageCount <= 20000 && can('pageCount') && book.pageCount === null) {
    patch.pageCount = Math.round(match.pageCount);
  }
  const year = normalizeYear(match.firstPublishYear);
  if (year !== null && can('firstPublishedYear') && book.firstPublishedYear === null) patch.firstPublishedYear = year;
  return patch;
}

/* ================================================================== */
/* DB orchestration                                                    */
/* ================================================================== */

function describeErr(e: unknown): string {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function enrichmentObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

async function safeRecordUsage(collectionId: string, usage: AiUsage | undefined): Promise<void> {
  if (!usage) return;
  try {
    await recordUsage(collectionId, usage);
  } catch (e) {
    console.warn('[enrich] recordUsage failed', { collectionId, error: describeErr(e) });
  }
}

/** One classification request with a single retry; an empty map when both attempts fail. */
async function classifyBatch(
  provider: TextProvider,
  collectionId: string,
  batch: BookRow[],
  locale: Locale,
): Promise<Map<string, BookClassification>> {
  const input: BookForClassification[] = batch.map((b) => ({
    id: b.id,
    author: b.author,
    title: b.title,
    spineAuthor: b.spineAuthor,
    spineTitle: b.spineTitle,
    publisher: b.publisher,
  }));
  const ids = new Set(input.map((b) => b.id));
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { results, usage } = await provider.classifyBooks(input, { locale });
      await safeRecordUsage(collectionId, usage);
      const out = new Map<string, BookClassification>();
      for (const r of Array.isArray(results) ? results : []) {
        if (r && typeof r.id === 'string' && ids.has(r.id) && !out.has(r.id)) out.set(r.id, r);
      }
      if (out.size < ids.size) {
        console.warn('[enrich] classification incomplete', { collectionId, requested: ids.size, returned: out.size });
      }
      return out;
    } catch (e) {
      const config = e instanceof Error && e.name === 'AiConfigError';
      console.warn('[enrich] classification failed', { collectionId, attempt, books: batch.length, error: describeErr(e) });
      if (config || attempt >= 2) break;
      await sleep(CLASSIFY_RETRY_DELAY_MS);
    }
  }
  return new Map();
}

/** Applies a classification to one book (row locked, re-read). Returns whether the book still exists. */
async function applyClassification(
  bookId: string,
  cls: BookClassification | undefined,
  provider: TextProvider | null,
  markEnriched: boolean,
): Promise<boolean> {
  if (!cls && !markEnriched) return true;
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(books).where(eq(books.id, bookId)).for('update');
    if (!row) return false;
    const now = new Date();
    const set: Partial<NewBookRow> = {};
    if (cls) {
      Object.assign(set, planClassificationPatch(row, cls));
      set.enrichment = {
        ...enrichmentObject(row.enrichment),
        classification: {
          provider: provider?.name ?? null,
          model: provider?.model ?? null,
          at: now.toISOString(),
          category: cls.category ?? null,
          topics: Array.isArray(cls.topics) ? cls.topics.slice(0, 6) : [],
          author: cls.author ?? null,
          originalTitle: cls.originalTitle ?? null,
          language: cls.language ?? null,
          originalLanguage: cls.originalLanguage ?? null,
          authorCountry: cls.authorCountry ?? null,
          firstPublishedYear: cls.firstPublishedYear ?? null,
          applied: Object.keys(set).filter((k) => k !== 'authorSort'),
        },
      };
      set.updatedAt = now;
    }
    if (markEnriched) set.enrichedAt = now;
    if (Object.keys(set).length) await tx.update(books).set(set).where(eq(books.id, bookId));
    return true;
  });
}

async function removeFile(relPath: string): Promise<void> {
  try {
    await fs.rm(abs(relPath), { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Looks up and stores the cover of one book, then marks it enriched.
 * Returns { exists, cover } – cover = a cover was found and stored on the book.
 */
async function coverForBook(collectionId: string, bookId: string): Promise<{ exists: boolean; cover: boolean }> {
  const [fresh] = await db().select().from(books).where(eq(books.id, bookId)).limit(1);
  if (!fresh) return { exists: false, cover: false };

  let match: CoverMatch | null = null;
  let download: DownloadedCover | null = null;
  const skip = !!fresh.coverPath || normalizeTitle(fresh.title).replace(/\s/g, '').length < 2;
  if (!skip) {
    try {
      match = await findCover({
        author: fresh.author ?? fresh.spineAuthor,
        title: fresh.title,
        isbn: fresh.isbn,
        originalTitle: fresh.originalTitle,
        language: fresh.language,
        originalLanguage: fresh.originalLanguage,
      });
      if (match) download = await downloadCover(match.url, rel.cover(collectionId, bookId));
    } catch (e) {
      console.warn('[enrich] cover lookup failed', { collectionId, bookId, error: describeErr(e) });
      match = null;
    }
  }

  const outcome = await db().transaction(async (tx) => {
    const [row] = await tx.select().from(books).where(eq(books.id, bookId)).for('update');
    if (!row) return { exists: false, cover: false };
    const now = new Date();
    const set: Partial<NewBookRow> = { enrichedAt: row.enrichedAt ?? now };
    if (!skip) {
      const enrichment = enrichmentObject(row.enrichment);
      enrichment.coverCheckedAt = now.toISOString();
      if (match && !row.coverPath) {
        Object.assign(set, planCoverPatch(row, match, download));
        enrichment.cover = {
          ...match,
          localPath: download?.path ?? null,
          width: download?.width ?? null,
          height: download?.height ?? null,
        };
        set.updatedAt = now;
      } else if (!match) {
        enrichment.cover = null;
      }
      set.enrichment = enrichment;
    }
    await tx.update(books).set(set).where(eq(books.id, bookId));
    return { exists: true, cover: !!(match && !row.coverPath) };
  });
  if (!outcome.exists && download) await removeFile(download.path);
  return outcome;
}

/** Serialised, monotonic, error-proof progress reporting. */
function progressReporter(onProgress?: (fraction: number) => void | Promise<void>) {
  let last = -1;
  let chain: Promise<void> = Promise.resolve();
  return (fraction: number): Promise<void> => {
    if (!onProgress) return Promise.resolve();
    const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
    chain = chain.then(async () => {
      if (f <= last) return;
      last = f;
      try {
        await onProgress(f);
      } catch (e) {
        console.warn('[enrich] progress callback failed', { error: describeErr(e) });
      }
    });
    return chain;
  };
}

/**
 * Classifies the not-yet-enriched books of a collection (batches of 40 via the text provider; usage
 * recorded; one retry per batch, then the batch continues unclassified), then looks up covers
 * (ENRICH_COVERS, 3 in parallel). Every processed book gets `enrichedAt`, even when nothing was found.
 */
export async function enrichCollection(
  collectionId: string,
  onProgress?: (fraction: number) => void | Promise<void>,
): Promise<{ enriched: number; covers: number }> {
  const progress = progressReporter(onProgress);
  const database = db();
  const [collection] = await database
    .select({ id: collections.id, locale: collections.locale })
    .from(collections)
    .where(eq(collections.id, collectionId))
    .limit(1);
  if (!collection) {
    console.warn('[enrich] collection not found', { collectionId });
    await progress(1);
    return { enriched: 0, covers: 0 };
  }
  const locale: Locale = collection.locale === 'en' ? 'en' : 'hu';

  const pending = await database
    .select()
    .from(books)
    .where(and(eq(books.collectionId, collectionId), isNull(books.enrichedAt)))
    .orderBy(asc(books.shelfPosition), asc(books.createdAt), asc(books.id));
  if (!pending.length) {
    await progress(1);
    return { enriched: 0, covers: 0 };
  }

  const withCovers = env().ENRICH_COVERS;
  const classifyShare = withCovers ? CLASSIFY_SHARE_WITH_COVERS : 1;
  const started = Date.now();
  await progress(0);

  /* ---- 1. classification ---- */
  let provider: TextProvider | null = null;
  try {
    provider = getTextProvider();
  } catch (e) {
    console.warn('[enrich] text provider unavailable, skipping classification', { collectionId, error: describeErr(e) });
  }
  const existing = new Set(pending.map((b) => b.id));
  let classified = 0;
  const batches = chunk(pending, CLASSIFY_BATCH_SIZE);
  for (const [bi, batch] of batches.entries()) {
    const results = provider ? await classifyBatch(provider, collectionId, batch, locale) : new Map<string, BookClassification>();
    for (const book of batch) {
      const cls = results.get(book.id);
      try {
        const exists = await applyClassification(book.id, cls, provider, !withCovers);
        if (!exists) existing.delete(book.id);
        else if (cls) classified++;
      } catch (e) {
        console.warn('[enrich] applying classification failed', { collectionId, bookId: book.id, error: describeErr(e) });
      }
    }
    await progress((classifyShare * (bi + 1)) / batches.length);
  }

  /* ---- 2. covers ---- */
  let covers = 0;
  if (withCovers) {
    const queue = pending.filter((b) => existing.has(b.id)).map((b) => b.id);
    const total = queue.length;
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < queue.length) {
        const bookId = queue[next++];
        try {
          const r = await coverForBook(collectionId, bookId);
          if (!r.exists) existing.delete(bookId);
          if (r.cover) covers++;
        } catch (e) {
          console.warn('[enrich] cover step failed', { collectionId, bookId, error: describeErr(e) });
        }
        done++;
        await progress(classifyShare + ((1 - classifyShare) * done) / Math.max(1, total));
      }
    };
    await Promise.all(Array.from({ length: Math.min(COVER_CONCURRENCY, Math.max(1, total)) }, worker));
  }

  /* ---- 3. every processed book is enriched, even when a step failed ---- */
  const now = new Date();
  for (const part of chunk([...existing], 500)) {
    await database
      .update(books)
      .set({ enrichedAt: now })
      .where(and(inArray(books.id, part), isNull(books.enrichedAt)));
  }

  await progress(1);
  console.info('[enrich] collection enriched', {
    collectionId,
    books: existing.size,
    classified,
    covers,
    provider: provider?.name ?? null,
    ms: Date.now() - started,
  });
  return { enriched: existing.size, covers };
}
