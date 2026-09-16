'use client';

/**
 * View 6 – timeline of first-publication years. Desktop: a horizontal axis with century bands and
 * decade (or century) columns in which the books lie in small piles. Mobile: the same periods as a
 * vertical list with upright spines. Histogram strip, oldest / newest markers, zoom and an
 * "unknown year" tray. Columns are capped (+N expands, the label filters by that period).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { SpineSize } from '@/components/books/spine-layout';
import { BookSpine } from '@/components/books';
import { useCollection } from '@/components/collection/context';
import { EmptyState, IconButton, SegmentedControl } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { useMediaQuery, useUiTranslator } from '@/components/ui/hooks';
import type { BookDTO, Locale } from '@/lib/types';
import { ViewOptionsBar, VisualEmptyState } from './visual/common';
import { isOneOf, scrollBehavior, useLatest, useStoredState } from './visual/hooks';
import { SpineHoverCard } from './visual/SpineHoverCard';
import {
  bandGapYears,
  buildTimeline,
  centuryLabel,
  columnLabel,
  decadeLabel,
  splitPiles,
  TIMELINE_ZOOMS,
  yearLabel,
  type TimelineColumn,
  type TimelineZoom,
} from './visual/timeline-layout';
import { DecadeHistogram, ExtremeCard, PeriodFlag, Pile, UnknownYearTray } from './visual/TimelineParts';

type Translate = ReturnType<typeof useUiTranslator>['t'];

const isZoom = isOneOf(TIMELINE_ZOOMS);

/** Pile geometry per zoom: lying spine size, books per pile, piles shown before "+N". */
const PILES: Record<TimelineZoom, { size: SpineSize; perPile: number; maxPiles: number; mobileSize: SpineSize; mobileMax: number }> = {
  decade: { size: 'sm', perPile: 12, maxPiles: 2, mobileSize: 'sm', mobileMax: 24 },
  century: { size: 'xs', perPile: 18, maxPiles: 3, mobileSize: 'xs', mobileMax: 60 },
};

function decadesOf(column: Pick<TimelineColumn, 'start' | 'span'>): number[] {
  if (column.span === 10) return [column.start];
  return Array.from({ length: 10 }, (_, i) => column.start + i * 10);
}

export function TimelineView() {
  const { collection, visibleBooks, locale, isOwner, openBook, openBookId, filters, setFilters } = useCollection();
  const { t, tp, n } = useUiTranslator();
  const desktop = useMediaQuery('(min-width: 768px)');
  const [zoom, setZoom] = useStoredState<TimelineZoom>('exl.visual.timeline.zoom', 'decade', isZoom);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [showAllUnknown, setShowAllUnknown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const model = useMemo(() => buildTimeline(visibleBooks, zoom, locale), [visibleBooks, zoom, locale]);
  const booksById = useMemo(() => new Map(visibleBooks.map((b) => [b.id, b])), [visibleBooks]);

  const openRef = useLatest(openBook);
  const onOpen = useCallback((book: BookDTO) => openRef.current(book.id), [openRef]);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const activeDecades = useMemo(() => new Set(filters.decades), [filters.decades]);
  const togglePeriodFilter = useCallback(
    (column: Pick<TimelineColumn, 'start' | 'span'>) => {
      const decades = decadesOf(column);
      const same = decades.length === filters.decades.length && decades.every((d) => activeDecades.has(d));
      setFilters({ decades: same ? [] : decades });
    },
    [filters.decades, activeDecades, setFilters],
  );

  // enrichment (which fills in the years) runs while the collection is processing; once it is
  // ready, books without a year stay so (manual additions are not enriched)
  const enrichmentPending = collection.status === 'processing' || collection.status === 'draft';
  const unknownHint = enrichmentPending
    ? t('visual.timeline.unknown.pending')
    : isOwner
      ? t('visual.timeline.unknown.owner')
      : t('visual.timeline.unknown.done');

  const scrollToDecade = useCallback(
    (decade: number) => {
      const root = desktop ? scrollerRef.current : containerRef.current;
      if (!root) return;
      const cols = Array.from(root.querySelectorAll<HTMLElement>('[data-col-start]'));
      if (cols.length === 0) return;
      // the column containing the decade, else the nearest one
      let best = cols[0];
      let bestDist = Number.POSITIVE_INFINITY;
      for (const el of cols) {
        const start = Number(el.dataset.colStart);
        const span = Number(el.dataset.colSpan);
        const dist = decade >= start && decade < start + span ? 0 : Math.min(Math.abs(decade - start), Math.abs(decade - (start + span - 10)));
        if (dist < bestDist) {
          best = el;
          bestDist = dist;
        }
      }
      if (desktop && scrollerRef.current) {
        const scroller = scrollerRef.current;
        const left = best.offsetLeft - scroller.clientWidth / 2 + best.offsetWidth / 2;
        scroller.scrollTo({ left: Math.max(0, left), behavior: scrollBehavior() });
        best.animate?.([{ backgroundColor: 'color-mix(in oklab, var(--accent), transparent 80%)' }, { backgroundColor: 'transparent' }], { duration: 1200, easing: 'ease-out' });
      } else {
        best.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
      }
    },
    [desktop],
  );

  const options = (
    <ViewOptionsBar>
      <SegmentedControl<TimelineZoom>
        aria-label={t('visual.timeline.zoom')}
        size="sm"
        value={zoom}
        onChange={(z) => {
          setZoom(z);
          setExpanded(new Set());
        }}
        options={[
          { value: 'century', label: t('visual.timeline.zoom.century') },
          { value: 'decade', label: t('visual.timeline.zoom.decade') },
        ]}
      />
      {model.oldest && model.newest && model.oldest.firstPublishedYear !== null && model.newest.firstPublishedYear !== null ? (
        <p className="text-sm text-muted">
          {t('visual.timeline.summary', {
            books: tp('common.unit.book', model.dated),
            from: yearLabel(model.oldest.firstPublishedYear, t),
            to: yearLabel(model.newest.firstPublishedYear, t),
          })}
        </p>
      ) : null}
    </ViewOptionsBar>
  );

  if (visibleBooks.length === 0) {
    return (
      <section aria-label={t('visual.timeline.label')}>
        <VisualEmptyState />
      </section>
    );
  }

  const trayBooks = model.unknown;

  return (
    <section aria-label={t('visual.timeline.label')} className="exl-timeline-view">
      {options}
      <div ref={containerRef} className="relative">
        {model.dated === 0 ? (
          <EmptyState
            title={t('visual.timeline.empty.title')}
            description={
              enrichmentPending
                ? t('visual.timeline.empty.pending')
                : isOwner
                  ? t('visual.timeline.empty.owner')
                  : t('visual.timeline.empty.done')
            }
          />
        ) : (
          <>
            {model.oldest && model.newest && model.oldest.id !== model.newest.id ? (
              <div className="mb-5 flex flex-col gap-3 sm:flex-row">
                <ExtremeCard kind="oldest" book={model.oldest} onOpen={onOpen} />
                <ExtremeCard kind="newest" book={model.newest} onOpen={onOpen} />
              </div>
            ) : null}
            <DecadeHistogram bins={model.histogram} max={model.maxBin} onSelect={scrollToDecade} activeDecades={activeDecades} />
            {desktop ? (
              <DesktopAxis
                scrollerRef={scrollerRef}
                model={model}
                zoom={zoom}
                locale={locale}
                t={t}
                tp={tp}
                n={n}
                openBookId={openBookId}
                onOpen={onOpen}
                expanded={expanded}
                onToggleExpanded={toggleExpanded}
                onFilter={togglePeriodFilter}
                activeDecades={activeDecades}
              />
            ) : (
              <MobileAxis
                model={model}
                zoom={zoom}
                locale={locale}
                t={t}
                tp={tp}
                n={n}
                openBookId={openBookId}
                onOpen={onOpen}
                expanded={expanded}
                onToggleExpanded={toggleExpanded}
                onFilter={togglePeriodFilter}
                activeDecades={activeDecades}
              />
            )}
          </>
        )}
        <UnknownYearTray
          books={trayBooks}
          hint={unknownHint}
          showAll={showAllUnknown}
          onShowAll={() => setShowAllUnknown(true)}
          openBookId={openBookId}
          onOpen={onOpen}
          size={desktop ? 'sm' : 'xs'}
        />
        <SpineHoverCard containerRef={containerRef} booksById={booksById} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop: horizontal axis                                            */
/* ------------------------------------------------------------------ */

interface AxisProps {
  model: ReturnType<typeof buildTimeline>;
  zoom: TimelineZoom;
  locale: Locale;
  t: Translate;
  tp: ReturnType<typeof useUiTranslator>['tp'];
  n: ReturnType<typeof useUiTranslator>['n'];
  openBookId: string | null;
  onOpen: (book: BookDTO) => void;
  expanded: ReadonlySet<string>;
  onToggleExpanded: (key: string) => void;
  onFilter: (column: Pick<TimelineColumn, 'start' | 'span'>) => void;
  activeDecades: ReadonlySet<number>;
}

function isFiltered(column: Pick<TimelineColumn, 'start' | 'span'>, active: ReadonlySet<number>): boolean {
  const decades = decadesOf(column);
  return decades.length === active.size && decades.every((d) => active.has(d));
}

function DesktopAxis({ scrollerRef, model, zoom, locale, t, tp, n, openBookId, onOpen, expanded, onToggleExpanded, onFilter, activeDecades }: AxisProps & { scrollerRef: RefObject<HTMLDivElement | null> }) {
  const [edges, setEdges] = useState({ left: false, right: false });
  const cfg = PILES[zoom];

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const left = el.scrollLeft > 4;
        const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
        setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
      });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [scrollerRef, model, zoom, expanded]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: scrollBehavior() });
  };

  return (
    <div className="relative">
      {edges.left ? (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-20 flex w-16 items-center bg-gradient-to-r from-bg to-transparent pl-1">
          <IconButton className="pointer-events-auto" variant="secondary" size="sm" round icon={<ChevronLeft />} aria-label={t('common.action.back')} onClick={() => scrollBy(-1)} />
        </div>
      ) : null}
      {edges.right ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-20 flex w-16 items-center justify-end bg-gradient-to-l from-bg to-transparent pr-1">
          <IconButton className="pointer-events-auto" variant="secondary" size="sm" round icon={<ChevronRight />} aria-label={t('common.action.next')} onClick={() => scrollBy(1)} />
        </div>
      ) : null}
      <div ref={scrollerRef} className="overflow-x-auto overscroll-x-contain pb-3 [scrollbar-width:thin]" tabIndex={-1}>
        {/* w-max: grows with the axis (scrolls); min-w-full + justify-center: short axes sit centred */}
        <div className="flex w-max min-w-full items-stretch justify-center px-2 pt-10">
          {model.bands.map((band, b) => {
            const gap = b > 0 ? bandGapYears(model.bands[b - 1].century, band.century) : 0;
            return (
              <Fragment key={band.century}>
                {gap > 0 ? <AxisGap years={gap} t={t} /> : null}
                <section
                  aria-label={`${centuryLabel(band.century, locale, t)}, ${tp('common.unit.book', band.count)}`}
                  className="flex flex-col"
                >
                  <div className="flex flex-1 items-stretch">
                    {band.columns.map((column) => {
                      const isExpanded = expanded.has(column.key);
                      const { piles, hidden } = splitPiles(column.books, cfg.perPile, isExpanded ? undefined : cfg.maxPiles);
                      const label = columnLabel(column, locale, t);
                      const hasOldest = model.oldest !== null && column.books.includes(model.oldest);
                      const hasNewest = model.newest !== null && model.newest !== model.oldest && column.books.includes(model.newest);
                      const filtered = isFiltered(column, activeDecades);
                      return (
                        <div
                          key={column.key}
                          data-col-start={column.start}
                          data-col-span={column.span}
                          role="group"
                          aria-label={t('visual.timeline.column', { label, books: tp('common.unit.book', column.books.length) })}
                          className={cn('flex flex-col rounded-t-lg transition-colors', column.books.length === 0 ? 'w-12' : 'px-3')}
                        >
                          <div className="relative flex flex-1 items-end justify-center gap-3 border-b-2 border-[color-mix(in_oklab,var(--ink),transparent_72%)] pb-0.5">
                            {hasOldest || hasNewest ? (
                              <span className="absolute bottom-full left-1/2 mb-1.5 flex -translate-x-1/2 gap-1">
                                {hasOldest ? <PeriodFlag kind="oldest" /> : null}
                                {hasNewest ? <PeriodFlag kind="newest" /> : null}
                              </span>
                            ) : null}
                            {piles.length > 0 ? (
                              <div role="list" className="flex items-end gap-3">
                                {piles.map((pile, i) => (
                                  <Pile key={i} books={pile} size={cfg.size} openBookId={openBookId} onOpen={onOpen} />
                                ))}
                              </div>
                            ) : null}
                            {hidden > 0 || isExpanded ? (
                              <button
                                type="button"
                                onClick={() => onToggleExpanded(column.key)}
                                aria-expanded={isExpanded}
                                className="mb-1 inline-flex h-7 shrink-0 cursor-pointer items-center self-end rounded-full border border-line bg-surface px-2.5 text-xs font-semibold whitespace-nowrap text-ink shadow-soft transition-colors hover:border-accent hover:text-accent"
                              >
                                {isExpanded ? t('visual.timeline.less') : t('visual.timeline.more', { count: n(hidden) })}
                              </button>
                            ) : null}
                          </div>
                          <div className="flex flex-col items-center pt-1">
                            <span aria-hidden="true" className="h-2 w-px bg-[color-mix(in_oklab,var(--ink),transparent_60%)]" />
                            <button
                              type="button"
                              disabled={column.books.length === 0}
                              onClick={() => onFilter(column)}
                              title={t('visual.timeline.filterPeriod', { label })}
                              aria-pressed={filtered}
                              className={cn(
                                'mt-0.5 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap tabular-nums transition-colors disabled:cursor-default',
                                column.books.length === 0 ? 'text-muted/70' : 'cursor-pointer font-semibold text-ink hover:bg-surface-2 hover:text-accent',
                                filtered && 'bg-accent-soft text-accent',
                              )}
                            >
                              {column.span === 10 ? yearLabel(column.start, t) : label}
                            </button>
                            {column.books.length > 0 ? (
                              <span className="text-[0.6875rem] text-muted tabular-nums">{column.books.length}</span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {zoom === 'decade' ? (
                    <div className="mx-2 mt-2 border-t border-line pt-1.5 text-center">
                      <span className="font-display text-sm font-semibold text-ink">{centuryLabel(band.century, locale, t)}</span>
                      <span className="ml-2 text-xs text-muted tabular-nums">{tp('common.unit.book', band.count)}</span>
                    </div>
                  ) : null}
                </section>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AxisGap({ years, t }: { years: number; t: Translate }) {
  return (
    <div className="flex w-14 shrink-0 flex-col" aria-label={t('visual.timeline.gap', { years })} role="separator">
      <div className="flex flex-1 items-end justify-center border-b-2 border-dashed border-[color-mix(in_oklab,var(--ink),transparent_78%)]">
        <span aria-hidden="true" className="mb-1 font-display text-lg text-muted">≈</span>
      </div>
      <span className="px-0.5 pt-2 text-center text-[0.625rem] leading-tight text-muted">{t('visual.timeline.gap', { years })}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile: vertical list                                               */
/* ------------------------------------------------------------------ */

function MobileAxis({ model, zoom, locale, t, tp, n, openBookId, onOpen, expanded, onToggleExpanded, onFilter, activeDecades }: AxisProps) {
  const cfg = PILES[zoom];
  return (
    <ol className="relative flex flex-col gap-8">
      {model.bands.map((band, b) => {
        const gap = b > 0 ? bandGapYears(model.bands[b - 1].century, band.century) : 0;
        const columns = band.columns.filter((c) => c.books.length > 0);
        return (
          <li key={band.century}>
            {gap > 0 ? <p className="mb-6 pl-6 text-xs text-muted italic">≈ {t('visual.timeline.gap', { years: gap })}</p> : null}
            {/* century zoom: the single column below already carries the century label */}
            {zoom === 'decade' ? (
              <h3 className="mb-3 flex items-baseline gap-2">
                <span className="font-display text-xl font-semibold text-ink">{centuryLabel(band.century, locale, t)}</span>
                <span className="text-xs text-muted tabular-nums">{tp('common.unit.book', band.count)}</span>
              </h3>
            ) : null}
            <div className="flex flex-col gap-5 border-l-2 border-[color-mix(in_oklab,var(--accent),transparent_55%)] pl-5">
              {columns.map((column) => {
                const isExpanded = expanded.has(column.key);
                const shown = isExpanded ? column.books : column.books.slice(0, cfg.mobileMax);
                const hidden = column.books.length - shown.length;
                const label = zoom === 'decade' ? decadeLabel(column.start, t) : centuryLabel(column.start, locale, t);
                const hasOldest = model.oldest !== null && column.books.includes(model.oldest);
                const hasNewest = model.newest !== null && model.newest !== model.oldest && column.books.includes(model.newest);
                return (
                  <div key={column.key} data-col-start={column.start} data-col-span={column.span} className="relative">
                    <span aria-hidden="true" className="absolute top-1.5 -left-[1.6875rem] size-3 rounded-full border-2 border-bg bg-accent" />
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onFilter(column)}
                        aria-pressed={isFiltered(column, activeDecades)}
                        title={t('visual.timeline.filterPeriod', { label })}
                        className={cn(
                          'rounded-md font-display font-semibold text-ink',
                          zoom === 'century' ? 'text-xl' : 'text-base',
                          isFiltered(column, activeDecades) && 'bg-accent-soft px-1.5 text-accent',
                        )}
                      >
                        {label}
                      </button>
                      <span className="text-xs text-muted tabular-nums">{tp('common.unit.book', column.books.length)}</span>
                      {hasOldest ? <PeriodFlag kind="oldest" /> : null}
                      {hasNewest ? <PeriodFlag kind="newest" /> : null}
                    </div>
                    <div role="list" aria-label={t('visual.timeline.column', { label, books: tp('common.unit.book', column.books.length) })} className="flex flex-wrap items-end gap-x-0.5 gap-y-2">
                      {shown.map((book) => (
                        <div role="listitem" key={book.id} className="flex items-end">
                          <BookSpine book={book} size={cfg.mobileSize} pulled={openBookId === book.id} onClick={onOpen} />
                        </div>
                      ))}
                      {hidden > 0 || isExpanded ? (
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => onToggleExpanded(column.key)}
                          className="ml-2 inline-flex h-7 items-center self-center rounded-full border border-line bg-surface px-2.5 text-xs font-semibold text-ink"
                        >
                          {isExpanded ? t('visual.timeline.less') : t('visual.timeline.more', { count: n(hidden) })}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
