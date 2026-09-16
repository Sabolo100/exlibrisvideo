import { describe, expect, it } from 'vitest';
import { makeSampleBook, SAMPLE_BOOKS } from '@/components/books/sample-books';
import type { BookDTO } from '@/lib/types';
import { buildTopicsView, gridHoles, layoutMosaic, MOSAIC_COLUMNS, phoneSpan, tileSpan, tileTier, TOPIC_GROUPS } from './topics';

const b = (p: Partial<BookDTO> & { title?: string }) => makeSampleBook({ title: 'x', ...p });

describe('tileSpan', () => {
  it('scales the tile area with the count', () => {
    expect(tileSpan(30, 30)).toEqual({ col: 3, row: 2 });
    expect(tileSpan(12, 30)).toEqual({ col: 2, row: 2 });
    expect(tileSpan(5, 30)).toEqual({ col: 2, row: 1 });
    expect(tileSpan(1, 30)).toEqual({ col: 1, row: 1 });
    expect(tileSpan(0, 0)).toEqual({ col: 1, row: 1 });
  });

  it('keeps tiny collections modest', () => {
    expect(tileSpan(2, 2)).toEqual({ col: 2, row: 1 });
    expect(tileSpan(1, 2)).toEqual({ col: 2, row: 1 });
    expect(tileSpan(1, 1)).toEqual({ col: 2, row: 1 });
  });
});

describe('buildTopicsView', () => {
  it('groups topics by taxonomy group with counts and shares', () => {
    const books = [
      b({ category: 'poetry', topics: ['hungarian_literature'] }),
      b({ category: 'poetry' }),
      b({ category: 'history', topics: ['military'] }),
      b({ category: 'other' }),
      b({ category: 'mystery_unknown_key' }),
      b({ category: null, topics: [], enriched: true }),
    ];
    const v = buildTopicsView(books, 'hu');
    expect(v.total).toBe(6);
    expect(v.maxCount).toBe(2);
    expect(v.sections.map((s) => s.group)).toEqual(['fiction', 'nonfiction', 'reference']);
    const fiction = v.sections[0];
    expect(fiction.label).toBe('Szépirodalom');
    expect(fiction.tiles.map((t) => [t.key, t.count])).toEqual([
      ['poetry', 2],
      ['hungarian_literature', 1],
    ]);
    expect(fiction.bookCount).toBe(2);
    expect(fiction.tiles[0].share).toBeCloseTo(2 / 6);
    const reference = v.sections[2];
    expect(reference.tiles.map((t) => [t.key, t.neutral])).toEqual([
      ['mystery_unknown_key', true],
      ['other', true],
    ]);
    expect(v.unclassified).toHaveLength(1);
    expect(v.classificationPending).toBe(false);
  });

  it('flags pending classification and orders groups like the taxonomy', () => {
    const v = buildTopicsView([b({ enriched: false }), b({ category: 'children' })], 'en');
    expect(v.classificationPending).toBe(true);
    expect(v.sections[0]).toMatchObject({ group: 'young', label: 'Young readers' });
    const all = buildTopicsView(SAMPLE_BOOKS, 'hu');
    const idx = all.sections.map((s) => TOPIC_GROUPS.indexOf(s.group));
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
  });

  it('keeps the incoming (collection sort) order inside a tile', () => {
    const first = b({ title: 'Z', category: 'drama', shelfPosition: 9 });
    const second = b({ title: 'A', category: 'drama', shelfPosition: 1 });
    expect(buildTopicsView([first, second], 'hu').sections[0].tiles[0].books).toEqual([first, second]);
  });
});

describe('mosaic layout', () => {
  const item = (col: 1 | 2 | 3, row: 1 | 2, weight: number) => ({ span: { col, row }, weight });
  /** rows of the justified layout: consecutive cells whose widths add up to the column count */
  const rowsOf = (cells: { col: number; row: number }[], columns: number) => {
    const rows: { col: number; row: number }[][] = [];
    let current: { col: number; row: number }[] = [];
    let used = 0;
    for (const cell of cells) {
      if (used + cell.col > columns) {
        rows.push(current);
        current = [];
        used = 0;
      }
      current.push(cell);
      used += cell.col;
    }
    if (current.length) rows.push(current);
    return rows;
  };

  it('fills every row but the last exactly, with one height per row', () => {
    const sparse = [
      item(3, 2, 9), item(3, 2, 8), item(3, 2, 6), item(2, 2, 4), item(2, 2, 4),
      item(2, 2, 4), item(2, 2, 3), item(2, 2, 3), item(2, 1, 2), item(1, 1, 1),
    ];
    for (const columns of [2, 4, 6]) {
      const cells = layoutMosaic(sparse, columns);
      expect(cells).toHaveLength(sparse.length);
      cells.forEach((c, i) => expect(c.col).toBeGreaterThanOrEqual(Math.min(columns, sparse[i].span.col)));
      const rows = rowsOf(cells, columns);
      rows.slice(0, -1).forEach((r) => expect(r.reduce((s, c) => s + c.col, 0)).toBe(columns));
      rows.forEach((r) => expect(new Set(r.map((c) => c.row)).size).toBe(1));
      expect(gridHoles(cells, columns)).toBe(0);
    }
    // six columns: the one-row tiles are stretched into the last two-row row
    expect(layoutMosaic(sparse, 6).slice(-3)).toEqual([
      { col: 3, row: 2 },
      { col: 2, row: 2 },
      { col: 1, row: 2 },
    ]);
  });

  it('gives spare columns to the busiest tile and keeps a lone last tile modest', () => {
    // 3 + 2 = 5 of 6 columns, the next tile does not fit: the tile with more books per column grows
    expect(layoutMosaic([item(3, 2, 30), item(2, 2, 40), item(3, 2, 5)], 6).slice(0, 2)).toEqual([
      { col: 3, row: 2 },
      { col: 3, row: 2 },
    ]);
    // a single small tile at the end at most doubles and leaves the rest of the row empty
    expect(layoutMosaic([item(1, 1, 1)], 6)).toEqual([{ col: 2, row: 1 }]);
    expect(layoutMosaic([], 6)).toEqual([]);
  });

  it('detects holes of sparse auto-placement, ignoring the ragged end', () => {
    // a one-row tile next to a two-row tile leaves the cell below it empty
    expect(gridHoles([{ col: 3, row: 2 }, { col: 2, row: 2 }, { col: 1, row: 1 }, { col: 2, row: 2 }], 6)).toBe(1);
    expect(gridHoles([{ col: 2, row: 1 }, { col: 1, row: 1 }], 6)).toBe(0);
    expect(gridHoles([], 6)).toBe(0);
  });

  it('keeps phones compact: only the largest topics stay tall', () => {
    expect(phoneSpan({ col: 3, row: 2 })).toEqual({ col: 2, row: 2 });
    expect(phoneSpan({ col: 2, row: 2 })).toEqual({ col: 1, row: 1 });
    expect(phoneSpan({ col: 1, row: 1 })).toEqual({ col: 1, row: 1 });
    expect([tileTier({ col: 3, row: 2 }), tileTier({ col: 2, row: 2 }), tileTier({ col: 2, row: 1 }), tileTier({ col: 1, row: 1 })]).toEqual([
      'large',
      'medium',
      'small',
      'small',
    ]);
    const fiction = buildTopicsView(SAMPLE_BOOKS, 'hu').sections[0];
    const tall = fiction.tiles.filter((t) => t.layout.base.row === 2);
    expect(tall.every((t) => t.span.col === 3)).toBe(true);
  });

  it('lays out the sample library without holes at every breakpoint', () => {
    const view = buildTopicsView(SAMPLE_BOOKS, 'hu');
    for (const section of view.sections) {
      for (const [bp, columns] of Object.entries(MOSAIC_COLUMNS) as [keyof typeof MOSAIC_COLUMNS, number][]) {
        const holes = gridHoles(section.tiles.map((t) => t.layout[bp]), columns);
        expect([section.group, bp, holes]).toEqual([section.group, bp, 0]);
      }
    }
  });
});
