import { describe, expect, it } from 'vitest';
import { makeSampleBook } from '@/components/books/sample-books';
import { SPINE_SIZES } from '@/components/books/spine-layout';
import type { BookDTO } from '@/lib/types';
import { cachedSpineBox, plankWidth } from './shelf-layout';
import { buildStackLayout, flatScale, FLAT_SPINE_SIZE, pileUp, stacksPerPlank, stackWidth } from './stack-layout';

const books = (count: number, extra: Partial<BookDTO> = {}): BookDTO[] =>
  Array.from({ length: count }, (_, i) => makeSampleBook({ id: `b${i}`, title: `Book number ${i}`, pageCount: 200 + i * 37, ...extra }));

describe('piles per plank', () => {
  it('puts two piles on a phone and more on a wide screen', () => {
    expect(stacksPerPlank(351, 'md')).toBe(2);
    expect(stacksPerPlank(1104, 'md')).toBeGreaterThanOrEqual(4);
  });

  it('shares the plank between the piles', () => {
    const per = stacksPerPlank(351, 'md');
    const width = stackWidth(351, 'md');
    expect(width * per + 2 * (per - 1)).toBeLessThanOrEqual(plankWidth(351, 'md'));
    expect(width * per + 2 * (per - 1)).toBeGreaterThan(plankWidth(351, 'md') - per);
  });

  it('scales the spines down so the longest one fits a pile, never up', () => {
    const width = stackWidth(351, 'md');
    const scale = flatScale(width);
    expect(SPINE_SIZES[FLAT_SPINE_SIZE].height * scale).toBeLessThan(width);
    expect(flatScale(2000)).toBe(1);
  });
});

describe('pileUp', () => {
  it('fills piles bottom-up in reading order and never exceeds the height', () => {
    const list = books(30);
    const piles = pileUp(list, { key: 'all', width: 150, scale: 0.75, maxHeight: 120 });
    expect(piles.length).toBeGreaterThan(1);
    expect(piles.flatMap((p) => p.books.map((b) => b.book.id))).toEqual(list.map((b) => b.id));
    expect(piles.flatMap((p) => p.books.map((b) => b.index))).toEqual(list.map((_, i) => i));
    for (const pile of piles) {
      expect(pile.height).toBeLessThanOrEqual(120);
      expect(pile.height).toBe(pile.books.reduce((s, b) => s + b.thickness, 0));
    }
  });

  it('starts a new pile only when the next book does not fit', () => {
    const list = books(12);
    const piles = pileUp(list, { key: 'g', width: 150, scale: 0.8, maxHeight: 140 });
    for (let i = 0; i < piles.length - 1; i++) {
      const next = piles[i + 1].books[0];
      expect(piles[i].height + next.thickness).toBeGreaterThan(140);
    }
  });

  it('gives a book thicker than the limit a pile of its own', () => {
    const piles = pileUp(books(3), { key: 'g', width: 150, scale: 1, maxHeight: 5 });
    expect(piles.map((p) => p.books.length)).toEqual([1, 1, 1]);
  });

  it('keeps the sideways offsets inside the pile', () => {
    const scale = 0.8;
    for (const pile of pileUp(books(40), { key: 'g', width: 160, scale, maxHeight: 180 })) {
      for (const b of pile.books) {
        expect(Math.abs(b.shift)).toBeLessThanOrEqual(7);
        expect(b.length).toBe(Math.round(cachedSpineBox(b.book, FLAT_SPINE_SIZE).height * scale));
        expect(b.length / 2 + Math.abs(b.shift)).toBeLessThanOrEqual(80);
      }
    }
  });
});

describe('buildStackLayout', () => {
  it('numbers the books across groups and caps the piles at the standing height', () => {
    const a = books(9);
    const b = books(5).map((book, i) => ({ ...book, id: `c${i}` }));
    const layout = buildStackLayout(
      [
        { key: 'A', books: a },
        { key: 'B', books: b },
      ],
      351,
      'sm',
    );
    expect(layout.perPlank).toBe(2);
    expect(layout.maxHeight).toBe(SPINE_SIZES.sm.height);
    expect(layout.groups.map((g) => g.key)).toEqual(['A', 'B']);
    expect(layout.groups[1].stacks[0].books[0].index).toBe(9);
    expect(layout.groups[0].stacks[0].key).toBe('A:0');
    for (const g of layout.groups) for (const s of g.stacks) expect(s.height).toBeLessThanOrEqual(SPINE_SIZES.sm.height);
  });
});
