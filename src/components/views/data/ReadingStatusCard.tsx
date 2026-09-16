'use client';

import { BookCheck, Table2 } from 'lucide-react';
import { useState } from 'react';
import { READING_STATUS_META } from '@/components/books';
import type { BookFilters } from '@/components/collection/context';
import { Button, cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { ReadingStatus } from '@/lib/types';
import { DashboardCard, SrTable } from './ChartKit';
import { STATUS_COLOR, STATUS_RING_ORDER } from './palette';
import { RingChart } from './RingChart';
import { percent, type CollectionStats } from './stats';
import { useStatsFormat } from './useStatsFormat';

export interface ReadingStatusCardProps {
  stats: CollectionStats;
  isOwner: boolean;
  onDrill: (patch: Partial<BookFilters>) => void;
  onOpenTable: () => void;
  className?: string;
  delay?: number;
}

/** Progress ring of the reading statuses with a clickable breakdown. */
export function ReadingStatusCard({ stats, isOwner, onDrill, onOpenTable, className, delay }: ReadingStatusCardProps) {
  const { t, tp, n } = useI18n();
  const fmt = useStatsFormat();
  const [active, setActive] = useState<ReadingStatus | null>(null);
  const total = stats.total;
  const counts = stats.statuses;
  const readPct = percent(counts.read, total);
  const noneSet = total > 0 && counts.unknown === total;
  const title = t('data.stats.status.title');
  const activeCount = active ? counts[active] : 0;

  return (
    <DashboardCard
      title={title}
      description={t('data.stats.status.description')}
      icon={<BookCheck />}
      className={className}
      delay={delay}
    >
      <div className="flex flex-col items-center gap-5 @sm:flex-row @sm:items-center">
        <RingChart
          size={168}
          thickness={18}
          className="@sm:[--ring-size:9rem] @[36rem]:[--ring-size:10.5rem]"
          data={STATUS_RING_ORDER.map((s) => ({ key: s, value: counts[s], color: STATUS_COLOR[s] }))}
          activeKey={active}
          onActiveChange={(key) => setActive(key as ReadingStatus | null)}
          title={title}
          desc={t('data.stats.status.desc', {
            percent: n(readPct),
            reading: n(counts.reading),
            toRead: n(counts.to_read),
            abandoned: n(counts.abandoned),
          })}
        >
          {active ? (
            <>
              <span className="font-display text-2xl leading-none font-semibold text-ink">
                {fmt.percentText(percent(activeCount, total))}
              </span>
              <span className="mt-1 line-clamp-2 text-xs leading-tight text-muted">{t(READING_STATUS_META[active].labelKey)}</span>
            </>
          ) : (
            <>
              <span className="font-display text-3xl leading-none font-semibold text-ink">{fmt.percentText(readPct)}</span>
              <span className="mt-1 text-xs text-muted">{t('data.stats.status.center')}</span>
            </>
          )}
        </RingChart>

        <ul className="w-full min-w-0 flex-1 space-y-0.5" onMouseLeave={() => setActive(null)}>
          {STATUS_RING_ORDER.map((status) => {
            const meta = READING_STATUS_META[status];
            const Icon = meta.icon;
            const count = counts[status];
            const label = t(meta.labelKey);
            const pct = fmt.percentText(percent(count, total));
            const rowClass = cn(
              'flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              active === status && 'bg-surface-2',
              count === 0 && 'opacity-60',
            );
            const inner = (
              <>
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[status] }} />
                <Icon aria-hidden="true" className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-ink">{label}</span>
                <span className="shrink-0 text-ink tabular-nums">{n(count)}</span>
                <span className="w-10 shrink-0 text-right text-xs text-muted tabular-nums">{pct}</span>
              </>
            );
            return (
              <li key={status}>
                {count > 0 ? (
                  <button
                    type="button"
                    className={cn(rowClass, 'hover:bg-surface-2')}
                    title={t('data.stats.showOnShelf')}
                    aria-label={t('data.stats.filterAria', { label, books: `${tp('common.unit.book', count)}, ${pct}` })}
                    onMouseEnter={() => setActive(status)}
                    onFocus={() => setActive(status)}
                    onBlur={() => setActive(null)}
                    onClick={() => onDrill({ statuses: [status] })}
                  >
                    {inner}
                  </button>
                ) : (
                  <div className={rowClass}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>

        <SrTable
          caption={t('data.stats.table.caption', { title })}
          columns={[t('data.stats.table.status'), t('data.stats.table.books'), t('data.stats.table.share')]}
          rows={STATUS_RING_ORDER.map((s) => [t(READING_STATUS_META[s].labelKey), n(counts[s]), fmt.percentText(percent(counts[s], total))])}
        />
      </div>

      {noneSet ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-surface-2/70 px-3 py-2.5 text-sm text-muted">
          <p className="min-w-0 flex-1">
            {t('data.stats.status.noneSet')} {isOwner ? t('data.stats.status.ownerHint') : null}
          </p>
          {isOwner ? (
            <Button size="sm" variant="secondary" leftIcon={<Table2 aria-hidden="true" />} onClick={onOpenTable}>
              {t('data.stats.status.openTable')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </DashboardCard>
  );
}
