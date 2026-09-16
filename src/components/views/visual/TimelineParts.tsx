'use client';

/**
 * Building blocks of the timeline view: lying spines stacked in piles, the decade histogram,
 * the oldest / newest markers and the "unknown year" tray.
 */
import { FlagTriangleRight, Sparkles } from 'lucide-react';
import { memo, useMemo } from 'react';
import { BookSpine } from '@/components/books';
import { spineBox, type SpineSize } from '@/components/books/spine-layout';
import { Button } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { useUiTranslator } from '@/components/ui/hooks';
import { hash01 } from '@/lib/book-utils';
import type { BookDTO } from '@/lib/types';
import { decadeLabel, yearLabel, type HistogramBin } from './timeline-layout';

/* ------------------------------------------------------------------ */
/* Piles                                                               */
/* ------------------------------------------------------------------ */

/**
 * A spine lying on its side (rotated 90° clockwise, so the title reads left to right), wrapped in
 * a box of the rotated size. Hovering slides it out of the pile.
 */
export const LyingSpine = memo(function LyingSpine({
  book,
  size,
  pulled,
  onOpen,
}: {
  book: BookDTO;
  size: SpineSize;
  pulled: boolean;
  onOpen: (book: BookDTO) => void;
}) {
  const { width, height } = spineBox(book, size);
  // a little irregularity, as in a real pile
  const shift = Math.round(hash01(book.id, 41) * (size === 'xs' ? 5 : 9));
  return (
    <div className="relative shrink-0" style={{ width: height, height: width, marginLeft: shift }}>
      <div
        className="absolute top-0 left-0"
        style={{ width, height, transformOrigin: '0 0', transform: `translateX(${height}px) rotate(90deg)` }}
      >
        <BookSpine book={book} size={size} pulled={pulled} onClick={onOpen} />
      </div>
    </div>
  );
});

/** One pile, oldest at the bottom. */
export function Pile({ books, size, openBookId, onOpen }: { books: BookDTO[]; size: SpineSize; openBookId: string | null; onOpen: (book: BookDTO) => void }) {
  return (
    <div className="flex flex-col-reverse items-start" role="presentation">
      {books.map((book) => (
        <div key={book.id} role="listitem">
          <LyingSpine book={book} size={size} pulled={openBookId === book.id} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}

/** A flag above the column that holds the oldest / newest book. */
export function PeriodFlag({ kind }: { kind: 'oldest' | 'newest' }) {
  const { t } = useUiTranslator();
  return (
    <span
      className={cn(
        'pointer-events-none inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap shadow-soft',
        kind === 'oldest'
          ? 'border-[color-mix(in_oklab,var(--burgundy)_40%,transparent)] bg-surface text-burgundy'
          : 'border-[color-mix(in_oklab,var(--primary)_40%,transparent)] bg-surface text-primary',
      )}
    >
      {kind === 'oldest' ? <FlagTriangleRight className="size-3" aria-hidden="true" /> : <Sparkles className="size-3" aria-hidden="true" />}
      {t(kind === 'oldest' ? 'visual.timeline.oldest' : 'visual.timeline.newest')}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Histogram                                                           */
/* ------------------------------------------------------------------ */

export function DecadeHistogram({
  bins,
  max,
  onSelect,
  activeDecades,
}: {
  bins: HistogramBin[];
  max: number;
  onSelect: (decade: number) => void;
  /** decades currently highlighted (e.g. filter) */
  activeDecades: ReadonlySet<number>;
}) {
  const { t, tp } = useUiTranslator();
  if (bins.length === 0 || max === 0) return null;
  const first = bins[0].decade;
  const last = bins[bins.length - 1].decade;
  return (
    <figure className="mb-6">
      <figcaption className="sr-only">{t('visual.timeline.histogram')}</figcaption>
      <div className="flex h-16 items-end gap-px rounded-lg border border-line bg-surface px-2 pt-2" role="list" aria-label={t('visual.timeline.histogram')}>
        {bins.map((bin) => {
          const label = decadeLabel(bin.decade, t);
          const h = bin.count === 0 ? 2 : Math.max(4, Math.round((bin.count / max) * 52));
          return (
            <div key={bin.decade} role="listitem" className="flex h-full min-w-[3px] flex-1 items-end">
              <button
                type="button"
                disabled={bin.count === 0}
                onClick={() => onSelect(bin.decade)}
                title={t('visual.timeline.histogramBar', { label, books: tp('common.unit.book', bin.count) })}
                aria-label={t('visual.timeline.histogramBar', { label, books: tp('common.unit.book', bin.count) })}
                className={cn(
                  'w-full cursor-pointer rounded-t-[2px] transition-[background-color,transform] duration-150 disabled:cursor-default',
                  bin.count === 0
                    ? 'bg-line'
                    : activeDecades.has(bin.decade)
                      ? 'bg-accent'
                      : 'bg-[color-mix(in_oklab,var(--primary),transparent_25%)] hover:bg-accent',
                )}
                style={{ height: h }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[0.6875rem] text-muted tabular-nums" aria-hidden="true">
        <span>{yearLabel(first, t)}</span>
        {bins.length > 6 ? <span>{yearLabel(bins[Math.floor(bins.length / 2)].decade, t)}</span> : null}
        <span>{yearLabel(last, t)}</span>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Oldest / newest                                                     */
/* ------------------------------------------------------------------ */

export function ExtremeCard({ kind, book, onOpen }: { kind: 'oldest' | 'newest'; book: BookDTO; onOpen: (book: BookDTO) => void }) {
  const { t } = useUiTranslator();
  return (
    <button
      type="button"
      onClick={() => onOpen(book)}
      className="group flex min-w-0 flex-1 items-center gap-3 rounded-card border border-line bg-surface px-3 py-2.5 text-left shadow-soft transition-[border-color,box-shadow] hover:border-accent hover:shadow-lift"
    >
      <BookSpine book={book} size="xs" decorative />
      <span className="flex min-w-0 flex-col">
        <span className={cn('text-[0.6875rem] font-semibold tracking-wide uppercase', kind === 'oldest' ? 'text-burgundy' : 'text-primary')}>
          {t(kind === 'oldest' ? 'visual.timeline.oldest' : 'visual.timeline.newest')}
          {book.firstPublishedYear !== null ? <span className="ml-1.5 font-display text-sm tracking-normal text-ink normal-case tabular-nums">{yearLabel(book.firstPublishedYear, t)}</span> : null}
        </span>
        <span className="truncate font-display text-[0.9375rem] font-semibold text-ink group-hover:text-accent">{book.title}</span>
        {book.author ? <span className="truncate text-xs text-muted">{book.author}</span> : null}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Unknown year tray                                                   */
/* ------------------------------------------------------------------ */

const TRAY_LIMIT = 48;

export function UnknownYearTray({
  books,
  hint,
  showAll,
  onShowAll,
  openBookId,
  onOpen,
  size,
}: {
  books: BookDTO[];
  hint: string;
  showAll: boolean;
  onShowAll: () => void;
  openBookId: string | null;
  onOpen: (book: BookDTO) => void;
  size: SpineSize;
}) {
  const { t, tp, n } = useUiTranslator();
  const shown = useMemo(() => (showAll ? books : books.slice(0, TRAY_LIMIT)), [books, showAll]);
  if (books.length === 0) return null;
  return (
    <section aria-label={t('visual.timeline.unknown.title')} className="mt-10">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-lg font-semibold text-ink">{t('visual.timeline.unknown.title')}</h3>
        <span className="text-sm text-muted tabular-nums">{tp('common.unit.book', books.length)}</span>
      </header>
      <p className="mb-4 max-w-2xl text-sm text-muted text-pretty">{hint}</p>
      <div
        className="rounded-[6px] px-3 pt-4 shadow-[inset_0_8px_16px_rgb(0_0_0/0.35)]"
        style={{
          background: 'linear-gradient(180deg, color-mix(in oklab, var(--wood-dark), black 35%), var(--wood-dark))',
          borderBottom: '12px solid var(--wood)',
        }}
      >
        <div role="list" className="flex flex-wrap items-end gap-x-0.5 gap-y-3">
          {shown.map((book) => (
            <div key={book.id} role="listitem" className="flex items-end">
              <BookSpine book={book} size={size} pulled={openBookId === book.id} onClick={onOpen} />
            </div>
          ))}
        </div>
        <div className="h-1" />
      </div>
      {!showAll && books.length > TRAY_LIMIT ? (
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" size="sm" onClick={onShowAll}>
            {t('visual.timeline.unknown.showAll', { count: n(books.length) })}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

