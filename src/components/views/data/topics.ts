/**
 * Pure grouping logic of the topics view (owner: views-data). Unit-tested in topics.test.ts.
 */
import { bookTopicKeys, collator } from '@/lib/book-utils';
import { TOPIC_GROUP_LABELS, TOPICS, topicDef, type TopicDef } from '@/lib/taxonomy';
import type { BookDTO, Locale } from '@/lib/types';

export type TopicGroup = TopicDef['group'];
export const TOPIC_GROUPS = Object.keys(TOPIC_GROUP_LABELS) as TopicGroup[];

export interface TileSpan {
  /** 1–3 grid columns (3 becomes 2 on phones) */
  col: 1 | 2 | 3;
  /** 1–2 grid rows */
  row: 1 | 2;
}

/**
 * Treemap-like tile size: the tile area (1, 2, 4 or 6 cells) follows the topic's count relative
 * to the largest topic of the view. Topics with one or two books never grow beyond 2×1, so a
 * small collection does not become a wall of giant tiles.
 */
export function tileSpan(count: number, max: number): TileSpan {
  if (max <= 0 || count <= 0) return { col: 1, row: 1 };
  const r = count / max;
  if (count >= 3 && r >= 0.6) return { col: 3, row: 2 };
  if (count >= 3 && r >= 0.3) return { col: 2, row: 2 };
  if (r >= 0.12 || count >= 2) return { col: 2, row: 1 };
  return { col: 1, row: 1 };
}

/** A tile's size at one breakpoint of the mosaic grid. */
export interface MosaicCell {
  col: number;
  row: 1 | 2;
}

/** Grid columns per breakpoint: phones · ≥ 640 px · ≥ 1024 px. */
export const MOSAIC_COLUMNS = { base: 2, sm: 4, lg: 6 } as const;
export type MosaicBreakpoint = keyof typeof MOSAIC_COLUMNS;

/**
 * Justified mosaic rows. Tiles (in count order) are laid out row by row so that every row is filled
 * exactly and there are no holes: a row takes tiles while they fit, one-row tiles that still fit
 * into a two-row row are stretched to its height, and the columns left over go to the tile with
 * the most books per column. Only the very last row may stay ragged, and there a tile grows to at
 * most twice its size (so a lone small topic does not turn into a banner).
 */
export function layoutMosaic(items: readonly { span: TileSpan; weight: number }[], columns: number): MosaicCell[] {
  const cols = Math.max(1, Math.floor(columns));
  const out: MosaicCell[] = [];
  let i = 0;
  while (i < items.length) {
    const height = items[i].span.row;
    const row: { index: number; col: number; base: number }[] = [];
    let used = 0;
    while (i < items.length) {
      const item = items[i];
      // a taller tile opens its own row
      if (item.span.row > height) break;
      const width = Math.min(cols, item.span.col);
      if (used + width > cols) break;
      row.push({ index: i, col: width, base: width });
      used += width;
      i += 1;
    }
    const lastRow = i >= items.length;
    let left = cols - used;
    while (left > 0) {
      let best = -1;
      let bestRatio = -1;
      row.forEach((cell, k) => {
        if (cell.col >= cols || (lastRow && cell.col >= cell.base * 2)) return;
        const ratio = items[cell.index].weight / cell.col;
        if (ratio > bestRatio) {
          best = k;
          bestRatio = ratio;
        }
      });
      if (best < 0) break;
      row[best].col += 1;
      left -= 1;
    }
    for (const cell of row) out[cell.index] = { col: cell.col, row: height };
  }
  return out;
}

/**
 * Phones have two columns: only the largest topics (3-wide) stay full-width and two rows tall, all
 * others become one-column, one-row tiles that pair up – a stack of tall tiles would be endless.
 */
export function phoneSpan(span: TileSpan): TileSpan {
  return span.col === 3 ? { col: 2, row: 2 } : { col: 1, row: 1 };
}

/** Visual weight of a tile: `large` everywhere, `medium` large from the sm breakpoint up, else compact. */
export type TileTier = 'large' | 'medium' | 'small';

export function tileTier(span: TileSpan): TileTier {
  if (span.row !== 2) return 'small';
  return span.col === 3 ? 'large' : span.col === 2 ? 'medium' : 'small';
}

/**
 * Empty cells inside a mosaic when `cells` are auto-placed in order (`grid-auto-flow: row`) into
 * `columns` columns; the ragged end of the last row group does not count. Used to verify layouts.
 */
export function gridHoles(cells: readonly MosaicCell[], columns: number): number {
  const grid: boolean[][] = [];
  const free = (r: number, c: number, w: number, h: number) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (grid[y]?.[x]) return false;
    return true;
  };
  const placed: { top: number; bottom: number }[] = [];
  // sparse auto-placement: the cursor only moves forward
  let cursorRow = 0;
  let cursorCol = 0;
  for (const cell of cells) {
    const w = Math.min(columns, cell.col);
    const h = cell.row;
    for (;;) {
      if (cursorCol + w > columns) {
        cursorRow += 1;
        cursorCol = 0;
        continue;
      }
      if (free(cursorRow, cursorCol, w, h)) break;
      cursorCol += 1;
    }
    for (let y = cursorRow; y < cursorRow + h; y++) for (let x = cursorCol; x < cursorCol + w; x++) (grid[y] ??= [])[x] = true;
    placed.push({ top: cursorRow, bottom: cursorRow + h - 1 });
    cursorCol += w;
  }
  if (placed.length === 0) return 0;
  const lastRow = Math.max(...placed.map((p) => p.bottom));
  const trailingTop = Math.min(...placed.filter((p) => p.bottom === lastRow).map((p) => p.top));
  let holes = 0;
  for (let y = 0; y < trailingTop; y++) for (let x = 0; x < columns; x++) if (!grid[y]?.[x]) holes += 1;
  return holes;
}

export interface TopicTileData {
  key: string;
  /** undefined for keys outside the taxonomy */
  def: TopicDef | undefined;
  label: string;
  icon: string;
  hue: number;
  /** drawn without hue: "other" and keys outside the taxonomy */
  neutral: boolean;
  count: number;
  /** 0..1 of the books in view (a book can carry several topics, so shares add up to more than 1) */
  share: number;
  /** books in the order of the input (the collection sort) */
  books: BookDTO[];
  /** size class from the count (drives the tile's typography) */
  span: TileSpan;
  /** placed size per breakpoint (justified mosaic rows) */
  layout: Record<MosaicBreakpoint, MosaicCell>;
}

export interface TopicSectionData {
  group: TopicGroup;
  label: string;
  tiles: TopicTileData[];
  /** distinct books in this group */
  bookCount: number;
}

export interface TopicsViewData {
  sections: TopicSectionData[];
  /** books without category and topics */
  unclassified: BookDTO[];
  /** true when some unclassified book has not been through enrichment yet */
  classificationPending: boolean;
  maxCount: number;
  total: number;
}

const OTHER_KEY = 'other';

export function buildTopicsView(books: readonly BookDTO[], locale: Locale): TopicsViewData {
  const byKey = new Map<string, BookDTO[]>();
  const unclassified: BookDTO[] = [];
  for (const book of books) {
    const keys = bookTopicKeys(book);
    if (keys.length === 0) {
      unclassified.push(book);
      continue;
    }
    for (const k of keys) {
      const list = byKey.get(k);
      if (list) list.push(book);
      else byKey.set(k, [book]);
    }
  }

  const total = books.length;
  const maxCount = Math.max(0, ...[...byKey.values()].map((l) => l.length));
  const c = collator(locale);
  const order = new Map(TOPICS.map((t, i) => [t.key, i]));

  const sections: TopicSectionData[] = TOPIC_GROUPS.map((group) => {
    const tiles: TopicTileData[] = [];
    const distinct = new Set<string>();
    for (const [key, list] of byKey) {
      const def = topicDef(key);
      const tileGroup: TopicGroup = def?.group ?? 'reference';
      if (tileGroup !== group) continue;
      for (const b of list) distinct.add(b.id);
      const neutral = !def || key === OTHER_KEY;
      tiles.push({
        key,
        def,
        label: def ? def[locale] : key,
        icon: def?.icon ?? '🔖',
        hue: def?.hue ?? 0,
        neutral,
        count: list.length,
        share: total > 0 ? list.length / total : 0,
        books: list,
        span: tileSpan(list.length, maxCount),
        layout: { base: { col: 1, row: 1 }, sm: { col: 1, row: 1 }, lg: { col: 1, row: 1 } },
      });
    }
    tiles.sort(
      (a, b) =>
        b.count - a.count ||
        Number(a.key === OTHER_KEY) - Number(b.key === OTHER_KEY) ||
        (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999) ||
        c.compare(a.label, b.label),
    );
    const items = tiles.map((t) => ({ span: t.span, weight: t.count }));
    const placed = {
      base: layoutMosaic(
        tiles.map((t) => ({ span: phoneSpan(t.span), weight: t.count })),
        MOSAIC_COLUMNS.base,
      ),
      sm: layoutMosaic(items, MOSAIC_COLUMNS.sm),
      lg: layoutMosaic(items, MOSAIC_COLUMNS.lg),
    };
    tiles.forEach((t, i) => {
      t.layout = { base: placed.base[i], sm: placed.sm[i], lg: placed.lg[i] };
    });
    return { group, label: TOPIC_GROUP_LABELS[group][locale], tiles, bookCount: distinct.size };
  }).filter((s) => s.tiles.length > 0);

  return {
    sections,
    unclassified,
    classificationPending: unclassified.some((b) => !b.enriched),
    maxCount,
    total,
  };
}
