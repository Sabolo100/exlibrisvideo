'use client';

import { Sparkles } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { Shelf } from '@/components/books/Shelf';
import { spineLabel } from '@/components/books/BookSpine';
import { Card } from '@/components/ui/Card';
import { cn } from '@/components/ui/cn';
import { useMediaQuery } from '@/components/ui/hooks';
import type { BookDTO } from '@/lib/types';
import { appearingBooks, latestBooks } from './model';

export interface AppearingShelfProps {
  books: readonly BookDTO[];
  className?: string;
}

const HIGHLIGHT_MS = 3500;

/**
 * A live bookshelf: books recognised since the panel opened slide onto the shelf (id diff between polls),
 * glow briefly, and the newest one is named in a small ticker. Books present at mount are drawn statically.
 */
export function AppearingShelf({ books, className }: AppearingShelfProps) {
  const { t, tp } = useI18n();
  const wide = useMediaQuery('(min-width: 640px)');
  const reduced = useReducedMotion();
  const limit = wide ? 42 : 24;
  const { shown, hidden } = useMemo(() => appearingBooks(books, limit), [books, limit]);
  const latest = useMemo(() => latestBooks(books, 1)[0] ?? null, [books]);

  // ids already on screen: seeded with the books present at mount, extended after every commit
  const seenRef = useRef<Set<string> | null>(null);
  if (seenRef.current === null) seenRef.current = new Set(books.map((b) => b.id));
  const seen = seenRef.current;
  const arriving = shown.filter((b) => !seen.has(b.id));
  const arrivingIndex = new Map(arriving.map((b, i) => [b.id, i]));

  const [glowing, setGlowing] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const added = shown.filter((b) => !seen.has(b.id)).map((b) => b.id);
    if (added.length === 0) return;
    for (const id of added) seen.add(id);
    setGlowing((prev) => new Set([...prev, ...added]));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setGlowing((prev) => {
        const next = new Set(prev);
        for (const id of added) next.delete(id);
        return next;
      });
    }, HIGHLIGHT_MS);
    timers.current.add(timer);
  }, [shown, seen]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return (
    <Card as="section" aria-labelledby="exl-appearing-shelf" className={cn('overflow-hidden p-4 sm:p-5', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="exl-appearing-shelf" className="font-display text-lg leading-tight font-semibold text-ink">
          {t('processing.shelf.title')}
        </h2>
        <p className="text-sm text-muted">{t('processing.shelf.description')}</p>
      </div>

      <div className="mt-2 flex min-h-6 items-center gap-2 text-sm" aria-hidden={latest ? undefined : true}>
        <AnimatePresence mode="wait" initial={false}>
          {latest ? (
            <motion.p
              key={latest.id}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="flex min-w-0 items-center gap-1.5"
            >
              <Sparkles aria-hidden="true" className="size-4 shrink-0 text-accent" />
              <span className="shrink-0 text-muted">{t('processing.shelf.latest')}:</span>
              <span className="min-w-0 truncate font-medium text-ink">{spineLabel(latest)}</span>
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      <Shelf
        className="mt-3"
        size={wide ? 'md' : 'sm'}
        books={shown}
        bookends={shown.length > 0}
        aria-label={t('processing.shelf.aria')}
        emptyLabel={t('processing.shelf.empty')}
        renderBook={(book, spine) => {
          const order = arrivingIndex.get(book.id);
          const glow = glowing.has(book.id);
          return (
            <motion.span
              className="relative block"
              initial={order === undefined || reduced ? false : { opacity: 0, y: -48, rotate: -6 }}
              animate={{ opacity: 1, y: 0, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22, delay: Math.min(order ?? 0, 14) * 0.07 }}
            >
              {spine}
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute inset-x-[-3px] -top-1 bottom-0 rounded-[4px] transition-[box-shadow,opacity] duration-700',
                  glow ? 'opacity-100 shadow-[0_0_0_2px_rgb(230_196_126/0.9),0_0_18px_4px_rgb(230_196_126/0.55)]' : 'opacity-0',
                )}
              />
            </motion.span>
          );
        }}
      />

      {hidden > 0 ? (
        <p className="mt-2 text-right text-xs text-muted">{tp('processing.shelf.more', hidden)}</p>
      ) : null}
      {books.length > 0 ? <p className="mt-3 text-xs leading-snug text-muted text-pretty">{t('processing.shelf.reviewNote')}</p> : null}
    </Card>
  );
}
