/**
 * Pure layout maths of the "lying" bookcase (ShelfView, arrangement "lying"): the books lie on their sides in
 * piles, two piles side by side on every plank of a phone (more on wider screens), the spines turned so the titles read left to right. A pile grows
 * from the bottom up until the next book would rise above the plank's headroom. No DOM – unit-tested.
 */
import { SPINE_SIZES, type SpineSize } from '@/components/books/spine-layout';
import { hash01 } from '@/lib/book-utils';
import type { BookDTO } from '@/lib/types';
import { cachedSpineBox, plankWidth, type ShelfGroup } from './shelf-layout';

/** a plank holds two piles on a phone; wider bookcases give a pile about this much room (px) */
const PILE_ROOM = 230;
/** gap between the bookcase's items (mirrors Shelf.tsx's column gap) */
const ITEM_GAP = 2;
/** room kept free beside the longest spine inside a pile (px): the gap between two piles and their offsets */
const STACK_SLACK = 14;
/** the lying spines are drawn at this size and scaled down to the pile's width */
export const FLAT_SPINE_SIZE: SpineSize = 'md';

export interface StackedBook {
  book: BookDTO;
  /** drawn length (the spine's height, scaled) and thickness (its width, scaled), px */
  length: number;
  thickness: number;
  /** sideways offset inside the pile (px, from the centre) – a real pile is never straight */
  shift: number;
  /** place in reading order (re-shelving animation) */
  index: number;
}

export interface BookStack {
  key: string;
  /** bottom book first */
  books: StackedBook[];
  height: number;
}

export interface StackGroupLayout {
  key: string;
  books: BookDTO[];
  stacks: BookStack[];
}

export interface StackLayout {
  size: SpineSize;
  /** piles side by side on a plank */
  perPlank: number;
  /** width of one pile (px) */
  stackWidth: number;
  /** scale of the md spines */
  scale: number;
  /** tallest pile (px) */
  maxHeight: number;
  groups: StackGroupLayout[];
}

/** Scale that makes the longest md spine fit a pile of this width (never enlarged). */
export function flatScale(stackWidth: number): number {
  const longest = SPINE_SIZES[FLAT_SPINE_SIZE].height;
  return Math.max(0.4, Math.min(1, (stackWidth - STACK_SLACK) / longest));
}

/** Piles side by side on a plank of a bookcase of the given outer width (at least two). */
export function stacksPerPlank(containerWidth: number, size: SpineSize): number {
  return Math.max(2, Math.floor(plankWidth(containerWidth, size) / PILE_ROOM));
}

/** Width of one pile on a bookcase of the given outer width. */
export function stackWidth(containerWidth: number, size: SpineSize): number {
  const perPlank = stacksPerPlank(containerWidth, size);
  return Math.max(0, Math.floor((plankWidth(containerWidth, size) - ITEM_GAP * (perPlank - 1)) / perPlank));
}

/**
 * Splits every group into piles. The input order (the reader's sort) runs bottom-up through the first pile, then
 * the second, then the piles of the next plank. A pile is as tall as a standing book of `size` at most; a book
 * thicker than that still gets a pile of its own.
 */
export function buildStackLayout(groups: readonly ShelfGroup[], containerWidth: number, size: SpineSize): StackLayout {
  const width = stackWidth(containerWidth, size);
  const scale = flatScale(width);
  const maxHeight = SPINE_SIZES[size].height;
  let index = 0;
  const layouts = groups.map((group): StackGroupLayout => {
    const stacks = pileUp(group.books, { key: group.key, width, scale, maxHeight, firstIndex: index });
    index += group.books.length;
    return { key: group.key, books: group.books, stacks };
  });
  return { size, perPlank: stacksPerPlank(containerWidth, size), stackWidth: width, scale, maxHeight, groups: layouts };
}

/**
 * Piles books up in their order: the first book at the bottom of the first pile; a new pile starts when the next
 * book would make the pile taller than `maxHeight` (a single thicker book still gets a pile). `width` is the room
 * of one pile (for the sideways offsets), `firstIndex` the reading-order place of the first book.
 */
export function pileUp(
  books: readonly BookDTO[],
  opts: { key: string; width: number; scale: number; maxHeight: number; firstIndex?: number },
): BookStack[] {
  const stacks: BookStack[] = [];
  let current: BookStack | null = null;
  let index = opts.firstIndex ?? 0;
  for (const book of books) {
    const box = cachedSpineBox(book, FLAT_SPINE_SIZE);
    const length = Math.round(box.height * opts.scale);
    const thickness = Math.max(4, Math.round(box.width * opts.scale));
    if (!current || (current.books.length > 0 && current.height + thickness > opts.maxHeight)) {
      current = { key: `${opts.key}:${stacks.length}`, books: [], height: 0 };
      stacks.push(current);
    }
    const room = Math.max(0, (opts.width - length) / 2 - 2);
    const shift = Math.round((hash01(book.id, 41) * 2 - 1) * Math.min(room, 7));
    current.books.push({ book, length, thickness, shift, index: index++ });
    current.height += thickness;
  }
  return stacks;
}
