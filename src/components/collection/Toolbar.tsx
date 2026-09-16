'use client';

/**
 * Sticky catalogue toolbar: search with live result count, view switcher, sort, filters and the
 * active filter chips.
 */
import { ArrowDownUp, Search } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { Input, Kbd, Select, cn, useMediaQuery } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { ViewKey } from '@/lib/types';
import { ActiveFilters } from './ActiveFilters';
import { useCollection, type SortKey } from './context';
import { FiltersButton } from './FiltersPanel';
import { SEARCH_INPUT_ID } from './shell-context';
import { SORT_KEYS } from './url-state';
import { SORT_LABELS } from './view-meta';
import { ViewSwitcher } from './ViewSwitcher';

/** Views where the sort order is meaningless (they group or chart on their own). */
const SORTLESS_VIEWS: ReadonlySet<ViewKey> = new Set(['stats', 'frames', 'review', 'timeline']);

/** id of the sticky toolbar (the page measures it to scroll a new view under it) */
export const TOOLBAR_ID = 'collection-toolbar';

export function Toolbar({ views, className }: { views: ViewKey[]; className?: string }) {
  const { t, tp } = useI18n();
  const { books, visibleBooks, filters, setFilters, sort, setSort, view, activeFilterCount } = useCollection();
  const desktop = useMediaQuery('(min-width: 768px)');

  const filtered = activeFilterCount > 0;
  const resultText = filtered
    ? t('collection.search.results', { shown: visibleBooks.length, total: books.length })
    : tp('collection.search.resultsAll', books.length);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && filters.q) {
      event.preventDefault();
      event.stopPropagation();
      setFilters({ q: '' });
    }
  };

  const showSort = !SORTLESS_VIEWS.has(view);

  return (
    <div
      id={TOOLBAR_ID}
      role="region"
      aria-label={t('collection.toolbar.label')}
      className={cn(
        'sticky top-14 z-30 -mx-4 border-b border-line/70 bg-bg/90 px-4 pt-2 pb-2 backdrop-blur-md backdrop-saturate-150 sm:top-16 sm:-mx-6 sm:px-6',
        'supports-[not(backdrop-filter:blur(0))]:bg-bg print:hidden',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div role="search" className="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
          <Input
            id={SEARCH_INPUT_ID}
            type="search"
            value={filters.q}
            maxLength={200}
            onChange={(e) => setFilters({ q: e.target.value })}
            onClear={() => {
              setFilters({ q: '' });
              document.getElementById(SEARCH_INPUT_ID)?.focus();
            }}
            onKeyDown={onSearchKeyDown}
            leftIcon={<Search className="size-4" />}
            rightElement={
              desktop ? (
                <Kbd size="sm" aria-hidden="true" title={t('collection.search.shortcut')} className="mr-1">
                  /
                </Kbd>
              ) : undefined
            }
            placeholder={t('collection.search.placeholder')}
            aria-label={t('collection.search.label')}
            aria-keyshortcuts="/"
            autoComplete="off"
            enterKeyHint="search"
            spellCheck={false}
            className="[&::-webkit-search-cancel-button]:appearance-none"
            wrapperClassName="md:max-w-sm"
          />
          <p aria-hidden="true" className="hidden shrink-0 text-sm whitespace-nowrap text-muted tabular-nums lg:block">
            {resultText}
          </p>
          <p aria-live="polite" aria-atomic="true" className="sr-only">
            {resultText}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {showSort ? (
            <Select
              aria-label={t('collection.sort.label')}
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              leftIcon={<ArrowDownUp />}
              options={SORT_KEYS.map((key) => ({ value: key, label: t(SORT_LABELS[key]) }))}
              wrapperClassName="w-[10.5rem] max-sm:w-[8.75rem]"
            />
          ) : null}
          <FiltersButton />
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        <ViewSwitcher views={views} className="-mx-1 flex-1" />
        <p aria-hidden="true" className="shrink-0 text-xs whitespace-nowrap text-muted tabular-nums lg:hidden">
          {resultText}
        </p>
      </div>

      {filtered ? <ActiveFilters className="mt-1.5 pb-0.5" /> : null}
    </div>
  );
}
