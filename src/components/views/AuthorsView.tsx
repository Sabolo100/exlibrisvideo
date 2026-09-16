'use client';

import { ChevronDown, Filter, UserRound } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BookSpine, CountryFlag } from '@/components/books';
import { useCollection } from '@/components/collection/context';
import { TOOLBAR_ID } from '@/components/collection/Toolbar';
import { Button, cn, EmptyState, SegmentedControl } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { languageName } from '@/lib/book-utils';
import type { BookDTO } from '@/lib/types';
import {
  AUTHOR_SORTS,
  buildAuthorEntries,
  groupAuthorsByInitial,
  letterSectionId,
  railLetters,
  sortAuthorEntries,
  type AuthorEntry,
  type AuthorSort,
} from './data/authors';
import { oneOf, usePersistentState, usePrefersReducedMotion, useStickyChromeOffset } from './data/hooks';

const SORT_KEY = 'exl.data.authors.sort';
/** mini spines shown on a card before "+N" */
const MAX_SPINES = 14;

/** A–Z author index with cards (flag, counts, languages, mini spines) and catalogue filtering. */
export function AuthorsView() {
  const { visibleBooks, books, locale, openBook, setFilters, setView, activeFilterCount, resetFilters } = useCollection();
  const { t, tp } = useI18n();
  const reduced = usePrefersReducedMotion();
  const [sort, setSort] = usePersistentState<AuthorSort>(SORT_KEY, 'name', oneOf(AUTHOR_SORTS));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const { authors, anonymous } = useMemo(() => buildAuthorEntries(visibleBooks, locale), [visibleBooks, locale]);
  const sections = useMemo(() => groupAuthorsByInitial(authors, locale), [authors, locale]);
  const byCount = useMemo(() => (sort === 'count' ? sortAuthorEntries(authors, 'count', locale) : []), [authors, sort, locale]);
  const rail = useMemo(() => railLetters(locale, sections.map((s) => s.letter)), [locale, sections]);

  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const sectionEls = useRef(new Map<string, HTMLElement>());
  // the rail and the jump targets sit below the sticky header + collection toolbar
  const chromeTop = useStickyChromeOffset(TOOLBAR_ID);

  // highlight the letter whose section is at the top of the viewport
  useEffect(() => {
    if (sort !== 'name' || typeof IntersectionObserver === 'undefined') return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const letter = (e.target as HTMLElement).dataset.letter ?? '';
          if (e.isIntersecting) visible.set(letter, e.boundingClientRect.top);
          else visible.delete(letter);
        }
        let best: string | null = null;
        let bestTop = Infinity;
        for (const [letter, top] of visible) {
          if (top < bestTop) {
            best = letter;
            bestTop = top;
          }
        }
        if (best) setActiveLetter(best);
      },
      { rootMargin: `-${chromeTop + 56}px 0px -55% 0px`, threshold: 0 },
    );
    for (const el of sectionEls.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [sections, sort, chromeTop]);

  const registerSection = useCallback((letter: string, el: HTMLElement | null) => {
    if (el) sectionEls.current.set(letter, el);
    else sectionEls.current.delete(letter);
  }, []);

  const jumpTo = (letter: string) => {
    const el = document.getElementById(letterSectionId(letter));
    if (!el) return;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    el.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
    setActiveLetter(letter);
  };

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const filterByAuthor = useCallback(
    (name: string) => {
      setFilters({ authors: [name] });
      setView('shelf');
    },
    [setFilters, setView],
  );
  const onOpen = useCallback((b: BookDTO) => openBook(b.id), [openBook]);

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

  const cardProps = { onToggle: toggle, onFilter: filterByAuthor, onOpen };

  return (
    <div className="relative" style={{ '--chrome-top': `${chromeTop}px` } as CSSProperties}>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-muted">
          <span className="font-medium text-ink tabular-nums">{tp('common.unit.author', authors.length)}</span>
          {' · '}
          <span className="tabular-nums">{tp('common.unit.book', visibleBooks.length)}</span>
        </p>
        <SegmentedControl<AuthorSort>
          className="ml-auto"
          size="sm"
          aria-label={t('data.authors.sort.label')}
          value={sort}
          onChange={setSort}
          options={AUTHOR_SORTS.map((s) => ({ value: s, label: t(`data.authors.sort.${s}`) }))}
        />
      </div>

      <div className={cn(sort === 'name' && sections.length > 0 && 'lg:grid lg:grid-cols-[2.5rem_minmax(0,1fr)] lg:items-start lg:gap-6')}>
      {sort === 'name' && sections.length > 0 ? (
        <nav
          aria-label={t('data.authors.rail.label')}
          className={cn(
            // phones: horizontal strip under the sticky chrome · desktop: vertical rail on the left
            'sticky top-[var(--chrome-top)] z-20 -mx-4 mb-4 overflow-x-auto border-y border-line/70 bg-bg/90 px-4 py-1.5 backdrop-blur [scrollbar-width:none] sm:-mx-6 sm:px-6',
            'lg:top-[calc(var(--chrome-top)+1rem)] lg:mx-0 lg:mb-0 lg:max-h-[calc(100dvh-var(--chrome-top)-2rem)] lg:overflow-x-visible lg:overflow-y-auto lg:rounded-card lg:border lg:bg-surface/80 lg:px-1 lg:py-2',
          )}
        >
          <ol className="flex gap-0.5 lg:flex-col">
            {rail.map(({ letter, enabled }) => (
              <li key={letter}>
                <button
                  type="button"
                  disabled={!enabled}
                  aria-current={enabled && activeLetter === letter ? 'location' : undefined}
                  aria-label={t('data.authors.rail.jump', { letter: letter === '#' ? t('data.authors.rail.other') : letter })}
                  onClick={() => jumpTo(letter)}
                  className={cn(
                    'flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-[0.8125rem] font-semibold transition-colors lg:h-[1.375rem] lg:w-full lg:min-w-0 lg:px-0 lg:text-xs',
                    !enabled
                      ? 'cursor-default text-muted/40'
                      : activeLetter === letter
                        ? 'bg-primary text-primary-ink'
                        : 'text-ink hover:bg-accent-soft',
                  )}
                >
                  {letter}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="min-w-0">
        {sort === 'name' ? (
          sections.map((section) => (
            <section
              key={section.letter}
              id={letterSectionId(section.letter)}
              data-letter={section.letter}
              ref={(el) => registerSection(section.letter, el)}
              aria-labelledby={`${letterSectionId(section.letter)}-h`}
              // jump targets clear the sticky chrome (+ the horizontal letter strip below lg)
              className="mb-8 scroll-mt-[calc(var(--chrome-top)+3.75rem)] [contain-intrinsic-size:auto_480px] [content-visibility:auto] lg:scroll-mt-[calc(var(--chrome-top)+1rem)]"
            >
              <div className="mb-3 flex items-baseline gap-3 border-b border-line pb-1.5">
                <h3
                  id={`${letterSectionId(section.letter)}-h`}
                  tabIndex={-1}
                  className="font-display text-3xl leading-none font-semibold text-accent outline-none"
                >
                  {section.letter === '#' ? t('data.authors.section.other') : section.letter}
                </h3>
                <span className="text-xs text-muted tabular-nums">{tp('common.unit.author', section.authors.length)}</span>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {section.authors.map((a) => (
                  <li key={a.key}>
                    <AuthorCard author={a} isOpen={expanded.has(a.key)} {...cardProps} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {byCount.map((a, i) => (
              <li key={a.key}>
                <AuthorCard author={a} rank={i + 1} isOpen={expanded.has(a.key)} {...cardProps} />
              </li>
            ))}
          </ul>
        )}

        {anonymous.length > 0 ? (
          <AnonymousSection books={anonymous} expanded={expanded.has('__anonymous')} onToggle={() => toggle('__anonymous')} onOpen={onOpen} reduced={reduced} />
        ) : null}
      </div>
      </div>
    </div>
  );
}

interface AuthorCardProps {
  author: AuthorEntry;
  rank?: number;
  isOpen: boolean;
  onToggle: (key: string) => void;
  onFilter: (name: string) => void;
  onOpen: (book: BookDTO) => void;
}

const AuthorCard = memo(function AuthorCard({ author, rank, isOpen, onToggle, onFilter, onOpen }: AuthorCardProps) {
  const { t, tp, n, locale } = useI18n();
  const reduced = usePrefersReducedMotion();
  const listId = useId();
  const spines = author.books.slice(0, MAX_SPINES);
  const more = author.books.length - spines.length;
  const languages = author.languages.slice(0, 3).map((l) => languageName(l, locale));

  return (
    <article className="flex h-full flex-col rounded-card border border-line bg-surface p-4 shadow-soft transition-shadow hover:shadow-lift">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="font-display text-lg leading-snug font-semibold text-balance text-ink">
            {rank ? <span className="mr-1.5 text-sm font-normal text-muted tabular-nums">{n(rank)}.</span> : null}
            {author.name}
          </h4>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-muted">
            {author.country ? <CountryFlag code={author.country} showName /> : null}
            {author.country && languages.length > 0 ? <span aria-hidden="true">·</span> : null}
            {languages.length > 0 ? <span>{languages.join(', ')}</span> : null}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-[#7a561b] tabular-nums dark:text-accent">
          {tp('common.unit.book', author.count)}
        </span>
      </header>

      <div className="mt-3 flex min-h-[4.5rem] items-end gap-[3px] border-b-[5px] border-wood pb-px" aria-label={t('data.authors.spines', { name: author.name })} role="group">
        {spines.map((b) => (
          <BookSpine key={b.id} book={b} size="xs" onClick={onOpen} />
        ))}
        {more > 0 ? (
          <span className="mb-1 ml-1 self-end text-xs font-medium text-muted tabular-nums" title={tp('data.authors.moreBooks', more)}>
            +{n(more)}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={isOpen}
          aria-controls={listId}
          onClick={() => onToggle(author.key)}
          rightIcon={<ChevronDown aria-hidden="true" className={cn('transition-transform duration-200', isOpen && 'rotate-180')} />}
        >
          {t(isOpen ? 'data.authors.hideTitles' : 'data.authors.showTitles', { count: n(author.count) })}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          leftIcon={<Filter aria-hidden="true" />}
          onClick={() => onFilter(author.name)}
          title={t('data.authors.filterAria', { name: author.name })}
        >
          {t('data.authors.filter')}
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.ol
            id={listId}
            key="titles"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: 'easeOut' }}
            className="mt-2 overflow-hidden"
          >
            {author.books.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onOpen(b)}
                  className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 text-ink">{b.title}</span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">{b.firstPublishedYear ?? ''}</span>
                </button>
              </li>
            ))}
          </motion.ol>
        ) : (
          <div id={listId} hidden />
        )}
      </AnimatePresence>
    </article>
  );
});

function AnonymousSection({
  books,
  expanded,
  onToggle,
  onOpen,
  reduced,
}: {
  books: BookDTO[];
  expanded: boolean;
  onToggle: () => void;
  onOpen: (book: BookDTO) => void;
  reduced: boolean;
}) {
  const { t, tp, n } = useI18n();
  const listId = useId();
  const spines = books.slice(0, 40);
  return (
    <section aria-labelledby={`${listId}-h`} className="mt-4 mb-8 rounded-card border border-dashed border-line bg-surface-2/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
          <UserRound className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`${listId}-h`} className="font-display text-xl font-semibold text-ink">
            {t('data.authors.noAuthor.title')}
          </h3>
          <p className="mt-0.5 text-sm text-muted">{t('data.authors.noAuthor.description')}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-muted tabular-nums">
          {tp('common.unit.book', books.length)}
        </span>
      </div>
      <div className="mt-3 flex min-h-[4.5rem] flex-wrap items-end gap-[3px]" role="group" aria-label={t('data.authors.noAuthor.title')}>
        {spines.map((b) => (
          <BookSpine key={b.id} book={b} size="xs" onClick={onOpen} />
        ))}
        {books.length > spines.length ? (
          <span className="mb-1 ml-1 text-xs font-medium text-muted tabular-nums">+{n(books.length - spines.length)}</span>
        ) : null}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="mt-2"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={onToggle}
        rightIcon={<ChevronDown aria-hidden="true" className={cn('transition-transform duration-200', expanded && 'rotate-180')} />}
      >
        {t(expanded ? 'data.authors.hideTitles' : 'data.authors.showTitles', { count: n(books.length) })}
      </Button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.ol
            id={listId}
            key="titles"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: 'easeOut' }}
            className="mt-1 grid overflow-hidden sm:grid-cols-2"
          >
            {books.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onOpen(b)}
                  className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface"
                >
                  <span className="min-w-0 flex-1 text-ink">{b.title}</span>
                  {b.publisher ? <span className="shrink-0 truncate text-xs text-muted">{b.publisher}</span> : null}
                </button>
              </li>
            ))}
          </motion.ol>
        ) : (
          <div id={listId} hidden />
        )}
      </AnimatePresence>
    </section>
  );
}
