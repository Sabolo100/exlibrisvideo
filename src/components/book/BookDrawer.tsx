'use client';

import {
  BadgeCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Film,
  Hand,
  Heart,
  Image as ImageIcon,
  Pencil,
  TriangleAlert,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BookCover,
  BookSpine,
  ConfidenceMeter,
  CountryFlag,
  READING_STATUS_META,
  ReadingStatusBadge,
  TopicChip,
  spineLabel,
} from '@/components/books';
import { useCollection, type BookFilters, type CollectionContextValue } from '@/components/collection/context';
import { FILTERED_VIEWS } from '@/components/collection/view-meta';
import {
  Badge,
  Button,
  Dialog,
  Drawer,
  Field,
  IconButton,
  Input,
  SegmentedControl,
  Spinner,
  StarRating,
  Textarea,
  useToast,
  cn,
} from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { bookTopicKeys, isLent, isPendingReview, languageName, sortBooks, splitAuthors } from '@/lib/book-utils';
import { topicLabel } from '@/lib/taxonomy';
import { READING_STATUSES, type BookDTO, type BookPatch, type ReadingStatus } from '@/lib/types';
import { BookEditForm } from './BookEditForm';
import { BOOK_LIMITS, formatTimecode, isTypingTarget, localizedDescription, neighbourIds, todayIsoDate } from './book-form-utils';
import { DeleteBookDialog } from './DeleteBookDialog';
import { BookFrameEvidence, SpineStrip, useEvidenceFrame } from './Evidence';
import { framesVersion } from './frames-store';
import { combineAutosaveStatus, useAutosave, type AutosaveStatus } from './useAutosave';

type PendingNav = { type: 'close' } | { type: 'go'; id: string };

/** Book detail drawer bound to useCollection().openBookId (renders nothing while no book is open). */
export function BookDrawer() {
  const ctx = useCollection();
  const { t, n } = useI18n();
  const { toast } = useToast();
  const { openBookId, openBook, books, visibleBooks, isOwner, locale, updateBook } = ctx;
  const book = useMemo(() => (openBookId ? (books.find((b) => b.id === openBookId) ?? null) : null), [openBookId, books]);

  const [mode, setMode] = useState<'view' | 'edit'>('view');
  // unsaved edits of the form, read by the close / browse guard at event time (nothing renders from it)
  const dirtyRef = useRef(false);
  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
  }, []);
  const [pendingNav, setPendingNav] = useState<PendingNav | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [shownId, setShownId] = useState(openBookId);
  if (shownId !== openBookId) {
    setShownId(openBookId);
    setMode('view');
    setDirty(false);
    setDeleteOpen(false);
    setPendingNav(null);
  }

  // the open book disappeared (deleted, merged away, removed with its source): close
  useEffect(() => {
    if (openBookId && !books.some((b) => b.id === openBookId)) openBook(null);
  }, [openBookId, books, openBook]);

  // prev / next over the list the user is looking at (all books in shelf order when the book is filtered out)
  const navList = useMemo(() => {
    if (!openBookId) return visibleBooks;
    if (visibleBooks.some((b) => b.id === openBookId)) return visibleBooks;
    return sortBooks(books, 'shelf', locale);
  }, [openBookId, visibleBooks, books, locale]);
  const nav = neighbourIds(navList, openBookId);

  const perform = (action: PendingNav) => {
    if (action.type === 'close') openBook(null);
    else openBook(action.id);
  };
  const guarded = (action: PendingNav) => {
    if (mode === 'edit' && dirtyRef.current) setPendingNav(action);
    else perform(action);
  };

  // ← / → browse (not while typing, editing or when another overlay is on top)
  const navRef = useRef({ nav, mode, guarded });
  navRef.current = { nav, mode, guarded };
  useEffect(() => {
    if (!book) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const { nav: current, mode: currentMode, guarded: go } = navRef.current;
      if (currentMode !== 'view' || isTypingTarget(e.target)) return;
      if (document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 1) return;
      const target = e.key === 'ArrowLeft' ? current.prev : current.next;
      if (!target) return;
      e.preventDefault();
      go({ type: 'go', id: target });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [book]);

  // start at the top when browsing to another book
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = topRef.current?.closest<HTMLElement>('.overflow-y-auto');
    if (scroller) scroller.scrollTop = 0;
  }, [openBookId, mode]);

  // keep keyboard focus in the drawer when the focused control disappears (edit form closed, callout
  // gone after "reviewed", prev/next disabled at the end of the list): move it to the book title
  const pendingReview = book ? isPendingReview(book) : false;
  useEffect(() => {
    if (!book || (mode === 'edit' && isOwner)) return;
    const id = requestAnimationFrame(() => {
      const panel = topRef.current?.closest<HTMLElement>('[role="dialog"]');
      const active = document.activeElement;
      if (!panel || (active && active !== document.body && (panel.contains(active) || active.closest('[role="dialog"]')))) return;
      panel.querySelector<HTMLElement>('[data-drawer-focus]')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [book, mode, isOwner, pendingReview, nav.prev, nav.next]);

  const markReviewed = async () => {
    if (!book || marking) return;
    setMarking(true);
    const saved = await updateBook(book.id, { reviewed: true, needsReview: false });
    setMarking(false);
    if (saved) toast({ title: t('book.toast.reviewed'), tone: 'success' });
  };

  const pending = pendingReview;
  const editing = mode === 'edit' && Boolean(book) && isOwner;

  const headerActions =
    book && !editing && nav.index >= 0 && nav.total > 1 ? (
      <div className="mr-1 flex items-center gap-0.5" title={t('book.drawer.navHint')}>
        <span className="mr-1 text-xs text-muted tabular-nums" aria-hidden="true">
          {t('book.drawer.position', { index: n(nav.index + 1), total: n(nav.total) })}
        </span>
        <IconButton
          aria-label={t('book.drawer.prev')}
          icon={<ChevronLeft />}
          size="sm"
          tooltip
          disabled={!nav.prev}
          onClick={() => nav.prev && guarded({ type: 'go', id: nav.prev })}
        />
        <IconButton
          aria-label={t('book.drawer.next')}
          icon={<ChevronRight />}
          size="sm"
          tooltip
          disabled={!nav.next}
          onClick={() => nav.next && guarded({ type: 'go', id: nav.next })}
        />
      </div>
    ) : null;

  const footer =
    book && isOwner && !editing ? (
      <>
        {/* icon-only on phones so the three actions fit one row */}
        <span className="mr-auto">
          <span className="sm:hidden">
            <IconButton aria-label={t('common.action.delete')} icon={<Trash2 className="text-danger" />} size="sm" onClick={() => setDeleteOpen(true)} />
          </span>
          <span className="max-sm:hidden">
            <Button variant="ghost" tone="danger" size="sm" leftIcon={<Trash2 />} onClick={() => setDeleteOpen(true)}>
              {t('common.action.delete')}
            </Button>
          </span>
        </span>
        <Button size="sm" leftIcon={<Pencil />} onClick={() => setMode('edit')}>
          {t('common.action.edit')}
        </Button>
        {pending ? (
          <Button size="sm" variant="primary" leftIcon={<Check />} loading={marking} onClick={() => void markReviewed()}>
            {t('book.action.markReviewed')}
          </Button>
        ) : null}
      </>
    ) : null;

  return (
    <>
      <Drawer
        open={Boolean(book)}
        onClose={() => guarded({ type: 'close' })}
        title={book ? (editing ? t('book.drawer.editTitle') : t('book.drawer.label', { title: spineLabel(book) })) : ''}
        description={editing && book ? book.title : undefined}
        hideTitle={!editing}
        headerActions={headerActions}
        footer={footer}
        size="md"
      >
        <div ref={topRef} />
        {book && editing ? (
          <BookEditForm
            key={book.id}
            book={book}
            onCancel={() => {
              setDirty(false);
              setMode('view');
            }}
            onSaved={() => {
              setDirty(false);
              setMode('view');
            }}
            onDirtyChange={setDirty}
          />
        ) : book ? (
          <BookDetails book={book} ctx={ctx} onEdit={() => setMode('edit')} onMarkReviewed={() => void markReviewed()} marking={marking} />
        ) : null}
      </Drawer>

      <DeleteBookDialog book={book} open={deleteOpen} onClose={() => setDeleteOpen(false)} onDeleted={() => openBook(null)} />

      <Dialog
        open={pendingNav !== null}
        onClose={() => setPendingNav(null)}
        title={t('book.unsaved.title')}
        description={t('book.unsaved.body')}
        icon={<TriangleAlert />}
        size="sm"
        footer={
          <>
            <Button data-autofocus onClick={() => setPendingNav(null)}>
              {t('book.unsaved.keep')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const action = pendingNav;
                setPendingNav(null);
                setDirty(false);
                setMode('view');
                if (action) perform(action);
              }}
            >
              {t('book.unsaved.discard')}
            </Button>
          </>
        }
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Details                                                             */
/* ------------------------------------------------------------------ */

interface BookDetailsProps {
  book: BookDTO;
  ctx: CollectionContextValue;
  onEdit: () => void;
  onMarkReviewed: () => void;
  marking: boolean;
}

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="font-sans text-xs font-semibold tracking-[0.08em] text-muted uppercase">{children}</h3>
      {aside}
    </div>
  );
}

/** The drawer body for one book (exported for tests and reuse). */
export function BookDetails({ book, ctx, onEdit, onMarkReviewed, marking }: BookDetailsProps) {
  const { t, tp, locale } = useI18n();
  const { isOwner, setFilters, setView, view, openBook, collection } = ctx;
  const authors = splitAuthors(book.author);
  const topics = bookTopicKeys(book);
  const description = localizedDescription(book, locale);
  const pending = isPendingReview(book);

  /**
   * Shows the filtered list: filter (switching to the shelf when the current view ignores filters),
   * then close. The provider tracks these updates synchronously, so closing the drawer does not step
   * back in history to the URL without the new filter.
   */
  const showFiltered = (patch: Partial<BookFilters>) => {
    setFilters(patch);
    if (!FILTERED_VIEWS.has(view)) setView('shelf');
    openBook(null);
  };
  const filterAuthor = (author: string) => showFiltered({ authors: [author] });
  const filterTopic = (topic: string) => showFiltered({ topics: [topic] });

  const facts = [
    book.firstPublishedYear ? (
      <span key="year" title={t('book.drawer.firstPublished')} className="tabular-nums">
        {book.firstPublishedYear}
      </span>
    ) : null,
    book.publisher ? <span key="publisher">{book.publisher}</span> : null,
    book.language ? <span key="language">{languageName(book.language, locale)}</span> : null,
    book.pageCount ? <span key="pages">{tp('book.drawer.pages', book.pageCount)}</span> : null,
  ].filter(Boolean);

  const secondary = [
    book.editionYear && book.editionYear !== book.firstPublishedYear ? t('book.drawer.edition', { year: book.editionYear }) : null,
    book.isbn ? t('book.drawer.isbn', { isbn: book.isbn }) : null,
  ].filter((x): x is string => Boolean(x));

  return (
    <div className="flex flex-col gap-6" data-book-id={book.id}>
      {/* hero: cover and the real spine standing on a little shelf */}
      <div className="-mx-5 -mt-4 border-b border-line/60 bg-[radial-gradient(120%_90%_at_50%_0%,var(--surface),var(--surface-2))] px-5 pt-6">
        <div className="flex items-end justify-center gap-5">
          {/* sized wrapper: BookCover's own w-full would win over a width class passed to it */}
          <div className="w-32 shrink-0 sm:w-40">
            <BookCover book={book} priority />
          </div>
          <BookSpine book={book} size="lg" photo decorative />
        </div>
        <div
          aria-hidden="true"
          className="-mx-2 h-3 rounded-t-[2px] bg-[linear-gradient(180deg,var(--wood-light),var(--wood)_55%,var(--wood-dark))] shadow-[0_6px_10px_-6px_rgb(0_0_0/0.45)]"
        />
      </div>

      <div className="-mt-2">
        {book.series ? <p className="mb-1 text-xs font-semibold tracking-[0.08em] text-accent uppercase">{book.series}</p> : null}
        <p data-drawer-focus tabIndex={-1} className="font-display text-[1.625rem] leading-[1.15] font-semibold text-balance outline-none [overflow-wrap:anywhere]">
          {book.title}
        </p>
        {book.subtitle ? <p className="mt-1 font-display text-lg leading-snug text-muted italic">{book.subtitle}</p> : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          {authors.length > 0 ? (
            authors.map((author, i) => (
              <span key={`${author}-${i}`} className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => filterAuthor(author)}
                  title={t('book.drawer.filterAuthor', { author })}
                  className="cursor-pointer text-[0.9375rem] font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary"
                >
                  {author}
                </button>
                {i < authors.length - 1 ? <span className="text-muted">·</span> : null}
              </span>
            ))
          ) : (
            <span className="text-[0.9375rem] text-muted italic">{t('common.book.unknownAuthor')}</span>
          )}
          {book.authorCountry ? <CountryFlag code={book.authorCountry} /> : null}
        </div>

        {book.originalTitle && book.originalTitle.trim().toLowerCase() !== book.title.trim().toLowerCase() ? (
          <p className="mt-2 text-sm text-muted">
            {t('book.drawer.originalTitle')}:{' '}
            <span className="text-ink italic" lang={book.originalLanguage ?? undefined}>
              {book.originalTitle}
            </span>
          </p>
        ) : null}

        {facts.length > 0 ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-ink">
            {facts.map((fact, i) => (
              <span key={i} className="inline-flex items-center gap-2">
                {i > 0 ? (
                  <span aria-hidden="true" className="text-accent">
                    ·
                  </span>
                ) : null}
                {fact}
              </span>
            ))}
          </p>
        ) : null}
        {secondary.length > 0 ? <p className="mt-1 text-xs text-muted tabular-nums">{secondary.join(' · ')}</p> : null}

        {!isOwner && (book.readingStatus !== 'unknown' || book.rating || book.favorite) ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ReadingStatusBadge status={book.readingStatus} hideUnknown />
            {book.rating ? <StarRating value={book.rating} size="sm" /> : null}
            {book.favorite ? (
              <Badge tone="red" icon={<Heart className="fill-current" aria-hidden="true" />}>
                {t('book.owner.favorite')}
              </Badge>
            ) : null}
          </div>
        ) : null}

        {topics.length > 0 || book.tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {topics.map((topic) => (
              <TopicChip
                key={topic}
                topic={topic}
                size="sm"
                onClick={() => filterTopic(topic)}
                title={t('book.drawer.filterTopic', { topic: topicLabel(topic, locale) })}
              />
            ))}
            {book.tags.map((tag) => (
              <Badge key={tag} tone="neutral">
                #{tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      {isOwner && pending ? (
        <div className="rounded-card border border-[color-mix(in_oklab,var(--warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,var(--surface))] p-4">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{t('book.callout.title')}</p>
              <p className="mt-0.5 text-sm text-muted">{t('book.callout.body')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="primary" leftIcon={<Check />} loading={marking} onClick={onMarkReviewed}>
                  {t('book.action.markReviewed')}
                </Button>
                <Button size="sm" leftIcon={<Pencil />} onClick={onEdit}>
                  {t('common.action.edit')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {description ? (
        <section>
          <SectionTitle>{t('book.drawer.description')}</SectionTitle>
          <p className="font-display text-[1.0625rem] leading-relaxed text-ink text-pretty" lang={description.lang}>
            {description.text}
          </p>
          {description.isFallback ? <p className="mt-1.5 text-xs text-muted italic">{t('book.drawer.descriptionFallback')}</p> : null}
        </section>
      ) : null}

      {isOwner ? <OwnerFields book={book} ctx={ctx} /> : null}

      <EvidenceSection book={book} collection={collection} />

      {book.coverImage ? (
        <p className="-mt-3 text-[0.6875rem] leading-snug text-muted">
          {t(book.coverFromOriginalEdition ? 'book.evidence.coverNoteOriginal' : 'book.evidence.coverNote')}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

function EvidenceSection({ book, collection }: { book: BookDTO; collection: CollectionContextValue['collection'] }) {
  const { t, tp } = useI18n();
  const version = framesVersion(collection);
  const hasEvidence = !(book.source === 'manual' && !book.bestFrameId && !book.spineImage);
  const { landscape } = useEvidenceFrame(collection.id, version, book, hasEvidence);
  const video = book.firstVideoId ? collection.videos.find((v) => v.id === book.firstVideoId) : undefined;
  const time = video?.kind === 'video' ? formatTimecode(book.firstTimeSec) : null;
  const spineReading = [book.spineAuthor, book.spineTitle].filter(Boolean).join(' – ');
  const showReading = spineReading && spineReading.toLowerCase() !== [book.author, book.title].filter(Boolean).join(' – ').toLowerCase();

  if (!hasEvidence) {
    return (
      <section>
        <SectionTitle>{t('book.evidence.title')}</SectionTitle>
        <p className="flex items-start gap-2 text-sm text-muted">
          <Hand className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('book.evidence.manualNote')}
        </p>
      </section>
    );
  }

  const facts = (
    <dl className="flex min-w-0 flex-col gap-2.5 text-sm">
      <div>
        <dt className="text-xs text-muted">{t('book.evidence.source')}</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-ink">
          {book.source === 'image' ? <ImageIcon className="size-3.5 text-muted" aria-hidden="true" /> : null}
          {book.source === 'video' ? <Film className="size-3.5 text-muted" aria-hidden="true" /> : null}
          {book.source === 'manual' ? <Hand className="size-3.5 text-muted" aria-hidden="true" /> : null}
          <span>{t(`book.evidence.source.${book.source}`)}</span>
          {time ? <span className="text-muted tabular-nums">· {time}</span> : null}
        </dd>
        {video ? <dd className="truncate text-xs text-muted" title={video.originalFilename}>{video.originalFilename}</dd> : null}
      </div>
      {book.detectionCount > 0 ? (
        <div>
          <dt className="sr-only">{t('book.evidence.frame')}</dt>
          <dd className="text-ink">{tp('book.evidence.seenIn', book.detectionCount)}</dd>
        </div>
      ) : null}
      {showReading ? (
        <div>
          <dt className="text-xs text-muted">{t('book.evidence.spineReading')}</dt>
          <dd className="min-w-0 text-ink [overflow-wrap:anywhere]">„{spineReading}”</dd>
        </div>
      ) : null}
      {book.reviewed ? (
        <div>
          <dt className="sr-only">{t('book.evidence.title')}</dt>
          <dd className="inline-flex items-center gap-1.5 text-success">
            <BadgeCheck className="size-4" aria-hidden="true" />
            {t('book.callout.reviewed')}
          </dd>
        </div>
      ) : null}
    </dl>
  );

  const frame = <BookFrameEvidence collectionId={collection.id} framesVersion={version} book={book} maxHeight={landscape ? '14rem' : '16rem'} />;

  return (
    <section>
      <SectionTitle aside={<ConfidenceMeter value={book.confidence} showLabel size="sm" />}>{t('book.evidence.title')}</SectionTitle>
      <SpineStrip book={book} maxHeight="4.5rem" className="mb-3" />
      {landscape ? (
        <div className="flex flex-col gap-3">
          {frame}
          {facts}
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-start gap-4">
          {frame}
          {facts}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Owner fields                                                        */
/* ------------------------------------------------------------------ */

const collapseSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();

function SaveIndicator({ status, onRetry }: { status: AutosaveStatus; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex min-h-5 items-center gap-1 text-xs" role="status" aria-live="polite">
      {status === 'saving' || status === 'pending' ? (
        <span className="inline-flex items-center gap-1 text-muted">
          <Spinner size="xs" decorative />
          {t('common.state.saving')}
        </span>
      ) : null}
      {status === 'saved' ? (
        <span className="inline-flex items-center gap-1 text-success">
          <Check className="size-3.5" aria-hidden="true" />
          {t('common.state.saved')}
        </span>
      ) : null}
      {status === 'error' ? (
        <span className="inline-flex items-center gap-1 text-danger">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          {t('book.save.error')}
          <button type="button" onClick={onRetry} className="ml-1 cursor-pointer font-medium underline underline-offset-2">
            {t('common.action.retry')}
          </button>
        </span>
      ) : null}
    </span>
  );
}

function OwnerFields({ book, ctx }: { book: BookDTO; ctx: CollectionContextValue }) {
  const { t, d } = useI18n();
  const { updateBook, books } = ctx;
  const booksRef = useRef(books);
  booksRef.current = books;

  const notes = useAutosave({
    recordId: book.id,
    serverValue: book.notes ?? '',
    save: async (id, value) => Boolean(await updateBook(id, { notes: value.trim() ? value : null })),
  });

  const lentTo = useAutosave({
    recordId: book.id,
    serverValue: book.lentTo ?? '',
    normalize: collapseSpaces,
    save: async (id, value) => {
      const name = collapseSpaces(value);
      // a new loan starts today; clearing the name ends the loan (like "Returned")
      const patch: BookPatch = name ? { lentTo: name } : { lentTo: null, lentAt: null };
      const current = booksRef.current.find((b) => b.id === id);
      if (name && current && !current.lentAt) patch.lentAt = todayIsoDate();
      return Boolean(await updateBook(id, patch));
    },
  });

  // typing a date fires a change per segment: debounce it like the text fields
  const lentAt = useAutosave({
    recordId: book.id,
    serverValue: book.lentAt ?? '',
    normalize: (value) => value,
    save: async (id, value) => Boolean(await updateBook(id, { lentAt: value || null })),
  });
  const lentStatus = combineAutosaveStatus(lentTo.status, lentAt.status);
  const retryLent = () => {
    if (lentTo.status === 'error') lentTo.retry();
    if (lentAt.status === 'error') lentAt.retry();
  };

  const setStatus = (status: ReadingStatus) => {
    if (status !== book.readingStatus) void updateBook(book.id, { readingStatus: status });
  };

  const lent = isLent(book) || lentTo.value.trim() !== '';
  const statusMeta = READING_STATUS_META[book.readingStatus] ?? READING_STATUS_META.unknown;

  return (
    <section className="rounded-card border border-line bg-surface-2/45 p-4">
      <SectionTitle>{t('book.owner.title')}</SectionTitle>

      <div className="flex flex-col gap-5">
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium text-ink">{t('common.status.label')}</span>
            <span className="text-muted">{t(statusMeta.labelKey)}</span>
          </div>
          <SegmentedControl<ReadingStatus>
            aria-label={t('common.status.label')}
            value={book.readingStatus}
            onChange={setStatus}
            iconOnly
            fullWidth
            options={READING_STATUSES.map((status) => {
              const meta = READING_STATUS_META[status];
              const Icon = meta.icon;
              return { value: status, label: t(meta.labelKey), title: t(meta.labelKey), icon: <Icon aria-hidden="true" /> };
            })}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink">{t('common.rating.label')}</span>
            <StarRating value={book.rating} onChange={(rating) => void updateBook(book.id, { rating })} size="lg" />
          </div>
          <Button
            variant="secondary"
            aria-pressed={book.favorite}
            leftIcon={<Heart className={cn('transition-colors', book.favorite ? 'fill-[#c2453f] text-[#c2453f]' : 'text-muted')} aria-hidden="true" />}
            onClick={() => void updateBook(book.id, { favorite: !book.favorite })}
            title={book.favorite ? t('book.owner.favoriteRemove') : t('book.owner.favoriteAdd')}
          >
            {t('book.owner.favorite')}
          </Button>
        </div>

        <Field label={t('book.owner.notes')} labelAside={<SaveIndicator status={notes.status} onRetry={notes.retry} />}>
          <Textarea
            autoResize
            minRows={3}
            maxRows={12}
            maxLength={BOOK_LIMITS.notes}
            value={notes.value}
            placeholder={t('book.owner.notesPlaceholder')}
            onChange={(e) => notes.setValue(e.target.value)}
            onBlur={notes.flush}
          />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-ink">{t('book.owner.lent')}</span>
            <SaveIndicator status={lentStatus} onRetry={retryLent} />
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
            <Field label={t('book.owner.lentTo')} hideLabel>
              <Input
                value={lentTo.value}
                maxLength={BOOK_LIMITS.lentTo}
                autoComplete="off"
                placeholder={t('book.owner.lentTo')}
                onChange={(e) => lentTo.setValue(e.target.value)}
                onBlur={lentTo.flush}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    lentTo.flush();
                  }
                }}
              />
            </Field>
            <Field label={t('book.owner.lentAt')} hideLabel>
              <Input
                type="date"
                value={lentAt.value}
                min="1900-01-01"
                max={todayIsoDate()}
                disabled={!lent}
                onChange={(e) => {
                  // a half-typed date reads as '' – wait for a complete one instead of clearing the date
                  if (e.target.validity.badInput) return;
                  lentAt.setValue(e.target.value);
                }}
                onBlur={lentAt.flush}
              />
            </Field>
          </div>
          {lent ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">
                {book.lentTo && book.lentAt
                  ? t('book.owner.lentSince', { name: book.lentTo, date: d(`${book.lentAt}T12:00:00`, { dateStyle: 'medium' }) })
                  : null}
              </p>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Undo2 />}
                onClick={() => {
                  lentTo.reset('');
                  lentAt.reset('');
                  void updateBook(book.id, { lentTo: null, lentAt: null });
                }}
              >
                {t('book.owner.returned')}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
