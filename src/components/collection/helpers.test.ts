import { describe, expect, it } from 'vitest';
import { makeSampleBook } from '@/components/books/sample-books';
import { getTranslator } from '@/i18n';
import { ApiClientError } from '@/lib/client/api';
import type { CollectionWithBooksDTO, VideoDTO } from '@/lib/types';
import { apiErrorMessage, errorKey, errorReason, isAbortError, isApiError, isChunkLoadError, isNetworkError } from './errors';
import { computeFacets, filterAuthorFacets, headerCounts } from './facets';
import {
  collectionTitle,
  decadeLabel,
  hungarianDecadeSuffix,
  ownerLine,
  quoteTitle,
  sourceCounts,
  sourcesLabel,
  titleSample,
} from './labels';
import {
  applyBookPatch,
  applyCollectionPatch,
  mainTopicPatch,
  mergeCollectionDTO,
  pruneSelection,
  removeBooks,
  restoreBooks,
  rollbackBookPatch,
  runPool,
  sameCollectionData,
  upsertBook,
} from './mutations';
import { buildSettingsPatch, sanitizePin, settingsFormFrom } from './settings-form';
import { estimatePages } from '@/components/views/data/stats';

const hu = getTranslator('hu');
const en = getTranslator('en');

describe('errors', () => {
  it('prefers details.reason over code', () => {
    const err = new ApiClientError('x', 403, 'forbidden', { reason: 'wrong_pin' });
    expect(errorReason(err)).toBe('wrong_pin');
    expect(errorKey(err)).toBe('wrong_pin');
    expect(isApiError(err, 'wrong_pin')).toBe(true);
    expect(isApiError(err, 'forbidden')).toBe(true);
    expect(apiErrorMessage(err, hu.t)).toBe('Hibás PIN-kód. Próbáld újra.');
    expect(apiErrorMessage(err, en.t)).toBe('Incorrect PIN. Please try again.');
  });

  it('falls back to the code, then to the internal error', () => {
    expect(apiErrorMessage(new ApiClientError('x', 429, 'rate_limited', { reason: 'unknown_reason' }), en.t)).toMatch(/Too many requests/);
    expect(apiErrorMessage(new ApiClientError('x', 500, 'weird'), en.t)).toBe(en.t('errors.internal'));
    expect(apiErrorMessage(new Error('boom'), hu.t)).toBe(hu.t('errors.internal'));
  });

  it('recognises chunk load errors of code-split views', () => {
    const chunk = new Error('Loading chunk 123 failed.');
    expect(isChunkLoadError(chunk)).toBe(true);
    const named = new Error('x');
    named.name = 'ChunkLoadError';
    expect(isChunkLoadError(named)).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /_next/x.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Loading chunk')).toBe(false);
  });

  it('recognises network and abort errors', () => {
    const net = new TypeError('Failed to fetch');
    expect(isNetworkError(net)).toBe(true);
    expect(apiErrorMessage(net, hu.t)).toBe(hu.t('collection.toast.network'));
    expect(isNetworkError(new ApiClientError('x', 500, 'internal'))).toBe(false);
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
  });
});

describe('labels', () => {
  it('builds the display title with fallbacks', () => {
    expect(collectionTitle({ id: '123456789', title: '  A nappali  polc ', ownerName: 'Kovács Anna' }, hu.t)).toBe('A nappali polc');
    expect(collectionTitle({ id: '123456789', title: null, ownerName: 'Kovács Anna' }, hu.t)).toBe('Kovács Anna könyvtára');
    expect(collectionTitle({ id: '123456789', title: '', ownerName: 'Anna Smith' }, en.t)).toBe('Anna Smith’s library');
    expect(collectionTitle({ id: '123456789', title: null, ownerName: '  ' }, hu.t)).toBe('Könyvtár #123456789');
    expect(collectionTitle({ id: '123456789', title: null, ownerName: null }, en.t)).toBe('Library #123456789');
  });

  it('shows the owner line only when it adds information', () => {
    expect(ownerLine({ id: '1', title: 'Polc', ownerName: 'Kovács Anna' }, hu.t)).toBe('Kovács Anna könyvtára');
    expect(ownerLine({ id: '1', title: null, ownerName: 'Kovács Anna' }, hu.t)).toBeNull();
    expect(ownerLine({ id: '1', title: 'Polc', ownerName: null }, hu.t)).toBeNull();
  });

  it('uses Hungarian vowel harmony for decades', () => {
    const cases: [number, 'as' | 'es'][] = [
      [1910, 'es'],
      [1920, 'as'],
      [1930, 'as'],
      [1940, 'es'],
      [1950, 'es'],
      [1960, 'as'],
      [1970, 'es'],
      [1980, 'as'],
      [1990, 'es'],
      [1900, 'as'],
      [1800, 'as'],
      [2000, 'es'],
      [2010, 'es'],
      [2020, 'as'],
    ];
    for (const [decade, suffix] of cases) expect(hungarianDecadeSuffix(decade), String(decade)).toBe(suffix);
    expect(decadeLabel(1960, 'hu', hu.t)).toBe('1960-as évek');
    expect(decadeLabel(1970, 'hu', hu.t)).toBe('1970-es évek');
    expect(decadeLabel(1970, 'en', en.t)).toBe('1970s');
  });

  it('summarises sources', () => {
    const v = (kind: 'video' | 'image', uploadStatus: VideoDTO['uploadStatus'] = 'uploaded') => ({ kind, uploadStatus });
    const list = [v('video'), v('video'), v('image'), v('video', 'failed')];
    expect(sourceCounts(list)).toEqual({ videos: 2, photos: 1 });
    expect(sourcesLabel(list, hu.t, hu.tp)).toBe('2 videóból és 1 fotóból');
    expect(sourcesLabel(list, en.t, en.tp)).toBe('from 2 videos and 1 photo');
    expect(sourcesLabel([v('video')], en.t, en.tp)).toBe('from 1 video');
    expect(sourcesLabel([], en.t, en.tp)).toBeNull();
  });
});

describe('mutations', () => {
  const a = makeSampleBook({ id: 'a', title: 'A', rating: 3, topics: ['poetry'] });
  const b = makeSampleBook({ id: 'b', title: 'B' });
  const c = makeSampleBook({ id: 'c', title: 'C' });

  it('applies and rolls back a patch field by field', () => {
    const optimistic = applyBookPatch(a, { rating: 5, favorite: true, topics: ['history'] });
    expect(optimistic).toMatchObject({ rating: 5, favorite: true, topics: ['history'] });
    // a newer edit changed the rating again – rollback must not clobber it
    const newer = { ...optimistic, rating: 4 };
    const rolled = rollbackBookPatch(newer, a, { rating: 5, favorite: true, topics: ['history'] });
    expect(rolled.rating).toBe(4);
    expect(rolled.favorite).toBe(a.favorite);
    expect(rolled.topics).toEqual(['poetry']);
  });

  it('ignores undefined patch values', () => {
    expect(applyBookPatch(a, { rating: undefined }).rating).toBe(3);
  });

  it('removes and restores books at their positions', () => {
    const { books, removed } = removeBooks([a, b, c], ['a', 'c']);
    expect(books.map((x) => x.id)).toEqual(['b']);
    expect(restoreBooks(books, removed).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    // a book that came back meanwhile (refresh) is not duplicated
    expect(restoreBooks([a, b], removed).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('upserts', () => {
    expect(upsertBook([a, b], { ...b, title: 'B2' }).map((x) => x.title)).toEqual(['A', 'B2']);
    expect(upsertBook([a], c).map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('applies collection patches incl. PIN semantics', () => {
    const col = { id: '1', title: 'x', visibility: 'link', books: [a] } as unknown as CollectionWithBooksDTO;
    expect(applyCollectionPatch(col, { title: 'y' }).title).toBe('y');
    expect(applyCollectionPatch(col, { pin: '1234' }).visibility).toBe('pin');
    expect(applyCollectionPatch({ ...col, visibility: 'pin' }, { pin: null }).visibility).toBe('link');
    expect(applyCollectionPatch({ ...col, visibility: 'pin' }, { pin: '' }).visibility).toBe('pin');
    const merged = mergeCollectionDTO(col, { ...col, title: 'server', bookCount: 99 } as CollectionWithBooksDTO);
    expect(merged.title).toBe('server');
    expect(merged.books).toBe(col.books);
    expect(merged.bookCount).toBe(1);
  });

  it('runPool keeps order, bounds concurrency and never rejects', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5 * (7 - n)));
      inFlight -= 1;
      if (n === 3) throw new Error('three');
      return n * 10;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : 'x'))).toEqual([10, 20, 'x', 40, 50, 60]);
    expect(await runPool([], 4, async () => 1)).toEqual([]);
  });

  it('prunes the selection only when needed', () => {
    const sel = new Set(['a', 'b']);
    expect(pruneSelection(sel, [a, b, c])).toBe(sel);
    expect([...pruneSelection(sel, [a])]).toEqual(['a']);
  });

  it('compares API payloads by value', () => {
    const col = {
      id: '123456789',
      title: 'x',
      isOwner: false,
      updatedAt: '2026-09-12T20:00:00.000Z',
      books: [a, b],
    } as unknown as CollectionWithBooksDTO;
    expect(sameCollectionData(col, col)).toBe(true);
    expect(sameCollectionData(col, JSON.parse(JSON.stringify(col)) as CollectionWithBooksDTO)).toBe(true);
    expect(sameCollectionData(col, { ...col, books: [a, { ...b, rating: 5 }] })).toBe(false);
    expect(sameCollectionData(col, { ...col, books: [a] })).toBe(false);
    expect(sameCollectionData(col, { ...col, isOwner: true })).toBe(false);
    expect(sameCollectionData(col, { ...col, updatedAt: '2026-09-13T00:00:00.000Z' })).toBe(false);
  });

  it('builds the main-topic patch without duplicating the topic', () => {
    expect(mainTopicPatch({ category: 'poetry', topics: [] }, 'poetry')).toBeNull();
    expect(mainTopicPatch({ category: 'history', topics: ['poetry', 'drama'] }, 'poetry')).toEqual({ category: 'poetry', topics: ['drama'] });
    expect(mainTopicPatch({ category: null, topics: ['drama'] }, 'poetry')).toEqual({ category: 'poetry' });
    expect(mainTopicPatch({ category: 'poetry', topics: ['poetry'] }, 'poetry')).toEqual({ category: 'poetry', topics: [] });
  });
});

describe('bulk & PIN helpers', () => {
  it('quotes titles per locale and samples long lists', () => {
    expect(quoteTitle('Abigél', 'hu')).toBe('„Abigél”');
    expect(quoteTitle('Dune', 'en')).toBe('“Dune”');
    const books = ['A', 'B', 'C', 'D'].map((title) => ({ title }));
    expect(titleSample(books, 'hu')).toBe('„A”, „B”, „C” …');
    expect(titleSample(books.slice(0, 2), 'en')).toBe('“A”, “B”');
  });

  it('sanitises PIN input', () => {
    expect(sanitizePin('12 34')).toBe('1234');
    expect(sanitizePin('1234-5678-9')).toBe('12345678');
    expect(sanitizePin('abc')).toBe('');
  });
});

describe('facets', () => {
  const books = [
    makeSampleBook({ id: '1', title: 'Abigél', author: 'Szabó Magda', language: 'hu', firstPublishedYear: 1970, category: 'young_adult', readingStatus: 'read', pageCount: 300, favorite: true }),
    makeSampleBook({ id: '2', title: 'Az ajtó', author: 'Szabó Magda', language: 'HU', firstPublishedYear: 1987, category: 'literary_fiction', topics: ['hungarian_literature'], pageCount: 250 }),
    makeSampleBook({ id: '3', title: 'Dune', author: 'Frank Herbert; Brian Herbert', language: 'en', firstPublishedYear: 1965, category: 'scifi', needsReview: true, reviewed: false, lentTo: 'Péter' }),
    makeSampleBook({ id: '4', title: 'Jegyzetek', author: null, language: null, firstPublishedYear: null, category: null, topics: [] }),
  ];

  it('counts facets', () => {
    const f = computeFacets(books, 'hu');
    expect(f.languages).toEqual([
      { key: 'hu', count: 2 },
      { key: 'en', count: 1 },
    ]);
    expect(f.decades).toEqual([
      { key: 1960, count: 1 },
      { key: 1970, count: 1 },
      { key: 1980, count: 1 },
    ]);
    expect(f.authors[0]).toEqual({ key: 'Szabó Magda', count: 2 });
    expect(f.pendingReview).toBe(1);
    expect(f.favorites).toBe(1);
    expect(f.lent).toBe(1);
    expect(f.statuses.find((s) => s.key === 'read')?.count).toBe(1);
    expect(f.topics.find((t) => t.key === 'other')?.count).toBe(1);
  });

  it('computes header counts', () => {
    const counts = headerCounts(books);
    expect(counts).toMatchObject({ books: 4, authors: 3, topics: 4 });
    // pages use the same estimate as the Stats view (known pages + an estimate per unknown book)
    const estimate = estimatePages(books);
    expect(counts.pages).toBe(estimate.total);
    expect(counts.pagesEstimated).toBe(estimate.isEstimate);
    expect(counts.pages).toBeGreaterThanOrEqual(550);
  });

  it('searches author facets accent-insensitively', () => {
    const f = computeFacets(books, 'hu');
    expect(filterAuthorFacets(f.authors, 'szabo').map((a) => a.key)).toEqual(['Szabó Magda']);
    expect(filterAuthorFacets(f.authors, '').length).toBe(f.authors.length);
  });
});

describe('settings form', () => {
  const original = {
    title: 'Nappali',
    description: null,
    ownerName: 'Kovács Anna',
    email: 'anna@example.com',
    locale: 'hu' as const,
    visibility: 'link' as const,
  };

  it('sends only changed fields', () => {
    const form = settingsFormFrom(original);
    expect(buildSettingsPatch(original, form)).toEqual({ patch: {}, errors: {} });
    const { patch, errors } = buildSettingsPatch(original, {
      ...form,
      title: '  Dolgozószoba  ',
      description: 'Első sor  \r\nMásodik',
      ownerName: '',
      email: 'ANNA@example.com',
      locale: 'en',
    });
    expect(errors).toEqual({});
    expect(patch).toEqual({ title: 'Dolgozószoba', description: 'Első sor\nMásodik', ownerName: null, locale: 'en' });
  });

  it('validates e-mail and lengths', () => {
    const form = settingsFormFrom(original);
    const { patch, errors } = buildSettingsPatch(original, { ...form, email: 'nem-email', title: 'x'.repeat(201) });
    expect(errors.email?.key).toBe('collection.email.invalid');
    expect(errors.title?.key).toBe('collection.settings.titleTooLong');
    expect(patch).toEqual({});
    expect(buildSettingsPatch(original, { ...form, email: '' }).patch).toEqual({ email: null });
  });

  it('follows the PIN rules of the API', () => {
    const form = settingsFormFrom(original);
    expect(buildSettingsPatch(original, { ...form, visibility: 'pin' }).errors.pin?.key).toBe('collection.settings.pinRequired');
    expect(buildSettingsPatch(original, { ...form, visibility: 'pin', pin: '12a4' }).errors.pin?.key).toBe('collection.settings.pinFormat');
    expect(buildSettingsPatch(original, { ...form, visibility: 'pin', pin: ' 123456 ' }).patch).toEqual({ visibility: 'pin', pin: '123456' });

    const locked = { ...original, visibility: 'pin' as const };
    const lockedForm = settingsFormFrom(locked);
    expect(buildSettingsPatch(locked, lockedForm)).toEqual({ patch: {}, errors: {} });
    expect(buildSettingsPatch(locked, { ...lockedForm, pin: '9876' }).patch).toEqual({ visibility: 'pin', pin: '9876' });
    expect(buildSettingsPatch(locked, { ...lockedForm, visibility: 'link', pin: '9876' }).patch).toEqual({ visibility: 'link' });
  });
});
