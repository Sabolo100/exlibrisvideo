'use client';

import { CalendarRange, Hourglass } from 'lucide-react';
import type { BookFilters } from '@/components/collection/context';
import { useI18n } from '@/i18n/client';
import { CardNote, DashboardCard, SrTable } from './ChartKit';
import { ColumnChart, type ColumnDatum } from './ColumnChart';
import { BAR_MUTED_COLOR } from './palette';
import type { CollectionStats } from './stats';
import { useStatsFormat } from './useStatsFormat';

export interface DecadesCardProps {
  stats: CollectionStats;
  classificationPending: boolean;
  onDrill: (patch: Partial<BookFilters>) => void;
  className?: string;
  delay?: number;
}

/** Histogram of first-publication years: decades, with older books grouped per century. */
export function DecadesCard({ stats, classificationPending, onDrill, className, delay }: DecadesCardProps) {
  const { t, tp, n } = useI18n();
  const fmt = useStatsFormat();
  const { buckets, unknown } = stats.years;
  const title = t('data.stats.decades.title');

  const firstDecade = buckets.findIndex((b) => b.kind === 'decade');
  const hasCenturies = buckets.some((b) => b.kind === 'century');
  const cutoff = firstDecade >= 0 ? buckets[firstDecade].start : null;

  const columns: ColumnDatum[] = buckets.map((b) => ({
    key: b.key,
    value: b.count,
    label: fmt.bucketLabel(b),
    shortLabel: fmt.bucketLabel(b, true),
    // wider (century) bins are drawn one step lighter so they do not read as one busy decade
    color: b.kind === 'century' ? BAR_MUTED_COLOR : undefined,
    onSelect: b.count > 0 ? () => onDrill({ decades: b.decades }) : undefined,
  }));

  const peak = buckets.reduce<(typeof buckets)[number] | null>((best, b) => (!best || b.count > best.count ? b : best), null);

  return (
    <DashboardCard
      title={title}
      description={t('data.stats.decades.description')}
      icon={<CalendarRange />}
      className={className}
      delay={delay}
    >
      {buckets.length === 0 ? (
        <CardNote icon={classificationPending ? <Hourglass /> : undefined}>{t('data.stats.decades.empty')}</CardNote>
      ) : (
        <>
          <ColumnChart
            data={columns}
            title={title}
            desc={
              peak
                ? t('data.stats.decades.desc', {
                    from: fmt.bucketLabel(buckets[0]),
                    to: fmt.bucketLabel(buckets[buckets.length - 1]),
                    label: fmt.bucketLabel(peak),
                    books: tp('common.unit.book', peak.count),
                  })
                : title
            }
            groupLabel={title}
            formatValue={(v) => tp('common.unit.book', v)}
            formatNumber={(v) => n(v)}
            actionLabel={(d) => t('data.stats.filterAria', { label: d.label, books: tp('common.unit.book', d.value) })}
            separators={hasCenturies && firstDecade > 0 ? [firstDecade] : []}
            capLabels="max"
            axis
            delay={delay}
          />
          <div className="mt-2 space-y-0.5 text-xs text-muted">
            {hasCenturies && cutoff !== null ? <p>{t('data.stats.decades.centuryNote', { year: fmt.yearText(cutoff) })}</p> : null}
            {unknown > 0 ? <p>{tp('data.stats.decades.unknown', unknown)}</p> : null}
          </div>
          <SrTable
            caption={t('data.stats.table.caption', { title })}
            columns={[t('data.stats.table.period'), t('data.stats.table.books')]}
            rows={buckets.map((b) => [fmt.bucketLabel(b), n(b.count)])}
          />
        </>
      )}
    </DashboardCard>
  );
}
