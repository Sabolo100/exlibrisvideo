'use client';

/**
 * View 2 – the cover wall: a responsive grid of 2:3 covers (real or generated) that flip to a
 * catalogue card. Sorted by author or title it gets initial-letter headers and a letter jump bar.
 * Rendered in chunks: far-away chunks are colour placeholders until they approach the viewport.
 */
import { memo, useCallback, useMemo } from 'react';
import { useCollection } from '@/components/collection/context';
import { useUiTranslator } from '@/components/ui/hooks';
import type { BookDTO, Locale } from '@/lib/types';
import { VisualEmptyState } from './visual/common';
import { CoverCard, CoverGhost } from './visual/CoverCard';
import { chunk, coverGridMetrics, initialGroups, type InitialGroup } from './visual/covers-layout';
import { scrollBehavior, useElementWidth, useLatest, useNearViewport, useViewportHeight } from './visual/hooks';

/** Up to this many books all cards mount immediately. */
const EAGER_LIMIT = 240;
/** rows mounted together – small chunks keep each staggered mount commit short while scrolling */
const ROWS_PER_CHUNK = 2;
/** caption block under each cover (mt-2.5 + h-[3.25rem]) */
const CAPTION_HEIGHT = 62;

export function CoversView() {
  const { visibleBooks, sort, locale, openBookId, openBook } = useCollection();
  const { t, tp } = useUiTranslator();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const viewportHeight = useViewportHeight();

  const groups: InitialGroup[] = useMemo(
    () => initialGroups(visibleBooks, sort, locale) ?? [{ key: '', books: visibleBooks }],
    [visibleBooks, sort, locale],
  );
  const lettered = groups.length > 0 && groups[0].key !== '';

  const metrics = coverGridMetrics(width ?? 0);
  const rowHeight = metrics.cardWidth * 1.5 + CAPTION_HEIGHT + metrics.gap;
  const chunkSize = metrics.columns * ROWS_PER_CHUNK;
  const eager = visibleBooks.length <= EAGER_LIMIT;
  const eagerChunks = rowHeight > 0 ? Math.ceil((viewportHeight * 1.5) / (rowHeight * ROWS_PER_CHUNK)) + 1 : 2;

  const openRef = useLatest(openBook);
  const onOpen = useCallback((id: string) => openRef.current(id), [openRef]);

  if (visibleBooks.length === 0) return <VisualEmptyState />;

  let chunkIndex = 0;
  return (
    <section aria-label={t('visual.covers.label')} className="exl-covers-view">
      {lettered && groups.length >= 3 ? <LetterBar groups={groups} /> : null}
      <div ref={ref} className="flex flex-col">
        {width === null ? (
          <CoversSkeleton />
        ) : (
          groups.map((group) => {
            const chunks = chunk(group.books, chunkSize);
            const body = (
              <div role="list" aria-label={lettered ? groupTitle(group.key, t) : t('visual.covers.label')} className="flex flex-col" style={{ gap: metrics.gap }}>
                {chunks.map((books, i) => {
                  const index = chunkIndex++;
                  return (
                    <CoverChunk
                      key={`${group.key}:${i}:${metrics.columns}`}
                      books={books}
                      columns={metrics.columns}
                      cardWidth={metrics.cardWidth}
                      gap={metrics.gap}
                      locale={locale}
                      activeId={openBookId && books.some((b) => b.id === openBookId) ? openBookId : null}
                      onOpen={onOpen}
                      live={eager}
                      initiallyNear={index < eagerChunks}
                      priority={index === 0}
                    />
                  );
                })}
              </div>
            );
            if (!lettered) return <div key="all">{body}</div>;
            return (
              <section
                key={group.key}
                id={letterAnchor(group.key)}
                tabIndex={-1}
                className="scroll-mt-24 pb-10 outline-none"
                aria-label={groupTitle(group.key, t)}
              >
                <header className="mb-4 flex items-baseline gap-3">
                  <h3 className="font-display text-3xl leading-none font-semibold text-accent">
                    {group.key === '#' ? '#' : group.key}
                  </h3>
                  {group.key === '#' ? <span className="text-sm text-muted">{t('visual.covers.noAuthorGroup')}</span> : null}
                  <span aria-hidden="true" className="h-px flex-1 translate-y-[-0.3em] bg-line" />
                  <span className="text-xs font-medium text-muted tabular-nums">{tp('visual.books', group.books.length)}</span>
                </header>
                {body}
              </section>
            );
          })
        )}
      </div>
    </section>
  );
}

function groupTitle(key: string, t: ReturnType<typeof useUiTranslator>['t']): string {
  return key === '#' ? t('visual.covers.noAuthorGroup') : t('visual.covers.letter', { letter: key });
}

function letterAnchor(key: string): string {
  return `exl-covers-${key === '#' ? 'other' : encodeURIComponent(key)}`;
}

/** Horizontal letter index; jumps to the group header. */
function LetterBar({ groups }: { groups: InitialGroup[] }) {
  const { t } = useUiTranslator();
  return (
    <nav aria-label={t('visual.covers.letterIndex')} className="mb-6 print:hidden">
      <ul className="flex flex-wrap gap-1">
        {groups.map((g) => (
          <li key={g.key}>
            <a
              href={`#${letterAnchor(g.key)}`}
              onClick={(e) => {
                const target = document.getElementById(letterAnchor(g.key));
                if (!target) return;
                e.preventDefault();
                target.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
                // move keyboard focus along (the header is focusable only programmatically)
                target.focus({ preventScroll: true });
              }}
              className="inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-line bg-surface px-2 font-display text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
              title={groupTitle(g.key, t)}
            >
              {g.key}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface CoverChunkProps {
  books: BookDTO[];
  columns: number;
  /** px width of one card (placeholder geometry) */
  cardWidth: number;
  gap: number;
  locale: Locale;
  /** the open book when it is in this chunk */
  activeId: string | null;
  onOpen: (id: string) => void;
  live: boolean;
  initiallyNear: boolean;
  priority: boolean;
}

const CoverChunk = memo(function CoverChunk({ books, columns, cardWidth, gap, locale, activeId, onOpen, live, initiallyNear, priority }: CoverChunkProps) {
  const [ref, near] = useNearViewport<HTMLDivElement>({ rootMargin: '120% 0px', initial: live || initiallyNear });
  const mounted = live || near;

  if (!mounted && cardWidth > 0) {
    // far away: one element for the whole chunk, the covers drawn as a gradient pattern of the
    // exact geometry (cover 2:3 + caption + gap), so mounting it later does not move the page
    const rows = Math.ceil(books.length / columns);
    const cover = cardWidth * 1.5;
    const row = cover + CAPTION_HEIGHT + gap;
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className="opacity-70"
        style={{
          height: rows * row - gap,
          backgroundImage: `repeating-linear-gradient(90deg, var(--surface-2) 0 ${cardWidth}px, transparent ${cardWidth}px ${cardWidth + gap}px)`,
          WebkitMaskImage: `repeating-linear-gradient(180deg, #000 0 ${cover}px, transparent ${cover}px ${row}px)`,
          maskImage: `repeating-linear-gradient(180deg, #000 0 ${cover}px, transparent ${cover}px ${row}px)`,
        }}
      />
    );
  }

  return (
    <div
      ref={ref}
      role="presentation"
      className="grid"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: gap, rowGap: gap }}
    >
      {books.map((book, i) =>
        mounted ? (
          <CoverCard
            key={book.id}
            book={book}
            locale={locale}
            onOpen={onOpen}
            active={activeId === book.id}
            priority={priority && i < columns * 2}
          />
        ) : (
          <CoverGhost key={book.id} book={book} />
        ),
      )}
    </div>
  );
});

function CoversSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-5">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] animate-pulse rounded-[2px_5px_5px_2px] bg-surface-2" />
          <div className="mt-2.5 h-3 w-4/5 animate-pulse rounded bg-surface-2" />
          <div className="mt-1.5 h-2.5 w-1/2 animate-pulse rounded bg-surface-2" />
        </div>
      ))}
    </div>
  );
}
