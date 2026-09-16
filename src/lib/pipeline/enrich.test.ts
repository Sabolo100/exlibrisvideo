import fs from 'node:fs/promises';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const base = (process.env.TEMP || process.env.TMPDIR || '/tmp').replace(/\\/g, '/');
  const dir = `${base}/exl-enrich-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.STORAGE_DIR = dir;
  return { dir, enrichCovers: true };
});

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return { ...actual, env: () => ({ ...actual.env(), ENRICH_COVERS: h.enrichCovers }) };
});

const ai = vi.hoisted(() => ({ classify: vi.fn(), judge: vi.fn() }));
vi.mock('@/lib/ai', () => ({
  getTextProvider: () => ({ name: 'mock', model: 'test-model', classifyBooks: ai.classify, judgeDuplicates: ai.judge }),
}));
vi.mock('@/lib/ai/usage', () => ({ recordUsage: vi.fn(async () => {}) }));
vi.mock('./covers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./covers')>();
  return { ...actual, findCover: vi.fn(async () => null), downloadCover: vi.fn(async () => null) };
});

import { db, pool } from '@/db';
import { books, collections, type BookRow } from '@/db/schema';
import type { BookClassification, BookForClassification } from '@/lib/ai/types';
import { recordUsage } from '@/lib/ai/usage';
import { abs, rel } from '@/lib/storage';
import { downloadCover, findCover, type CoverMatch } from './covers';
import {
  authorUpgrade,
  cleanDescription,
  enrichCollection,
  normalizeCountryCode,
  normalizeLanguageCode,
  normalizeYear,
  planClassificationPatch,
  planCoverPatch,
  sanitizeTopics,
} from './enrich';

/* ------------------------------------------------------------------ */
/* pure helpers                                                        */
/* ------------------------------------------------------------------ */

function cls(over: Partial<BookClassification> = {}): BookClassification {
  return {
    id: 'b',
    category: 'other',
    topics: [],
    author: null,
    originalTitle: null,
    language: null,
    originalLanguage: null,
    authorCountry: null,
    firstPublishedYear: null,
    descriptionHu: null,
    descriptionEn: null,
    ...over,
  };
}

type Fields = Parameters<typeof planClassificationPatch>[0];
function book(over: Partial<Fields> = {}): Fields {
  return {
    title: 'Könyv',
    author: null,
    spineAuthor: null,
    category: null,
    topics: [],
    originalTitle: null,
    language: null,
    originalLanguage: null,
    authorCountry: null,
    firstPublishedYear: null,
    descriptionHu: null,
    descriptionEn: null,
    isbn: null,
    pageCount: null,
    enrichment: null,
    reviewed: false,
    ...over,
  };
}

describe('normalisers', () => {
  it('language codes', () => {
    expect(normalizeLanguageCode('hu')).toBe('hu');
    expect(normalizeLanguageCode('HU-hu')).toBe('hu');
    expect(normalizeLanguageCode('hun')).toBe('hu');
    expect(normalizeLanguageCode('ger')).toBe('de');
    expect(normalizeLanguageCode('Hungarian')).toBe('hu');
    expect(normalizeLanguageCode('német')).toBe('de');
    expect(normalizeLanguageCode('xyz')).toBeNull();
    expect(normalizeLanguageCode('')).toBeNull();
    expect(normalizeLanguageCode(42)).toBeNull();
  });

  it('country codes fit the 2-character column', () => {
    expect(normalizeCountryCode('hu')).toBe('HU');
    expect(normalizeCountryCode('HUN')).toBe('HU');
    expect(normalizeCountryCode('UK')).toBe('GB');
    expect(normalizeCountryCode('USA')).toBe('US');
    expect(normalizeCountryCode('Hungary')).toBeNull();
    expect(normalizeCountryCode(null)).toBeNull();
  });

  it('years', () => {
    const now = new Date('2026-09-13T00:00:00Z');
    expect(normalizeYear(1869, now)).toBe(1869);
    expect(normalizeYear('1975', now)).toBe(1975);
    expect(normalizeYear(-44, now)).toBe(-44);
    expect(normalizeYear(2027, now)).toBe(2027);
    expect(normalizeYear(2030, now)).toBeNull();
    expect(normalizeYear(0, now)).toBeNull();
    expect(normalizeYear(1999.5, now)).toBeNull();
    expect(normalizeYear('kb. 1900', now)).toBeNull();
  });

  it('descriptions are capped at 200 characters on a word boundary', () => {
    expect(cleanDescription('  Rövid   leírás. ')).toBe('Rövid leírás.');
    const long = 'Ez egy nagyon hosszú leírás, amely többször is elmondja ugyanazt. '.repeat(6);
    const out = cleanDescription(long)!;
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
    expect(cleanDescription('   ')).toBeNull();
  });

  it('topics: unknown keys become "other", category never repeated, max 3', () => {
    expect(sanitizeTopics('scifi', ['history', 'nonsense', 'scifi', 'history', 'art', 'music'])).toEqual({
      category: 'scifi',
      topics: ['history', 'other', 'art'],
    });
    expect(sanitizeTopics('made_up', null)).toEqual({ category: 'other', topics: [] });
    expect(sanitizeTopics(' Literary-Fiction ', ['other'])).toEqual({ category: 'literary_fiction', topics: ['other'] });
    expect(sanitizeTopics(undefined, ['poetry'])).toEqual({ category: 'other', topics: ['poetry'] });
  });
});

describe('authorUpgrade', () => {
  it('completes partial readings of the same person', () => {
    expect(authorUpgrade('HAMANN', 'Brigitte Hamann')).toBe(true);
    expect(authorUpgrade('H. Perruchot', 'Henri Perruchot')).toBe(true);
    expect(authorUpgrade('ESTERHAZY PETER', 'Esterházy Péter')).toBe(true);
    expect(authorUpgrade('Esterhazy Peter', 'Esterházy Péter')).toBe(true);
    expect(authorUpgrade('Tolsztoj', 'Lev Tolsztoj')).toBe(true);
    expect(authorUpgrade('Salamon Gábor', 'Salamon Gábor; Zalotay Melinda')).toBe(true);
    expect(authorUpgrade('Esterhazi Péter', 'Esterházy Péter')).toBe(true);
  });

  it('never swaps people, reorders names or downgrades', () => {
    expect(authorUpgrade('Esterházy Péter', 'Nádas Péter')).toBe(false);
    expect(authorUpgrade('Colin Simpson', 'Colin Wilson')).toBe(false);
    expect(authorUpgrade('Esterházy Péter', 'Péter Esterházy')).toBe(false);
    expect(authorUpgrade('Henri Perruchot', 'H. Perruchot')).toBe(false);
    expect(authorUpgrade('Brigitte Hamann', 'Hamann')).toBe(false);
    expect(authorUpgrade('Elena Ferrante', 'Elena Ferrante')).toBe(false);
    expect(authorUpgrade('Esterházy Péter', 'ESTERHÁZY PÉTER')).toBe(false);
  });
});

describe('planClassificationPatch', () => {
  it('fills empty fields, validates values and recomputes the author sort key', () => {
    const patch = planClassificationPatch(
      book({ title: 'Rudolf, a trónörökös', author: 'HAMANN', spineAuthor: 'HAMANN' }),
      cls({
        category: 'biography',
        topics: ['history', 'unknown_key'],
        author: 'Brigitte Hamann',
        originalTitle: 'Rudolf, Kronprinz und Rebell',
        language: 'hun',
        originalLanguage: 'German',
        authorCountry: 'aut',
        firstPublishedYear: 1978,
        descriptionHu: 'Rudolf trónörökös életrajza.',
        descriptionEn: 'A biography of Crown Prince Rudolf.',
      }),
    );
    expect(patch).toEqual({
      category: 'biography',
      topics: ['history', 'other'],
      author: 'Brigitte Hamann',
      authorSort: 'hamann brigitte',
      originalTitle: 'Rudolf, Kronprinz und Rebell',
      language: 'hu',
      originalLanguage: 'de',
      authorCountry: 'AT',
      firstPublishedYear: 1978,
      descriptionHu: 'Rudolf trónörökös életrajza.',
      descriptionEn: 'A biography of Crown Prince Rudolf.',
    });
  });

  it('never overwrites existing values or owner-edited fields, but still fills the rest', () => {
    const b = book({
      title: 'Régi magyar mondák',
      author: 'Lengyel Dénes',
      category: 'folk_tales',
      language: null,
      reviewed: true,
      enrichment: { userEdited: true, userEditedFields: ['title', 'author', 'category', 'topics'] },
      firstPublishedYear: 1972,
    });
    const patch = planClassificationPatch(
      b,
      cls({
        category: 'hungarian_literature',
        topics: ['history'],
        author: 'Lengyel Dénes Ferenc',
        language: 'hu',
        firstPublishedYear: 1990,
        originalTitle: 'Régi magyar mondák',
        descriptionHu: 'Magyar mondák gyűjteménye.',
      }),
    );
    expect(patch).toEqual({ language: 'hu', authorSort: 'lengyel denes', descriptionHu: 'Magyar mondák gyűjteménye.' });
  });

  it('language change alone recomputes authorSort; reviewed books keep their author spelling', () => {
    const patch = planClassificationPatch(
      book({ author: 'HAMANN', reviewed: true }),
      cls({ author: 'Brigitte Hamann', language: 'de' }),
    );
    expect(patch.author).toBeUndefined();
    expect(patch.language).toBe('de');
    expect(patch.authorSort).toBe('hamann');
  });

  it('a missing author is filled only when the spine reading does not contradict it', () => {
    expect(planClassificationPatch(book({ author: null, spineAuthor: null }), cls({ author: 'Szabó Magda' })).author).toBe('Szabó Magda');
    expect(planClassificationPatch(book({ author: null, spineAuthor: 'Rejtő' }), cls({ author: 'Szabó Magda' })).author).toBeUndefined();
    expect(planClassificationPatch(book({ author: null }), cls({ author: 'LENGYEL DÉNES' })).author).toBe('Lengyel Dénes');
  });

  it('legacy userEdited without a list protects all bibliographic fields only', () => {
    const patch = planClassificationPatch(
      book({ enrichment: { userEdited: true } }),
      cls({ category: 'poetry', language: 'hu', authorCountry: 'HU', descriptionEn: 'Poems.' }),
    );
    expect(patch).toEqual({ authorCountry: 'HU', descriptionEn: 'Poems.' });
  });
});

describe('planCoverPatch', () => {
  const match: CoverMatch = {
    url: 'https://covers.openlibrary.org/b/id/1-L.jpg',
    source: 'openlibrary',
    isbn: '9789631103489',
    pageCount: 249,
    firstPublishYear: 1972,
    matchedTitle: 'Régi magyar mondák',
    matchedAuthors: ['Lengyel, Dénes.'],
    titleScore: 1,
    via: 'title_author',
  };

  it('sets cover fields and fills identifiers where empty', () => {
    expect(planCoverPatch(book(), match, { path: 'covers/1/b.jpg', width: 300, height: 500, bytes: 1000 })).toEqual({
      coverUrl: match.url,
      coverPath: 'covers/1/b.jpg',
      isbn: '9789631103489',
      pageCount: 249,
      firstPublishedYear: 1972,
    });
  });

  it('respects existing and owner-edited values', () => {
    const b = book({ isbn: null, pageCount: 100, enrichment: { userEdited: true, userEditedFields: ['isbn', 'firstPublishedYear'] } });
    expect(planCoverPatch(b, match, null)).toEqual({ coverUrl: match.url });
  });
});

/* ------------------------------------------------------------------ */
/* enrichCollection against PostgreSQL                                 */
/* ------------------------------------------------------------------ */

const dbAvailable = await pool()
  .query('SELECT 1 FROM books LIMIT 1')
  .then(() => true)
  .catch(() => false);

const createdCollections: string[] = [];

async function newCollection(locale: 'hu' | 'en' = 'hu'): Promise<string> {
  const id = String(100000000 + Math.floor(Math.random() * 899999999));
  await db().insert(collections).values({ id, ownerTokenHash: 'test', locale, status: 'processing' });
  createdCollections.push(id);
  return id;
}

async function addBook(collectionId: string, over: Partial<typeof books.$inferInsert>): Promise<BookRow> {
  const [row] = await db()
    .insert(books)
    .values({ collectionId, title: 'Könyv', ...over })
    .returning();
  return row;
}

async function getBook(id: string): Promise<BookRow | undefined> {
  const [row] = await db().select().from(books).where(eq(books.id, id));
  return row;
}

describe.skipIf(!dbAvailable)('enrichCollection (PostgreSQL)', () => {
  beforeAll(async () => {
    await fs.mkdir(h.dir, { recursive: true });
  });

  afterAll(async () => {
    if (createdCollections.length) await db().delete(collections).where(inArray(collections.id, createdCollections));
    await fs.rm(h.dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    ai.classify.mockReset();
    vi.mocked(recordUsage).mockClear();
    vi.mocked(findCover).mockReset();
    vi.mocked(downloadCover).mockReset();
    vi.mocked(findCover).mockResolvedValue(null);
    vi.mocked(downloadCover).mockResolvedValue(null);
    h.enrichCovers = true;
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('classifies, completes authors, respects owner edits per field and stores covers', async () => {
    const cid = await newCollection();
    const hamann = await addBook(cid, { title: 'Rudolf, a trónörökös', author: 'HAMANN', spineAuthor: 'HAMANN', shelfPosition: 1 });
    const manual = await addBook(cid, {
      title: 'Régi magyar mondák',
      author: 'Lengyel Dénes',
      category: 'folk_tales',
      source: 'manual',
      reviewed: true,
      shelfPosition: 2,
      enrichment: { userEdited: true, userEditedFields: ['title', 'author', 'category'] },
    });
    const edited = await addBook(cid, {
      title: 'Pápai vizeken ne kalózkodj!',
      author: 'Esterházy Péter',
      isbn: '9789632704789',
      shelfPosition: 3,
      enrichment: { userEdited: true, userEditedFields: ['isbn'] },
    });
    const unknown = await addBook(cid, { title: 'Ismeretlen könyv', shelfPosition: 4 });
    const done = await addBook(cid, { title: 'Már kész', shelfPosition: 5, enrichedAt: new Date('2026-01-01T00:00:00Z'), category: 'poetry' });
    const vanishing = await addBook(cid, { title: 'Eltűnő könyv', author: 'Kiss Anna', shelfPosition: 6 });

    ai.classify.mockImplementation(async (input: BookForClassification[], ctx: { locale: string }) => {
      expect(ctx.locale).toBe('hu');
      const results: BookClassification[] = input.map((b) => {
        switch (b.id) {
          case hamann.id:
            return cls({ id: b.id, category: 'biography', topics: ['history'], author: 'Brigitte Hamann', language: 'hu', originalLanguage: 'de', authorCountry: 'AT', firstPublishedYear: 1978, originalTitle: 'Rudolf, Kronprinz und Rebell' });
          case manual.id:
            return cls({ id: b.id, category: 'hungarian_literature', topics: ['folk_tales', 'history'], author: 'Dénes Lengyel', language: 'hu' });
          case edited.id:
            return cls({ id: b.id, category: 'hungarian_literature', author: 'Nádas Péter', firstPublishedYear: 1977, language: 'hu' });
          case unknown.id:
            return cls({ id: b.id, category: 'nonsense_key', topics: ['bogus'] });
          default:
            return cls({ id: b.id, category: 'literary_fiction' });
        }
      });
      return { results, usage: { provider: 'mock', model: 'test-model', inputTokens: 100, outputTokens: 50, estCostUsd: 0.001 } };
    });

    vi.mocked(findCover).mockImplementation(async (q) => {
      if (q.title === 'Rudolf, a trónörökös') {
        expect(q).toMatchObject({ author: 'Brigitte Hamann', language: 'hu', originalLanguage: 'de', originalTitle: 'Rudolf, Kronprinz und Rebell' });
        return { url: 'https://covers.openlibrary.org/b/id/6783670-L.jpg', source: 'openlibrary', isbn: '9789630000000', pageCount: 535, firstPublishYear: 1978, matchedTitle: 'Rudolf', matchedAuthors: ['Brigitte Hamann'], titleScore: 0.9, via: 'original_title' } satisfies CoverMatch;
      }
      if (q.title === 'Pápai vizeken ne kalózkodj!') {
        return { url: 'https://books.google.com/books/content?id=x&img=1', source: 'google', isbn: '9780000000002', pageCount: 211, matchedTitle: q.title, matchedAuthors: ['Péter Esterházy'], titleScore: 1, via: 'title_author' } satisfies CoverMatch;
      }
      if (q.title === 'Eltűnő könyv') {
        await db().delete(books).where(eq(books.id, vanishing.id));
        return { url: 'https://covers.openlibrary.org/b/id/5-L.jpg', source: 'openlibrary', matchedTitle: q.title, matchedAuthors: ['Kiss Anna'], titleScore: 1, via: 'title_author' } satisfies CoverMatch;
      }
      return null;
    });
    vi.mocked(downloadCover).mockImplementation(async (url, destRel) => {
      if (url.includes('books.google.com')) return null; // download failure: external URL still stored
      const full = abs(destRel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, 'jpeg');
      return { path: destRel, width: 300, height: 500, bytes: 4 };
    });

    const fractions: number[] = [];
    const res = await enrichCollection(cid, (f) => {
      fractions.push(f);
    });

    expect(res).toEqual({ enriched: 4, covers: 2 });
    expect(ai.classify).toHaveBeenCalledTimes(1);
    const sentIds = (ai.classify.mock.calls[0][0] as BookForClassification[]).map((b) => b.id);
    expect(sentIds).toEqual([hamann.id, manual.id, edited.id, unknown.id, vanishing.id]);
    expect(recordUsage).toHaveBeenCalledWith(cid, expect.objectContaining({ inputTokens: 100 }));
    expect(fractions[fractions.length - 1]).toBe(1);
    for (let i = 1; i < fractions.length; i++) expect(fractions[i]).toBeGreaterThan(fractions[i - 1]);

    const h1 = (await getBook(hamann.id))!;
    expect(h1).toMatchObject({
      author: 'Brigitte Hamann',
      authorSort: 'hamann brigitte',
      category: 'biography',
      topics: ['history'],
      language: 'hu',
      originalLanguage: 'de',
      authorCountry: 'AT',
      firstPublishedYear: 1978,
      originalTitle: 'Rudolf, Kronprinz und Rebell',
      coverUrl: 'https://covers.openlibrary.org/b/id/6783670-L.jpg',
      coverPath: rel.cover(cid, hamann.id),
      pageCount: 535,
      isbn: null, // never taken from an original-title (other edition) record
    });
    expect(h1.enrichedAt).toBeInstanceOf(Date);
    const hEnrichment = h1.enrichment as Record<string, unknown>;
    expect(hEnrichment.classification).toMatchObject({ provider: 'mock', model: 'test-model', category: 'biography' });
    expect(hEnrichment.cover).toMatchObject({ source: 'openlibrary', via: 'original_title', localPath: rel.cover(cid, hamann.id) });

    const m1 = (await getBook(manual.id))!;
    expect(m1).toMatchObject({ title: 'Régi magyar mondák', author: 'Lengyel Dénes', category: 'folk_tales', topics: ['history'], language: 'hu' });
    expect(m1.enrichedAt).toBeInstanceOf(Date);
    expect(m1.enrichment).toMatchObject({ userEdited: true, userEditedFields: ['title', 'author', 'category'], cover: null });
    expect(vi.mocked(findCover).mock.calls.some(([q]) => q.title === 'Régi magyar mondák')).toBe(true);

    const e1 = (await getBook(edited.id))!;
    expect(e1).toMatchObject({
      author: 'Esterházy Péter',
      isbn: '9789632704789',
      pageCount: 211,
      firstPublishedYear: 1977,
      category: 'hungarian_literature',
      coverUrl: 'https://books.google.com/books/content?id=x&img=1',
      coverPath: null,
    });

    const u1 = (await getBook(unknown.id))!;
    expect(u1).toMatchObject({ category: 'other', topics: [], coverUrl: null });
    expect(u1.enrichedAt).toBeInstanceOf(Date);
    expect((u1.enrichment as Record<string, unknown>).coverCheckedAt).toEqual(expect.any(String));

    const d1 = (await getBook(done.id))!;
    expect(d1.enrichedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(d1.enrichment).toBeNull();

    expect(await getBook(vanishing.id)).toBeUndefined();
    await expect(fs.stat(abs(rel.cover(cid, vanishing.id)))).rejects.toThrow();

    // second run: nothing left to do
    ai.classify.mockClear();
    const again = await enrichCollection(cid);
    expect(again).toEqual({ enriched: 0, covers: 0 });
    expect(ai.classify).not.toHaveBeenCalled();
  });

  it('batches of 40, one retry per batch, continues without classification and still marks books enriched', async () => {
    h.enrichCovers = false;
    const cid = await newCollection('en');
    for (let i = 0; i < 45; i++) await addBook(cid, { title: `Könyv ${i + 1}. kötet`, shelfPosition: i });
    let call = 0;
    ai.classify.mockImplementation(async (input: BookForClassification[], ctx: { locale: string }) => {
      call++;
      expect(ctx.locale).toBe('en');
      if (call === 1) throw new Error('temporary outage');
      if (input.length === 5) throw new Error('still failing');
      return {
        results: input.map((b) => cls({ id: b.id, category: 'education' })),
        usage: { provider: 'mock', model: 'test-model', inputTokens: 1, outputTokens: 1, estCostUsd: 0 },
      };
    });
    const res = await enrichCollection(cid);
    expect(res).toEqual({ enriched: 45, covers: 0 });
    expect(ai.classify.mock.calls.map((c) => (c[0] as unknown[]).length)).toEqual([40, 40, 5, 5]);
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(findCover).not.toHaveBeenCalled();
    const rows = await db().select().from(books).where(eq(books.collectionId, cid));
    expect(rows.filter((r) => r.category === 'education')).toHaveLength(40);
    expect(rows.filter((r) => r.category === null)).toHaveLength(5);
    expect(rows.every((r) => r.enrichedAt instanceof Date)).toBe(true);
  });

  it('unknown collection or nothing to do', async () => {
    const progress = vi.fn();
    expect(await enrichCollection('000000000', progress)).toEqual({ enriched: 0, covers: 0 });
    expect(progress).toHaveBeenLastCalledWith(1);
    const cid = await newCollection();
    expect(await enrichCollection(cid)).toEqual({ enriched: 0, covers: 0 });
  });
});
