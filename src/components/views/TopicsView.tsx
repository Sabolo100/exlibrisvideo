'use client';

import { Filter, Hourglass, Info, Layers, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BookCover, BookSpine, Shelf } from '@/components/books';
import { useCollection } from '@/components/collection/context';
import { Button, cn, EmptyState, IconButton, SegmentedControl } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { BookDTO } from '@/lib/types';
import { oneOf, usePersistentState, usePrefersReducedMotion } from './data/hooks';
import { percent } from './data/stats';
import { buildTopicsView, tileTier, type TileTier, type TopicTileData } from './data/topics';

type Display = 'spines' | 'covers';
const DISPLAYS: readonly Display[] = ['spines', 'covers'];
const DISPLAY_KEY = 'exl.data.topics.display';
const UNCLASSIFIED = '__unclassified';
const COVER_PAGE = 48;

/*
 * Literal span classes per breakpoint (Tailwind only generates classes it can find in the source).
 * The grid has MOSAIC_COLUMNS columns: 2 on phones, 4 from sm, 6 from lg.
 */
const COL_CLASS = {
  base: ['', 'col-span-1', 'col-span-2'],
  sm: ['', 'sm:col-span-1', 'sm:col-span-2', 'sm:col-span-3', 'sm:col-span-4'],
  lg: ['', 'lg:col-span-1', 'lg:col-span-2', 'lg:col-span-3', 'lg:col-span-4', 'lg:col-span-5', 'lg:col-span-6'],
} as const;
const ROW_CLASS = {
  base: { 1: 'row-span-1', 2: 'row-span-2' },
  sm: { 1: 'sm:row-span-1', 2: 'sm:row-span-2' },
  lg: { 1: 'lg:row-span-1', 2: 'lg:row-span-2' },
} as const;

function mosaicClass(layout: TopicTileData['layout']): string {
  return (Object.keys(COL_CLASS) as (keyof typeof COL_CLASS)[])
    .map((bp) => `${COL_CLASS[bp][layout[bp].col] ?? ''} ${ROW_CLASS[bp][layout[bp].row]}`)
    .join(' ');
}

function tileVars(hue: number, neutral: boolean): CSSProperties {
  return { '--th': String(neutral ? 35 : hue), '--ts': neutral ? '0.18' : '1' } as CSSProperties;
}

/** Tint utilities driven by --th (hue) and --ts (saturation scale): light tints, deep tones in dark mode. */
const TINT =
  'border-[hsl(var(--th)_calc(34%*var(--ts))_82%)] bg-[hsl(var(--th)_calc(58%*var(--ts))_93%)] text-[hsl(var(--th)_calc(42%*var(--ts))_22%)] ' +
  'dark:border-[hsl(var(--th)_calc(22%*var(--ts))_27%)] dark:bg-[hsl(var(--th)_calc(30%*var(--ts))_15%)] dark:text-[hsl(var(--th)_calc(48%*var(--ts))_86%)]';
const TINT_STRONG =
  'bg-[hsl(var(--th)_calc(50%*var(--ts))_85%)] dark:bg-[hsl(var(--th)_calc(32%*var(--ts))_23%)]';
const TINT_RING = 'ring-[hsl(var(--th)_calc(45%*var(--ts))_38%)] dark:ring-[hsl(var(--th)_calc(50%*var(--ts))_70%)]';

/** Topic groups as treemap-like tile mosaics; a tile expands to its books. */
export function TopicsView() {
  const { visibleBooks, books, locale, openBook, openBookId, setFilters, setView, activeFilterCount, resetFilters } = useCollection();
  const { t, tp } = useI18n();
  const reduced = usePrefersReducedMotion();
  const data = useMemo(() => buildTopicsView(visibleBooks, locale), [visibleBooks, locale]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [display, setDisplay] = usePersistentState<Display>(DISPLAY_KEY, 'spines', oneOf(DISPLAYS));

  const tileCount = data.sections.reduce((s, sec) => s + sec.tiles.length, 0);
  const openTile = useMemo<TopicTileData | null>(() => {
    if (!openKey) return null;
    if (openKey === UNCLASSIFIED) {
      return data.unclassified.length
        ? {
            key: UNCLASSIFIED,
            def: undefined,
            label: t(data.classificationPending ? 'data.topics.unclassified.pending' : 'data.topics.unclassified.title'),
            icon: data.classificationPending ? '⏳' : '🗂️',
            hue: 35,
            neutral: true,
            count: data.unclassified.length,
            share: data.total ? data.unclassified.length / data.total : 0,
            books: data.unclassified,
            span: { col: 2, row: 1 },
            layout: { base: { col: 2, row: 1 }, sm: { col: 2, row: 1 }, lg: { col: 2, row: 1 } },
          }
        : null;
    }
    for (const s of data.sections) for (const tile of s.tiles) if (tile.key === openKey) return tile;
    return null;
  }, [openKey, data, t]);

  const toggle = useCallback((key: string) => setOpenKey((cur) => (cur === key ? null : key)), []);
  const close = useCallback(() => {
    setOpenKey((cur) => {
      if (cur) requestAnimationFrame(() => document.getElementById(tileId(cur))?.focus());
      return null;
    });
  }, []);
  const filterTo = useCallback(
    (key: string) => {
      setFilters({ topics: [key] });
      setView('shelf');
    },
    [setFilters, setView],
  );

  if (visibleBooks.length === 0) {
    return books.length === 0 ? (
      <EmptyState title={t('data.empty.noBooks.title')} description={t('data.empty.noBooks.description')} />
    ) : (
      <EmptyState
        title={t('data.empty.noResults.title')}
        description={t('data.empty.noResults.description')}
        action={activeFilterCount > 0 ? <Button onClick={resetFilters}>{t('data.filters.reset')}</Button> : undefined}
      />
    );
  }

  const panel = (tile: TopicTileData) => (
    <TopicPanel
      key={tile.key}
      tile={tile}
      total={data.total}
      display={display}
      onDisplay={setDisplay}
      onClose={close}
      onFilter={tile.key === UNCLASSIFIED ? undefined : () => filterTo(tile.key)}
      onOpenBook={(b) => openBook(b.id)}
      openBookId={openBookId}
      reduced={reduced}
    />
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-sm text-muted">
          <span className="font-medium text-ink tabular-nums">{tp('data.topics.count', tileCount)}</span>
          {' · '}
          <span className="tabular-nums">{tp('common.unit.book', data.total)}</span>
        </p>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Info aria-hidden="true" className="size-3.5" />
          {t('data.topics.multiNote')}
        </p>
      </div>

      {data.sections.map((section, si) => (
        <section key={section.group} aria-labelledby={`topics-group-${section.group}`} className="mb-9">
          <div className="mb-3 flex items-baseline gap-3 border-b border-line pb-1.5">
            <h3 id={`topics-group-${section.group}`} className="font-display text-2xl font-semibold text-ink">
              {section.label}
            </h3>
            <span className="text-xs text-muted tabular-nums">
              {tp('data.topics.count', section.tiles.length)} · {tp('common.unit.book', section.bookCount)}
            </span>
          </div>
          <ul className="grid auto-rows-[6rem] grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            {section.tiles.map((tile, i) => (
              <motion.li
                key={tile.key}
                className={mosaicClass(tile.layout)}
                initial={reduced ? false : { opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.28, delay: reduced ? 0 : Math.min(0.45, si * 0.06 + i * 0.025), ease: 'easeOut' }}
              >
                <TopicTile tile={tile} total={data.total} open={openKey === tile.key} onToggle={toggle} />
              </motion.li>
            ))}
          </ul>
          <AnimatePresence initial={false}>{openTile && section.tiles.includes(openTile) ? panel(openTile) : null}</AnimatePresence>
        </section>
      ))}

      {data.unclassified.length > 0 ? (
        <section aria-labelledby="topics-group-unclassified" className="mb-9">
          <div className="mb-3 flex items-baseline gap-3 border-b border-line pb-1.5">
            <h3 id="topics-group-unclassified" className="font-display text-2xl font-semibold text-ink">
              {t('data.topics.unclassified.section')}
            </h3>
          </div>
          <div className="grid auto-rows-[6rem] grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            <div className="col-span-2">
              <button
                id={tileId(UNCLASSIFIED)}
                type="button"
                aria-expanded={openKey === UNCLASSIFIED}
                aria-controls={panelId(UNCLASSIFIED)}
                onClick={() => toggle(UNCLASSIFIED)}
                className={cn(
                  'flex h-full w-full items-center gap-3 rounded-card border border-dashed border-line bg-surface-2/60 p-3 text-left text-ink transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-lift',
                  openKey === UNCLASSIFIED && 'ring-2 ring-accent',
                )}
              >
                <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
                  {data.classificationPending ? <Hourglass className="size-5" /> : <Layers className="size-5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-base leading-tight font-semibold">
                    {t(data.classificationPending ? 'data.topics.unclassified.pending' : 'data.topics.unclassified.title')}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted">
                    {t(data.classificationPending ? 'data.topics.unclassified.pendingHint' : 'data.topics.unclassified.hint')}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-display text-2xl leading-none font-semibold tabular-nums">{data.unclassified.length}</span>
                  <span className="text-[0.6875rem] text-muted tabular-nums">
                    {percent(data.unclassified.length, data.total)}%
                  </span>
                </span>
              </button>
            </div>
          </div>
          <AnimatePresence initial={false}>{openTile?.key === UNCLASSIFIED ? panel(openTile) : null}</AnimatePresence>
        </section>
      ) : null}
    </div>
  );
}

function tileId(key: string): string {
  return `topic-tile-${key}`;
}
function panelId(key: string): string {
  return `topic-panel-${key}`;
}

/** Typography per tile tier; `medium` tiles are compact on phones (where they are one cell) and large from sm. */
const TIER_CLASS: Record<TileTier, { pad: string; icon: string; count: string; label: string; share: string }> = {
  large: { pad: 'sm:p-4', icon: 'size-11 text-2xl', count: 'text-4xl', label: 'line-clamp-2 text-lg', share: 'hidden sm:block' },
  medium: {
    pad: 'sm:p-4',
    icon: 'size-8 text-lg sm:size-11 sm:text-2xl',
    count: 'text-xl sm:text-4xl',
    label: 'line-clamp-2 text-sm sm:text-lg',
    share: 'hidden sm:block',
  },
  small: { pad: '', icon: 'size-8 text-lg', count: 'text-xl', label: 'line-clamp-2 text-sm', share: 'hidden' },
};

function TopicTile({ tile, total, open, onToggle }: { tile: TopicTileData; total: number; open: boolean; onToggle: (key: string) => void }) {
  const { t, tp, n } = useI18n();
  // tiles stretched only to fill the mosaic keep the compact look
  const tier = tileTier(tile.span);
  const tc = TIER_CLASS[tier];
  const big = tier !== 'small';
  const pct = percent(tile.count, total);
  const spines = big ? tile.books.slice(0, tile.span.col === 3 ? 12 : 7) : [];
  return (
    <button
      id={tileId(tile.key)}
      type="button"
      aria-expanded={open}
      aria-controls={panelId(tile.key)}
      aria-label={t('data.topics.tileAria', { label: tile.label, books: tp('common.unit.book', tile.count), percent: n(pct) })}
      onClick={() => onToggle(tile.key)}
      style={tileVars(tile.hue, tile.neutral)}
      className={cn(
        'group relative flex h-full w-full flex-col overflow-hidden rounded-card border p-3 text-left',
        'transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-lift focus-visible:shadow-lift',
        TINT,
        open && cn('ring-2 ring-offset-2 ring-offset-bg', TINT_RING),
        tc.pad,
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span
          aria-hidden="true"
          className={cn('flex shrink-0 items-center justify-center rounded-full leading-none', TINT_STRONG, tc.icon)}
        >
          {tile.icon}
        </span>
        <span aria-hidden="true" className="text-right">
          <span className={cn('block font-display leading-none font-semibold tabular-nums', tc.count)}>{n(tile.count)}</span>
          <span className="mt-1 block text-[0.6875rem] font-medium tabular-nums opacity-75">{n(pct)}%</span>
        </span>
      </span>
      <span aria-hidden="true" className="mt-auto flex min-w-0 items-end justify-between gap-3">
        <span className={cn('min-w-0 font-display leading-tight font-semibold text-balance', tc.label)}>{tile.label}</span>
        {spines.length > 0 ? (
          <span className="flex shrink-0 items-end gap-[2px] max-sm:hidden" aria-hidden="true">
            {spines.map((b) => (
              <BookSpine key={b.id} book={b} size="xs" decorative className="!shadow-[1px_0_1px_rgb(0_0_0/0.3)]" />
            ))}
          </span>
        ) : null}
      </span>
      {big ? (
        <span aria-hidden="true" className={cn('mt-1 text-[0.6875rem] opacity-70', tc.share)}>
          {t('data.topics.share', { percent: n(pct) })}
        </span>
      ) : null}
    </button>
  );
}

function TopicPanel({
  tile,
  total,
  display,
  onDisplay,
  onClose,
  onFilter,
  onOpenBook,
  openBookId,
  reduced,
}: {
  tile: TopicTileData;
  total: number;
  display: Display;
  onDisplay: (d: Display) => void;
  onClose: () => void;
  onFilter?: () => void;
  onOpenBook: (b: BookDTO) => void;
  openBookId: string | null;
  reduced: boolean;
}) {
  const { t, tp, n } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(COVER_PAGE);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }));
    return () => cancelAnimationFrame(raf);
  }, [tile.key, reduced]);

  const covers = tile.books.slice(0, limit);

  return (
    <motion.div
      ref={ref}
      id={panelId(tile.key)}
      role="region"
      aria-labelledby={`${panelId(tile.key)}-h`}
      style={tileVars(tile.hue, tile.neutral)}
      initial={reduced ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: reduced ? 0 : 0.25, ease: 'easeOut' }}
      className="overflow-hidden"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="mt-3 rounded-card border border-line bg-surface shadow-soft">
        <div className={cn('flex flex-wrap items-center gap-3 rounded-t-card border-b px-4 py-3 sm:px-5', TINT)}>
          <span aria-hidden="true" className={cn('flex size-9 items-center justify-center rounded-full text-xl leading-none', TINT_STRONG)}>
            {tile.icon}
          </span>
          <div className="min-w-0 flex-1">
            <h4 id={`${panelId(tile.key)}-h`} className="font-display text-lg leading-tight font-semibold">
              {tile.label}
            </h4>
            <p className="text-xs opacity-80 tabular-nums">
              {tp('common.unit.book', tile.count)} · {t('data.topics.share', { percent: n(percent(tile.count, total)) })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<Display>
              size="sm"
              aria-label={t('data.topics.display.label')}
              value={display}
              onChange={onDisplay}
              options={DISPLAYS.map((d) => ({ value: d, label: t(`data.topics.display.${d}`) }))}
            />
            {onFilter ? (
              <Button size="sm" variant="primary" leftIcon={<Filter aria-hidden="true" />} onClick={onFilter}>
                {t('data.topics.filter')}
              </Button>
            ) : null}
            <IconButton size="sm" variant="ghost" icon={<X />} aria-label={t('common.action.close')} onClick={onClose} />
          </div>
        </div>
        <div className="p-3 sm:p-5">
          {display === 'spines' ? (
            <Shelf
              books={tile.books}
              size="sm"
              onBookClick={onOpenBook}
              pulledId={openBookId}
              aria-label={tile.label}
              bookends
            />
          ) : (
            <>
              <ul className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-5 lg:grid-cols-8">
                {covers.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => onOpenBook(b)}
                      className="group block w-full rounded-md text-left"
                      aria-label={b.author ? `${b.author} – ${b.title}` : b.title}
                    >
                      <BookCover
                        book={b}
                        decorative
                        className="w-full shadow-soft transition-[transform,box-shadow] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lift"
                      />
                      <span className="mt-1.5 line-clamp-2 block text-xs leading-snug font-medium text-ink">{b.title}</span>
                      {b.author ? <span className="line-clamp-1 block text-[0.6875rem] text-muted">{b.author}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
              {tile.books.length > limit ? (
                <div className="mt-4 flex justify-center">
                  <Button size="sm" onClick={() => setLimit((l) => l + COVER_PAGE)}>
                    {t('data.topics.showMore', { count: n(Math.min(COVER_PAGE, tile.books.length - limit)) })}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
