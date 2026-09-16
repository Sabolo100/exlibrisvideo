import { describe, expect, it } from 'vitest';
import { makeSampleBook } from '@/components/books/sample-books';
import { sortBooks } from '@/lib/book-utils';
import type { BookDTO } from '@/lib/types';
import {
  applyLocalSort,
  applyRangeSelection,
  COLUMN_KEYS,
  DEFAULT_HIDDEN_COLUMNS,
  headerCheckState,
  headerSortState,
  isHiddenColumnList,
  navigationTarget,
  nextSortState,
  rangeIds,
  scrollTopToReveal,
  sortByColumn,
  stickyTitleOffset,
  tableMinWidth,
  titleFirst,
  toggleAllSelection,
  visibleColumns,
  windowRange,
  type LocalSort,
} from './table';

const b = (p: Partial<BookDTO> & { title: string }) => makeSampleBook(p);

describe('columns', () => {
  it('shows selection only to owners and never hides the title', () => {
    expect(visibleColumns([], false)).not.toContain('select');
    expect(visibleColumns([], true)[0]).toBe('select');
    expect(visibleColumns(['title' as never, 'author'], true)).toContain('title');
    expect(visibleColumns(DEFAULT_HIDDEN_COLUMNS, false)).not.toContain('language');
    expect(visibleColumns([], true)).toEqual([...COLUMN_KEYS]);
  });

  it('validates stored hidden-column lists', () => {
    expect(isHiddenColumnList(['language', 'added'])).toBe(true);
    expect(isHiddenColumnList([])).toBe(true);
    expect(isHiddenColumnList(['title'])).toBe(false);
    expect(isHiddenColumnList(['select'])).toBe(false);
    expect(isHiddenColumnList(['nope'])).toBe(false);
    expect(isHiddenColumnList('language')).toBe(false);
  });

  it('moves the title first on narrow screens, after the selection column', () => {
    expect(titleFirst(['select', 'shelf', 'color', 'author', 'title', 'year'])).toEqual(['select', 'title', 'shelf', 'color', 'author', 'year']);
    expect(titleFirst(['shelf', 'author', 'title'])).toEqual(['title', 'shelf', 'author']);
    expect(titleFirst(['shelf', 'author'])).toEqual(['shelf', 'author']);
    expect(stickyTitleOffset(titleFirst(['select', 'author', 'title']))).toBe(44);
  });

  it('computes widths and the sticky offset', () => {
    expect(tableMinWidth(['title'])).toBe(240);
    expect(tableMinWidth(['select', 'title', 'year'])).toBe(44 + 240 + 72);
    expect(stickyTitleOffset(['select', 'title'])).toBe(44);
    expect(stickyTitleOffset(['shelf', 'title'])).toBe(0);
  });
});

describe('header sorting', () => {
  it('switches the collection sort for mapped columns, then reverses locally, then restores', () => {
    let r = nextSortState('title', 'shelf', null);
    expect(r).toEqual({ setSort: 'title', local: null });
    r = nextSortState('title', 'title', null);
    expect(r).toEqual({ setSort: null, local: { column: 'title', dir: 'desc', base: 'title' } });
    expect(headerSortState('title', 'title', r.local)).toBe('descending');
    r = nextSortState('title', 'title', r.local);
    expect(r).toEqual({ setSort: null, local: null });
    expect(headerSortState('title', 'title', null)).toBe('ascending');
  });

  it('knows the natural direction of added / rating (newest, best first)', () => {
    expect(headerSortState('added', 'added', null)).toBe('descending');
    expect(nextSortState('rating', 'rating', null).local).toEqual({ column: 'rating', dir: 'asc', base: 'rating' });
  });

  it('cycles unmapped columns asc → desc → off', () => {
    let local: LocalSort | null = nextSortState('language', 'author', null).local;
    expect(local).toEqual({ column: 'language', dir: 'asc', base: 'author' });
    expect(headerSortState('language', 'author', local)).toBe('ascending');
    expect(headerSortState('author', 'author', local)).toBe('none');
    local = nextSortState('language', 'author', local).local;
    expect(local?.dir).toBe('desc');
    local = nextSortState('language', 'author', local).local;
    expect(local).toBeNull();
  });

  it('ignores a local sort chosen against another collection sort', () => {
    const local: LocalSort = { column: 'status', dir: 'asc', base: 'title' };
    expect(headerSortState('status', 'author', local)).toBe('none');
    expect(headerSortState('author', 'author', local)).toBe('ascending');
    const rows = [b({ title: 'x', readingStatus: 'read' }), b({ title: 'y', readingStatus: 'reading' })];
    expect(applyLocalSort(rows, local, 'author', 'hu')).toBe(rows);
    expect(applyLocalSort(rows, { ...local, base: 'author' }, 'author', 'hu').map((r) => r.title)).toEqual(['y', 'x']);
  });

  it('clicking the collection-sort column while another local sort is active restores the natural order', () => {
    const local: LocalSort = { column: 'status', dir: 'asc', base: 'title' };
    expect(nextSortState('title', 'title', local)).toEqual({ setSort: null, local: null });
  });
});

describe('sortByColumn', () => {
  const rows = [
    b({ title: 'Bárány', language: 'hu', rating: null, confidence: 0.4, readingStatus: 'unknown', firstPublishedYear: 1990 }),
    b({ title: 'Alma', language: 'en', rating: 3, confidence: 0.9, readingStatus: 'read', firstPublishedYear: null }),
    b({ title: 'Cseresznye', language: null, rating: 5, confidence: 0.7, readingStatus: 'reading', firstPublishedYear: 1850 }),
  ];

  it('keeps missing values last in both directions', () => {
    expect(sortByColumn(rows, 'rating', 'asc', 'hu').map((r) => r.title)).toEqual(['Alma', 'Cseresznye', 'Bárány']);
    expect(sortByColumn(rows, 'rating', 'desc', 'hu').map((r) => r.title)).toEqual(['Cseresznye', 'Alma', 'Bárány']);
    expect(sortByColumn(rows, 'year', 'desc', 'hu').map((r) => r.title)).toEqual(['Bárány', 'Cseresznye', 'Alma']);
    expect(sortByColumn(rows, 'language', 'asc', 'hu').map((r) => r.title)).toEqual(['Alma', 'Bárány', 'Cseresznye']);
  });

  it('sorts statuses by reading progress with unknown last', () => {
    expect(sortByColumn(rows, 'status', 'asc', 'hu').map((r) => r.readingStatus)).toEqual(['reading', 'read', 'unknown']);
  });

  it('is stable (ties keep the incoming order)', () => {
    const same = [b({ title: 'a', favorite: true }), b({ title: 'b' }), b({ title: 'c', favorite: true }), b({ title: 'd' })];
    expect(sortByColumn(same, 'favorite', 'asc', 'en').map((r) => r.title)).toEqual(['a', 'c', 'b', 'd']);
    expect(sortByColumn(same, 'favorite', 'desc', 'en').map((r) => r.title)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('a reversed title sort mirrors sortBooks for complete data', () => {
    const titles = ['Az ajtó', 'Utas és holdvilág', 'Egri csillagok', 'A Pál utcai fiúk'].map((title) => b({ title }));
    const natural = sortBooks(titles, 'title', 'hu').map((r) => r.title);
    expect(sortByColumn(natural.map((t) => titles.find((x) => x.title === t)!), 'title', 'desc', 'hu').map((r) => r.title)).toEqual(
      [...natural].reverse(),
    );
  });
});

describe('selection', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('computes ranges in either direction', () => {
    expect(rangeIds(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(order, null, 'c')).toEqual(['c']);
    expect(rangeIds(order, 'zzz', 'c')).toEqual(['c']);
    expect(rangeIds(order, 'a', 'zzz')).toEqual([]);
  });

  it('range takes the anchor state', () => {
    expect(applyRangeSelection(new Set(['b', 'x']), order, 'b', 'd').sort()).toEqual(['b', 'c', 'd', 'x']);
    expect(applyRangeSelection(new Set(['c', 'd', 'e']), order, 'b', 'd').sort()).toEqual(['e']);
    expect(applyRangeSelection(new Set(), order, null, 'd')).toEqual(['d']);
  });

  it('header checkbox state and toggle keep selections outside the view', () => {
    expect(headerCheckState(new Set(), order)).toBe('none');
    expect(headerCheckState(new Set(['a']), order)).toBe('some');
    expect(headerCheckState(new Set(order), order)).toBe('all');
    expect(headerCheckState(new Set(['a']), [])).toBe('none');
    expect(toggleAllSelection(new Set(['x', 'a']), order).sort()).toEqual([...order, 'x'].sort());
    expect(toggleAllSelection(new Set([...order, 'x']), order)).toEqual(['x']);
  });
});

describe('windowing & keyboard', () => {
  const base = { viewportHeight: 520, headerHeight: 40, rowHeight: 48, count: 1000, overscan: 5 };

  it('renders the rows in view plus overscan', () => {
    expect(windowRange({ ...base, scrollTop: 0 })).toEqual({ start: 0, end: 16 });
    const mid = windowRange({ ...base, scrollTop: 4800 });
    expect(mid.start).toBe(95);
    expect(mid.end).toBe(100 + 11 + 5);
    expect(windowRange({ ...base, scrollTop: 999999 })).toEqual({ start: 999, end: 1000 });
    expect(windowRange({ ...base, count: 0, scrollTop: 0 })).toEqual({ start: 0, end: 0 });
  });

  it('scrolls just enough to reveal a row below the sticky header', () => {
    const m = { viewportHeight: 520, headerHeight: 40, rowHeight: 48 };
    expect(scrollTopToReveal(0, { ...m, scrollTop: 0 })).toBeNull();
    expect(scrollTopToReveal(9, { ...m, scrollTop: 0 })).toBeNull(); // 40 + 432 + 48 = 520
    expect(scrollTopToReveal(10, { ...m, scrollTop: 0 })).toBe(48);
    expect(scrollTopToReveal(3, { ...m, scrollTop: 480 })).toBe(144);
  });

  it('maps navigation keys', () => {
    expect(navigationTarget('ArrowDown', 3, 10, 5)).toBe(4);
    expect(navigationTarget('ArrowDown', 9, 10, 5)).toBe(9);
    expect(navigationTarget('ArrowUp', 0, 10, 5)).toBe(0);
    expect(navigationTarget('PageDown', 3, 10, 5)).toBe(8);
    expect(navigationTarget('PageUp', 3, 10, 5)).toBe(0);
    expect(navigationTarget('Home', 3, 10, 5)).toBe(0);
    expect(navigationTarget('End', 3, 10, 5)).toBe(9);
    expect(navigationTarget('x', 3, 10, 5)).toBeNull();
    expect(navigationTarget('ArrowDown', 0, 0, 5)).toBeNull();
  });
});
