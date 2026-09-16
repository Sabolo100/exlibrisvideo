'use client';

import { Trophy } from 'lucide-react';
import type { BookFilters } from '@/components/collection/context';
import { useI18n } from '@/i18n/client';
import { BarList } from './BarList';
import { CardNote, DashboardCard } from './ChartKit';
import type { CollectionStats } from './stats';

export interface TopAuthorsCardProps {
  stats: CollectionStats;
  onDrill: (patch: Partial<BookFilters>) => void;
  className?: string;
  delay?: number;
}

/**
 * Top 10 authors as horizontal bars; a row filters the catalogue to that author. When every author
 * has a single book, equal bars would say nothing, so the card says that in words instead.
 */
export function TopAuthorsCard({ stats, onDrill, className, delay }: TopAuthorsCardProps) {
  const { t, tp, n } = useI18n();
  const rest = Math.max(0, stats.authorCount - stats.topAuthors.length);
  const allSingle = stats.topAuthors.length > 1 && stats.topAuthors.every((a) => a.count <= 1);

  return (
    <DashboardCard
      title={t('data.stats.authors.title')}
      description={t('data.stats.authors.description')}
      icon={<Trophy />}
      className={className}
      delay={delay}
    >
      {stats.topAuthors.length === 0 ? (
        <CardNote>{t('data.stats.authors.empty')}</CardNote>
      ) : allSingle ? (
        <>
          <CardNote>{t('data.stats.authors.allSingle')}</CardNote>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {stats.topAuthors.map((a) => (
              <li key={a.author}>
                <button
                  type="button"
                  onClick={() => onDrill({ authors: [a.author] })}
                  aria-label={t('data.stats.filterAria', { label: a.author, books: tp('common.unit.book', a.count) })}
                  className="rounded-full border border-line bg-surface-2/60 px-3 py-1 text-sm text-ink transition-colors hover:border-accent/60 hover:bg-accent-soft"
                >
                  {a.author}
                </button>
              </li>
            ))}
          </ul>
          {rest > 0 ? <p className="mt-2 text-xs text-muted">{tp('data.stats.authors.more', rest)}</p> : null}
        </>
      ) : (
        <>
          <BarList
            aria-label={t('data.stats.authors.title')}
            labelColumn="minmax(0,42%)"
            delay={delay}
            items={stats.topAuthors.map((a) => ({
              key: a.author,
              label: a.author,
              title: a.author,
              value: a.count,
              valueLabel: n(a.count),
              ariaLabel: t('data.stats.filterAria', { label: a.author, books: tp('common.unit.book', a.count) }),
              onSelect: () => onDrill({ authors: [a.author] }),
            }))}
          />
          {rest > 0 ? <p className="mt-2 text-xs text-muted">{tp('data.stats.authors.more', rest)}</p> : null}
        </>
      )}
    </DashboardCard>
  );
}
