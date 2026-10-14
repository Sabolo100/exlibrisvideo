import type { CSSProperties } from 'react';
import { SHELF_GEOMETRY, shelfRowHeight, type SpineSize } from '@/components/books/spine-layout';
import { bookendBox, SHELF_INNER_PADDING, SPINE_GAP } from './shelf-layout';

/** One plank of a {@link ShelfGhost}: ghost spines in a row, optionally after a ghost bookend. */
export interface GhostRow {
  key: string;
  startBookend: boolean;
  spines: readonly { key: string; width: number; height: number }[];
}

/**
 * A ghost of the bookcase: a dark walnut case with pulsing placeholder spines on its planks, built from the same
 * geometry as the real <Shelf> (plank thickness, side walls, row height, bookend), so the real shelf takes
 * its place without anything moving. Used by the shelf view until it has measured its width, and by the
 * route-level loading skeleton of `/<id>`. Pure markup (no hooks): server and client components both render it.
 */
export function ShelfGhost({ rows, size }: { rows: readonly GhostRow[]; size: SpineSize }) {
  const g = SHELF_GEOMETRY[size];
  const row = shelfRowHeight(size);
  const gap = SPINE_GAP[size];
  const bookend = bookendBox(size);
  const ghost = (key: string, width: number, height: number, style?: CSSProperties) => (
    <div
      key={key}
      className="shrink-0 animate-pulse rounded-t-[3px]"
      style={{ width, height, background: 'color-mix(in oklab, var(--wood-light), transparent 55%)', ...style }}
    />
  );
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-[6px]"
      style={{ padding: `${g.top}px ${g.side}px 0`, background: 'var(--wood-dark)' }}
    >
      {rows.map((r) => (
        <div
          key={r.key}
          data-skeleton-row={r.key}
          className="flex items-end overflow-hidden"
          style={{ height: row, gap, paddingInline: SHELF_INNER_PADDING[size], borderBottom: `${g.plank}px solid var(--wood)` }}
        >
          {r.startBookend
            ? ghost('bookend', bookend.width, bookend.height, { marginInlineStart: bookend.marginStart, marginInlineEnd: bookend.marginEnd })
            : null}
          {r.spines.map((spine) => ghost(spine.key, spine.width, spine.height))}
        </div>
      ))}
    </div>
  );
}
