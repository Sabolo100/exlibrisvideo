/**
 * Pure logic of the table view (owner: views-data): columns, header sorting, range selection and
 * fixed-row-height windowing. No DOM, unit-tested in table.test.ts.
 */
import type { SortKey } from '@/components/collection/context';
import {
  authorSortName,
  bookTopicKeys,
  collator,
  languageName,
  parseHexColor,
  spineColor,
  titleSortName,
} from '@/lib/book-utils';
import { topicLabel } from '@/lib/taxonomy';
import type { BookDTO, Locale, ReadingStatus } from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

export const COLUMN_KEYS = [
  'select',
  'shelf',
  'color',
  'author',
  'title',
  'year',
  'topics',
  'language',
  'status',
  'rating',
  'favorite',
  'confidence',
  'added',
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

/** Columns the viewer can hide (selection belongs to owners, the title is always shown). */
export const HIDEABLE_COLUMNS: readonly ColumnKey[] = COLUMN_KEYS.filter((k) => k !== 'select' && k !== 'title');

export const DEFAULT_HIDDEN_COLUMNS: readonly ColumnKey[] = ['language', 'added'];

/** Fixed column widths in px (the title column takes the remaining space, at least TITLE_MIN_WIDTH). */
export const COLUMN_WIDTHS: Record<Exclude<ColumnKey, 'title'>, number> = {
  select: 44,
  // fits the uppercase, letter-spaced header label plus the sort icon ("HELY ↑" / "POS. ↑")
  shelf: 104,
  color: 36,
  author: 196,
  year: 72,
  topics: 200,
  language: 112,
  // the longest status label ("Nincs megadva", "Félbehagytam") plus the select chevron
  status: 176,
  // five small stars, and room for the "ÉRTÉKELÉS" header
  rating: 128,
  favorite: 52,
  confidence: 104,
  added: 116,
};
export const TITLE_MIN_WIDTH = 240;

export function isColumnKey(v: unknown): v is ColumnKey {
  return typeof v === 'string' && (COLUMN_KEYS as readonly string[]).includes(v);
}

/** Validates a stored "hidden columns" value (localStorage); unknown keys are dropped. */
export function isHiddenColumnList(v: unknown): v is ColumnKey[] {
  return Array.isArray(v) && v.every((k) => isColumnKey(k) && HIDEABLE_COLUMNS.includes(k));
}

/** The columns to render, in order. */
export function visibleColumns(hidden: readonly ColumnKey[], isOwner: boolean): ColumnKey[] {
  return COLUMN_KEYS.filter((k) => {
    if (k === 'select') return isOwner;
    if (k === 'title') return true;
    return !hidden.includes(k);
  });
}

/**
 * Narrow screens: the title moves right after the selection column, so the sticky column that
 * stays in view while the rest scrolls horizontally is the one people read first.
 */
export function titleFirst(columns: readonly ColumnKey[]): ColumnKey[] {
  if (!columns.includes('title')) return [...columns];
  const rest = columns.filter((k) => k !== 'title' && k !== 'select');
  return [...(columns.includes('select') ? (['select'] as ColumnKey[]) : []), 'title', ...rest];
}

/** Minimum table width for a set of columns (px). */
export function tableMinWidth(columns: readonly ColumnKey[]): number {
  return columns.reduce((sum, k) => sum + (k === 'title' ? TITLE_MIN_WIDTH : COLUMN_WIDTHS[k]), 0);
}

/** Left offset of the sticky title column = width of the (sticky) selection column before it. */
export function stickyTitleOffset(columns: readonly ColumnKey[]): number {
  return columns.includes('select') ? COLUMN_WIDTHS.select : 0;
}

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

export type SortDir = 'asc' | 'desc';

/** Columns that correspond to a collection-wide sort (the toolbar's sort menu). */
export const COLUMN_SORT_KEY: Partial<Record<ColumnKey, SortKey>> = {
  shelf: 'shelf',
  author: 'author',
  title: 'title',
  year: 'year',
  added: 'added',
  rating: 'rating',
};

/** Direction in which `sortBooks` orders each collection sort. */
export const NATURAL_DIR: Record<SortKey, SortDir> = {
  shelf: 'asc',
  author: 'asc',
  title: 'asc',
  year: 'asc',
  added: 'desc',
  rating: 'desc',
};

export const SORTABLE_COLUMNS: readonly ColumnKey[] = COLUMN_KEYS.filter((k) => k !== 'select');

/**
 * A table-only sort applied on top of the collection sort (stable, so ties keep the collection
 * order). `base` is the collection sort it was chosen against – when the toolbar changes the
 * collection sort, the local sort no longer applies.
 */
export interface LocalSort {
  column: ColumnKey;
  dir: SortDir;
  base: SortKey;
}

export function activeLocalSort(local: LocalSort | null, sort: SortKey): LocalSort | null {
  return local && local.base === sort ? local : null;
}

/**
 * What clicking a header does:
 * - mapped column, other collection sort active → switch the collection sort (natural direction)
 * - mapped column already sorting → reverse it locally, a third click restores the natural order
 * - unmapped column → ascending, descending, off
 */
export function nextSortState(
  column: ColumnKey,
  sort: SortKey,
  local: LocalSort | null,
): { setSort: SortKey | null; local: LocalSort | null } {
  const active = activeLocalSort(local, sort);
  const mapped = COLUMN_SORT_KEY[column];
  if (mapped) {
    if (active?.column === column) return { setSort: null, local: null };
    if (sort !== mapped) return { setSort: mapped, local: null };
    if (active) return { setSort: null, local: null };
    return { setSort: null, local: { column, dir: NATURAL_DIR[mapped] === 'asc' ? 'desc' : 'asc', base: sort } };
  }
  if (active?.column === column) {
    return { setSort: null, local: active.dir === 'asc' ? { ...active, dir: 'desc' } : null };
  }
  return { setSort: null, local: { column, dir: 'asc', base: sort } };
}

/** aria-sort value of a header. */
export function headerSortState(column: ColumnKey, sort: SortKey, local: LocalSort | null): 'ascending' | 'descending' | 'none' {
  const active = activeLocalSort(local, sort);
  if (active) {
    if (active.column !== column) return 'none';
    return active.dir === 'asc' ? 'ascending' : 'descending';
  }
  const mapped = COLUMN_SORT_KEY[column];
  if (mapped && mapped === sort) return NATURAL_DIR[mapped] === 'asc' ? 'ascending' : 'descending';
  return 'none';
}

/** Order of reading statuses when sorting ascending ("unknown" is treated as missing). */
const STATUS_ORDER: Record<ReadingStatus, number | null> = {
  reading: 0,
  to_read: 1,
  read: 2,
  abandoned: 3,
  unknown: null,
};

function hexHue(hex: string): number {
  const c = parseHexColor(hex);
  if (!c) return 0;
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  // near-greys sort after the colours, by lightness
  if (d < 0.06) return 400 + (1 - (max + min) / 2) * 100;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function timeValue(iso: string): number | null {
  const v = Date.parse(iso);
  return Number.isNaN(v) ? null : v;
}

/** Comparable value of a cell; null means "missing" (always sorted last). */
export function columnSortValue(column: ColumnKey, book: BookDTO, locale: Locale): string | number | null {
  switch (column) {
    case 'shelf':
      return book.shelfPosition;
    case 'color':
      return hexHue(spineColor(book));
    case 'author':
      return authorSortName(book);
    case 'title':
      return titleSortName(book) || null;
    case 'year':
      return typeof book.firstPublishedYear === 'number' ? book.firstPublishedYear : null;
    case 'topics': {
      const first = bookTopicKeys(book)[0];
      return first ? topicLabel(first, locale) : null;
    }
    case 'language':
      return book.language ? languageName(book.language, locale) : null;
    case 'status':
      return STATUS_ORDER[book.readingStatus] ?? null;
    case 'rating':
      return book.rating ?? null;
    case 'favorite':
      // ascending = favourites first
      return book.favorite ? 0 : 1;
    case 'confidence':
      return Number.isFinite(book.confidence) ? book.confidence : null;
    case 'added':
      return timeValue(book.createdAt);
    case 'select':
    default:
      return null;
  }
}

/** Stable sort by one column; missing values last in both directions. */
export function sortByColumn(rows: readonly BookDTO[], column: ColumnKey, dir: SortDir, locale: Locale): BookDTO[] {
  const c = collator(locale);
  const factor = dir === 'asc' ? 1 : -1;
  const keyed = rows.map((book, index) => ({ book, index, value: columnSortValue(column, book, locale) }));
  keyed.sort((a, b) => {
    if (a.value === null && b.value === null) return a.index - b.index;
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    const cmp =
      typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value
        : c.compare(String(a.value), String(b.value));
    return cmp * factor || a.index - b.index;
  });
  return keyed.map((k) => k.book);
}

/** visibleBooks with the local sort applied (when it still belongs to the current collection sort). */
export function applyLocalSort(rows: readonly BookDTO[], local: LocalSort | null, sort: SortKey, locale: Locale): readonly BookDTO[] {
  const active = activeLocalSort(local, sort);
  return active ? sortByColumn(rows, active.column, active.dir, locale) : rows;
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

/** Ids between anchor and target (inclusive) in display order; just the target without a usable anchor. */
export function rangeIds(order: readonly string[], anchorId: string | null, targetId: string): string[] {
  const to = order.indexOf(targetId);
  if (to < 0) return [];
  const from = anchorId ? order.indexOf(anchorId) : -1;
  if (from < 0) return [targetId];
  const [a, b] = from <= to ? [from, to] : [to, from];
  return order.slice(a, b + 1);
}

/**
 * Shift-click / Shift+Arrow: the range anchor→target takes the anchor's state (selected → the
 * range is added, unselected → the range is removed). Returns the new selection.
 */
export function applyRangeSelection(
  selection: ReadonlySet<string>,
  order: readonly string[],
  anchorId: string | null,
  targetId: string,
): string[] {
  const range = rangeIds(order, anchorId, targetId);
  const select = anchorId && order.includes(anchorId) ? selection.has(anchorId) : true;
  const next = new Set(selection);
  for (const id of range) {
    if (select) next.add(id);
    else next.delete(id);
  }
  return [...next];
}

export type HeaderCheckState = 'all' | 'some' | 'none';

export function headerCheckState(selection: ReadonlySet<string>, ids: readonly string[]): HeaderCheckState {
  if (ids.length === 0) return 'none';
  let n = 0;
  for (const id of ids) if (selection.has(id)) n += 1;
  return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
}

/** Header checkbox: select every displayed row, or – when all are selected – unselect them (keeps hidden selections). */
export function toggleAllSelection(selection: ReadonlySet<string>, ids: readonly string[]): string[] {
  const next = new Set(selection);
  if (headerCheckState(selection, ids) === 'all') for (const id of ids) next.delete(id);
  else for (const id of ids) next.add(id);
  return [...next];
}

/* ------------------------------------------------------------------ */
/* Windowing & scrolling                                               */
/* ------------------------------------------------------------------ */

/** Tables longer than this render only the rows in view. */
export const WINDOWING_THRESHOLD = 300;

export type Density = 'comfortable' | 'compact';
export const DENSITIES: readonly Density[] = ['comfortable', 'compact'];
export const ROW_HEIGHT: Record<Density, number> = { comfortable: 52, compact: 38 };

export interface WindowInput {
  scrollTop: number;
  /** visible height of the scroll container */
  viewportHeight: number;
  /** height of the sticky header inside the scroll container */
  headerHeight: number;
  rowHeight: number;
  count: number;
  overscan?: number;
}

/** Row range [start, end) to render. */
export function windowRange({ scrollTop, viewportHeight, headerHeight, rowHeight, count, overscan = 8 }: WindowInput): {
  start: number;
  end: number;
} {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, scrollTop);
  const first = Math.floor(top / rowHeight);
  const visibleRows = Math.ceil(Math.max(0, viewportHeight - headerHeight) / rowHeight) + 1;
  const start = Math.max(0, Math.min(count - 1, first - overscan));
  const end = Math.min(count, first + visibleRows + overscan);
  return { start, end: Math.max(start + 1, end) };
}

/**
 * The scrollTop that brings row `index` fully into view below the sticky header, or null when it
 * is already visible.
 */
export function scrollTopToReveal(
  index: number,
  { scrollTop, viewportHeight, headerHeight, rowHeight }: Omit<WindowInput, 'count' | 'overscan'>,
): number | null {
  const rowTop = headerHeight + index * rowHeight;
  const rowBottom = rowTop + rowHeight;
  if (rowTop < scrollTop + headerHeight) return Math.max(0, rowTop - headerHeight);
  if (rowBottom > scrollTop + viewportHeight) return Math.max(0, rowBottom - viewportHeight);
  return null;
}

/** Keyboard target index for row navigation keys (null for other keys). */
export function navigationTarget(
  key: string,
  current: number,
  count: number,
  pageSize: number,
): number | null {
  if (count <= 0) return null;
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));
  switch (key) {
    case 'ArrowDown':
      return clamp(current + 1);
    case 'ArrowUp':
      return clamp(current - 1);
    case 'PageDown':
      return clamp(current + Math.max(1, pageSize));
    case 'PageUp':
      return clamp(current - Math.max(1, pageSize));
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
