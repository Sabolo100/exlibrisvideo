import { describe, expect, it } from 'vitest';
import { makeSampleBook } from '@/components/books/sample-books';
import { sortBooks } from '@/lib/book-utils';
import { chunk, coverGridMetrics, initialGroups, localizedDescription } from './covers-layout';

describe('coverGridMetrics', () => {
  it('fits as many cards as the minimum width allows', () => {
    const m = coverGridMetrics(1200);
    expect(m.gap).toBe(26);
    expect(m.columns).toBe(Math.floor((1200 + 26) / (150 + 26)));
    expect(m.cardWidth * m.columns + m.gap * (m.columns - 1)).toBeCloseTo(1200);
  });

  it('keeps at least two columns on phones and caps wide screens', () => {
    expect(coverGridMetrics(320).columns).toBe(2);
    expect(coverGridMetrics(3000).columns).toBe(10);
    expect(coverGridMetrics(0)).toMatchObject({ columns: 2, cardWidth: 0 });
  });
});

describe('initialGroups', () => {
  const books = [
    makeSampleBook({ title: 'A Pál utcai fiúk', author: 'Molnár Ferenc', authorSort: 'molnar ferenc' }),
    makeSampleBook({ title: 'Csillagszemű', author: 'Csukás István', authorSort: 'csukas istvan' }),
    makeSampleBook({ title: 'Az ember tragédiája', author: 'Madách Imre', authorSort: 'madach imre' }),
    makeSampleBook({ title: 'Egri csillagok', author: 'Gárdonyi Géza', authorSort: 'gardonyi geza' }),
    makeSampleBook({ title: '1984', author: 'George Orwell', authorSort: 'orwell george' }),
    makeSampleBook({ title: 'Névtelen jegyzetek' }),
  ];

  it('returns null for sorts without letter headers', () => {
    expect(initialGroups(books, 'shelf', 'hu')).toBeNull();
    expect(initialGroups(books, 'year', 'hu')).toBeNull();
  });

  it('groups author-sorted books by family-name initial (digraphs in Hungarian)', () => {
    const sorted = sortBooks(books, 'author', 'hu');
    const groups = initialGroups(sorted, 'author', 'hu')!;
    expect(groups.map((g) => g.key)).toEqual(['Cs', 'G', 'M', 'O', '#']);
    expect(groups.find((g) => g.key === 'M')!.books.map((b) => b.title)).toEqual(['Az ember tragédiája', 'A Pál utcai fiúk']);
    expect(groups.reduce((s, g) => s + g.books.length, 0)).toBe(books.length);
  });

  it('groups title-sorted books by initial without the leading article', () => {
    const sorted = sortBooks(books, 'title', 'en');
    const groups = initialGroups(sorted, 'title', 'en')!;
    expect(groups.map((g) => g.key)).toEqual(['#', 'C', 'E', 'N', 'P']);
  });

  it('merges a letter that reappears later into its first group', () => {
    const [a, b, c] = books;
    const groups = initialGroups([a, b, c], 'author', 'hu')!;
    expect(groups.map((g) => g.key)).toEqual(['M', 'Cs']);
    expect(groups[0].books).toEqual([a, c]);
  });
});

describe('chunk & localizedDescription', () => {
  it('chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });

  it('prefers the reader language and falls back to the other one', () => {
    const both = { descriptionHu: 'Magyar leírás', descriptionEn: 'English description' };
    expect(localizedDescription(both, 'hu')).toEqual({ text: 'Magyar leírás', lang: 'hu', fallback: false });
    expect(localizedDescription(both, 'en')).toEqual({ text: 'English description', lang: 'en', fallback: false });
    expect(localizedDescription({ descriptionHu: '  ', descriptionEn: 'Only English' }, 'hu')).toEqual({
      text: 'Only English',
      lang: 'en',
      fallback: true,
    });
    expect(localizedDescription({ descriptionHu: null, descriptionEn: null }, 'en')).toBeNull();
  });
});
