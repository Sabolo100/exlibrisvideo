/**
 * Book data for an ISBN: Google Books (best for Hungarian editions) and Open Library, merged field by
 * field (Google first). Server-only, no key needed (GOOGLE_BOOKS_API_KEY is used when set).
 */
import { env } from '@/lib/env';
import { COVER_USER_AGENT } from '@/lib/pipeline/covers';

export interface IsbnBook {
  isbn: string;
  title: string;
  subtitle: string | null;
  /** "; " separated */
  author: string | null;
  publisher: string | null;
  /** year of this edition */
  editionYear: number | null;
  pageCount: number | null;
  /** ISO 639-1 */
  language: string | null;
  /** https cover image of this edition */
  coverUrl: string | null;
  source: 'google' | 'openlibrary';
}

const TIMEOUT_MS = 8000;

type FetchJson = (url: string) => Promise<unknown>;

const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': COVER_USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const year = (v: unknown): number | null => {
  const m = /(1[4-9]\d\d|20\d\d)/.exec(String(v ?? ''));
  return m ? Number(m[1]) : null;
};
const https = (url: string | null): string | null => (url ? url.replace(/^http:\/\//i, 'https://') : null);

/** ISO 639-2/B → 639-1 for the codes Open Library reports most */
const LANG3: Record<string, string> = { hun: 'hu', eng: 'en', ger: 'de', fre: 'fr', ita: 'it', spa: 'es', rus: 'ru', pol: 'pl', rum: 'ro', slo: 'sk', cze: 'cs' };

export function parseGoogleVolume(json: unknown, isbn: string): IsbnBook | null {
  const items = (json as { items?: unknown[] } | null)?.items;
  const info = Array.isArray(items) && items[0] && typeof items[0] === 'object' ? (items[0] as { volumeInfo?: Record<string, unknown> }).volumeInfo : null;
  const title = str(info?.title);
  if (!info || !title) return null;
  const authors = Array.isArray(info.authors) ? info.authors.map(str).filter((a): a is string => !!a) : [];
  const links = (info.imageLinks ?? {}) as Record<string, unknown>;
  const lang = str(info.language)?.toLowerCase() ?? null;
  return {
    isbn,
    title,
    subtitle: str(info.subtitle),
    author: authors.length ? authors.join('; ') : null,
    publisher: str(info.publisher),
    editionYear: year(info.publishedDate),
    pageCount: typeof info.pageCount === 'number' && info.pageCount > 0 ? info.pageCount : null,
    language: lang && /^[a-z]{2}$/.test(lang) ? lang : null,
    coverUrl: https(str(links.thumbnail) ?? str(links.smallThumbnail)),
    source: 'google',
  };
}

export function parseOpenLibrarySearch(json: unknown, isbn: string): IsbnBook | null {
  const docs = (json as { docs?: unknown[] } | null)?.docs;
  const doc = Array.isArray(docs) && docs[0] && typeof docs[0] === 'object' ? (docs[0] as Record<string, unknown>) : null;
  const title = str(doc?.title);
  if (!doc || !title) return null;
  const authors = Array.isArray(doc.author_name) ? doc.author_name.map(str).filter((a): a is string => !!a) : [];
  const publishers = Array.isArray(doc.publisher) ? doc.publisher.map(str).filter((p): p is string => !!p) : [];
  const languages = Array.isArray(doc.language) ? doc.language.map(str).filter((l): l is string => !!l) : [];
  const lang = languages.length === 1 ? (LANG3[languages[0]] ?? null) : null;
  const pages = typeof doc.number_of_pages_median === 'number' && doc.number_of_pages_median > 0 ? doc.number_of_pages_median : null;
  return {
    isbn,
    title,
    subtitle: str(doc.subtitle),
    author: authors.length ? authors.join('; ') : null,
    publisher: publishers[0] ?? null,
    editionYear: null,
    pageCount: pages,
    language: lang,
    coverUrl: typeof doc.cover_i === 'number' ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null,
    source: 'openlibrary',
  };
}

/** Google first, Open Library fills the gaps; null when neither knows the ISBN. Never throws. */
export async function lookupIsbn(isbn: string, fetchJson: FetchJson = defaultFetchJson): Promise<IsbnBook | null> {
  const key = env().GOOGLE_BOOKS_API_KEY;
  const googleUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1${key ? `&key=${encodeURIComponent(key)}` : ''}`;
  const olUrl = `https://openlibrary.org/search.json?isbn=${isbn}&limit=1&fields=title,subtitle,author_name,publisher,number_of_pages_median,cover_i,language`;
  const [google, ol] = await Promise.all([
    fetchJson(googleUrl).then((j) => parseGoogleVolume(j, isbn)).catch((err) => {
      console.warn('[books] google isbn lookup failed', { isbn, error: err instanceof Error ? err.message : String(err) });
      return null;
    }),
    fetchJson(olUrl).then((j) => parseOpenLibrarySearch(j, isbn)).catch((err) => {
      console.warn('[books] open library isbn lookup failed', { isbn, error: err instanceof Error ? err.message : String(err) });
      return null;
    }),
  ]);
  if (!google) return ol;
  if (!ol) return google;
  return {
    ...google,
    subtitle: google.subtitle ?? ol.subtitle,
    author: google.author ?? ol.author,
    publisher: google.publisher ?? ol.publisher,
    pageCount: google.pageCount ?? ol.pageCount,
    language: google.language ?? ol.language,
    coverUrl: ol.coverUrl ?? google.coverUrl,
  };
}
