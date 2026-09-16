'use client';

import { ChartPie, Hourglass } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { BookFilters } from '@/components/collection/context';
import { cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { topicDef, topicLabel } from '@/lib/taxonomy';
import { CardNote, DashboardCard, SrTable } from './ChartKit';
import { slotColor } from './palette';
import { RingChart } from './RingChart';
import { NONE_SLICE, OTHER_SLICE, percent, type CategorySlice, type CollectionStats } from './stats';
import { useStatsFormat } from './useStatsFormat';

export interface CategoryCardProps {
  stats: CollectionStats;
  /** some book in view has not been through enrichment yet */
  classificationPending: boolean;
  onDrill: (patch: Partial<BookFilters>) => void;
  className?: string;
  delay?: number;
}

function sliceColor(slice: CategorySlice): string {
  if (slice.slot !== null) return slotColor(slice.slot);
  return slice.key === NONE_SLICE ? 'var(--viz-none)' : 'var(--viz-other)';
}

/** Category donut with a legend; hovering either highlights the slice, a legend row filters the catalogue. */
export function CategoryCard({ stats, classificationPending, onDrill, className, delay }: CategoryCardProps) {
  const { t, tp, n, locale } = useI18n();
  const fmt = useStatsFormat();
  const [active, setActive] = useState<string | null>(null);
  const slices = stats.categories;
  const total = stats.total;

  const labelOf = useMemo(
    () => (slice: CategorySlice) => {
      if (slice.key === OTHER_SLICE) return t('data.stats.categories.other');
      if (slice.key === NONE_SLICE) return t(classificationPending ? 'data.stats.categories.nonePending' : 'data.stats.categories.none');
      return topicLabel(slice.key, locale);
    },
    [t, classificationPending, locale],
  );

  const classified = slices.filter((s) => s.key !== NONE_SLICE);
  const largest = classified[0] ?? null;
  const activeSlice = slices.find((s) => s.key === active) ?? null;
  const title = t('data.stats.categories.title');

  return (
    <DashboardCard
      title={title}
      description={t('data.stats.categories.description')}
      icon={<ChartPie />}
      className={className}
      delay={delay}
    >
      {classified.length === 0 ? (
        <CardNote icon={classificationPending ? <Hourglass /> : undefined}>{t('data.stats.categories.empty')}</CardNote>
      ) : (
        <div className="flex flex-col items-center gap-5 @[26rem]:flex-row @[26rem]:items-center">
          <RingChart
            size={184}
            thickness={22}
            className="@[26rem]:[--ring-size:9.5rem] @[40rem]:[--ring-size:11.5rem]"
            data={slices.map((s) => ({ key: s.key, value: s.count, color: sliceColor(s) }))}
            activeKey={active}
            onActiveChange={setActive}
            title={title}
            desc={
              largest
                ? t('data.stats.categories.desc', {
                    count: n(classified.reduce((acc, s) => acc + Math.max(1, s.members.length), 0)),
                    label: labelOf(largest),
                    percent: n(percent(largest.count, total)),
                  })
                : ''
            }
          >
            {activeSlice ? (
              <>
                <span className="font-display text-2xl leading-none font-semibold text-ink">
                  {fmt.percentText(percent(activeSlice.count, total))}
                </span>
                <span className="mt-1 line-clamp-2 text-xs leading-tight text-muted">{labelOf(activeSlice)}</span>
              </>
            ) : (
              <>
                <span className="font-display text-3xl leading-none font-semibold text-ink">{n(total)}</span>
                <span className="mt-1 text-xs text-muted">{tp('data.stats.center.books', total)}</span>
              </>
            )}
          </RingChart>

          <ul className="w-full min-w-0 flex-1 space-y-0.5" onMouseLeave={() => setActive(null)}>
            {slices.map((slice) => {
              const label = labelOf(slice);
              const pct = percent(slice.count, total);
              const icon = slice.key === OTHER_SLICE ? '🔖' : slice.key === NONE_SLICE ? '' : (topicDef(slice.key)?.icon ?? '🔖');
              const members =
                slice.key === OTHER_SLICE
                  ? t('data.stats.categories.members', { list: slice.members.map((k) => topicLabel(k, locale)).join(', ') })
                  : undefined;
              const rowClass = cn(
                'flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                active === slice.key && 'bg-surface-2',
              );
              const inner = (
                <>
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ background: sliceColor(slice) }}
                  />
                  <span aria-hidden="true" className="flex min-w-5 shrink-0 justify-center text-[0.9375rem] leading-none">
                    {icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink">{label}</span>
                  <span className="shrink-0 text-ink tabular-nums">{n(slice.count)}</span>
                  <span className="w-10 shrink-0 text-right text-xs text-muted tabular-nums">{fmt.percentText(pct)}</span>
                </>
              );
              const filterTopics = slice.key === OTHER_SLICE ? slice.members : slice.key === NONE_SLICE ? [] : [slice.key];
              return (
                <li key={slice.key}>
                  {filterTopics.length > 0 ? (
                    <button
                      type="button"
                      className={cn(rowClass, 'hover:bg-surface-2')}
                      title={members ?? t('data.stats.showOnShelf')}
                      aria-label={t('data.stats.filterAria', {
                        label: members ? `${label} (${members})` : label,
                        books: `${tp('common.unit.book', slice.count)}, ${fmt.percentText(pct)}`,
                      })}
                      onMouseEnter={() => setActive(slice.key)}
                      onFocus={() => setActive(slice.key)}
                      onBlur={() => setActive(null)}
                      onClick={() => onDrill({ topics: filterTopics })}
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className={rowClass} onMouseEnter={() => setActive(slice.key)}>
                      {inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <SrTable
            caption={t('data.stats.table.caption', { title })}
            columns={[t('data.stats.table.category'), t('data.stats.table.books'), t('data.stats.table.share')]}
            rows={slices.map((s) => [
              s.key === OTHER_SLICE
                ? `${labelOf(s)} (${s.members.map((k) => topicLabel(k, locale)).join(', ')})`
                : labelOf(s),
              n(s.count),
              fmt.percentText(percent(s.count, total)),
            ])}
          />
        </div>
      )}
    </DashboardCard>
  );
}
