import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testEnv = vi.hoisted(() => {
  const base = (process.env.TEMP || process.env.TMPDIR || '/tmp').replace(/\\/g, '/');
  const dir = `${base}/exl-covers-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.STORAGE_DIR = dir;
  delete process.env.GOOGLE_BOOKS_API_KEY;
  return { dir };
});

import {
  COVER_USER_AGENT,
  coverClientInternals,
  downloadCover,
  evaluateGoogleItems,
  evaluateOpenLibraryDocs,
  findCover,
  isbnVariants,
  languageSet,
  normalizeIsbn,
} from './covers';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

const calls: { url: URL; init: RequestInit | undefined; at: number }[] = [];
let handler: Handler = () => new Response('not mocked', { status: 500 });

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

function acc(title: string, author: string | null, language?: string, originalLanguage?: string) {
  return { title, author, languages: languageSet(language, originalLanguage), bookLanguages: languageSet(language) };
}

const ol = (docs: unknown[]) => json({ numFound: docs.length, docs });

beforeAll(async () => {
  await fs.mkdir(testEnv.dir, { recursive: true });
});

afterAll(async () => {
  await fs.rm(testEnv.dir, { recursive: true, force: true });
});

beforeEach(() => {
  coverClientInternals.reset();
  coverClientInternals.setMinIntervalMs(0);
  calls.length = 0;
  handler = () => new Response('not mocked', { status: 500 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      calls.push({ url, init, at: Date.now() });
      return handler(url, init);
    }),
  );
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* identifiers & languages                                             */
/* ------------------------------------------------------------------ */

describe('ISBN helpers', () => {
  it('validates checksums and cleans formatting', () => {
    expect(normalizeIsbn('ISBN 963-11-0348-X')).toBe('963110348X');
    expect(normalizeIsbn('978-963-11-0348-9')).toBe('9789631103489');
    expect(normalizeIsbn('9789631103488')).toBeNull();
    expect(normalizeIsbn('963110348')).toBeNull();
    expect(normalizeIsbn(null)).toBeNull();
  });

  it('converts between ISBN-10 and ISBN-13', () => {
    expect(isbnVariants('963110348X')).toEqual(['9789631103489', '963110348X']);
    expect(isbnVariants('9780316791786')).toEqual(['9780316791786', '0316791784']);
    expect(isbnVariants('bad')).toEqual([]);
  });

  it('languageSet knows both code forms', () => {
    expect([...languageSet('hu', 'IT')].sort()).toEqual(['hu', 'hun', 'it', 'ita']);
    expect([...languageSet('ger')].sort()).toEqual(['de', 'ger']);
    expect(languageSet(null, undefined).size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* strict acceptance                                                   */
/* ------------------------------------------------------------------ */

describe('evaluateOpenLibraryDocs', () => {
  const lengyel = {
    key: '/works/OL1674588W',
    title: 'Régi magyar mondák',
    author_name: ['Lengyel, Dénes.'],
    first_publish_year: 1972,
    cover_i: 111,
    number_of_pages_median: 249,
    language: ['hun'],
    editions: { docs: [{ key: '/books/OL1M', title: 'Régi magyar mondák', cover_i: 222, language: ['hun'], isbn: ['9631167984'] }] },
  };

  it('accepts a Hungarian edition (accents, family-name-first author) and takes its ISBN', () => {
    const m = evaluateOpenLibraryDocs([lengyel], acc('REGI MAGYAR MONDAK', 'Lengyel Dénes', 'hu'), 'title_author');
    expect(m).toMatchObject({
      url: 'https://covers.openlibrary.org/b/id/222-L.jpg',
      source: 'openlibrary',
      isbn: '9631167984',
      pageCount: 249,
      firstPublishYear: 1972,
      openLibraryKey: '/works/OL1674588W',
      openLibraryEditionKey: '/books/OL1M',
      titleScore: 1,
    });
  });

  it('does not take an ISBN when the book language is unknown', () => {
    const m = evaluateOpenLibraryDocs([lengyel], acc('Régi magyar mondák', 'Lengyel Dénes'), 'title_author');
    expect(m?.isbn).toBeUndefined();
    expect(m?.url).toContain('222');
  });

  it('rejects other books by the same author and different people with the same title', () => {
    const ferrante = {
      key: '/works/OL2W',
      title: 'Az elvesztett gyerek története',
      author_name: ['Elena Ferrante'],
      cover_i: 5,
      language: ['hun'],
    };
    expect(evaluateOpenLibraryDocs([ferrante], acc('Az új név története', 'Elena Ferrante', 'hu'), 'title_author')).toBeNull();
    const wilson = { key: '/works/OL3W', title: 'Lusitania', author_name: ['Colin Wilson'], cover_i: 6, language: ['eng'] };
    expect(evaluateOpenLibraryDocs([wilson], acc('Lusitania', 'Colin Simpson', 'en'), 'title_author')).toBeNull();
    const noAuthor = { key: '/works/OL4W', title: 'Lusitania', cover_i: 7, language: ['eng'] };
    expect(evaluateOpenLibraryDocs([noAuthor], acc('Lusitania', 'Colin Simpson', 'en'), 'title_author')).toBeNull();
  });

  it('rejects conflicting volume numbers and accepts initials / subtitles', () => {
    const vol2 = { key: '/works/OL5W', title: 'Háború és béke II.', author_name: ['Lev Tolsztoj'], cover_i: 8, language: ['hun'] };
    expect(evaluateOpenLibraryDocs([vol2], acc('Háború és béke I.', 'Tolsztoj', 'hu'), 'title_author')).toBeNull();
    const sub = {
      key: '/works/OL6W',
      title: 'Magyar mondák: a török világból és a kuruc korból',
      author_name: ['Dénes Lengyel'],
      cover_i: 9,
      language: ['hun'],
    };
    expect(evaluateOpenLibraryDocs([sub], acc('Magyar mondák', 'LENGYEL DENES', 'hu'), 'title_author')?.url).toContain('/9-L.jpg');
    const perruchot = { key: '/works/OL7W', title: 'Gauguin élete', author_name: ['Henri Perruchot'], cover_i: 10, language: ['hun'] };
    expect(evaluateOpenLibraryDocs([perruchot], acc('Gauguin elete', 'H. Perruchot', 'hu'), 'title_author')).not.toBeNull();
  });

  it('an edition in an unrelated language never lends its cover (the work cover is used instead)', () => {
    const doc = {
      key: '/works/OL16807901W',
      title: 'Storia del nuovo cognome',
      author_name: ['Elena Ferrante'],
      cover_i: 12391275,
      language: ['chi', 'ita'],
      editions: { docs: [{ key: '/books/OL35693672M', title: 'Storia del nuovo cognome', cover_i: 999, language: ['chi'], isbn: ['9787020125265'] }] },
    };
    const m = evaluateOpenLibraryDocs([doc], acc('Storia del nuovo cognome', 'Elena Ferrante', 'hu', 'it'), 'original_title');
    expect(m?.url).toBe('https://covers.openlibrary.org/b/id/12391275-L.jpg');
    expect(m?.isbn).toBeUndefined();
    const italian = { ...doc, editions: { docs: [{ ...doc.editions.docs[0], cover_i: 14820924, language: ['ita'] }] } };
    const mi = evaluateOpenLibraryDocs([italian], acc('Storia del nuovo cognome', 'Elena Ferrante', 'hu', 'it'), 'original_title');
    expect(mi?.url).toBe('https://covers.openlibrary.org/b/id/14820924-L.jpg');
    expect(mi?.isbn).toBeUndefined(); // an original-language edition is not this book's edition
  });

  it('prefers the main work over a stray translation-only record', () => {
    const stray = { key: '/works/OLstray', title: 'Homo Deus', author_name: ['Yuval Noah Harari', 'Joandomènec Ros i Aragonès'], cover_i: 1 };
    const main = { key: '/works/OLmain', title: 'Homo Deus: A Brief History of Tomorrow', author_name: ['Yuval Noah Harari'], cover_i: 2, language: ['eng', 'spa'] };
    expect(evaluateOpenLibraryDocs([stray, main], acc('Homo Deus', 'Yuval Noah Harari', 'en'), 'title_author')?.openLibraryKey).toBe('/works/OLmain');
  });

  it('without an author only long, near-identical titles are accepted', () => {
    const generic = { key: '/works/OL8W', title: 'Versek', author_name: ['Petőfi Sándor'], cover_i: 11, language: ['hun'] };
    expect(evaluateOpenLibraryDocs([generic], acc('Versek', null, 'hu'), 'title')).toBeNull();
    const long = { key: '/works/OL9W', title: 'Mátra útikalauz', author_name: ['Valaki'], cover_i: 12, language: ['hun'] };
    expect(evaluateOpenLibraryDocs([long], acc('Mátra útikalauz', null, 'hu'), 'title')?.url).toContain('/12-L.jpg');
  });

  it('ignores malformed docs', () => {
    expect(evaluateOpenLibraryDocs(null, acc('X', null), 'title')).toBeNull();
    expect(evaluateOpenLibraryDocs([null, 1, 'x', { title: 5 }], acc('Valami cím', 'Valaki'), 'title')).toBeNull();
  });
});

describe('evaluateGoogleItems', () => {
  const item = (over: Record<string, unknown> = {}) => ({
    id: 'vol1',
    volumeInfo: {
      title: 'Az új név története',
      subtitle: 'Nápolyi regények 2.',
      authors: ['Elena Ferrante'],
      pageCount: 480,
      language: 'hu',
      industryIdentifiers: [
        { type: 'ISBN_10', identifier: '963110348X' },
        { type: 'ISBN_13', identifier: '9789631103489' },
      ],
      imageLinks: { thumbnail: 'http://books.google.com/books/content?id=vol1&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api' },
      ...over,
    },
  });

  it('accepts a matching volume, forces https, drops the page curl and prefers ISBN-13', () => {
    const m = evaluateGoogleItems([item()], acc('AZ UJ NEV TORTENETE', 'ELENA FERRANTE', 'hu', 'it'), 'title_author');
    expect(m).toMatchObject({ source: 'google', isbn: '9789631103489', pageCount: 480, googleVolumeId: 'vol1', language: 'hu' });
    expect(m?.url.startsWith('https://books.google.com/books/content?')).toBe(true);
    expect(m?.url).not.toContain('edge=');
  });

  it('rejects wrong authors, other languages, missing thumbnails and foreign image hosts', () => {
    expect(evaluateGoogleItems([item({ authors: ['Isaac Asimov'] })], acc('Az új név története', 'Elena Ferrante', 'hu'), 'title_author')).toBeNull();
    expect(evaluateGoogleItems([item({ language: 'zh' })], acc('Az új név története', 'Elena Ferrante', 'hu', 'it'), 'title_author')).toBeNull();
    expect(evaluateGoogleItems([item({ imageLinks: undefined })], acc('Az új név története', 'Elena Ferrante', 'hu'), 'title_author')).toBeNull();
    expect(
      evaluateGoogleItems([item({ imageLinks: { thumbnail: 'https://evil.example.com/x.jpg' } })], acc('Az új név története', 'Elena Ferrante', 'hu'), 'title_author'),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* findCover flow                                                      */
/* ------------------------------------------------------------------ */

describe('findCover', () => {
  it('queries Open Library with title + family name, the preferred language and the User-Agent', async () => {
    handler = (url) => {
      if (url.hostname === 'openlibrary.org') {
        return ol([{ key: '/works/OL1W', title: 'Pápai vizeken ne kalózkodj!', author_name: ['Péter Esterházy'], cover_i: 42, language: ['hun'] }]);
      }
      return new Response('unexpected', { status: 500 });
    };
    const m = await findCover({ author: 'Esterházy Péter', title: 'Pápai vizeken ne kalózkodj!', language: 'hu' });
    expect(m?.url).toBe('https://covers.openlibrary.org/b/id/42-L.jpg');
    expect(calls).toHaveLength(1);
    const u = calls[0].url;
    expect(u.pathname).toBe('/search.json');
    expect(u.searchParams.get('title')).toBe('Pápai vizeken ne kalózkodj');
    expect(u.searchParams.get('author')).toBe('Esterházy');
    expect(u.searchParams.get('lang')).toBe('hu');
    expect(u.searchParams.get('limit')).toBe('10');
    expect(u.searchParams.get('fields')).toContain('editions.cover_i');
    expect(new Headers(calls[0].init?.headers).get('user-agent')).toBe(COVER_USER_AGENT);
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('falls back to Google Books, then title-only queries only when the author queries returned nothing', async () => {
    handler = (url) => {
      if (url.hostname === 'openlibrary.org') return ol([]);
      const q = url.searchParams.get('q') ?? '';
      if (q.includes('inauthor:')) return json({ totalItems: 0 });
      return json({
        items: [
          {
            id: 'g1',
            volumeInfo: {
              title: 'Rudolf, a trónörökös',
              authors: ['Brigitte Hamann'],
              language: 'hu',
              imageLinks: { thumbnail: 'http://books.google.com/books/content?id=g1&img=1&zoom=1' },
            },
          },
        ],
      });
    };
    const m = await findCover({ author: 'HAMANN', title: 'Rudolf, a trónörökös', language: 'hu' });
    expect(m).toMatchObject({ source: 'google', via: 'title', googleVolumeId: 'g1' });
    expect(calls.map((c) => `${c.url.hostname}:${c.url.searchParams.get('q') ?? c.url.searchParams.get('title')}`)).toEqual([
      'openlibrary.org:Rudolf, a trónörökös',
      'www.googleapis.com:intitle:"Rudolf, a trónörökös" inauthor:HAMANN',
      'openlibrary.org:Rudolf, a trónörökös',
      'www.googleapis.com:intitle:"Rudolf, a trónörökös"',
    ]);
    expect(calls[2].url.searchParams.get('author')).toBeNull();
  });

  it('skips title-only queries when the author query found records, then tries the original title', async () => {
    handler = (url) => {
      if (url.hostname !== 'openlibrary.org') return json({});
      const t = url.searchParams.get('title');
      if (t === 'Alapítvány') return ol([{ key: '/works/X', title: 'Az Alapítvány barátai', author_name: ['Isaac Asimov'], cover_i: 1 }]);
      if (t === 'Foundation') {
        expect(url.searchParams.get('lang')).toBe('en');
        return ol([{ key: '/works/OL46125W', title: 'Foundation', author_name: ['Isaac Asimov'], cover_i: 14612610, first_publish_year: 1951, language: ['eng'] }]);
      }
      return ol([]);
    };
    const m = await findCover({ author: 'Isaac Asimov', title: 'Alapítvány', originalTitle: 'Foundation', language: 'hu', originalLanguage: 'en' });
    expect(m).toMatchObject({ via: 'original_title', firstPublishYear: 1951, url: 'https://covers.openlibrary.org/b/id/14612610-L.jpg' });
    expect(m?.isbn).toBeUndefined();
    const titles = calls.filter((c) => c.url.hostname === 'openlibrary.org').map((c) => c.url.searchParams.get('title'));
    expect(titles).toEqual(['Alapítvány', 'Foundation']);
  });

  it('drops leading articles from search texts (strict catalogue title search) but not from acceptance', async () => {
    handler = (url) => {
      if (url.hostname !== 'openlibrary.org') return json({});
      if (url.searchParams.get('title') === 'Lusitania') {
        return ol([{ key: '/works/OL4161481W', title: 'Lusitania', author_name: ['Simpson, Colin'], cover_i: 5385317, language: ['eng'], editions: { docs: [{ key: '/books/OL5409730M', title: 'The Lusitania.', cover_i: 7395570, language: ['eng'] }] } }]);
      }
      return ol([]);
    };
    const m = await findCover({ author: 'Colin Simpson', title: 'A Lusitania elsüllyesztése', originalTitle: 'The Lusitania', language: 'hu', originalLanguage: 'en' });
    expect(m).toMatchObject({ via: 'original_title', url: 'https://covers.openlibrary.org/b/id/7395570-L.jpg' });
    const olTitles = calls.filter((c) => c.url.hostname === 'openlibrary.org').map((c) => c.url.searchParams.get('title'));
    expect(olTitles).toEqual(['Lusitania elsüllyesztése', 'Lusitania elsüllyesztése', 'Lusitania']);
    const googleQueries = calls.filter((c) => c.url.hostname === 'www.googleapis.com').map((c) => c.url.searchParams.get('q'));
    expect(googleQueries[0]).toBe('intitle:"Lusitania elsüllyesztése" inauthor:Simpson');
  });

  it('uses an ISBN first', async () => {
    handler = (url) => {
      if (url.hostname === 'openlibrary.org' && (url.searchParams.get('q') ?? '').startsWith('isbn:')) {
        return ol([
          {
            key: '/works/OL1674587W',
            title: 'Magyar mondák: a török világból és a kuruc korból',
            author_name: ['Lengyel, Dénes.'],
            editions: { docs: [{ title: 'Magyar mondák', cover_i: 4337991, isbn: ['963110348X', '9789631103489'] }] },
          },
        ]);
      }
      return ol([]);
    };
    const m = await findCover({ author: 'Lengyel Dénes', title: 'Magyar mondák', isbn: '978-963-11-0348-9' });
    expect(m).toMatchObject({ via: 'isbn', isbn: '9789631103489', url: 'https://covers.openlibrary.org/b/id/4337991-L.jpg' });
    expect(calls[0].url.searchParams.get('q')).toBe('isbn:(9789631103489 OR 963110348X)');
  });

  it('pauses Google Books after a quota error and retries Open Library once on 503', async () => {
    let olCalls = 0;
    handler = (url) => {
      if (url.hostname === 'openlibrary.org') {
        olCalls++;
        if (olCalls === 1) return new Response('busy', { status: 503, headers: { 'retry-after': '0' } });
        return ol([]);
      }
      return json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }, { status: 429 });
    };
    expect(await findCover({ author: 'Rejtő Jenő', title: 'Csontbrigád', language: 'hu' })).toBeNull();
    expect(coverClientInternals.googlePaused()).toBe(true);
    const googleCalls = calls.filter((c) => c.url.hostname === 'www.googleapis.com').length;
    expect(googleCalls).toBe(1);
    expect(calls[0].url.hostname).toBe('openlibrary.org');
    expect(calls[1].url.hostname).toBe('openlibrary.org'); // the retry
    calls.length = 0;
    await findCover({ author: 'Babits Mihály', title: 'A gólyakalifa', language: 'hu' });
    expect(calls.some((c) => c.url.hostname === 'www.googleapis.com')).toBe(false);
  });

  it('caches identical searches', async () => {
    handler = () => ol([{ key: '/works/W', title: 'Csontbrigád', author_name: ['Jenő Rejtő'], cover_i: 3, language: ['hun'] }]);
    await findCover({ author: 'Rejtő Jenő', title: 'Csontbrigád', language: 'hu' });
    await findCover({ author: 'Rejtő Jenő', title: 'Csontbrigád', language: 'hu' });
    expect(calls).toHaveLength(1);
  });

  it('returns null for empty titles without any request', async () => {
    expect(await findCover({ author: 'X', title: '  !  ' })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('keeps every request of concurrent lookups ≥ the limiter spacing apart (global limit)', async () => {
    coverClientInternals.setMinIntervalMs(60);
    handler = () => ol([]);
    await Promise.all([
      findCover({ author: 'A Béla', title: 'Első könyv' }),
      findCover({ author: 'B Béla', title: 'Második könyv' }),
      findCover({ author: 'C Béla', title: 'Harmadik könyv' }),
    ]);
    expect(calls.length).toBeGreaterThanOrEqual(6);
    const times = calls.map((c) => c.at).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(50);
  });

  it('default limiter allows at most 3 requests per second', async () => {
    coverClientInternals.reset(); // default spacing
    handler = () => ol([]);
    const started = Date.now();
    await findCover({ author: 'Kiss Béla', title: 'Egy könyv címe' }); // 4 requests (OL, Google, OL, Google)
    const times = calls.map((c) => c.at);
    expect(times.length).toBe(4);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(320);
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
  });
});

/* ------------------------------------------------------------------ */
/* downloadCover                                                       */
/* ------------------------------------------------------------------ */

describe('downloadCover', () => {
  let png: Buffer;
  beforeAll(async () => {
    png = await sharp({ create: { width: 800, height: 1200, channels: 4, background: { r: 200, g: 30, b: 40, alpha: 0.5 } } })
      .png()
      .toBuffer();
  });

  it('follows allowed https redirects and stores a JPEG at most 600 px tall', async () => {
    handler = (url, init) => {
      expect(init?.redirect).toBe('manual');
      if (url.hostname === 'covers.openlibrary.org') {
        return new Response(null, { status: 302, headers: { location: 'https://archive.org/download/olcovers433/x.jpg' } });
      }
      if (url.hostname === 'archive.org') {
        return new Response(null, { status: 302, headers: { location: 'https://ia801505.us.archive.org/view_archive.php?file=x.jpg' } });
      }
      return new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });
    };
    const res = await downloadCover('https://covers.openlibrary.org/b/id/4337991-L.jpg', 'covers/123456789/book-1.jpg');
    expect(res).toMatchObject({ path: 'covers/123456789/book-1.jpg', width: 400, height: 600 });
    const file = path.join(testEnv.dir, 'covers/123456789/book-1.jpg');
    const meta = await sharp(file).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.height).toBe(600);
    expect(res!.bytes).toBe((await fs.stat(file)).size);
    expect(calls).toHaveLength(3);
    const leftovers = (await fs.readdir(path.dirname(file))).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('does not enlarge small covers', async () => {
    const small = await sharp({ create: { width: 128, height: 190, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    handler = () => new Response(new Uint8Array(small), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    const res = await downloadCover('https://books.google.com/books/content?id=x&img=1', 'covers/c/small.jpg');
    expect(res).toMatchObject({ width: 128, height: 190 });
  });

  it('rejects non-https URLs, foreign hosts and redirects leaving the allowlist', async () => {
    handler = () => new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png' } });
    expect(await downloadCover('http://covers.openlibrary.org/b/id/1-L.jpg', 'covers/c/a.jpg')).toBeNull();
    expect(await downloadCover('https://evil.example.com/cover.jpg', 'covers/c/a.jpg')).toBeNull();
    expect(await downloadCover('https://openlibrary.org.evil.com/cover.jpg', 'covers/c/a.jpg')).toBeNull();
    expect(calls).toHaveLength(0);
    handler = () => new Response(null, { status: 302, headers: { location: 'http://archive.org/x.jpg' } });
    expect(await downloadCover('https://covers.openlibrary.org/b/id/1-L.jpg', 'covers/c/a.jpg')).toBeNull();
    handler = () => new Response(null, { status: 301, headers: { location: 'https://169.254.169.254/latest' } });
    expect(await downloadCover('https://covers.openlibrary.org/b/id/1-L.jpg', 'covers/c/a.jpg')).toBeNull();
    await expect(fs.stat(path.join(testEnv.dir, 'covers/c/a.jpg'))).rejects.toThrow();
  });

  it('rejects non-images, oversized bodies, placeholders and undecodable data', async () => {
    handler = () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    expect(await downloadCover('https://covers.openlibrary.org/b/id/1-L.jpg', 'covers/c/b.jpg')).toBeNull();

    handler = () => new Response('x', { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(3 * 1024 * 1024) } });
    expect(await downloadCover('https://covers.openlibrary.org/b/id/1-L.jpg', 'covers/c/b.jpg')).toBeNull();

    handler = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let i = 0; i < 5; i++) controller.enqueue(new Uint8Array(600 * 1024));
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'image/jpeg' } },
      );
    expect(await downloadCover('https://covers.openlibrary.org/b/id/1-L.jpg', 'covers/c/b.jpg')).toBeNull();

    const pixel = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).gif().toBuffer();
    handler = () => new Response(new Uint8Array(pixel), { status: 200, headers: { 'content-type': 'image/gif' } });
    expect(await downloadCover('https://covers.openlibrary.org/b/id/1-L.jpg', 'covers/c/b.jpg')).toBeNull();

    handler = () => new Response('definitely not a jpeg', { status: 200, headers: { 'content-type': 'image/jpeg' } });
    expect(await downloadCover('https://covers.openlibrary.org/b/id/1-L.jpg', 'covers/c/b.jpg')).toBeNull();

    handler = () => new Response('gone', { status: 404, headers: { 'content-type': 'image/jpeg' } });
    expect(await downloadCover('https://covers.openlibrary.org/b/id/1-L.jpg', 'covers/c/b.jpg')).toBeNull();

    await expect(fs.stat(path.join(testEnv.dir, 'covers/c/b.jpg'))).rejects.toThrow();
  });

  it('refuses destination paths escaping the storage root', async () => {
    handler = () => new Response(new Uint8Array(png), { status: 200, headers: { 'content-type': 'image/png' } });
    expect(await downloadCover('https://covers.openlibrary.org/b/id/1-L.jpg', '../../outside.jpg')).toBeNull();
  });
});
