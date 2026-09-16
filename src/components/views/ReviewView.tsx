'use client';

import { Check, ChevronLeft, Combine, Library, Lock, PanelRightOpen, RotateCcw, Search, SkipForward, Sparkles, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { BookSpine, ConfidenceMeter, confidenceLevel, spineLabel } from '@/components/books';
import { DeleteBookDialog } from '@/components/book/DeleteBookDialog';
import { BookFrameEvidence, SpineStrip, useEvidenceFrame } from '@/components/book/Evidence';
import { MergeDialog } from '@/components/book/MergeDialog';
import { cleanText, isTypingTarget, mergeCandidates, reviewQueue } from '@/components/book/book-form-utils';
import { framesVersion } from '@/components/book/frames-store';
import { useCollection } from '@/components/collection/context';
import { TOOLBAR_ID } from '@/components/collection/Toolbar';
import { Button, Card, Dialog, EmptyState, Field, Input, Kbd, ProgressBar, useMounted, cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { SPINE_PALETTE, hash01 } from '@/lib/book-utils';
import type { BookDTO, BookPatch } from '@/lib/types';

/** Owner-only, card-by-card review of books that need a human look (needsReview && !reviewed). */
export function ReviewView() {
  const { isOwner } = useCollection();
  const { t } = useI18n();
  if (!isOwner) {
    return (
      <Card variant="plain" className="mx-auto max-w-2xl">
        <EmptyState icon={<Lock />} title={t('book.review.ownerOnly.title')} description={t('book.review.ownerOnly.body')} />
      </Card>
    );
  }
  return <ReviewSession />;
}

const LEVEL_DOT = { high: 'bg-success', medium: 'bg-warning', low: 'bg-danger' } as const;

/**
 * `top` for a sticky element that has to stay below another sticky bar (the collection toolbar sits
 * under the site header and changes height with active filter chips). 80 px when the bar is absent.
 */
function useStickyOffsetBelow(elementId: string, gap = 16): number {
  const [top, setTop] = useState(80);
  useEffect(() => {
    const bar = document.getElementById(elementId);
    if (!bar) return;
    const update = () => {
      const stickyTop = Number.parseFloat(getComputedStyle(bar).top);
      setTop(Math.round((Number.isFinite(stickyTop) ? stickyTop : 0) + bar.offsetHeight + gap));
    };
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(bar);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [elementId, gap]);
  return top;
}

function useIsMac(): boolean {
  const mounted = useMounted();
  if (!mounted || typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent);
}

export function ReviewSession() {
  const { t, tp, n } = useI18n();
  const { books, updateBook, collection, openBook, setView } = useCollection();
  const isMac = useIsMac();
  const modKey = isMac ? '⌘' : 'Ctrl';

  const queue = useMemo(() => reviewQueue(books), [books]);
  const queueIds = useMemo(() => new Set(queue.map((b) => b.id)), [queue]);

  const [currentId, setCurrentId] = useState<string | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  /** books resolved (accepted / deleted / merged) in this session, oldest first */
  const [done, setDone] = useState<BookDTO[]>([]);
  const lastIndexRef = useRef(0);

  // the current card: the chosen book, or – when it just left the queue – whatever slid into its place
  let index = currentId ? queue.findIndex((b) => b.id === currentId) : -1;
  if (index < 0 && queue.length > 0) index = Math.min(lastIndexRef.current, queue.length - 1);
  const current = index >= 0 ? queue[index] : null;
  useEffect(() => {
    if (index >= 0) lastIndexRef.current = index;
    if (current && current.id !== currentId) setCurrentId(current.id);
  }, [index, current, currentId]);

  const doneCount = done.filter((b) => !queueIds.has(b.id)).length;
  const total = queue.length + doneCount;
  const position = current ? doneCount + index + 1 : total;

  // editable author / title, reset for every card (and when the server copy changes while untouched)
  const [draft, setDraft] = useState({ id: '', author: '', title: '', baseAuthor: '', baseTitle: '' });
  if (current) {
    const baseAuthor = current.author ?? '';
    const baseTitle = current.title;
    const untouched = draft.author === draft.baseAuthor && draft.title === draft.baseTitle;
    if (draft.id !== current.id || (untouched && (draft.baseAuthor !== baseAuthor || draft.baseTitle !== baseTitle))) {
      setDraft({ id: current.id, author: baseAuthor, title: baseTitle, baseAuthor, baseTitle });
    }
  }
  const draftForCurrent = current && draft.id === current.id ? draft : null;
  const dirty = Boolean(
    current &&
      draftForCurrent &&
      (cleanText(draftForCurrent.title) !== cleanText(current.title) || cleanText(draftForCurrent.author) !== cleanText(current.author)),
  );
  const [titleError, setTitleError] = useState(false);

  const [announcement, setAnnouncement] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<BookDTO | null>(null);
  const [sameAsOpen, setSameAsOpen] = useState(false);
  const [mergeIds, setMergeIds] = useState<string[] | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  /** move keyboard focus to the next card's heading once it is mounted */
  const refocusRef = useRef(false);
  /** what just happened to the previous card, announced together with the next one */
  const outcomeRef = useRef<string | null>(null);

  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = current?.id ?? null;

  /**
   * Before the card changes: slide direction, and whether focus should follow to the next card
   * (it does when focus was on the card or nowhere; `focus` forces it after a dialog).
   */
  const prepareMove = (dir: 1 | -1, focus?: boolean) => {
    setDirection(dir);
    setTitleError(false);
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    refocusRef.current = focus ?? (!active || active === document.body || Boolean(cardRef.current?.contains(active)));
    if (!focus || typeof window === 'undefined') return;
    // after a dialog the card may already have changed (optimistic removal while the request ran), so the
    // mount hook will not fire again: focus the shown heading once the dialog has gone (exit animation)
    const started = performance.now();
    const tryFocus = () => {
      if (!refocusRef.current) return; // the mount hook did it
      const dialogOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
      const id = currentIdRef.current;
      const heading = document.getElementById(id ? `review-heading-${id}` : 'review-finished-heading');
      if (dialogOpen || !heading) {
        if (performance.now() - started < 1500) requestAnimationFrame(tryFocus);
        return;
      }
      const active = document.activeElement;
      if (active && active !== document.body && !heading.contains(active)) return; // the user moved on
      refocusRef.current = false;
      heading.focus({ preventScroll: true });
    };
    requestAnimationFrame(tryFocus);
  };

  useEffect(() => {
    if (!current) return;
    const now = t('book.review.announce.current', { title: spineLabel(current) });
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

  const accept = (withEdits: boolean) => {
    if (!current) return;
    const book = current;
    const patch: BookPatch = { reviewed: true, needsReview: false };
    if (withEdits && draftForCurrent) {
      const title = cleanText(draftForCurrent.title);
      if (!title) {
        setTitleError(true);
        titleInputRef.current?.focus();
        return;
      }
      if (title !== cleanText(book.title)) patch.title = title;
      const author = cleanText(draftForCurrent.author);
      if (author !== cleanText(book.author)) patch.author = author;
    }
    prepareMove(1);
    setDone((list) => [...list.filter((b) => b.id !== book.id), { ...book, ...patch } as BookDTO]);
    const outcome = t('book.review.announce.accepted', {
      title: spineLabel({ author: patch.author !== undefined ? patch.author : book.author, title: patch.title ?? book.title }),
    });
    outcomeRef.current = outcome;
    setAnnouncement(outcome);
    // optimistic in the provider: the book leaves the queue now; on failure it comes back (and a toast explains)
    void updateBook(book.id, patch);
  };

  const go = (dir: 1 | -1) => {
    if (queue.length < 2 || index < 0) return;
    prepareMove(dir);
    const next = queue[(index + dir + queue.length) % queue.length];
    setCurrentId(next.id);
  };

  const askDelete = () => {
    if (current) setDeleteTarget(current);
  };

  const resetDraft = () => {
    if (!current) return;
    setTitleError(false);
    setDraft({ id: current.id, author: current.author ?? '', title: current.title, baseAuthor: current.author ?? '', baseTitle: current.title });
  };

  // keyboard shortcuts
  const handlersRef = useRef({ accept, go, askDelete, dirty, hasCurrent: Boolean(current) });
  handlersRef.current = { accept, go, askDelete, dirty, hasCurrent: Boolean(current) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = handlersRef.current;
      if (e.defaultPrevented || !h.hasCurrent) return;
      // another layer (drawer, dialog, lightbox) owns the keyboard
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = e.target as HTMLElement | null;
      const inReviewField = Boolean(target?.closest?.('[data-review-field]'));
      const typing = isTypingTarget(target);

      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        if (typing && !inReviewField) return;
        e.preventDefault();
        h.accept(true);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        if (inReviewField) {
          e.preventDefault();
          h.accept(h.dirty);
          return;
        }
        if (typing || target?.closest?.('button, a[href], [role="button"], summary, [tabindex]:not([tabindex="-1"])')) return;
        e.preventDefault();
        h.accept(h.dirty);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      // Del / arrows only act on the review itself (focus on it or nowhere), not on e.g. the page toolbar
      const onReview = !target || target === document.body || Boolean(target.closest?.('[data-review-root]'));
      if (!onReview) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        h.askDelete();
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

  const version = framesVersion(collection);
  // landscape videos get the frame below the spine strip instead of beside it
  const landscapeFrame = useEvidenceFrame(collection.id, version, current).landscape;
  const stickyTop = useStickyOffsetBelow(TOOLBAR_ID);

  /* ---------------- finished / empty ---------------- */
  if (!current) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        {doneCount > 0 || done.length > 0 ? (
          <ReviewFinished books={done} count={Math.max(doneCount, done.length)} onBack={() => setView('shelf')} headingRef={focusOnMount} />
        ) : (
          <Card variant="plain">
            <EmptyState
              icon={<Check />}
              title={t('book.review.empty.title')}
              description={t('book.review.empty.body')}
              action={
                <Button variant="primary" leftIcon={<Library />} onClick={() => setView('shelf')}>
                  {t('book.review.backToShelf')}
                </Button>
              }
            />
          </Card>
        )}
      </div>
    );
  }

  const aiReading = [current.spineAuthor, current.spineTitle].filter(Boolean).join(' – ');
  const kbd = (label: string) => (
    <Kbd size="sm" className="ml-1 max-md:hidden">
      {label}
    </Kbd>
  );

  return (
    <div className="flex flex-col gap-5" data-review-root>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-semibold">{t('book.review.title')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('book.review.intro')}</p>
        </div>
        <div className="w-full shrink-0 sm:w-72">
          <ProgressBar
            value={total > 0 ? (doneCount / total) * 100 : 0}
            tone="gold"
            size="sm"
            label={t('book.review.progressLabel')}
            detail={
              <span className="text-ink">
                <span className="font-display text-lg font-semibold">{t('book.review.progress', { current: n(position), total: n(total) })}</span>
              </span>
            }
          />
          <p className="mt-1 text-right text-xs text-muted">{tp('book.review.remaining', queue.length)}</p>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* queue sidebar (desktop) */}
        <nav aria-label={t('book.review.queue')} className="sticky top-20 max-lg:hidden" style={{ top: stickyTop }}>
          <Card variant="plain" className="overflow-hidden">
            <p className="border-b border-line/70 px-4 py-2.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
              {t('book.review.queue')} <span className="tabular-nums">({n(queue.length)})</span>
            </p>
            <ol
              className="max-h-[calc(100dvh-12rem)] overflow-y-auto overscroll-contain p-1.5"
              style={{ maxHeight: `calc(100dvh - ${stickyTop + 64}px)` }}
            >
              {queue.map((book, i) => {
                const active = book.id === current.id;
                return (
                  <li key={book.id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        prepareMove(i >= index ? 1 : -1);
                        setCurrentId(book.id);
                      }}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                        active ? 'bg-accent-soft' : 'hover:bg-surface-2',
                      )}
                    >
                      <BookSpine book={book} size="xs" decorative />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block truncate text-sm', active ? 'font-semibold text-ink' : 'text-ink')}>{book.title}</span>
                        <span className="block truncate text-xs text-muted">{book.author ?? t('common.book.unknownAuthor')}</span>
                      </span>
                      <span
                        aria-hidden="true"
                        title={t(`common.confidence.${confidenceLevel(book.confidence)}`)}
                        className={cn('size-2 shrink-0 rounded-full', LEVEL_DOT[confidenceLevel(book.confidence)])}
                      />
                    </button>
                  </li>
                );
              })}
            </ol>
          </Card>
        </nav>

        <div ref={cardRef} className="min-w-0 scroll-mt-24">
          <AnimatePresence mode="wait" initial={false}>
            <motion.article
              key={current.id}
              initial={{ opacity: 0, x: direction * 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -28 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              aria-labelledby={`review-heading-${current.id}`}
            >
              <Card variant="raised" className="overflow-hidden">
                <div className="border-b border-line/70 bg-surface-2/50 px-5 py-4 sm:px-6">
                  <h3
                    ref={focusOnMount}
                    id={`review-heading-${current.id}`}
                    tabIndex={-1}
                    className="font-display text-xl leading-tight font-semibold text-balance outline-none [overflow-wrap:anywhere]"
                  >
                    {spineLabel(current)}
                  </h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                    <ConfidenceMeter value={current.confidence} showLabel size="sm" />
                    {current.detectionCount > 0 ? <span>{tp('book.evidence.seenIn', current.detectionCount)}</span> : null}
                  </div>
                </div>

                {/* evidence + form: the readable spine strip on top, the frame beside it (portrait) or below it (landscape) */}
                <div
                  className={cn(
                    'grid items-start gap-x-6 gap-y-5 px-5 py-5 [grid-template-areas:"strip"_"frame"_"form"] sm:px-6',
                    !landscapeFrame &&
                      'md:grid-cols-[minmax(0,1fr)_min(17rem,32%)] md:grid-rows-[auto_1fr] md:[grid-template-areas:"strip_frame"_"form_frame"]',
                  )}
                >
                  <figure className="flex min-w-0 flex-col gap-1.5 [grid-area:strip]">
                    <SpineStrip
                      book={current}
                      maxHeight="7.5rem"
                      fallback={
                        <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
                          <BookSpine book={current} size="sm" decorative />
                          <p className="text-sm text-muted">{t('book.review.noSpine')}</p>
                        </div>
                      }
                    />
                    {current.spineImage ? <figcaption className="text-xs text-muted">{t('book.evidence.spinePhoto')}</figcaption> : null}
                  </figure>

                  <figure className="flex min-w-0 flex-col gap-2 [grid-area:frame]">
                    <BookFrameEvidence
                      collectionId={collection.id}
                      framesVersion={version}
                      book={current}
                      maxHeight={landscapeFrame ? 'min(22rem, 45dvh)' : 'min(26rem, 50dvh)'}
                      fullSize
                    />
                    <figcaption className="text-center text-xs text-muted">{t('book.evidence.frame')}</figcaption>
                  </figure>

                  <div className="min-w-0 [grid-area:form]">
                    {aiReading ? (
                      <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                        <span className="text-muted">{t('book.review.aiRead')}: </span>
                        <span className="font-medium text-ink [overflow-wrap:anywhere]">„{aiReading}”</span>
                      </p>
                    ) : null}

                    <div className="grid gap-4 sm:grid-cols-2" data-review-form>
                      <Field label={t('book.form.author')}>
                        <Input
                          data-review-field
                          value={draftForCurrent?.author ?? ''}
                          autoComplete="off"
                          onChange={(e) => {
                            const author = e.target.value;
                            setDraft((d) => ({ ...d, author }));
                          }}
                        />
                      </Field>
                      <Field label={t('book.form.title')} required error={titleError ? t('book.form.error.required') : undefined}>
                        <Input
                          ref={titleInputRef}
                          data-review-field
                          value={draftForCurrent?.title ?? ''}
                          autoComplete="off"
                          onChange={(e) => {
                            const title = e.target.value;
                            setDraft((d) => ({ ...d, title }));
                            if (titleError && title.trim()) setTitleError(false);
                          }}
                        />
                      </Field>
                    </div>
                    <p className="mt-1.5 text-xs text-muted">{t('book.review.fixHint')}</p>

                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <Button variant="primary" leftIcon={<Check />} onClick={() => accept(dirty)}>
                        {dirty ? t('book.review.saveAccept') : t('book.review.accept')}
                        {dirty ? kbd(`${modKey}+Enter`) : kbd('Enter')}
                      </Button>
                      {dirty ? (
                        <Button variant="ghost" leftIcon={<RotateCcw />} onClick={resetDraft}>
                          {t('book.review.resetEdits')}
                        </Button>
                      ) : null}
                      <Button leftIcon={<Combine />} onClick={() => setSameAsOpen(true)}>
                        {t('book.review.sameAs')}
                      </Button>
                      <Button variant="ghost" tone="danger" leftIcon={<Trash2 />} onClick={askDelete} title={t('book.review.deleteHint')}>
                        {t('common.action.delete')}
                        {kbd('Del')}
                      </Button>
                      <span className="flex-1" />
                      <Button variant="ghost" size="sm" leftIcon={<PanelRightOpen />} onClick={() => openBook(current.id)}>
                        {t('book.review.details')}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-line/70 px-3 py-2.5 sm:px-4">
                  <Button variant="ghost" leftIcon={<ChevronLeft />} disabled={queue.length < 2} onClick={() => go(-1)}>
                    {t('book.review.prev')}
                    {kbd('←')}
                  </Button>
                  <Button variant="ghost" rightIcon={<SkipForward />} disabled={queue.length < 2} onClick={() => go(1)}>
                    {t('book.review.skip')}
                    {kbd('→')}
                  </Button>
                </div>
              </Card>
            </motion.article>
          </AnimatePresence>

          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted max-md:hidden">
            <span className="font-medium">{t('book.review.shortcuts')}:</span>
            <span className="inline-flex items-center gap-1">
              <Kbd size="sm">Enter</Kbd> {t('book.review.shortcut.accept')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd size="sm">{modKey}</Kbd>+<Kbd size="sm">Enter</Kbd> {t('book.review.shortcut.saveAccept')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd size="sm">Del</Kbd> {t('book.review.shortcut.delete')}
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd size="sm">←</Kbd>
              <Kbd size="sm">→</Kbd> {t('book.review.shortcut.nav')}
            </span>
          </p>
        </div>
      </div>

      <DeleteBookDialog
        book={deleteTarget}
        open={deleteTarget !== null}
        focusConfirm
        onClose={() => setDeleteTarget(null)}
        onDeleted={(book) => {
          prepareMove(1, true);
          outcomeRef.current = t('book.review.announce.deleted', { title: spineLabel(book) });
          setAnnouncement(outcomeRef.current);
          setDone((list) => [...list.filter((b) => b.id !== book.id), book]);
        }}
      />

      <SameAsDialog
        open={sameAsOpen}
        target={current}
        books={books}
        onClose={() => setSameAsOpen(false)}
        onPick={(other) => {
          setSameAsOpen(false);
          setMergeIds([current.id, other.id]);
        }}
      />

      <MergeDialog
        open={mergeIds !== null}
        sourceIds={mergeIds ?? []}
        onOpenChange={(open) => {
          if (!open) setMergeIds(null);
        }}
        onMerged={(merged) => {
          prepareMove(1, true);
          outcomeRef.current = t('book.review.announce.merged', { title: spineLabel(merged) });
          setAnnouncement(outcomeRef.current);
          // every pending entry of the merge is resolved: the removed ones are gone, the kept one is marked reviewed
          const resolved = books.filter((b) => (mergeIds ?? []).includes(b.id) && queueIds.has(b.id));
          setDone((list) => [...list.filter((b) => !resolved.some((r) => r.id === b.id)), ...resolved.map((b) => (b.id === merged.id ? merged : b))]);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "Same as…" search                                                   */
/* ------------------------------------------------------------------ */

function SameAsDialog({
  open,
  target,
  books,
  onClose,
  onPick,
}: {
  open: boolean;
  target: BookDTO;
  books: BookDTO[];
  onClose: () => void;
  onPick: (book: BookDTO) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [lastTarget, setLastTarget] = useState(target.id);
  if (lastTarget !== target.id) {
    setLastTarget(target.id);
    setQuery('');
  }
  const results = useMemo(() => (open ? mergeCandidates(books, target, query, 12) : []), [open, books, target, query]);
  const searching = query.trim() !== '';

  return (
    <Dialog
      open={open}
      onClose={() => {
        setQuery('');
        onClose();
      }}
      title={t('book.review.sameAs.title')}
      description={t('book.review.sameAs.description')}
      icon={<Combine />}
      size="md"
    >
      <div className="flex flex-col gap-3 pt-1">
        <Input
          data-autofocus
          type="search"
          leftIcon={<Search />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery('')}
          placeholder={t('book.review.sameAs.search')}
          aria-label={t('book.review.sameAs.search')}
          autoComplete="off"
        />
        <p className="text-xs font-semibold tracking-[0.08em] text-muted uppercase" aria-live="polite">
          {searching ? t('book.review.sameAs.results') : t('book.review.sameAs.suggestions')}
        </p>
        {results.length === 0 ? (
          <p className="rounded-lg bg-surface-2 px-3 py-4 text-center text-sm text-muted">
            {searching ? t('book.review.sameAs.noResults') : t('book.review.sameAs.noSuggestions')}
          </p>
        ) : (
          <ul className="-mx-1 flex max-h-[min(24rem,50dvh)] flex-col gap-1 overflow-y-auto overscroll-contain px-1">
            {results.map((book) => (
              <li key={book.id}>
                <button
                  type="button"
                  onClick={() => onPick(book)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-line hover:bg-surface-2"
                >
                  <BookSpine book={book} size="xs" photo decorative />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{book.title}</span>
                    <span className="block truncate text-sm text-muted">
                      {book.author ?? t('common.book.unknownAuthor')}
                      {book.firstPublishedYear ? ` · ${book.firstPublishedYear}` : ''}
                    </span>
                  </span>
                  <Combine className="size-4 shrink-0 text-muted" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Finished                                                            */
/* ------------------------------------------------------------------ */

function ReviewFinished({
  books,
  count,
  onBack,
  headingRef,
}: {
  books: BookDTO[];
  count: number;
  onBack: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { tp, t } = useI18n();
  const shelf = books.slice(-16);
  const confetti = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const angle = hash01('angle', i) * Math.PI * 2;
        const dist = 90 + hash01('dist', i) * 150;
        return {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist * 0.7 - 40,
          rotate: (hash01('rot', i) - 0.5) * 540,
          color: SPINE_PALETTE[i % SPINE_PALETTE.length],
          w: 5 + Math.round(hash01('w', i) * 4),
          h: 12 + Math.round(hash01('h', i) * 10),
          delay: hash01('delay', i) * 0.25,
        };
      }),
    [],
  );

  return (
    <Card variant="bookplate" className="relative overflow-hidden px-6 py-10 text-center sm:px-10">
      <div aria-hidden="true" className="pointer-events-none absolute top-24 left-1/2">
        {confetti.map((c, i) => (
          <motion.span
            key={i}
            className="absolute block rounded-[1px]"
            style={{ width: c.w, height: c.h, backgroundColor: c.color }}
            initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.4 }}
            animate={{ x: c.x, y: [0, c.y, c.y + 120], opacity: [0, 1, 0], rotate: c.rotate, scale: 1 }}
            transition={{ duration: 1.6, delay: c.delay, ease: 'easeOut', times: [0, 0.45, 1] }}
          />
        ))}
      </div>

      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 16 }}
        className="relative mx-auto flex size-20 items-center justify-center rounded-full border border-[#9c7424] bg-[radial-gradient(circle_at_35%_30%,#f6e2a8,#d3a855_55%,#a8792c)] text-[#2a1c08] shadow-[inset_0_1px_0_rgb(255_250_230/0.7),0_8px_24px_rgb(120_80_20/0.35)]"
      >
        <Sparkles className="size-9" aria-hidden="true" />
      </motion.div>

      <h2 ref={headingRef} id="review-finished-heading" tabIndex={-1} className="relative mt-5 font-display text-2xl font-semibold text-balance outline-none sm:text-3xl">
        {t('book.review.done.title')}
      </h2>
      <p className="relative mx-auto mt-2 max-w-md text-muted">{tp('book.review.done.body', count)}</p>

      {shelf.length > 0 ? (
        <div className="relative mx-auto mt-8 w-fit max-w-full" aria-hidden="true">
          <div className="flex items-end justify-center gap-[2px] px-3">
            {shelf.map((book, i) => (
              <motion.div
                key={book.id}
                initial={{ y: -40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 0.25 + i * 0.05 }}
              >
                <BookSpine book={book} size="sm" decorative />
              </motion.div>
            ))}
          </div>
          <div className="h-3 rounded-[2px] bg-[linear-gradient(180deg,var(--wood-light),var(--wood)_55%,var(--wood-dark))] shadow-[0_6px_10px_-6px_rgb(0_0_0/0.45)]" />
        </div>
      ) : null}

      <div className="relative mt-8 flex justify-center">
        <Button variant="primary" size="lg" leftIcon={<Library />} onClick={onBack}>
          {t('book.review.backToShelf')}
        </Button>
      </div>
    </Card>
  );
}
