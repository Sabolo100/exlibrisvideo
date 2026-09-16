'use client';

import { useMemo } from 'react';
import { useI18n } from '@/i18n/client';
import { huDecadeSuffix } from './format';
import { centuryParts, englishOrdinal, splitDays, type YearBucket } from './stats';

/** Localised labels shared by the stats cards (decades, centuries, BC years, durations, percentages). */
export function useStatsFormat() {
  const { t, tp, n } = useI18n();
  return useMemo(() => {
    const percentText = (value: number) => t('data.stats.percent', { value: n(value) });
    /** years are never digit-grouped; BC years get the localised era marker */
    const yearText = (year: number) => (year < 0 ? t('data.stats.year.bc', { year: String(-year) }) : String(year));
    const decadeLabel = (start: number) =>
      start < 0
        ? `${yearText(start)} – ${yearText(start + 9)}`
        : t('data.stats.decades.decade', { year: String(start), suffix: huDecadeSuffix(start) });
    const centuryLabel = (start: number, short = false) => {
      const { number, bc } = centuryParts(start);
      const vars = { number: String(number), ordinal: englishOrdinal(number) };
      if (short) return t(bc ? 'data.stats.decades.centuryShortBc' : 'data.stats.decades.centuryShort', vars);
      return t(bc ? 'data.stats.decades.centuryBc' : 'data.stats.decades.century', vars);
    };
    const bucketLabel = (bucket: Pick<YearBucket, 'kind' | 'start'>, short = false) => {
      if (bucket.kind === 'century') return centuryLabel(bucket.start, short);
      if (short) return bucket.start < 0 ? yearText(bucket.start) : t('data.stats.decades.decadeShort', { year: String(bucket.start) });
      return decadeLabel(bucket.start);
    };
    const duration = (totalDays: number) => {
      const { years, days } = splitDays(totalDays);
      if (years > 0 && days > 0) {
        return t('data.stats.duration.yearsDays', {
          years: tp('data.stats.duration.years', years),
          days: tp('data.stats.duration.days', days),
        });
      }
      if (years > 0) return tp('data.stats.duration.years', years);
      return tp('data.stats.duration.days', days);
    };
    const books = (count: number) => tp('common.unit.book', count);
    return { percentText, yearText, decadeLabel, centuryLabel, bucketLabel, duration, books };
  }, [t, tp, n]);
}

export type StatsFormat = ReturnType<typeof useStatsFormat>;
