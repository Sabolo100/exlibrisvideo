import { describe, expect, it } from 'vitest';
import { makeSampleBook } from '@/components/books/sample-books';
import { SHELF_GEOMETRY, spineBox } from '@/components/books/spine-layout';
import type { BookDTO } from '@/lib/types';
import {
  bookendOuterWidth,
  buildShelfLayout,
  cachedSpineBox,
  sameShelfRow,
  groupShelfBooks,
  keyToShelfMove,
  leanAngle,
  leanMargin,
  packRows,
  plankWidth,
  primaryTopic,
  shelfNeighbour,
  SHELF_INNER_PADDING,
} from './shelf-layout';

const book = (title: string, extra: Partial<BookDTO> = {}) => makeSampleBook({ title, ...extra });

describe('packRows', () => {
  it('packs greedily with gaps and a first-row reserve', () => {
    expect(packRows([30, 30, 30], 100, 2)).toEqual([[0, 1, 2]]); // 30+2+30+2+30 = 94
    expect(packRows([30, 30, 30, 30], 100, 2)).toEqual([[0, 1, 2], [3]]);
    // reserve 20 (+gap): 20+2+30+2+30 = 84, the third would need 116
    expect(packRows([30, 30, 30], 100, 2, 20)).toEqual([[0, 1], [2]]);
  });

  it('gives an over-wide item a row of its own and handles empty input', () => {
    expect(packRows([50, 150, 20], 100, 2)).toEqual([[0], [1], [2]]);
    expect(packRows([], 100, 2)).toEqual([]);
  });

  it('never exceeds the available width except for single over-wide items', () => {
    const widths = Array.from({ length: 400 }, (_, i) => 14 + ((i * 37) % 29));
    const rows = packRows(widths, 333, 2, 25);
    rows.forEach((row, r) => {
      const used = (r === 0 ? 25 + 2 : 0) + row.reduce((s, i) => s + widths[i], 0) + 2 * (row.length - 1);
      expect(used).toBeLessThanOrEqual(333);
    });
    expect(rows.flat()).toEqual(widths.map((_, i) => i));
  });
});

describe('plank geometry', () => {
  it('subtracts side walls and inner padding', () => {
    const g = SHELF_GEOMETRY.md;
    expect(plankWidth(1000, 'md')).toBe(1000 - 2 * g.side - 2 * SHELF_INNER_PADDING.md);
    expect(plankWidth(10, 'md')).toBe(0);
  });

  it('computes the lean margin from the first contact point', () => {
    // tall neighbour: the leaning book touches with its own top corner (h·sinθ)
    expect(leanMargin(180, 400, 10, 2)).toBe(Math.round(180 * Math.sin(Math.PI / 18)) - 2);
    // short neighbour: contact at the neighbour's top corner (hn·tanθ)
    expect(leanMargin(180, 100, 10, 2)).toBe(Math.round(100 * Math.tan(Math.PI / 18)) - 2);
    expect(leanMargin(10, 10, 1, 5)).toBe(0);
    const a = leanAngle('book-1');
    expect(a).toBeGreaterThanOrEqual(6);
    expect(a).toBeLessThanOrEqual(11);
    expect(leanAngle('book-1')).toBe(a);
  });
});

describe('groupShelfBooks', () => {
  const books = [
    book('Egri csillagok', { author: 'Gárdonyi Géza', authorSort: 'gardonyi geza', category: 'historical_fiction', readingStatus: 'read' }),
    book('Iskola a határon', { author: 'Ottlik Géza', authorSort: 'ottlik geza', category: 'hungarian_literature', readingStatus: 'reading' }),
    book('Versek', { author: 'Csoóri Sándor', authorSort: 'csoori sandor', topics: ['poetry'], readingStatus: 'to_read' }),
    book('Névtelen', { category: 'not-a-key' }),
    book('Sorstalanság', { author: 'Kertész Imre', authorSort: 'kertesz imre', category: 'hungarian_literature' }),
  ];

  it('none → one shelf with every book in order', () => {
    const groups = groupShelfBooks(books, 'none', 'hu');
    expect(groups).toHaveLength(1);
    expect(groups[0].books.map((b) => b.title)).toEqual(books.map((b) => b.title));
    expect(groupShelfBooks([], 'topic', 'hu')).toEqual([]);
  });

  it('topic → taxonomy order, unknown keys under "other" (last)', () => {
    expect(primaryTopic(books[2])).toBe('poetry');
    expect(primaryTopic(books[3])).toBe('other');
    const groups = groupShelfBooks(books, 'topic', 'hu');
    expect(groups.map((g) => g.key)).toEqual(['hungarian_literature', 'poetry', 'historical_fiction', 'other']);
    expect(groups[0].books.map((b) => b.title)).toEqual(['Iskola a határon', 'Sorstalanság']);
  });

  it('author → Hungarian digraph initials in alphabet order, "#" last; no digraphs in English', () => {
    expect(groupShelfBooks(books, 'author', 'hu').map((g) => g.key)).toEqual(['Cs', 'G', 'K', 'O', '#']);
    expect(groupShelfBooks(books, 'author', 'en').map((g) => g.key)).toEqual(['C', 'G', 'K', 'O', '#']);
  });

  it('status → reading, to read, read, abandoned, unknown', () => {
    expect(groupShelfBooks(books, 'status', 'hu').map((g) => g.key)).toEqual(['reading', 'to_read', 'read', 'unknown']);
  });
});

describe('buildShelfLayout', () => {
  const many = Array.from({ length: 120 }, (_, i) => book(`Könyv ${i + 1} ${'x'.repeat(i % 23)}`, { author: `Szerző ${i % 7}` }));

  it('places every book exactly once, rows within the plank', () => {
    const layout = buildShelfLayout([{ key: 'all', books: many }], 900, 'md');
    const ids = layout.rows.flatMap((r) => r.spines.map((s) => s.book.id));
    expect(ids).toEqual(many.map((b) => b.id));
    expect(layout.position.size).toBe(many.length);
    for (const row of layout.rows) {
      const last = row.spines[row.spines.length - 1];
      const end = last.x + last.width + (row.endBookend ? bookendOuterWidth('md') + layout.gap : 0);
      expect(end).toBeLessThanOrEqual(layout.plank);
      // x positions increase and leave the gap
      row.spines.forEach((s, i) => {
        if (i > 0) expect(s.x).toBeGreaterThanOrEqual(row.spines[i - 1].x + row.spines[i - 1].width + layout.gap);
        expect(s.width).toBe(spineBox(s.book, 'md').width);
      });
    }
    expect(layout.rows[0].startBookend).toBe(true);
    expect(layout.rows.slice(1).every((r) => !r.startBookend)).toBe(true);
  });

  it('leans the last book when the last plank has room, otherwise closes with a bookend', () => {
    const three = many.slice(0, 3);
    const layout = buildShelfLayout([{ key: 'all', books: three }], 900, 'md');
    const lastRow = layout.rows[layout.rows.length - 1];
    const leaning = lastRow.spines[lastRow.spines.length - 1];
    expect(leaning.lean).not.toBeNull();
    expect(leaning.lean!.margin).toBeGreaterThan(0);
    expect(lastRow.endBookend).toBe(false);

    // a single book cannot lean on anything → bookend
    const single = buildShelfLayout([{ key: 'all', books: many.slice(0, 1) }], 900, 'md');
    expect(single.rows[0].spines[0].lean).toBeNull();
    expect(single.rows[0].endBookend).toBe(true);
  });

  it('numbers rows across groups and maps positions', () => {
    const layout = buildShelfLayout(
      [
        { key: 'a', books: many.slice(0, 50) },
        { key: 'b', books: many.slice(50) },
      ],
      500,
      'sm',
    );
    expect(layout.groups).toHaveLength(2);
    layout.rows.forEach((r, i) => expect(r.index).toBe(i));
    expect(layout.groups[1].rows[0].index).toBe(layout.groups[0].rows.length);
    const [r, i] = layout.position.get(many[60].id)!;
    expect(layout.rows[r].spines[i].book.id).toBe(many[60].id);
  });

  it('handles a zero-width container without crashing', () => {
    const layout = buildShelfLayout([{ key: 'all', books: many.slice(0, 5) }], 0, 'md');
    expect(layout.rows.flatMap((r) => r.spines)).toHaveLength(5);
  });

  it('caches spine boxes per book object (fresh for an edited copy)', () => {
    const b = many[3];
    expect(cachedSpineBox(b, 'md')).toBe(cachedSpineBox(b, 'md'));
    expect(cachedSpineBox(b, 'md')).toEqual(spineBox(b, 'md'));
    expect(cachedSpineBox(b, 'sm')).toEqual(spineBox(b, 'sm'));
    const edited = { ...b, pageCount: 1100 };
    expect(cachedSpineBox(edited, 'md')).toEqual(spineBox(edited, 'md'));
    expect(cachedSpineBox(edited, 'md').width).not.toBe(cachedSpineBox(b, 'md').width);
  });

  it('sameShelfRow: unchanged planks compare equal across relayouts, changes do not', () => {
    const a = buildShelfLayout([{ key: 'all', books: many }], 900, 'md');
    const again = buildShelfLayout([{ key: 'all', books: [...many] }], 900, 'md');
    a.rows.forEach((row, i) => expect(sameShelfRow(row, again.rows[i])).toBe(true));

    // an edited book (new object) changes only its plank – and the planks after it if it got wider
    const edited = many.map((b, i) => (i === 40 ? { ...b, rating: 5 } : b));
    const afterEdit = buildShelfLayout([{ key: 'all', books: edited }], 900, 'md');
    const [editedRow] = afterEdit.position.get(many[40].id)!;
    afterEdit.rows.forEach((row, i) => expect(sameShelfRow(a.rows[i], row)).toBe(i !== editedRow));

    // a narrower bookcase repacks
    const narrow = buildShelfLayout([{ key: 'all', books: many }], 700, 'md');
    expect(sameShelfRow(a.rows[0], narrow.rows[0])).toBe(false);
  });
});

describe('shelfNeighbour', () => {
  const books = Array.from({ length: 40 }, (_, i) => book(`Cím ${i}`, { author: 'Egy Szerző', pageCount: 200 }));
  const layout = buildShelfLayout([{ key: 'all', books }], 400, 'md');
  const id = (r: number, i: number) => layout.rows[r].spines[i].book.id;

  it('walks left/right across planks', () => {
    expect(shelfNeighbour(layout, id(0, 0), 'left')).toBeNull();
    expect(shelfNeighbour(layout, id(0, 0), 'right')).toBe(id(0, 1));
    const endOfFirst = layout.rows[0].spines.length - 1;
    expect(shelfNeighbour(layout, id(0, endOfFirst), 'right')).toBe(id(1, 0));
    expect(shelfNeighbour(layout, id(1, 0), 'left')).toBe(id(0, endOfFirst));
    expect(shelfNeighbour(layout, 'nope', 'left')).toBeNull();
  });

  it('moves up/down to the spine with the closest centre', () => {
    const r1 = layout.rows[1];
    const target = r1.spines[Math.floor(r1.spines.length / 2)];
    const down = shelfNeighbour(layout, target.book.id, 'down')!;
    const [dr, di] = layout.position.get(down)!;
    expect(dr).toBe(2);
    const centre = target.x + target.width / 2;
    const chosen = layout.rows[2].spines[di];
    for (const s of layout.rows[2].spines) {
      expect(Math.abs(chosen.x + chosen.width / 2 - centre)).toBeLessThanOrEqual(Math.abs(s.x + s.width / 2 - centre));
    }
    expect(shelfNeighbour(layout, id(0, 0), 'up')).toBeNull();
    const lastRow = layout.rows.length - 1;
    expect(shelfNeighbour(layout, id(lastRow, 0), 'down')).toBeNull();
  });

  it('home/end and first/last', () => {
    const row = layout.rows[1];
    expect(shelfNeighbour(layout, row.spines[2].book.id, 'home')).toBe(row.spines[0].book.id);
    expect(shelfNeighbour(layout, row.spines[2].book.id, 'end')).toBe(row.spines[row.spines.length - 1].book.id);
    expect(shelfNeighbour(layout, row.spines[0].book.id, 'home')).toBeNull();
    expect(shelfNeighbour(layout, row.spines[2].book.id, 'first')).toBe(books[0].id);
    expect(shelfNeighbour(layout, row.spines[2].book.id, 'last')).toBe(books[books.length - 1].id);
  });

  it('maps keys', () => {
    expect(keyToShelfMove('ArrowUp', false)).toBe('up');
    expect(keyToShelfMove('Home', true)).toBe('first');
    expect(keyToShelfMove('End', false)).toBe('end');
    expect(keyToShelfMove('Enter', false)).toBeNull();
  });
});
