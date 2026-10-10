'use client';

/**
 * Owner review of books that a later recording or photo found again somewhere else (`duplicateOfId`):
 * card by card, the earlier book next to the new one – same book, another copy, or a different book?
 */
import { BookCopy, Check, Combine, Copy, SplitSquareHorizontal } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { BookSpine, spineLabel } from '@/components/books';
import { SpineStrip } from '@/components/book/Evidence';
import { useCollection } from '@/components/collection/context';
import { Button, Card, EmptyState, ProgressBar, cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { BookDTO, DuplicateResolution } from '@/lib/types';

const SOURCE_LABEL = {
  video: 'book.review.dup.source.video',
  image: 'book.review.dup.source.image',
  manual: 'book.review.dup.source.manual',
} as const;

function BookSide({ book, label, accent }: { book: BookDTO; label: string; accent?: boolean }) {
  const { t, tp } = useI18n();
  const { openBook } = useCollection();
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-3 rounded-2xl border p-3 sm:p-4',
        accent ? 'border-accent/45 bg-accent-soft/35' : 'border-line bg-surface-2/40',
      )}
    >
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
      <div className="flex min-h-[7rem] items-end justify-center">
        <SpineStrip
          book={book}
          maxHeight="7rem"
          fallback={<BookSpine book={book} size="sm" decorative className="h-28" />}
        />
      </div>
      <button type="button" onClick={() => openBook(book.id)} className="min-w-0 text-left">
        <span className="block font-display text-base leading-snug font-semibold text-ink hover:underline">{book.title}</span>
        {book.author ? <span className="block truncate text-sm text-muted">{book.author}</span> : null}
      </button>
      <p className="mt-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        {book.copies > 1 ? <span className="font-semibold text-ink">{tp('book.copies.count', book.copies)}</span> : null}
        {book.tags.length > 0 ? <span>{book.tags.join(' · ')}</span> : null}
        {book.publisher ? <span>{book.publisher}</span> : null}
        <span>{t(SOURCE_LABEL[book.source])}</span>
      </p>
    </div>
  );
}

export function DuplicateReview({ onDone }: { onDone?: () => void }) {
  const { t, tp, n } = useI18n();
  const { books, resolveDuplicate } = useCollection();
  const byId = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const queue = useMemo(() => books.filter((b) => b.duplicateOfId && byId.has(b.duplicateOfId)), [books, byId]);
  const [total] = useState(() => Math.max(1, queue.length));
  const [busy, setBusy] = useState<DuplicateResolution | null>(null);

  const current = queue[0];
  const earlier = current?.duplicateOfId ? byId.get(current.duplicateOfId) : undefined;

  if (!current || !earlier) {
    return (
      <Card variant="plain" className="mx-auto max-w-2xl">
        <EmptyState
          icon={<Check />}
          title={t('book.review.dup.doneTitle')}
          description={t('book.review.dup.doneBody')}
          action={onDone ? <Button onClick={onDone}>{t('book.review.dup.backToBooks')}</Button> : undefined}
        />
      </Card>
    );
  }

  const answer = async (resolution: DuplicateResolution) => {
    if (busy) return;
    setBusy(resolution);
    try {
      await resolveDuplicate(current.id, resolution);
    } finally {
      setBusy(null);
    }
  };
  const done = total - queue.length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-ink">{t('book.review.dup.title')}</h2>
          <span className="text-sm text-muted tabular-nums">{tp('book.review.dup.remaining', queue.length)}</span>
        </div>
        <p className="text-sm text-pretty text-muted">{t('book.review.dup.intro')}</p>
        <ProgressBar value={(done / total) * 100} label={t('book.review.dup.title')} size="sm" />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={current.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          <Card className="flex flex-col gap-4 p-4 sm:p-5">
            <p className="flex items-start gap-2 text-[0.9375rem] font-medium text-ink">
              <BookCopy aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent" />
              <span>{t('book.review.dup.question', { title: spineLabel(earlier) })}</span>
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <BookSide book={earlier} label={t('book.review.dup.earlier')} />
              <BookSide book={current} label={t('book.review.dup.new')} accent />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Button
                variant="primary"
                leftIcon={<Copy />}
                loading={busy === 'copy'}
                disabled={!!busy}
                onClick={() => void answer('copy')}
              >
                {t('book.review.dup.copy', { count: n(earlier.copies + current.copies) })}
              </Button>
              <Button leftIcon={<Combine />} loading={busy === 'same'} disabled={!!busy} onClick={() => void answer('same')}>
                {t('book.review.dup.same')}
              </Button>
              <Button
                variant="ghost"
                leftIcon={<SplitSquareHorizontal />}
                loading={busy === 'different'}
                disabled={!!busy}
                onClick={() => void answer('different')}
              >
                {t('book.review.dup.different')}
              </Button>
            </div>
            <p className="text-xs text-muted">{t('book.review.dup.hint')}</p>
          </Card>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
