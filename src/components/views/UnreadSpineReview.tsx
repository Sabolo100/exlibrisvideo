'use client';

import { Check, ChevronLeft, ClipboardCheck, ImageOff, Library, SkipForward, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { spineLabel } from '@/components/books';
import { FrameWithBox, SpineStrip } from '@/components/book/Evidence';
import { cleanText, findDuplicates, isTypingTarget } from '@/components/book/book-form-utils';
import { framesVersion, useCollectionFrames } from '@/components/book/frames-store';
import { useCollection } from '@/components/collection/context';
import { Button, Card, EmptyState, Field, Input, Kbd, ProgressBar, Skeleton, useMounted, cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { UnreadSpineDTO } from '@/lib/types';

export interface UnreadSpineReviewProps {
  /** uncertain books waiting in the other review mode (offered when the spines are done) */
  pendingBooks?: number;
  onOpenBooks?: () => void;
}

/** The author field starts with an author read from the spine; an unconfirmed guess is only offered. */
function initialDraft(spine: UnreadSpineDTO) {
  return { id: spine.id, author: spine.reason === 'illegible' ? (spine.guessAuthor ?? '') : '', title: '' };
}

/**
 * Owner-only, card-by-card naming of the spines the recognition could not read: the upright spine photo,
 * the frame it was cut from, and a title / author form. "Add" turns the spine into a reviewed book at its
 * place on the shelf, "Discard" drops it (not a book, or already in the catalogue), "Later" moves on.
 */
export function UnreadSpineReview({ pendingBooks = 0, onOpenBooks }: UnreadSpineReviewProps) {
  const { t, tp, n } = useI18n();
  const { unreadSpines: queue, books, collection, locale, resolveUnreadSpine, dismissUnreadSpine, setView, openBook } = useCollection();
  const mounted = useMounted();
  const isMac = mounted && typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform ?? navigator.userAgent);

  const queueIds = useMemo(() => new Set(queue.map((s) => s.id)), [queue]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  /** spines named / discarded in this session (a failed request puts the spine back into the queue) */
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const lastIndexRef = useRef(0);

  let index = currentId ? queue.findIndex((s) => s.id === currentId) : -1;
  if (index < 0 && queue.length > 0) index = Math.min(lastIndexRef.current, queue.length - 1);
  const current = index >= 0 ? queue[index] : null;
  useEffect(() => {
    if (index >= 0) lastIndexRef.current = index;
    if (current && current.id !== currentId) setCurrentId(current.id);
  }, [index, current, currentId]);

  const doneCount = doneIds.filter((id) => !queueIds.has(id)).length;
  const addedCount = addedIds.filter((id) => !queueIds.has(id)).length;
  const total = queue.length + doneCount;
  const position = current ? doneCount + index + 1 : total;

  const [draft, setDraft] = useState({ id: '', author: '', title: '' });
  if (current && draft.id !== current.id) setDraft(initialDraft(current));
  const draftForCurrent = current && draft.id === current.id ? draft : null;
  const [titleError, setTitleError] = useState(false);

  const deferredTitle = useDeferredValue(draftForCurrent?.title ?? '');
  const deferredAuthor = useDeferredValue(draftForCurrent?.author ?? '');
  const duplicates = useMemo(
    () => findDuplicates(books, { title: deferredTitle, author: deferredAuthor }, { limit: 2 }),
    [books, deferredTitle, deferredAuthor],
  );

  const [announcement, setAnnouncement] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const refocusRef = useRef(false);
  const outcomeRef = useRef<string | null>(null);

  /** before the card changes: slide direction, and whether focus follows to the next card */
  const prepareMove = (dir: 1 | -1) => {
    setDirection(dir);
    setTitleError(false);
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    refocusRef.current = !active || active === document.body || Boolean(cardRef.current?.contains(active));
  };

  useEffect(() => {
    if (!current) return;
    const now = t('book.review.spines.announce.current', { position: n(position), total: n(total) });
    setAnnouncement(outcomeRef.current ? `${outcomeRef.current} ${now}` : now);
    outcomeRef.current = null;
    // announce only when the card changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // AnimatePresence mounts the next card only after the previous one has left: focus it on mount
  const focusOnMount = useCallback((el: HTMLElement | null) => {
    if (!el || !refocusRef.current) return;
    refocusRef.current = false;
    el.focus({ preventScroll: true });
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.top > window.innerHeight * 0.6) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []);

  const add = () => {
    if (!current || !draftForCurrent) return;
    const title = cleanText(draftForCurrent.title);
    if (!title) {
      setTitleError(true);
      titleInputRef.current?.focus();
      return;
    }
    const author = cleanText(draftForCurrent.author);
    const spine = current;
    prepareMove(1);
    setDoneIds((list) => [...list, spine.id]);
    setAddedIds((list) => [...list, spine.id]);
    outcomeRef.current = t('book.review.spines.announce.added', { title: spineLabel({ author, title }) });
    setAnnouncement(outcomeRef.current);
    // optimistic in the provider: the spine leaves the queue now; on failure it comes back (and a toast explains)
    void resolveUnreadSpine(spine.id, { title, author });
  };

  const dismiss = () => {
    if (!current) return;
    const spine = current;
    prepareMove(1);
    setDoneIds((list) => [...list, spine.id]);
    outcomeRef.current = t('book.review.spines.announce.dismissed');
    setAnnouncement(outcomeRef.current);
    void dismissUnreadSpine(spine.id);
  };

  const go = (dir: 1 | -1) => {
    if (queue.length < 2 || index < 0) return;
    prepareMove(dir);
    setCurrentId(queue[(index + dir + queue.length) % queue.length].id);
  };

  const applyGuess = () => {
    if (!current) return;
    setDraft({ id: current.id, author: current.guessAuthor ?? draftForCurrent?.author ?? '', title: current.guessTitle ?? draftForCurrent?.title ?? '' });
    if (current.guessTitle) setTitleError(false);
    titleInputRef.current?.focus();
  };

  // keyboard: Enter in the form adds, Ctrl/⌘+Enter adds from anywhere on the card, Del discards, arrows move
  const titleEmpty = () => !cleanText(draftForCurrent?.title);
  const focusTitle = () => titleInputRef.current?.focus();
  const handlersRef = useRef({ add, dismiss, go, titleEmpty, focusTitle, hasCurrent: Boolean(current) });
  handlersRef.current = { add, dismiss, go, titleEmpty, focusTitle, hasCurrent: Boolean(current) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = handlersRef.current;
      if (e.defaultPrevented || !h.hasCurrent) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = e.target as HTMLElement | null;
      const field = target?.closest?.('[data-spine-field]')?.getAttribute('data-spine-field') ?? null;
      const typing = isTypingTarget(target);
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && (field !== null || ((e.ctrlKey || e.metaKey) && !typing))) {
        e.preventDefault();
        // Enter in the author field moves on to the empty title first (the phone keyboard's "next")
        if (field === 'author' && !e.ctrlKey && !e.metaKey && h.titleEmpty()) h.focusTitle();
        else h.add();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      // Del / arrows only act on the review itself (focus on it or nowhere), not on e.g. the page toolbar
      // (clicking the card's empty space focuses the view panel around it)
      const root = document.querySelector('[data-spine-review]');
      const onReview = !target || target === document.body || Boolean(target.closest?.('[data-spine-review]')) || Boolean(root && target.contains?.(root));
      if (!onReview) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        h.dismiss();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        h.go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        h.go(-1);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const frames = useCollectionFrames(collection.id, framesVersion(collection), current !== null);
  const frame = current?.frameId ? (frames.data?.byId.get(current.frameId) ?? null) : null;
  const landscapeFrame = Boolean(frame && frame.width > frame.height);

  /* ---------------- finished / empty ---------------- */
  if (!current) {
    const nextBooks =
      pendingBooks > 0 && onOpenBooks ? (
        <Button variant="gold" leftIcon={<ClipboardCheck />} onClick={onOpenBooks}>
          {t('book.review.books.next', { count: n(pendingBooks) })}
        </Button>
      ) : null;
    const backToShelf = (
      <Button variant={nextBooks ? 'secondary' : 'primary'} leftIcon={<Library />} onClick={() => setView('shelf')}>
        {t('book.review.backToShelf')}
      </Button>
    );
    return (
      <div className="mx-auto max-w-3xl">
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        {doneCount > 0 ? (
          <Card variant="bookplate" className="px-6 py-10 text-center sm:px-10">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 16 }}
              className="mx-auto flex size-16 items-center justify-center rounded-full border border-[#9c7424] bg-[radial-gradient(circle_at_35%_30%,#f6e2a8,#d3a855_55%,#a8792c)] text-[#2a1c08]"
            >
              <Sparkles className="size-7" aria-hidden="true" />
            </motion.div>
            <h2 tabIndex={-1} ref={focusOnMount} className="mt-5 font-display text-2xl font-semibold text-balance outline-none">
              {t('book.review.spines.done.title')}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-muted">
              {addedCount > 0 ? tp('book.review.spines.done.body', addedCount) : t('book.review.spines.done.none')}
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-2">
              {nextBooks}
              {backToShelf}
            </div>
          </Card>
        ) : (
          <Card variant="plain">
            <EmptyState
              icon={<Check />}
              title={t('book.review.spines.empty.title')}
              description={t('book.review.spines.empty.body')}
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  {nextBooks}
                  {backToShelf}
                </div>
              }
            />
          </Card>
        )}
      </div>
    );
  }

  const guess = current.guessTitle || (current.guessAuthor && current.reason !== 'illegible') ? spineLabel({ author: current.guessAuthor, title: current.guessTitle ?? '' }) : null;
  const guessApplied =
    Boolean(draftForCurrent) &&
    cleanText(draftForCurrent?.title) === cleanText(current.guessTitle) &&
    (!current.guessAuthor || cleanText(draftForCurrent?.author) === cleanText(current.guessAuthor));
  const modKey = isMac ? '⌘' : 'Ctrl';
  const kbd = (label: string) => (
    <Kbd size="sm" className="ml-1 max-md:hidden">
      {label}
    </Kbd>
  );

  return (
    <div className="flex flex-col gap-5" data-spine-review>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-semibold">{t('book.review.spines.title')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-pretty text-muted">{t('book.review.spines.intro')}</p>
        </div>
        <div className="w-full shrink-0 sm:w-72">
          <ProgressBar
            value={total > 0 ? (doneCount / total) * 100 : 0}
            tone="gold"
            size="sm"
            label={t('book.review.progressLabel')}
            detail={
              <span className="font-display text-lg font-semibold text-ink">
                {t('book.review.progress', { current: n(position), total: n(total) })}
              </span>
            }
          />
          <p className="mt-1 text-right text-xs text-muted">{tp('book.review.spines.remaining', queue.length)}</p>
        </div>
      </header>

      <div ref={cardRef} className="mx-auto w-full max-w-5xl min-w-0 scroll-mt-24">
        <AnimatePresence mode="wait" initial={false}>
          <motion.article
            key={current.id}
            initial={{ opacity: 0, x: direction * 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -28 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            aria-labelledby={`spine-heading-${current.id}`}
          >
            <Card variant="raised" className="overflow-hidden">
              <div className="border-b border-line/70 bg-surface-2/50 px-5 py-4 sm:px-6">
                <h3
                  ref={focusOnMount}
                  id={`spine-heading-${current.id}`}
                  tabIndex={-1}
                  className="font-display text-xl leading-tight font-semibold text-balance outline-none"
                >
                  {t('book.review.spines.heading')}
                </h3>
                <p className="mt-1 text-sm text-muted">{t(`book.review.spines.reason.${current.reason}`)}</p>
              </div>

              <div
                className={cn(
                  'grid items-start gap-x-6 gap-y-5 px-5 py-5 [grid-template-areas:"strip"_"frame"_"form"] sm:px-6',
                  !landscapeFrame &&
                    'md:grid-cols-[minmax(0,1fr)_min(17rem,32%)] md:grid-rows-[auto_1fr] md:[grid-template-areas:"strip_frame"_"form_frame"]',
                )}
              >
                <figure className="flex min-w-0 flex-col gap-1.5 [grid-area:strip]">
                  <SpineStrip
                    book={{ id: current.id, title: '', spineImage: current.spineImage, language: locale === 'en' ? 'en' : null }}
                    alt={t('book.review.spines.photoAlt')}
                    maxHeight="7.5rem"
                    fallback={
                      <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-3 text-sm text-muted">
                        <ImageOff className="size-4 shrink-0" aria-hidden="true" />
                        {t('book.review.spines.noPhoto')}
                      </p>
                    }
                  />
                  {current.spineImage ? <figcaption className="text-xs text-muted">{t('book.review.spines.photo')}</figcaption> : null}
                </figure>

                {current.frameId ? (
                  <figure className="flex min-w-0 flex-col gap-2 [grid-area:frame]">
                    {frame ? (
                      <FrameWithBox
                        frame={frame}
                        bbox={current.bbox}
                        title={t('book.review.spines.photoAlt')}
                        maxHeight={landscapeFrame ? 'min(22rem, 45dvh)' : 'min(26rem, 42dvh)'}
                        fullSize
                      />
                    ) : frames.status === 'loading' || frames.status === 'idle' ? (
                      <Skeleton className="w-full rounded-lg" height="min(18rem, 40dvh)" />
                    ) : (
                      <p className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-4 text-sm text-muted">
                        <ImageOff className="size-4 shrink-0" aria-hidden="true" />
                        {t('book.evidence.frameError')}
                      </p>
                    )}
                    <figcaption className="text-center text-xs text-muted">{t('book.review.spines.frame')}</figcaption>
                  </figure>
                ) : null}

                <div className="min-w-0 [grid-area:form]">
                  {guess && !guessApplied ? (
                    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                      <span className="text-muted">{t('book.review.spines.guess')}:</span>
                      <span className="min-w-0 font-medium text-ink [overflow-wrap:anywhere]">„{guess}”</span>
                      <Button size="sm" variant="ghost" leftIcon={<Wand2 />} onClick={applyGuess} className="ml-auto">
                        {t('book.review.spines.useGuess')}
                      </Button>
                    </div>
                  ) : null}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t('book.form.author')}>
                      <Input
                        data-spine-field="author"
                        value={draftForCurrent?.author ?? ''}
                        autoComplete="off"
                        enterKeyHint="next"
                        onChange={(e) => {
                          const author = e.target.value;
                          setDraft((d) => ({ ...d, author }));
                        }}
                      />
                    </Field>
                    <Field label={t('book.form.title')} required error={titleError ? t('book.form.error.required') : undefined}>
                      <Input
                        ref={titleInputRef}
                        data-spine-field="title"
                        value={draftForCurrent?.title ?? ''}
                        autoComplete="off"
                        enterKeyHint="done"
                        onChange={(e) => {
                          const title = e.target.value;
                          setDraft((d) => ({ ...d, title }));
                          if (titleError && title.trim()) setTitleError(false);
                        }}
                      />
                    </Field>
                  </div>

                  {duplicates.length > 0 ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className="mt-3 rounded-lg border border-[color-mix(in_oklab,var(--warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,var(--surface))] px-3 py-2.5 text-sm"
                    >
                      <p className="font-medium text-ink">
                        {duplicates[0].kind === 'exact' ? t('book.add.duplicate.exact') : t('book.add.duplicate.similar')}
                      </p>
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {duplicates.map((m) => (
                          <li key={m.book.id} className="min-w-0 truncate">
                            <button
                              type="button"
                              className="cursor-pointer text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
                              onClick={() => openBook(m.book.id)}
                            >
                              {spineLabel(m.book)}
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="secondary" tone="danger" leftIcon={<Trash2 />} onClick={dismiss}>
                          {t('book.review.spines.dismissDuplicate')}
                        </Button>
                        <span className="text-xs text-muted">{t('book.add.duplicate.hint')}</span>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <Button variant="primary" leftIcon={<Check />} onClick={add}>
                      {t('book.review.spines.add')}
                      {kbd('Enter')}
                    </Button>
                    <Button variant="ghost" tone="danger" leftIcon={<Trash2 />} onClick={dismiss} title={t('book.review.spines.dismissHint')}>
                      {t('book.review.spines.dismiss')}
                      {kbd('Del')}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted">{t('book.review.spines.dismissHint')}</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-line/70 px-3 py-2.5 sm:px-4">
                <Button variant="ghost" leftIcon={<ChevronLeft />} disabled={queue.length < 2} onClick={() => go(-1)}>
                  {t('book.review.prev')}
                  {kbd('←')}
                </Button>
                <Button variant="ghost" rightIcon={<SkipForward />} disabled={queue.length < 2} onClick={() => go(1)}>
                  {t('book.review.spines.later')}
                  {kbd('→')}
                </Button>
              </div>
            </Card>
          </motion.article>
        </AnimatePresence>

        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted max-md:hidden">
          <span className="font-medium">{t('book.review.shortcuts')}:</span>
          <span className="inline-flex items-center gap-1">
            <Kbd size="sm">Enter</Kbd> {t('book.review.spines.shortcut.add')}
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd size="sm">{modKey}</Kbd>+<Kbd size="sm">Enter</Kbd> {t('book.review.spines.shortcut.add')}
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd size="sm">Del</Kbd> {t('book.review.spines.shortcut.dismiss')}
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd size="sm">←</Kbd>
            <Kbd size="sm">→</Kbd> {t('book.review.shortcut.nav')}
          </span>
        </p>
      </div>
    </div>
  );
}
