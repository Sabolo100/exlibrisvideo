import { describe, expect, it } from 'vitest';
import { makeSampleBook, SAMPLE_BOOKS } from '@/components/books/sample-books';
import { seededRandom } from '@/lib/book-utils';
import type { BookDTO } from '@/lib/types';
import {
  categorySlices,
  centuryParts,
  computeStats,
  countryCounts,
  dailySeed,
  englishOrdinal,
  estimatePages,
  fitRow,
  funFacts,
  languageCounts,
  MAX_CATEGORY_SLICES,
  MAX_DECADE_COLUMNS,
  mostCommonTitleWord,
  NONE_SLICE,
  OTHER_SLICE,
  percent,
  pickFromPool,
  recognitionQuality,
  recommendationPool,
  shelfLengthCm,
  shuffleRow,
  splitDays,
  statusCounts,
  translationStats,
  unreadPool,
  yearHistogram,
} from './stats';

const book = (p: Partial<BookDTO> & { title?: string } = {}) => makeSampleBook({ title: 'Cím', ...p });

describe('percent / share helpers', () => {
  it('never shows 0 % for something or 100 % for a part', () => {
    expect(percent(0, 10)).toBe(0);
    expect(percent(1, 1000)).toBe(1);
    expect(percent(999, 1000)).toBe(99);
    expect(percent(10, 10)).toBe(100);
    expect(percent(3, 0)).toBe(0);
  });

  it('shelf length uses 2.7 cm per book', () => {
    expect(shelfLengthCm(0)).toBe(0);
    expect(shelfLengthCm(100)).toBe(270);
    expect(shelfLengthCm(3)).toBe(8.1);
  });

  it('splits days into years and days', () => {
    expect(splitDays(0)).toEqual({ years: 0, days: 0 });
    expect(splitDays(364.2)).toEqual({ years: 1, days: 0 });
    expect(splitDays(12)).toEqual({ years: 0, days: 12 });
    expect(splitDays(800)).toEqual({ years: 2, days: 70 });
  });
});

describe('estimatePages', () => {
  it('uses the default for unknown pages when fewer than 3 books have a count', () => {
    const e = estimatePages([book({ pageCount: 100 }), book({ pageCount: null }), book()]);
    expect(e).toMatchObject({ known: 100, knownBooks: 1, perUnknownBook: 250, total: 600, isEstimate: true });
  });

  it('uses the median of known counts and ignores nonsense values', () => {
    const e = estimatePages([
      book({ pageCount: 100 }),
      book({ pageCount: 300 }),
      book({ pageCount: 1100 }),
      book({ pageCount: -4 }),
      book({ pageCount: Number.NaN }),
    ]);
    expect(e.knownBooks).toBe(3);
    expect(e.perUnknownBook).toBe(300);
    expect(e.total).toBe(1500 + 2 * 300);
  });

  it('is exact when every book has a page count', () => {
    expect(estimatePages([book({ pageCount: 120 })])).toMatchObject({ total: 120, isEstimate: false });
    expect(estimatePages([])).toMatchObject({ total: 0, isEstimate: false });
  });
});

describe('categorySlices', () => {
  it('assigns colour slots by rank in the palette set and folds the tail', () => {
    const keys = ['poetry', 'drama', 'history', 'science', 'art', 'music', 'travel', 'cooking', 'humor'];
    const all: BookDTO[] = [];
    keys.forEach((k, i) => {
      for (let n = 0; n < keys.length - i; n++) all.push(book({ category: k }));
    });
    all.push(book({ category: null, topics: [] }));
    const slices = categorySlices(all, all, 'hu');
    expect(slices.filter((s) => s.slot !== null)).toHaveLength(MAX_CATEGORY_SLICES);
    expect(slices[0]).toMatchObject({ key: 'poetry', slot: 0, count: 9 });
    const other = slices.find((s) => s.key === OTHER_SLICE);
    expect(other).toMatchObject({ count: 3 + 2 + 1, members: ['travel', 'cooking', 'humor'] });
    expect(slices[slices.length - 1]).toMatchObject({ key: NONE_SLICE, count: 1 });
    expect(slices.reduce((s, x) => s + x.count, 0)).toBe(all.length);
  });

  it('keeps colours stable when a filtered subset changes the ranking', () => {
    const all = [
      ...Array.from({ length: 5 }, () => book({ category: 'poetry' })),
      ...Array.from({ length: 3 }, () => book({ category: 'drama' })),
    ];
    const subset = [...all.slice(5), all[0]];
    const slices = categorySlices(subset, all, 'hu');
    expect(slices.find((s) => s.key === 'drama')?.slot).toBe(1);
    expect(slices.find((s) => s.key === 'poetry')?.slot).toBe(0);
    expect(slices[0].key).toBe('drama'); // ordered by count in the subset
  });

  it('falls back to the first topic when the category is missing', () => {
    const slices = categorySlices([book({ category: null, topics: ['scifi'] })]);
    expect(slices).toEqual([{ key: 'scifi', count: 1, share: 1, slot: 0, members: ['scifi'] }]);
  });
});

describe('languages & countries', () => {
  it('counts languages and unknowns', () => {
    const r = languageCounts([book({ language: 'HU' }), book({ language: 'hu' }), book({ language: 'en' }), book({ language: null })], 'language');
    expect(r.entries).toEqual([
      { key: 'hu', count: 2, share: 0.5 },
      { key: 'en', count: 1, share: 0.25 },
    ]);
    expect(r.unknown).toBe(1);
  });

  it('counts translations among books with both languages known', () => {
    expect(
      translationStats([
        book({ language: 'hu', originalLanguage: 'en' }),
        book({ language: 'hu', originalLanguage: 'HU' }),
        book({ language: 'en-GB', originalLanguage: 'en' }),
        book({ language: 'hu', originalLanguage: null }),
        book({ language: null, originalLanguage: 'ru' }),
      ]),
    ).toEqual({ translated: 1, known: 3, share: 1 / 3 });
    expect(translationStats([])).toEqual({ translated: 0, known: 0, share: 0 });
  });

  it('counts distinct first authors per country', () => {
    const r = countryCounts([
      book({ author: 'Szabó Magda', authorCountry: 'hu' }),
      book({ author: 'Szabó Magda', authorCountry: 'HU' }),
      book({ author: 'Márai Sándor', authorCountry: 'HU' }),
      book({ author: 'Terry Pratchett; Neil Gaiman', authorCountry: 'UK' }),
      book({ author: 'Szabó Magda', authorCountry: null }),
      book({ author: 'Ismeretlen', authorCountry: 'XYZ' }),
    ]);
    expect(r.entries).toEqual([
      { code: 'HU', authors: 2, books: 3 },
      { code: 'GB', authors: 1, books: 1 },
    ]);
    expect(r.unknownAuthors).toBe(1);
  });
});

describe('yearHistogram', () => {
  it('builds contiguous decades for a narrow span', () => {
    const { buckets, unknown } = yearHistogram([
      book({ firstPublishedYear: 1961 }),
      book({ firstPublishedYear: 1968 }),
      book({ firstPublishedYear: 1990 }),
      book({ firstPublishedYear: null }),
    ]);
    expect(unknown).toBe(1);
    expect(buckets.map((b) => [b.key, b.count])).toEqual([
      ['d1960', 2],
      ['d1970', 0],
      ['d1980', 0],
      ['d1990', 1],
    ]);
  });

  it('groups old books per century when the span is too wide', () => {
    const { buckets } = yearHistogram([
      book({ firstPublishedYear: -400 }),
      book({ firstPublishedYear: 1605 }),
      book({ firstPublishedYear: 1615 }),
      book({ firstPublishedYear: 1857 }),
      book({ firstPublishedYear: 1925 }),
      book({ firstPublishedYear: 2021 }),
    ]);
    const decades = buckets.filter((b) => b.kind === 'decade');
    const centuries = buckets.filter((b) => b.kind === 'century');
    expect(decades.length).toBeLessThanOrEqual(MAX_DECADE_COLUMNS);
    expect(decades[0].start % 100).toBe(0);
    expect(decades[decades.length - 1]).toMatchObject({ start: 2020, count: 1 });
    expect(centuries.map((c) => [c.start, c.count])).toEqual([
      [-400, 1],
      [1600, 2],
      [1800, 1],
    ]);
    expect(centuries[1].decades).toEqual([1600, 1610]);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(6);
  });

  it('is empty without years', () => {
    expect(yearHistogram([book()])).toEqual({ buckets: [], unknown: 1 });
  });

  it('labels centuries', () => {
    expect(centuryParts(1800)).toEqual({ number: 19, bc: false });
    expect(centuryParts(1900)).toEqual({ number: 20, bc: false });
    expect(centuryParts(0)).toEqual({ number: 1, bc: false });
    expect(centuryParts(-400)).toEqual({ number: 5, bc: true });
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(englishOrdinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st',
    ]);
  });
});

describe('reading status & recognition', () => {
  it('counts statuses', () => {
    expect(statusCounts([book({ readingStatus: 'read' }), book({ readingStatus: 'read' }), book()])).toEqual({
      unknown: 1,
      read: 2,
      reading: 0,
      to_read: 0,
      abandoned: 0,
    });
  });

  it('buckets confidence and averages recognised books only', () => {
    const q = recognitionQuality([
      book({ confidence: 0 }),
      book({ confidence: 0.2 }),
      book({ confidence: 0.59, needsReview: true }),
      book({ confidence: 0.6, needsReview: true, reviewed: true }),
      book({ confidence: 0.8 }),
      book({ confidence: 1, source: 'manual' }),
    ]);
    expect(q.buckets.map((b) => b.count)).toEqual([1, 1, 1, 1, 2]);
    expect(q.buckets.map((b) => b.level)).toEqual(['low', 'low', 'low', 'medium', 'high']);
    expect(q.average).toBeCloseTo((0 + 0.2 + 0.59 + 0.6 + 0.8) / 5, 5);
    expect(q.pendingReview).toBe(1);
    expect(q.reviewed).toBe(1);
    expect(q.bySource).toEqual({ video: 5, image: 0, manual: 1 });
  });
});

describe('fun facts', () => {
  it('finds the most common title word ignoring stop words, case and repeats in one title', () => {
    const books = [
      book({ title: 'A kert és a ház' }),
      book({ title: 'Kert, kert, kert' }),
      book({ title: 'The Secret Garden' }),
      book({ title: 'Garden of the Night' }),
      book({ title: 'Az éjszaka kertje' }),
      book({ title: 'Kert a Duna mellett' }),
    ];
    expect(mostCommonTitleWord(books, 'hu')).toEqual({ word: 'kert', count: 3 });
    expect(mostCommonTitleWord(books.slice(2, 4), 'en')).toEqual({ word: 'garden', count: 2 });
  });

  it('prefers the longer word on ties and returns null when nothing repeats', () => {
    expect(mostCommonTitleWord([book({ title: 'Nap és hold' }), book({ title: 'Hold, nap' })])).toEqual({ word: 'hold', count: 2 });
    expect(mostCommonTitleWord([book({ title: 'Egy' }), book({ title: 'Kettő' })])).toBeNull();
    expect(mostCommonTitleWord([book({ title: 'The and of' }), book({ title: 'The and of' })])).toBeNull();
    expect(mostCommonTitleWord([book({ title: '1984' }), book({ title: '1984' })])).toBeNull();
  });

  it('computes oldest, newest, longest title and reading time', () => {
    const old = book({ title: 'Régi', firstPublishedYear: 1850, pageCount: 300 });
    const recent = book({ title: 'Új', firstPublishedYear: 2020, pageCount: 90, readingStatus: 'read' });
    const long = book({ title: 'Egy nagyon hosszú cím, amely mindent visz', pageCount: 60 });
    const f = funFacts([recent, long, old], 'hu');
    expect(f.oldest?.id).toBe(old.id);
    expect(f.newest?.id).toBe(recent.id);
    expect(f.longestTitle?.id).toBe(long.id);
    expect(f.unreadBooks).toBe(2);
    expect(f.unreadPages).toBe(360);
    expect(f.readingDays).toBe(12);
    expect(f.topDecade).toEqual({ decade: 2020, count: 1 });
  });

  it('handles an empty collection', () => {
    expect(funFacts([], 'en')).toMatchObject({ oldest: null, newest: null, longestTitle: null, readingDays: 0, topDecade: null });
  });
});

describe('what should I read today', () => {
  it('prefers the to-read list, else books without a status', () => {
    const a = book({ readingStatus: 'to_read' });
    const b = book({ readingStatus: 'unknown' });
    const c = book({ readingStatus: 'read' });
    expect(unreadPool([a, b, c])).toEqual([a]);
    expect(unreadPool([b, c])).toEqual([b]);
    expect(unreadPool([c])).toEqual([]);
  });

  it('builds the recommendation pool in priority order', () => {
    const toRead = book({ readingStatus: 'to_read' });
    const unknown = book({ readingStatus: 'unknown' });
    const reading = book({ readingStatus: 'reading' });
    const abandoned = book({ readingStatus: 'abandoned' });
    const read = book({ readingStatus: 'read' });
    const favRead = book({ readingStatus: 'read', favorite: true });
    expect(recommendationPool([toRead, unknown, read])).toEqual({ mode: 'to_read', pool: [toRead] });
    expect(recommendationPool([unknown, reading, read])).toEqual({ mode: 'unread', pool: [unknown] });
    expect(recommendationPool([reading, abandoned, read])).toEqual({ mode: 'unread', pool: [reading, abandoned] });
    expect(recommendationPool([read, favRead])).toEqual({ mode: 'reread', pool: [favRead] });
    expect(recommendationPool([read])).toEqual({ mode: 'reread', pool: [read] });
    expect(recommendationPool([])).toEqual({ mode: 'none', pool: [] });
  });

  it('avoids repeating the current pick when possible', () => {
    const pool = [book(), book()];
    for (let i = 0; i < 20; i++) {
      expect(pickFromPool(pool, seededRandom(i), pool[0].id)?.id).toBe(pool[1].id);
    }
    expect(pickFromPool([pool[0]], Math.random, pool[0].id)?.id).toBe(pool[0].id);
    expect(pickFromPool([], Math.random)).toBeNull();
  });

  it('daily seed changes per day, not per hour', () => {
    const morning = dailySeed('123456789', new Date(2026, 8, 13, 8, 0));
    expect(morning).toBe(dailySeed('123456789', new Date(2026, 8, 13, 23, 59)));
    expect(morning).not.toBe(dailySeed('123456789', new Date(2026, 8, 14, 0, 1)));
  });

  it('fits a row to the available width without dropping the pick', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
    const width = () => 10;
    // 5 × 10 + 4 × 2 = 58
    expect(fitRow(items, 'c', width, 2, 58).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(fitRow(items, 'c', width, 2, 40).map((i) => i.id)).toEqual(['b', 'c', 'd']);
    expect(fitRow(items, 'a', width, 2, 30).map((i) => i.id)).toEqual(['a', 'b']);
    expect(fitRow(items, 'e', width, 2, 5).map((i) => i.id)).toEqual(['e']);
    expect(fitRow(items, null, width, 2, 22).map((i) => i.id)).toEqual(['a', 'b']);
    expect(fitRow([], 'x', width, 2, 10)).toEqual([]);
  });

  it('shuffle row puts the pick in the middle without duplicates', () => {
    const pool = SAMPLE_BOOKS.slice(0, 5);
    const row = shuffleRow(pool[2], pool, SAMPLE_BOOKS, 9, 'seed');
    expect(row).toHaveLength(9);
    expect(row[Math.floor(8 / 2)].id).toBe(pool[2].id);
    expect(new Set(row.map((b) => b.id)).size).toBe(9);
    expect(shuffleRow(pool[0], [pool[0]], [pool[0]], 9, 1)).toEqual([pool[0]]);
  });
});

describe('computeStats', () => {
  it('summarises the sample library consistently', () => {
    const s = computeStats(SAMPLE_BOOKS, { locale: 'hu' });
    expect(s.total).toBe(SAMPLE_BOOKS.length);
    expect(s.authorCount).toBeGreaterThan(10);
    expect(s.topAuthors.length).toBeLessThanOrEqual(10);
    expect(s.categories.reduce((a, c) => a + c.count, 0)).toBe(s.total);
    expect(Object.values(s.statuses).reduce((a, n) => a + n, 0)).toBe(s.total);
    expect(s.quality.buckets.reduce((a, b) => a + b.count, 0)).toBe(s.total);
    expect(s.years.buckets.reduce((a, b) => a + b.count, 0) + s.years.unknown).toBe(s.total);
    expect(s.shelfLengthCm).toBeCloseTo(s.total * 2.7, 5);
    expect(s.readShare).toBeCloseTo(s.read / s.total, 5);
    expect(s.booksPerAuthor).toBeGreaterThanOrEqual(1);
    expect(s.topTopic?.count).toBeGreaterThan(0);
    expect(s.translation.translated).toBeLessThanOrEqual(s.translation.known);
  });

  it('averages books per author over individual authors and finds the top topic', () => {
    const s = computeStats(
      [
        book({ author: 'Szabó Magda', category: 'hungarian_literature', topics: ['literary_fiction'] }),
        book({ author: 'Szabó Magda', category: 'hungarian_literature' }),
        book({ author: 'Terry Pratchett; Neil Gaiman', category: 'fantasy', topics: ['humor'] }),
        book({ author: null, category: null, topics: [] }),
      ],
      { locale: 'hu' },
    );
    expect(s.authorCount).toBe(3);
    expect(s.booksPerAuthor).toBeCloseTo(4 / 3, 5);
    expect(s.topTopic).toEqual({ key: 'hungarian_literature', count: 2 });
    expect(s.topicCount).toBe(4);
  });

  it('works for no books', () => {
    const s = computeStats([], { locale: 'en' });
    expect(s).toMatchObject({ total: 0, authorCount: 0, booksPerAuthor: 0, topTopic: null, readShare: 0, categories: [], topAuthors: [] });
  });
});
