'use client';

/**
 * Filter controls (topics, reading status, authors, languages, decades, flags) and the button that
 * opens them: a Popover on desktop, a bottom-sheet Drawer on phones.
 */
import { Bookmark, ChevronDown, Handshake, Heart, ScanEye, Search, SlidersHorizontal } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { READING_STATUS_META, TopicChip } from '@/components/books';
import { Button, Checkbox, Chip, Drawer, Input, Popover, cn, useMediaQuery } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { languageName } from '@/lib/book-utils';
import { useCollection } from './context';
import { filterAuthorFacets } from './facets';
import { decadeLabel } from './labels';
import { useCollectionShell } from './shell-context';

const TOPICS_COLLAPSED = 14;
const AUTHORS_SHOWN = 60;

function toggleValue<T>(list: readonly T[], value: T, on: boolean): T[] {
  const has = list.includes(value);
  if (on && !has) return [...list, value];
  if (!on && has) return list.filter((v) => v !== value);
  return [...list];
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-t border-line/70 py-3 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id={id} className="font-sans text-xs font-semibold tracking-[0.08em] text-muted uppercase">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function FiltersPanel({ onDone, className }: { onDone?: () => void; className?: string }) {
  const { t, tp, locale } = useI18n();
  const { filters, setFilters, resetFilters, activeFilterCount, isOwner, visibleBooks } = useCollection();
  const { facets } = useCollectionShell();
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [authorQuery, setAuthorQuery] = useState('');

  const topics = useMemo(() => {
    const list = facets.topics;
    if (showAllTopics || list.length <= TOPICS_COLLAPSED) return list;
    // selected topics always stay visible
    const head = list.slice(0, TOPICS_COLLAPSED);
    const selectedTail = list.slice(TOPICS_COLLAPSED).filter((f) => filters.topics.includes(f.key));
    return [...head, ...selectedTail];
  }, [facets.topics, showAllTopics, filters.topics]);

  const authorMatches = useMemo(() => filterAuthorFacets(facets.authors, authorQuery), [facets.authors, authorQuery]);
  const authorsShown = useMemo(() => {
    const shown = authorMatches.slice(0, AUTHORS_SHOWN);
    // keep checked authors in the list even when they fall outside the first page
    for (const name of filters.authors) {
      if (!shown.some((a) => a.key === name)) {
        const facet = facets.authors.find((a) => a.key === name);
        shown.unshift(facet ?? { key: name, count: 0 });
      }
    }
    return shown;
  }, [authorMatches, filters.authors, facets.authors]);

  const showReview = isOwner && (facets.pendingReview > 0 || filters.needsReview);
  const showFavorites = facets.favorites > 0 || filters.favorites;
  const showLent = isOwner && (facets.lent > 0 || filters.lent);

  return (
    <div className={cn('flex flex-col', className)}>
      {facets.topics.length > 0 ? (
        <Section
          title={t('collection.filter.topics')}
          aside={
            facets.topics.length > TOPICS_COLLAPSED ? (
              <button
                type="button"
                onClick={() => setShowAllTopics((v) => !v)}
                aria-expanded={showAllTopics}
                className="inline-flex items-center gap-1 rounded text-xs font-medium text-accent hover:underline"
              >
                {showAllTopics ? '−' : `+${facets.topics.length - TOPICS_COLLAPSED}`}
                <ChevronDown aria-hidden="true" className={cn('size-3.5 transition-transform', showAllTopics && 'rotate-180')} />
              </button>
            ) : null
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {topics.map((f) => (
              <TopicChip
                key={f.key}
                topic={f.key}
                size="sm"
                count={f.count}
                selected={filters.topics.includes(f.key)}
                onSelectedChange={(on) => setFilters({ topics: toggleValue(filters.topics, f.key, on) })}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {facets.statuses.length > 0 ? (
        <Section title={t('collection.filter.statuses')}>
          <div className="flex flex-wrap gap-1.5">
            {facets.statuses.map((f) => {
              const meta = READING_STATUS_META[f.key];
              const Icon = meta.icon;
              return (
                <Chip
                  key={f.key}
                  size="sm"
                  icon={<Icon className="size-3.5" />}
                  count={f.count}
                  selected={filters.statuses.includes(f.key)}
                  onSelectedChange={(on) => setFilters({ statuses: toggleValue(filters.statuses, f.key, on) })}
                >
                  {t(meta.labelKey)}
                </Chip>
              );
            })}
          </div>
        </Section>
      ) : null}

      {facets.authors.length > 0 ? (
        <Section title={t('collection.filter.authors')}>
          {facets.authors.length > 8 ? (
            <Input
              type="search"
              size="sm"
              leftIcon={<Search className="size-4" />}
              value={authorQuery}
              onChange={(e) => setAuthorQuery(e.target.value)}
              onClear={() => setAuthorQuery('')}
              placeholder={t('collection.filter.authorsSearch')}
              aria-label={t('collection.filter.authorsSearch')}
              wrapperClassName="mb-2"
              className="[&::-webkit-search-cancel-button]:appearance-none"
            />
          ) : null}
          <ul className="max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-line/70 bg-bg/40 p-1">
            {authorsShown.length === 0 ? (
              <li className="px-2 py-3 text-center text-sm text-muted">{t('collection.filter.authorsNone')}</li>
            ) : (
              authorsShown.map((a) => (
                <li key={a.key} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2/70">
                  <Checkbox
                    size="sm"
                    className="min-w-0 flex-1"
                    checked={filters.authors.includes(a.key)}
                    onCheckedChange={(on) => setFilters({ authors: toggleValue(filters.authors, a.key, on) })}
                    label={<span className="block truncate">{a.key}</span>}
                  />
                  {a.count > 0 ? <span className="shrink-0 text-xs text-muted tabular-nums">{a.count}</span> : null}
                </li>
              ))
            )}
          </ul>
          {authorMatches.length > AUTHORS_SHOWN ? (
            <p className="mt-1.5 text-xs text-muted">{t('collection.filter.authorsMore', { count: authorMatches.length - AUTHORS_SHOWN })}</p>
          ) : null}
        </Section>
      ) : null}

      {facets.languages.length > 1 || filters.languages.length > 0 ? (
        <Section title={t('collection.filter.languages')}>
          <div className="flex flex-wrap gap-1.5">
            {facets.languages.map((f) => (
              <Chip
                key={f.key}
                size="sm"
                count={f.count}
                selected={filters.languages.includes(f.key)}
                onSelectedChange={(on) => setFilters({ languages: toggleValue(filters.languages, f.key, on) })}
              >
                {languageName(f.key, locale) || f.key}
              </Chip>
            ))}
          </div>
        </Section>
      ) : null}

      {facets.decades.length > 0 ? (
        <Section title={t('collection.filter.decades')}>
          <div className="flex flex-wrap gap-1.5">
            {facets.decades.map((f) => (
              <Chip
                key={f.key}
                size="sm"
                count={f.count}
                selected={filters.decades.includes(f.key)}
                onSelectedChange={(on) => setFilters({ decades: toggleValue(filters.decades, f.key, on) })}
              >
                {decadeLabel(f.key, locale, t)}
              </Chip>
            ))}
          </div>
        </Section>
      ) : null}

      {showReview || showFavorites || showLent ? (
        <Section title={t('collection.filter.other')}>
          <div className="flex flex-wrap gap-1.5">
            {showReview ? (
              <Chip
                size="sm"
                icon={<ScanEye className="size-3.5" />}
                count={facets.pendingReview}
                selected={filters.needsReview}
                onSelectedChange={(on) => setFilters({ needsReview: on })}
              >
                {t('collection.filter.needsReview')}
              </Chip>
            ) : null}
            {showFavorites ? (
              <Chip
                size="sm"
                icon={<Heart className="size-3.5" />}
                count={facets.favorites}
                selected={filters.favorites}
                onSelectedChange={(on) => setFilters({ favorites: on })}
              >
                {t('collection.filter.favorites')}
              </Chip>
            ) : null}
            {showLent ? (
              <Chip
                size="sm"
                icon={<Handshake className="size-3.5" />}
                count={facets.lent}
                selected={filters.lent}
                onSelectedChange={(on) => setFilters({ lent: on })}
              >
                {t('collection.filter.lent')}
              </Chip>
            ) : null}
          </div>
        </Section>
      ) : null}

      {facets.topics.length === 0 && facets.authors.length === 0 && facets.decades.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">
          <Bookmark aria-hidden="true" className="mx-auto mb-1 size-5 text-accent" />
          {t('collection.filter.nothing')}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3">
        <Button variant="ghost" size="sm" onClick={resetFilters} disabled={activeFilterCount === 0}>
          {t('collection.filter.clearAll')}
        </Button>
        {onDone ? (
          <Button variant="primary" size="sm" onClick={onDone}>
            {tp('collection.filter.show', visibleBooks.length)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** "Szűrők" button with the active-filter count; Popover ≥ 768 px, bottom sheet below. */
export function FiltersButton({ className }: { className?: string }) {
  const { t, tp, n } = useI18n();
  const { activeFilterCount, filters } = useCollection();
  const desktop = useMediaQuery('(min-width: 768px)');
  const [sheetOpen, setSheetOpen] = useState(false);
  // the search box has its own chip; the button counts the panel filters only
  const panelCount = activeFilterCount - (filters.q.trim() ? 1 : 0);

  const trigger = (
    <Button
      leftIcon={<SlidersHorizontal className="size-4" />}
      aria-label={panelCount > 0 ? `${t('collection.filter.button')} – ${tp('collection.filter.activeCount', panelCount)}` : undefined}
      className={className}
      onClick={desktop ? undefined : () => setSheetOpen(true)}
      rightIcon={
        panelCount > 0 ? (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold text-primary-ink tabular-nums">
            {n(panelCount)}
          </span>
        ) : undefined
      }
    >
      <span className="max-sm:sr-only">{t('collection.filter.button')}</span>
    </Button>
  );

  if (desktop) {
    return (
      <Popover trigger={trigger} align="end" aria-label={t('collection.filter.title')} className="w-[min(30rem,calc(100vw-2rem))] p-4">
        <FiltersPanel />
      </Popover>
    );
  }

  return (
    <>
      {trigger}
      <Drawer open={sheetOpen} onClose={() => setSheetOpen(false)} title={t('collection.filter.title')}>
        <FiltersPanel onDone={() => setSheetOpen(false)} />
      </Drawer>
    </>
  );
}
