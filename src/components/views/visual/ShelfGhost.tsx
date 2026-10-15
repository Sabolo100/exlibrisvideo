import type { CSSProperties } from 'react';
import { SHELF_GEOMETRY, shelfRowHeight, type SpineSize } from '@/components/books/spine-layout';
import { bookendBox, DENSITY_SIZE, SHELF_DENSITIES, SHELF_INNER_PADDING, SPINE_GAP } from './shelf-layout';

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

/**
 * The ghost bookcase in BOTH densities, one after the other: the reader's choice only exists in this browser's
 * localStorage, so the server cannot know which size the real bookcase will have. The inline boot script copies a
 * "compact" choice onto `<html data-shelf-density>` before the first paint and CSS (`.exl-ghost-*` in globals.css)
 * shows the matching ghost – so its height is the real bookcase's height and nothing jumps when the real one arrives.
 * `rowsFor` supplies the planks for a size.
 */
export function ShelfGhosts({ rowsFor }: { rowsFor: (size: SpineSize) => readonly GhostRow[] }) {
  return (
    <>
      {SHELF_DENSITIES.map((density) => {
        const size = DENSITY_SIZE[density];
        return (
          <div key={density} className={`exl-ghost-${density}`}>
            <ShelfGhost rows={rowsFor(size)} size={size} />
          </div>
        );
      })}
    </>
  );
}
