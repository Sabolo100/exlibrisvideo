'use client';

import { Hourglass, Languages } from 'lucide-react';
import type { BookFilters } from '@/components/collection/context';
import { useI18n } from '@/i18n/client';
import { languageName } from '@/lib/book-utils';
import { BarList } from './BarList';
import { CardNote, DashboardCard } from './ChartKit';
import { percent, type CollectionStats, type CountEntry } from './stats';

export interface LanguagesCardProps {
  stats: CollectionStats;
  classificationPending: boolean;
  onDrill: (patch: Partial<BookFilters>) => void;
  className?: string;
  delay?: number;
}

const MAX_ROWS = 5;

/** Edition languages (filterable) and original languages, plus the share of translations. */
export function LanguagesCard({ stats, classificationPending, onDrill, className, delay = 0 }: LanguagesCardProps) {
  const { t, tp, n, locale } = useI18n();
  const { languages, originalLanguages, translation } = stats;
  const empty = languages.entries.length === 0 && originalLanguages.entries.length === 0;

  /** language name inside a sentence: Hungarian language names are lower-case adjectives */
  const inSentence = (code: string) => {
    const name = languageName(code, locale);
    return locale === 'hu' ? name.toLocaleLowerCase('hu-HU') : name;
  };

  const section = (
    heading: string,
    data: { entries: CountEntry[]; unknown: number },
    filterable: boolean,
    sectionDelay: number,
  ) => {
    if (data.entries.length === 0) return null;
    if (data.entries.length === 1) {
      // a one-bar chart says nothing a sentence cannot
      const only = data.entries[0];
      return (
        <div className="min-w-0">
          <h4 className="mb-1 text-xs font-medium tracking-[0.06em] text-muted uppercase">{heading}</h4>
          <p className="text-sm text-ink">
            {t(filterable ? 'data.stats.languages.singleEdition' : 'data.stats.languages.singleOriginal', {
              language: inSentence(only.key),
            })}
            {data.unknown > 0 ? (
              <span className="ml-2 text-xs text-muted">{t('data.stats.languages.unknown', { count: n(data.unknown) })}</span>
            ) : null}
          </p>
        </div>
      );
    }
    const shown = data.entries.slice(0, MAX_ROWS);
    const rest = data.entries.length - shown.length;
    const top = data.entries[0]?.count ?? 0;
    return (
      <div className="min-w-0">
        <h4 className="mb-1 text-xs font-medium tracking-[0.06em] text-muted uppercase">{heading}</h4>
        <BarList
          aria-label={heading}
          max={top}
          delay={sectionDelay}
          items={shown.map((e) => {
            const name = languageName(e.key, locale);
            return {
              key: e.key,
              label: name,
              title: `${name} (${e.key})`,
              value: e.count,
              valueLabel: n(e.count),
              ariaLabel: filterable
                ? t('data.stats.filterAria', { label: name, books: tp('common.unit.book', e.count) })
                : undefined,
              onSelect: filterable ? () => onDrill({ languages: [e.key] }) : undefined,
            };
          })}
        />
        {rest > 0 || data.unknown > 0 ? (
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
            {rest > 0 ? <span>{tp('data.stats.languages.more', rest)}</span> : null}
            {data.unknown > 0 ? <span>{t('data.stats.languages.unknown', { count: n(data.unknown) })}</span> : null}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <DashboardCard
      title={t('data.stats.languages.title')}
      description={t('data.stats.languages.description')}
      icon={<Languages />}
      className={className}
      delay={delay}
    >
      {empty ? (
        <CardNote icon={classificationPending ? <Hourglass /> : undefined}>{t('data.stats.languages.empty')}</CardNote>
      ) : (
        <div className="flex flex-col gap-4">
          {translation.known > 0 ? (
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-display text-2xl leading-none font-semibold text-ink">
                {t('data.stats.languages.translated', { percent: n(percent(translation.translated, translation.known)) })}
              </span>
              <span className="text-xs text-muted">{tp('data.stats.languages.translatedHint', translation.known)}</span>
            </p>
          ) : null}
          {section(t('data.stats.languages.edition'), languages, true, delay)}
          {section(t('data.stats.languages.original'), originalLanguages, false, delay + 0.15)}
        </div>
      )}
    </DashboardCard>
  );
}
