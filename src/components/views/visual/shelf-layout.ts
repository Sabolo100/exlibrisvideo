/**
 * Pure layout maths for the virtual bookcase (ShelfView): grouping, packing spines onto planks,
 * the leaning last book, and keyboard neighbours. No DOM – unit-tested.
 */
import { SHELF_GEOMETRY, SPINE_SIZES, spineBox, type SpineSize } from '@/components/books/spine-layout';
import { authorInitial, compareInitials, hash01 } from '@/lib/book-utils';
import { TOPICS, isTopicKey } from '@/lib/taxonomy';
import type { BookDTO, Locale, ReadingStatus } from '@/lib/types';

export type ShelfGroupBy = 'none' | 'topic' | 'author' | 'status';
export const SHELF_GROUP_BYS: readonly ShelfGroupBy[] = ['none', 'topic', 'author', 'status'];

/** The two spine sizes offered by the size toggle. */
export type ShelfDensity = 'compact' | 'comfortable';
export const SHELF_DENSITIES: readonly ShelfDensity[] = ['compact', 'comfortable'];
export const DENSITY_SIZE: Record<ShelfDensity, SpineSize> = { compact: 'sm', comfortable: 'md' };

export interface ShelfGroup {
  /** "all" | taxonomy key | index letter ("A", "Cs", "#") | reading status */
  key: string;
  books: BookDTO[];
}

/** Reading statuses as a library would shelve them: current reads first, unknown last. */
export const STATUS_SHELF_ORDER: readonly ReadingStatus[] = ['reading', 'to_read', 'read', 'abandoned', 'unknown'];

const TOPIC_ORDER = new Map(TOPICS.map((t, i) => [t.key, i]));

/** Primary taxonomy key of a book for shelving (category, else first topic, else "other"). */
export function primaryTopic(book: Pick<BookDTO, 'category' | 'topics'>): string {
  const key = book.category ?? book.topics.find((t) => Boolean(t)) ?? 'other';
  return isTopicKey(key) ? key : 'other';
}

/**
 * Splits books into shelves. The input order (the user's sort) is kept inside every group.
 * Topic shelves follow the taxonomy order ("other" last), initials the (Hungarian) alphabet with
 * "#" last, statuses {@link STATUS_SHELF_ORDER}. Empty groups are omitted.
 */
export function groupShelfBooks(books: readonly BookDTO[], groupBy: ShelfGroupBy, locale: Locale): ShelfGroup[] {
  if (books.length === 0) return [];
  if (groupBy === 'none') return [{ key: 'all', books: [...books] }];

  const map = new Map<string, BookDTO[]>();
  for (const book of books) {
    const key =
      groupBy === 'topic'
        ? primaryTopic(book)
        : groupBy === 'author'
          ? authorInitial(book, { digraphs: locale === 'hu' })
          : book.readingStatus;
    const list = map.get(key);
    if (list) list.push(book);
    else map.set(key, [book]);
  }
  const groups = [...map.entries()].map(([key, list]) => ({ key, books: list }));

  if (groupBy === 'topic') {
    const rank = (k: string) => (k === 'other' ? Number.MAX_SAFE_INTEGER : (TOPIC_ORDER.get(k) ?? Number.MAX_SAFE_INTEGER - 1));
    groups.sort((a, b) => rank(a.key) - rank(b.key));
  } else if (groupBy === 'author') {
    groups.sort((a, b) => compareInitials(a.key, b.key, locale));
  } else {
    const rank = (k: string) => {
      const i = STATUS_SHELF_ORDER.indexOf(k as ReadingStatus);
      return i < 0 ? STATUS_SHELF_ORDER.length : i;
    };
    groups.sort((a, b) => rank(a.key) - rank(b.key));
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/**
 * spineBox() folds the author and title (Unicode normalisation + regexes) on every call – about
 * 50 µs per book. Relayouts (resize, filter, sort) of 2000+ books reuse the result: DTOs are
 * immutable (an edited book is a new object), so a WeakMap keyed by the book is always fresh.
 */
const boxCache = new WeakMap<BookDTO, Partial<Record<SpineSize, { width: number; height: number }>>>();

export function cachedSpineBox(book: BookDTO, size: SpineSize): { width: number; height: number } {
  let entry = boxCache.get(book);
  if (!entry) {
    entry = {};
    boxCache.set(book, entry);
  }
  return (entry[size] ??= spineBox(book, size));
}

/** Horizontal gap between spines on a plank (px). */
export const SPINE_GAP: Record<SpineSize, number> = { xs: 1, sm: 2, md: 2, lg: 3 };
/** Inline padding of the Shelf's inner list (mirrors Shelf.tsx). */
export const SHELF_INNER_PADDING: Record<SpineSize, number> = { xs: 4, sm: 10, md: 10, lg: 10 };

/** Width available for spines inside a Shelf of the given outer width. */
export function plankWidth(containerWidth: number, size: SpineSize): number {
  const g = SHELF_GEOMETRY[size];
  return Math.max(0, Math.floor(containerWidth - 2 * g.side - 2 * SHELF_INNER_PADDING[size]));
}

/** Height of the content box of one plank row (spine area; mirrors Shelf's list item padding). */
export function plankContentHeight(size: SpineSize): number {
  return SPINE_SIZES[size].height + 2;
}

/** Bookend plate size (px) incl. its outer margins. */
export function bookendBox(size: SpineSize): { width: number; height: number; marginStart: number; marginEnd: number } {
  return {
    width: Math.round(SPINE_SIZES[size].width * (size === 'xs' ? 0.9 : 0.72)),
    height: Math.round(SPINE_SIZES[size].height * 0.56),
    marginStart: 2,
    marginEnd: 4,
  };
}

export function bookendOuterWidth(size: SpineSize): number {
  const b = bookendBox(size);
  return b.width + b.marginStart + b.marginEnd;
}

/**
 * Greedy packing of item widths into rows of `available` px with `gap` between items.
 * `firstRowReserve` is taken from the first row (a bookend). An item wider than a row gets a
 * row of its own. Returns the item indices per row.
 */
export function packRows(
  widths: readonly number[],
  available: number,
  gap: number,
  firstRowReserve = 0,
): number[][] {
  const rows: number[][] = [];
  let row: number[] = [];
  let used = firstRowReserve;
  widths.forEach((w, i) => {
    const need = (row.length > 0 || used > 0 ? gap : 0) + w;
    if (row.length > 0 && used + need > available) {
      rows.push(row);
      row = [];
      used = 0;
      row.push(i);
      used = w;
      return;
    }
    row.push(i);
    used += need;
  });
  if (row.length > 0) rows.push(row);
  return rows;
}

/**
 * Left margin that makes a book tilted by `angleDeg` (pivoting on its bottom-left corner) rest
 * against its neighbour: the contact is the neighbour's top corner or the book's own top corner,
 * whichever comes first.
 */
export function leanMargin(bookHeight: number, neighbourHeight: number, angleDeg: number, gap: number): number {
  const rad = (angleDeg * Math.PI) / 180;
  const contact = Math.min(neighbourHeight * Math.tan(rad), bookHeight * Math.sin(rad));
  return Math.max(0, Math.round(contact) - gap);
}

/** Deterministic tilt of the leaning book (6–11°). */
export function leanAngle(bookId: string): number {
  return Math.round((6 + hash01(bookId, 31) * 5) * 10) / 10;
}

export interface PlacedSpine {
  book: BookDTO;
  width: number;
  height: number;
  /** left edge within the row (px) */
  x: number;
  /** leaning book: tilt and extra left margin */
  lean: { angle: number; margin: number } | null;
}

export interface ShelfRow {
  /** stable key: group key + row index */
  key: string;
  /** index in the flattened row list (keyboard navigation) */
  index: number;
  groupKey: string;
  spines: PlacedSpine[];
  startBookend: boolean;
  endBookend: boolean;
}

export interface ShelfGroupLayout {
  key: string;
  books: BookDTO[];
  rows: ShelfRow[];
}

export interface ShelfLayout {
  size: SpineSize;
  /** px available on a plank */
  plank: number;
  gap: number;
  groups: ShelfGroupLayout[];
  /** all rows of all groups in order */
  rows: ShelfRow[];
  /** book id → [row index, spine index] */
  position: Map<string, [number, number]>;
}

/**
 * Lays out every group: spines packed onto planks, a bookend at the start of each shelf, and at
 * the end either the last book leaning against its neighbour (when the plank has room for the
 * tilt) or a closing bookend.
 */
export function buildShelfLayout(groups: readonly ShelfGroup[], containerWidth: number, size: SpineSize): ShelfLayout {
  const plank = plankWidth(containerWidth, size);
  const gap = SPINE_GAP[size];
  const bookend = bookendOuterWidth(size);
  const rows: ShelfRow[] = [];
  const position = new Map<string, [number, number]>();
  const layouts: ShelfGroupLayout[] = [];

  for (const group of groups) {
    const boxes = group.books.map((b) => cachedSpineBox(b, size));
    // leave room for the start bookend only when the plank is wide enough to be worth it
    const withBookends = plank >= bookend * 2 + (boxes[0]?.width ?? 0) + gap * 2;
    const packed = packRows(
      boxes.map((b) => b.width),
      plank,
      gap,
      withBookends ? bookend : 0,
    );
    const groupRows: ShelfRow[] = packed.map((indices, r) => {
      const startBookend = withBookends && r === 0;
      let x = startBookend ? bookend + gap : 0;
      const spines = indices.map((i) => {
        const placed: PlacedSpine = { book: group.books[i], width: boxes[i].width, height: boxes[i].height, x, lean: null };
        x += boxes[i].width + gap;
        return placed;
      });
      return { key: `${group.key}:${r}`, index: 0, groupKey: group.key, spines, startBookend, endBookend: false };
    });

    const last = groupRows[groupRows.length - 1];
    if (last && withBookends) {
      const lastSpine = last.spines[last.spines.length - 1];
      const used = lastSpine.x + lastSpine.width;
      const free = plank - used;
      const neighbour = last.spines.length >= 2 ? last.spines[last.spines.length - 2] : null;
      const angle = leanAngle(lastSpine.book.id);
      const margin = neighbour ? leanMargin(lastSpine.height, neighbour.height, angle, gap) : 0;
      if (neighbour && group.books.length >= 3 && free >= margin + 6) {
        lastSpine.lean = { angle, margin };
        lastSpine.x += margin;
      } else if (free >= bookend + gap) {
        last.endBookend = true;
      }
    }

    for (const row of groupRows) {
      row.index = rows.length;
      row.spines.forEach((s, i) => position.set(s.book.id, [row.index, i]));
      rows.push(row);
    }
    layouts.push({ key: group.key, books: group.books, rows: groupRows });
  }

  return { size, plank, gap, groups: layouts, rows, position };
}

/**
 * true when two rows draw exactly the same plank (same books – by reference, so an edited book
 * counts as a change – at the same positions, same bookends and lean). Every relayout creates new
 * row objects; this lets the memoised plank rows skip re-rendering the unchanged ones.
 */
export function sameShelfRow(a: ShelfRow, b: ShelfRow): boolean {
  if (a === b) return true;
  if (a.key !== b.key || a.startBookend !== b.startBookend || a.endBookend !== b.endBookend) return false;
  if (a.spines.length !== b.spines.length) return false;
  for (let i = 0; i < a.spines.length; i++) {
    const s = a.spines[i];
    const t = b.spines[i];
    if (s.book !== t.book || s.x !== t.x || s.width !== t.width || s.height !== t.height) return false;
    if ((s.lean?.angle ?? null) !== (t.lean?.angle ?? null) || (s.lean?.margin ?? null) !== (t.lean?.margin ?? null)) return false;
  }
  return true;
}

export type ShelfMove = 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'first' | 'last';

/**
 * The book to focus after an arrow key: left/right walk the reading order across planks,
 * up/down pick the spine on the neighbouring plank whose centre is closest, home/end stay on the
 * plank, first/last jump to the ends of the bookcase. null when there is nowhere to go.
 */
export function shelfNeighbour(layout: ShelfLayout, bookId: string, move: ShelfMove): string | null {
  const pos = layout.position.get(bookId);
  if (!pos) return null;
  const [r, i] = pos;
  const row = layout.rows[r];
  switch (move) {
    case 'left':
      if (i > 0) return row.spines[i - 1].book.id;
      return r > 0 ? layout.rows[r - 1].spines[layout.rows[r - 1].spines.length - 1].book.id : null;
    case 'right':
      if (i < row.spines.length - 1) return row.spines[i + 1].book.id;
      return r < layout.rows.length - 1 ? layout.rows[r + 1].spines[0].book.id : null;
    case 'home':
      return i > 0 ? row.spines[0].book.id : null;
    case 'end':
      return i < row.spines.length - 1 ? row.spines[row.spines.length - 1].book.id : null;
    case 'first': {
      const first = layout.rows[0]?.spines[0]?.book.id ?? null;
      return first === bookId ? null : first;
    }
    case 'last': {
      const lastRow = layout.rows[layout.rows.length - 1];
      const last = lastRow?.spines[lastRow.spines.length - 1]?.book.id ?? null;
      return last === bookId ? null : last;
    }
    case 'up':
    case 'down': {
      const target = layout.rows[move === 'up' ? r - 1 : r + 1];
      if (!target || target.spines.length === 0) return null;
      const current = row.spines[i];
      const centre = current.x + current.width / 2;
      let best = target.spines[0];
      let bestDist = Number.POSITIVE_INFINITY;
      for (const s of target.spines) {
        const d = Math.abs(s.x + s.width / 2 - centre);
        if (d < bestDist) {
          best = s;
          bestDist = d;
        }
      }
      return best.book.id;
    }
    default:
      return null;
  }
}

/** Key → move for the bookcase keyboard handler (null for keys it does not own). */
export function keyToShelfMove(key: string, ctrlOrMeta: boolean): ShelfMove | null {
  switch (key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'Home':
      return ctrlOrMeta ? 'first' : 'home';
    case 'End':
      return ctrlOrMeta ? 'last' : 'end';
    default:
      return null;
  }
}
