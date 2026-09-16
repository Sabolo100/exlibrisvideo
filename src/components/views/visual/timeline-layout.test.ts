import { describe, expect, it } from 'vitest';
import { makeSampleBook } from '@/components/books/sample-books';
import { getTranslator } from '@/i18n';
import type { BookDTO } from '@/lib/types';
import {
  bandGapYears,
  buildTimeline,
  centuryLabel,
  columnLabel,
  decadeLabel,
  englishOrdinal,
  huDecadeSuffix,
  splitPiles,
  yearLabel,
} from './timeline-layout';

const book = (title: string, year: number | null, extra: Partial<BookDTO> = {}) =>
  makeSampleBook({ title, firstPublishedYear: year, ...extra });

const hu = getTranslator('hu');
const en = getTranslator('en');

describe('buildTimeline', () => {
  const books = [
    book('Don Quijote', 1605),
    book('Az ember tragédiája', 1861),
    book('Iskola a határon', 1959),
    book('Sorstalanság', 1975),
    book('Abigél', 1970),
    book('Harry Potter', 1997),
    book('Ismeretlen', null),
    book('Hibás év', 12345),
    book('Jövő', new Date().getUTCFullYear() + 5),
    book('Az utolsó', 2021),
  ];

  it('buckets by decade inside century bands, keeping empty decades between books', () => {
    const tl = buildTimeline(books, 'decade', 'hu');
    expect(tl.bands.map((b) => b.century)).toEqual([1600, 1800, 1900, 2000]);
    const b1900 = tl.bands[2];
    expect(b1900.columns.map((c) => c.start)).toEqual([1950, 1960, 1970, 1980, 1990]);
    expect(b1900.columns.find((c) => c.start === 1960)!.books).toHaveLength(0);
    expect(b1900.columns.find((c) => c.start === 1970)!.books.map((b) => b.title)).toEqual(['Abigél', 'Sorstalanság']);
    expect(b1900.count).toBe(4);
    expect(tl.bands[3].columns.map((c) => c.start)).toEqual([2020]);
  });

  it('collects undated, invalid and future years in the unknown tray', () => {
    const tl = buildTimeline(books, 'decade', 'hu');
    expect(tl.unknown.map((b) => b.title)).toEqual(['Ismeretlen', 'Hibás év', 'Jövő']);
    expect(tl.dated).toBe(7);
    expect(tl.oldest?.title).toBe('Don Quijote');
    expect(tl.newest?.title).toBe('Az utolsó');
  });

  it('century zoom → one column per band', () => {
    const tl = buildTimeline(books, 'century', 'hu');
    expect(tl.bands.map((b) => b.columns.length)).toEqual([1, 1, 1, 1]);
    expect(tl.bands[2].columns[0]).toMatchObject({ key: 'c1900', start: 1900, span: 100 });
    expect(tl.bands[2].columns[0].books.map((b) => b.firstPublishedYear)).toEqual([1959, 1970, 1975, 1997]);
  });

  it('histogram covers every decade from oldest to newest with zeros', () => {
    const tl = buildTimeline(books, 'decade', 'hu');
    expect(tl.histogram[0]).toEqual({ decade: 1600, count: 1 });
    expect(tl.histogram[tl.histogram.length - 1]).toEqual({ decade: 2020, count: 1 });
    expect(tl.histogram).toHaveLength((2020 - 1600) / 10 + 1);
    expect(tl.histogram.find((h) => h.decade == 1970)!.count).toBe(2);
    expect(tl.maxBin).toBe(2);
  });

  it('handles BC years and an empty list', () => {
    const tl = buildTimeline([book('Iliász', -750), book('Odüsszeia', -725)], 'decade', 'hu');
    expect(tl.bands.map((b) => b.century)).toEqual([-800]);
    expect(tl.bands[0].columns.map((c) => c.start)).toEqual([-750, -740, -730]);
    const empty = buildTimeline([], 'decade', 'en');
    expect(empty).toMatchObject({ bands: [], unknown: [], dated: 0, oldest: null, newest: null, histogram: [], maxBin: 0 });
  });
});

describe('splitPiles & gaps', () => {
  it('splits into piles and reports hidden books', () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    expect(splitPiles(items, 10).piles.map((p) => p.length)).toEqual([10, 10, 3]);
    expect(splitPiles(items, 10, 2)).toMatchObject({ hidden: 3 });
    expect(splitPiles(items, 10, 5).hidden).toBe(0);
    expect(splitPiles([], 10, 2)).toEqual({ piles: [], hidden: 0 });
  });

  it('computes skipped years between bands', () => {
    expect(bandGapYears(1800, 1900)).toBe(0);
    expect(bandGapYears(1600, 1800)).toBe(100);
  });
});

describe('labels', () => {
  it('Hungarian decade suffixes follow vowel harmony', () => {
    const cases: [number, string][] = [
      [1900, 'as'],
      [1910, 'es'],
      [1920, 'as'],
      [1930, 'as'],
      [1940, 'es'],
      [1950, 'es'],
      [1960, 'as'],
      [1970, 'es'],
      [1980, 'as'],
      [1990, 'es'],
      [2000, 'es'],
      [2010, 'es'],
      [2020, 'as'],
      [1000, 'es'],
      [1800, 'as'],
      [750, 'es'],
    ];
    for (const [decade, suffix] of cases) expect(huDecadeSuffix(decade), String(decade)).toBe(suffix);
  });

  it('formats decades, centuries and years in both languages', () => {
    expect(decadeLabel(1960, hu.t)).toBe('1960-as évek');
    expect(decadeLabel(2000, hu.t)).toBe('2000-es évek');
    expect(decadeLabel(1960, en.t)).toBe('1960s');
    expect(decadeLabel(-750, hu.t)).toBe('i. e. 750-es évek');
    expect(decadeLabel(-750, en.t)).toBe('750s BC');
    expect(centuryLabel(1900, 'hu', hu.t)).toBe('20. század');
    expect(centuryLabel(2000, 'en', en.t)).toBe('21st century');
    expect(centuryLabel(1600, 'en', en.t)).toBe('17th century');
    expect(centuryLabel(-800, 'hu', hu.t)).toBe('i. e. 8. század');
    expect(centuryLabel(-800, 'en', en.t)).toBe('8th century BC');
    expect(centuryLabel(0, 'en', en.t)).toBe('1st century');
    expect(yearLabel(1605, hu.t)).toBe('1605');
    expect(yearLabel(-750, hu.t)).toBe('i. e. 750');
    expect(yearLabel(-750, en.t)).toBe('750 BC');
    expect(columnLabel({ start: 1900, span: 100 }, 'hu', hu.t)).toBe('20. század');
    expect(columnLabel({ start: 1980, span: 10 }, 'en', en.t)).toBe('1980s');
  });

  it('English ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(englishOrdinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
    ]);
  });
});
