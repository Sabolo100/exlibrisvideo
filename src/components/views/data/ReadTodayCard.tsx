'use client';

import { BookOpen, Dices, Shuffle } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookSpine, SPINE_SIZES, spineBox, type SpineSize } from '@/components/books';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { seededRandom, shuffle } from '@/lib/book-utils';
import type { BookDTO } from '@/lib/types';
import { DashboardCard, EASE_OUT } from './ChartKit';
import { useElementSize, usePrefersReducedMotion } from './hooks';
import { dailySeed, fitRow, pickFromPool, recommendationPool, shuffleRow } from './stats';
import { useStatsFormat } from './useStatsFormat';

export interface ReadTodayCardProps {
  books: readonly BookDTO[];
  collectionId: string;
  onOpenBook: (id: string) => void;
  className?: string;
  delay?: number;
}

const DESCRIPTION_KEY = {
  to_read: 'data.stats.pick.description.to_read',
  unread: 'data.stats.pick.description.unread',
  reread: 'data.stats.pick.description.reread',
  none: 'data.stats.pick.description.unread',
} as const;

/** shuffle animation: number of re-orderings and their pace */
const SHUFFLE_STEPS = 7;
const SHUFFLE_STEP_MS = 125;
/** px between spines (gap-1.5) */
const ROW_GAP = 6;

/** A spine of the row; while it animates out of the row it is no longer a button nor announced. */
function RowSpine({ book, size, pulled, onOpenBook }: { book: BookDTO; size: SpineSize; pulled: boolean; onOpenBook: (id: string) => void }) {
  const present = useIsPresent();
  return (
    <BookSpine
      book={book}
      size={size}
      pulled={pulled}
      decorative={!present}
      onClick={present ? (b) => onOpenBook(b.id) : undefined}
    />
  );
}

/**
 * "What should I read today?" – a row of spines with today's pick pulled out (stable for the day),
 * and a shuffle that re-deals the row a few times before settling on another random pick.
 */
export function ReadTodayCard({ books, collectionId, onOpenBook, className, delay }: ReadTodayCardProps) {
  const { t, tp } = useI18n();
  const fmt = useStatsFormat();
  const reduced = usePrefersReducedMotion();
  const [rowRef, rowBox] = useElementSize<HTMLDivElement>();
  const { mode, pool } = useMemo(() => recommendationPool(books), [books]);
  const byId = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);

  const width = rowBox?.width ?? 0;
  const spineSize: SpineSize = width >= 300 ? 'md' : 'sm';
  // typical spine width plus the gap; fitRow() trims the ends when the real widths do not fit
  const pitch = Math.round(SPINE_SIZES[spineSize].width * 1.05) + ROW_GAP;
  let slots = Math.max(3, Math.min(11, Math.floor(width / pitch)));
  if (slots % 2 === 0) slots -= 1;
  const rowHeight = SPINE_SIZES[spineSize].height + (spineSize === 'md' ? 30 : 20);

  const [pickId, setPickId] = useState<string | null>(null);
  const [rowIds, setRowIds] = useState<string[]>([]);
  const [shuffling, setShuffling] = useState(false);
  const [daily, setDaily] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id);
      timers.current = [];
    },
    [],
  );

  // Establish or repair the pick and its row. Client only: today's pick depends on the local date.
  useEffect(() => {
    if (width === 0 || shuffling) return;
    if (pool.length === 0) {
      if (pickId !== null) setPickId(null);
      if (rowIds.length > 0) setRowIds([]);
      return;
    }
    const current = pickId ? pool.find((b) => b.id === pickId) : undefined;
    const pick = current ?? pickFromPool(pool, seededRandom(dailySeed(collectionId, new Date())));
    if (!pick) return;
    const expectedLength = Math.min(slots, books.length);
    const rowOk =
      current !== undefined && rowIds.length === expectedLength && rowIds.includes(pick.id) && rowIds.every((id) => byId.has(id));
    if (!current) {
      setPickId(pick.id);
      setDaily(true);
    }
    if (!rowOk) setRowIds(shuffleRow(pick, pool, books, slots, `${collectionId}:${pick.id}`).map((b) => b.id));
  }, [width, slots, shuffling, pool, books, byId, pickId, rowIds, collectionId]);

  const shuffleNow = () => {
    if (pool.length < 2 || shuffling) return;
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    const next = pickFromPool(pool, Math.random, pickId);
    if (!next) return;
    const seed = Math.floor(Math.random() * 2 ** 31);
    const finalRow = shuffleRow(next, pool, books, slots, seed).map((b) => b.id);
    const settle = () => {
      setRowIds(finalRow);
      setPickId(next.id);
      setDaily(false);
      setShuffling(false);
      setAnnouncement(t('data.stats.pick.announce', { title: next.title }));
    };
    if (reduced) {
      settle();
      return;
    }
    setShuffling(true);
    const start = rowIds.length > 0 ? rowIds : finalRow;
    for (let k = 0; k < SHUFFLE_STEPS; k++) {
      timers.current.push(
        window.setTimeout(() => setRowIds(shuffle(k < SHUFFLE_STEPS / 2 ? start : finalRow, seed + k + 1)), k * SHUFFLE_STEP_MS),
      );
    }
    timers.current.push(window.setTimeout(settle, SHUFFLE_STEPS * SHUFFLE_STEP_MS + 90));
  };

  const pick = pickId ? byId.get(pickId) : undefined;
  const row = fitRow(
    rowIds.map((id) => byId.get(id)).filter((b): b is BookDTO => Boolean(b)),
    pickId,
    (b) => spineBox(b, spineSize).width,
    ROW_GAP,
    Math.max(0, width - 16),
  );
  const byline = pick
    ? [pick.author?.trim() || t('common.book.unknownAuthor'), typeof pick.firstPublishedYear === 'number' ? fmt.yearText(pick.firstPublishedYear) : null]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <DashboardCard
      title={t('data.stats.pick.title')}
      description={`${t(DESCRIPTION_KEY[mode])} · ${tp('data.stats.pick.poolSize', pool.length)}`}
      icon={<Dices />}
      className={className}
      delay={delay}
    >
      <div ref={rowRef} className="w-full">
        <div
          role="group"
          aria-label={t('data.stats.pick.row')}
          className="flex items-end justify-center gap-1.5 border-b-[6px] border-wood px-2 pb-px shadow-[0_8px_10px_-8px_hsl(var(--shadow-color)/0.55)]"
          style={{ height: rowHeight }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            {row.map((b) => (
              <motion.div
                key={b.id}
                layout={reduced ? false : 'position'}
                initial={reduced ? false : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: 18 }}
                transition={{
                  layout: { type: 'spring', stiffness: 520, damping: 36 },
                  opacity: { duration: reduced ? 0 : 0.2 },
                  y: { duration: reduced ? 0 : 0.25, ease: EASE_OUT },
                }}
                className="flex items-end"
              >
                <RowSpine book={b} size={spineSize} pulled={!shuffling && b.id === pickId} onOpenBook={onOpenBook} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col">
        {pick ? (
          <motion.div
            key={pick.id}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: shuffling ? 0.35 : 1, y: 0 }}
            transition={{ duration: reduced ? 0 : 0.25, ease: EASE_OUT }}
            className="min-w-0"
          >
            <p className="text-xs font-medium tracking-[0.06em] text-muted uppercase">
              {t(daily ? 'data.stats.pick.today' : 'data.stats.pick.another')}
            </p>
            <p className="mt-1 font-display text-xl leading-snug font-semibold text-balance break-words text-ink">{pick.title}</p>
            <p className="mt-0.5 text-sm text-muted">{byline}</p>
          </motion.div>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          <Button variant="primary" leftIcon={<BookOpen aria-hidden="true" />} disabled={!pick} onClick={() => pick && onOpenBook(pick.id)}>
            {t('data.stats.pick.open')}
          </Button>
          <Button leftIcon={<Shuffle aria-hidden="true" />} disabled={pool.length < 2} onClick={shuffleNow} aria-busy={shuffling || undefined}>
            {shuffling ? t('data.stats.pick.shuffling') : t('data.stats.pick.shuffle')}
          </Button>
        </div>
        {pool.length === 1 ? <p className="mt-2 text-xs text-muted">{t('data.stats.pick.onlyOne')}</p> : null}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </DashboardCard>
  );
}
