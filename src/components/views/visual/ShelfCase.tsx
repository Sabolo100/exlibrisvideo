'use client';

/**
 * One bookcase of the shelf view: the UI kit's walnut <Shelf> (top board, brass label plate,
 * planks) filled with pre-packed plank rows. Rows far from the viewport render cheap colour
 * blocks instead of interactive spines, so 2000+ books stay smooth. <StackCase> is the same
 * bookcase with the books lying in piles. Every book carries its re-shelving place (reshelve.ts).
 */
import { memo, type CSSProperties, type ReactNode } from 'react';
import { BookSpine, Shelf } from '@/components/books';
import { SHELF_GEOMETRY, SPINE_SIZES, shelfRowHeight, type SpineSize } from '@/components/books/spine-layout';
import { spineColor } from '@/lib/book-utils';
import type { BookDTO } from '@/lib/types';
import { Bookend } from './Bookend';
import { FlatSpine } from './FlatSpine';
import { useNearViewport } from './hooks';
import { reshelveStyle } from './reshelve';
import type { BookStack, StackGroupLayout } from './stack-layout';
import { plankContentHeight, sameShelfRow, type ShelfGroupLayout, type ShelfRow } from './shelf-layout';

export interface ShelfCaseProps {
  group: ShelfGroupLayout;
  size: SpineSize;
  plank: number;
  gap: number;
  /** brass plate text (omit for an unlabelled case) */
  label?: ReactNode;
  count?: number;
  ariaLabel: string;
  photo: boolean;
  openBookId: string | null;
  onOpen: (book: BookDTO) => void;
  /** render every row interactive (small collections) instead of mounting near the viewport */
  eager: boolean;
  /** row kept interactive regardless of scroll position (keyboard focus lives there) */
  keepMountedRow: string | null;
  /** rows with index below this start mounted (first paint without placeholders) */
  initialRows: number;
  /** row key → place of its first book in reading order (re-shelving animation) */
  rowOffsets: ReadonlyMap<string, number>;
}

export const ShelfCase = memo(function ShelfCase({
  group,
  size,
  plank,
  gap,
  label,
  count,
  ariaLabel,
  photo,
  openBookId,
  onOpen,
  eager,
  keepMountedRow,
  initialRows,
  rowOffsets,
}: ShelfCaseProps) {
  const rowHeight = shelfRowHeight(size);
  return (
    // clipped sideways only (8 px out, so the case's soft shadow survives): while a deferred
    // relayout catches up with a shrinking window, the old planks must not widen the page;
    // lifted and pulled spines still rise above the case
    <div className="-mx-2 overflow-x-clip px-2">
      <div className="exl-shelf-case relative">
        <LampLight rowHeight={rowHeight} />
        <Shelf size={size} label={label} count={count} aria-label={ariaLabel} photo={photo}>
          {group.rows.map((row) => (
            <PlankRow
              key={row.key}
              row={row}
              size={size}
              plank={plank}
              gap={gap}
              photo={photo}
              pulledId={openBookId && row.spines.some((s) => s.book.id === openBookId) ? openBookId : null}
              onOpen={onOpen}
              eager={eager}
              keepMounted={keepMountedRow === row.key}
              initiallyNear={row.index < initialRows}
              offset={rowOffsets.get(row.key) ?? 0}
            />
          ))}
        </Shelf>
      </div>
    </div>
  );
});

interface PlankRowProps {
  row: ShelfRow;
  size: SpineSize;
  plank: number;
  gap: number;
  photo: boolean;
  pulledId: string | null;
  onOpen: (book: BookDTO) => void;
  eager: boolean;
  keepMounted: boolean;
  initiallyNear: boolean;
  offset: number;
}

/** Re-render a plank only when what it draws (or its state) changed – not on every relayout. */
function samePlankProps(a: PlankRowProps, b: PlankRowProps): boolean {
  return (
    a.size === b.size &&
    a.plank === b.plank &&
    a.gap === b.gap &&
    a.photo === b.photo &&
    a.pulledId === b.pulledId &&
    a.onOpen === b.onOpen &&
    a.eager === b.eager &&
    a.keepMounted === b.keepMounted &&
    a.initiallyNear === b.initiallyNear &&
    a.offset === b.offset &&
    sameShelfRow(a.row, b.row)
  );
}

const PlankRow = memo(function PlankRow({ row, size, plank, gap, photo, pulledId, onOpen, eager, keepMounted, initiallyNear, offset }: PlankRowProps) {
  const [ref, near] = useNearViewport<HTMLDivElement>({ rootMargin: '140% 0px', initial: eager || initiallyNear });
  const live = eager || near || keepMounted;
  return (
    <div
      ref={ref}
      data-plank-row={row.key}
      className="relative flex items-end"
      style={{ width: plank, height: plankContentHeight(size), columnGap: gap }}
    >
      {row.startBookend ? <Bookend side="start" size={size} /> : null}
      {row.spines.map((s, i) => {
        if (!live) {
          return (
            <span
              key={s.book.id}
              aria-hidden="true"
              className="exl-rs block shrink-0 rounded-t-[3px] rounded-b-[2px]"
              style={{
                '--rs-i': offset + i,
                width: s.width,
                height: s.height,
                marginLeft: s.lean ? s.lean.margin : undefined,
                transform: s.lean ? `rotate(${-s.lean.angle}deg)` : undefined,
                transformOrigin: '0 100%',
                backgroundColor: spineColor(s.book),
                boxShadow: 'inset 3px 0 4px rgb(0 0 0 / 0.25), inset -3px 0 4px rgb(0 0 0 / 0.3)',
              } as CSSProperties}
            />
          );
        }
        const spine = (
          <BookSpine
            key={s.book.id}
            book={s.book}
            size={size}
            photo={photo}
            pulled={pulledId === s.book.id}
            onClick={onOpen}
            className="exl-rs"
            style={reshelveStyle(offset + i)}
          />
        );
        if (!s.lean) return spine;
        return (
          <span
            key={s.book.id}
            className="block shrink-0"
            style={{ marginLeft: s.lean.margin, transform: `rotate(${-s.lean.angle}deg)`, transformOrigin: '0 100%' }}
          >
            {spine}
          </span>
        );
      })}
      {row.endBookend ? <Bookend side="end" size={size} /> : null}
      <span aria-hidden="true" className="exl-dust" style={{ '--rs-plank': '0px' } as CSSProperties} />
    </div>
  );
}, samePlankProps);

/**
 * Dark mode only: a brass picture light over the case and warm pools of lamp light down the
 * planks (a plain alpha overlay – no blend modes, cheap to scroll).
 */
function LampLight({ rowHeight }: { rowHeight: number }) {
  const bay = rowHeight * 3;
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-2.5 left-1/2 z-[4] hidden h-2.5 w-[min(38%,15rem)] -translate-x-1/2 rounded-full dark:block"
        style={{
          background: 'linear-gradient(180deg, #f6e1a4 0%, #c89a45 45%, #7d5a22 100%)',
          boxShadow: '0 1px 2px rgb(0 0 0 / 0.6), 0 8px 26px 10px rgb(255 196 120 / 0.28), inset 0 -1px 0 rgb(255 240 200 / 0.7)',
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[3] hidden rounded-[6px] dark:block"
        style={{
          backgroundImage: [
            'radial-gradient(ellipse 62% 340px at 50% 0px, rgb(255 198 128 / 0.2), rgb(255 186 110 / 0.07) 55%, transparent 80%)',
            `radial-gradient(ellipse 70% ${Math.round(bay * 0.55)}px at 50% 0px, rgb(255 190 115 / 0.07), transparent 85%)`,
            'linear-gradient(90deg, rgb(0 0 0 / 0.28), transparent 14%, transparent 86%, rgb(0 0 0 / 0.28))',
          ].join(', '),
          backgroundSize: `100% 100%, 100% ${bay}px, 100% 100%`,
          backgroundRepeat: 'no-repeat, repeat-y, no-repeat',
        }}
      />
    </>
  );
}

export interface StackCaseProps {
  group: StackGroupLayout;
  size: SpineSize;
  stackWidth: number;
  scale: number;
  label?: ReactNode;
  count?: number;
  ariaLabel: string;
  photo: boolean;
  openBookId: string | null;
  onOpen: (book: BookDTO) => void;
  eager: boolean;
  /** piles with index below this start mounted */
  initialStacks: number;
}

/**
 * One bookcase of the lying arrangement: the walnut <Shelf> with piles of books lying on their sides. The planks
 * are only as high as the case's tallest pile needs (a few short piles do not stand in tall empty bays).
 */
export const StackCase = memo(function StackCase({ group, size, stackWidth, scale, label, count, ariaLabel, photo, openBookId, onOpen, eager, initialStacks }: StackCaseProps) {
  const tallest = group.stacks.reduce((max, s) => Math.max(max, s.height), 0);
  const contentHeight = Math.min(SPINE_SIZES[size].height, tallest + 4);
  const rowHeight = contentHeight + SHELF_GEOMETRY[size].headroom + SHELF_GEOMETRY[size].plank;
  return (
    <div className="-mx-2 overflow-x-clip px-2">
      <div className="exl-shelf-case relative">
        <LampLight rowHeight={rowHeight} />
        <Shelf size={size} label={label} count={count} aria-label={ariaLabel} photo={photo} contentHeight={contentHeight}>
          {group.stacks.map((stack, i) => (
            <Pile
              key={stack.key}
              stack={stack}
              width={stackWidth}
              scale={scale}
              pulledId={openBookId && stack.books.some((b) => b.book.id === openBookId) ? openBookId : null}
              onOpen={onOpen}
              eager={eager}
              initiallyNear={i < initialStacks}
            />
          ))}
        </Shelf>
      </div>
    </div>
  );
});

const Pile = memo(function Pile({
  stack,
  width,
  scale,
  pulledId,
  onOpen,
  eager,
  initiallyNear,
}: {
  stack: BookStack;
  width: number;
  scale: number;
  pulledId: string | null;
  onOpen: (book: BookDTO) => void;
  eager: boolean;
  initiallyNear: boolean;
}) {
  const [ref, near] = useNearViewport<HTMLDivElement>({ rootMargin: '140% 0px', initial: eager || initiallyNear });
  const live = eager || near;
  return (
    <div ref={ref} className="relative flex flex-col-reverse items-center" style={{ width }}>
      {stack.books.map((b) => (
        <FlatSpine
          key={b.book.id}
          book={b.book}
          scale={scale}
          shift={b.shift}
          pulled={pulledId === b.book.id}
          onOpen={onOpen}
          placeholder={!live}
          className="exl-rs"
          style={reshelveStyle(b.index)}
        />
      ))}
      <span aria-hidden="true" className="exl-dust" style={{ '--rs-plank': '0px' } as CSSProperties} />
    </div>
  );
});
