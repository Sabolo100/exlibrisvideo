'use client';

import { Children, isValidElement, useMemo, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { useUiTranslator } from '@/components/ui/hooks';
import type { BookDTO } from '@/lib/types';
import { BookSpine } from './BookSpine';
import { ShelfContext } from './shelf-context';
import { SHELF_GEOMETRY, SPINE_SIZES, shelfRowHeight, type SpineSize } from './spine-layout';

export interface ShelfProps {
  /** books to render as spines (in the given order) */
  books?: BookDTO[];
  /** custom items instead of / after `books` (BookSpine elements, or anything bottom-aligned) */
  children?: ReactNode;
  size?: SpineSize;
  /** show real spine photos where available */
  photo?: boolean;
  /** click handler for spines rendered from `books` (makes them interactive) */
  onBookClick?: (book: BookDTO) => void;
  /** id of the book drawn out of the shelf */
  pulledId?: string | null;
  /** render a book yourself (wrap with Tooltip, add badges …); receives the default spine */
  renderBook?: (book: BookDTO, spine: ReactNode, index: number) => ReactNode;
  /** brass label plate on the top board, e.g. a topic or author initial */
  label?: ReactNode;
  /** small count on the plate */
  count?: number;
  /** metal bookends at the start and end */
  bookends?: boolean;
  /** accessible name of the shelf (defaults to the label text or "Könyvespolc") */
  'aria-label'?: string;
  /** shown when there is nothing on the shelf */
  emptyLabel?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function grainSvg(row: number, plank: number): string {
  const y = row - plank;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='${row}' viewBox='0 0 400 ${row}' preserveAspectRatio='none'><filter id='g' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='0.004 0.55' numOctaves='3' seed='7'/><feColorMatrix values='0 0 0 0 0.12  0 0 0 0 0.07  0 0 0 0 0.03  0 0 0 1.6 -0.55'/></filter><rect x='0' y='${y + 3}' width='400' height='${plank - 4}' filter='url(#g)' opacity='0.55'/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/** Cast-bronze bookend seen from the front: an arched plate with a brass rim and a gilt boss. */
function Bookend({ side, size }: { side: 'start' | 'end'; size: SpineSize }) {
  const h = Math.round(SPINE_SIZES[size].height * 0.56);
  const w = Math.round(SPINE_SIZES[size].width * (size === 'xs' ? 0.9 : 0.72));
  const boss = Math.max(3, Math.round(w * 0.32));
  return (
    <span
      aria-hidden="true"
      className="relative block shrink-0"
      style={{
        width: w,
        height: h,
        marginLeft: side === 'start' ? 2 : 5,
        marginRight: side === 'start' ? 5 : 2,
        borderRadius: `${w / 2}px ${w / 2}px 2px 2px`,
        background:
          'radial-gradient(120% 60% at 30% 18%, rgb(255 236 190 / 0.35), transparent 55%), linear-gradient(90deg, #2a2019 0%, #6b5238 34%, #4a3826 62%, #1d1510 100%)',
        boxShadow:
          'inset 0 0 0 1px rgb(214 170 92 / 0.55), inset 0 2px 0 rgb(255 230 170 / 0.25), 3px 3px 6px rgb(0 0 0 / 0.45)',
      }}
    >
      <span
        className="absolute left-1/2 block -translate-x-1/2 rounded-full"
        style={{
          top: Math.round(w * 0.42),
          width: boss,
          height: boss,
          background: 'radial-gradient(circle at 35% 35%, #fbe7ad, #b8893a 60%, #6e4f1c)',
          boxShadow: '0 1px 1px rgb(0 0 0 / 0.5)',
        }}
      />
      <span
        className="absolute inset-x-[18%] block rounded-full"
        style={{ bottom: Math.round(h * 0.12), height: 1, background: 'rgb(214 170 92 / 0.6)' }}
      />
    </span>
  );
}

/**
 * A walnut bookcase shelf: back panel, top board, side walls and one plank per wrapped row.
 * Spines are bottom-aligned and wrap onto additional planks responsively (pure CSS – every row
 * has the same height, the planks are a repeating background of that height).
 */
export function Shelf({
  books,
  children,
  size = 'md',
  photo = false,
  onBookClick,
  pulledId,
  renderBook,
  label,
  count,
  bookends = false,
  'aria-label': ariaLabel,
  emptyLabel,
  className,
  style,
}: ShelfProps) {
  const { t, n } = useUiTranslator();
  const g = SHELF_GEOMETRY[size];
  const row = shelfRowHeight(size);
  const plank = g.plank;
  const hasLabel = label !== undefined && label !== null && label !== false;
  const plateH = size === 'xs' ? 16 : size === 'sm' ? 20 : 26;
  const topBoard = hasLabel ? plateH + (size === 'xs' ? 6 : 10) : g.top;

  const background = useMemo(() => {
    const y = row - plank;
    // one tile per row: shadow under the board above, book contact shadow, plank top face, front edge
    const layers = [
      `linear-gradient(180deg, rgb(0 0 0 / 0.5) 0px, rgb(0 0 0 / 0.18) ${Math.round(g.headroom * 0.6)}px, transparent ${g.headroom + 6}px)`,
      `linear-gradient(180deg, transparent ${y - 12}px, rgb(0 0 0 / 0.32) ${y}px, transparent ${y}px)`,
      grainSvg(row, plank),
      `linear-gradient(180deg, transparent ${y}px, var(--wood-light) ${y}px, color-mix(in oklab, var(--wood-light), white 12%) ${y + 3}px, color-mix(in oklab, var(--wood-light), white 22%) ${y + 3}px, color-mix(in oklab, var(--wood-light), white 22%) ${y + 4}px, var(--wood) ${y + 5}px, var(--wood) ${row - Math.round(plank * 0.35)}px, var(--wood-dark) ${row - 2}px, rgb(0 0 0 / 0.55) ${row - 2}px, rgb(0 0 0 / 0.55) ${row}px)`,
    ];
    return {
      backgroundImage: layers.join(', '),
      backgroundSize: `100% ${row}px`,
      backgroundRepeat: 'repeat-y',
    } satisfies CSSProperties;
  }, [row, plank, g.headroom]);

  const items: ReactNode[] = [];
  books?.forEach((book, i) => {
    const spine = (
      <BookSpine
        key={book.id}
        book={book}
        size={size}
        photo={photo}
        pulled={pulledId === book.id}
        onClick={onBookClick ? (b) => onBookClick(b) : undefined}
      />
    );
    items.push(renderBook ? <span key={book.id} className="contents">{renderBook(book, spine, i)}</span> : spine);
  });
  Children.forEach(children, (child) => {
    if (child !== null && child !== undefined && child !== false) items.push(child);
  });

  const labelText = typeof label === 'string' ? label : undefined;
  const name = ariaLabel ?? labelText ?? t('common.aria.bookshelf');
  const empty = items.length === 0;

  return (
    <ShelfContext.Provider value={{ size, photo }}>
      <section
        aria-label={name}
        className={cn(
          'exl-shelf relative w-full rounded-[6px] shadow-[0_2px_4px_hsl(var(--shadow-color)/0.25),0_18px_40px_-12px_hsl(var(--shadow-color)/0.45)]',
          className,
        )}
        style={{
          paddingTop: topBoard,
          paddingLeft: g.side,
          paddingRight: g.side,
          background:
            'linear-gradient(90deg, var(--wood-dark) 0%, var(--wood) 4%, color-mix(in oklab, var(--wood), var(--wood-light) 45%) 50%, var(--wood) 96%, var(--wood-dark) 100%)',
          ...style,
        }}
      >
        {/* top board highlight */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 rounded-t-[6px]"
          style={{
            height: topBoard,
            background:
              'linear-gradient(180deg, color-mix(in oklab, var(--wood-light), white 10%) 0px, var(--wood) 3px, var(--wood) 60%, var(--wood-dark) 100%)',
          }}
        />
        {hasLabel ? (
          <span
            className="absolute left-1/2 z-[1] flex max-w-[70%] -translate-x-1/2 items-center gap-2 rounded-[3px] px-3 whitespace-nowrap"
            style={{
              top: Math.round((topBoard - plateH) / 2),
              height: plateH,
              background: 'linear-gradient(180deg, #f1d796 0%, #d0a652 45%, #b58a3b 55%, #dcb86e 100%)',
              boxShadow: 'inset 0 1px 0 rgb(255 248 220 / 0.7), inset 0 -1px 0 rgb(90 60 15 / 0.45), 0 1px 2px rgb(0 0 0 / 0.5)',
            }}
          >
            <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_35%,#fff3cf,#7a5a20)]" />
            <span
              className={cn(
                'truncate font-display font-semibold tracking-[0.06em] text-[#3b2a0e] [text-shadow:0_1px_0_rgb(255_240_200/0.55)]',
                size === 'xs' ? 'text-[0.625rem]' : size === 'sm' ? 'text-xs' : 'text-sm',
              )}
            >
              {label}
            </span>
            {typeof count === 'number' ? (
              <span className="shrink-0 font-sans text-[0.6875rem] font-semibold text-[#5a4217] tabular-nums">{n(count)}</span>
            ) : null}
            <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_35%,#fff3cf,#7a5a20)]" />
          </span>
        ) : null}
        {/* back panel */}
        <div
          className="relative overflow-visible"
          style={{
            backgroundColor: 'color-mix(in oklab, var(--wood-dark), black 38%)',
            backgroundImage:
              'radial-gradient(120% 90% at 50% 0%, rgb(255 220 160 / 0.07), transparent 70%), repeating-linear-gradient(90deg, rgb(255 255 255 / 0.018) 0 2px, transparent 2px 11px)',
          }}
        >
          <div
            role={empty ? undefined : 'list'}
            className="flex flex-wrap content-start items-end"
            style={{ ...background, columnGap: size === 'xs' ? 1 : 2, paddingInline: size === 'xs' ? 4 : 10, minHeight: row }}
          >
            {bookends && !empty ? (
              <div aria-hidden="true" className="flex items-end" style={{ height: row, paddingBottom: plank - 2 }}>
                <Bookend side="start" size={size} />
              </div>
            ) : null}
            {items.map((item, i) => (
              <div
                key={isValidElement(item) && item.key !== null ? item.key : i}
                role="listitem"
                className="flex items-end"
                style={{ height: row, paddingTop: g.headroom, paddingBottom: plank - 2 }}
              >
                {item}
              </div>
            ))}
            {bookends && !empty ? (
              <div aria-hidden="true" className="flex items-end" style={{ height: row, paddingBottom: plank - 2 }}>
                <Bookend side="end" size={size} />
              </div>
            ) : null}
            {empty ? (
              <div
                className="flex w-full items-center justify-center text-center text-sm text-[#e9dcc3]/70 italic"
                style={{ height: row, paddingBottom: plank }}
              >
                {emptyLabel ?? t('common.shelf.empty')}
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </ShelfContext.Provider>
  );
}
