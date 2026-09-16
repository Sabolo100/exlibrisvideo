'use client';

import { Earth, Hourglass } from 'lucide-react';
import { CountryFlag } from '@/components/books';
import { useI18n } from '@/i18n/client';
import { countryName } from '@/lib/book-utils';
import { BarList } from './BarList';
import { CardNote, DashboardCard } from './ChartKit';
import type { CollectionStats } from './stats';

export interface CountriesCardProps {
  stats: CollectionStats;
  classificationPending: boolean;
  className?: string;
  delay?: number;
}

const MAX_ROWS = 8;

/** Where the authors come from: flag, country, number of authors (books in the tooltip). */
export function CountriesCard({ stats, classificationPending, className, delay }: CountriesCardProps) {
  const { t, tp, locale } = useI18n();
  const { entries, unknownAuthors } = stats.countries;
  const shown = entries.slice(0, MAX_ROWS);
  const rest = entries.length - shown.length;

  return (
    <DashboardCard
      title={t('data.stats.countries.title')}
      description={
        entries.length > 0
          ? `${t('data.stats.countries.description')} · ${tp('data.stats.countries.count', entries.length)}`
          : t('data.stats.countries.description')
      }
      icon={<Earth />}
      className={className}
      delay={delay}
    >
      {entries.length === 0 ? (
        <CardNote icon={classificationPending ? <Hourglass /> : undefined}>{t('data.stats.countries.empty')}</CardNote>
      ) : (
        <>
          <BarList
            aria-label={t('data.stats.countries.title')}
            labelColumn="minmax(0,46%)"
            max={entries[0].authors}
            delay={delay}
            items={shown.map((e) => {
              const name = countryName(e.code, locale);
              return {
                key: e.code,
                label: <CountryFlag code={e.code} showName className="max-w-full min-w-0" />,
                title: `${name}: ${tp('common.unit.author', e.authors)}, ${tp('common.unit.book', e.books)}`,
                value: e.authors,
                valueLabel: tp('common.unit.author', e.authors),
              };
            })}
          />
          {rest > 0 || unknownAuthors > 0 ? (
            <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
              {rest > 0 ? <span>{tp('data.stats.countries.more', rest)}</span> : null}
              {unknownAuthors > 0 ? <span>{tp('data.stats.countries.unknown', unknownAuthors)}</span> : null}
            </p>
          ) : null}
        </>
      )}
    </DashboardCard>
  );
}
