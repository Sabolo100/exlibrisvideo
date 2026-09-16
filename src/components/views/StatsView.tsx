'use client';

import { FilterX, Info } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { useCollection, type BookFilters } from '@/components/collection/context';
import { Button, cn, EmptyState } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { CategoryCard } from './data/CategoryCard';
import { CountriesCard } from './data/CountriesCard';
import { DecadesCard } from './data/DecadesCard';
import { FunFactsCard } from './data/FunFactsCard';
import { LanguagesCard } from './data/LanguagesCard';
import { CHART_PALETTE_CLASS } from './data/palette';
import { QualityCard } from './data/QualityCard';
import { ReadingStatusCard } from './data/ReadingStatusCard';
import { ReadTodayCard } from './data/ReadTodayCard';
import { StatCards } from './data/StatCards';
import { computeStats } from './data/stats';
import { TopAuthorsCard } from './data/TopAuthorsCard';

/**
 * Statistics dashboard of the books in view (the current filters apply). Hand-made SVG charts;
 * chart elements drill into the catalogue by setting a filter and switching to the shelf.
 */
export function StatsView() {
  const { collection, books, visibleBooks, isOwner, locale, openBook, setFilters, setView, activeFilterCount, resetFilters } =
    useCollection();
  const { t, n } = useI18n();

  // colours follow the category across filters: palette slots are ranked on the whole collection
  const stats = useMemo(() => computeStats(visibleBooks, { locale, paletteBooks: books }), [visibleBooks, books, locale]);
  const classificationPending = useMemo(() => visibleBooks.some((b) => !b.enriched), [visibleBooks]);

  const drill = useCallback(
    (patch: Partial<BookFilters>) => {
      setFilters(patch);
      setView('shelf');
    },
    [setFilters, setView],
  );
  const open = useCallback((id: string) => openBook(id), [openBook]);
  const toReview = useCallback(() => setView('review'), [setView]);
  const toTable = useCallback(() => setView('table'), [setView]);

  if (books.length === 0) {
    return <EmptyState title={t('data.empty.noBooks.title')} description={t('data.empty.noBooks.description')} />;
  }
  if (visibleBooks.length === 0) {
    return (
      <EmptyState
        title={t('data.empty.noResults.title')}
        description={t('data.empty.noResults.description')}
        action={activeFilterCount > 0 ? <Button onClick={resetFilters}>{t('data.filters.reset')}</Button> : undefined}
      />
    );
  }

  return (
    <div className={cn('flex flex-col gap-4 sm:gap-5', CHART_PALETTE_CLASS)}>
      {activeFilterCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-surface-2/60 px-4 py-2.5 text-sm text-ink">
          <Info aria-hidden="true" className="size-4 shrink-0 text-muted" />
          <p className="min-w-0 flex-1">{t('data.stats.filtered', { count: n(visibleBooks.length), total: n(books.length) })}</p>
          <Button size="sm" variant="ghost" leftIcon={<FilterX aria-hidden="true" />} onClick={resetFilters}>
            {t('data.filters.reset')}
          </Button>
        </div>
      ) : null}

      <StatCards stats={stats} isOwner={isOwner} />

      <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-12">
        <TopAuthorsCard stats={stats} onDrill={drill} className="lg:col-span-7" delay={0.08} />
        <CategoryCard
          stats={stats}
          classificationPending={classificationPending}
          onDrill={drill}
          className="lg:col-span-5"
          delay={0.12}
        />
        <DecadesCard
          stats={stats}
          classificationPending={classificationPending}
          onDrill={drill}
          className="md:col-span-2 lg:col-span-7"
          delay={0.16}
        />
        <ReadingStatusCard
          stats={stats}
          isOwner={isOwner}
          onDrill={drill}
          onOpenTable={toTable}
          className="lg:col-span-5"
          delay={0.2}
        />
        <LanguagesCard
          stats={stats}
          classificationPending={classificationPending}
          onDrill={drill}
          className="lg:col-span-4"
          delay={0.22}
        />
        <CountriesCard stats={stats} classificationPending={classificationPending} className="lg:col-span-4" delay={0.24} />
        <QualityCard stats={stats} isOwner={isOwner} onReview={toReview} className="lg:col-span-4" delay={0.26} />
        <FunFactsCard stats={stats} onOpenBook={open} className="md:col-span-2 lg:col-span-7" delay={0.28} />
        <ReadTodayCard
          books={visibleBooks}
          collectionId={collection.id}
          onOpenBook={open}
          className="md:col-span-2 lg:col-span-5"
          delay={0.3}
        />
      </div>
    </div>
  );
}
